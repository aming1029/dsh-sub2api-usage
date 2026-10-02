/**
 * Hourly sampling: the host turns today's running totals into hour buckets.
 *
 * Everything here is pure or file-backed, so the tests pin the arithmetic that
 * decides what the 按小时 view shows — including what it refuses to invent.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  HOURLY_RETAIN_HOURS,
  countersFrom,
  createSampler,
  hourKey,
  hourKeysEndingAt,
  shiftHourKey,
  zoneParts,
} from '../lib/samples.js';

const TZ = 'Asia/Shanghai';

/** A snapshot shaped like the host's, carrying today's running totals. */
function snapshot(today, daily) {
  return { today, daily };
}

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 's2u-hourly-'));
  return { dir, file: join(dir, 'hourly.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('zoneParts and hourKey follow the configured timezone', () => {
  // 2026-10-01T16:30Z is 2026-10-02 00:30 in Shanghai.
  const at = new Date('2026-10-01T16:30:00Z');
  assert.deepEqual(zoneParts(at, TZ), { day: '2026-10-02', hour: '00', zone: TZ });
  assert.equal(hourKey(at, TZ), '2026-10-02T00:00');
  assert.equal(hourKey(at, 'UTC'), '2026-10-01T16:00');
  // An unknown zone degrades to UTC instead of throwing.
  assert.equal(hourKey(at, 'Mars/Olympus'), '2026-10-01T16:00');
});

test('hourKeysEndingAt walks back whole hours, oldest first', () => {
  const keys = hourKeysEndingAt(new Date('2026-10-02T00:30:00+08:00'), TZ, 3);
  assert.deepEqual(keys, ['2026-10-01T22:00', '2026-10-01T23:00', '2026-10-02T00:00']);
  assert.equal(hourKeysEndingAt(new Date(), TZ, 9999).length, HOURLY_RETAIN_HOURS, '窗口不会超过保留上限');
  assert.equal(shiftHourKey('2026-10-02T00:00', -1), '2026-10-01T23:00');
  assert.equal(shiftHourKey('nonsense', 1), null);
});

test('countersFrom prefers today, then falls back to the matching daily row', () => {
  assert.deepEqual(
    countersFrom(snapshot({ cost: 1.5, actual: 1.8, requests: 12, tokens: 900 }, [])),
    { cost: 1.5, actual: 1.8, requests: 12, tokens: 900 },
  );
  const rows = [
    { date: '2026-10-01', value: 2, requests: 5, tokens: 50 },
    { date: '2026-10-02', value: 0.5, requests: 2, tokens: 20 },
  ];
  // Only metrics the payload actually reports are carried over.
  assert.deepEqual(countersFrom(snapshot(undefined, rows), '2026-10-02'), { cost: 0.5, requests: 2, tokens: 20 });
  assert.equal(countersFrom(snapshot(undefined, rows), '2026-10-03'), null, '没有当天的行就没有累计值');
  assert.equal(countersFrom(snapshot(undefined, [])), null);
});

test('the first observation is only a baseline', async () => {
  const { file, cleanup } = tempFile();
  try {
    const sampler = createSampler({ file });
    const first = await sampler.observe(snapshot({ cost: 3, requests: 30, tokens: 300 }), { timezone: TZ, now: new Date('2026-10-01T10:05:00+08:00') });
    assert.equal(first.added, false);
    assert.equal(first.reason, 'baseline');
    assert.deepEqual(sampler.buckets(), {}, '还不知道这一小时之前用了多少，所以先不写桶');
  } finally {
    cleanup();
  }
});

test('each sample adds the delta to the hour it lands in', async () => {
  const { file, cleanup } = tempFile();
  try {
    const sampler = createSampler({ file });
    await sampler.observe(snapshot({ cost: 1, actual: 1.2, requests: 10, tokens: 100 }), { timezone: TZ, now: new Date('2026-10-01T10:00:00+08:00') });
    await sampler.observe(snapshot({ cost: 1.25, actual: 1.5, requests: 14, tokens: 160 }), { timezone: TZ, now: new Date('2026-10-01T10:02:00+08:00') });
    const buckets = sampler.buckets();
    assert.deepEqual(Object.keys(buckets), ['2026-10-01T10:00']);
    assert.deepEqual(buckets['2026-10-01T10:00'], {
      hour: '2026-10-01T10:00',
      cost: 0.25,
      actual: 0.3,
      requests: 4,
      tokens: 60,
      spanMin: 2,
      partial: false,
    });

    // A later hour accumulates separately.
    await sampler.observe(snapshot({ cost: 1.5, requests: 16, tokens: 200 }), { timezone: TZ, now: new Date('2026-10-01T11:01:00+08:00') });
    assert.deepEqual(Object.keys(sampler.buckets()).sort(), ['2026-10-01T10:00', '2026-10-01T11:00']);
    assert.equal(sampler.buckets()['2026-10-01T11:00'].cost, 0.25);
    assert.equal(sampler.buckets()['2026-10-01T11:00'].partial, false);
  } finally {
    cleanup();
  }
});

test('a quiet interval still creates its bucket, so a zero hour is not a gap', async () => {
  const { file, cleanup } = tempFile();
  try {
    const sampler = createSampler({ file });
    await sampler.observe(snapshot({ cost: 2 }), { timezone: TZ, now: new Date('2026-10-01T10:00:00+08:00') });
    const idle = await sampler.observe(snapshot({ cost: 2 }), { timezone: TZ, now: new Date('2026-10-01T10:02:00+08:00') });
    assert.equal(idle.added, true);
    const bucket = sampler.buckets()['2026-10-01T10:00'];
    assert.equal(bucket.cost, 0, '没有花钱也是一个已知的 0');
    assert.equal(bucket.spanMin, 2);
  } finally {
    cleanup();
  }
});

test('a counter that restarted (new site day) starts the bucket from zero', async () => {
  const { file, cleanup } = tempFile();
  try {
    const sampler = createSampler({ file });
    await sampler.observe(snapshot({ cost: 9, requests: 90 }), { timezone: TZ, now: new Date('2026-10-01T23:58:00+08:00') });
    const rolled = await sampler.observe(snapshot({ cost: 0.4, requests: 3 }), { timezone: TZ, now: new Date('2026-10-02T00:02:00+08:00') });
    assert.equal(rolled.hour, '2026-10-02T00:00');
    const bucket = sampler.buckets()['2026-10-02T00:00'];
    assert.equal(bucket.cost, 0.4, '跨天时当前值就是新一天的用量');
    assert.equal(bucket.requests, 3);
    assert.equal(bucket.partial, true, '跨天的那一小时不是完整一小时');
  } finally {
    cleanup();
  }
});

test('a long gap is attributed to the arrival hour and flagged', async () => {
  const { file, cleanup } = tempFile();
  try {
    const sampler = createSampler({ file });
    await sampler.observe(snapshot({ cost: 1 }), { timezone: TZ, now: new Date('2026-10-01T10:00:00+08:00') });
    const late = await sampler.observe(snapshot({ cost: 4 }), { timezone: TZ, now: new Date('2026-10-01T13:30:00+08:00') });
    assert.equal(late.partial, true);
    assert.equal(late.spanMin, 210);
    const bucket = sampler.buckets()['2026-10-01T13:00'];
    assert.equal(bucket.cost, 3, '总量不丢，但整段都记在到达的那一小时');
    assert.equal(bucket.partial, true);
  } finally {
    cleanup();
  }
});

test('buckets survive a restart and are pruned to the retention window', async () => {
  const { file, cleanup } = tempFile();
  try {
    const first = createSampler({ file });
    await first.observe(snapshot({ cost: 1 }), { timezone: TZ, now: new Date('2026-10-01T10:00:00+08:00') });
    await first.observe(snapshot({ cost: 2 }), { timezone: TZ, now: new Date('2026-10-01T10:02:00+08:00') });

    const second = createSampler({ file });
    await second.load();
    assert.equal(second.buckets()['2026-10-01T10:00'].cost, 1, '重启后接着累计');

    // 15 days later the old bucket is outside the 14-day window.
    await second.observe(snapshot({ cost: 5 }), { timezone: TZ, now: new Date('2026-10-16T10:00:00+08:00') });
    assert.deepEqual(Object.keys(second.buckets()), ['2026-10-16T10:00']);

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.samples, 3);
    assert.equal(typeof saved.last.at, 'string');
  } finally {
    cleanup();
  }
});

test('a snapshot without counters is ignored instead of zeroing the hour', async () => {
  const { file, cleanup } = tempFile();
  try {
    const sampler = createSampler({ file });
    await sampler.observe(snapshot({ cost: 1 }), { timezone: TZ, now: new Date('2026-10-01T10:00:00+08:00') });
    const nothing = await sampler.observe({ daily: [] }, { timezone: TZ, now: new Date('2026-10-01T12:00:00+08:00') });
    assert.deepEqual(nothing, { added: false, hour: '2026-10-01T12:00', first: false, reason: 'no-counters' });
    assert.equal(sampler.buckets()['2026-10-01T12:00'], undefined);
  } finally {
    cleanup();
  }
});

test('read fills the window and marks unsampled hours as missing', async () => {
  const { file, cleanup } = tempFile();
  try {
    const sampler = createSampler({ file });
    await sampler.observe(snapshot({ cost: 1 }), { timezone: TZ, now: new Date('2026-10-01T10:00:00+08:00') });
    await sampler.observe(snapshot({ cost: 1.5 }), { timezone: TZ, now: new Date('2026-10-01T10:02:00+08:00') });
    // Nothing sampled at 11:00 — the window must still show the slot.
    await sampler.observe(snapshot({ cost: 3 }), { timezone: TZ, now: new Date('2026-10-01T12:30:00+08:00') });
    await sampler.observe(snapshot({ cost: 4 }), { timezone: TZ, now: new Date('2026-10-01T12:32:00+08:00') });

    const window = sampler.read(4, { timezone: TZ, now: new Date('2026-10-01T12:45:00+08:00') });
    assert.equal(window.hours, 4);
    assert.deepEqual(window.buckets.map((bucket) => bucket.hour), ['2026-10-01T09:00', '2026-10-01T10:00', '2026-10-01T11:00', '2026-10-01T12:00']);
    assert.deepEqual(window.buckets.map((bucket) => bucket.missing === true), [true, false, true, false]);
    assert.equal(window.buckets[1].cost, 0.5);
    // The 12:30 sample lands 148 minutes after the previous one, so it carries
    // the whole 1.5 gap into 12:00, and 12:32 adds its own 1.
    assert.equal(window.buckets[3].cost, 2.5);
    assert.equal(window.buckets[3].partial, true);
    assert.equal(window.samples, 4);
    assert.equal(window.since, '2026-10-01T10:00');
  } finally {
    cleanup();
  }
});

test('a damaged or foreign samples file is reported, not fatal', async () => {
  const { dir, file, cleanup } = tempFile();
  try {
    const warnings = [];
    // Not JSON at all: the host must warn and carry on with an empty series
    // rather than fail every /query.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, '{ this is not json', 'utf8');
    const broken = createSampler({ file, warn: (message) => warnings.push(message) });
    await broken.load();
    assert.deepEqual(broken.buckets(), {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /小时采样文件读取失败/);
    // And it recovers: the next sample writes a valid file.
    const after = await broken.observe(snapshot({ cost: 2 }), { timezone: TZ, now: new Date('2026-10-01T10:00:00+08:00') });
    assert.equal(after.added, false);
    assert.equal(after.reason, 'baseline');

    // Entries that are the wrong shape are dropped, valid ones survive.
    writeFileSync(file, JSON.stringify({
      version: 1,
      samples: 3,
      last: { at: '2026-10-01T02:00:00.000Z', day: '2026-10-01', hour: '10', cost: 5 },
      buckets: { '2026-10-01T10:00': 'nonsense', '2026-10-01T09:00': { cost: '1.5', requests: 7, spanMin: 2 } },
    }), 'utf8');
    const mixed = createSampler({ file, warn: (message) => warnings.push(message) });
    await mixed.load();
    assert.deepEqual(Object.keys(mixed.buckets()), ['2026-10-01T09:00'], '坏桶丢掉，好桶留下');
    assert.deepEqual(mixed.buckets()['2026-10-01T09:00'], { hour: '2026-10-01T09:00', cost: 1.5, actual: 0, requests: 7, tokens: 0, spanMin: 2, partial: false });
    assert.equal(mixed.read(2, { timezone: TZ, now: new Date('2026-10-01T10:30:00+08:00') }).samples, 3);
    assert.equal(cleanup !== undefined, true);
    assert.equal(typeof dir, 'string');
  } finally {
    cleanup();
  }
});

/**
 * Host-half tests: drive the real route handler through a fake node request /
 * response pair, with the mock Sub2API site as the upstream. Covers the loopback
 * guard, config persistence (secrets split), query, test and error surfaces.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { ADMIN_KEY, PASSWORD, SITE_KEY, EMAIL, startMockSub2Api } from './mock-sub2api.mjs';

const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sub2api-usage-'));
process.env.DSH_SUB2API_DIR = dataDir;

const { apply, inject, name } = await import('../lib/index.js');

let mock;
let route;
const disposers = [];

before(async () => {
  mock = await startMockSub2Api();
  apply({
    webServer: {
      register(registration) {
        route = registration;
        return () => {
          route = undefined;
        };
      },
    },
    effect(callback) {
      const dispose = callback();
      disposers.push(dispose);
      return dispose;
    },
    log: () => {},
  });
});
after(async () => {
  for (const dispose of disposers) if (typeof dispose === 'function') dispose();
  await mock.close();
  await rm(dataDir, { recursive: true, force: true });
});

function request(method, path, body, remote = '127.0.0.1') {
  const req = new EventEmitter();
  req.method = method;
  req.url = path;
  req.socket = { remoteAddress: remote };
  const res = {
    statusCode: 0,
    headers: undefined,
    payload: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(chunk) {
      this.payload = chunk ?? '';
      this.done?.();
    },
  };
  const finished = new Promise((resolve) => {
    res.done = resolve;
  });
  const promise = (async () => {
    const handled = route.handler(req, res);
    process.nextTick(() => {
      if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      req.emit('end');
    });
    await handled;
    await finished;
    return { status: res.statusCode, headers: res.headers, body: res.payload === '' ? undefined : JSON.parse(res.payload) };
  })();
  return promise;
}

test('the host half declares its cordis contract', () => {
  assert.equal(name, 'sub2api-usage');
  assert.deepEqual(inject, ['webServer']);
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, '/sub2api-usage/api');
});

test('GET /state reports a masked config and the file locations', async () => {
  const response = await request('GET', '/sub2api-usage/api/state');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.config.credential, '');
  assert.equal(response.body.config.hasCredential, false);
  assert.equal(response.body.config.baseUrl, 'https://aiapi.aaming.icu');
  assert.equal(response.body.files.config, join(dataDir, 'sub2api-usage.json'));
  assert.equal(response.body.last.snapshot, null);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('non-loopback callers are refused', async () => {
  const response = await request('GET', '/sub2api-usage/api/state', undefined, '192.168.1.20');
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'forbidden');
});

test('POST /config persists config and secret separately', async () => {
  const response = await request('POST', '/sub2api-usage/api/config', {
    baseUrl: mock.baseUrl + '/',
    mode: 'key',
    credential: SITE_KEY,
    intervalSec: 0,
    rangeDays: 7,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.config.credential, '');
  assert.equal(response.body.config.hasCredential, true);
  assert.equal(response.body.config.credentialHint, `${SITE_KEY.slice(0, 4)}…${SITE_KEY.slice(-4)}`);
  assert.ok(response.body.changed.includes('baseUrl'));

  const safe = await readFile(join(dataDir, 'sub2api-usage.json'), 'utf8');
  assert.equal(safe.includes(SITE_KEY), false, 'the credential must not live in the plain config');
  const secrets = JSON.parse(await readFile(join(dataDir, 'sub2api-usage.secrets.json'), 'utf8'));
  assert.equal(secrets.credential, SITE_KEY);
});

test('POST /query runs against the configured endpoint and returns a snapshot', async () => {
  const response = await request('POST', '/sub2api-usage/api/query', {});
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.snapshot.headline.balance, 12.34);
  assert.equal(response.body.snapshot.mode, 'key');
  assert.equal(response.body.snapshot.range.end.length, 10);
});

test('GET /state now carries the cached snapshot, so a reload paints instantly', async () => {
  const response = await request('GET', '/sub2api-usage/api/state');
  assert.equal(response.body.last.snapshot.headline.balance, 12.34);
  assert.equal(response.body.last.error, null);
});

test('POST /query can override the date window per call', async () => {
  const response = await request('POST', '/sub2api-usage/api/query', { start: '2026-01-01', end: '2026-01-31' });
  assert.equal(response.body.ok, true);
  assert.deepEqual(response.body.snapshot.range, { start: '2026-01-01', end: '2026-01-31' });
  assert.match(response.body.snapshot.raw[0].url, /start_date=2026-01-01/);
});

test('POST /query reports failures as data, not as a broken response', async () => {
  await request('POST', '/sub2api-usage/api/config', { credential: 'sk-wrong' });
  const response = await request('POST', '/sub2api-usage/api/query', {});
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.code, 'envelope');
  assert.match(response.body.error.message, /Invalid API key/);

  const state = await request('GET', '/sub2api-usage/api/state');
  assert.equal(state.body.last.error.code, 'envelope');
  assert.equal(state.body.last.snapshot.headline.balance, 12.34, 'the last good snapshot is retained');

  await request('POST', '/sub2api-usage/api/config', { credential: SITE_KEY });
});

test('POST /test probes a candidate config without saving it', async () => {
  const response = await request('POST', '/sub2api-usage/api/test', {
    config: { mode: 'admin', credential: ADMIN_KEY, adminUserId: '456' },
  });
  assert.equal(response.body.ok, true);
  assert.equal(response.body.snapshot.headline.balance, 3.75);
  assert.equal(response.body.snapshot.mode, 'admin');

  const state = await request('GET', '/sub2api-usage/api/state');
  assert.equal(state.body.config.mode, 'key', 'the saved mode is untouched by /test');
});

test('account mode round-trips through login and keeps the password secret', async () => {
  await request('POST', '/sub2api-usage/api/config', { mode: 'user', email: EMAIL, password: PASSWORD, credential: '' });
  const state = await request('GET', '/sub2api-usage/api/state');
  assert.equal(state.body.config.hasPassword, true);
  assert.equal(state.body.config.password, '');
  assert.equal(state.body.config.email, EMAIL);
  const safe = await readFile(join(dataDir, 'sub2api-usage.json'), 'utf8');
  assert.equal(safe.includes(PASSWORD), false);

  const response = await request('POST', '/sub2api-usage/api/query', {});
  assert.equal(response.body.ok, true);
  assert.equal(response.body.snapshot.headline.balance, 42.5);
});

test('a malformed body or an unknown path answers with a typed error', async () => {
  const bad = await request('POST', '/sub2api-usage/api/config', '{not json');
  assert.equal(bad.status, 200);
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.error.code, 'config');

  const missing = await request('GET', '/sub2api-usage/api/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'notfound');
});

// ------------------------------------------------------------- hourly window
//
// The site's key endpoint only returns day buckets, so the host builds hours
// from the running totals in each response. These tests cover the wiring: when
// a sample is taken, what the window looks like, and what must not be sampled.

test('the state endpoint always ships a full hourly window', async () => {
  await request('POST', '/sub2api-usage/api/config', { hourlyHours: 24, intervalSec: 0 });
  const response = await request('GET', '/sub2api-usage/api/state');
  const { hourly } = response.body;
  assert.equal(hourly.hours, 24);
  assert.equal(hourly.buckets.length, 24, '每个小时都占一个位置');
  assert.equal(hourly.retainedHours, 336);
  assert.match(hourly.to, /^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
  assert.deepEqual(
    hourly.buckets.map((bucket) => bucket.hour),
    [...hourly.buckets.map((bucket) => bucket.hour)].sort(),
    '窗口按时间升序',
  );
  assert.ok(hourly.buckets.every((bucket) => bucket.missing === true || typeof bucket.cost === 'number'));
});

test('a successful query samples the current hour exactly once', async () => {
  // Key mode is what reports today's running totals; account mode (the test
  // above) has no counters at all, which the next case pins down.
  await request('POST', '/sub2api-usage/api/config', { mode: 'key', credential: SITE_KEY, intervalSec: 0 });
  const before = await request('GET', '/sub2api-usage/api/state');
  const first = await request('POST', '/sub2api-usage/api/query', {});
  assert.equal(first.body.hourly.samples, before.body.hourly.samples + 1);

  const second = await request('POST', '/sub2api-usage/api/query', {});
  assert.equal(second.body.hourly.samples, first.body.hourly.samples + 1);

  const current = second.body.hourly.buckets[second.body.hourly.buckets.length - 1];
  assert.equal(current.hour, second.body.hourly.to);
  assert.equal(current.missing, undefined, '刚采样过的小时不能是缺口');
  assert.equal(typeof current.cost, 'number');
  assert.equal(typeof current.requests, 'number', 'mock 的 usage.today 里有请求数');
  assert.equal(current.spanMin > 0, true);

  const saved = JSON.parse(await readFile(join(dataDir, 'sub2api-usage.hourly.json'), 'utf8'));
  assert.equal(saved.version, 1);
  assert.equal(saved.samples, second.body.hourly.samples, '采样计数落盘，重启后接着累计');
});

test('a response without running totals is not sampled into a fake zero', async () => {
  await request('POST', '/sub2api-usage/api/config', { mode: 'user', email: EMAIL, password: PASSWORD, credential: '' });
  const before = await request('GET', '/sub2api-usage/api/state');
  const query = await request('POST', '/sub2api-usage/api/query', {});
  assert.equal(query.body.ok, true, '账号模式照样能查余额');
  assert.equal(query.body.hourly.samples, before.body.hourly.samples, '没有 usage.today 就不要记一笔');
  await request('POST', '/sub2api-usage/api/config', { mode: 'key', credential: SITE_KEY });
});

test('probing a candidate config does not pollute the samples', async () => {
  const before = await request('GET', '/sub2api-usage/api/state');
  const probe = await request('POST', '/sub2api-usage/api/test', { config: { mode: 'key', credential: SITE_KEY } });
  assert.equal(probe.body.ok, true);
  const after = await request('GET', '/sub2api-usage/api/state');
  assert.equal(after.body.hourly.samples, before.body.hourly.samples);
});

test('the hourly window follows hourlyHours, clamped to what is retained', async () => {
  const narrow = await request('POST', '/sub2api-usage/api/config', { hourlyHours: 6 });
  assert.equal(narrow.body.config.hourlyHours, 6);
  const six = await request('GET', '/sub2api-usage/api/state');
  assert.equal(six.body.hourly.hours, 6);

  const silly = await request('POST', '/sub2api-usage/api/config', { hourlyHours: 9999 });
  assert.equal(silly.body.config.hourlyHours, 336, '超过保留上限就夹到上限');
  const wide = await request('GET', '/sub2api-usage/api/state');
  assert.equal(wide.body.hourly.hours, 336);

  await request('POST', '/sub2api-usage/api/config', { hourlyHours: 24 });
});

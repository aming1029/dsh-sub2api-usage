/**
 * The opt-in site-side hourly source: the site's own dashboard trend endpoint.
 *
 * The endpoint and its field names were read out of the site's frontend bundle
 * (its `usage` API module and the dashboard chart), so these tests pin the
 * contract we depend on: the request it builds, how labels are parsed, and that
 * every failure falls back to the local samples instead of showing wrong hours.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeConfig } from '../lib/core.js';
import { hourKeyFromLabel, windowFromTrend, fetchSiteHours } from '../lib/site-hours.js';
import { EMAIL, PASSWORD, SITE_KEY, USER_TOKEN, richHourTrend, startMockSub2Api } from './mock-sub2api.mjs';

const TZ = 'Asia/Shanghai';
const AT = new Date('2026-10-02T11:30:00+08:00');

const config = (overrides = {}) => normalizeConfig({
  baseUrl: 'http://127.0.0.1:1',
  mode: 'user',
  timezone: TZ,
  hourlyHours: 6,
  ...overrides,
});

test('hour labels are read as wall-clock in the configured timezone', () => {
  assert.equal(hourKeyFromLabel('2026-10-02 09:00', TZ), '2026-10-02T09:00');
  assert.equal(hourKeyFromLabel('2026-10-02T09:30:00', TZ), '2026-10-02T09:00');
  assert.equal(hourKeyFromLabel('2026-10-02 09', TZ), '2026-10-02T09:00');
  // A real instant is converted through the timezone instead of being read literally.
  assert.equal(hourKeyFromLabel('2026-10-02T01:00:00Z', TZ), '2026-10-02T09:00');
  assert.equal(hourKeyFromLabel('2026-10-02T01:00:00+00:00', TZ), '2026-10-02T09:00');
  assert.equal(hourKeyFromLabel('nonsense', TZ), null);
  assert.equal(hourKeyFromLabel('', TZ), null);
  assert.equal(hourKeyFromLabel(undefined, TZ), null);
});

test('trend rows become the same buckets the sampler produces', () => {
  const window = windowFromTrend([
    { date: '2026-10-02 09:00', requests: 3, total_tokens: 300, cost: 0.25, actual_cost: 0.2 },
    { date: '2026-10-02 09:30:00', requests: 4, total_tokens: 400, cost: 0.5, actual_cost: 0.4 },
    { date: '2026-10-02 11:00', requests: 30, total_tokens: 3000, cost: 1.5, actual_cost: 1.2 },
    { date: '2026-10-01 03:00', requests: 99, cost: 9 }, // outside the window
    { date: 'garbage', requests: 1, cost: 1 },
    null,
  ], { timezone: TZ, now: AT, hours: 6 });

  assert.equal(window.source, 'site');
  assert.deepEqual(window.buckets.map((bucket) => bucket.hour), [
    '2026-10-02T06:00', '2026-10-02T07:00', '2026-10-02T08:00', '2026-10-02T09:00', '2026-10-02T10:00', '2026-10-02T11:00',
  ]);
  // 09:00 merges two rows (the endpoint may be per-model), 11:00 stands alone.
  assert.deepEqual(window.buckets[3], {
    hour: '2026-10-02T09:00', cost: 0.75, actual: 0.6, requests: 7, tokens: 700, spanMin: null, partial: false, source: 'site',
  });
  assert.deepEqual(window.buckets[5], {
    hour: '2026-10-02T11:00', cost: 1.5, actual: 1.2, requests: 30, tokens: 3000, spanMin: null, partial: false, source: 'site',
  });
  // Hours the site did not report stay holes, never 0.
  assert.deepEqual(window.buckets[0], { hour: '2026-10-02T06:00', missing: true, source: 'site' });
  assert.equal(window.sampledHours, 2);
  assert.equal(window.matched, 3);
  assert.equal(window.skipped, 1, '窗口外的那一行被丢掉');
  assert.equal(window.unparsed, 2, '解析不了的行要被数出来，而不是当 0');
  assert.equal(window.from, '2026-10-02T06:00');
  assert.equal(window.to, '2026-10-02T11:00');
});

test('an empty or non-array trend yields a window of holes', () => {
  const empty = windowFromTrend([], { timezone: TZ, now: AT, hours: 3 });
  assert.deepEqual(empty.buckets.map((bucket) => bucket.missing), [true, true, true]);
  assert.equal(empty.sampledHours, 0);
  const notAnArray = windowFromTrend(undefined, { timezone: TZ, now: AT, hours: 2 });
  assert.equal(notAnArray.hours, 2);
});

test('a stored token is used directly and the request carries the contract', async () => {
  const mock = await startMockSub2Api();
  const calls = [];
  try {
    const result = await fetchSiteHours(config({ baseUrl: mock.baseUrl, credential: USER_TOKEN }), {
      now: AT,
      fetchImpl: (url, init) => {
        calls.push({ url: String(url), init });
        return fetch(url, init);
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(calls.length, 1, '有令牌就不该再登录一次');
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/api/v1/usage/dashboard/trend');
    assert.equal(url.searchParams.get('granularity'), 'hour');
    assert.equal(url.searchParams.get('timezone'), TZ);
    assert.equal(url.searchParams.get('start_date'), '2026-10-02');
    assert.equal(url.searchParams.get('end_date'), '2026-10-02');
    assert.equal(calls[0].init.headers.authorization, `Bearer ${USER_TOKEN}`);
    assert.equal(result.window.sampledHours, 2, '09:00 与 11:00');
    const nine = result.window.buckets.find((bucket) => bucket.hour === '2026-10-02T09:00');
    assert.equal(nine.cost, 0.75);
    assert.equal(nine.tokens, 700);
  } finally {
    await mock.close();
  }
});

test('email and password log in first, then call the trend endpoint', async () => {
  const mock = await startMockSub2Api();
  const calls = [];
  try {
    const result = await fetchSiteHours(config({ baseUrl: mock.baseUrl, email: EMAIL, password: PASSWORD }), {
      now: AT,
      fetchImpl: (url, init) => {
        calls.push({ url: String(url), init });
        return fetch(url, init);
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ['/api/v1/auth/login', '/api/v1/usage/dashboard/trend']);
    assert.equal(JSON.parse(calls[0].init.body).email, EMAIL);
    assert.equal(calls[1].init.headers.authorization, `Bearer ${USER_TOKEN}`, '登录拿到的 access_token 用在第二个请求上');
  } finally {
    await mock.close();
  }
});

test('failures fall back instead of inventing hours', async () => {
  const mock = await startMockSub2Api();
  try {
    const siteKey = await fetchSiteHours(config({ baseUrl: mock.baseUrl, credential: SITE_KEY }), { now: AT });
    assert.equal(siteKey.ok, false);
    assert.equal(siteKey.error.code, 'auth');
    assert.match(siteKey.error.message, /站点拒绝了登录令牌/);
    assert.match(siteKey.error.hint, /auth_token/);

    const noCredential = await fetchSiteHours(config({ baseUrl: mock.baseUrl }), { now: AT });
    assert.equal(noCredential.ok, false);
    assert.equal(noCredential.error.code, 'config');

    const badLogin = await fetchSiteHours(config({ baseUrl: mock.baseUrl, email: EMAIL, password: 'wrong' }), { now: AT });
    assert.equal(badLogin.ok, false);
    assert.equal(badLogin.error.code, 'auth');

    const offSite = await fetchSiteHours(config({ baseUrl: 'http://127.0.0.1:9', credential: USER_TOKEN }), { now: AT, timeoutMs: 800 });
    assert.equal(offSite.ok, false);
    assert.match(offSite.error.code, /network|timeout/);
    assert.match(offSite.error.hint, /本机采样/);
  } finally {
    await mock.close();
  }
});

test('the screenshot fixture is a sane day of hours', () => {
  // MOCK_RICH_HOURS=1 feeds the README screenshots; a broken fixture would ship a
  // broken-looking chart, so it is pinned here like any other test data.
  const at = new Date(2026, 9, 2, 21, 30); // local time, the way the mock reads it
  const rows = richHourTrend(at);
  assert.equal(rows.length, 13);
  assert.equal(rows[rows.length - 1].date, '2026-10-02 21:00', '最新一行是当前小时');
  assert.equal(rows[0].date, '2026-10-02 09:00');
  for (const row of rows) {
    assert.match(row.date, /^\d{4}-\d{2}-\d{2} \d{2}:00$/);
    assert.ok(row.cost > 0 && row.cost < 1, `花费要像真数据：${row.cost}`);
    assert.ok(row.requests > 0 && row.total_tokens > 0);
    assert.ok(row.actual_cost > row.cost, '实际扣费高于标准花费，和后端一致');
  }
  const window = windowFromTrend(rows, { timezone: TZ, now: at, hours: 24 });
  assert.equal(window.sampledHours, 13, '13 行都落在 24 小时窗口内');
  assert.equal(window.unparsed, 0);
});

test('a response without a trend array is reported as a shape problem', async () => {
  const result = await fetchSiteHours(config({ baseUrl: 'https://example.test', credential: USER_TOKEN }), {
    now: AT,
    fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: { points: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'shape');
  assert.match(result.error.message, /trend/);
});

test('a non-zero envelope code is an error, not an empty chart', async () => {
  const result = await fetchSiteHours(config({ baseUrl: 'https://example.test', credential: USER_TOKEN }), {
    now: AT,
    fetchImpl: async () => new Response(JSON.stringify({ code: 401, message: 'Invalid token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'auth');
});

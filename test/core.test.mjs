/** Unit tests for the pure layer: config, pointers, plan building, summary. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_CONFIG,
  QueryError,
  buildPlan,
  detectMode,
  maskSecret,
  normalizeConfig,
  pointerGet,
  publicConfig,
  resolveRange,
  summarize,
  trimBase,
  unwrapEnvelope,
  validateBaseUrl,
} from '../lib/core.js';

const NOW = new Date('2026-10-01T12:00:00+08:00');

test('trimBase / validateBaseUrl accept http(s) and reject everything else', () => {
  assert.equal(trimBase('https://a.example.com///'), 'https://a.example.com');
  assert.equal(validateBaseUrl('https://a.example.com/').ok, true);
  assert.equal(validateBaseUrl('http://127.0.0.1:8080').ok, true);
  assert.equal(validateBaseUrl('').ok, false);
  assert.equal(validateBaseUrl('a.example.com').ok, false);
  assert.equal(validateBaseUrl('ftp://a.example.com').ok, false);
  assert.equal(validateBaseUrl('https://user:pass@a.example.com').ok, false);
});

test('normalizeConfig fills defaults and clamps hostile input', () => {
  const cfg = normalizeConfig({ intervalSec: -5, pageSize: 9999, mode: 'NOPE', paths: { usage: 'v1/usage' } });
  assert.equal(cfg.intervalSec, 0);
  assert.equal(cfg.pageSize, 200);
  assert.equal(cfg.mode, DEFAULT_CONFIG.mode);
  assert.equal(cfg.paths.usage, '/v1/usage');
  assert.equal(cfg.baseUrl, DEFAULT_CONFIG.baseUrl);
});

test('maskSecret never leaks the middle of a credential', () => {
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret('short'), '•••••');
  assert.equal(maskSecret('admin-' + 'a'.repeat(64)), 'admi…aaaa');
});

test('publicConfig strips secrets but keeps a hint and the detected mode', () => {
  const pub = publicConfig({ credential: 'sk-abcdefghijklmnop', password: 'pw' });
  assert.equal(pub.credential, '');
  assert.equal(pub.password, '');
  assert.equal(pub.hasCredential, true);
  assert.equal(pub.hasPassword, true);
  assert.equal(pub.credentialHint, 'sk-a…mnop');
  assert.equal(pub.detectedMode, 'key');
});

test('detectMode reads the credential shape, then falls back to账号', () => {
  assert.equal(detectMode({ mode: 'auto', credential: 'admin-x' }), 'admin');
  assert.equal(detectMode({ mode: 'auto', credential: 'sk-x' }), 'key');
  assert.equal(detectMode({ mode: 'auto', credential: 'eyJhbGciOi.abc' }), 'user');
  assert.equal(detectMode({ mode: 'auto', email: 'a@b.c', password: 'p' }), 'user');
  assert.equal(detectMode({ mode: 'auto' }), 'none');
  assert.equal(detectMode({ mode: 'custom', credential: 'sk-x' }), 'custom');
});

test('pointerGet understands JSON pointers, dotted paths and array indexes', () => {
  const root = { data: { quota: { remaining: 3 }, items: [{ balance: 9 }] } };
  assert.equal(pointerGet(root, '/data/quota/remaining'), 3);
  assert.equal(pointerGet(root, 'data.quota.remaining'), 3);
  assert.equal(pointerGet(root, '/data/items[0]/balance'), 9);
  assert.equal(pointerGet(root, '/nope/deep'), undefined);
  assert.equal(pointerGet(root, ''), undefined);
});

test('unwrapEnvelope passes bare payloads through and raises envelope errors', () => {
  assert.deepEqual(unwrapEnvelope({ balance: 1 }), { balance: 1 });
  assert.deepEqual(unwrapEnvelope({ code: 0, message: 'success', data: { balance: 2 } }), { balance: 2 });
  assert.throws(() => unwrapEnvelope({ code: 401, message: 'Invalid token' }), (error) => {
    assert.ok(error instanceof QueryError);
    assert.equal(error.code, 'envelope');
    assert.match(error.hint, /凭证无效/);
    return true;
  });
});

test('resolveRange produces an inclusive YYYY-MM-DD window', () => {
  const range = resolveRange(normalizeConfig({ rangeDays: 7 }), {}, NOW);
  assert.equal(range.end, '2026-10-01');
  assert.equal(range.start, '2026-09-25');
  assert.deepEqual(resolveRange(normalizeConfig({}), { start: '2026-01-01', end: '2026-01-31' }, NOW), { start: '2026-01-01', end: '2026-01-31' });
});

test('buildPlan: key mode hits /v1/usage with range params and a Bearer header', () => {
  const plan = buildPlan({ mode: 'key', credential: 'sk-abc', baseUrl: 'https://a.example.com/' }, {}, NOW);
  assert.equal(plan.mode, 'key');
  assert.equal(plan.steps.length, 1);
  const step = plan.steps[0];
  assert.equal(step.method, 'GET');
  assert.match(step.url, /^https:\/\/a\.example\.com\/v1\/usage\?/);
  assert.match(step.url, /start_date=2026-09-02/);
  assert.match(step.url, /end_date=2026-10-01/);
  assert.match(step.url, /timezone=Asia%2FShanghai/);
  assert.equal(step.headers.Authorization, 'Bearer sk-abc');
});

test('buildPlan: admin mode switches between x-api-key and Bearer, and between one user and a list', () => {
  const one = buildPlan({ mode: 'admin', credential: 'admin-k', adminUserId: '123' }, {}, NOW);
  assert.equal(one.steps[0].url, 'https://aiapi.aaming.icu/api/v1/admin/users/123');
  assert.equal(one.steps[0].headers['x-api-key'], 'admin-k');

  const jwt = buildPlan({ mode: 'admin', credential: 'eyJhbGciOi.payload', adminUserId: '123' }, {}, NOW);
  assert.equal(jwt.steps[0].headers.Authorization, 'Bearer eyJhbGciOi.payload');
  assert.equal(jwt.steps[0].headers['x-api-key'], undefined);

  const list = buildPlan({ mode: 'admin', credential: 'admin-k', search: 'alice', sortBy: 'balance', sortOrder: 'asc' }, {}, NOW);
  assert.match(list.steps[0].url, /\/api\/v1\/admin\/users\?/);
  assert.match(list.steps[0].url, /search=alice/);
  assert.match(list.steps[0].url, /sort_by=balance/);
  assert.match(list.steps[0].url, /sort_order=asc/);
});

test('buildPlan: user mode chains login → me', () => {
  const plan = buildPlan({ mode: 'user', email: 'a@b.c', password: 'pw' }, {}, NOW);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].url, 'https://aiapi.aaming.icu/api/v1/auth/login');
  assert.deepEqual(JSON.parse(plan.steps[0].body), { email: 'a@b.c', password: 'pw' });
  assert.equal(plan.steps[1].useTokenFrom, 'login');
});

test('buildPlan: custom mode fills placeholders and parses JSON headers', () => {
  const plan = buildPlan(
    {
      mode: 'custom',
      baseUrl: 'https://x.example.com',
      adminUserId: '123',
      custom: {
        method: 'post',
        path: '/api/usage?from={start}&to={end}&tz={timezone}',
        headers: '{"x-token":"custom-token"}',
        body: '{"user":{id}}',
      },
    },
    {},
    NOW,
  );
  assert.equal(plan.steps[0].method, 'POST');
  assert.match(plan.steps[0].url, /from=2026-09-02&to=2026-10-01&tz=Asia%2FShanghai/);
  assert.equal(plan.steps[0].headers['x-token'], 'custom-token');
  assert.equal(plan.steps[0].headers['content-type'], 'application/json');
  assert.equal(plan.steps[0].body, '{"user":123}');
});

test('buildPlan leaves an unset placeholder verbatim so it fails visibly', () => {
  const plan = buildPlan({ mode: 'custom', custom: { path: '/x?u={id}' } }, {}, NOW);
  assert.match(plan.steps[0].url, /u=\{id\}$/);
});

test('buildPlan rejects malformed custom headers and missing credentials with hints', () => {
  assert.throws(() => buildPlan({ mode: 'custom', custom: { headers: '[]' } }, {}, NOW), /自定义请求头/);
  const error = (() => { try { buildPlan({ mode: 'key' }, {}, NOW); } catch (caught) { return caught; } })();
  assert.equal(error.code, 'config');
  assert.match(error.hint, /sk-/);
});

test('summarize extracts the documented /v1/usage shape', () => {
  const config = normalizeConfig({ mode: 'key', credential: 'sk-abcdefghijklmnop' });
  const snapshot = summarize({
    config,
    plan: { mode: 'key', range: { start: '2026-09-01', end: '2026-10-01' } },
    steps: [
      {
        id: 'usage',
        label: 'Key 用量',
        url: 'https://x/v1/usage',
        status: 200,
        json: {
          code: 0,
          message: 'success',
          data: {
            balance: 12.34,
            mode: 'quota_limited',
            quota: { used: 3.66, limit: 16, remaining: 12.34 },
            subscription: { daily_usage_usd: 0.42, daily_limit_usd: 5, weekly_usage_usd: 2.1, weekly_limit_usd: 20 },
            rate_limits: [{ window: '1m', used: 3, limit: 60, remaining: 57 }],
            total: { requests: 4210, tokens: 1234567 },
            model_stats: [{ model: 'a', requests: 2, cost_usd: 1 }],
            daily_usage: [
              {
                date: '2026-09-30',
                cost_usd: 0.5,
                actual_cost: 0.4,
                requests: 128,
                total_tokens: 55996144,
              },
            ],
          },
        },
      },
    ],
    latencyMs: 12,
    at: NOW,
  });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.headline.balance, 12.34);
  assert.equal(snapshot.headline.used, 3.66);
  assert.equal(snapshot.headline.limit, 16);
  assert.deepEqual(snapshot.subscription.daily, { used: 0.42, limit: 5 });
  assert.equal(snapshot.rateLimits[0].label, '1m');
  assert.equal(snapshot.totals.length, 2);
  assert.equal(snapshot.models[0].name, 'a');
  assert.equal(snapshot.daily[0].date, '2026-09-30');
  // The trend chart switches metrics from these, so they must survive normalize.
  assert.equal(snapshot.daily[0].requests, 128);
  assert.equal(snapshot.daily[0].tokens, 55996144);
  assert.equal(snapshot.daily[0].actual, 0.4);
  assert.equal(snapshot.fields.length > 0, true);
  assert.equal(snapshot.warnings.length, 0);
});

test('daily usage given as an object of days keeps requests and tokens', () => {
  const snapshot = summarize({
    config: normalizeConfig({ mode: 'key', credential: 'sk-abcdefghijklmnop' }),
    plan: { mode: 'key' },
    steps: [
      {
        id: 'usage',
        label: 'Key 用量',
        url: 'https://x/v1/usage',
        status: 200,
        json: {
          code: 0,
          data: {
            daily_usage: {
              '2026-09-29': { cost_usd: 0.25, requests: 12, total_tokens: 3400 },
              '2026-09-30': 0.5,
            },
          },
        },
      },
    ],
    at: NOW,
  });
  assert.deepEqual(snapshot.daily.map((day) => day.date), ['2026-09-29', '2026-09-30']);
  assert.equal(snapshot.daily[0].value, 0.25);
  assert.equal(snapshot.daily[0].requests, 12);
  assert.equal(snapshot.daily[0].tokens, 3400);
  // A bare number per day still normalizes; the extra metrics stay undefined.
  assert.equal(snapshot.daily[1].value, 0.5);
  assert.equal(snapshot.daily[1].requests, undefined);
});

test('summarize honours an explicit custom balance pointer over auto-detection', () => {
  const snapshot = summarize({
    config: normalizeConfig({ mode: 'custom', pointers: { balance: '/result/wallet/amount' } }),
    plan: { mode: 'custom' },
    steps: [{ id: 'custom', label: '自定义', url: 'https://x', status: 200, json: { balance: 999, result: { wallet: { amount: 88.8 } } } }],
    at: NOW,
  });
  assert.equal(snapshot.headline.balance, 88.8);
  assert.equal(snapshot.headline.balancePointer, '/result/wallet/amount');
});

test('summarize keeps going when a step failed and records a warning', () => {
  const snapshot = summarize({
    config: normalizeConfig({ mode: 'key', credential: 'sk-x' }),
    plan: { mode: 'key' },
    steps: [{ id: 'usage', label: 'Key 用量', url: 'https://x', error: 'HTTP 500' }],
    at: NOW,
  });
  assert.equal(snapshot.ok, false);
  assert.match(snapshot.warnings[0], /HTTP 500/);
  assert.equal(snapshot.headline.balance, undefined);
});

test('summarize handles the bare (unwrapped) admin payload and user lists', () => {
  const snapshot = summarize({
    config: normalizeConfig({ mode: 'admin', credential: 'admin-x' }),
    plan: { mode: 'admin' },
    steps: [
      {
        id: 'admin-users',
        label: '列表',
        url: 'https://x',
        status: 200,
        json: { code: 0, data: { items: [{ id: 1, email: 'a@b.c', balance: 5, frozen_balance: 0, total_recharged: 10 }], total: 1, page: 1 } },
      },
    ],
    at: NOW,
  });
  assert.equal(snapshot.users.length, 1);
  assert.equal(snapshot.users[0].balance, 5);
});

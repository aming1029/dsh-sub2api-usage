/** End-to-end tests: plan → real HTTP → snapshot, against a local mock site. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { ADMIN_KEY, EMAIL, PASSWORD, SITE_KEY, startMockSub2Api } from './mock-sub2api.mjs';
import { classifyError } from '../lib/query.js';
import { runQuery } from '../lib/query.js';

const NOW = new Date('2026-10-01T12:00:00+08:00');
let mock;

before(async () => {
  mock = await startMockSub2Api();
});
after(async () => {
  await mock.close();
});

const base = (extra) => ({ baseUrl: mock.baseUrl, timeoutMs: 4000, ...extra });

test('key mode: /v1/usage becomes a full snapshot', async () => {
  const snapshot = await runQuery(base({ mode: 'key', credential: SITE_KEY }), { now: NOW });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.mode, 'key');
  assert.equal(snapshot.headline.balance, 12.34);
  assert.equal(snapshot.headline.used, 3.66);
  assert.equal(snapshot.headline.limit, 16);
  assert.equal(snapshot.headline.quotaMode, 'quota_limited');
  assert.deepEqual(snapshot.subscription.daily, { used: 0.42, limit: 5 });
  assert.deepEqual(snapshot.subscription.weekly, { used: 2.1, limit: 20 });
  assert.equal(snapshot.rateLimits.length, 2);
  assert.equal(snapshot.rateLimits[0].label, '1m');
  assert.equal(snapshot.models.length, 2);
  assert.equal(snapshot.daily.length, 14);
  assert.equal(snapshot.daily[13].date, '2026-10-01');
  assert.equal(snapshot.range.start, '2026-09-02');
  assert.equal(snapshot.raw[0].status, 200);
  assert.equal(snapshot.warnings.length, 0);
});

test('admin mode: one user by id, with x-api-key', async () => {
  const snapshot = await runQuery(base({ mode: 'admin', credential: ADMIN_KEY, adminUserId: '123' }), { now: NOW });
  assert.equal(snapshot.headline.balance, 42.5);
  assert.equal(snapshot.headline.frozen, 1.25);
  assert.equal(snapshot.headline.recharged, 300);
  assert.equal(snapshot.user.email, 'alice@example.com');
  assert.equal(snapshot.user.id, 123);
});

test('admin mode: listUsers returns the user table', async () => {
  const snapshot = await runQuery(base({ mode: 'admin', credential: ADMIN_KEY, listUsers: true, search: 'example.com' }), { now: NOW });
  assert.equal(snapshot.users.length, 2);
  assert.equal(snapshot.users[0].email, 'alice@example.com');
  assert.equal(snapshot.users[1].balance, 3.75);
});

test('user mode: login then /auth/me (the token must be chained)', async () => {
  const snapshot = await runQuery(base({ mode: 'user', email: EMAIL, password: PASSWORD }), { now: NOW });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.headline.balance, 42.5);
  assert.equal(snapshot.raw.length, 2);
  assert.equal(snapshot.raw[0].id, 'login');
  assert.equal(snapshot.raw[1].id, 'me');
});

test('custom mode: arbitrary path, headers and JSON pointer', async () => {
  const snapshot = await runQuery(
    base({
      mode: 'custom',
      custom: { method: 'GET', path: '/custom/credits', headers: '{"x-token":"custom-token"}', body: '' },
      pointers: { balance: '/result/wallet/amount', used: '/result/spent', limit: '/result/cap' },
    }),
    { now: NOW },
  );
  assert.equal(snapshot.headline.balance, 88.8);
  assert.equal(snapshot.headline.balancePointer, '/result/wallet/amount');
  assert.equal(snapshot.headline.used, 11.2);
  assert.equal(snapshot.headline.limit, 100);
  assert.equal(snapshot.mode, 'custom');
});

test('auto mode picks the mode from the credential shape', async () => {
  const asKey = await runQuery(base({ mode: 'auto', credential: SITE_KEY }), { now: NOW });
  assert.equal(asKey.mode, 'key');
  assert.equal(asKey.headline.balance, 12.34);
  const asAdmin = await runQuery(base({ mode: 'auto', credential: ADMIN_KEY, adminUserId: '456' }), { now: NOW });
  assert.equal(asAdmin.mode, 'admin');
  assert.equal(asAdmin.headline.balance, 3.75);
});

test('a wrong admin key surfaces the site message plus a fix hint', async () => {
  await assert.rejects(
    () => runQuery(base({ mode: 'admin', credential: 'admin-' + 'b'.repeat(64), adminUserId: '123' }), { now: NOW }),
    (error) => {
      assert.equal(error.code, 'envelope');
      assert.match(error.message, /Invalid admin API key/);
      assert.match(error.hint, /认证失败|凭证/);
      assert.equal(error.status, 401);
      return true;
    },
  );
});

test('a wrong site key surfaces INVALID_API_KEY', async () => {
  await assert.rejects(
    () => runQuery(base({ mode: 'key', credential: 'sk-wrong' }), { now: NOW }),
    (error) => {
      assert.equal(error.code, 'envelope');
      assert.match(error.message, /Invalid API key/);
      return true;
    },
  );
});

test('a missing admin user is a notfound with a path hint', async () => {
  await assert.rejects(
    () => runQuery(base({ mode: 'admin', credential: ADMIN_KEY, adminUserId: '999' }), { now: NOW }),
    (error) => {
      assert.equal(error.code, 'notfound');
      assert.match(error.message, /user not found/i);
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test('a non-JSON response is a parse failure, not a crash', async () => {
  await assert.rejects(
    () => runQuery(base({ mode: 'custom', custom: { method: 'GET', path: '/not-json' } }), { now: NOW }),
    (error) => {
      assert.equal(error.code, 'parse');
      assert.match(error.message, /不是 JSON/);
      return true;
    },
  );
});

test('a slow endpoint times out with the configured budget', async () => {
  await assert.rejects(
    () => runQuery(base({ mode: 'custom', custom: { method: 'GET', path: '/slow' }, timeoutMs: 700 }), { now: NOW }),
    (error) => {
      assert.equal(error.code, 'timeout');
      assert.match(error.hint, /超时/);
      return true;
    },
  );
});

test('an unreachable host is a network failure with a hint', async () => {
  await assert.rejects(
    () => runQuery({ mode: 'custom', baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000, custom: { method: 'GET', path: '/x' } }, { now: NOW }),
    (error) => {
      assert.equal(error.code, 'network');
      assert.match(error.hint, /服务地址|端口|防火墙/);
      return true;
    },
  );
});

test('classifyError maps unknown failures to a network code', () => {
  assert.equal(classifyError(new Error('boom'), 'http://x').code, 'network');
  assert.equal(classifyError(Object.assign(new Error('x'), { name: 'TimeoutError' }), 'http://x').code, 'timeout');
});

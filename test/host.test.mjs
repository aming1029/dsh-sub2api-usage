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

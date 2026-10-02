/**
 * ConfigStore regression tests. The concurrency case is the one that produced a
 * rare, real failure: `apply()` starts a background load, and a save landing
 * while that load is still in flight used to be overwritten in memory by the
 * late-resolving load (the credential file was correct, but every later query
 * ran without a credential until restart).
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { ConfigStore, resolveDataDir } from '../lib/store.js';

const dirs = [];
async function makeDir() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sub2api-store-'));
  dirs.push(dir);
  return dir;
}
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

test('resolveDataDir prefers DSH_SUB2API_DIR, then DSH_HOME, then ~/.dsh', () => {
  assert.equal(resolveDataDir({ DSH_SUB2API_DIR: ' X ', DSH_HOME: 'Y' }), 'X');
  assert.equal(resolveDataDir({ DSH_HOME: 'Y' }), 'Y');
  assert.ok(resolveDataDir({}).length > 0);
});

test('a fresh store starts from defaults and an empty credential', async () => {
  const store = new ConfigStore(await makeDir());
  await store.load();
  assert.equal(store.full().baseUrl, 'https://aiapi.aaming.icu');
  assert.equal(store.full().mode, 'auto');
  assert.equal(store.full().credential, '');
});

test('a save writes the plain config and the secret file separately', async () => {
  const dir = await makeDir();
  const store = new ConfigStore(dir);
  await store.update({ baseUrl: 'https://example.com/', mode: 'key', credential: 'sk-abcdefghijkl' });
  const safe = JSON.parse(await readFile(join(dir, 'sub2api-usage.json'), 'utf8'));
  const secrets = JSON.parse(await readFile(join(dir, 'sub2api-usage.secrets.json'), 'utf8'));
  assert.equal(safe.baseUrl, 'https://example.com');
  assert.equal(safe.credential, undefined);
  assert.equal(JSON.stringify(safe).includes('sk-abcdefghijkl'), false);
  assert.equal(secrets.credential, 'sk-abcdefghijkl');
});

test('credential tri-state: absent keeps, empty clears, string replaces', async () => {
  const store = new ConfigStore(await makeDir());
  await store.update({ credential: 'sk-keepme' });
  await store.update({ mode: 'key' });
  assert.equal(store.full().credential, 'sk-keepme');
  assert.equal(store.full().mode, 'key');
  await store.update({ credential: '' });
  assert.equal(store.full().credential, '');
});

test('concurrent callers share one load (single-flight)', async () => {
  const dir = await makeDir();
  let reads = 0;
  const store = new ConfigStore(dir, { onRead: () => { reads += 1; } });
  await Promise.all([store.load(), store.load(), store.update({ credential: 'sk-once' })]);
  assert.equal(reads, 1, 'the files must be read exactly once');
  assert.equal(store.full().credential, 'sk-once');
});

test('a load started before a save cannot clobber that save', async () => {
  const dir = await makeDir();
  const store = new ConfigStore(dir);
  const background = store.load(); // what apply() fires and forgets
  await store.update({ credential: 'sk-survives', mode: 'admin' });
  await background;
  assert.equal(store.full().credential, 'sk-survives');
  assert.equal(store.full().mode, 'admin');
  const secrets = JSON.parse(await readFile(join(dir, 'sub2api-usage.secrets.json'), 'utf8'));
  assert.equal(secrets.credential, 'sk-survives');
});

test('saves are serialized, so the last patch wins without losing the first', async () => {
  const store = new ConfigStore(await makeDir());
  const [first, second] = await Promise.all([
    store.update({ baseUrl: 'https://one.example.com', credential: 'sk-one' }),
    store.update({ mode: 'admin', intervalSec: 42 }),
  ]);
  assert.equal(first.baseUrl, 'https://one.example.com');
  assert.equal(second.mode, 'admin');
  assert.equal(store.full().baseUrl, 'https://one.example.com');
  assert.equal(store.full().mode, 'admin');
  assert.equal(store.full().intervalSec, 42);
  assert.equal(store.full().credential, 'sk-one');
});

test('an existing config file is loaded and normalized', async () => {
  const dir = await makeDir();
  await writeFile(join(dir, 'sub2api-usage.json'), JSON.stringify({ baseUrl: 'https://x.example.com/', intervalSec: -3, mode: 'nonsense' }));
  await writeFile(join(dir, 'sub2api-usage.secrets.json'), JSON.stringify({ credential: 'admin-abc', password: 'pw' }));
  const store = new ConfigStore(dir);
  await store.load();
  assert.equal(store.full().baseUrl, 'https://x.example.com');
  assert.equal(store.full().intervalSec, 0);
  assert.equal(store.full().mode, 'auto');
  assert.equal(store.full().credential, 'admin-abc');
  assert.equal(store.full().password, 'pw');
});

test('a corrupt config file surfaces a readable error instead of crashing later', async () => {
  const dir = await makeDir();
  await writeFile(join(dir, 'sub2api-usage.json'), '{not json');
  const store = new ConfigStore(dir);
  await assert.rejects(() => store.load(), /读取 .* 失败/);
});

test('a form save keeps the path and pointer keys the form does not render', async () => {
  const dir = await makeDir();
  await writeFile(join(dir, 'sub2api-usage.json'), JSON.stringify({
    paths: { usage: '/v1/usage', trend: '/api/v1/usage/dashboard/trend', login: '/auth/login-v2' },
    pointers: { balance: 'payload.wallet.balance' },
  }));
  const store = new ConfigStore(dir);
  await store.load();
  // Exactly what the settings form submits: the four path fields it renders and
  // none of the advanced ones.
  await store.update({ baseUrl: 'https://x.example.com', paths: { usage: '/v1/usage', me: '/api/v1/auth/me', adminUser: '/api/v1/admin/users/{id}', adminUsers: '/api/v1/admin/users' } });
  assert.equal(store.full().paths.trend, '/api/v1/usage/dashboard/trend', 'paths.trend 不会被表单保存抹掉');
  assert.equal(store.full().paths.login, '/auth/login-v2');
  assert.equal(store.full().pointers.balance, 'payload.wallet.balance');
  assert.equal(store.full().baseUrl, 'https://x.example.com');
  // …and the merged result is what lands on disk, not just what is in memory.
  const onDisk = JSON.parse(await readFile(join(dir, 'sub2api-usage.json'), 'utf8'));
  assert.equal(onDisk.paths.trend, '/api/v1/usage/dashboard/trend');
});

test('paths() reports both files for the settings page', async () => {
  const dir = await makeDir();
  const store = new ConfigStore(dir);
  assert.deepEqual(store.paths(), { config: join(dir, 'sub2api-usage.json'), secrets: join(dir, 'sub2api-usage.secrets.json') });
});

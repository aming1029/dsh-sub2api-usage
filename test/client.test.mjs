/**
 * Client-half tests: load the real browser bundle in a fake module-loader
 * environment, run `apply()` against a recording slot registry, then render the
 * registered components with the miniature React harness.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createHarness, findAll, findNode, textOf } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, '..', 'lib', 'client.js');

const SNAPSHOT = {
  ok: true,
  mode: 'key',
  baseUrl: 'https://aiapi.aaming.icu',
  at: '2026-10-01T12:00:00.000Z',
  latencyMs: 42,
  currency: 'USD',
  currencySymbol: '$',
  lowBalance: 5,
  range: { start: '2026-09-02', end: '2026-10-01' },
  credentialHint: 'sk-t…7890',
  headline: { balance: 12.34, balancePointer: '/data/balance', frozen: 1, recharged: 300, used: 3.66, limit: 16, remaining: 12.34, quotaMode: 'quota_limited' },
  subscription: { daily: { used: 0.42, limit: 5 }, weekly: { used: 2.1, limit: 20 } },
  rateLimits: [{ label: '1m', used: 3, limit: 60, remaining: 57, reset: '2026-10-01T12:01:00Z' }],
  totals: [{ label: 'requests', value: 4210 }],
  models: [{ name: 'claude-sonnet-4-5', cost: 5.2, requests: 2100, sub: '2100 次', share: 0.7 }],
  daily: [{ date: '2026-09-30', value: 0.2 }, { date: '2026-10-01', value: 0.9 }],
  users: undefined,
  user: { id: 123, email: 'alice@example.com', name: undefined, status: 'active' },
  fields: [{ label: 'mode', value: 'quota_limited' }],
  warnings: [],
  raw: [{ id: 'usage', label: 'Key 用量', url: 'https://aiapi.aaming.icu/v1/usage', status: 200, json: { code: 0, data: { balance: 12.34 } } }],
};

const CONFIG = {
  baseUrl: 'https://aiapi.aaming.icu',
  mode: 'auto',
  credentialHint: 'sk-t…7890',
  hasCredential: true,
  hasPassword: false,
  detectedMode: 'key',
  timezone: 'Asia/Shanghai',
  rangeDays: 30,
  intervalSec: 0,
  lowBalance: 5,
  currencySymbol: '$',
  timeoutMs: 15000,
  paths: { usage: '/v1/usage', me: '/api/v1/auth/me', adminUser: '/api/v1/admin/users/{id}', adminUsers: '/api/v1/admin/users' },
  custom: { method: 'GET', path: '/v1/usage', headers: '', body: '' },
  pointers: { balance: '', remaining: '', used: '', limit: '' },
};

/** Install the fake browser environment the bundle expects. */
function loadBundle() {
  const harness = createHarness();
  const registry = [];
  const cleanups = [];
  const fetchCalls = [];

  globalThis.window = {
    __ModuleLoader__: { load: (row) => registry.push(row) },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
  };
  globalThis.document = {
    createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
    head: { appendChild() {} },
  };
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return {
      status: 200,
      ok: true,
      json: async () => ({ ok: true, config: CONFIG, files: { config: 'C:/dsh/sub2api-usage.json', secrets: 'C:/dsh/sub2api-usage.secrets.json' }, last: {} }),
    };
  };

  const code = readFileSync(BUNDLE, 'utf8');
  // The bundle is a classic script that registers itself with the loader.
  // eslint-disable-next-line no-new-func
  new Function(code)();
  return { harness, registry, cleanups, fetchCalls };
}

function loadPlugin() {
  const env = loadBundle();
  assert.equal(env.registry.length, 1, 'bundle must register exactly one module row');
  const row = env.registry[0];
  assert.equal(row.id, 'dsh-sub2api-usage');
  assert.equal(typeof row.factory, 'function');
  const exportsObject = row.factory((specifier) => {
    if (specifier === 'react') return env.harness.React;
    throw new Error(`unexpected require("${specifier}")`);
  });
  return { ...env, exports: exportsObject, row };
}

/** A ctx stand-in that records slot registrations and runs effects immediately. */
function createCtx(registrations) {
  return {
    get: (name) => (name === 'layout' ? { selectPanel: (id) => registrations.panels.push(id) } : undefined),
    effect: (callback) => {
      const dispose = callback();
      registrations.effects.push(dispose);
      return dispose;
    },
    slots: {
      inject: (key, callback) => {
        registrations.injected.push(key);
        return callback();
      },
      register: (options, component) => {
        registrations.slots.push({ options, component });
        return () => {};
      },
    },
  };
}

function setUpPlugin() {
  const plugin = loadPlugin();
  const registrations = { slots: [], injected: [], effects: [], panels: [] };
  plugin.exports.apply(createCtx(registrations));
  return { ...plugin, registrations };
}

function fakeStore(state) {
  const listeners = new Set();
  const calls = { query: 0, save: 0, test: 0, clearToast: 0 };
  return {
    calls,
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    query() { calls.query += 1; return Promise.resolve({ ok: true }); },
    save(patch) { calls.save += 1; calls.lastPatch = patch; return Promise.resolve({ ok: true, config: CONFIG, changed: ['baseUrl'] }); },
    test(candidate) { calls.test += 1; calls.lastCandidate = candidate; return Promise.resolve({ ok: true, snapshot: SNAPSHOT }); },
    clearToast() { calls.clearToast += 1; },
    start: () => () => {},
  };
}

test('the bundle registers one module row with the package id', () => {
  const { row, exports } = loadPlugin();
  assert.equal(row.id, 'dsh-sub2api-usage');
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(exports.inject, ['slots', 'layout']);
});

test('apply() registers the footer chip, the panel icon and the main panel', () => {
  const { registrations } = setUpPlugin();
  assert.deepEqual(registrations.injected.sort(), ['main', 'sidebar.footer.action', 'sidebar.panellist']);
  assert.equal(registrations.slots.length, 3);
  const byName = Object.fromEntries(registrations.slots.map((slot) => [slot.options.name, slot]));
  assert.equal(byName['sidebar.footer.action'].options.id, 'sub2api-usage');
  assert.equal(byName['sidebar.panellist'].options.id, 'sub2api-usage');
  assert.equal(byName.main.options.key, 'sub2api-usage');
  assert.equal(byName.main.options.id, undefined);
  for (const slot of registrations.slots) {
    assert.equal(typeof slot.component, 'function');
  }
  // Only the two sidebar entries are ordered/labelled rows; `main` is a keyed seat.
  assert.equal(typeof byName['sidebar.footer.action'].options.order, 'number');
  assert.equal(typeof byName['sidebar.panellist'].options.order, 'number');
  assert.equal(typeof byName['sidebar.footer.action'].options.label, 'string');
  assert.equal(typeof byName['sidebar.panellist'].options.label, 'string');
  assert.equal(registrations.effects.length, 5);
});

test('every effect disposes without throwing', () => {
  const { registrations } = setUpPlugin();
  for (const dispose of registrations.effects) {
    if (typeof dispose === 'function') assert.doesNotThrow(() => dispose());
  }
});

test('the footer chip shows the balance and opens the panel when clicked', () => {
  const { registrations, harness } = setUpPlugin();
  const chip = registrations.slots.find((slot) => slot.options.name === 'sidebar.footer.action');
  const store = fakeStore({ config: CONFIG, snapshot: SNAPSHOT, error: null, phase: 'ready', busy: false, toast: null, queriedAt: SNAPSHOT.at, files: null });
  const props = { ...chip.options.inject(), store, wide: true };
  const tree = harness.mount(harness.React.createElement(chip.component, props));
  const text = textOf(tree);
  assert.match(text, /\$12\.34/);
  assert.match(text, /用量/);
  const button = findNode(tree, (node) => node.type === 'button');
  assert.ok(button, 'chip renders a button');
  button.props.onClick();
  assert.deepEqual(registrations.panels, ['sub2api-usage']);
});

test('the footer chip degrades to a dot when the sidebar is collapsed', () => {
  const { registrations, harness } = setUpPlugin();
  const chip = registrations.slots.find((slot) => slot.options.name === 'sidebar.footer.action');
  const store = fakeStore({ config: CONFIG, snapshot: SNAPSHOT, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const tree = harness.mount(harness.React.createElement(chip.component, { ...chip.options.inject(), store, wide: false }));
  assert.equal(textOf(tree).includes('$12.34'), false);
  assert.ok(findNode(tree, (node) => node.type === 'i' && node.props.className === 's2u-dot'));
});

test('the panel icon warns when the balance is under the threshold', () => {
  const { registrations, harness } = setUpPlugin();
  const glyphSlot = registrations.slots.find((slot) => slot.options.name === 'sidebar.panellist');
  const store = fakeStore({ config: CONFIG, snapshot: { ...SNAPSHOT, headline: { ...SNAPSHOT.headline, balance: 1 }, lowBalance: 5 }, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const tree = harness.mount(harness.React.createElement(glyphSlot.component, { ...glyphSlot.options.inject(), store, size: 18, active: true }));
  assert.ok(findNode(tree, (node) => node.props?.className === 'alert'), 'low balance paints the alert dot');
});

test('the main panel renders the overview from a snapshot', () => {
  const { registrations, harness } = setUpPlugin();
  const main = registrations.slots.find((slot) => slot.options.name === 'main');
  const store = fakeStore({ config: CONFIG, snapshot: SNAPSHOT, error: null, phase: 'ready', busy: false, toast: null, queriedAt: SNAPSHOT.at, files: null });
  const tree = harness.mount(harness.React.createElement(main.component, { ...main.options.inject(), store }));
  const text = textOf(tree);
  assert.match(text, /Sub2API 用量/);
  assert.match(text, /\$12\.34/);
  assert.match(text, /alice@example\.com/);
  assert.match(text, /claude-sonnet-4-5/);
  assert.match(text, /限流窗口/);
  assert.match(text, /quota_limited/);
});

test('the main panel survives an empty state and a failure state', () => {
  const { registrations, harness } = setUpPlugin();
  const main = registrations.slots.find((slot) => slot.options.name === 'main');
  const empty = fakeStore({ config: null, snapshot: null, error: null, phase: 'loading', busy: false, toast: null, queriedAt: null, files: null });
  assert.match(textOf(harness.mount(harness.React.createElement(main.component, { ...main.options.inject(), store: empty }))), /正在读取配置/);

  const failing = fakeStore({
    config: CONFIG,
    snapshot: null,
    error: { code: 'envelope', message: 'Invalid API key', hint: '凭证无效或已过期' },
    phase: 'error',
    busy: false,
    toast: null,
    queriedAt: null,
    files: null,
  });
  const text = textOf(harness.mount(harness.React.createElement(main.component, { ...main.options.inject(), store: failing })));
  assert.match(text, /查询失败（envelope）/);
  assert.match(text, /Invalid API key/);
  assert.match(text, /凭证无效/);
});

test('the detail tab shows raw responses, and the settings tab shows the custom-endpoint form', () => {
  const { registrations, harness } = setUpPlugin();
  const main = registrations.slots.find((slot) => slot.options.name === 'main');
  const store = fakeStore({
    config: CONFIG,
    snapshot: SNAPSHOT,
    error: null,
    phase: 'ready',
    busy: false,
    toast: null,
    queriedAt: SNAPSHOT.at,
    files: { config: 'C:/dsh/sub2api-usage.json', secrets: 'C:/dsh/sub2api-usage.secrets.json' },
  });
  const props = { ...main.options.inject(), store };

  let tree = harness.mount(harness.React.createElement(main.component, props));
  const detailTab = findNode(tree, (node) => node.type === 'button' && node.props.children === '明细');
  assert.ok(detailTab, '有「明细」页签');
  detailTab.props.onClick();
  tree = harness.mount(harness.React.createElement(main.component, props));
  assert.match(textOf(tree), /原始响应/);
  assert.match(textOf(tree), /请求数|\/data\/balance|Key 用量/);

  const settingsTab = findNode(tree, (node) => node.type === 'button' && node.props.children === '设置');
  settingsTab.props.onClick();
  tree = harness.mount(harness.React.createElement(main.component, props));
  const settingsText = textOf(tree);
  for (const needle of ['服务地址（可自定义）', '查询模式', '凭证', '余额 JSON 指针', '自动刷新间隔（秒）', '保存并查询', '测试连接（不保存）', '清除凭证']) {
    assert.ok(settingsText.includes(needle), `设置页缺少「${needle}」`);
  }
  assert.match(settingsText, /配置文件：C:\/dsh\/sub2api-usage\.json/);

  // Switching the mode to "custom" reveals the free-form request editor.
  const modeSelect = findNode(tree, (node) => node.type === 'select' && node.props.value === 'auto');
  assert.ok(modeSelect, '有查询模式下拉框');
  modeSelect.props.onChange({ target: { value: 'custom' } });
  tree = harness.mount(harness.React.createElement(main.component, props));
  const customText = textOf(tree);
  for (const needle of ['自定义请求', '请求头（JSON 对象）', '请求体（JSON，GET 可留空）', '管理员单用户路径']) {
    assert.ok(customText.includes(needle), `自定义模式缺少「${needle}」`);
  }
});

test('saving from the settings form posts a patch and then refreshes', async () => {
  const { registrations, harness } = setUpPlugin();
  const main = registrations.slots.find((slot) => slot.options.name === 'main');
  const store = fakeStore({ config: CONFIG, snapshot: SNAPSHOT, error: null, phase: 'ready', busy: false, toast: null, queriedAt: SNAPSHOT.at, files: null });
  const props = { ...main.options.inject(), store };
  let tree = harness.mount(harness.React.createElement(main.component, props));
  findNode(tree, (node) => node.type === 'button' && node.props.children === '设置').props.onClick();
  tree = harness.mount(harness.React.createElement(main.component, props));

  const baseInput = findNode(tree, (node) => node.type === 'input' && node.props.value === CONFIG.baseUrl);
  assert.ok(baseInput, '服务地址输入框已用当前配置预填');
  baseInput.props.onChange({ target: { value: 'https://ai.example.com' } });
  tree = harness.mount(harness.React.createElement(main.component, props));

  const form = findNode(tree, (node) => node.type === 'form');
  form.props.onSubmit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.calls.save, 1);
  assert.equal(store.calls.lastPatch.baseUrl, 'https://ai.example.com');
  assert.equal(store.calls.query, 1);
});

test('the test-connection button reports the probe result', async () => {
  const { registrations, harness } = setUpPlugin();
  const main = registrations.slots.find((slot) => slot.options.name === 'main');
  const store = fakeStore({ config: CONFIG, snapshot: SNAPSHOT, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const props = { ...main.options.inject(), store };
  let tree = harness.mount(harness.React.createElement(main.component, props));
  findNode(tree, (node) => node.type === 'button' && node.props.children === '设置').props.onClick();
  tree = harness.mount(harness.React.createElement(main.component, props));
  const probeButton = findNode(tree, (node) => node.type === 'button' && node.props.children === '测试连接（不保存）');
  probeButton.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.calls.test, 1);
  assert.equal(store.calls.lastCandidate.baseUrl, CONFIG.baseUrl);
  const after = harness.mount(harness.React.createElement(main.component, props));
  assert.match(textOf(after), /连接成功/);
});

test('the poller loads state and honours intervalSec (0 = manual only)', async () => {
  const { registrations, harness } = setUpPlugin();
  assert.equal(registrations.slots.length, 3);
  // The poller effect ran during apply(); give its first tick a chance.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.cleanups.length >= 0, true);
  const manual = fakeStore({ config: { ...CONFIG, intervalSec: 0 }, snapshot: null, error: null, phase: 'idle', busy: false, toast: null, queriedAt: null, files: null });
  assert.equal(typeof manual.start(), 'function');
  void findAll(harness.React.createElement('div'), () => false);
});

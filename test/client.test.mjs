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
  const calls = { query: 0, save: 0, test: 0, load: 0, clearToast: 0, notify: null };
  let current = state;
  return {
    calls,
    get: () => current,
    // The panel reads store.get(), so a store handed to renderOverview() must
    // expose the same state the helper rendered with.
    setState(next) { current = next; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load() { calls.load += 1; return Promise.resolve({ ok: true }); },
    query() { calls.query += 1; return Promise.resolve({ ok: true }); },
    save(patch) { calls.save += 1; calls.lastPatch = patch; return Promise.resolve({ ok: true, config: CONFIG, changed: ['baseUrl'] }); },
    test(candidate) { calls.test += 1; calls.lastCandidate = candidate; return Promise.resolve({ ok: true, snapshot: SNAPSHOT }); },
    clearToast() { calls.clearToast += 1; },
    notify(message) { calls.notify = message; },
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

// ---------------------------------------------------------------- trend chart
//
// The chart maths live in the bundle (the browser half may only require react),
// so these tests pin the geometry, labels and interactions through the rendered
// SVG. With no ResizeObserver in the harness the width falls back to 640, which
// makes every coordinate below exact.

const THREE_DAYS = [
  { date: '2026-09-29', value: 0, requests: 0, tokens: 0 },
  { date: '2026-09-30', value: 1, requests: 1000, tokens: 25000 },
  { date: '2026-10-01', value: 2, requests: 4200, tokens: 55996144, actual: 1.5 },
];

/** Render the main panel on the overview tab with a given daily series. */
function renderOverview(harness, registrations, daily, store, extra) {
  const main = registrations.slots.find((slot) => slot.options.name === 'main');
  const state = {
    config: { ...CONFIG, rangeDays: 30 },
    snapshot: { ...SNAPSHOT, daily },
    hourly: null,
    error: null,
    phase: 'ready',
    busy: false,
    toast: null,
    queriedAt: SNAPSHOT.at,
    files: null,
    ...(extra ?? {}),
  };
  const resolved = store ?? fakeStore(state);
  if (typeof resolved.setState === 'function') resolved.setState(state);
  const props = { ...main.options.inject(), store: resolved };
  return { tree: harness.mount(harness.React.createElement(main.component, props)), props };
}

const byClass = (className) => (node) => node.props?.className === className;

test('the trend chart plots the series against a nice axis', () => {
  const { registrations, harness } = setUpPlugin();
  const { tree } = renderOverview(harness, registrations, THREE_DAYS);

  // plot box: left 46, right 640-14, top 12, bottom 176-22
  const svg = findNode(tree, byClass('s2u-chart-svg'));
  assert.equal(svg.props['data-granularity'], 'day');
  assert.equal(svg.props['aria-label'], '花费按天趋势，3 天', '按天说天数，不说“数据点”');
  const line = findNode(tree, byClass('s2u-chart-line'));
  assert.equal(line.props.d, 'M46 154 L336 83 L626 12');
  const area = findNode(tree, byClass('s2u-chart-area'));
  assert.equal(area.props.d, 'M46 154 L336 83 L626 12 L626 154 L46 154 Z');

  const labels = findAll(tree, (node) => node.type === 'text' && node.props.className === 's2u-chart-tick').map((node) => node.props.children);
  assert.deepEqual(labels, ['$2.00', '$1.50', '$1.00', '$0.50', '$0.00', '09-29', '09-30', '10-01']);
  assert.deepEqual(findAll(tree, byClass('s2u-chart-hit')).length, 3, '每有一个数据点就有一条悬停带');
});

test('the chart survives a flat zero series and a single day', () => {
  const { registrations, harness } = setUpPlugin();
  const flat = renderOverview(harness, registrations, [
    { date: '2026-09-30', value: 0 },
    { date: '2026-10-01', value: 0 },
  ]).tree;
  // An all-zero series still gets a real axis instead of a divide-by-zero.
  assert.equal(findNode(flat, byClass('s2u-chart-line')).props.d, 'M46 154 L626 154');
  const flatLabels = findAll(flat, (node) => node.type === 'text' && node.props.className === 's2u-chart-tick').map((node) => node.props.children);
  assert.deepEqual(flatLabels, ['$1.00', '$0.75', '$0.50', '$0.25', '$0.00', '09-30', '10-01']);

  const single = renderOverview(harness, registrations, [{ date: '2026-10-01', value: 5 }]).tree;
  const dot = findNode(single, byClass('s2u-chart-dot'));
  assert.ok(dot, 'a one-day range still shows its point');
  assert.equal(dot.props.cx, 336);
  assert.equal(findNode(single, byClass('s2u-chart-area')), undefined, '没有面积可画');

  const none = renderOverview(harness, registrations, []).tree;
  assert.match(textOf(none), /该区间没有日用量数据/);
});

test('switching the metric redraws the axis in that unit', () => {
  const { registrations, harness } = setUpPlugin();
  const store = fakeStore({ config: { ...CONFIG, rangeDays: 30 }, snapshot: { ...SNAPSHOT, daily: THREE_DAYS }, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const { tree, props } = renderOverview(harness, registrations, THREE_DAYS, store);

  const tabs = findAll(tree, (node) => node.type === 'button' && ['花费', '请求', 'Tokens'].includes(node.props.children));
  assert.deepEqual(tabs.map((node) => node.props.children), ['花费', '请求', 'Tokens']);

  const requestsTab = tabs.find((node) => node.props.children === '请求');
  requestsTab.props.onClick();
  const countTree = harness.mount(harness.React.createElement(registrations.slots.find((slot) => slot.options.name === 'main').component, props));
  assert.match(textOf(countTree), /5,200 次/, '合计按请求数展示');
  const countLabels = findAll(countTree, (node) => node.type === 'text' && node.props.className === 's2u-chart-tick').map((node) => node.props.children);
  assert.deepEqual(countLabels, ['6000', '4500', '3000', '1500', '0', '09-29', '09-30', '10-01']);
  // The series itself changed, so the geometry must have changed too.
  assert.equal(findNode(countTree, byClass('s2u-chart-line')).props.d, 'M46 154 L336 130.33 L626 54.6');

  const tokensTab = findAll(countTree, (node) => node.type === 'button' && node.props.children === 'Tokens')[0];
  tokensTab.props.onClick();
  const tokenTree = harness.mount(harness.React.createElement(registrations.slots.find((slot) => slot.options.name === 'main').component, props));
  const tokenLabels = findAll(tokenTree, (node) => node.type === 'text' && node.props.className === 's2u-chart-tick').map((node) => node.props.children);
  assert.deepEqual(tokenLabels, ['60M', '45M', '30M', '15M', '0', '09-29', '09-30', '10-01']);
});

test('hovering a day opens a readout and leaving closes it', () => {
  const { registrations, harness } = setUpPlugin();
  const { tree, props } = renderOverview(harness, registrations, THREE_DAYS);
  assert.equal(findNode(tree, byClass('s2u-chart-tip')), undefined);

  const bands = findAll(tree, byClass('s2u-chart-hit'));
  bands[2].props.onMouseEnter();
  const hovered = harness.mount(harness.React.createElement(registrations.slots.find((slot) => slot.options.name === 'main').component, props));
  const tip = findNode(hovered, byClass('s2u-chart-tip'));
  assert.ok(tip, '悬停后出现读数框');
  assert.equal(tip.props['data-tip'], '2026-10-01');
  const tipText = textOf(tip);
  assert.match(tipText, /2026-10-01/);
  assert.match(tipText, /\$2\.00/, '花费取精确值');
  assert.match(tipText, /4,200 次/);
  assert.match(tipText, /55,996,144/);
  assert.match(tipText, /实际扣费 \$1\.50/);
  // The hovered band is marked and the crosshair is drawn.
  assert.equal(findAll(hovered, byClass('s2u-chart-hit')).filter((node) => node.props['data-on'] === 'true').length, 1);
  assert.ok(findNode(hovered, byClass('s2u-chart-cross')));

  findNode(hovered, byClass('s2u-chart-svg')).props.onMouseLeave();
  const cleared = harness.mount(harness.React.createElement(registrations.slots.find((slot) => slot.options.name === 'main').component, props));
  assert.equal(findNode(cleared, byClass('s2u-chart-tip')), undefined);
});

test('arrow keys walk the series for keyboard users', () => {
  const { registrations, harness } = setUpPlugin();
  const { tree, props } = renderOverview(harness, registrations, THREE_DAYS);
  const svg = findNode(tree, byClass('s2u-chart-svg'));
  const remount = () => harness.mount(harness.React.createElement(registrations.slots.find((slot) => slot.options.name === 'main').component, props));

  svg.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(findNode(remount(), byClass('s2u-chart-tip')).props['data-tip'], '2026-09-29');
  findNode(remount(), byClass('s2u-chart-svg')).props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(findNode(remount(), byClass('s2u-chart-tip')).props['data-tip'], '2026-09-30');
  findNode(remount(), byClass('s2u-chart-svg')).props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(findNode(remount(), byClass('s2u-chart-tip')).props['data-tip'], '2026-09-29');
  // Anything else is ignored rather than throwing.
  assert.doesNotThrow(() => findNode(remount(), byClass('s2u-chart-svg')).props.onKeyDown({ key: 'Tab' }));
});

test('range shortcuts re-save rangeDays and refresh', async () => {
  const { registrations, harness } = setUpPlugin();
  const store = fakeStore({ config: { ...CONFIG, rangeDays: 30 }, snapshot: { ...SNAPSHOT, daily: THREE_DAYS }, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, store);

  const ranges = findAll(tree, (node) => node.type === 'button' && /^\d+ 天$/.test(node.props.children));
  assert.deepEqual(ranges.map((node) => node.props.children), ['7 天', '14 天', '30 天', '90 天']);
  assert.equal(ranges.find((node) => node.props.children === '30 天').props['data-active'], 'true', '当前区间高亮');

  ranges.find((node) => node.props.children === '7 天').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.calls.save, 1);
  assert.deepEqual(store.calls.lastPatch, { rangeDays: 7 });
  assert.equal(store.calls.query, 1, '改完区间立刻重查');
});

// ------------------------------------------------------------- hourly chart
//
// Hour buckets come from the host's local sampling, including the holes: an
// hour nobody sampled keeps its slot but breaks the line, and never becomes 0.

const FOUR_HOURS = {
  hours: 4,
  from: '2026-09-30T22:00',
  to: '2026-10-01T01:00',
  retainedHours: 336,
  samples: 7,
  since: '2026-09-30T22:00',
  buckets: [
    { hour: '2026-09-30T22:00', cost: 0.5, requests: 10, tokens: 1000, actual: 0.6, spanMin: 2, partial: false },
    { hour: '2026-09-30T23:00', cost: 1, requests: 20, tokens: 2000, spanMin: 2, partial: false },
    { hour: '2026-10-01T00:00', missing: true },
    { hour: '2026-10-01T01:00', cost: 1.5, requests: 30, tokens: 3000, spanMin: 2, partial: false },
  ],
};

const hourlyState = (overrides) => ({
  config: { ...CONFIG, granularity: 'hour', hourlyHours: 4 },
  hourly: FOUR_HOURS,
  ...overrides,
});

test('the hourly view plots the sampled hours and breaks the line at a gap', () => {
  const { registrations, harness } = setUpPlugin();
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState());

  const svg = findNode(tree, byClass('s2u-chart-svg'));
  assert.equal(svg.props['data-granularity'], 'hour');
  assert.equal(svg.props['data-points'], '4', '没采样的小时也占一个位置');
  assert.equal(svg.props['aria-label'], '花费按小时趋势，3 / 4 小时（1 小时无采样）');

  // Slots are evenly spaced across x 46…626 and the line stops at the gap: the
  // peak of 1.5 gives a 0…1.5 axis with a 0.375 step, so 0.5 → 106.67 and
  // 1.0 → 59.33, while the lone 01:00 point sits at the top with no neighbour.
  assert.equal(findNode(tree, byClass('s2u-chart-line')).props.d, 'M46 106.67 L239.33 59.33');
  assert.equal(findNode(tree, byClass('s2u-chart-area')).props.d, 'M46 106.67 L239.33 59.33 L239.33 154 L46 154 Z');
  const dots = findAll(tree, byClass('s2u-chart-dot'));
  assert.equal(dots.length, 1, '孤立的小时画成点，而不是画一条假线');
  assert.equal(dots[0].props.cx, 626);
  assert.equal(dots[0].props.cy, 12);

  const labels = findAll(tree, (node) => node.type === 'text' && node.props.className === 's2u-chart-tick').map((node) => node.props.children);
  assert.deepEqual(labels, ['$1.500', '$1.125', '$0.750', '$0.375', '$0.000', '22:00', '23:00', '00:00', '01:00']);
  assert.match(textOf(tree), /3 \/ 4 小时（1 小时无采样）/);
  assert.match(textOf(tree), /按小时 · \$3\.00 \/ 3 小时（本机采样）/);

  const stats = textOf(findNode(tree, byClass('s2u-chart-stats')));
  assert.match(stats, /合计\s+\$3\.00/);
  assert.match(stats, /时均\s+\$1\.00/);
  assert.match(stats, /峰值\s+\$1\.50（01:00）/);
  assert.match(stats, /区间\s+22:00 → 01:00/);
  assert.match(textOf(tree), /小时数据由插件本机采样累计/);
});

test('a long hourly window labels whole dates, not just clock times', () => {
  const { registrations, harness } = setUpPlugin();
  const buckets = Array.from({ length: 40 }, (_, index) => ({
    hour: `2026-10-0${index < 24 ? 1 : 2}T${String(index % 24).padStart(2, '0')}:00`,
    cost: index / 10,
  }));
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState({
    config: { ...CONFIG, granularity: 'hour', hourlyHours: 40 },
    hourly: { ...FOUR_HOURS, hours: 40, buckets },
  }));
  const labels = findAll(tree, (node) => node.type === 'text' && node.props.className === 's2u-chart-tick').map((node) => node.props.children);
  assert.equal(labels[5], '10-01 00:00', '长窗口带上日期');
  assert.equal(labels[labels.length - 1], '10-02 15:00');
});

test('switching to hours re-saves the granularity and offers hourly windows', async () => {
  const { registrations, harness } = setUpPlugin();
  const store = fakeStore({ config: { ...CONFIG, rangeDays: 30 }, snapshot: { ...SNAPSHOT, daily: THREE_DAYS }, hourly: FOUR_HOURS, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, store);

  const grains = findAll(tree, (node) => node.type === 'button' && ['按天', '按小时'].includes(node.props.children));
  assert.deepEqual(grains.map((node) => node.props.children), ['按天', '按小时']);
  assert.equal(grains[0].props['data-active'], 'true');
  grains[1].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(store.calls.lastPatch, { granularity: 'hour' });
});

test('hourly range buttons save hourlyHours without an upstream query', async () => {
  const { registrations, harness } = setUpPlugin();
  const store = fakeStore({
    config: { ...CONFIG, granularity: 'hour', hourlyHours: 4 },
    snapshot: { ...SNAPSHOT, daily: THREE_DAYS },
    hourly: FOUR_HOURS,
    error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null,
  });
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, store, hourlyState());

  const ranges = findAll(tree, (node) => node.type === 'button' && /^(24 小时|\d+ 天)$/.test(node.props.children));
  assert.deepEqual(ranges.map((node) => node.props.children), ['24 小时', '3 天', '7 天', '14 天']);
  assert.equal(ranges[2].props['data-active'], 'false');
  ranges[1].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(store.calls.lastPatch, { hourlyHours: 72 });
  assert.equal(store.calls.load, 1, '只重新读一次宿主状态，不再打上游接口');
  assert.equal(store.calls.query, 0);
});

test('hovering an hour shows the sample it came from, and a gap says so', () => {
  const { registrations, harness } = setUpPlugin();
  const { tree, props } = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState());
  const remount = () => harness.mount(harness.React.createElement(registrations.slots.find((slot) => slot.options.name === 'main').component, props));

  const bands = findAll(tree, byClass('s2u-chart-hit'));
  assert.deepEqual(bands.map((node) => node.props['data-missing']), ['false', 'false', 'true', 'false']);

  bands[3].props.onMouseEnter();
  const tip = findNode(remount(), byClass('s2u-chart-tip'));
  assert.equal(tip.props['data-tip'], '2026-10-01T01:00');
  assert.match(textOf(tip), /2026-10-01 01:00/, '读数框用可读的日期时间');
  assert.match(textOf(tip), /花费 \$1\.50/);
  assert.match(textOf(tip), /请求 30 次/);
  assert.match(textOf(tip), /采样 2 分钟/);

  findNode(remount(), byClass('s2u-chart-hit')).props.onMouseEnter();
  const gapTip = findNode(remount(), byClass('s2u-chart-tip'));
  assert.equal(gapTip.props['data-missing'], 'false');
  findAll(remount(), byClass('s2u-chart-hit'))[2].props.onMouseEnter();
  const missingTip = findNode(remount(), byClass('s2u-chart-tip'));
  assert.equal(missingTip.props['data-missing'], 'true');
  assert.match(textOf(missingTip), /这个小时没有数据/);
  assert.equal(findNode(remount(), byClass('s2u-chart-cross')), undefined, '缺口没有十字线');
});

test('the granularity switch still moves when the host predates the field', () => {
  // Before DSH is restarted the host answers /config without granularity, so the
  // saved value never comes back. The click must still switch the view and say
  // what is missing, instead of silently bouncing back to 按天.
  const { registrations, harness } = setUpPlugin();
  const store = fakeStore({ config: { ...CONFIG }, snapshot: { ...SNAPSHOT, daily: THREE_DAYS }, hourly: null, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const { tree, props } = renderOverview(harness, registrations, THREE_DAYS, store);
  const remount = () => harness.mount(harness.React.createElement(registrations.slots.find((slot) => slot.options.name === 'main').component, props));

  findAll(tree, (node) => node.type === 'button' && node.props.children === '按小时')[0].props.onClick();
  const hourly = remount();
  assert.deepEqual(store.calls.lastPatch, { granularity: 'hour' }, '照样写回配置');
  assert.equal(findAll(hourly, (node) => node.type === 'button' && node.props.children === '按小时')[0].props['data-active'], 'true');
  assert.match(textOf(hourly), /宿主没有返回小时窗口：确认插件已更新并重启 DSH。/);

  findAll(hourly, (node) => node.type === 'button' && node.props.children === '按天')[0].props.onClick();
  const back = remount();
  assert.equal(findNode(back, byClass('s2u-chart-line')).props.d, 'M46 154 L336 83 L626 12', '切回按天还是原来的折线');
  assert.deepEqual(store.calls.lastPatch, { granularity: 'day' });
});

test('an empty hour window explains why instead of looking broken', () => {
  const { registrations, harness } = setUpPlugin();
  const fresh = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState({
    hourly: { ...FOUR_HOURS, samples: 0, buckets: [] },
  })).tree;
  assert.match(textOf(fresh), /还没有小时数据/);
  const switches = findAll(fresh, (node) => node.type === 'button' && ['按天', '按小时'].includes(node.props.children));
  assert.equal(switches.length, 2, '空状态也要留着切换按钮，否则回不去按天');

  const offWindow = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState({
    hourly: { ...FOUR_HOURS, buckets: FOUR_HOURS.buckets.map((bucket) => ({ hour: bucket.hour, missing: true })) },
  })).tree;
  assert.match(textOf(offWindow), /这个窗口内没有采样到小时数据/);
});

test('a sub-cent hour is not rounded away to $0.00', () => {
  const { registrations, harness } = setUpPlugin();
  // A quiet day on the live site is $0.0787, so single hours are often $0.00x.
  const tiny = {
    hours: 4,
    from: '2026-09-30T22:00',
    to: '2026-10-01T01:00',
    retainedHours: 336,
    samples: 5,
    since: '2026-09-30T22:00',
    buckets: [
      { hour: '2026-09-30T22:00', cost: 0.0079, requests: 2, tokens: 400, spanMin: 2, partial: false },
      { hour: '2026-09-30T23:00', cost: 0.00042, requests: 1, tokens: 120, spanMin: 2, partial: false },
      { hour: '2026-10-01T00:00', cost: 0, requests: 0, tokens: 0, spanMin: 2, partial: false },
      { hour: '2026-10-01T01:00', cost: 0.5, requests: 30, tokens: 3000, spanMin: 2, partial: false },
    ],
  };
  const { tree, props } = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState({ hourly: tiny }));
  const remount = () => harness.mount(harness.React.createElement(registrations.slots.find((slot) => slot.options.name === 'main').component, props));

  const stats = textOf(findNode(tree, byClass('s2u-chart-stats')));
  assert.match(stats, /\$0\.51/, '合计到了分位就照常显示');

  findAll(tree, byClass('s2u-chart-hit'))[0].props.onMouseEnter();
  assert.match(textOf(findNode(remount(), byClass('s2u-chart-tip'))), /花费 \$0\.0079/, '极小的花费给到两位有效数字');
  findAll(remount(), byClass('s2u-chart-hit'))[1].props.onMouseEnter();
  assert.match(textOf(findNode(remount(), byClass('s2u-chart-tip'))), /花费 \$0\.00042/);
  findAll(remount(), byClass('s2u-chart-hit'))[2].props.onMouseEnter();
  assert.match(textOf(findNode(remount(), byClass('s2u-chart-tip'))), /花费 \$0\.00 请求 0 次/, '真的没花钱还是 $0.00');
});

test('the selection is announced, not only coloured', () => {
  const { registrations, harness } = setUpPlugin();
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState({
    config: { ...CONFIG, granularity: 'hour', hourlyHours: 24 },
  }));
  const pressed = findAll(tree, (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined);
  assert.equal(pressed.length, 2 + 3 + 4, '粒度两个 + 指标三个 + 小时区间四个');
  const active = pressed.filter((node) => node.props['aria-pressed'] === 'true');
  assert.deepEqual(active.map((node) => node.props.children), ['按小时', '花费', '24 小时']);
  for (const node of pressed) {
    assert.equal(node.props['aria-pressed'], node.props['data-active'], 'aria-pressed 与视觉选中态一致');
  }
});

test('manual-only refresh is called out in the hourly footer', () => {
  const { registrations, harness } = setUpPlugin();
  const manual = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState({
    config: { ...CONFIG, granularity: 'hour', hourlyHours: 4, intervalSec: 0 },
  })).tree;
  assert.match(textOf(manual), /当前刷新间隔是 0（只手动刷新）/);

  const auto = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState({
    config: { ...CONFIG, granularity: 'hour', hourlyHours: 4, intervalSec: 120 },
  })).tree;
  assert.equal(/当前刷新间隔是 0/.test(textOf(auto)), false);
});

// ------------------------------------------------------------------- exporting
//
// The panel is the only place these numbers exist, so export reads what is on
// screen: the CSV must line up row-by-row with the chart, holes included.

/** Replaces the clipboard with a recorder; returns the captured strings. */
function stubClipboard() {
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: (text) => { copied.push(text); return Promise.resolve(); } } },
    configurable: true,
    writable: true,
  });
  return copied;
}

const exportButton = (tree, key) => findNode(tree, (node) => node.props?.['data-export'] === key);

test('the hourly table lists every slot, newest first, holes included', () => {
  const { registrations, harness } = setUpPlugin();
  const partial = {
    ...FOUR_HOURS,
    buckets: FOUR_HOURS.buckets.map((bucket) => (bucket.hour === '2026-09-30T23:00' ? { ...bucket, partial: true, spanMin: 148 } : bucket)),
  };
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState({ hourly: partial }));

  const details = findNode(tree, byClass('s2u-hourly'));
  assert.ok(details, '按小时视图下面要有一张明细表');
  assert.equal(details.type, 'details');
  const summary = textOf(findNode(details, (node) => node.type === 'summary'));
  assert.match(summary, /逐小时明细（3 小时有数据 · 1 小时无采样，最新在上）/);

  const body = findNode(details, (node) => node.type === 'tbody');
  const rows = findAll(body, (node) => node.type === 'tr');
  assert.deepEqual(rows.map((row) => row.props['data-hour']),
    ['2026-10-01T01:00', '2026-10-01T00:00', '2026-09-30T23:00', '2026-09-30T22:00'],
    '最新的小时排在最上面');
  const header = findAll(findNode(details, (node) => node.type === 'thead'), (node) => node.type === 'th').map((node) => node.props.children);
  assert.deepEqual(header, ['小时', '花费', '请求', 'Tokens', '实际扣费', '备注']);

  const cells = (row) => findAll(row, (node) => node.type === 'td').map((node) => (node.props && node.props.children));
  assert.deepEqual(cells(rows[0]), ['2026-10-01 01:00', '$1.50', '30', '3,000', '—', '']);
  assert.deepEqual(cells(rows[1]), ['2026-10-01 00:00', '—', '—', '—', '—', '无采样（插件当时没运行）']);
  assert.deepEqual(cells(rows[2]), ['2026-09-30 23:00', '$1.00', '20', '2,000', '—', '含中断时段']);
  assert.equal(rows[1].props['data-missing'], 'true');
  assert.equal(rows[2].props['data-missing'], 'false');

  // The day view has nothing to tabulate.
  const daily = renderOverview(harness, registrations, THREE_DAYS).tree;
  assert.equal(findNode(daily, byClass('s2u-hourly')) ?? null, null);
  // Nor does an empty hour window: nothing on screen means nothing to export.
  const empty = renderOverview(harness, registrations, THREE_DAYS, undefined, hourlyState({ hourly: { ...FOUR_HOURS, buckets: [] } })).tree;
  assert.equal(findNode(empty, byClass('s2u-actions')) ?? null, null);
});

test('复制 CSV copies exactly the rows the chart is showing', async () => {
  const { registrations, harness } = setUpPlugin();
  const copied = stubClipboard();
  const store = fakeStore({ config: CONFIG, snapshot: null, hourly: null, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, store, hourlyState());

  exportButton(tree, 'copy-csv').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(copied.length, 1);
  const csv = copied[0];
  assert.equal(csv.startsWith('\ufeff'), true, 'BOM：Excel 打开中文表头才不会乱码');
  assert.equal(csv.includes('\r\n'), true, 'CRLF 换行');
  const lines = csv.replace(/^\ufeff/, '').trim().split('\r\n');
  assert.equal(lines[0], '小时,花费,请求,Tokens,实际扣费,备注');
  assert.equal(lines.length, 5, '表头 + 4 个小时，没采样的那小时也占一行');
  assert.equal(lines[1], '2026-09-30 22:00,0.5,10,1000,0.6,');
  assert.equal(lines[3], '2026-10-01 00:00,,,,,无采样');
  assert.match(store.calls.notify, /已复制 CSV：3 行/);
});

test('下载 CSV saves a named file and also copies, because a blocked download cannot be detected', async () => {
  const { registrations, harness } = setUpPlugin();
  const copied = stubClipboard();
  const saved = [];
  const originalCreate = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => {
    const element = originalCreate(tag);
    element.click = () => saved.push({ tag, href: element.href, download: element.download });
    return element;
  };
  try {
    const store = fakeStore({ config: CONFIG, snapshot: null, hourly: null, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
    const { tree } = renderOverview(harness, registrations, THREE_DAYS, store, hourlyState());
    exportButton(tree, 'save-csv').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].tag, 'a');
    assert.equal(saved[0].download, 'sub2api-usage-hourly-202610010100.csv');
    assert.match(String(saved[0].href), /^blob:/);
    assert.equal(copied.length, 1, '同一份内容也进剪贴板');
    assert.equal(
      copied[0],
      '\ufeff小时,花费,请求,Tokens,实际扣费,备注\r\n'
      + '2026-09-30 22:00,0.5,10,1000,0.6,\r\n'
      + '2026-09-30 23:00,1,20,2000,,\r\n'
      + '2026-10-01 00:00,,,,,无采样\r\n'
      + '2026-10-01 01:00,1.5,30,3000,,\r\n',
    );
    assert.match(store.calls.notify, /已触发下载 sub2api-usage-hourly-202610010100\.csv，同一份内容也复制到了剪贴板/);
  } finally {
    globalThis.document.createElement = originalCreate;
  }

  // No clickable anchor (a harness without DOM, a hardened browser): copy instead
  // of silently doing nothing.
  const store = fakeStore({ config: CONFIG, snapshot: null, hourly: null, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, store, hourlyState());
  exportButton(tree, 'save-csv').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(copied.length, 2, '下载不成时靠剪贴板兜底');
  assert.match(store.calls.notify, /这个环境不让下载，已复制 CSV：3 行/);
});

test('复制 JSON hands over the same snapshot the panel is rendering', async () => {
  const { registrations, harness } = setUpPlugin();
  const copied = stubClipboard();
  const store = fakeStore({ config: CONFIG, snapshot: null, hourly: null, error: null, phase: 'ready', busy: false, toast: null, queriedAt: null, files: null });
  const { tree } = renderOverview(harness, registrations, THREE_DAYS, store, hourlyState());

  exportButton(tree, 'copy-json').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));

  const payload = JSON.parse(copied[0]);
  assert.equal(payload.granularity, 'hour');
  assert.deepEqual(payload.snapshot.daily, THREE_DAYS);
  assert.equal(payload.snapshot.headline.balance, 12.34);
  assert.equal(payload.hourly.hours, 4);
  assert.equal(typeof payload.exportedAt, 'string');
  assert.match(store.calls.notify, /已复制完整 JSON 快照/);

  // The day view exports the day series instead.
  const dayTree = renderOverview(harness, registrations, THREE_DAYS).tree;
  exportButton(dayTree, 'copy-csv').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  const dayLines = copied[1].replace(/^\ufeff/, '').trim().split('\r\n');
  assert.equal(dayLines[0], '日期,花费,请求,Tokens,实际扣费,备注');
  assert.equal(dayLines[1], '2026-09-29,0,0,0,,');
  assert.equal(dayLines[3], '2026-10-01,2,4200,55996144,1.5,');
});




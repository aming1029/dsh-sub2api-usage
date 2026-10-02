/**
 * Pure query logic for the Sub2API usage plugin — no Cordis, no filesystem, so
 * it can be unit-tested directly with `node --test`.
 *
 * Everything here mirrors the interfaces documented for sub2api:
 *   admin : GET /api/v1/admin/users/:id            · x-api-key: admin-…  (or admin Bearer JWT)
 *   key   : GET /v1/usage?start_date=&end_date=    · Authorization: Bearer sk-…
 *   user  : POST /api/v1/auth/login → GET /api/v1/auth/me (or /api/v1/user/profile)
 *   custom: caller-supplied method/path/headers/body + JSON pointers
 *
 * Every response is `{ code, message, data }`; `unwrapEnvelope()` accepts both
 * the wrapped and the bare shape.
 */

export const PLUGIN_ID = 'dsh-sub2api-usage';
export const PANEL_ID = 'sub2api-usage';
export const DEFAULT_BASE_URL = 'https://aiapi.aaming.icu';

/** Canonical config; every persisted field is declared here exactly once. */
export const DEFAULT_CONFIG = Object.freeze({
  baseUrl: DEFAULT_BASE_URL,
  mode: 'auto', // auto | admin | key | user | custom
  credential: '',
  email: '',
  password: '',
  adminUserId: '',
  search: '',
  listUsers: false,
  page: 1,
  pageSize: 20,
  sortBy: 'balance',
  sortOrder: 'desc',
  timezone: 'Asia/Shanghai',
  rangeDays: 30,
  granularity: 'day', // day | hour — which series the trend chart opens with
  hourlyHours: 24, // window of the hourly view, up to HOURLY_RETAIN_HOURS
  hourlySource: 'sampled', // sampled | site — where the hourly series comes from
  currency: 'USD',
  currencySymbol: '$',
  timeoutMs: 15000,
  intervalSec: 120,
  lowBalance: 5,
  paths: Object.freeze({
    usage: '/v1/usage',
    me: '/api/v1/auth/me',
    profile: '/api/v1/user/profile',
    login: '/api/v1/auth/login',
    // The site's own dashboard trend endpoint: the only one that accepts
    // granularity=hour, and it needs a logged-in token (a site key is refused
    // with "Invalid token").
    trend: '/api/v1/usage/dashboard/trend',
    adminUser: '/api/v1/admin/users/{id}',
    adminUsers: '/api/v1/admin/users',
  }),
  custom: Object.freeze({
    method: 'GET',
    path: '/v1/usage?start_date={start}&end_date={end}&timezone={timezone}',
    headers: '',
    body: '',
  }),
  pointers: Object.freeze({
    balance: '',
    frozen: '',
    recharged: '',
    used: '',
    limit: '',
    remaining: '',
  }),
});

const MODES = new Set(['auto', 'admin', 'key', 'user', 'custom']);
const GRANULARITIES = new Set(['day', 'hour']);
/** Where the hourly series comes from: our own sampling, or the site's dashboard. */
const HOURLY_SOURCES = new Set(['sampled', 'site']);
/** The hourly view can never reach further back than the sampler retains. */
export const MIN_HOURLY_HOURS = 6;
export const MAX_HOURLY_HOURS = 336;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const POINTER_KEYS = Object.keys(DEFAULT_CONFIG.pointers);
const PATH_KEYS = Object.keys(DEFAULT_CONFIG.paths);

/** A query failure that carries a machine code and an actionable hint. */
export class QueryError extends Error {
  constructor(code, message, hint = '', status = 0) {
    super(message);
    this.name = 'QueryError';
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

function str(value, fallback = '') {
  return typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value);
}

function num(value, fallback) {
  const n = typeof value === 'number' ? value : Number.parseFloat(str(value));
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(num(value, fallback));
  return Math.min(max, Math.max(min, n));
}

/** Trim trailing slashes so base + path concatenation stays predictable. */
export function trimBase(baseUrl) {
  return str(baseUrl).trim().replace(/\/+$/, '');
}

/** Validate a user-supplied endpoint: absolute http(s), no credentials in the URL. */
export function validateBaseUrl(baseUrl) {
  const raw = str(baseUrl).trim();
  if (raw === '') return { ok: false, reason: '服务地址不能为空' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `不是合法的 URL：${raw}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `只支持 http/https，收到 ${url.protocol}` };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'URL 里不要写账号密码，凭证请填在「凭证」输入框' };
  }
  return { ok: true, url: trimBase(url.toString()) };
}

/** Coerce any stored/partial object into a complete, validated config. */
export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const paths = { ...DEFAULT_CONFIG.paths };
  for (const key of PATH_KEYS) {
    const value = str(src.paths?.[key]).trim();
    if (value !== '') paths[key] = value.startsWith('/') ? value : `/${value}`;
  }
  const custom = { ...DEFAULT_CONFIG.custom };
  const method = str(src.custom?.method, custom.method).trim().toUpperCase();
  custom.method = METHODS.has(method) ? method : 'GET';
  if (str(src.custom?.path).trim() !== '') custom.path = str(src.custom.path).trim();
  custom.headers = str(src.custom?.headers, '').trim();
  custom.body = str(src.custom?.body, '').trim();

  const pointers = { ...DEFAULT_CONFIG.pointers };
  for (const key of POINTER_KEYS) {
    const value = str(src.pointers?.[key]).trim();
    if (value !== '') pointers[key] = value;
  }

  const mode = str(src.mode, DEFAULT_CONFIG.mode).trim().toLowerCase();
  return {
    baseUrl: trimBase(str(src.baseUrl, DEFAULT_CONFIG.baseUrl)) || DEFAULT_CONFIG.baseUrl,
    mode: MODES.has(mode) ? mode : DEFAULT_CONFIG.mode,
    credential: str(src.credential, '').trim(),
    email: str(src.email, '').trim(),
    password: str(src.password, ''),
    adminUserId: str(src.adminUserId, '').trim(),
    search: str(src.search, '').trim(),
    listUsers: src.listUsers === true,
    page: clampInt(src.page, 1, 100000, DEFAULT_CONFIG.page),
    pageSize: clampInt(src.pageSize, 1, 200, DEFAULT_CONFIG.pageSize),
    sortBy: str(src.sortBy, DEFAULT_CONFIG.sortBy).trim() || DEFAULT_CONFIG.sortBy,
    sortOrder: str(src.sortOrder, DEFAULT_CONFIG.sortOrder).trim() === 'asc' ? 'asc' : 'desc',
    timezone: str(src.timezone, DEFAULT_CONFIG.timezone).trim() || DEFAULT_CONFIG.timezone,
    rangeDays: clampInt(src.rangeDays, 1, 365, DEFAULT_CONFIG.rangeDays),
    granularity: GRANULARITIES.has(str(src.granularity, DEFAULT_CONFIG.granularity).trim().toLowerCase())
      ? str(src.granularity, DEFAULT_CONFIG.granularity).trim().toLowerCase()
      : DEFAULT_CONFIG.granularity,
    hourlyHours: clampInt(src.hourlyHours, MIN_HOURLY_HOURS, MAX_HOURLY_HOURS, DEFAULT_CONFIG.hourlyHours),
    hourlySource: HOURLY_SOURCES.has(str(src.hourlySource, DEFAULT_CONFIG.hourlySource).trim().toLowerCase())
      ? str(src.hourlySource, DEFAULT_CONFIG.hourlySource).trim().toLowerCase()
      : DEFAULT_CONFIG.hourlySource,
    currency: str(src.currency, DEFAULT_CONFIG.currency).trim() || DEFAULT_CONFIG.currency,
    currencySymbol: str(src.currencySymbol, DEFAULT_CONFIG.currencySymbol) || DEFAULT_CONFIG.currencySymbol,
    timeoutMs: clampInt(src.timeoutMs, 1000, 120000, DEFAULT_CONFIG.timeoutMs),
    intervalSec: clampInt(src.intervalSec, 0, 86400, DEFAULT_CONFIG.intervalSec),
    lowBalance: num(src.lowBalance, DEFAULT_CONFIG.lowBalance),
    paths,
    custom,
    pointers,
  };
}

/** Never let a credential reach the browser: keep a recognisable 4/4 hint only. */
export function maskSecret(secret) {
  const value = str(secret);
  if (value === '') return '';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** The config as the client may see it (credential replaced by a hint + booleans). */
export function publicConfig(config) {
  const safe = normalizeConfig(config);
  return {
    ...safe,
    credential: '',
    password: '',
    credentialHint: maskSecret(config?.credential),
    hasCredential: str(config?.credential) !== '',
    hasPassword: str(config?.password) !== '',
    detectedMode: detectMode(safe),
  };
}

/**
 * JSON-pointer / dotted-path lookup. Accepts `/data/balance`, `data.balance`
 * and `data[0].balance`; returns undefined instead of throwing.
 */
export function pointerGet(root, pointer) {
  const path = str(pointer).trim();
  if (path === '' || root === undefined || root === null) return undefined;
  const tokens = path
    .replace(/^\//, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split(/[/.]/)
    .filter((token) => token !== '');
  let current = root;
  for (const token of tokens) {
    if (current === undefined || current === null) return undefined;
    if (typeof current !== 'object') return undefined;
    current = current[token];
  }
  return current;
}

/** First defined value among candidate pointers. */
export function pointerFirst(root, pointers) {
  for (const pointer of pointers) {
    const value = pointerGet(root, pointer);
    if (value !== undefined && value !== null && value !== '') return { value, pointer };
  }
  return undefined;
}

/** `{ code, message, data }` → `data`; a bare object passes through unchanged. */
export function unwrapEnvelope(json) {
  if (json === null || typeof json !== 'object') return json;
  if (!Object.prototype.hasOwnProperty.call(json, 'code')) return json;
  // Codes are 0 on success; anything else — including string codes such as
  // "INVALID_API_KEY" — is a failure.
  const code = json.code;
  const numeric = typeof code === 'number' ? code : Number.parseFloat(str(code));
  if (numeric === 0) {
    return Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
  }
  const message = str(json.message, `服务端返回 code=${str(code)}`);
  throw new QueryError('envelope', message, envelopeHint(code, message));
}

function envelopeHint(code, message) {
  const text = `${message}`.toLowerCase();
  if (code === 401 || text.includes('unauthorized') || text.includes('invalid token')) {
    return '凭证无效或已过期：管理员请用后台生成的 admin- Key，普通用户请用 sk- Key，或改用账号密码登录。';
  }
  if (code === 403) return '凭证有效但权限不足：该接口需要管理员权限。';
  if (code === 404) return '接口路径不存在：在「自定义接口」里核对路径，或确认站点版本。';
  return '检查服务地址、凭证与查询模式是否匹配。';
}

/**
 * Resolve which mode a config actually queries with. `auto` reads the shape of
 * the credential instead of asking the user to classify it.
 */
export function detectMode(config) {
  const cfg = normalizeConfig(config);
  if (cfg.mode !== 'auto') return cfg.mode;
  const credential = cfg.credential;
  if (credential.startsWith('admin-')) return 'admin';
  if (credential.startsWith('sk-')) return 'key';
  if (/^ey[A-Za-z0-9_-]{4,}\./.test(credential)) return 'user';
  if (credential !== '') return 'key';
  if (cfg.email !== '' && cfg.password !== '') return 'user';
  return 'none';
}

/** Inclusive date window (`YYYY-MM-DD`) used by the usage endpoint. */
export function resolveRange(config, options = {}, now = new Date()) {
  if (options.start && options.end) return { start: str(options.start), end: str(options.end) };
  const days = clampInt(options.days ?? config.rangeDays, 1, 365, 30);
  const end = new Date(now.getTime());
  const start = new Date(now.getTime() - (days - 1) * 86400000);
  const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { start: iso(start), end: iso(end) };
}

/**
 * Substitute `{start}`/`{end}`/`{timezone}`/`{id}` placeholders.
 * An unset variable stays verbatim, so a half-configured path fails visibly
 * instead of silently querying an empty value.
 */
export function fillPlaceholders(path, vars) {
  return str(path).replace(/\{(\w+)\}/g, (match, key) => {
    const value = vars[key];
    if (value === undefined || value === null || value === '') return match;
    return encodeURIComponent(String(value));
  });
}

function joinUrl(baseUrl, path) {
  const base = trimBase(baseUrl);
  const suffix = str(path).trim();
  if (suffix === '') return base;
  return suffix.startsWith('/') ? `${base}${suffix}` : `${base}/${suffix}`;
}

function authHeaderFor(credential, style) {
  if (style === 'x-api-key') return { 'x-api-key': credential };
  return { Authorization: `Bearer ${credential}` };
}

/**
 * Build the ordered HTTP request plan for a config. Pure: no network, no clock
 * beyond the injected `now`, so tests can assert each mode exactly.
 */
export function buildPlan(config, options = {}, now = new Date()) {
  const cfg = normalizeConfig(config);
  const check = validateBaseUrl(cfg.baseUrl);
  if (!check.ok) throw new QueryError('config', check.reason, '在设置里填写形如 https://example.com 的地址。');
  const range = resolveRange(cfg, options, now);
  const vars = { start: range.start, end: range.end, timezone: cfg.timezone, id: cfg.adminUserId };
  const mode = detectMode(cfg);
  const json = { accept: 'application/json' };

  if (mode === 'none') {
    throw new QueryError(
      'config',
      '还没有可用的凭证',
      '三种任选其一：① 后台「系统设置 → 管理员 API Key」生成的 admin-…（查任意用户）；② 站点的 sk-… Key（查该 Key 的余额与用量）；③ 账号密码（查自己）。',
    );
  }

  if (mode === 'key') {
    if (cfg.credential === '') throw new QueryError('config', 'Key 模式需要 sk- 开头的站点 API Key', '在「凭证」里填入 sk-… 。');
    const query = new URLSearchParams({ start_date: range.start, end_date: range.end, timezone: cfg.timezone });
    return {
      mode,
      range,
      steps: [
        {
          id: 'usage',
          label: 'Key 用量',
          url: joinUrl(cfg.baseUrl, `${cfg.paths.usage}?${query.toString()}`),
          method: 'GET',
          headers: { ...json, ...authHeaderFor(cfg.credential, 'bearer') },
        },
      ],
    };
  }

  if (mode === 'admin') {
    if (cfg.credential === '') throw new QueryError('config', '管理员模式需要管理员 API Key 或管理员令牌', '在「凭证」里填入 admin-… 或管理员登录后的 JWT。');
    const useApiKey = cfg.credential.startsWith('admin-');
    const headers = { ...json, ...authHeaderFor(cfg.credential, useApiKey ? 'x-api-key' : 'bearer') };
    if (cfg.adminUserId !== '' && !cfg.listUsers) {
      return {
        mode,
        range,
        steps: [
          {
            id: 'admin-user',
            label: `管理员查询用户 ${cfg.adminUserId}`,
            url: joinUrl(cfg.baseUrl, fillPlaceholders(cfg.paths.adminUser, vars)),
            method: 'GET',
            headers,
          },
        ],
      };
    }
    const query = new URLSearchParams({
      page: String(cfg.page),
      page_size: String(cfg.pageSize),
      sort_by: cfg.sortBy,
      sort_order: cfg.sortOrder,
    });
    if (cfg.search !== '') query.set('search', cfg.search);
    return {
      mode,
      range,
      steps: [
        {
          id: 'admin-users',
          label: cfg.search === '' ? '管理员用户列表' : `管理员搜索「${cfg.search}」`,
          url: joinUrl(cfg.baseUrl, `${cfg.paths.adminUsers}?${query.toString()}`),
          method: 'GET',
          headers,
        },
      ],
    };
  }

  if (mode === 'user') {
    const headers = { ...json };
    if (cfg.credential !== '') {
      return {
        mode,
        range,
        steps: [
          {
            id: 'me',
            label: '当前用户',
            url: joinUrl(cfg.baseUrl, cfg.paths.me),
            method: 'GET',
            headers: { ...headers, ...authHeaderFor(cfg.credential, 'bearer') },
          },
        ],
      };
    }
    if (cfg.email === '' || cfg.password === '') {
      throw new QueryError('config', '账号模式需要邮箱与密码，或直接填一个已登录的访问令牌', '二者任选其一。');
    }
    return {
      mode,
      range,
      steps: [
        {
          id: 'login',
          label: '账号登录',
          url: joinUrl(cfg.baseUrl, cfg.paths.login),
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ email: cfg.email, password: cfg.password }),
        },
        {
          id: 'me',
          label: '当前用户',
          url: joinUrl(cfg.baseUrl, cfg.paths.me),
          method: 'GET',
          headers,
          useTokenFrom: 'login',
        },
      ],
    };
  }

  // mode === 'custom'
  let customHeaders = {};
  if (cfg.custom.headers.trim() !== '') {
    try {
      const parsed = JSON.parse(cfg.custom.headers);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('必须是 JSON 对象');
      }
      customHeaders = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
    } catch (error) {
      throw new QueryError('config', `自定义请求头不是合法 JSON 对象：${error.message}`, '例如 {"x-api-key":"admin-…"}');
    }
  }
  const body = cfg.custom.body.trim() === '' ? undefined : fillPlaceholders(cfg.custom.body, vars);
  const headers = { ...json, ...customHeaders };
  if (body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/json';
  }
  return {
    mode,
    range,
    steps: [
      {
        id: 'custom',
        label: '自定义请求',
        url: joinUrl(cfg.baseUrl, fillPlaceholders(cfg.custom.path, vars)),
        method: cfg.custom.method,
        headers,
        body,
      },
    ],
  };
}

/** Default pointer candidates, per semantic field, tried in order. */
export const AUTO_POINTERS = Object.freeze({
  balance: [
    '/data/balance',
    '/balance',
    '/data/user/balance',
    '/user/balance',
    '/data/account/balance',
    '/data/wallet/balance',
    '/data/remaining',
    '/remaining',
    '/data/quota/remaining',
    '/quota/remaining',
  ],
  frozen: ['/data/frozen_balance', '/frozen_balance', '/data/frozenBalance'],
  recharged: ['/data/total_recharged', '/total_recharged', '/data/totalRecharged'],
  used: ['/data/quota/used', '/quota/used', '/data/used', '/data/subscription/used_usd'],
  limit: ['/data/quota/limit', '/quota/limit', '/data/limit', '/data/subscription/limit_usd'],
  remaining: ['/data/quota/remaining', '/quota/remaining', '/data/remaining', '/remaining'],
});

function numberAt(root, pointers, configured) {
  const candidates = configured !== '' ? [configured] : [];
  return pointerFirst(root, [...candidates, ...pointers]);
}

function toNumber(entry) {
  if (entry === undefined) return undefined;
  const value = num(entry.value, undefined);
  return value === undefined ? { raw: entry.value, pointer: entry.pointer } : { value, pointer: entry.pointer };
}

/** Find the first array-valued field among the given keys on any of the roots. */
function arrayAt(roots, keys) {
  for (const root of roots) {
    for (const key of keys) {
      const value = pointerGet(root, key);
      if (Array.isArray(value)) return { items: value, pointer: key };
    }
  }
  return undefined;
}

function objectAt(roots, keys) {
  for (const root of roots) {
    for (const key of keys) {
      const value = pointerGet(root, key);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return { value, pointer: key };
    }
  }
  return undefined;
}

/**
 * One subscription side (daily/weekly/monthly). Sub2API documents the flat
 * `subscription.daily_usage_usd` / `daily_limit_usd` pair, but several builds
 * nest it as `subscription.daily.{usage_usd,limit_usd}` — both are read.
 */
function subscriptionSide(roots, name) {
  const flatBases = [`/data/subscription/${name}_`, `/subscription/${name}_`, `/data/${name}_`];
  const nestedBases = [`/data/subscription/${name}`, `/subscription/${name}`, `/data/${name}`, `/${name}`];
  const usedKeys = ['usage_usd', 'usage', 'used_usd', 'used', 'cost_usd', 'cost'];
  const limitKeys = ['limit_usd', 'limit', 'quota_usd', 'quota', 'max_usd', 'max'];
  let used;
  let limit;
  for (const root of roots) {
    for (const base of flatBases) {
      for (const key of usedKeys) used ??= pointerFirst(root, [`${base}${key}`])?.value;
      for (const key of limitKeys) limit ??= pointerFirst(root, [`${base}${key}`])?.value;
    }
    for (const base of nestedBases) {
      for (const key of usedKeys) used ??= pointerFirst(root, [`${base}/${key}`])?.value;
      for (const key of limitKeys) limit ??= pointerFirst(root, [`${base}/${key}`])?.value;
    }
  }
  const usedNumber = num(used, undefined);
  const limitNumber = num(limit, undefined);
  if (usedNumber === undefined && limitNumber === undefined) return undefined;
  return { used: usedNumber, limit: limitNumber };
}

/** A payload that *is* the user record (admin single-user mode). */
function looksLikeUser(node) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return false;
  const hasIdentity = typeof node.email === 'string' || typeof node.username === 'string';
  const hasKey = node.id !== undefined || node.user_id !== undefined || node.balance !== undefined;
  return hasIdentity && hasKey;
}

function scalarFields(root, limit = 18) {
  const out = [];
  const walk = (node, path, depth) => {
    if (out.length >= limit || node === null || node === undefined) return;
    if (typeof node === 'object') {
      if (depth > 2) return;
      for (const [key, value] of Object.entries(node)) {
        if (Array.isArray(value)) continue;
        walk(value, path === '' ? key : `${path}.${key}`, depth + 1);
        if (out.length >= limit) return;
      }
      return;
    }
    if (typeof node === 'boolean') return;
    if (typeof node === 'number' || typeof node === 'string') {
      const text = typeof node === 'string' ? node : String(node);
      if (text.length > 120) return;
      out.push({ label: path, value: node });
    }
  };
  walk(root, '', 0);
  return out;
}

/**
 * Turn raw responses into the one snapshot the UI renders. Tolerant by design:
 * a field it cannot recognise never fails the query, it just shows up in the
 * generic field list and the raw viewer.
 */
export function summarize({ config, plan, steps = [], latencyMs = 0, at = new Date() }) {
  const cfg = normalizeConfig(config);
  const roots = [];
  const warnings = [];
  for (const step of steps) {
    if (step.error !== undefined) {
      warnings.push(`${step.label}：${step.error}`);
      continue;
    }
    let data = step.json;
    try {
      data = unwrapEnvelope(step.json);
    } catch (error) {
      warnings.push(`${step.label}：${error.message}`);
    }
    if (data !== undefined && data !== null) roots.push(data);
  }
  // A multi-step plan (user mode logs in first) puts the token payload first;
  // the informative one is whichever root actually carries a balance.
  const primary =
    roots.find((root) => numberAt(root, AUTO_POINTERS.balance, cfg.pointers.balance) !== undefined) ??
    roots[roots.length - 1] ??
    {};

  const balance = toNumber(numberAt(primary, AUTO_POINTERS.balance, cfg.pointers.balance));
  const frozen = toNumber(numberAt(primary, AUTO_POINTERS.frozen, cfg.pointers.frozen));
  const recharged = toNumber(numberAt(primary, AUTO_POINTERS.recharged, cfg.pointers.recharged));
  const used = toNumber(numberAt(primary, AUTO_POINTERS.used, cfg.pointers.used));
  const limit = toNumber(numberAt(primary, AUTO_POINTERS.limit, cfg.pointers.limit));
  const remaining = toNumber(numberAt(primary, AUTO_POINTERS.remaining, cfg.pointers.remaining));

  const quotaMode = pointerFirst(primary, ['/data/mode', '/mode'])?.value;
  const userRecord = objectAt(roots, ['/data/user', '/user'])?.value
    ?? (looksLikeUser(primary) ? primary : undefined)
    ?? objectAt(roots, ['/data'])?.value;
  const user = userRecord
    ? {
        id: pointerFirst(userRecord, ['id', 'user_id', 'userId'])?.value,
        email: pointerFirst(userRecord, ['email', 'username'])?.value,
        name: pointerFirst(userRecord, ['name', 'display_name', 'nickname'])?.value,
        status: pointerFirst(userRecord, ['status', 'is_active', 'enabled'])?.value,
      }
    : undefined;

  const subscription = {};
  for (const name of ['daily', 'weekly', 'monthly']) {
    const side = subscriptionSide(roots, name);
    if (side !== undefined) subscription[name] = side;
  }

  const rateLimitsRaw = arrayAt(roots, ['/data/rate_limits', '/rate_limits', '/data/rateLimits']);
  const rateLimits = (rateLimitsRaw?.items ?? []).slice(0, 12).map((item, index) => {
    const record = item && typeof item === 'object' ? item : { value: item };
    const label = pointerFirst(record, ['window', 'name', 'label', 'period', 'key'])?.value;
    return {
      label: label === undefined ? `#${index + 1}` : String(label),
      used: num(pointerFirst(record, ['used', 'used_usd', 'usage', 'count'])?.value, undefined),
      limit: num(pointerFirst(record, ['limit', 'limit_usd', 'max', 'quota'])?.value, undefined),
      remaining: num(pointerFirst(record, ['remaining', 'left'])?.value, undefined),
      reset: pointerFirst(record, ['reset_at', 'resets_at', 'resetAt', 'window_end'])?.value,
    };
  });

  const modelsRaw = arrayAt(roots, ['/data/model_stats', '/model_stats', '/data/models', '/models']);
  let models = [];
  if (modelsRaw !== undefined) {
    models = modelsRaw.items.slice(0, 12).map((item, index) => {
      if (item === null || typeof item !== 'object') return { name: `#${index + 1}`, value: num(item, undefined) };
      const name = pointerFirst(item, ['model', 'name', 'model_name', 'id'])?.value;
      const cost = num(pointerFirst(item, ['cost', 'cost_usd', 'amount', 'total_cost'])?.value, undefined);
      const requests = num(pointerFirst(item, ['requests', 'count', 'calls', 'request_count'])?.value, undefined);
      const tokens = num(pointerFirst(item, ['tokens', 'total_tokens', 'input_tokens'])?.value, undefined);
      return {
        name: name === undefined ? `#${index + 1}` : String(name),
        cost,
        requests,
        tokens,
        sub: [requests === undefined ? '' : `${requests} 次`, tokens === undefined ? '' : `${tokens} tokens`].filter(Boolean).join(' · '),
      };
    });
  } else {
    const modelObject = objectAt(roots, ['/data/model_stats', '/model_stats']);
    if (modelObject !== undefined) {
      models = Object.entries(modelObject.value)
        .slice(0, 12)
        .map(([name, value]) => ({
          name,
          cost: num(typeof value === 'object' ? pointerFirst(value, ['cost', 'cost_usd'])?.value : value, undefined),
          requests: num(typeof value === 'object' ? pointerFirst(value, ['requests', 'count'])?.value : undefined, undefined),
          sub: '',
        }));
    }
  }
  const modelTotal = models.reduce((sum, item) => sum + (item.cost ?? 0), 0);
  if (modelTotal > 0) {
    for (const item of models) item.share = (item.cost ?? 0) / modelTotal;
  }

  const dailyRaw = arrayAt(roots, ['/data/daily_usage', '/daily_usage', '/data/daily', '/daily']);
  let daily = [];
  if (dailyRaw !== undefined) {
    daily = dailyRaw.items.slice(-60).map((item, index) => {
      if (item === null || typeof item !== 'object') return { date: `#${index + 1}`, value: num(item, undefined) };
      const date = pointerFirst(item, ['date', 'day', 'label', 'period'])?.value;
      const value = num(pointerFirst(item, ['cost', 'cost_usd', 'amount', 'usage', 'total'])?.value, undefined);
      return {
        date: date === undefined ? `#${index + 1}` : String(date),
        value,
        // Carried so the trend chart can offer more than one metric without a
        // second request; sites that omit them simply leave these undefined.
        requests: num(pointerFirst(item, ['requests', 'request_count', 'count', 'calls'])?.value, undefined),
        tokens: num(pointerFirst(item, ['total_tokens', 'tokens'])?.value, undefined),
        actual: num(pointerFirst(item, ['actual_cost', 'real_cost', 'billed_cost'])?.value, undefined),
      };
    });
  } else {
    const dailyObject = objectAt(roots, ['/data/daily_usage', '/daily_usage']);
    if (dailyObject !== undefined) {
      daily = Object.entries(dailyObject.value)
        .slice(-60)
        .map(([date, value]) => {
          const entry = typeof value === 'object' && value !== null ? value : undefined;
          const read = (keys) => (entry === undefined ? undefined : num(pointerFirst(entry, keys)?.value, undefined));
          return {
            date,
            value: num(entry === undefined ? value : pointerFirst(entry, ['cost', 'cost_usd', 'amount'])?.value, undefined),
            requests: read(['requests', 'request_count', 'count', 'calls']),
            tokens: read(['total_tokens', 'tokens']),
            actual: read(['actual_cost', 'real_cost', 'billed_cost']),
          };
        });
    }
  }

  const totalsRecord = objectAt(roots, ['/data/total', '/total', '/data/totals', '/totals']);
  const totals = totalsRecord === undefined ? [] : Object.entries(totalsRecord.value).slice(0, 16).map(([label, value]) => ({ label, value }));

  // Today's *running* totals. The hourly sampler differences them between
  // refreshes, which is the only way to get hour buckets from a site key.
  const todayRecord = objectAt(roots, ['/data/usage/today', '/usage/today', '/data/today', '/today']);
  const today = todayRecord === undefined
    ? undefined
    : {
        cost: num(pointerFirst(todayRecord.value, ['cost', 'cost_usd', 'amount', 'usage'])?.value, undefined),
        actual: num(pointerFirst(todayRecord.value, ['actual_cost', 'real_cost', 'billed_cost'])?.value, undefined),
        requests: num(pointerFirst(todayRecord.value, ['requests', 'request_count', 'count', 'calls'])?.value, undefined),
        tokens: num(pointerFirst(todayRecord.value, ['total_tokens', 'tokens'])?.value, undefined),
      };

  const usersArray = arrayAt(roots, ['/data/items', '/items', '/data/users', '/users', '/data/list']);
  const users = usersArray === undefined
    ? undefined
    : usersArray.items.slice(0, 50).map((item) => ({
        id: pointerFirst(item, ['id', 'user_id'])?.value,
        email: pointerFirst(item, ['email', 'username'])?.value,
        balance: num(pointerFirst(item, ['balance'])?.value, undefined),
        frozen: num(pointerFirst(item, ['frozen_balance'])?.value, undefined),
        recharged: num(pointerFirst(item, ['total_recharged'])?.value, undefined),
        status: pointerFirst(item, ['status', 'is_active'])?.value,
      }));

  return {
    ok: warningFree(steps, warnings),
    mode: plan?.mode ?? detectMode(cfg),
    baseUrl: cfg.baseUrl,
    at: at.toISOString(),
    latencyMs,
    currency: cfg.currency,
    currencySymbol: cfg.currencySymbol,
    lowBalance: cfg.lowBalance,
    range: plan?.range,
    credentialHint: maskSecret(cfg.credential),
    headline: {
      balance: balance?.value,
      balancePointer: balance?.pointer,
      frozen: frozen?.value,
      recharged: recharged?.value,
      used: used?.value,
      limit: limit?.value,
      remaining: remaining?.value,
      quotaMode: quotaMode === undefined ? undefined : String(quotaMode),
    },
    subscription,
    rateLimits,
    totals,
    today,
    models,
    daily,
    users,
    user,
    fields: scalarFields(primary),
    warnings,
    raw: steps.map((step) => ({ id: step.id, label: step.label, url: step.url, status: step.status, json: step.json })),
  };
}

function warningFree(steps, warnings) {
  return warnings.length === 0 && steps.every((step) => step.error === undefined);
}

/** Human-readable summary used by the sidebar chip and the plugin logs. */
export function headlineText(snapshot) {
  const value = snapshot?.headline?.balance ?? snapshot?.headline?.remaining;
  if (value === undefined || value === null) return '—';
  return `${snapshot.currencySymbol ?? '$'}${Number(value).toFixed(2)}`;
}

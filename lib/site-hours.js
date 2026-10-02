/**
 * The site's own hourly endpoint.
 *
 * The panel samples hours locally (lib/samples.js) because a site key cannot
 * reach the site's hourly API. A *logged-in* token can:
 *
 *   POST /api/v1/auth/login                → access_token (JWT)
 *   GET  /api/v1/usage/dashboard/trend
 *        ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&granularity=hour&timezone=…
 *        → { code: 0, data: { trend: [ { date, requests, total_tokens,
 *             input_tokens, output_tokens, cache_creation_tokens,
 *             cache_read_tokens, cost, actual_cost, total_cost } ] } }
 *
 * Both the endpoint and the response field names come from the site's own
 * frontend bundle (its `usage` API module and the dashboard chart), not from a
 * guess — but the exact `date` label format is not visible in the minified
 * code, so parsing accepts every plausible shape and anything unparseable is
 * counted and reported instead of being silently dropped.
 *
 * This is opt-in (`hourlySource: 'site'`) and every failure falls back to the
 * local samples with the reason shown in the panel.
 */
import { hourKey, hourKeysEndingAt } from './samples.js';

export const SITE_TREND_PATH = '/api/v1/usage/dashboard/trend';

function str(value, fallback = '') {
  return typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value);
}

function finite(...candidates) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const number = Number(candidate);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function joinUrl(baseUrl, path) {
  const base = str(baseUrl).replace(/\/+$/, '');
  const suffix = str(path);
  if (suffix === '') return base;
  return `${base}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
}

/**
 * The site formats bucket labels in the timezone we ask for, so a wall-clock
 * reading is preferred; a real ISO timestamp (with Z or an offset) is converted
 * through the same timezone the rest of the plugin uses.
 */
export function hourKeyFromLabel(label, timezone) {
  const text = str(label).trim();
  if (text === '') return null;
  const wall = /^(\d{4}-\d{2}-\d{2})[T ](\d{2})(?::(\d{2}))?/.exec(text);
  if (wall !== null && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return `${wall[1]}T${wall[2]}:00`;
  }
  const when = new Date(text);
  if (Number.isNaN(when.getTime())) return null;
  return hourKey(when, timezone);
}

/**
 * Trend rows → the same bucket shape the local sampler produces, so the chart,
 * the table and the CSV export need no special case. Rows outside the window are
 * ignored (the site returns whole days when the range crosses midnight), and
 * duplicate hours are summed (the endpoint may well be per-model).
 */
export function windowFromTrend(trend, { timezone, now, hours }) {
  const keys = hourKeysEndingAt(now, timezone, hours);
  const buckets = new Map(keys.map((key) => [key, { hour: key, cost: 0, actual: 0, requests: 0, tokens: 0, spanMin: null, partial: false, source: 'site', seen: false }]));
  let matched = 0;
  let skipped = 0;
  let unparsed = 0;
  for (const row of Array.isArray(trend) ? trend : []) {
    if (row === null || typeof row !== 'object') {
      unparsed += 1;
      continue;
    }
    const key = hourKeyFromLabel(row.date ?? row.hour ?? row.time ?? row.bucket, timezone);
    if (key === null) {
      unparsed += 1;
      continue;
    }
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      skipped += 1;
      continue;
    }
    bucket.cost += finite(row.cost, row.total_cost);
    bucket.actual += finite(row.actual_cost, row.actual);
    bucket.requests += finite(row.requests, row.request_count);
    bucket.tokens += finite(row.total_tokens, row.tokens);
    bucket.seen = true;
    matched += 1;
  }
  const ordered = keys.map((key) => {
    const bucket = buckets.get(key);
    if (bucket.seen !== true) return { hour: key, missing: true, source: 'site' };
    const { seen, ...rest } = bucket;
    return { ...rest, cost: round6(rest.cost), actual: round6(rest.actual) };
  });
  return {
    source: 'site',
    hours: keys.length,
    from: keys[0],
    to: keys[keys.length - 1],
    buckets: ordered,
    matched,
    skipped,
    unparsed,
    sampledHours: ordered.filter((bucket) => bucket.missing !== true).length,
  };
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

async function requestJson(url, init, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text.trim() === '' ? null : JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function classify(status, message, text) {
  const body = `${message} ${text}`.toLowerCase();
  if (status === 401 || body.includes('invalid token') || body.includes('unauthorized')) {
    return {
      code: 'auth',
      message: `站点拒绝了登录令牌（${status || '无状态码'}）：${message || 'Invalid token'}`,
      hint: '「小时数据来源」用站点接口时必须是登录令牌：在「账号」模式填邮箱密码，或把浏览器里的 auth_token 直接填进凭证框。',
    };
  }
  if (status === 403) {
    return { code: 'forbidden', message: `站点返回 403：${message || '无权限'}`, hint: '该令牌没有 dashboard 权限。' };
  }
  if (status === 404) {
    return { code: 'notfound', message: `站点没有这个接口（404）：${message || ''}`, hint: '核对「小时趋势路径」，或确认站点版本是否有 /usage/dashboard/trend。' };
  }
  return { code: 'upstream', message: message || `HTTP ${status}`, hint: '小时数据已退回本机采样，按天视图不受影响。' };
}

/**
 * Fetch one window of site-side hours. Never throws: the host shows the reason
 * and keeps using the local samples.
 */
export async function fetchSiteHours(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const timezone = str(options.timezone ?? config.timezone, 'UTC');
  const hours = Math.max(1, Math.trunc(Number(options.hours ?? config.hourlyHours) || 24));
  const timeoutMs = Math.max(1000, Math.trunc(Number(config.timeoutMs) || 15000));
  const fail = (error) => ({ ok: false, error });

  let token = str(config.credential).trim();
  try {
    if (token === '') {
      const email = str(config.email).trim();
      const password = str(config.password);
      if (email === '' || password === '') {
        return fail({
          code: 'config',
          message: '站点小时数据需要登录：没有可用的访问令牌',
          hint: '在「账号」模式填邮箱与密码，或把 auth_token 填进凭证框；也可以把「小时数据来源」切回本机采样。',
        });
      }
      const login = await requestJson(joinUrl(config.baseUrl, config.paths.login), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email, password }),
      }, timeoutMs, fetchImpl);
      if (login.status < 200 || login.status >= 300) {
        return fail(classify(login.status, str(login.json?.message), login.text));
      }
      const payload = login.json?.code !== undefined && Number(login.json?.code) === 0 ? login.json.data ?? {} : login.json ?? {};
      token = str(payload.access_token ?? payload.token ?? payload.accessToken).trim();
      if (token === '') {
        return fail({
          code: 'auth',
          message: '登录成功但响应里没有 access_token',
          hint: '如果账号开了两步验证，站点会要求 /auth/login/2fa：这种情况请把浏览器里的 auth_token 直接填进凭证框。',
        });
      }
    }

    const keys = hourKeysEndingAt(now, timezone, hours);
    const iso = (key) => key.slice(0, 10);
    const url = new URL(joinUrl(config.baseUrl, config.paths.trend));
    url.searchParams.set('start_date', iso(keys[0]));
    url.searchParams.set('end_date', iso(keys[keys.length - 1]));
    url.searchParams.set('granularity', 'hour');
    url.searchParams.set('timezone', timezone);

    const response = await requestJson(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'accept-language': 'zh-CN' },
    }, timeoutMs, fetchImpl);
    if (response.status < 200 || response.status >= 300) {
      return fail(classify(response.status, str(response.json?.message), response.text));
    }
    let payload = response.json;
    if (payload !== null && typeof payload === 'object' && payload.code !== undefined) {
      const numeric = Number(payload.code);
      if (!(numeric === 0 || Number.isNaN(numeric))) {
        return fail(classify(response.status, str(payload.message), response.text));
      }
      payload = payload.data ?? payload;
    }
    const trend = Array.isArray(payload) ? payload : payload?.trend;
    if (!Array.isArray(trend)) {
      return fail({
        code: 'shape',
        message: '站点返回里没有 trend 数组',
        hint: '小时数据退回本机采样；如果站点版本不同，把「小时趋势路径」改成正确的接口。',
      });
    }
    const window = windowFromTrend(trend, { timezone, now, hours });
    return { ok: true, window };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return fail({
      code: aborted ? 'timeout' : 'network',
      message: aborted ? `请求超时（${timeoutMs}ms）` : `请求失败：${error?.message ?? String(error)}`,
      hint: '小时数据已退回本机采样。',
    });
  }
}

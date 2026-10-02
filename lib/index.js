/**
 * Sub2API usage — host half.
 *
 * Serves the browser half over same-origin HTTP and performs every upstream
 * request from Node, so the GUI never needs CORS on the Sub2API site and the
 * credential never reaches the page:
 *
 *   GET  /sub2api-usage/api/state    → masked config + last snapshot + hourly window
 *   POST /sub2api-usage/api/config   → persist a patch (credential tri-state)
 *   POST /sub2api-usage/api/query    → query with the saved config (+ sample the hour)
 *   POST /sub2api-usage/api/test     → query with a candidate config, unsaved
 *
 * Only loopback callers are served: this route holds a credential and can be
 * pointed at an arbitrary endpoint, so it must not be reachable from the LAN.
 */
import { join } from 'node:path';

import { QueryError, headlineText, normalizeConfig, publicConfig } from './core.js';
import { runQuery } from './query.js';
import { HOURLY_FILE, createSampler } from './samples.js';
import { fetchSiteHours } from './site-hours.js';
import { ConfigStore } from './store.js';

export const name = 'sub2api-usage';
export const inject = ['webServer'];

const PREFIX = '/sub2api-usage/api';
const MAX_BODY_BYTES = 256 * 1024;
const LOG_PREFIX = '[sub2api-usage]';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
}

function isLoopback(req) {
  const remote = req.socket?.remoteAddress ?? '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString('utf8');
      if (data.length > MAX_BODY_BYTES) {
        reject(new QueryError('config', '请求体过大', ''));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const text = await readBody(req);
  if (text.trim() === '') return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('必须是 JSON 对象');
    }
    return parsed;
  } catch (error) {
    throw new QueryError('config', `请求体不是合法 JSON：${error.message}`, '');
  }
}

function errorBody(error) {
  if (error instanceof QueryError) {
    return { ok: false, error: { code: error.code, message: error.message, hint: error.hint, status: error.status ?? 0 } };
  }
  return { ok: false, error: { code: 'internal', message: error?.message ?? String(error), hint: '查看 DSH 日志中的 [sub2api-usage] 行。', status: 0 } };
}

/** Wrap a query so the response is always `{ ok, snapshot }` or `{ ok:false, error }`. */
async function queryWith(config, options) {
  try {
    const snapshot = await runQuery(config, options);
    return { ok: true, snapshot };
  } catch (error) {
    return errorBody(error);
  }
}

export function apply(ctx) {
  const store = new ConfigStore();
  /** Last successful snapshot + last failure, so a page reload paints instantly. */
  const last = { snapshot: null, error: null, at: null };
  const controllers = new Set();
  // Hour buckets come from differencing today's running total between queries;
  // the file lives next to the config so it survives a DSH restart.
  const sampler = createSampler({
    file: join(store.dir, HOURLY_FILE),
    warn: (message) => console.warn(`${LOG_PREFIX} ${message}`),
  });

  /** Last site-side hourly window, with the reason it is missing when it failed. */
  const site = { window: null, error: null, at: 0 };

  /**
   * The site endpoint returns the same series on every poll, so one fetch per
   * query is plenty; `/state` reuses the cache for this long.
   */
  const SITE_CACHE_MS = 5 * 60 * 1000;

  /** The hourly window the chart asks for, in the configured timezone. */
  const hourlyWindow = () => {
    const config = store.full();
    const sampled = sampler.read(config.hourlyHours, { timezone: config.timezone });
    if (config.hourlySource !== 'site') return { ...sampled, source: 'sampled' };
    // Site data while it is fresh, local samples otherwise — either way the
    // panel is told which one it is looking at, and why the site failed.
    if (site.window !== null && Date.now() - site.at < SITE_CACHE_MS) {
      return { ...site.window, source: 'site', sampledFallback: false };
    }
    return {
      ...sampled,
      source: 'sampled',
      sampledFallback: true,
      siteError: site.error,
      siteAt: site.at === 0 ? null : new Date(site.at).toISOString(),
    };
  };

  /** Refresh the site-side window (opt-in). Never throws. */
  const refreshSiteHours = async (config) => {
    if (config.hourlySource !== 'site') return;
    const result = await fetchSiteHours(config, { timezone: config.timezone, hours: config.hourlyHours });
    if (result.ok) {
      site.window = result.window;
      site.error = null;
      site.at = Date.now();
      console.log(`${LOG_PREFIX} 站点小时：${result.window.sampledHours}/${result.window.hours} 小时有数据（${result.window.from} → ${result.window.to}）`);
      return;
    }
    site.error = result.error;
    site.window = null;
    site.at = Date.now();
    console.warn(`${LOG_PREFIX} 站点小时失败[${result.error.code}]：${result.error.message}（已退回本机采样）`);
  };

  const remember = (result) => {
    last.at = new Date().toISOString();
    if (result.ok) {
      last.snapshot = result.snapshot;
      last.error = null;
    } else {
      last.error = result.error;
    }
    return result;
  };

  const handler = async (req, res) => {
    if (!isLoopback(req)) {
      sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '仅允许本机访问', hint: '该接口持有凭证，不对外开放。', status: 403 } });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://loopback');
    const raw = url.pathname;
    const stripped = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw;
    const path = stripped.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      if (path === '/state' && method === 'GET') {
        await store.load();
        await sampler.load();
        sendJson(res, 200, {
          ok: true,
          config: publicConfig(store.full()),
          files: store.paths(),
          last,
          hourly: hourlyWindow(),
          version: 1,
        });
        return;
      }

      if (path === '/config' && (method === 'POST' || method === 'PUT')) {
        const patch = await readJsonBody(req);
        const before = normalizeConfig(store.full());
        await store.update(patch);
        const after = normalizeConfig(store.full());
        console.log(`${LOG_PREFIX} 配置已更新：mode=${after.mode} base=${after.baseUrl} interval=${after.intervalSec}s`);
        sendJson(res, 200, { ok: true, config: publicConfig(store.full()), changed: configDiff(before, after) });
        return;
      }

      if (path === '/query' && method === 'POST') {
        const body = await readJsonBody(req);
        await store.load();
        // Only the date window may be overridden per call; never the endpoint.
        const options = {};
        if (typeof body.start === 'string' && typeof body.end === 'string') {
          options.start = body.start;
          options.end = body.end;
        } else if (body.days !== undefined) {
          options.days = body.days;
        }
        const result = remember(await queryWith(store.full(), options));
        if (result.ok) {
          console.log(`${LOG_PREFIX} 查询成功：mode=${result.snapshot.mode} 余额=${headlineText(result.snapshot)} ${result.snapshot.latencyMs}ms`);
          // Every successful response carries today's running total, so this is
          // the cheapest possible sampling point: no extra upstream request.
          const sampled = await sampler.observe(result.snapshot, { timezone: store.full().timezone });
          if (sampled.added === true && sampled.first === false) {
            console.log(`${LOG_PREFIX} 小时采样：${sampled.hour}${sampled.partial === true ? '（含中断时段）' : ''}`);
          }
          await refreshSiteHours(store.full());
        } else {
          console.warn(`${LOG_PREFIX} 查询失败[${result.error.code}]：${result.error.message}`);
        }
        sendJson(res, 200, { ...result, hourly: hourlyWindow() });
        return;
      }

      if (path === '/test' && method === 'POST') {
        const body = await readJsonBody(req);
        await store.load();
        const candidate = { ...store.full(), ...(body.config ?? {}) };
        const result = await queryWith(candidate, {});
        if (result.ok) console.log(`${LOG_PREFIX} 测试连接成功：mode=${result.snapshot.mode}`);
        else console.warn(`${LOG_PREFIX} 测试连接失败[${result.error.code}]：${result.error.message}`);
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: { code: 'notfound', message: `未知接口 ${method} ${path}`, hint: '', status: 404 } });
    } catch (error) {
      console.warn(`${LOG_PREFIX} 请求处理失败：${error?.message ?? error}`);
      sendJson(res, 200, errorBody(error));
    }
  };

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }), 'sub2api-usage: api routes');
  ctx.effect(
    () => () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
    'sub2api-usage: dispose',
  );
  void store.load().catch((error) => {
    console.warn(`${LOG_PREFIX} 配置加载失败（将以默认配置运行）：${error.message}`);
  });
  void sampler.load().catch((error) => {
    console.warn(`${LOG_PREFIX} 小时采样加载失败：${error.message}`);
  });
  console.log(`${LOG_PREFIX} 已挂载 ${PREFIX}（面板 id: sub2api-usage）`);
}

/** Shallow diff used only for the "已保存" toast in the UI. */
function configDiff(before, after) {
  const changed = [];
  for (const key of Object.keys(after)) {
    if (key === 'paths' || key === 'custom' || key === 'pointers') {
      for (const field of Object.keys(after[key])) {
        if (before[key][field] !== after[key][field]) changed.push(`${key}.${field}`);
      }
      continue;
    }
    if (before[key] !== after[key]) changed.push(key);
  }
  return changed;
}

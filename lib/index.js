/**
 * Sub2API usage — host half.
 *
 * Serves the browser half over same-origin HTTP and performs every upstream
 * request from Node, so the GUI never needs CORS on the Sub2API site and the
 * credential never reaches the page:
 *
 *   GET  /sub2api-usage/api/state    → masked config + last snapshot
 *   POST /sub2api-usage/api/config   → persist a patch (credential tri-state)
 *   POST /sub2api-usage/api/query    → query with the saved config
 *   POST /sub2api-usage/api/test     → query with a candidate config, unsaved
 *
 * Only loopback callers are served: this route holds a credential and can be
 * pointed at an arbitrary endpoint, so it must not be reachable from the LAN.
 */
import { QueryError, headlineText, normalizeConfig, publicConfig } from './core.js';
import { runQuery } from './query.js';
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
        sendJson(res, 200, {
          ok: true,
          config: publicConfig(store.full()),
          files: store.paths(),
          last,
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
        } else {
          console.warn(`${LOG_PREFIX} 查询失败[${result.error.code}]：${result.error.message}`);
        }
        sendJson(res, 200, result);
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

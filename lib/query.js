/**
 * Network executor for the Sub2API usage plugin: plan → HTTP → snapshot.
 * `fetchImpl` is injectable so the whole path can run against a local mock.
 */
import { QueryError, buildPlan, normalizeConfig, pointerFirst, summarize, unwrapEnvelope, validateBaseUrl } from './core.js';

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Map transport failures onto actionable codes instead of raw stack text. */
export function classifyError(error, url) {
  if (error instanceof QueryError) return error;
  const name = error?.name ?? '';
  const message = messageOf(error);
  if (name === 'TimeoutError' || name === 'AbortError' || /aborted|timeout/i.test(message)) {
    return new QueryError('timeout', `请求超时：${url}`, '调大「超时」，或确认服务地址从本机可访问。', 0);
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return new QueryError('network', `域名解析失败：${url}`, '核对服务地址拼写与 DNS/代理设置。', 0);
  }
  if (/ECONNREFUSED/i.test(message)) {
    return new QueryError('network', `连接被拒绝：${url}`, '目标端口没有服务在监听，或本机防火墙拦截。', 0);
  }
  if (/CERT|certificate|self-signed|UNABLE_TO_VERIFY/i.test(message)) {
    return new QueryError('network', `TLS 校验失败：${message}`, '站点证书不可信；确认地址无误后再考虑直连 http。', 0);
  }
  if (/fetch failed/i.test(message)) {
    return new QueryError('network', `网络请求失败：${url}`, '确认服务地址可达；若站点只在内网，请在能访问它的机器上运行 DSH。', 0);
  }
  return new QueryError('network', `请求失败：${message}`, '检查服务地址与网络。', 0);
}

/** Unwrap an envelope error into a typed failure, keeping the raw payload. */
function failFromBody(json, url, status) {
  const hasCode = json !== null && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'code');
  const rawCode = hasCode ? json.code : 0;
  const code = typeof rawCode === 'number' ? rawCode : Number.parseFloat(String(rawCode));
  const message = json !== null && typeof json === 'object' && typeof json.message === 'string' ? json.message : '';
  // Anything but a numeric 0 — including string codes such as "INVALID_API_KEY" — is a failure.
  if (hasCode && !(code === 0)) {
    try {
      unwrapEnvelope(json);
    } catch (error) {
      // The site's own message wins; the transport status sharpens the code
      // and the hint (a 404 is a path problem even when the body says so).
      if (status === 404) {
        error.code = 'notfound';
        error.hint = hintForStatus(404);
      } else if (status === 401) {
        error.hint = hintForStatus(401);
      }
      error.status = status;
      error.url = url;
      return error;
    }
  }
  const text = message || `HTTP ${status}`;
  return new QueryError(status === 404 ? 'notfound' : 'http', `${text}（HTTP ${status}）`, hintForStatus(status), status);
}

function hintForStatus(status) {
  if (status === 401) return '认证失败：管理员用 admin-… Key（请求头 x-api-key），站点 Key 用 sk-…，或改用账号密码登录。';
  if (status === 403) return '权限不足：该用户名下没有这个资源，或凭证不是管理员。';
  if (status === 404) return '路径不存在：在设置里核对「自定义路径」是否符合该站点的路由。';
  if (status === 429) return '被限流：稍后再试，或调大刷新间隔。';
  if (status >= 500) return '服务端错误：稍后重试，必要时查看站点日志。';
  return '检查服务地址、路径与凭证。';
}

async function readBody(response) {
  const text = await response.text();
  if (text.trim() === '') return { json: undefined, text: '' };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: undefined, text };
  }
}

/**
 * Run one plan: sequential steps, each optionally reusing a token extracted from
 * an earlier step (`useTokenFrom`), then summarize everything into a snapshot.
 */
export async function executePlan(config, plan, options = {}) {
  const cfg = normalizeConfig(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new QueryError('config', '当前 Node 运行时不提供 fetch', '需要 Node 18+。');
  }
  const started = Date.now();
  const tokens = new Map();
  const steps = [];

  for (const step of plan.steps) {
    const headers = { ...step.headers };
    if (step.useTokenFrom !== undefined) {
      const token = tokens.get(step.useTokenFrom);
      if (!token) throw new QueryError('auth', '登录未返回访问令牌', '确认账号密码正确，或站点是否要求两步验证（2FA）。', 0);
      headers.Authorization = `Bearer ${token}`;
    }
    const init = { method: step.method, headers, redirect: 'follow' };
    if (step.body !== undefined) init.body = step.body;
    let record = { id: step.id, label: step.label, url: step.url, method: step.method };

    let response;
    try {
      response = await fetchImpl(step.url, { ...init, signal: AbortSignal.timeout(cfg.timeoutMs) });
    } catch (error) {
      const failure = classifyError(error, step.url);
      record = { ...record, error: failure.message, hint: failure.hint, code: failure.code };
      steps.push(record);
      throw failure;
    }
    const { json, text } = await readBody(response);
    record.status = response.status;

    if (!response.ok) {
      const failure = failFromBody(json, step.url, response.status);
      record.error = failure.message;
      steps.push(record);
      throw failure;
    }
    if (json === undefined) {
      const failure = new QueryError('parse', `${step.label}返回的不是 JSON`, `响应开头：${text.slice(0, 120) || '(空)'}`, response.status);
      record.error = failure.message;
      steps.push(record);
      throw failure;
    }

    record.json = json;
    steps.push(record);

    if (step.useTokenFrom !== undefined || step.id === 'login') {
      let data = json;
      try {
        data = unwrapEnvelope(json);
      } catch {
        data = json;
      }
      const token = pointerFirst(data, ['access_token', 'token', 'accessToken'])?.value;
      if (typeof token === 'string' && token !== '') tokens.set(step.id, token);
    }
  }

  const latencyMs = Date.now() - started;
  return summarize({ config: cfg, plan, steps, latencyMs, at: options.now ?? new Date() });
}

/** Plan + execute in one call. */
export async function runQuery(config, options = {}) {
  const cfg = normalizeConfig(config);
  const check = validateBaseUrl(cfg.baseUrl);
  if (!check.ok) throw new QueryError('config', check.reason, '在设置里填写形如 https://example.com 的地址。');
  const plan = buildPlan(cfg, options, options.now ?? new Date());
  return executePlan(cfg, plan, options);
}

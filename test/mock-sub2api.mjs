/**
 * A local stand-in for a Sub2API deployment, used by the tests (and by the
 * manual "point the plugin at this mock" round trip).
 *
 *   node test/mock-sub2api.mjs [port]
 *
 * Set MOCK_ANY_KEY=1 to accept any credential. That is only for capturing
 * screenshots from a real install without retyping its key; the tests never set
 * it, so the strict 401 paths stay covered.
 */
import { createServer } from 'node:http';

export const ADMIN_KEY = 'admin-' + 'a'.repeat(64);
export const SITE_KEY = 'sk-testkey1234567890';
export const USER_TOKEN = 'tok-user-123';
export const EMAIL = 'alice@example.com';
export const PASSWORD = 'secret-password';
export const ANY_KEY = process.env.MOCK_ANY_KEY === '1';

const USERS = {
  123: { id: 123, email: 'alice@example.com', username: 'alice', balance: 42.5, frozen_balance: 1.25, total_recharged: 300, status: 'active' },
  456: { id: 456, email: 'bob@example.com', username: 'bob', balance: 3.75, frozen_balance: 0, total_recharged: 50, status: 'active' },
};

function envelope(data) {
  return JSON.stringify({ code: 0, message: 'success', data });
}

function send(res, status, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  if (text.trim() === '') return {};
  return JSON.parse(text);
}

/** @returns the node http server (not yet listening). */
export function createMockSub2Api() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const auth = req.headers.authorization ?? '';
    const apiKey = req.headers['x-api-key'] ?? '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (url.pathname === '/health') {
      send(res, 200, { status: 'ok' });
      return;
    }

    if (url.pathname === '/api/v1/admin/users' && req.method === 'GET') {
      if (apiKey !== ADMIN_KEY && bearer !== ADMIN_KEY) {
        send(res, 401, { code: 401, message: 'Invalid admin API key' });
        return;
      }
      const search = url.searchParams.get('search') ?? '';
      const items = Object.values(USERS).filter((user) => search === '' || user.email.includes(search));
      send(res, 200, envelope({ items, total: items.length, page: Number(url.searchParams.get('page') ?? 1), page_size: Number(url.searchParams.get('page_size') ?? 20), pages: 1 }));
      return;
    }

    const adminUser = url.pathname.match(/^\/api\/v1\/admin\/users\/(\d+)$/);
    if (adminUser) {
      if (apiKey !== ADMIN_KEY && bearer !== ADMIN_KEY) {
        send(res, 401, { code: 401, message: 'Invalid admin API key' });
        return;
      }
      const user = USERS[adminUser[1]];
      if (!user) {
        send(res, 404, { code: 404, message: 'user not found' });
        return;
      }
      send(res, 200, envelope(user));
      return;
    }

    if (url.pathname === '/api/v1/auth/login' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.email !== EMAIL || body.password !== PASSWORD) {
        send(res, 401, { code: 401, message: 'invalid credentials' });
        return;
      }
      send(res, 200, envelope({ access_token: USER_TOKEN, refresh_token: 'refresh-1', expires_in: 3600 }));
      return;
    }

    if (url.pathname === '/api/v1/auth/me' || url.pathname === '/api/v1/user/profile') {
      if (bearer !== USER_TOKEN) {
        send(res, 401, { code: 401, message: 'Authorization header is required' });
        return;
      }
      send(res, 200, envelope(USERS[123]));
      return;
    }

    if (url.pathname === '/v1/usage') {
      if (bearer !== SITE_KEY && !ANY_KEY) {
        send(res, 401, { code: 'INVALID_API_KEY', message: 'Invalid API key' });
        return;
      }
      const start = url.searchParams.get('start_date');
      const end = url.searchParams.get('end_date');
      const timezone = url.searchParams.get('timezone');
      if (!start || !end || !timezone) {
        send(res, 400, { code: 400, message: 'start_date/end_date/timezone are required' });
        return;
      }
      send(
        res,
        200,
        envelope({
          balance: 12.34,
          mode: 'quota_limited',
          quota: { used: 3.66, limit: 16, remaining: 12.34 },
          subscription: {
            daily_usage_usd: 0.42,
            daily_limit_usd: 5,
            weekly_usage_usd: 2.1,
            weekly_limit_usd: 20,
            monthly_usage_usd: 7.5,
            monthly_limit_usd: 60,
          },
          rate_limits: [
            { window: '1m', used: 3, limit: 60, remaining: 57, reset_at: '2026-10-01T12:01:00Z' },
            { window: '1h', used: 120, limit: 1000, remaining: 880, reset_at: '2026-10-01T13:00:00Z' },
          ],
          total: { requests: 4210, tokens: 1234567, cost_usd: 7.5 },
          model_stats: [
            { model: 'claude-sonnet-4-5', requests: 2100, tokens: 800000, cost_usd: 5.2 },
            { model: 'deepseek-chat', requests: 2110, tokens: 434567, cost_usd: 2.3 },
          ],
          daily_usage: Array.from({ length: 14 }, (_, index) => {
            const day = new Date(`${end}T00:00:00Z`);
            day.setUTCDate(day.getUTCDate() - (13 - index));
            const iso = day.toISOString().slice(0, 10);
            const wave = [0.2, 0.35, 0.1, 0.8, 1.4, 0.6, 0.25, 0.9, 1.1, 0.4, 0.15, 0.7, 1.2, 0.9][index] ?? 0.5;
            return {
              date: iso,
              cost_usd: Number((wave * 3).toFixed(2)),
              actual_cost: Number((wave * 3 * 0.92).toFixed(2)),
              requests: 100 + index * 7,
              total_tokens: 1_200_000 + index * 640_000,
            };
          }),
        }),
      );
      return;
    }

    // Custom-mode target: a bare (unwrapped) payload with a nested balance.
    if (url.pathname === '/custom/credits') {
      if (req.headers['x-token'] !== 'custom-token') {
        send(res, 401, { error: 'bad token' });
        return;
      }
      send(res, 200, { result: { wallet: { amount: 88.8, currency: 'USD' }, spent: 11.2, cap: 100 }, note: 'custom endpoint' });
      return;
    }

    if (url.pathname === '/slow') {
      setTimeout(() => send(res, 200, envelope({ balance: 1 })), 3000);
      return;
    }

    if (url.pathname === '/not-json') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>hello</html>');
      return;
    }

    send(res, 404, { code: 404, message: 'not found' });
  });
}

/** Start the mock on an ephemeral port; resolves to `{ server, baseUrl, close }`. */
export async function startMockSub2Api() {
  const server = createMockSub2Api();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && process.argv[1].endsWith('mock-sub2api.mjs')) {
  const port = Number(process.argv[2] ?? 8799);
  createMockSub2Api().listen(port, '127.0.0.1', () => {
    console.log(`mock sub2api on http://127.0.0.1:${port}`);
  });
}

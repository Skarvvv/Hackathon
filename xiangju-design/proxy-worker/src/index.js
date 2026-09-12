/**
 * 乡居设计通 · 大模型服务端代理（Cloudflare Worker）
 *
 * 作用：
 *  1. 把 DEEPSEEK_API_KEY 保存在 Worker Secret 中，浏览器端不持有任何密钥；
 *  2. 统一加上 CORS 头，解决静态网页直连的跨域问题；
 *  3. 只放行 /chat/completions，限制请求体大小，可选 APP_TOKEN 防盗刷；
 *  4. 可强制锁定模型（FORCE_MODEL），避免密钥被人拿去刷其他贵模型。
 *
 * 绑定（Secrets，用 `npx wrangler secret put <NAME>` 设置，绝不写进代码）：
 *  - DEEPSEEK_API_KEY  必填  sk-...
 *  - APP_TOKEN         选填  前端在“大模型设置”里填的访问口令（X-App-Token）
 *
 * 环境变量（wrangler.jsonc 的 vars）：
 *  - UPSTREAM_URL      默认 https://api.deepseek.com
 *  - FORCE_MODEL       默认 deepseek-chat；留空则透传
 *  - ALLOWED_ORIGINS   选填，逗号分隔的来源白名单
 */

const MAX_BODY_BYTES = 96 * 1024; // 本应用每次请求体很小，96KB 足够

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/healthz') {
        return json({
          ok: true,
          service: 'xiangju-llm-proxy',
          keyConfigured: !!(env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY.length > 8),
          tokenRequired: !!env.APP_TOKEN,
          forceModel: env.FORCE_MODEL || ''
        }, 200, cors);
      }

      if (request.method !== 'POST' || !/^\/(v1\/)?chat\/completions\/?$/.test(url.pathname)) {
        return json({ error: { message: '只接受 POST /v1/chat/completions' } }, 404, cors);
      }

      /* 防盗刷：可选 APP_TOKEN，做时序安全比较 */
      if (env.APP_TOKEN) {
        const got = request.headers.get('X-App-Token') || '';
        if (!safeEqual(got, env.APP_TOKEN)) {
          return json({ error: { message: '代理访问口令不对（X-App-Token）' } }, 401, cors);
        }
      }

      /* 请求体大小硬限制，防超大请求刷流量 */
      const len = Number(request.headers.get('Content-Length') || 0);
      if (len > MAX_BODY_BYTES) {
        return json({ error: { message: '请求体超过 ' + MAX_BODY_BYTES + ' 字节限制' } }, 413, cors);
      }
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) {
        return json({ error: { message: '请求体超过大小限制' } }, 413, cors);
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch (e) {
        return json({ error: { message: '请求体不是合法 JSON' } }, 400, cors);
      }
      if (env.FORCE_MODEL) body.model = env.FORCE_MODEL; // 锁定模型
      if (!body.model) body.model = 'deepseek-chat';

      if (!env.DEEPSEEK_API_KEY) {
        return json({ error: { message: '服务端未配置 DEEPSEEK_API_KEY，请先 wrangler secret put' } }, 500, cors);
      }

      const upstream = (env.UPSTREAM_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
      const resp = await fetch(upstream + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.DEEPSEEK_API_KEY
        },
        body: JSON.stringify(body)
      });

      const text = await resp.text();
      return new Response(text, {
        status: resp.status,
        headers: {
          'Content-Type': resp.headers.get('Content-Type') || 'application/json; charset=utf-8',
          ...cors
        }
      });
    } catch (err) {
      return json({
        error: { message: '代理服务异常：' + (err && err.message ? err.message : 'unknown') }
      }, 502, cors);
    }
  }
};

function corsHeaders(origin, env) {
  const allow = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allow.length === 0 || allow.includes(origin)
    ? (origin || '*')
    : allow[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors }
  });
}

/* Web Crypto 无 timingSafeEqual（那是 Node API），手写定长常量时间比较 */
function safeEqual(a, b) {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

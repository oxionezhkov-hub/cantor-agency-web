'use strict';

// Прокладка между дашбордом (cantor.agency/dashboard) и воркером Cloudflare.
// Адрес functions.yandexcloud.net открывается из РФ без VPN, а *.workers.dev
// у многих провайдеров тормозит или не грузится. Функция просто пересылает
// запрос дашборда в воркер и отдаёт ответ как есть.
//
// Дашборд зовёт: <адрес функции>?p=<путь воркера с query>, например
//   ?p=%2Fapi%2Fdashboard%2Fbootstrap
// Пропускаются только пути /api/dashboard/* — это не открытый прокси.
// И ещё GET /feed/<клиент>/… — XML-фиды автозагрузки и их фото: Авито забирает
// их по ссылке, а workers.dev из РФ открывается не всегда (FEEDS_PROXY_URL в воркере).
// Сюда же входит API стажировки (cantor.agency/academy → /api/dashboard/academy/*).

const TARGET_ORIGIN = process.env.TARGET_ORIGIN || 'https://mainweb.oxion-ezhkov.workers.dev';
const FORWARD_HEADERS = ['content-type', 'x-dashboard-password'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-dashboard-password',
  'Access-Control-Max-Age': '86400',
};

function header(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

// Воркер → API Авито с российского адреса: ?p=/avito-api/<путь Авито>. С серверов Cloudflare
// api.avito.ru с 19.10.2026 почти не отвечает (таймауты, 522), а отсюда — как обычно.
// Только api.avito.ru и только с ключом, если в функции задан PROXY_KEY (тот же — в воркере,
// секрет AVITO_PROXY_KEY).
const AVITO_ORIGIN = 'https://api.avito.ru';
const AVITO_HEADERS = ['authorization', 'content-type', 'x-source'];

async function avitoForward(event, method, avitoPath) {
  const json = (statusCode, data) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'X-Avito-Proxy-Error': '1' }, body: JSON.stringify(data) });
  if (process.env.PROXY_KEY && header(event, 'x-proxy-key') !== process.env.PROXY_KEY) return json(403, { error: 'bad_key' });
  let url;
  try { url = new URL(avitoPath, AVITO_ORIGIN); } catch (e) { return json(400, { error: 'bad_path' }); }
  if (url.origin !== AVITO_ORIGIN) return json(400, { error: 'bad_path' });
  const headers = {};
  AVITO_HEADERS.forEach((name) => {
    const value = header(event, name);
    if (value) headers[name] = value;
  });
  let body;
  if (method !== 'GET' && method !== 'HEAD' && event.body) body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
  try {
    const res = await fetch(url.toString(), { method, headers, body, signal: AbortSignal.timeout(25000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const isText = /json|text|xml|form/.test(contentType);
    const out = { 'Content-Type': contentType };
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining !== null) out['X-RateLimit-Remaining'] = remaining;
    return { statusCode: res.status, headers: out, body: isText ? buf.toString('utf8') : buf.toString('base64'), isBase64Encoded: !isText };
  } catch (e) {
    return json(504, { error: 'avito_unreachable', message: String(e && e.message) });
  }
}

module.exports.handler = async function (event) {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const path = (event.queryStringParameters || {}).p || '';
  if (path.startsWith('/avito-api/')) return avitoForward(event, method, path.slice('/avito-api'.length));
  const isFeed = (method === 'GET' || method === 'HEAD') && /^\/feed\/[a-z0-9-]{4,60}\/(avito\.xml|img\/[0-9a-f]{20}\/[A-Za-z0-9_-]+\.[a-z]{3,4})$/.test(path);
  if (!isFeed && !/^\/api\/dashboard\/[A-Za-z0-9/_-]*(\?.*)?$/.test(path)) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'bad_path' }) };
  }

  const headers = {};
  FORWARD_HEADERS.forEach((name) => {
    const value = header(event, name);
    if (value) headers[name] = value;
  });
  let body;
  if (method !== 'GET' && method !== 'HEAD' && event.body) {
    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
  }

  try {
    const res = await fetch(TARGET_ORIGIN + path, { method, headers, body, signal: AbortSignal.timeout(28000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const isText = /json|text|xml/.test(contentType);
    const out = { ...CORS, 'Content-Type': contentType };
    const disposition = res.headers.get('content-disposition');
    if (disposition) out['Content-Disposition'] = disposition;
    return {
      statusCode: res.status,
      headers: out,
      body: isText ? buf.toString('utf8') : buf.toString('base64'),
      isBase64Encoded: !isText,
    };
  } catch (e) {
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'upstream_failed', message: String(e && e.message) }) };
  }
};

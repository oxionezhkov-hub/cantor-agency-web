'use strict';

// Прокладка между дашбордом (cantor.agency/dashboard) и воркером Cloudflare.
// Адрес functions.yandexcloud.net открывается из РФ без VPN, а *.workers.dev
// у многих провайдеров тормозит или не грузится. Функция просто пересылает
// запрос дашборда в воркер и отдаёт ответ как есть.
//
// Дашборд зовёт: <адрес функции>?p=<путь воркера с query>, например
//   ?p=%2Fapi%2Fdashboard%2Fbootstrap
// Пропускаются только пути /api/dashboard/* — это не открытый прокси.

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

module.exports.handler = async function (event) {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const path = (event.queryStringParameters || {}).p || '';
  if (!/^\/api\/dashboard\/[A-Za-z0-9/_-]*(\?.*)?$/.test(path)) {
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
    const isText = /json|text/.test(contentType);
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

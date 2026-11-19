'use strict';


const COLUMNS = [
  'Имя ученика',
  'Фамилия ученика',
  'Класс',
  'Предмет',
  'Цель и описание ситуации',
  'Имя и отчество родителя',
  'Телефон',
  'Email',
];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function list(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function mskNow() {
  return new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

// Поля в порядке формы, потом всё, что форма прислала сверх списка.
function orderedEntries(fields) {
  const keys = [...COLUMNS.filter((k) => k in fields), ...Object.keys(fields).filter((k) => !COLUMNS.includes(k))];
  return keys.map((k) => [k, fields[k]]);
}

async function appendToSheet(fields) {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  const spreadsheetId = process.env.SPREADSHEET_ID?.trim();
  if (!keyJson || !spreadsheetId) return 'skipped';

  const { google } = require('googleapis');
  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const sheetName = process.env.SHEET_NAME?.trim() || 'Заявки';
  const row = [mskNow(), ...COLUMNS.map((k) => fields[k] || '')];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'!A:I`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  }, { timeout: 7000, retry: false });
  return 'sent';
}

async function sendEmail(fields) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = list(process.env.ADMIN_EMAIL);
  const from = process.env.MAIL_FROM?.trim();
  if (!apiKey?.trim() || !to.length || !from) return 'skipped';

  const entries = orderedEntries(fields);
  const name = [fields['Имя ученика'], fields['Фамилия ученика']].filter(Boolean).join(' ');
  const text = `Новая заявка с сайта (${mskNow()} МСК)\n\n`
    + entries.map(([k, v]) => `${k}: ${v}`).join('\n');
  const html = `<p><b>Новая заявка с сайта</b> (${escapeHtml(mskNow())} МСК)</p>`
    + '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">'
    + entries.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top">${escapeHtml(k)}</td>`
      + `<td style="white-space:pre-wrap">${escapeHtml(v)}</td></tr>`).join('')
    + '</table>';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        ...(fields['Email'] ? { reply_to: fields['Email'] } : {}),
        subject: `Новая заявка на диагностику — Карлова${name ? ` — ${name}` : ''}`,
        text,
        html,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`resend_http_${res.status}`);
  } finally {
    clearTimeout(timer);
  }
  return 'sent';
}

async function sendTelegram(fields) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatIds = list(process.env.TELEGRAM_CHAT_ID);
  const relayUrl = process.env.TELEGRAM_RELAY_URL?.trim();
  const relaySecret = process.env.TELEGRAM_RELAY_SECRET?.trim();
  if (!token || !chatIds.length || !relayUrl || !relaySecret) return 'skipped';
  let url;
  try { url = new URL(relayUrl); } catch { throw new Error('relay_url_invalid'); }
  if (url.protocol !== 'https:') throw new Error('relay_https_required');
  const text = 'Новая заявка на диагностику — Карлова\n\n'
    + orderedEntries(fields).map(([key, value]) => `${key}: ${value}`).join('\n');
  let res;
  try { res = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${relaySecret}`,
    },
    body: JSON.stringify({ token, chatIds, text }),
    signal: AbortSignal.timeout(20000),
  }); } catch (error) {
    throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'relay_timeout' : 'relay_unreachable');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const codes = Array.isArray(data?.failureCodes) ? data.failureCodes : [];
    const allowed = ['bot_unauthorized', 'chat_not_found', 'bot_blocked', 'telegram_forbidden', 'telegram_rate_limited', 'telegram_rejected', 'telegram_unreachable', 'telegram_timeout'];
    const reason = codes.find(code => allowed.includes(code));
    throw new Error(reason || `relay_http_${res.status}`);
  }
  if (!data?.ok) throw new Error('relay_invalid_response');
  return 'sent';
}

module.exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const body = parseBody(event);
  const fields = body && typeof body.fields === 'object' && body.fields && !Array.isArray(body.fields) ? body.fields : {};

  const cleanFields = Object.create(null);
  for (const [label, value] of Object.entries(fields)) {
    const clean = String(value || '').trim().slice(0, 4000);
    if (clean) cleanFields[String(label).slice(0, 100)] = clean;
  }

  if (Object.keys(cleanFields).length === 0) {
    return jsonResponse(400, { error: 'empty_fields' });
  }

  const channels = { sheet: appendToSheet, email: sendEmail, telegram: sendTelegram };
  const names = Object.keys(channels);
  const settled = await Promise.allSettled(names.map((n) => channels[n](cleanFields)));

  const result = {};
  const diagnostics = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') result[names[i]] = r.value;
    else {
      result[names[i]] = 'failed';
      const code = String(r.reason?.message || '');
      if (names[i] === 'telegram') {
        diagnostics.telegram = /^(relay_(url_invalid|https_required|timeout|unreachable|invalid_response|http_[0-9]{3})|bot_unauthorized|chat_not_found|bot_blocked|telegram_(forbidden|rate_limited|rejected|unreachable|timeout))$/.test(code) ? code : 'telegram_failed';
      }
      if (names[i] === 'email') {
        diagnostics.email = /^resend_http_[0-9]{3}$/.test(code) ? code
          : ['TimeoutError', 'AbortError'].includes(r.reason?.name) ? 'email_timeout' : 'email_delivery_failed';
      }
      console.error(`${names[i]}_failed`, diagnostics[names[i]] || 'delivery_failed');
    }
  });

  if (!Object.values(result).includes('sent')) {
    return jsonResponse(502, { error: 'delivery_failed', result, diagnostics });
  }
  return jsonResponse(200, { ok: true, result, diagnostics });
};

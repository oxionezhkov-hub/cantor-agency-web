'use strict';

const { google } = require('googleapis');

// ── env vars you set in Yandex Cloud Console → your function → Редактор → Переменные окружения ──
//   GOOGLE_SERVICE_ACCOUNT_KEY  — весь JSON-ключ сервисного аккаунта, в одну строку (тот же, что у Анны Дейнеги / Светланы Идрисовой / Авито)
//   SPREADSHEET_ID              — ID таблицы, куда сейчас пишет анкета (из её ссылки, между /d/ и /edit)
//   SHEET_NAME                  — название листа, необязательно, по умолчанию "ЭДВАЙЗЕРЫ"

// Порядок колонок A–P — тот же, в котором анкета отправляет поля в Apps Script,
// чтобы строки от функции и от запасного прямого канала ложились одинаково.
// Колонка на каждое направление своя (по id канала из CHANNELS в adviser-anketa),
// а не по видимому названию — так порядок не зависит от того, что выбрал человек.
const COLUMNS = [
  'timestamp',
  'name',
  'telegram',
  'phone',
  'channels',
  'result_avito',
  'result_profi',
  'result_reels',
  'result_bloggers',
  'result_vk',
  'result_yandex',
  'result_telegram',
  'result_youtube',
  'result_smm',
  'result_funnel',
  'result_other',
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

async function appendToSheet(fields) {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const spreadsheetId = process.env.SPREADSHEET_ID;
  // Без настроек функция не должна отвечать "ok" — иначе анкета решит, что
  // заявка записана, и не попробует запасной канал.
  if (!keyJson || !spreadsheetId) throw new Error('missing_google_env');

  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const sheetName = process.env.SHEET_NAME || 'ЭДВАЙЗЕРЫ';
  const row = COLUMNS.map((key) => fields[key] || '');
  if (!row[0]) row[0] = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:P`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

module.exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const body = parseBody(event);
  const fields = body && typeof body.fields === 'object' ? body.fields : {};

  const cleanFields = {};
  for (const key of COLUMNS) {
    const clean = String(fields[key] || '').trim();
    if (clean) cleanFields[key] = clean;
  }

  if (!cleanFields.name && !cleanFields.telegram && !cleanFields.phone) {
    return jsonResponse(400, { error: 'empty_fields' });
  }

  try {
    await appendToSheet(cleanFields);
  } catch (err) {
    console.error('sheet_append_failed', err && err.message);
    return jsonResponse(502, { error: 'sheet_append_failed' });
  }

  return jsonResponse(200, { ok: true });
};

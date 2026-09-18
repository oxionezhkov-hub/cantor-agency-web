'use strict';

const { google } = require('googleapis');

// ── env vars you set in Yandex Cloud Console → your function → Редактор → Переменные окружения ──
//   GOOGLE_SERVICE_ACCOUNT_KEY  — весь JSON-ключ сервисного аккаунта, в одну строку (тот же, что у Анны Дейнеги)
//   SPREADSHEET_ID              — ID новой таблицы Светланы (из её ссылки, между /d/ и /edit)
//   SHEET_NAME                  — название листа, куда писать строки (например "Заявки"), необязательно, по умолчанию "Заявки"
//   RESEND_API_KEY              — ключ вашего аккаунта Resend (resend.com/api-keys)
//   MAIL_FROM                   — адрес отправителя, ОБЯЗАТЕЛЬНО на домене, подтверждённом в Resend
//                                  (например "Заявки с сайта <leads@cantor.agency>")
//   MAIL_TO                     — куда слать письмо о новой заявке (можно несколько через запятую)

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
  if (!keyJson || !spreadsheetId) return { skipped: true, reason: 'missing_google_env' };

  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const sheetName = process.env.SHEET_NAME || 'Заявки';
  const now = new Date().toISOString();
  const row = [
    now,
    fields['Имя ученика'] || '',
    fields['Фамилия ученика'] || '',
    fields['Класс'] || '',
    fields['Формат занятий'] || '',
    fields['Цель и описание ситуации'] || '',
    fields['Имя и отчество родителя'] || '',
    fields['Телефон'] || '',
    fields['Email'] || '',
    fields['Согласие на рекламную рассылку'] || '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:J`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  return { skipped: false };
}

async function sendEmail(fields) {
  const { RESEND_API_KEY, MAIL_TO, MAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !MAIL_TO || !MAIL_FROM) {
    return { skipped: true, reason: 'missing_resend_env' };
  }

  const rows = Object.entries(fields)
    .filter(([, value]) => value)
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#667;white-space:nowrap;"><b>${label}</b></td><td style="padding:4px 0;">${value}</td></tr>`)
    .join('');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: MAIL_TO.split(',').map((s) => s.trim()),
      subject: 'Новая заявка — сайт Светланы Идрисовой',
      html: `<table cellspacing="0" cellpadding="0">${rows}</table>`,
      text: Object.entries(fields).map(([label, value]) => `${label}: ${value}`).join('\n'),
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`resend_${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return { skipped: false, id: data && data.id };
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
  for (const [label, value] of Object.entries(fields)) {
    const clean = String(value || '').trim();
    if (clean) cleanFields[label] = clean;
  }

  if (Object.keys(cleanFields).length === 0) {
    return jsonResponse(400, { error: 'empty_fields' });
  }

  const results = { sheet: null, email: null };
  try {
    results.sheet = await appendToSheet(cleanFields);
  } catch (err) {
    console.error('sheet_append_failed', err && err.message);
    results.sheet = { error: String(err && err.message) };
  }

  try {
    results.email = await sendEmail(cleanFields);
  } catch (err) {
    console.error('email_send_failed', err && err.message);
    results.email = { error: String(err && err.message) };
  }

  return jsonResponse(200, { ok: true, results });
};

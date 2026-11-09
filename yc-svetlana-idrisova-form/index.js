'use strict';

const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// ── env vars you set in Yandex Cloud Console → your function → Редактор → Переменные окружения ──
// Таблица (необязательно — если не заданы, строка в таблицу не пишется):
//   GOOGLE_SERVICE_ACCOUNT_KEY  — весь JSON-ключ сервисного аккаунта, в одну строку (тот же, что у Анны Дейнеги)
//   SPREADSHEET_ID              — ID таблицы Светланы (из её ссылки, между /d/ и /edit)
//   SHEET_NAME                  — название листа, по умолчанию "Заявки"
// Письмо:
//   SMTP_HOST                   — SMTP-сервер ящика-отправителя, по умолчанию smtp.yandex.ru
//   SMTP_PORT                   — порт, по умолчанию 465 (SSL)
//   SMTP_USER                   — логин ящика-отправителя (полный адрес)
//   SMTP_PASS                   — пароль приложения этого ящика
//   MAIL_FROM                   — от кого, по умолчанию SMTP_USER
//   MAIL_TO                     — кому (можно несколько через запятую), для Светланы kotenok8595@mail.ru
// Telegram:
//   TELEGRAM_BOT_TOKEN          — токен бота (от @BotFather)
//   TELEGRAM_CHAT_ID            — кому слать (можно несколько через запятую), для Светланы 1761494459
//
// Заявка считается принятой, если она дошла хотя бы по одному каналу
// (таблица, почта или Telegram) — иначе форма покажет ошибку.

const COLUMNS = [
  'Имя ученика',
  'Фамилия ученика',
  'Класс',
  'Формат занятий',
  'Цель и описание ситуации',
  'Имя и отчество родителя',
  'Телефон',
  'Email',
  'Согласие на рекламную рассылку',
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
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!keyJson || !spreadsheetId) return 'skipped';

  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const sheetName = process.env.SHEET_NAME || 'Заявки';
  const row = [mskNow(), ...COLUMNS.map((k) => fields[k] || '')];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:J`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  return 'sent';
}

async function sendEmail(fields) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = list(process.env.MAIL_TO);
  if (!user || !pass || !to.length) return 'skipped';

  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.yandex.ru',
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 8000,
  });

  const entries = orderedEntries(fields);
  const name = [fields['Имя ученика'], fields['Фамилия ученика']].filter(Boolean).join(' ');
  const text = `Новая заявка с сайта (${mskNow()} МСК)\n\n`
    + entries.map(([k, v]) => `${k}: ${v}`).join('\n');
  const html = `<p><b>Новая заявка с сайта</b> (${escapeHtml(mskNow())} МСК)</p>`
    + '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">'
    + entries.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top">${escapeHtml(k)}</td>`
      + `<td style="white-space:pre-wrap">${escapeHtml(v)}</td></tr>`).join('')
    + '</table>';

  await transporter.sendMail({
    from: { name: 'Заявки с сайта', address: process.env.MAIL_FROM || user },
    to,
    replyTo: fields['Email'] || undefined,
    subject: `Новая заявка на пробное занятие${name ? ` — ${name}` : ''}`,
    text,
    html,
  });
  return 'sent';
}

async function sendTelegram(fields) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = list(process.env.TELEGRAM_CHAT_ID);
  if (!token || !chatIds.length) return 'skipped';

  const text = '<b>Новая заявка на пробное занятие</b>\n\n'
    + orderedEntries(fields).map(([k, v]) => `<b>${escapeHtml(k)}:</b> ${escapeHtml(v)}`).join('\n');

  const results = await Promise.allSettled(chatIds.map(async (chatId) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(`telegram ${chatId}: ${data.description || res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }));
  const failed = results.filter((r) => r.status === 'rejected');
  failed.forEach((r) => console.error('telegram_failed', r.reason && r.reason.message));
  if (failed.length === results.length) throw new Error('telegram_failed');
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
  const fields = body && typeof body.fields === 'object' && body.fields ? body.fields : {};

  const cleanFields = {};
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
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') result[names[i]] = r.value;
    else {
      result[names[i]] = 'failed';
      console.error(`${names[i]}_failed`, r.reason && r.reason.message);
    }
  });

  if (!Object.values(result).includes('sent')) {
    return jsonResponse(502, { error: 'delivery_failed', result });
  }
  return jsonResponse(200, { ok: true, result });
};

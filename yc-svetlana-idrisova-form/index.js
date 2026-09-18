// Yandex Cloud Function: receives the "trial lesson" form submission from
// client/svetlana-idrisova and appends a row to a Google Sheet.
//
// Required environment variables (set in the Yandex Cloud Function config):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL     — the service account's client_email
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — the service account's private_key,
//                                        with real newlines replaced by \n
//   GOOGLE_SHEET_ID                  — the spreadsheet ID (from its URL)
//   GOOGLE_SHEET_RANGE               — optional, defaults to "Заявки!A:J"
//
// See README.md in this folder for the full setup walkthrough.

const jwt = require('jsonwebtoken');

const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'Заявки!A:J';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) {
    throw new Error('missing_google_service_account_env');
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    privateKey,
    { algorithm: 'RS256' }
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error('google_token_exchange_failed: ' + (await res.text()));
  }
  const data = await res.json();
  return data.access_token;
}

async function appendRow(values) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('missing_google_sheet_id_env');

  const accessToken = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_RANGE)}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [values] }),
  });
  if (!res.ok) {
    throw new Error('sheets_append_failed: ' + (await res.text()));
  }
}

module.exports.handler = async function (event) {
  const method = (event.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (method !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  let payload;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}');
    payload = JSON.parse(raw);
  } catch (err) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'invalid_json' }) };
  }

  const f = payload.fields || {};
  const row = [
    new Date().toISOString(),
    f['Имя ученика'] || '',
    f['Фамилия ученика'] || '',
    f['Класс'] || '',
    f['Формат занятий'] || '',
    f['Цель и описание ситуации'] || '',
    f['Имя и отчество родителя'] || '',
    f['Телефон'] || '',
    f['Email'] || '',
    f['Согласие на рекламную рассылку'] || '',
  ];

  try {
    await appendRow(row);
  } catch (err) {
    console.error(err);
    return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'append_failed' }) };
  }

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
};

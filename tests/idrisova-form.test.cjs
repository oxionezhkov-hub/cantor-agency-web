const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../yc-svetlana-idrisova-form/index.js`, 'utf8');
const fields = {
  'Имя ученика': 'Тест', 'Фамилия ученика': 'Проверка', 'Класс': '7',
  'Формат занятий': 'Индивидуально', 'Цель и описание ситуации': 'Проверка',
  'Имя и отчество родителя': 'Родитель', 'Телефон': '+70000000000',
  'Email': 'тест', 'Согласие на рекламную рассылку': 'нет',
};
const event = { httpMethod: 'POST', body: JSON.stringify({ source: 'svetlana-idrisova', fields }) };
const settings = {
  TELEGRAM_BOT_TOKEN: 'svetlana-token', TELEGRAM_CHAT_ID: '1761494459',
  TELEGRAM_RELAY_URL: 'https://karlova-relay.helpmedoctor.ru/telegram', TELEGRAM_RELAY_SECRET: 'test-secret',
  RESEND_API_KEY: 'test-key', ADMIN_EMAIL: 'svetlana@example.com', MAIL_FROM: 'leads@example.com',
  GOOGLE_SERVICE_ACCOUNT_KEY: '{}', SPREADSHEET_ID: 'svetlana-sheet',
};
function setup(env, rejectRelay = false) {
  const calls = [];
  const context = vm.createContext({ module: { exports: {} }, process: { env }, Buffer, URL, AbortSignal, AbortController, setTimeout, clearTimeout,
    console: { error() {} },
    require(name) {
      assert.equal(name, 'googleapis');
      return { google: { auth: { GoogleAuth: class {} }, sheets: () => ({ spreadsheets: { values: { append: async request => calls.push({ sheet: request }) } } }) } };
    },
    fetch: async (url, options) => {
      calls.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
      return Response.json({ ok: !rejectRelay }, { status: rejectRelay && String(url).includes('helpmedoctor.ru') ? 502 : 200 });
    },
  });
  vm.runInContext(source, context);
  return { handle: context.module.exports.handler, calls };
}
test('Idrisova uses her own bot and recipient and preserves all ten sheet columns', async () => {
  const { handle, calls } = setup(settings);
  const res = await handle(event);
  assert.deepEqual(JSON.parse(res.body).result, { sheet: 'sent', email: 'sent', telegram: 'sent' });
  const relay = calls.find(call => call.url?.includes('helpmedoctor.ru'));
  assert.equal(relay.body.token, 'svetlana-token');
  assert.deepEqual(Array.from(relay.body.chatIds), ['1761494459']);
  assert.match(relay.body.text, /Светлана Идрисова/);
  assert.ok(!relay.body.text.includes('Карлова'));
  const sheet = calls.find(call => call.sheet).sheet;
  assert.equal(sheet.spreadsheetId, 'svetlana-sheet');
  assert.equal(sheet.range, "'Заявки'!A:J");
  assert.equal(sheet.valueInputOption, 'RAW');
  assert.equal(sheet.requestBody.values[0].length, 10);
  assert.equal(sheet.requestBody.values[0][4], 'Индивидуально');
  assert.equal(sheet.requestBody.values[0][9], 'нет');
  const email = calls.find(call => call.url?.includes('resend.com')).body;
  assert.match(email.subject, /Светлана Идрисова/);
  assert.equal(email.reply_to, undefined);
});
test('unconfigured Idrisova channels are skipped without outgoing calls', async () => {
  const { handle, calls } = setup({});
  const res = await handle(event);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(JSON.parse(res.body).result, { sheet: 'skipped', email: 'skipped', telegram: 'skipped' });
  assert.equal(calls.length, 0);
});
test('Idrisova email and sheet succeed independently of relay errors', async () => {
  const { handle } = setup(settings, true);
  const res = await handle(event);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body.result, { sheet: 'sent', email: 'sent', telegram: 'failed' });
  assert.equal(body.diagnostics.telegram, 'relay_http_502');
});

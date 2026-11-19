const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = `${__dirname}/../yc-tatiana-karlova-form`;
const request = payload => new Request('https://relay.test/telegram', {
  method: 'POST', headers: { Authorization: 'Bearer test-secret' }, body: JSON.stringify(payload),
});
const payload = { token: `123:${'x'.repeat(25)}`, chatIds: ['123', '456'], text: 'Заявка' };
function relay(fetch) {
  const context = vm.createContext({ Response, Request, URL, Blob, AbortSignal, TextEncoder, crypto: webcrypto, fetch });
  vm.runInContext(fs.readFileSync(`${root}/relay-worker.mjs`, 'utf8').replace('export default', 'globalThis.worker ='), context);
  return req => context.worker.fetch(req, { TELEGRAM_RELAY_SECRET: 'test-secret' });
}
test('relay refuses unauthenticated requests before calling Telegram', async () => {
  const handle = relay(() => { throw Error('must not call Telegram'); });
  const req = request(payload); req.headers.delete('Authorization');
  assert.equal((await handle(req)).status, 401);
});
test('relay delivers to remaining recipient after one rejects, without exposing secrets', async () => {
  const handle = relay(async (url, options) => {
    assert.match(url, /^https:\/\/api.telegram.org\/bot123:/);
    const { chat_id } = JSON.parse(options.body);
    return Response.json({ ok: chat_id === '456' }, { status: chat_id === '456' ? 200 : 403 });
  });
  const res = await handle(request(payload));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, delivered: 1, failed: 1 });
});
test('relay splits long messages and reports failure when nobody received the full message', async () => {
  const chunks = [];
  let handle = relay(async (_url, options) => { chunks.push(JSON.parse(options.body).text); return Response.json({ ok: true }); });
  assert.equal((await handle(request({ ...payload, chatIds: ['123'], text: 'я'.repeat(5000) }))).status, 200);
  assert.equal(chunks.join(''), 'я'.repeat(5000));
  assert.ok(chunks.every(text => text.length <= 1800));
  handle = relay(async () => { throw Error('network'); });
  assert.equal((await handle(request(payload))).status, 502);
});
test('relay limits request size and validates credentials and recipients', async () => {
  const handle = relay(() => { throw Error('must not call Telegram'); });
  assert.equal((await handle(request({ ...payload, token: 'invalid' }))).status, 400);
  assert.equal((await handle(request({ ...payload, chatIds: ['@arbitrary'] }))).status, 400);
  assert.equal((await handle(request({ ...payload, text: 'x'.repeat(70000) }))).status, 413);
});
function yandex(env, fetch) {
  const context = vm.createContext({ module: { exports: {} }, process: { env }, Buffer, URL, AbortSignal, AbortController, setTimeout, clearTimeout,
    fetch, console: { error() {} }, require() { throw Error('unconfigured Google must not load'); } });
  vm.runInContext(fs.readFileSync(`${root}/index.js`, 'utf8'), context);
  return context.module.exports.handler;
}
const event = { httpMethod: 'POST', body: JSON.stringify({ fields: { 'Имя ученика': 'Тест' } }) };
test('Yandex skips incomplete config and never loads Google or sends a request', async () => {
  const handle = yandex({ TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_CHAT_ID: '123', RESEND_API_KEY: 'test' }, () => { throw Error('unexpected fetch'); });
  const res = await handle(event);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(JSON.parse(res.body).result, { sheet: 'skipped', email: 'skipped', telegram: 'skipped' });
});
test('Yandex passes Telegram credentials only to HTTPS relay; email survives relay failure', async () => {
  const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: '123,456', TELEGRAM_RELAY_URL: 'https://relay.test/telegram', TELEGRAM_RELAY_SECRET: 'test-secret',
    RESEND_API_KEY: 'resend-test', ADMIN_EMAIL: 'test@example.com', MAIL_FROM: 'test@example.com' };
  const calls = [];
  const handle = yandex(env, async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('relay.test')) {
      assert.equal(options.headers.Authorization, 'Bearer test-secret');
      assert.equal(options.redirect, 'error');
      assert.equal(JSON.parse(options.body).token, 'test-token');
      return Response.json({ ok: false }, { status: 502 });
    }
    return Response.json({ id: 'mock-email' });
  });
  const res = await handle(event);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).result, { sheet: 'skipped', email: 'sent', telegram: 'failed' });
  assert.ok(calls.every(url => !url.includes('api.telegram.org')));
});

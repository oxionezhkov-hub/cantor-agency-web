const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(`${__dirname}/../_worker.js`, 'utf8');
function context(extra = {}) {
  const c = vm.createContext({ Request, Response, Headers, URL, URLSearchParams, AbortSignal,
    Uint8Array, btoa, console, setTimeout, clearTimeout, calls: [], ...extra });
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), c);
  vm.runInContext(`
    env = { AVITO_API_PASSWORD: 'test-password', AVITO_KV: {
      get: async key => key === 'account:account' ? {id:'account', userId:123} : null,
    } };
    avitoGetToken = async () => 'test-token';
    avitoRequest = async (token, path, options) => {
      calls.push({token, path, options});
      return new Response(JSON.stringify({stats: [{count:44, accepted:4}]}), {headers:{'Content-Type':'application/json'}});
    };
  `, c);
  return c;
}
async function route(c, method, path, { allowWrite, body, contentType = 'application/json', password = 'test-password', headers = {} } = {}) {
  const url = new URL('https://worker.test/api/avito/raw');
  url.searchParams.set('accountId', 'account');
  url.searchParams.set('path', path);
  if (allowWrite !== undefined) url.searchParams.set('allowWrite', allowWrite);
  c.request = new Request(url, { method, body, headers: { 'Content-Type': contentType, 'x-dashboard-password': password, ...headers } });
  return vm.runInContext('handleApi(request, env, new URL(request.url), {})', c);
}

test('mailing statistics can be read without enabling writes', async () => {
  const c = context();
  const payload = JSON.stringify({dateTimeFrom:'2026-11-01T00:00:00+03:00', dateTimeTo:'2026-11-23T12:00:00+03:00'});
  const res = await route(c, 'POST', '/special-offers/v1/stats', {body:payload});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.stats[0].count, 44);
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].options.noRetry, false);
  assert.equal(Buffer.from(c.calls[0].options.body).toString(), payload);
});

test('read-only POSTs cover other API products and preserve user id substitution', async () => {
  for (const path of ['/special-offers/v1/tariffInfo', '/special-offers/v1/available',
    '/core/v1/accounts/{userId}/vas/prices', '/core/v1/accounts/{user_id}/calls/stats/',
    '/cpa/v2/callById', '/promotion/v2/items/services/get', '/job/v2/vacancies/batch',
    '/ads/v1/account/123/campaigns/456/stats', '/stock-management/1/info']) {
    const c = context();
    assert.equal((await route(c, 'POST', path, {body:'{}'})).status, 200, path);
    assert(!c.calls[0].path.includes('{'));
  }
});

test('writes and unknown POSTs require an exact per-request opt-in', async () => {
  for (const [method, path] of [['POST','/special-offers/v1/multiConfirm'],
    ['POST','/special-offers/v1/multiCreate'], ['POST','/ratings/v1/answers'],
    ['POST','/future/v1/read'], ['PUT','/stock-management/1/stocks'],
    ['PATCH','/future/v1/item'], ['DELETE','/core/v1/items/123']]) {
    for (const allowWrite of [undefined, 'false', '1', 'TRUE']) {
      const c = context();
      const res = await route(c, method, path, {allowWrite, body:'{}'});
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal((await res.json()).error, 'write_confirmation_required');
      assert.equal(c.calls.length, 0);
    }
    const c = context();
    assert.equal((await route(c, method, path, {allowWrite:'true', body:'{}'})).status, 200);
    assert.equal(c.calls.length, 1);
    assert.equal(c.calls[0].options.method, method);
    assert.equal(c.calls[0].options.noRetry, true);
  }
});

test('authorization and safe paths remain mandatory even with write opt-in', async () => {
  const c = context();
  assert.equal((await route(c, 'POST', '/special-offers/v1/stats', {password:'wrong'})).status, 401);
  for (const path of ['/token', '/token?grant_type=test', '/TOKEN', '//evil.test/api',
    'https://evil.test/api', '/core/../token', '/core/%2e%2e/token', '/stats#fragment']) {
    assert.equal((await route(c, 'POST', path, {allowWrite:'true'})).status, 400, path);
  }
  assert.equal(c.calls.length, 0);
});

test('read classification cannot be extended by a path suffix or query text', async () => {
  const c = context();
  for (const path of ['/special-offers/v1/stats/confirm', '/special-offers/v1/multiConfirm?path=/special-offers/v1/stats']) {
    assert.equal((await route(c, 'POST', path)).status, 403);
  }
  assert.equal((await route(c, 'POST', '/special-offers/v1/stats?limit=10')).status, 200);
  assert.equal(c.calls.length, 1);
});

test('multipart bytes and Content-Type are forwarded without leaking caller credentials', async () => {
  const c = context();
  const bytes = Uint8Array.from([0, 255, 13, 10, 45, 45]);
  const contentType = 'multipart/form-data; boundary=test-boundary';
  await route(c, 'POST', '/messenger/v1/accounts/{user_id}/uploadImages', {
    allowWrite:'true', body:bytes, contentType, headers:{Authorization:'do-not-forward', 'X-Source':'test-source'},
  });
  assert.deepEqual(Buffer.from(c.calls[0].options.body), Buffer.from(bytes));
  assert.equal(c.calls[0].options.headers['Content-Type'], contentType);
  assert.equal(c.calls[0].options.headers['X-Source'], 'test-source');
  assert.equal(c.calls[0].options.headers.Authorization, undefined);
});

test('binary downloads, empty responses and upstream errors retain their meaning', async () => {
  for (const [response, expected] of [
    [new Response(Uint8Array.from([0,255,1]), {headers:{'Content-Type':'application/pdf'}}), {status:200, encoding:'base64', data:'AP8B'}],
    [new Response(null, {status:204}), {status:204, data:''}],
    [new Response('{"error":"rate_limit"}', {status:429, headers:{'Content-Type':'application/json'}}), {status:429, data:{error:'rate_limit'}}],
  ]) {
    const c = context({response});
    vm.runInContext('avitoRequest = async () => response', c);
    const res = await route(c, 'GET', '/reports/v1/file');
    const data = await res.json();
    assert.equal(res.status, expected.status === 429 ? 502 : 200);
    for (const [key,value] of Object.entries(expected)) assert.deepEqual(data[key], value);
  }
});

function transportContext(extra = {}) {
  const c = context(extra);
  // Restore the actual transport, replacing only its network boundary.
  vm.runInContext(source.slice(source.indexOf('async function avitoRequest('), source.indexOf('\nasync function avitoJson(')), c);
  vm.runInContext(`
    AVITO_PROXY = {url:'https://proxy.test', key:null};
    AVITO_TOKEN_OWNER.set('test-token', {env, account:{clientId:'test', clientSecret:'test'}});
    networkCalls = 0;
  `, c);
  return c;
}

test('write 5xx/429/auth errors are never replayed by the worker', async () => {
  for (const status of [500, 429, 401, 403]) {
    const c = transportContext({status});
    vm.runInContext('fetch = async () => {networkCalls++; return new Response("not authorized", {status})}', c);
    const res = await vm.runInContext('avitoRequest("test-token", "/special-offers/v1/multiConfirm", {method:"POST", body:"{}", noRetry:true})', c);
    assert.equal(res.status, status);
    assert.equal(c.networkCalls, 1);
  }
});

test('uncertain write timeout is not retried through another transport', async () => {
  const c = transportContext();
  vm.runInContext('fetch = async () => {networkCalls++; throw new Error("timeout")}', c);
  const res = await route(c, 'POST', '/special-offers/v1/multiConfirm', {allowWrite:'true', body:'{}'});
  assert.equal(res.status, 502);
  assert.equal((await res.json()).outcome, 'unknown');
  assert.equal(c.networkCalls, 1);
});

test('writes go directly once when the proxy was already disabled', async () => {
  const c = transportContext();
  vm.runInContext('AVITO_PROXY = {url:null}; fetch = async () => {networkCalls++; return new Response("{}", {status:500})}', c);
  const res = await vm.runInContext('avitoRequest("test-token", "/special-offers/v1/multiConfirm", {method:"POST", noRetry:true})', c);
  assert.equal(res.status, 500);
  assert.equal(c.networkCalls, 1);
});

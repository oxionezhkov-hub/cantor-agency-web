const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const worker = readFileSync(`${__dirname}/../_worker.js`, 'utf8');
const page = readFileSync(`${__dirname}/../avito-bids`, 'utf8');
function context(extra = {}) {
  const c = vm.createContext({ Response, Request, URL, Headers, console, setTimeout, clearTimeout, ...extra });
  vm.runInContext(worker.replace('export default {', 'globalThis.worker = {'), c);
  return c;
}
function routeContext(records) {
  let calls = 0;
  const c = context({ records, calls, limited: false });
  vm.runInContext(`
    mbidsAccounts = async () => [{ id: 'a', name: 'Account' }];
    mbidsCfgAccountIds = async () => ['a'];
    avitoGetToken = async () => 'test-token';
    mbidsFetchTotals = async () => { calls++; if (limited) throw new Error('avito_429'); return { '1': { v: 8 } }; };
    env = { AVITO_KV: {
      get: async (k) => records[k] || null,
      put: async (k,v) => { records[k] = JSON.parse(v); }
    } };
  `, c);
  return c;
}
async function route(c, path) {
  c.url = new URL(`https://example.test/api/dashboard/mbids/${path}`);
  return vm.runInContext("handleMbidsRoutes(new Request(url), env, url, null, {})", c);
}
test('large scales stay out of paginated state; every item is returned once', async () => {
  const cfg = { items: {} }, state = { items: {} };
  for (let i = 1; i <= 213; i++) {
    cfg.items[i] = { title: `Ad ${i}`, notes: [{ text: 'detail only' }] };
    state.items[i] = { scale: Array.from({ length: 2000 }, (_, n) => [n * 100, n]) };
  }
  const c = routeContext({ 'mbids:cfg:a': cfg, 'mbids:state:a': state });
  const ids = [];
  let offset = 0;
  do {
    const r = await route(c, `state?limit=100&offset=${offset}`);
    const body = await r.text();
    assert.ok(Buffer.byteLength(body) < 3670016);
    const data = JSON.parse(body);
    assert.ok(data.items.length <= 100);
    assert.equal(data.items[0].scale, undefined);
    ids.push(...data.items.map(x => x.id));
    offset = data.nextOffset;
  } while (offset != null);
  assert.equal(ids.length, 213);
  assert.equal(new Set(ids).size, 213);
});
test('covered engine statistics also serve switched-off ads without another API call', async () => {
  const date = '2026-11-17';
  const c = routeContext({ 'account:a': {}, 'mbids:cfg:a': { items: { 1: { on: false } } },
    'mbids:state:a': { today: { date, at: Date.now(), ids: ['1'], stats: { 1: { v: 9 } } } } });
  vm.runInContext(`mbidsMsk = () => ({date:'${date}'});`, c);
  const data = await (await route(c, `stats?accountId=a&from=${date}&to=${date}`)).json();
  assert.equal(data.stats[1].v, 9);
  assert.equal(c.calls, 0);
});
test('429 returns partial saved values and cooldown prevents a repeated API call', async () => {
  const date = '2026-11-17';
  const c = routeContext({ 'account:a': {}, 'mbids:cfg:a': { items: { 1: {}, 2: {} } },
    'mbids:state:a': { today: { date, at: 1, ids: ['1'], stats: { 1: { v: 4 } } } } });
  c.limited = true;
  vm.runInContext(`mbidsMsk = () => ({date:'${date}'});`, c);
  for (let i = 0; i < 2; i++) {
    const data = await (await route(c, `stats?accountId=a&from=${date}&to=${date}`)).json();
    assert.equal(data.partial, true);
    assert.equal(data.stale, true);
    assert.equal(data.stats[1].v, 4);
    assert.equal(data.stats[2], undefined);
  }
  assert.equal(c.calls, 1);
});
test('429 without saved values is reported as 429, not 502', async () => {
  const c = routeContext({ 'account:a': {}, 'mbids:cfg:a': { items: { 1: {} } } });
  c.limited = true;
  assert.equal((await route(c, 'stats?accountId=a&from=2026-11-01&to=2026-11-02')).status, 429);
});
test('stats upstream 429 is attempted once', async () => {
  const c = context({ attempts: 0 });
  vm.runInContext(`avitoFetch = async () => { attempts++; return new Response('{}', {status:429}); };`, c);
  await vm.runInContext("avitoRequest('test', '/stats/v2/accounts/1/items')", c);
  assert.equal(c.attempts, 1);
});
function apiContext(method, errorType) {
  const c = vm.createContext({ Response, AbortSignal, method, errorType, attempts: [], ROUTES: [p => 'proxy'+p, p => 'worker'+p], route: 0, getPw: () => 'test' });
  vm.runInContext(`fetch = async (url) => { attempts.push(url); return attempts.length === 1 ? new Response(JSON.stringify({errorType}), {status:502}) : Response.json({ok:true}); };`, c);
  vm.runInContext(page.slice(page.indexOf('async function api('), page.indexOf('\nconst post =')), c);
  return c;
}
test('oversized read switches to worker', async () => {
  const c = apiContext('GET', 'JobResponseTooLong');
  const r = await vm.runInContext("api('/state', {method})", c);
  assert.equal(r.ok, true);
  assert.equal(c.attempts.length, 2);
});
test('failed writes are not replayed for size errors', async () => {
  const c = apiContext('POST', 'JobResponseTooLong');
  const r = await vm.runInContext("api('/update', {method})", c);
  assert.equal(r.ok, false);
  assert.equal(c.attempts.length, 1);
});
test('background rendering leaves an active bid input in place', () => {
  const c = vm.createContext({ B: { loaded: true }, document: { activeElement: { matches: () => true } }, renderPending: false });
  const start = page.indexOf('function render() {');
  vm.runInContext(page.slice(start, page.indexOf('\nfunction ', start + 1)), c);
  vm.runInContext('render()', c);
  assert.equal(c.renderPending, true);
});
test('a replaced ad with the same count does not reuse old cached statistics', async () => {
  const c = routeContext({ 'account:a': {}, 'mbids:cfg:a': { items: { 1: {} } },
    'mbids:statc:a:2026-11-01:2026-11-02': { n: 1, idsKey: '2', at: Date.now(), stats: { 2: { v: 99 } } } });
  const data = await (await route(c, 'stats?accountId=a&from=2026-11-01&to=2026-11-02')).json();
  assert.equal(c.calls, 1);
  assert.equal(data.stats[2], undefined);
});
test('frontend assembles all state pages before returning', async () => {
  const c = vm.createContext({ calls: 0 });
  vm.runInContext(`api = async () => { calls++; return {ok:true, data:{items:[{id:calls}], nextOffset:calls===1?100:null}}; };`, c);
  vm.runInContext(page.slice(page.indexOf('async function bidsState('), page.indexOf('\nlet bidsLoading')), c);
  const r = await vm.runInContext('bidsState()', c);
  assert.equal(r.data.items.length, 2);
  assert.equal(r.data.items[1].id, 2);
});
test('a failed second page never returns a partial list as success', async () => {
  const c = vm.createContext({ calls: 0 });
  vm.runInContext(`api = async () => ++calls===1 ? {ok:true,data:{items:[{id:1}],nextOffset:100}} : {ok:false,status:502,data:{error:'unavailable'}};`, c);
  vm.runInContext(page.slice(page.indexOf('async function bidsState('), page.indexOf('\nlet bidsLoading')), c);
  const r = await vm.runInContext('bidsState()', c);
  assert.equal(r.ok, false);
  assert.equal(r.data.items, undefined);
});
test('partial statistics do not turn missing ads into zeroes', async () => {
  const c = vm.createContext({ B: { items: [{ key: 'a:1', accountId:'a' }, {key:'a:2',accountId:'a'}] }, stats: {}, statsAt:null,
    period: () => ['2026-11-17','2026-11-17'], render: () => {},
    api: async () => ({ok:true,data:{stats:{1:{v:4}},partial:true,stale:true}}) });
  vm.runInContext(page.slice(page.indexOf('let statsSeq ='), page.indexOf('\nfunction visible()')), c);
  await vm.runInContext('loadStats()', c);
  assert.equal(c.stats['a:1'].v, 4);
  assert.equal(c.stats['a:2'], undefined);
});

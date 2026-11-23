const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = readFileSync(`${__dirname}/../_worker.js`, 'utf8');
const page = readFileSync(`${__dirname}/../avito-tasks`, 'utf8');
const PROJECT = {id:'client',name:'Client',avitoAccountId:'account'};
const STATS = [
  {sentAt:'2026-11-19T10:00:00+03:00',price:600,count:30,chatsOpened:7,accepted:2},
  {sentAt:'2026-11-19T12:00:00+03:00',price:400,count:14,chatsOpened:4,accepted:4},
  {sentAt:'2026-11-11T21:30:00Z',price:997,count:43,chatsOpened:6,accepted:1},
];
function context(records = {}, extra = {}) {
  const writes = [];
  const kv = {
    async get(key){return records[key] ? structuredClone(records[key]) : null;},
    async put(key,value){records[key]=JSON.parse(value);writes.push(key);},
    async list({prefix}){return {keys:Object.keys(records).filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true};},
  };
  const c = vm.createContext({Request,Response,URL,Headers,AbortSignal,TextEncoder,crypto:webcrypto,console,
    setTimeout,clearTimeout,stats:STATS,fetchCalls:0,env:{AGENCY_DASHBOARD_KV:kv,AVITO_KV:kv},project:PROJECT,...extra});
  vm.runInContext(source.replace('export default {','globalThis.worker = {'),c);
  vm.runInContext(`avitoGetToken = async ()=>'test'; avitoJson = async () => {fetchCalls++;return {stats};};`,c);
  return {c,records,writes};
}
const run = (c,code) => vm.runInContext(code,c);

test('screen interest uses chatsOpened, sums deliveries and dates in Moscow, newest first',()=>{
  const {c}=context();
  const rows=JSON.parse(JSON.stringify(run(c,'mailResultsGroup(stats)')));
  assert.deepEqual(rows,[{date:'2026-11-19',spent:1000,recipients:44,interested:11},
    {date:'2026-11-12',spent:997,recipients:43,interested:6}]);
  assert.throws(()=>run(c,'mailResultsGroup([{sentAt:"2026-11-19",price:0,count:1}])'),/Неполные/);
  assert.throws(()=>run(c,'mailResultsGroup(null)'),/не вернул/);
});

test('calendar import is idempotent and preserves planned budgets, notes and assessments',async()=>{
  const initial={items:[{id:'manual',projectId:'client',date:'2026-11-19',budget:1500,result:'good',comment:'Do not replace'},
    {id:'future',projectId:'client',date:'2026-11-30',budget:1000}]};
  const {c,records}=context({'mail:2026-11':initial});
  run(c,'result = {month:"2026-11",updatedAt:"2026-11-23T10:00:00Z",rows:mailResultsGroup(stats)}');
  const first=await run(c,'mailResultsRecord(env,project,result)');
  assert.equal(first.created,1);assert.equal(first.updated,1);
  await run(c,'mailResultsRecord(env,project,result)');
  const items=records['mail:2026-11'].items;
  assert.equal(items.length,3);
  const original=items.find(x=>x.id==='manual');
  assert.equal(original.budget,1500);assert.equal(original.comment,'Do not replace');assert.equal(original.result,'good');
  assert.equal(original.contacts,11);assert.equal(original.recipients,44);
  assert.equal(items.find(x=>x.date==='2026-11-12').budgetSource,'avito-spend');
  assert.equal(items.find(x=>x.date==='2026-11-30').contacts,undefined);
});

test('later refresh updates automatic spend and contacts without duplicate entries',async()=>{
  const {c,records}=context();
  run(c,'result = {month:"2026-11",rows:mailResultsGroup(stats),updatedAt:"old"}');
  await run(c,'mailResultsRecord(env,project,result)');
  run(c,'result.rows[0].spent=1100;result.rows[0].interested=12;result.updatedAt="new"');
  await run(c,'mailResultsRecord(env,project,result)');
  const item=records['mail:2026-11'].items.find(x=>x.date==='2026-11-19');
  assert.equal(item.budget,1100);assert.equal(item.contacts,12);assert.equal(item.avitoUpdatedAt,'new');
  assert.equal(records['mail:2026-11'].items.length,2);
});

test('ambiguous calendar plans are reported rather than chosen or overwritten',async()=>{
  const initial={items:[{id:'one',projectId:'client',date:'2026-11-19',contacts:1},{id:'two',projectId:'client',date:'2026-11-19',contacts:2}]};
  const {c,records}=context({'mail:2026-11':initial});
  run(c,'result={month:"2026-11",rows:mailResultsGroup(stats)}');
  const out=await run(c,'mailResultsRecord(env,project,result)');
  assert.deepEqual([...out.conflicts],['2026-11-19']);
  assert.equal(records['mail:2026-11'].items.find(x=>x.id==='one').contacts,1);
  assert.equal(records['mail:2026-11'].items.find(x=>x.id==='two').contacts,2);
});

test('bad API response preserves the cache and a valid empty response does not clear the calendar',async()=>{
  const cached={rows:[{date:'2026-11-19',spent:1000,recipients:44,interested:11}],month:'2026-11'};
  const {c,records}=context({'account:account':{},'mailResults:account:2026-11':cached,'mail:2026-11':{items:[{id:'keep'}]}});
  run(c,'stats = [{}]');
  await assert.rejects(run(c,'mailResultsFetch(env,project,"2026-11",true)'),/Неполные/);
  assert.deepEqual(records['mailResults:account:2026-11'],cached);
  run(c,'stats = []');
  const result=await run(c,'mailResultsFetch(env,project,"2026-11",true)');
  c.result=result;await run(c,'mailResultsRecord(env,project,result)');
  assert.deepEqual(records['mail:2026-11'].items,[{id:'keep'}]);
  run(c,'avitoJson=async()=>({})');
  const omitted=await run(c,'mailResultsFetch(env,project,"2026-11",true)');
  assert.equal(omitted.rows.length,0);
});

test('recording a row updates only its date and ignores caller supplied metrics',async()=>{
  const today=new Date(Date.now()+3*3600000).toISOString().slice(0,7);
  const records={'project:client':PROJECT,[`mailResults:account:${today}`]:{month:today,rows:[{date:today+'-01',spent:100,recipients:5,interested:2},{date:today+'-02',spent:200,recipients:10,interested:4}]}};
  const {c}=context(records,{month:today});
  const result=await run(c,'mailResultsApi(env,{name:"Tester"},"mail-results-save",{date:month+"-01",projectId:"client",rows:[{interested:999}]})');
  assert.equal(result.created,1);assert.equal(records[`mail:${today}`].items[0].contacts,2);assert.equal(c.fetchCalls,0);
  assert.equal(records[`mail:${today}`].items.length,1);
  assert.equal(records[`mail:${today}`].items[0].date,today+'-01');
  assert.equal((await run(c,'mailResultsApi(env,{},"mail-results-save",{projectId:"client"})')).status,400);
  assert.equal((await run(c,'mailResultsApi(env,{},"mail-results-save",{date:month+"-03",projectId:"client"})')).status,404);
  records['project:client']={...records['project:client'],inactive:true};
  assert.equal((await run(c,'mailResultsApi(env,{},"mail-results",{month,projectId:"client"})')).status,400);
  assert.equal((await run(c,'mailResultsApi(env,{},"mail-results-save",{date:"2026-02-31",projectId:"client"})')).status,400);
});

test('continuous history fetches earlier years and merges monthly cron updates newest first',async()=>{
  const {c,records}=context({'project:client':PROJECT,'account:account':{}}, {requests:[]});
  run(c,`avitoJson=async (_token,_path,options)=>{requests.push(JSON.parse(options.body));return {stats:[...stats,{sentAt:'2024-09-13T20:30:42+03:00',price:500,count:20,chatsOpened:3}]}}`);
  const all=await run(c,'mailResultsApi(env,{},"mail-results",{projectId:"client"})');
  assert.equal(all.error,undefined,JSON.stringify(all));
  assert.deepEqual(Array.from(all.rows,r=>r.date),['2026-11-19','2026-11-12','2024-09-13']);
  assert.equal(c.requests[0].dateTimeFrom,'1970-01-01T00:00:00Z');
  assert.equal(records['mailResultsHistory:account'].complete,true);
  records['mailResults:account:2026-11'].rows[0].interested=12;
  const updated=await run(c,'mailResultsApi(env,{},"mail-results",{projectId:"client"})');
  assert.equal(updated.rows[0].interested,12);assert.equal(c.requests.length,1);
  await run(c,'mailResultsApi(env,{},"mail-results",{projectId:"client",refresh:true})');
  assert.equal(c.requests.length,2);
});

test('an older history row is recorded in its own calendar month only',async()=>{
  const {c,records}=context({'project:client':PROJECT,
    'mailResults:account:2024-09':{month:'2024-09',rows:[{date:'2024-09-13',spent:500,recipients:20,interested:3},{date:'2024-09-14',spent:700,recipients:30,interested:4}]},
    'mail:2026-11':{items:[{id:'keep',date:'2026-11-19',projectId:'client',contacts:11}]}});
  const result=await run(c,'mailResultsApi(env,{name:"Tester"},"mail-results-save",{projectId:"client",date:"2024-09-13"})');
  assert.equal(result.error,undefined,JSON.stringify(result));
  assert.equal(result.month,'2024-09');assert.equal(result.created,1);
  assert.equal(records['mail:2024-09'].items.length,1);
  assert.equal(records['mail:2024-09'].items[0].date,'2024-09-13');
  assert.equal(records['mail:2026-11'].items[0].contacts,11);
});

test('daily job includes all active linked accounts, even if general analytics is disabled',async()=>{
  const {c,records}=context({'project:one':{id:'one',avitoAccountId:'a',avitoPullOff:true},
    'project:inactive':{id:'inactive',avitoAccountId:'b',inactive:true},'project:unlinked':{id:'unlinked'}});
  const job=await run(c,'mailResultsStart(env,"2026-11")');
  assert.deepEqual(Array.from(job.pending,p=>p.projectId),['one']);
  await run(c,'mailResultsStart(env,"2026-11")');
  assert.equal(Object.keys(records).filter(k=>k.startsWith('mailResultsPull:')).length,1);
});

test('failed cabinet cannot erase successful imports; retries are bounded and exposed',async()=>{
  const month=new Date(Date.now()+3*3600000).toISOString().slice(0,7), day=month+'-23';
  const records={'project:good':{id:'good',avitoAccountId:'g'},'project:bad':{id:'bad',avitoAccountId:'b'},
    [`mailResultsPull:${day}:${month}`]:{month,day,status:'running',pending:[{projectId:'good',accountId:'g'},{projectId:'bad',accountId:'b'}],done:{},errors:{},tries:{},leaseUntil:0}};
  const {c}=context(records,{month,day});
  run(c,'mailResultsFetch = async (env,p,month) => {if(p.id==="bad")throw new Error("timeout");return {month,rows:[{date:day,spent:50,recipients:5,interested:1}]}}');
  for(let i=0;i<3;i++)await run(c,'mailResultsProcess(env,day,month)');
  const job=records[`mailResultsPull:${day}:${month}`];
  assert.equal(job.status,'partial');assert.equal(job.pending.length,0);assert.equal(job.tries.bad,3);
  assert.equal(records[`mail:${month}`].items.length,1);assert.equal(job.done.good.created,1);
});

test('07:00 Moscow trigger starts once per day and keeps first week previous month refresh',async()=>{
  for(const hour of [6,7,12]){
    const {c}=context({},{hour,starts:[],passes:[]});
    run(c,`botMsk=()=>({date:'2026-12-02',hh:hour});mailResultsStart=async (env,m)=>{starts.push(m)};mailResultsProcess=async (env,d,m)=>{passes.push([d,m])};`);
    await run(c,'mailResultsCron(env)');
    assert.deepEqual(Array.from(c.starts),hour<7?[]:['2026-12','2026-11']);
  }
});

test('manual sync route is authenticated and GET never starts a job',async()=>{
  const {c}=context();
  let res=await run(c,'handleDashboardApi(new Request("https://test/api/dashboard/mailing-results/sync"),env,new URL("https://test/api/dashboard/mailing-results/sync"),{})');
  assert.equal(res.status,401);
  run(c,'checkDashboardAuth=()=>true;mailResultsStart=async()=>{throw new Error("GET wrote")};');
  res=await run(c,'handleDashboardApi(new Request("https://test/api/dashboard/mailing-results/sync"),env,new URL("https://test/api/dashboard/mailing-results/sync"),{})');
  assert.equal(res.status,200);
});

test('quick cabinet changes cannot display the previous cabinet response',async()=>{
  const pending=[];
  const c=vm.createContext({MLR:{projectId:'a',month:'2026-11',serial:0},mlResultsRender:()=>{},
    api:(_action,body)=>new Promise(resolve=>pending.push({body,resolve}))});
  vm.runInContext(page.slice(page.indexOf('async function mlResultsLoad('),page.indexOf("$('drawerRoot').addEventListener('change'",page.indexOf('async function mlResultsLoad('))),c);
  const a=run(c,'mlResultsLoad()');
  run(c,'MLR.projectId="b"');
  const b=run(c,'mlResultsLoad()');
  pending[1].resolve({ok:true,data:{rows:[{date:'2026-11-19',interested:11}],updatedAt:'b'}});
  await b;
  pending[0].resolve({ok:true,data:{rows:[{date:'2026-11-03',interested:99}],updatedAt:'a'}});
  await a;
  assert.equal(c.MLR.updatedAt,'b');assert.equal(c.MLR.rows[0].interested,11);
  assert.equal(pending[0].body.projectId,'a');assert.equal(pending[1].body.projectId,'b');
});

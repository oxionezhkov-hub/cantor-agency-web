const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(`${__dirname}/../_worker.js`,'utf8').replace('export default {','globalThis.worker = {');
function setup(extra={}) {
 const c=vm.createContext({Response,Request,URL,Headers,crypto:require('node:crypto').webcrypto,console,...extra});vm.runInContext(source,c);return c;
}
test('new account lookup uses token and self in a single proxy call',async()=>{
 const c=setup({calls:[]});
 vm.runInContext(`AVITO_PROXY.url='https://proxy.test';AVITO_PROXY_OFF_UNTIL=0;
 avitoCallViaProxy=async(a,path)=>{calls.push(path);return Response.json({id:123});};
 avitoFetch=async()=>{throw new Error('separate token request is forbidden');};`,c);
 assert.equal(await vm.runInContext("avitoLookupUserId('test-id','test-secret')",c),'123');
 assert.equal(c.calls.length,1);
});
test('rejected account lookup cannot save an invented user id',async()=>{
 const c=setup();vm.runInContext(`AVITO_PROXY.url='https://proxy.test';AVITO_PROXY_OFF_UNTIL=0;
 avitoCallViaProxy=async()=>new Response('Forbidden',{status:403});`,c);
 await assert.rejects(vm.runInContext("avitoLookupUserId('test-id','test-secret')",c),/avito_403/);
});
test('table save finishes while the build is still running',async()=>{
 const records={};const pending=[];
 const c=setup({records,ctx:{waitUntil:p=>pending.push(p)},
 env:{AVITO_KV:{put:async(k,v)=>{records[k]=JSON.parse(v);}}},
 request:new Request('https://test/api/dashboard/feeds-extra',{method:'POST',body:JSON.stringify({name:'Test',sheetUrl:'https://docs.google.com/spreadsheets/d/1234567890123456789012345/edit',tabs:['Data']})})});
 vm.runInContext(`extraPasswordOk=()=>true;extraListKeys=async()=>[];extraAccountId=async()=>({id:null});extraLog=async()=>{};
 feedsBuild=()=>new Promise(resolve=>{globalThis.finishBuild=resolve;});`,c);
 const r=await vm.runInContext('handleExtraFeedsApi(request,env,new URL(request.url),ctx)',c);
 assert.equal(r.status,202);const data=await r.json();assert.equal(data.feed.stat.building,true);
 assert.equal(Object.keys(records).filter(k=>k.startsWith('xfeed:')).length,1);
 assert.equal(pending.length,1);c.finishBuild();await pending[0];
});

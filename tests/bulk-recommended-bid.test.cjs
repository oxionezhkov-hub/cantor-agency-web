const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/../_worker.js`,'utf8').replace('export default {','globalThis.worker = {');
function setup(){
 const records={},puts=[],jobs=[];
 const env={AVITO_KV:{get:async k=>structuredClone(records[k]??null),put:async(k,v)=>{puts.push(k);records[k]=JSON.parse(v);}}};
 const c=vm.createContext({Response,Request,URL,Headers,console,setTimeout,clearTimeout,jobs});
 vm.runInContext(source,c);
 vm.runInContext(`mbidsProcess=async(env,acc,opts)=>jobs.push({acc,ids:opts.ids}); avitoGetToken=async()=>{throw Error('Unexpected Avito request')};`,c);
 const cfg={items:{101:{bid:40,on:false},102:{bid:50,on:false}}};
 const scale=recPenny=>({recPenny,minPromoPenny:1200,maxPenny:10000});
 records['mbids:cfg:a']=cfg;records['mbids:state:a']={items:{101:scale(2700),102:scale(5750)}};
 async function update(set,refs=['a:101','a:102'],extra={}){
  const url=new URL('https://test/api/dashboard/mbids/items/update');
  const req=new Request(url,{method:'POST',body:JSON.stringify({set,refs,...extra})});
  const waits=[];const response=await c.handleMbidsRoutes(req,env,url,{waitUntil:p=>waits.push(p)},{name:'Test'});await Promise.all(waits);
  return {status:response.status,...await response.json()};
 }
 return {records,puts,jobs,c,update,scale};
}
test('each listing gets its own one-time recommendation rounded to whole rubles without enabling it',async()=>{
 const s=setup(),r=await s.update({bid:{recommended:true}});
 assert.equal(r.changed,2);assert.deepEqual(r.appliedBids,{'a:101':27,'a:102':58});
 assert.equal(s.records['mbids:cfg:a'].items[101].on,false);
 assert.deepEqual(JSON.parse(JSON.stringify(s.jobs)),[{acc:'a',ids:['101','102']}]);
 s.records['mbids:state:a'].items[101].recPenny=9000;
 assert.equal(s.records['mbids:cfg:a'].items[101].bid,27);
});
test('missing recommendation skips all combined edits and background processing for that listing',async()=>{
 const s=setup();delete s.records['mbids:state:a'].items[102].recPenny;
 const r=await s.update({bid:{recommended:true},on:true,hours:[8]},undefined,{note:'test'});
 assert.equal(r.changed,1);assert.equal(r.skipped[0].key,'a:102');
 assert.deepEqual(s.records['mbids:cfg:a'].items[102],{bid:50,on:false});
 assert.deepEqual(JSON.parse(JSON.stringify(s.jobs[0].ids)),['101']);
});
test('unavailable or unsafe recommendations never write configuration',async()=>{
 for(const state of [{recPenny:0},{recPenny:null},{recPenny:1100},{recPenny:9950,maxPenny:9975},{recPenny:2700,maxPenny:null}]){
  const s=setup();Object.assign(s.records['mbids:state:a'].items[101],state);
  const r=await s.update({bid:{recommended:true}},['a:101']);
  assert.equal(r.changed,0);assert.equal(r.skipped.length,1);assert.equal(s.puts.length,0);assert.equal(s.jobs.length,0);
 }
});
test('same listing IDs in different accounts use their own recommendations',async()=>{
 const s=setup();s.records['mbids:cfg:b']={items:{101:{bid:40,on:false}}};s.records['mbids:state:b']={items:{101:s.scale(8100)}};
 const r=await s.update({bid:{recommended:true}},['a:101','b:101']);
 assert.deepEqual(r.appliedBids,{'a:101':27,'b:101':81});
});
test('conflicting modes are rejected and manual/minimum updates still work',async()=>{
 const s=setup();assert.equal((await s.update({bid:{recommended:true,min:true}})).status,400);assert.equal(s.puts.length,0);
 assert.equal((await s.update({bid:{op:'add',value:5}},['a:101'])).appliedBids['a:101'],45);
 assert.equal((await s.update({bid:{min:true}},['a:101'])).appliedBids['a:101'],12);
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/../_worker.js`,'utf8').replace('export default {','globalThis.worker = {');
function setup(){
 const records={},calls=[],delays=[];
 const c=vm.createContext({Response,Request,URL,Headers,console,setTimeout,clearTimeout,records,calls,delays,
 env:{AVITO_KV:{get:async(k)=>structuredClone(records[k]||null),put:async(k,v)=>{records[k]=k==='mbids:cron-next'?v:JSON.parse(v);}}}});
 vm.runInContext(source,c);
 vm.runInContext(`sleep=async ms=>delays.push(ms); avitoGetToken=async()=> 'test'; mbidsMsk=()=>({date:'2026-11-19',hour:9,dow:3});
 avitoRequest=async(token,path,opts)=>{calls.push({path,body:opts?.body?JSON.parse(opts.body):null});return new Response('',{status:200});};`,c);
 c.cfg={items:{101:{on:true,bid:70,hours:[12,13,14,15,16,17,18,19,20,21]}}};
 c.state={items:{101:{nowPenny:13300,basePenny:1290,selectedType:'manual',bidsAt:1}}};
 c.records['account:a']={id:'a',userId:1};c.records['mbids:cfg:a']=c.cfg;c.records['mbids:state:a']=c.state;
 c.decision=vm.runInContext("mbidsDecide({...cfg.items[101],id:'101'},state.items[101],{now:mbidsMsk()})",c);
 return c;
}
test('outside hours requests removal even with fractional base or no scale',()=>{
 const c=setup();assert.equal(c.decision.action,'remove');assert.equal(c.decision.wantPenny,null);
 c.state.items[101]={bidsTemp:true};
 const r=vm.runInContext("mbidsDecide({...cfg.items[101],id:'101',bid:null},state.items[101],{now:mbidsMsk()})",c);assert.equal(r.action,'remove');
});
test('hour and weekday boundaries use MSK whole-hour selection',()=>{
 const c=setup();const run=(h,d=3)=>{c.h=h;c.d=d;return vm.runInContext('mbidsOutsideSchedule({hours:[8,9,10,11],days:[0,1,2,3,4]},{hour:h,dow:d})',c);};
 assert.equal(run(7),true);assert.equal(run(8),false);assert.equal(run(11),false);assert.equal(run(12),true);assert.equal(run(9,5),true);
});
test('pause uses remove with itemID only, not a manual fractional bid',async()=>{
 const c=setup();c.st=c.state.items[101];c.control={};await vm.runInContext("mbidsApplyDecision(env,'a','test','101',st,decision,control)",c);
 assert.equal(c.calls[0].path,'/cpxpromo/1/remove');assert.equal(JSON.stringify(c.calls[0].body),JSON.stringify({itemID:101}));
 assert.equal(c.st.promotionStopped,true);assert.equal(c.st.selectedType,'none');assert.equal(c.st.status,'stop');assert.equal(c.cfg.items[101].bid,70);
});
test('API rejection does not claim promotion stopped',async()=>{
 const c=setup();vm.runInContext("avitoRequest=async()=>new Response('Forbidden',{status:403})",c);c.st=c.state.items[101];c.control={};
 await vm.runInContext("mbidsApplyDecision(env,'a','test','101',st,decision,control)",c);
 assert.equal(c.st.status,'err');assert.equal(c.st.selectedType,'manual');assert.notEqual(c.st.promotionStopped,true);assert.equal(c.st.bidsAt,1);
});
test('429 preserves active state, persists cooldown and prevents immediate replay',async()=>{
 const c=setup();vm.runInContext("avitoRequest=async()=>{calls.push('429');return new Response('',{status:429,headers:{'Retry-After':'120'}})}",c);c.st=c.state.items[101];c.control={};
 await vm.runInContext("mbidsApplyDecision(env,'a','test','101',st,decision,control)",c);
 assert.equal(c.st.status,'pending');assert.equal(c.st.selectedType,'manual');assert.ok(c.records['mbids:control-cooldown:a:remove'].until>Date.now()+110000);
 await vm.runInContext("mbidsApplyDecision(env,'a','test','101',st,decision,control)",c);assert.equal(c.calls.length,1);
});
test('resume restores configured manual bid, bypassing previous paused write',async()=>{
 const c=setup();c.st={...c.state.items[101],promotionStopped:true,selectedType:'none',minPromoPenny:2000,maxPenny:20000,setPenny:7000,setAt:Date.now()};c.control={};
 c.decision=vm.runInContext("mbidsDecide({...cfg.items[101],id:'101'},st,{now:{hour:12,dow:3}})",c);
 assert.equal(c.decision.wantPenny,7000);
 await vm.runInContext("mbidsApplyDecision(env,'a','test','101',st,decision,control)",c);
 assert.equal(c.calls[0].path,'/cpxpromo/1/setManual');assert.equal(c.calls[0].body.bidPenny,7000);assert.equal(c.st.promotionStopped,false);
});
test('daily limit pauses use the same removal method',()=>{
 const c=setup();const r=vm.runInContext("mbidsDecide({id:'101',on:true,bid:70,lim:{spend:100}},{},{now:{hour:12,dow:3},today:{101:{s:100}}})",c);assert.equal(r.action,'remove');assert.match(r.reason,/бюджету/);
});
test('schedule stop pass does not wait for catalog, balance, statistics or bid scales',async()=>{
 const c=setup();vm.runInContext(`mbidsCatalog=fetchAvitoMoney=mbidsFetchTotals=mbidsLoadBids=async()=>{throw new Error('must not run');};
 avitoJson=async(t,path,opts)=>{calls.push({path,body:JSON.parse(opts.body)});return {items:[{itemID:101,manualPromotion:{bidPenny:13300}}]};};`,c);
 const r=await vm.runInContext("mbidsProcess(env,'a',{scheduleStopsOnly:true})",c);
 assert.equal(r.processed,1);assert.equal(c.calls.length,2);assert.equal(c.calls[1].path,'/cpxpromo/1/remove');assert.equal(c.records['mbids:state:a'].items[101].status,'stop');
});
test('bulk check detects promotion re-enabled after a previous stop',async()=>{
 const c=setup();Object.assign(c.state.items[101],{promotionStopped:true,selectedType:'none'});
 vm.runInContext("avitoJson=async()=>({items:[{itemID:101,manualPromotion:{bidPenny:15000}}]})",c);
 await vm.runInContext("mbidsProcess(env,'a',{scheduleStopsOnly:true})",c);assert.equal(c.calls[0].path,'/cpxpromo/1/remove');
});
test('bulk-confirmed stopped listing requires no further removal',async()=>{
 const c=setup();vm.runInContext("avitoJson=async()=>({items:[{itemID:101,manualPromotion:null,autoPromotion:null}]})",c);
 await vm.runInContext("mbidsProcess(env,'a',{scheduleStopsOnly:true})",c);assert.equal(c.calls.length,0);assert.equal(c.records['mbids:state:a'].items[101].status,'stop');
});
test('working-hour listings are never removed by the priority pass',async()=>{
 const c=setup();vm.runInContext("mbidsMsk=()=>({date:'2026-11-19',hour:12,dow:3})",c);
 await vm.runInContext("mbidsProcess(env,'a',{scheduleStopsOnly:true})",c);assert.equal(c.calls.length,0);
});
test('a failed bulk read does not block a required stop',async()=>{
 const c=setup();vm.runInContext("avitoJson=async()=>{throw new Error('read quota')}",c);
 await vm.runInContext("mbidsProcess(env,'a',{scheduleStopsOnly:true})",c);assert.equal(c.calls[0].path,'/cpxpromo/1/remove');
});
test('removals share pacing and stop pass checkpoints more than ten rows',async()=>{
 const c=setup();for(let i=102;i<=112;i++){c.cfg.items[i]={...c.cfg.items[101]};c.state.items[i]={...c.state.items[101]};}
 vm.runInContext("avitoJson=async()=>({items:[]})",c);
 const r=await vm.runInContext("mbidsProcess(env,'a',{scheduleStopsOnly:true})",c);assert.equal(r.processed,12);assert.ok(c.delays.some(ms=>ms>=250));
 for(let i=101;i<=112;i++)assert.equal(c.records['mbids:state:a'].items[i].promotionStopped,true);
});
test('cron starts schedule stops before normal passes and remembers next account',async()=>{
 const c=setup();c.records['mbids:cfg:b']={items:{}};c.records['mbids:cron-next']='b';
 vm.runInContext(`mbidsCfgAccountIds=async()=>['a','b'];mbidsProcess=async(e,id,opts)=>{calls.push({id,stop:!!opts?.scheduleStopsOnly});};`,c);
 await vm.runInContext('mbidsCron(env)',c);assert.equal(c.calls[0].id,'a');assert.equal(c.calls[0].stop,true);assert.equal(c.calls[1].id,'b');assert.equal(c.calls[1].stop,false);
});
test('405 scheduled stops read promotion modes in batches of 200 and process the entire queue',async()=>{
 const c=setup();c.bulks=[];
 for(let i=102;i<=505;i++){c.cfg.items[i]={...c.cfg.items[101]};c.state.items[i]={...c.state.items[101]};}
 vm.runInContext("avitoJson=async(t,p,o)=>{bulks.push(JSON.parse(o.body).itemIDs.length);return {items:[]};}",c);
 const r=await vm.runInContext("mbidsProcess(env,'a',{scheduleStopsOnly:true})",c);
 assert.equal(c.bulks.join(','),'200,200,5');assert.equal(r.processed,405);assert.equal(r.left,0);assert.equal(c.calls.length,405);
 assert.ok(c.calls.every(x=>x.path==='/cpxpromo/1/remove'&&Object.keys(x.body).length===1));
 assert.equal(Object.values(c.records['mbids:state:a'].items).filter(x=>x.promotionStopped).length,405);
});
test('schedule pass stops dispatching when removal quota is exhausted',async()=>{
 const c=setup();for(let i=102;i<=120;i++){c.cfg.items[i]={...c.cfg.items[101]};c.state.items[i]={...c.state.items[101]};}
 vm.runInContext(`avitoJson=async()=>({items:[]});avitoRequest=async()=>{calls.push('429');return new Response('',{status:429})};`,c);
 const r=await vm.runInContext("mbidsProcess(env,'a',{scheduleStopsOnly:true})",c);assert.ok(c.calls.length<=4);assert.ok(r.left>0);
 assert.ok(!Object.values(c.records['mbids:state:a'].items).some(x=>x.promotionStopped));
});
test('a queued removal is cancelled if its working window opens during pacing',async()=>{
 const c=setup();c.h=9;c.st=c.state.items[101];c.control={items:c.cfg.items,removeNext:Date.now()+100};
 vm.runInContext("mbidsMsk=()=>({hour:h,dow:3});sleep=async()=>{h=12}",c);
 await vm.runInContext("mbidsApplyDecision(env,'a','test','101',st,decision,control)",c);assert.equal(c.calls.length,0);assert.equal(c.st.status,'pending');
});
test('a queued manual bid is cancelled if its working window closes during pacing',async()=>{
 const c=setup();c.h=12;c.st={...c.state.items[101],promotionStopped:true,selectedType:'none'};c.control={items:c.cfg.items,setManualNext:Date.now()+100};c.decision={status:'ok',reason:'',wantPenny:7000};
 vm.runInContext("mbidsMsk=()=>({hour:h,dow:3});sleep=async()=>{h=22}",c);
 await vm.runInContext("mbidsApplyDecision(env,'a','test','101',st,decision,control)",c);assert.equal(c.calls.length,0);assert.equal(c.st.promotionStopped,true);
});

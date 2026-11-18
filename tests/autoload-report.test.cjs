const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/../_worker.js`,'utf8').replace('export default {','globalThis.worker = {');
function setup(responses=[]){
 const records={};let count=0;
 const c=vm.createContext({Response,Request,URL,Headers,console,records,
 env:{AVITO_KV:{get:async k=>records[k]?structuredClone(records[k]):null,put:async(k,v)=>{records[k]=JSON.parse(v);}}},
 account:{id:'one'},responses,called:[],
 request:async(path)=>{c.called.push(path);const r=responses[count++];if(!r)throw new Error('Unexpected upstream call');return r;}});
 vm.runInContext(source,c);vm.runInContext(`avitoGetToken=async()=> 'test';avitoRequest=async(t,p)=>request(p);`,c);
 c.run=()=>vm.runInContext('fetchAvitoAutoloadReport(env,account,null)',c);return c;
}
const ok=v=>Response.json(v);
const upload=id=>ok({upload_id:id,status:'finished'});
const page=(n,pages)=>ok({items:Array.from({length:n},(_,i)=>({ad_id:String(i),section:{slug:'success'},messages:i===0?[{type:'error',title:'Photo unavailable'}]:[]})),meta:{pages}});
test('two calls continue pagination and reuse a completed report',async()=>{
 const c=setup([upload('a'),page(50,2),upload('a'),page(3,2)]);
 let r=await c.run();assert.equal(r.summary.complete,false);assert.equal(r.items.length,50);assert.equal(r.items[0].problem,true);
 r=await c.run();assert.equal(r.summary.complete,true);assert.equal(r.items.length,53);assert.match(c.called[3],/page=2/);
 await c.run();assert.equal(c.called.length,4);
});
test('429 preserves pages, respects Retry-After and resumes without page-one replay',async()=>{
 const c=setup([upload('a'),page(50,2),upload('a'),new Response('',{status:429,headers:{'Retry-After':'120'}}),upload('a'),page(2,2)]);
 await c.run();let r=await c.run();assert.equal(r.items.length,50);assert.ok(r.summary.retryAt>Date.now()+110000);
 await c.run();assert.equal(c.called.length,4);
 delete c.records['autoload-report-cooldown:one'];r=await c.run();assert.equal(r.items.length,52);assert.match(c.called[5],/page=2/);
});
test('initial 429 returns an explicitly incomplete report and no fabricated success',async()=>{
 const c=setup([new Response('',{status:429})]);const r=await c.run();assert.equal(r.summary.complete,false);assert.ok(r.summary.warning);assert.equal(r.summary.reportId,null);
});
test('a different upload resets pages instead of mixing reports',async()=>{
 const c=setup([upload('a'),page(50,2),upload('b'),page(1,1)]);await c.run();const r=await c.run();assert.equal(r.summary.reportId,'b');assert.equal(r.items.length,1);assert.match(c.called[3],/page=1/);
});
test('invalid 200 response retains progress and identifies the failing page',async()=>{
 const c=setup([upload('a'),page(50,2),upload('a'),new Response('not JSON')]);await c.run();const r=await c.run();assert.equal(r.items.length,50);assert.equal(r.summary.complete,false);assert.match(r.summary.warning,/page=2/);
});
test('404 uses the existing completed-upload fallback and zero-based v2 pages',async()=>{
 const c=setup([new Response('',{status:404}),ok({uploads:[{upload_id:'old',status:'finished'}]}),page(2,1)]);const r=await c.run();assert.equal(r.summary.complete,true);assert.match(c.called[2],/v2\/reports\/old\/items.*page=0/);
});
test('API messages on successful items are preserved and whitespace is normalized',()=>{
 const c=setup();const r=vm.runInContext(`normalizeAutoloadItem({section:'success',messages:[{type:'warning',title:'Photo',description:'not    ready'}]})`,c);assert.equal(r.problem,true);assert.equal(r.messages[0].text,'Photo: not ready');
});
function parse(tags,values){const c=setup();c.rows=[[],tags,tags.map(()=> 'Грузим в xml'),[],values];return vm.runInContext('feedsParseTab(rows)',c);}
test('BananLab editing controls and missing Category are diagnosed without changing selection',()=>{
 const r=parse(['id','Images','Category','Ссылка на картинку для наложения на фото 1'],['ad-1','https://example.test/image.jpg','','https://example.test/overlay.png']);
 assert.equal(r.ads.length,1);assert.ok(r.problems.some(p=>p.tag==='Images'));assert.ok(r.problems.some(p=>p.tag==='Category'));
});
test('disabled ads and inactive photo controls do not create photo warnings',()=>{
 let r=parse(['id','Category','Сделать картинку 4 на 3'],['ad-1','Предложение услуг','Нет']);assert.equal(r.problems.length,0);
 r=parse(['id','Товар доступен?','Ссылка на картинку для наложения на фото 1'],['ad-1','Нет','https://example.test/overlay.png']);assert.equal(r.ads.length,0);assert.equal(r.problems.length,0);
});
test('BananLab processing status is exposed',()=>{
 const r=parse(['id','Category','Ошибки фото'],['ad-1','Предложение услуг','Картинки редактируется: 4064. Пока редактируются фото, будет не заполнена Категория']);assert.ok(r.problems.some(p=>/ещё редактируются/.test(p.msg)));
});
for(const [file,name] of [['avito-bids','renderReport'],['zagruzka-extra','paintReport']])test(`${file} does not display no-problems for an incomplete report`,()=>{
 const s=fs.readFileSync(`${__dirname}/../${file}`,'utf8');const a=s.indexOf('function '+name+'(');const b=s.indexOf('\n}',a)+2;
 const body={innerHTML:''},csv={disabled:false};const c=vm.createContext({R:{x:{summary:{items:0,complete:false,warning:'Waiting'},problems:[]}},$:q=>q==='#repBody'?body:csv,esc:String,int:String,I:()=>'',probCards:()=>'',probGroups:x=>x});
 vm.runInContext(s.slice(a,b),c);vm.runInContext(`${name}('x')`,c);assert.equal(csv.disabled,true);assert.ok(body.innerHTML.includes('Waiting'));assert.ok(!body.innerHTML.includes('Проблемных объявлений нет'));assert.ok(!body.innerHTML.includes('Проблемных объявлений в отчёте нет'));
});
test('manual refresh checks a new upload even if a complete report is cached',async()=>{
 const c=setup([upload('a'),page(1,1),upload('b'),page(2,1)]);await c.run();
 const r=await vm.runInContext('fetchAvitoAutoloadReport(env,account,null,{refresh:true})',c);assert.equal(r.summary.reportId,'b');assert.equal(r.items.length,2);
});
test('Disk verification failures are exposed by both feed views without modifying saved stats',()=>{
 const c=setup();c.stat={ads:2,problems:[],diskError:'HTTP 524'};
 const v=vm.runInContext("feedsPublicView({}, {slug:'feed-test',sheetId:'sheet'},stat)",c);
 assert.equal(v.stat.problems.length,1);assert.match(v.stat.problems[0].msg,/Яндекс.Диска/);assert.equal(c.stat.problems.length,0);
});

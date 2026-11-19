const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/../_worker.js`,'utf8').replace('export default {','globalThis.worker = {');
function setup(responses=[]){
 const records={};let count=0;
 const c=vm.createContext({Response,Request,URL,Headers,AbortSignal,console,records,
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
 const c=setup([new Response('',{status:404}),new Response('',{status:404}),ok({uploads:[{upload_id:'old',status:'finished'}]}),page(2,1)]);const r=await c.run();assert.equal(r.summary.complete,true);assert.match(c.called[3],/v2\/reports\/old\/items.*page=0/);
});
test('API messages on successful items are preserved and whitespace is normalized',()=>{
 const c=setup();const r=vm.runInContext(`normalizeAutoloadItem({section:'success',messages:[{type:'warning',title:'Photo',description:'not    ready'}]})`,c);assert.equal(r.problem,true);assert.equal(r.messages[0].text,'Photo: not ready');
});
function parse(tags,values){const c=setup();c.rows=[[],tags,tags.map(()=> 'Грузим в xml'),[],values];return vm.runInContext('feedsParseTab(rows)',c);}
test('BananLab controls are diagnosed and missing Category blocks the ad',()=>{
 const r=parse(['id','Images','Category','Ссылка на картинку для наложения на фото 1'],['ad-1','https://example.test/image.jpg','','https://example.test/overlay.png']);
 assert.equal(r.ads.length,1);assert.ok(r.problems.some(p=>p.tag==='Images'));assert.ok(r.problems.some(p=>p.tag==='Category'));
});
test('disabled ads and inactive photo controls do not create photo warnings',()=>{
 let r=parse(['id','Category','Сделать картинку 4 на 3'],['ad-1','Предложение услуг','Нет']);assert.equal(r.problems.length,0);
 r=parse(['id','Товар доступен?','Ссылка на картинку для наложения на фото 1'],['ad-1','Нет','https://example.test/overlay.png']);assert.equal(r.ads.length,0);assert.equal(r.problems.length,0);
});
test('BananLab processing status is exposed',()=>{
 const r=parse(['id','Category','Ошибки фото'],['ad-1','Предложение услуг','Картинки редактируется: 4064. Пока редактируются фото, будет не заполнена Категория']);assert.equal(r.ads[0].blocked,true);assert.ok(r.problems.some(p=>p.skipped));
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
test('latest failed upload is read from current, including actual v4 stats',async()=>{
 const c=setup([ok({upload_id:'failed-new',status:'error',stats:{count:452,sections:[{slug:'not_publish',count:169}]}}),page(2,1)]);
 const r=await c.run();assert.match(c.called[0],/\/current$/);assert.match(c.called[1],/\/current\/items/);assert.equal(r.summary.reportId,'failed-new');assert.equal(r.summary.totalItems,452);assert.equal(r.summary.sectionStats.sections[0].count,169);
});
test('processing upload never reuses a complete old report as the latest result',async()=>{
 const c=setup([upload('old'),page(1,1),ok({upload_id:'new',status:'processing'})]);await c.run();
 const r=await vm.runInContext('fetchAvitoAutoloadReport(env,account,null,{refresh:true})',c);
 assert.equal(r.summary.reportId,'new');assert.equal(r.summary.complete,false);assert.equal(r.items.length,0);assert.match(r.summary.warning,/обрабатывает/);assert.equal(c.called.length,3);
});
test('missing current endpoint falls back to last_successful with paired item endpoint',async()=>{
 const c=setup([new Response('',{status:404}),upload('last'),page(2,1)]);const r=await c.run();assert.equal(r.summary.complete,true);assert.match(c.called[2],/last_successful\/items/);
});
test('blocked rows never enter XML, while unrelated ready rows remain',()=>{
 const c=setup();c.rows=[[],['id','Category','comment'],['Грузим в xml','Грузим в xml','Не грузим'],[],['waiting','Предложение услуг','Картинки редактируется: 4064'],['broken','Предложение услуг','Не удалось загрузить главную фотографию товара, либо еще идет редактирование фото.'],['no-category','',''],['ready','Предложение услуг','']];
 const r=vm.runInContext('feedsBuildXml(feedsParseTab(rows).ads, x=>x)',c);
 assert.equal(r.count,1);assert.equal(r.skipped,3);assert.match(r.xml,/<id>ready<\/id>/);assert.ok(!r.xml.includes('<id>waiting</id>'));assert.ok(!r.xml.includes('<id>broken</id>'));assert.ok(!r.xml.includes('<id>no-category</id>'));
});
test('row automatically becomes eligible after photo status clears and Category returns',()=>{
 const c=setup();c.rows=[[],['id','Category','comment'],['Грузим в xml','Грузим в xml','Не грузим'],[],['waiting','','Пока редактируются фото, будет не заполнена Категория']];
 assert.equal(vm.runInContext('feedsBuildXml(feedsParseTab(rows).ads, x=>x).count',c),0);
 c.rows[4][1]='Предложение услуг';c.rows[4][2]='';
 assert.equal(vm.runInContext('feedsBuildXml(feedsParseTab(rows).ads, x=>x).count',c),1);
});
test('a failed main image is not replaced by a working second image',()=>{
 const c=setup();c.ads=[{id:'photo-failed',row:5,fields:[{tag:'id',value:'photo-failed'},{tag:'Category',value:'Предложение услуг'},{tag:'Images',value:'https://example.test/bad.jpg | https://example.test/good.jpg'}]}];
 const r=vm.runInContext("feedsBuildXml(ads, src=>src.includes('bad')?null:src)",c);assert.equal(r.count,0);assert.equal(r.skipped,1);assert.ok(r.problems[0].skipped);assert.ok(!r.xml.includes('<Ad>'));
});
test('a blocked last duplicate cannot fall back to the earlier ready row',async()=>{
 const c=setup();c.env.AVITO_KV.put=async(k,v)=>{c.records[k]=v.startsWith('<')?v:JSON.parse(v);};c.feed={slug:'test-feed',tabs:['Ads']};c.rows=[[],['id','Category','comment'],['Грузим в xml','Грузим в xml','Не грузим'],[],['same','Предложение услуг',''],['same','Предложение услуг','Не удалось загрузить главную фотографию товара']];
 vm.runInContext(`feedsReadTabs=async()=>({tabs:{Ads:rows},missing:[],allTabs:['Ads']});feedsValidate=async()=>{};feedsS3=()=>null;`,c);
 const s=await vm.runInContext('feedsBuild(env,feed)',c);assert.equal(s.ads,0);assert.equal(s.skipped,1);assert.ok(!c.records['feedxml:test-feed'].includes('<Ad>'));
});
test('provider Category controls readiness even if the sheet Category is filled',async()=>{
 const c=setup();c.feed={photoReadyXml:'https://storage.yandexcloud.net/server1/avito/clients/test/test.xml'};
 c.ads=[{id:'one',fields:[{tag:'Category',value:'Предложение услуг'},{tag:'Images',value:'https://raw.test/old.jpg'}]}];c.stat={problems:[]};
 c.fetch=async()=>new Response('<Ads><Ad><id>one</id><Category/><comment>Не удалось загрузить главную фотографию товара</comment><Images><Image url="https://prepared.test/new.jpg"/></Images></Ad></Ads>');
 await vm.runInContext('feedsApplyPhotoReadiness(feed,ads,stat)',c);assert.equal(c.ads[0].blocked,true);
 assert.ok(c.stat.problems[0].skipped);
 c.ads[0].blocked=false;c.stat.problems=[];
 c.fetch=async()=>new Response('<Ads><Ad><id>one</id><Category>Предложение услуг</Category><Images><Image url="https://prepared.test/new.jpg"/></Images></Ad></Ads>');
 await vm.runInContext('feedsApplyPhotoReadiness(feed,ads,stat)',c);assert.equal(c.ads[0].blocked,false);assert.equal(c.ads[0].fields[1].value,'https://prepared.test/new.jpg');
});
test('new ad absent from provider output is held back',async()=>{
 const c=setup();c.feed={photoReadyXml:'https://storage.yandexcloud.net/server1/avito/clients/test/test.xml'};c.ads=[{id:'new',fields:[]}];c.stat={problems:[]};c.fetch=async()=>new Response('<Ads></Ads>');
 await vm.runInContext('feedsApplyPhotoReadiness(feed,ads,stat)',c);assert.equal(c.ads[0].blocked,true);
});
test('failure to check readiness preserves the previous XML',async()=>{
 const c=setup();c.records['feedxml:test-feed']='<Ads>previous</Ads>';
 c.env.AVITO_KV.put=async(k,v)=>{c.records[k]=v.startsWith('<')?v:JSON.parse(v);};
 c.feed={slug:'test-feed',tabs:['Ads'],photoReadyXml:'https://storage.yandexcloud.net/server1/avito/clients/test/test.xml'};
 c.rows=[[],['id','Category'],['Грузим в xml','Грузим в xml'],[],['one','Предложение услуг']];
 vm.runInContext(`feedsReadTabs=async()=>({tabs:{Ads:rows},missing:[],allTabs:['Ads']});`,c);
 c.fetch=async()=>new Response('',{status:403});
 const stat=await vm.runInContext('feedsBuild(env,feed)',c);assert.match(stat.error,/Сборка остановлена/);assert.match(stat.error,/403/);assert.equal(c.records['feedxml:test-feed'],'<Ads>previous</Ads>');
});
test('readiness source rejects arbitrary hosts and redirects are disallowed',()=>{
 const c=setup();assert.throws(()=>vm.runInContext("feedsPhotoReadyUrl('https://internal.test/feed.xml')",c));assert.throws(()=>vm.runInContext("feedsPhotoReadyUrl('https://storage.yandexcloud.net/other/feed.xml')",c));
});

test('photo readiness uses Worker-supported manual redirects and refuses redirected XML',async()=>{
 const c=setup();c.feed={photoReadyXml:'https://storage.yandexcloud.net/server1/avito/clients/test/test.xml'};c.ads=[{id:'one',fields:[]}];c.stat={problems:[]};
 let calls=0;c.fetch=async(url,opts)=>{calls++;assert.equal(opts.redirect,'manual');return new Response('',{status:302,headers:{Location:'https://other.test/feed.xml'}});};
 await assert.rejects(vm.runInContext('feedsApplyPhotoReadiness(feed,ads,stat)',c),/перенаправление/);assert.equal(calls,1);
 c.fetch=async(url,opts)=>{assert.equal(opts.redirect,'manual');return new Response('<Ads><Ad><id>one</id><Category>Услуги</Category><Images><Image url="https://prepared.test/one.jpg"/></Images></Ad></Ads>');};
 await vm.runInContext('feedsApplyPhotoReadiness(feed,ads,stat)',c);assert.equal(c.ads[0].blocked,undefined);
});
for (const [file,name] of [['avito-bids','renderReport'],['zagruzka-extra','paintReport']]) {
 test(`${file} renders upstream total and marks processing summary as provisional`,()=>{
  const html=fs.readFileSync(`${__dirname}/../${file}`,'utf8');
  const start=html.indexOf(`function ${name}(slug) {`),end=html.indexOf('\n}',start)+2;
  const body={},button={};
  const c=vm.createContext({R:{test:{summary:{reportId:1,totalItems:351,items:0,status:'processing'},problems:[]}},
   $:id=>id==='#repCsv'?button:body,int:String,esc:String,I:()=>'',probCards:()=>'',probGroups:()=>[]});
  vm.runInContext(html.slice(start,end),c);vm.runInContext(`${name}('test')`,c);
  assert.match(body.innerHTML,/351 объявлений/);assert.doesNotMatch(body.innerHTML,/всего 0 объявлений/);assert.match(body.innerHTML,/Сводка ниже предварительная/);
 });
}

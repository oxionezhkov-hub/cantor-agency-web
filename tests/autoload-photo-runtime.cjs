// Run with MINIFLARE_MODULE pointing to an installed Miniflare package when it
// is not a project dependency. No production bindings or network are used.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Miniflare,convertV4MiniflareOptions}=require(process.env.MINIFLARE_MODULE || 'miniflare');
const source=fs.readFileSync(`${__dirname}/../_worker.js`,'utf8');
const functions=['feedsPhotoReadyUrl','feedsApplyPhotoReadiness','feedsAdsIndex'].map(name=>{
 const a=source.search(new RegExp('(?:async )?function '+name+'\\('));
 return source.slice(a,source.indexOf('\n}',a)+2);
}).join('\n');
const script=functions+`
export default { async fetch(req) {
 const path=new URL(req.url).pathname;
 if(path==='/legacy'){try{new Request('https://example.test/',{redirect:'error'});return Response.json({unexpected:true});}catch(err){return Response.json({error:err.message},{status:422});}}
 const feed={photoReadyXml:'https://storage.yandexcloud.net/server1/avito/clients/test/'+path.slice(1)+'.xml'};
 const ads=[{id:'one',fields:[{tag:'Category',value:'Предложение услуг'},{tag:'Images',value:'https://raw.test/old.jpg'}]}];
 const stat={problems:[]};
 try { await feedsApplyPhotoReadiness(feed,ads,stat); return Response.json({ads,stat}); }
 catch(err){return Response.json({error:err.message},{status:422});}
}}`;
test('Workers runtime reads ready photos and refuses redirected readiness requests',async()=>{
 const requests=[];
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-07-13',outboundService:async req=>{
  requests.push(req.url);
  if(req.url.endsWith('/redirect.xml'))return new Response(null,{status:302,headers:{Location:'https://outside.test/forbidden.xml'}});
  return new Response('<Ads><Ad><id>one</id><Category>Предложение услуг</Category><Images><Image url="https://prepared.test/new.jpg"/></Images></Ad></Ads>');
 }}));
 try {
  const legacy=await mf.dispatchFetch('http://test/legacy');
  assert.equal(legacy.status,422);assert.match((await legacy.json()).error,/Invalid redirect value/);
  const ready=await mf.dispatchFetch('http://test/ready');
  assert.equal(ready.status,200);const data=await ready.json();
  assert.equal(data.ads[0].fields[1].value,'https://prepared.test/new.jpg');
  const redirect=await mf.dispatchFetch('http://test/redirect');
  assert.equal(redirect.status,422);assert.match((await redirect.json()).error,/перенаправляет запрос/);
  assert.equal(requests.length,2);assert.ok(!requests.some(u=>u.includes('outside.test')));
 } finally {await mf.dispose();}
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/../_worker.js`,'utf8').replace('export default {','globalThis.worker = {');
function setup(images,folder='',token=true){
 const records={},calls=[];
 const c=vm.createContext({Response,Request,URL,Headers,AbortSignal,console,TextEncoder,Uint8Array,crypto:require('node:crypto').webcrypto,btoa,records,calls,
 env:{AVITO_KV:{get:async k=>k==='feedytok:test'?token?'test-token':null:records[k]??null,put:async(k,v)=>{records[k]=v;}}},
 feed:{slug:'test',secret:'test-secret',tabs:['Ads']},
 ads:[{id:'one',row:5,folder,fields:[{tag:'Category',value:'Предложение услуг'},{tag:'Images',value:images}]}]});
 vm.runInContext(source,c);
 c.rows=[[],['id','Category','Images'],['Грузим в xml','Грузим в xml','Грузим в xml'],[],['one','Предложение услуг',images]];
 vm.runInContext(`feedsReadTabs=async()=>({tabs:{Ads:rows,...${token?"{[FEEDS_YD_TAB]:[[],['test-token-12345678901234567890']]}":"{}"}},missing:[],allTabs:['Ads']});
 feedsValidate=async()=>{};feedsApplyPhotoReadiness=async()=>{};feedsParseTab=()=>({ads,problems:[]});
 feedsDiskIndex=async()=>{calls.push('index');return ['disk:/photos/main.jpg']};`,c);
 return c;
}
test('ready direct images do not list private Disk even when a token exists',async()=>{
 const c=setup('https://storage.yandexcloud.net/prepared/main.jpg');
 vm.runInContext(`feedsDiskIndex=async()=>{throw Error('must not list Disk')}`,c);
 const stat=await vm.runInContext('feedsBuild(env,feed)',c);
 assert.equal(stat.ads,1);assert.equal(stat.diskError,undefined);
 assert.match(c.records['feedxml:test'],/https:\/\/storage.yandexcloud.net\/prepared\/main.jpg/);
});
test('no photos or public Disk images do not require a private file index',async()=>{
 for(const images of ['', 'https://disk.yandex.ru/i/public-photo']){
  const c=setup(images);const stat=await vm.runInContext('feedsBuild(env,feed)',c);
  assert.equal(stat.error,undefined);assert.equal(c.calls.length,0);
 }
});
test('private Disk photos keep indexing and signed links including folder-relative names',async()=>{
 for(const [images,folder] of [['https://disk.yandex.ru/client/disk/photos/main.jpg',''],['main.jpg','https://disk.yandex.ru/client/disk/photos']]){
  const c=setup(images,folder);const stat=await vm.runInContext('feedsBuild(env,feed)',c);
  assert.equal(stat.ads,1);assert.equal(c.calls.length,1);assert.match(c.records['feedxml:test'],/\/feed\/test\/img\//);
 }
});
test('mixed ready and private images still resolve private files',async()=>{
 const c=setup('https://storage.yandexcloud.net/prepared/main.jpg | https://disk.yandex.ru/client/disk/photos/main.jpg');
 const stat=await vm.runInContext('feedsBuild(env,feed)',c);assert.equal(stat.ads,1);assert.equal(c.calls.length,1);
});
test('private index is unnecessary for blocked rows and never uses a missing token',async()=>{
 const c=setup('https://disk.yandex.ru/client/disk/photos/main.jpg');c.ads[0].blocked=true;
 await vm.runInContext('feedsBuild(env,feed)',c);assert.equal(c.calls.length,0);
 const d=setup('https://disk.yandex.ru/client/disk/photos/main.jpg','',false);
 await vm.runInContext('feedsBuild(env,feed)',d);assert.equal(d.calls.length,0);
});

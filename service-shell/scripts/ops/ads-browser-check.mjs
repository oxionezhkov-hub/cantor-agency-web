import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import {setGlobalProxyFromEnv} from 'node:http';
setGlobalProxyFromEnv();
const url=process.argv[2]||'http://127.0.0.1:9155';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
mkdirSync('/tmp/cantor-ads-check',{recursive:true});
try{for(const width of [1440,390]){
 const c=await browser.newContext({viewport:{width,height:960}});
 if(url.startsWith('https:'))await c.route(`${new URL(url).origin}/**`,async route=>{const r=await fetch(route.request().url());const headers=Object.fromEntries(r.headers);for(const n of ['content-encoding','content-length','transfer-encoding'])delete headers[n];await route.fulfill({status:r.status,headers,body:Buffer.from(await r.arrayBuffer())});});
 const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(`${url}/?section=ads`,{waitUntil:'networkidle'});
 await p.getByRole('button',{name:'Создать объявление',exact:true}).click();
 const d=p.getByRole('dialog');await d.getByLabel('Заголовок',{exact:true}).fill('Проверка нового объявления');await d.getByLabel('Текст объявления',{exact:true}).fill('Индивидуальная подготовка к ОГЭ. Начните с диагностики.');
 await d.getByRole('button',{name:'Сохранить',exact:true}).click();await p.reload({waitUntil:'networkidle'});await p.getByRole('button',{name:/Проверка нового объявления/}).first().click();
 await d.getByRole('button',{name:'Продвижение',exact:true}).click();await d.getByLabel('Режим управления').selectOption('position');await d.getByLabel('Ставка за просмотр, ₽').fill('35');await d.getByRole('button',{name:'Сохранить',exact:true}).click();
 await p.getByRole('tab',{name:'Ставки',exact:true}).click();assert.ok((await p.locator('body').innerText()).includes('По позиции'));
 await p.getByRole('tab',{name:'Автозагрузка',exact:true}).click();await p.getByLabel('Ссылка на Google Таблицу',{exact:true}).fill('https://docs.google.com/spreadsheets/d/example-id/edit');await p.getByRole('button',{name:'Сохранить настройки',exact:true}).click();assert.ok((await p.locator('body').innerText()).includes('Чтение таблицы появится'));
 await p.getByRole('tab',{name:'История',exact:true}).click();assert.ok((await p.locator('body').innerText()).includes('Сохранено объявление'));
 await p.getByRole('tab',{name:/^Объявления/}).click();await p.screenshot({path:`/tmp/cantor-ads-check/list-${width}.png`,fullPage:true});
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,`overflow ${width}`);assert.deepEqual(errors,[]);
 await p.getByRole('button',{name:/Проверка нового объявления/}).first().click();await p.screenshot({path:`/tmp/cantor-ads-check/editor-${width}.png`,fullPage:true});await c.close();console.log(JSON.stringify({width,create:true,persistence:true,promotion:true,sheet:true,history:true,errors}));
}}finally{await browser.close();}

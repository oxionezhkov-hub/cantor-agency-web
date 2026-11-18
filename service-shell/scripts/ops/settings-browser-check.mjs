import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
mkdirSync('/tmp/cantor-settings',{recursive:true});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/demo/bootstrap',r=>r.fulfill({json:{tutor:'Елена Добрынина',subject:'Русский язык',readAt:'2026-11-18T00:00:00Z',catalogAt:null,chatsAt:null,ads:[],daily:[],chats:[]}}));
 await page.goto('http://127.0.0.1:9156/?section=acc');
 await page.getByRole('heading',{name:'Конструктор',exact:true}).first().waitFor();
 assert.equal(await page.locator('.support-manager-link').getAttribute('href'),'https://t.me/cantor_agency_manager');
 await page.screenshot({path:`/tmp/cantor-settings/tariff-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Выбрать тариф',exact:true}).first().click();
 const d=page.getByRole('dialog'); await d.waitFor();
 await d.getByRole('button',{name:'Оплатить 9 990 ₽'}).click();
 await d.getByRole('heading',{name:'Тариф выбран'}).waitFor();
 await d.getByRole('button',{name:'Вернуться к тарифу'}).click();
 await page.getByRole('switch',{name:'Автопродление',exact:true}).click();
 await page.getByText('Отключено. Доступ сохранится до конца оплаченного периода.').waitFor();
 for(const tab of ['Кабинет','Уведомления','Профиль','Поддержка и отзывы']){
 await page.getByRole('navigation',{name:'Настройки',exact:true}).getByRole('button',{name:tab,exact:true}).click();
 if(tab==='Уведомления'){
 await page.getByRole('switch',{name:'Уведомления по почте'}).click();
 await page.getByRole('button',{name:'Сохранить предпочтения'}).click();
 await page.getByRole('status').filter({hasText:'Укажите корректный адрес'}).waitFor();
 await page.getByLabel('Электронная почта',{exact:true}).fill('elena@example.ru');
 await page.getByRole('button',{name:'Сохранить предпочтения'}).click();
 await page.getByRole('status').filter({hasText:'Предпочтения уведомлений сохранены'}).waitFor();
 }
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} overflow in ${tab}`);
 await page.screenshot({path:`/tmp/cantor-settings/${tab==='Уведомления'?'notifications':tab==='Поддержка и отзывы'?'support':tab==='Профиль'?'profile':'account'}-${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);await page.close();console.log(JSON.stringify({width,ok:true}));
}}finally{await browser.close()}

#!/usr/bin/env node
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const url = process.argv[2] || "http://127.0.0.1:8080";
const output = process.argv[3] || "/tmp/cantor-service-checks";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const results=[];
try {
 for (const width of [1440,390]) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: "light" });
  const page = await context.newPage(); const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole('heading',{level:1}).waitFor();
  assert.match(await page.getByRole('note').innerText(),/Демонстрационные данные/);
  for(const label of ['Дашборд','Аналитика','Мои объявления','Мои диалоги','База знаний','Настройки']) {
   await page.getByRole('navigation',{name:'Разделы'}).getByRole('button',{name:new RegExp(label)}).click();
   await page.waitForURL(u=>u.searchParams.has('section'));
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
   assert.ok(overflow<=1,`${width}px ${label}: page overflows by ${overflow}px`);
  }
  await page.getByRole('button',{name:'Тёмная тема',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.getByRole('button',{name:'Светлая тема',exact:true}).click();
  await page.getByRole('navigation',{name:'Разделы'}).getByRole('button',{name:'Дашборд',exact:true}).click();
  await page.screenshot({path:`${output}/dashboard-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[],`${width}px browser errors`);
  results.push({width,sections:6,horizontalOverflow:false,themePersistence:true,pageErrors:errors});
  await context.close();
 }
 writeFileSync(`${output}/result.json`,JSON.stringify({url,results},null,2));
 console.log(JSON.stringify({ok:true,url,results,screenshots:output}));
} finally { await browser.close(); }

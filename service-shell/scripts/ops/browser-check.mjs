#!/usr/bin/env node
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const url = process.argv[2] || "http://127.0.0.1:8080";
const output = process.argv[3] || "/tmp/cantor-service-checks";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, env: process.env.CANTOR_BROWSER_DATA_HOME ? { ...process.env, XDG_DATA_HOME: process.env.CANTOR_BROWSER_DATA_HOME } : process.env, proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined, args: ["--no-sandbox"] });
const results=[];
try {
 for (const width of [1440,390]) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: "dark" });
  // When Chromium lacks the managed proxy CA, use Node's validated TLS transport.
  // Certificate verification stays enabled; no ignoreHTTPSErrors or blanket bypass.
  if (process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1") {
    await context.route(`${new URL(url).origin}/**`, async route => {
      const request = route.request();
      const response = await fetch(request.url(), { method: request.method(), headers: request.headers(), body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postDataBuffer(), signal: AbortSignal.timeout(30000) });
      const headers = Object.fromEntries(response.headers);
      for (const name of ["content-encoding", "content-length", "transfer-encoding"]) delete headers[name];
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    });
  }
  await context.addInitScript(() => localStorage.setItem("cantor.service-theme", "dark"));
  const page = await context.newPage(); const errors=[]; const diagnostics=[];
  page.on("console", message => { if (message.type() === "error") diagnostics.push(message.text()); });
  page.on("requestfailed", request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  try { await page.getByRole('heading',{level:1}).waitFor({ state: 'attached' }); }
  catch (error) { await page.screenshot({path:`${output}/failed-${width}.png`,fullPage:true}); console.error(JSON.stringify({pageErrors:errors,diagnostics,body:await page.locator('body').innerText()})); throw error; }

  for(const label of ['Дашборд','Аналитика','Мои объявления','Мои диалоги','База знаний','Настройки']) {
   await page.getByRole('navigation',{name:'Разделы'}).getByRole('button',{name:new RegExp(label)}).click();
   await page.waitForURL(u=>u.searchParams.has('section'));
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
   assert.ok(overflow<=1,`${width}px ${label}: page overflows by ${overflow}px`);
  }
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
  assert.equal(await page.locator('footer, .service-topbar, .service-page-heading, .preview-notice, .preview-tag, .theme-toggle').count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /демоверс|демонстрацион|сохранена в демо|подтверждена в демо/i);
  await page.getByRole('navigation',{name:'Разделы'}).getByRole('button',{name:'Дашборд',exact:true}).click();
  await page.screenshot({path:`${output}/dashboard-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[],`${width}px browser errors`);
  results.push({width,sections:6,horizontalOverflow:false,lightOnly:true,cleanShell:true,pageErrors:errors});
  await context.close();
 }
 writeFileSync(`${output}/result.json`,JSON.stringify({url,results},null,2));
 console.log(JSON.stringify({ok:true,url,results,screenshots:output,transport:process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1" ? "node-tls-verified" : "chromium"}));
} finally { await browser.close(); }

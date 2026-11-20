import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const base = process.env.DASHBOARD_CHECK_URL || "http://127.0.0.1:9157";
const fixture = {
  tutor: "Тестовый репетитор", subject: "Русский язык", readAt: "2026-11-18T06:00:00Z",
  catalogAt: null, chatsAt: null, daily: [],
  accountDaily: [
    { date: "2026-11-16", shows: 2250, views: 185, contacts: 12, spendRub: 1480 },
    { date: "2026-11-17", shows: 2800, views: 243, contacts: 18, spendRub: 1890 },
  ],
  ads: [
    { id: "101", title: "Русский язык ЕГЭ", city: "Москва", status: "active", price: 2000, url: "", description: "" },
    { id: "102", title: "Русский язык ОГЭ", city: "Казань", status: "blocked", price: 2000, url: "", description: "" },
  ],
  chats: [{ id: "chat-1", name: "Мария", lastAt: Date.parse("2026-11-17T10:00:00Z"), lastAuthor: "client",
    lastText: "Добрый день! Есть свободное время?", messages: [
      { id: "m1", at: Date.parse("2026-11-17T10:00:00Z"), author: "client", type: "text", text: "Добрый день! Есть свободное время?" },
    ] }],
  feed: { sheetUrl: "", tabs: [], enabled: true, xmlUrl: null, builtAt: null, adCount: 2,
    problems: [{ row: 12, msg: "Повторяется ID объявления в строке 12" }], report: { errors: 1 } },
};
mkdirSync("/tmp/cantor-dashboard-check", { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.clock.install({ time: new Date("2026-11-18T09:00:00Z") });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/demo/bootstrap", route => route.fulfill({ json: fixture }));
    await page.goto(base);
    await page.getByRole("heading", { name: "Результаты за вчера" }).waitFor();
    assert.match(await page.locator(".brief-metrics").innerText(), /18/);
    assert.match(await page.locator(".brief-metrics").innerText(), /105 ₽/);
    assert.equal(await page.locator(".brief-action").count(), 3);
    await page.screenshot({ path: `/tmp/cantor-dashboard-check/dashboard-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator(".brief-action").first().click();
    await page.getByRole("button", { name: "Ответ не требуется", exact: true }).waitFor();
    await page.getByRole("button", { name: "Ответ не требуется", exact: true }).click();
    // Mobile chat intentionally hides global navigation; use a normal app URL to return.
    await page.goBack();
    await page.locator(".daily-brief").waitFor();
    assert.equal(await page.getByText("Ответить в диалогах · 1", { exact: true }).count(), 0);
    await page.locator(".brief-action").filter({ hasText: "Проверить объявления" }).click();
    await page.locator(".aw-editor").waitFor();
    await page.goBack();
    await page.locator(".brief-action").filter({ hasText: "Разобрать ошибки" }).click();
    await page.locator(".aw-feed-layout").waitFor();
    assert.deepEqual(errors, []);
    await page.close();

    const empty = await browser.newPage({ viewport: { width, height: 1000 } });
    await empty.clock.install({ time: new Date("2026-11-20T09:00:00Z") });
    await empty.route("**/api/demo/bootstrap", route => route.fulfill({ json: { ...fixture, ads: [], chats: [], feed: undefined, accountDaily: [] } }));
    await empty.goto(base);
    await empty.getByRole("heading", { name: "Статистика пока недоступна" }).waitFor();
    assert.match(await empty.locator(".brief-metrics").innerText(), /—/);
    assert.equal(await empty.locator(".brief-action").count(), 0);
    await empty.screenshot({ path: `/tmp/cantor-dashboard-check/empty-${width}.png`, fullPage: true });
    assert.equal(await empty.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await empty.close();
    console.log(`${width}px: metrics, queue, acknowledgement, ad/feed links, empty state, overflow passed`);
  }
} finally { await browser.close(); }

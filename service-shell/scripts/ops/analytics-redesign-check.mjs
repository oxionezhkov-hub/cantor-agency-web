import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// Synthetic bootstrap stays in memory. The protected account snapshot and its
// password must never enter a file, trace, screenshot, browser storage or log.
const base = process.argv[2] || "http://127.0.0.1:9153";
const output = process.argv[3] || "/tmp/cantor-analytics-redesign";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw Error("Synthetic test only runs locally");
mkdirSync(output, { recursive: true });
const names = [
  "Общий заголовок",
  "Общий заголовок",
  ...Array.from({ length: 12 }, (_, i) => `Заголовок ${i + 1}`),
];
const ads = names.map((title, i) => ({
  id: `ad-${i}`,
  title,
  city: i % 2 ? "Казань" : "Москва",
  price: 1000,
  status: "active",
  url: `https://www.avito.ru/${1000 + i}`,
  description: "Занятия",
}));
const dailyAds = ads.map((ad, i) => ({
  date: "2026-11-01",
  adId: ad.id,
  city: ad.city,
  shows: 100 + i * 10,
  views: i === 0 ? 50 : i === 1 ? 60 : 10 + i,
  contacts: i === 0 ? 30 : i === 1 ? 40 : i + 1,
  spendRub: 100 + i * 10,
}));
const account = dailyAds.reduce(
  (a, r) => ({
    shows: a.shows + r.shows,
    views: a.views + r.views,
    contacts: a.contacts + r.contacts,
    spendRub: a.spendRub + r.spendRub,
  }),
  { shows: 0, views: 0, contacts: 0, spendRub: 0 },
);
const snapshot = {
  tutor: "Тестовый преподаватель",
  subject: "Тестовый предмет",
  readAt: "2026-11-17T00:00:00Z",
  catalogAt: 1,
  chatsAt: 1,
  ads,
  chats: Array.from({ length: 7 }, (_, i) => ({
    id: `chat-${i}`,
    name: `Тест ${i}`,
    city: "Москва",
    itemId: "ad-0",
    lastAt: Date.parse("2026-11-01T12:00:00Z"),
    workflowStage: "closed",
    reviewReason: `Причина ${i}`,
    messages: [
      {
        id: `msg-${i}`,
        at: Date.parse("2026-11-01T09:00:00Z"),
        author: "client",
        type: "text",
        text: "Здравствуйте",
      },
    ],
  })),
  daily: [
    {
      date: "2026-11-01",
      budget: account.spendRub,
      views: account.views,
      contacts: account.contacts,
      diagnostics: 3,
      sales: 2,
      updatedAt: "2026-11-02T00:00:00Z",
    },
  ],
  accountDaily: [{ date: "2026-11-01", ...account }],
  adDaily: dailyAds,
  trafficCoverage: ["2026-11-01"],
  defaultPeriod: { from: "2026-11-01", to: "2026-11-01" },
};
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
});
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 } });
    await context.route("**/api/demo/bootstrap", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot),
      }),
    );
    let mutations = 0;
    context.on("request", (r) => {
      if (!["GET", "HEAD"].includes(r.method())) mutations++;
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`${base}/?section=stats`, { waitUntil: "networkidle" });
      const tabs = page.getByRole("tablist", { name: "Отчёты аналитики" });
      await tabs.getByRole("tab", { name: "Обзор", exact: true }).waitFor();
      assert.equal(await tabs.getByRole("tab").count(), 4);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${width} overview overflow`,
      );
      assert.equal(
        await page.getByText("От обращения к первой оплате", { exact: true }).count(),
        0,
      );
      assert.equal(await page.locator(".an-plot .recharts-legend-wrapper").count(), 0);
      await page.screenshot({ path: `${output}/overview-${width}.png`, fullPage: true });
      for (const name of ["Объявления", "Диалоги", "Экономика"]) {
        await tabs.getByRole("tab", { name, exact: true }).click();
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${width} ${name} overflow`,
        );
        assert.doesNotMatch(await page.locator("main").innerText(), /NaN|undefined/);
        if (name === "Объявления") {
          for (const heading of [
            "Заголовки · просмотры",
            "Заголовки · контакты",
            "Города · просмотры",
            "Города · контакты",
          ]) {
            const panel = page
              .locator("article")
              .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
            await panel.waitFor();
            assert.ok((await panel.locator(".an-ranking-list li").count()) <= 5, heading);
          }
          const views = page
            .locator("article")
            .filter({
              has: page.getByRole("heading", { name: "Заголовки · просмотры", exact: true }),
            });
          const item = views.locator("li").filter({ hasText: "Общий заголовок" });
          assert.equal(await item.count(), 1, "Duplicate title must collapse to one row");
          assert.match(await item.innerText(), /110/, "Duplicate views must sum");
          assert.equal(
            await page.locator("[role=tabpanel] svg.recharts-surface").count(),
            0,
            "Ads report contains no charts",
          );
        }
        if (name === "Диалоги") {
          const reasons = page.locator(".an-refusal-list");
          assert.ok((await reasons.locator("a").count()) <= 5, "Top five reasons");
          assert.ok(
            (await page.locator(".an-dialog-advice a").count()) <= 5,
            "Top five recommendations",
          );
          assert.equal(await page.getByText("История обращений", { exact: true }).count(), 1);
          assert.equal(
            await page
              .locator("details")
              .filter({ hasText: "История обращений" })
              .evaluate((e) => e.open),
            false,
          );
        }
        if (name === "Экономика") {
          for (const heading of ["Расходы по заголовкам", "Расходы по городам"]) {
            const panel = page
              .locator("article")
              .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
            await panel.waitFor();
            assert.ok((await panel.locator(".an-ranking-list li").count()) <= 10, heading);
          }
          const help = page.getByRole("button", { name: "Как считается экономика", exact: true });
          await help.click();
          assert.ok((await page.getByRole("dialog").count()) > 0, "LTV help opens");
          await help.click();
          await page.getByRole("textbox", { name: "LTV ученика, ₽", exact: true }).fill("10000");
          await page.getByRole("button", { name: "Сохранить LTV", exact: true }).click();
          assert.equal(
            await page.getByRole("textbox", { name: "LTV ученика, ₽", exact: true }).count(),
            0,
          );
          assert.match(await page.getByTestId("ltv-value").innerText(), /10\s*000/);
          await page.getByRole("button", { name: "Изменить LTV", exact: true }).click();
          assert.equal(
            await page.getByRole("textbox", { name: "LTV ученика, ₽", exact: true }).count(),
            1,
          );
        }
        await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
      }
      assert.equal(mutations, 0);
      assert.deepEqual(errors, []);
      results.push({ width, errors, mutations });
    } catch (e) {
      await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true });
      throw e;
    } finally {
      await context.close();
    }
  }
  writeFileSync(`${output}/result.json`, JSON.stringify({ results }, null, 2));
  console.log(JSON.stringify({ ok: true, results, output }));
} finally {
  await browser.close();
}

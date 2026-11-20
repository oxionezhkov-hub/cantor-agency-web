import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const base = process.argv[2] || "http://127.0.0.1:9184";
const ads = ["a", "b", "c"].map((id, i) => ({
  id,
  title: `Объявление ${id} · длинное название подготовки к экзаменам`,
  city: "Казань",
  price: 1500,
  status: "active",
  url: "",
  description: "Занятия",
  bidding: i ? undefined : { mode: "manual", currentRub: 25, dailyBudgetRub: 500, scale: [] },
}));
const snapshot = {
  tutor: "Проверка",
  subject: "Математика",
  readAt: "2026-11-20T10:00:00Z",
  catalogAt: null,
  chatsAt: null,
  ads,
  daily: [],
  chats: [],
  defaultPeriod: { from: "2026-11-01", to: "2026-11-17" },
  periods: [
    {
      from: "2026-11-01",
      to: "2026-11-17",
      items: [
        { adId: "a", shows: 1000, views: 100, contacts: 10, spendRub: 500 },
        { adId: "b", shows: 0, views: 0, contacts: 0, spendRub: 0 },
        { adId: "c", shows: null, views: null, contacts: null, spendRub: null },
      ],
    },
  ],
};
mkdirSync("/tmp/cantor-comparison", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const mutations = [],
      errors = [];
    await context.route("**/api/**", (route) => {
      if (route.request().method() !== "GET") mutations.push(route.request().url());
      return route.fulfill({
        json: route.request().url().endsWith("/api/demo/bootstrap") ? snapshot : {},
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/?section=ads`);
    const checks = page.locator('.aw-table tbody input[type="checkbox"]');
    await checks.first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Сравнить", exact: true }).count(), 0);
    await checks.nth(0).check();
    assert.equal(await page.getByRole("button", { name: "Сравнить", exact: true }).count(), 0);
    await checks.nth(1).check();
    await checks.nth(2).check();
    const trigger = page.getByRole("button", { name: "Сравнить", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Сравнение объявлений · 3" });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /2026-11-01 — 2026-11-17/);
    assert.equal(
      await dialog
        .locator("tbody tr")
        .filter({ hasText: /^Показы$/ })
        .count(),
      0,
    );
    const shows = dialog
      .locator("tbody tr")
      .filter({ has: page.getByRole("rowheader", { name: "Показы", exact: true }) });
    assert.deepEqual(await shows.locator("td").allTextContents(), ["1 000", "0", "Нет данных"]);
    const cpl = dialog.locator("tbody tr").filter({
      has: page.getByRole("rowheader", {
        name: "Цена контакта (CPL) · расходы / контакты",
        exact: true,
      }),
    });
    assert.deepEqual(await cpl.locator("td").allTextContents(), [
      "50 ₽",
      "Не рассчитывается",
      "Не рассчитывается",
    ]);
    assert.ok(
      await dialog.evaluate(
        (el) =>
          el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth,
      ),
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const scroll = dialog.locator(".ac-scroll");
    await scroll.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    if (width === 390) assert.ok(await scroll.evaluate((el) => el.scrollLeft > 0));
    await scroll.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await page.screenshot({ path: `/tmp/cantor-comparison/compare-${width}.png` });
    const close = dialog.getByRole("button", { name: "Закрыть сравнение" });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    assert.ok(await scroll.evaluate((el) => el === document.activeElement));
    await page.keyboard.press("Tab");
    assert.ok(await close.evaluate((el) => el === document.activeElement));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.ok(
      await trigger.evaluate((el) => el === document.activeElement),
      "focus returns to comparison button",
    );
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: threshold, values, source, overflow, scroll, focus trap, Escape and no mutations passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}

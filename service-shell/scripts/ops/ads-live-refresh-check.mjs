import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const base = process.argv[2] || "http://127.0.0.1:9162";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
mkdirSync("/tmp/cantor-ads-refresh", { recursive: true });
try {
  for (const width of [390, 1440]) {
    const p = await b.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const known = {
      id: "123",
      title: "Тестовое действующее объявление",
      city: "Казань",
      price: 1500,
      status: "active",
      url: "",
      description: "Описание",
      photos: ["https://example.test/one"],
      bidding: { mode: "manual", currentRub: 25, maxRub: 80 },
    };
    await p.route("**/api/demo/bootstrap", (r) =>
      r.fulfill({
        json: {
          tutor: "Тест",
          subject: "Тест",
          readAt: "2026-11-17",
          ads: [known],
          daily: [],
          chats: [],
          defaultPeriod: { from: "2026-11-01", to: "2026-11-17" },
          periods: [
            {
              from: "2026-11-01",
              to: "2026-11-17",
              items: [{ adId: "123", shows: 100, views: 10, contacts: 2, spendRub: 50 }],
            },
          ],
        },
      }),
    );
    await p.route("**/api/demo/image?*", (r) =>
      r.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="gray"/></svg>',
      }),
    );
    await p.route("**/api/demo/live?*", async (r) => {
      const section = new URL(r.request().url()).searchParams.get("section");
      let data = {};
      if (section === "ads") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        data = {
          ads: [
            { id: "999", title: "А архив", status: "old", city: "", price: null },
            { ...known, photos: undefined, description: null, city: "", price: null },
          ],
          coverage: { complete: true },
        };
      }
      if (section === "autoload")
        data = {
          rows: [
            {
              id: "123",
              autoloadId: "x",
              status: "active",
              errors: ["Очень длинная ошибка автозагрузки ".repeat(100)],
            },
          ],
          report: { status: "warning" },
        };
      if (section === "chats") data = { chats: [] };
      if (section === "metrics") data = { days: [], coverage: { complete: false } };
      await r.fulfill({ json: { section, observedAt: new Date().toISOString(), data } });
    });
    await p.goto(base + "/?section=ads&focus=list");
    await p.locator(".aw-autoload-error").waitFor();
    const row = p.locator(".aw-list-view tbody tr").first();
    assert.equal(await p.getByRole("columnheader",{name:/Статус/}).getAttribute("aria-sort"),"descending");
    assert.ok(await row.getByText("В публикации", { exact: true }).count());
    assert.ok(await row.getByText("Казань · 1 500 ₽", { exact: true }).count());
    assert.equal(await row.locator("td").nth(3).textContent(), "100");
    assert.ok(await row.locator("img").evaluate((el) => el.naturalWidth > 0));
    assert.ok(
      await row
        .locator("td")
        .nth(2)
        .evaluate((el) => el.getBoundingClientRect().width < 240),
    );
    assert.ok(
      await p.locator(".aw-table").evaluate((el) => el.getBoundingClientRect().width < 1600),
    );
    await row.locator(".aw-ad").click();
    const editor = p.getByRole("dialog", { name: "Редактор объявления" });
    await editor.getByLabel("Заголовок", { exact: true }).fill("Локальная правка");
    await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
    await p.evaluate(() => window.dispatchEvent(new Event("cantor-preview-live")));
    assert.ok(await p.getByText("Локальная правка", { exact: true }).count());
    assert.deepEqual(errors, []);
    await p.screenshot({ path: `/tmp/cantor-ads-refresh/ads-${width}.png` });
    console.log(
      JSON.stringify({
        width,
        photoRetained: true,
        cityAndPriceRetained: true,
        metricsRetained: true,
        publishedFirst: true,
        statusBounded: true,
        errors,
      }),
    );
    await p.close();
  }
} finally {
  await b.close();
}

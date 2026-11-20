import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
mkdirSync("/tmp/cantor-avito-audit-check", { recursive: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, acceptDownloads: true });
    const calls = [];
    let failed = false;
    await page.route("**/api/demo/bootstrap", (r) =>
      r.fulfill({
        json: {
          accountId: "6c974a5d5326",
          tutor: "Елена Добрынина",
          subject: "Русский язык",
          ads: [],
          daily: [],
          chats: [],
        },
      }),
    );
    await page.route("**/api/demo/avito-audit?*", (r) => {
      const url = new URL(r.request().url());
      const section = url.searchParams.get("section"),
        number = Number(url.searchParams.get("page"));
      calls.push([section, number]);
      if (section === "items" && number === 1 && !failed) {
        failed = true;
        return r.fulfill({
          json: {
            section,
            page: number,
            status: "error",
            error: "http_503",
            coverage: { nextPage: number, complete: false },
          },
        });
      }
      return r.fulfill({
        json: {
          section,
          page: number,
          status: "available",
          summary: { records: section === "items" ? 50 : 0 },
          coverage: {
            complete: section !== "items" || number === 1,
            nextPage: section === "items" && number === 0 ? 1 : null,
          },
        },
      });
    });
    await page.goto((process.argv[2] || "http://127.0.0.1:9168") + "/?section=acc");
    await page.getByRole("button", { name: "Собрать отчёт Авито", exact: true }).click();
    await page.getByLabel("Допуск администратора").fill("synthetic-only");
    await page.getByRole("button", { name: "Начать сбор", exact: true }).click();
    await page.getByText("Проход завершён.", { exact: false }).waitFor();
    assert.equal(calls.filter(([s, p]) => s === "items" && p === 0).length, 1);
    const partial = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Скачать JSON", exact: true }).click(),
    ]);
    const file = await partial[0].path();
    const report = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(report.sections.find((s) => s.id === "items").pages[1].status, "error");
    assert.doesNotMatch(JSON.stringify(report), /synthetic-only/);
    await page.getByRole("button", { name: "Продолжить / повторить ошибки", exact: true }).click();
    await page.getByText("Объявления: готово", { exact: false }).waitFor();
    assert.equal(calls.filter(([s, p]) => s === "items" && p === 0).length, 1);
    assert.equal(calls.filter(([s, p]) => s === "items" && p === 1).length, 2);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page
      .locator(".st-avito-audit > .st-connection-fields")
      .screenshot({ path: `/tmp/cantor-avito-audit-check/${width}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("Synthetic audit UI: partial export and resume passed at 390/1440px");

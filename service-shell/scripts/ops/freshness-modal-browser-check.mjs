import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
mkdirSync("/tmp/cantor-freshness-modal", { recursive: true });
const base = process.argv[2] || "http://127.0.0.1:9178";
try {
  for (const width of [1440, 390]) {
    const p = await b.newPage({ viewport: { width, height: 1000 } }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.name));
    await p.route("**/api/demo/bootstrap", (r) =>
      r.fulfill({
        json: {
          tutor: "Тестовый преподаватель",
          subject: "Тест",
          readAt: "2026-11-01T00:00:00Z",
          catalogAt: Date.now() - 86400000,
          chatsAt: Date.now() - 86400000,
          ads: [],
          daily: [],
          chats: [],
        },
      }),
    );
    await p.route("**/api/demo/live?*", (r) => {
      const section = new URL(r.request().url()).searchParams.get("section");
      const at = new Date().toISOString();
      if (section === "ads")
        return r.fulfill({
          json: { section, observedAt: at, data: { ads: [], coverage: { complete: true } } },
        });
      if (section === "autoload")
        return r.fulfill({
          status: 502,
          json: {
            error: "http_429",
            origin: "avito",
            lastGood: {
              section,
              observedAt: new Date(Date.now() - 400000).toISOString(),
              data: { rows: [], report: {}, coverage: { complete: true } },
            },
          },
        });
      if (section === "chats")
        return r.fulfill({
          json: {
            section,
            observedAt: at,
            data: { chats: [], coverage: { complete: false, truncated: true, nextOffset: null } },
          },
        });
      return r.fulfill({
        json: {
          section,
          observedAt: at,
          data: {
            wallet: { realRub: 1000, bonusRub: 0, observedAt: at },
            advance: { rub: 3000, observedAt: at },
            days: [],
            coverage: { complete: false },
            errors: [],
          },
        },
      });
    });
    await p.goto(base + "/?section=today");
    await p.getByRole("heading", { name: "Средства Авито", exact: true }).waitFor();
    assert.equal(await p.getByText("Актуальность данных Авито", { exact: true }).count(), 0);
    await p.goto(base + "/?section=acc");
    await p.getByRole("heading", { name: "Кабинет Авито", exact: true }).waitFor();
    const names = [
      "Открыть кабинет",
      "Параметры подключения",
      "Собрать отчёт Авито",
      "Актуальность данных Авито",
    ];
    const actions = p.locator(".st-account-actions");
    assert.equal(await actions.getByRole("button").count(), 3);
    assert.equal(await actions.getByRole("link").count(), 1);
    const bounds = [];
    for (const name of names) {
      const el = actions.getByRole(name === "Открыть кабинет" ? "link" : "button", {
        name,
        exact: true,
      });
      bounds.push(await el.boundingBox());
    }
    if (width === 1440)
      assert.equal(
        Math.max(...bounds.map((x) => x.y)) - Math.min(...bounds.map((x) => x.y)) < 2,
        true,
      );
    assert.equal(
      await actions
        .getByRole("link", { name: "Открыть кабинет", exact: true })
        .getAttribute("href"),
      "https://www.avito.ru/profile",
    );
    await actions.getByRole("button", { name: "Параметры подключения", exact: true }).click();
    await p.getByText("Client ID", { exact: true }).waitFor();
    await actions.getByRole("button", { name: "Параметры подключения", exact: true }).click();
    await actions.getByRole("button", { name: "Собрать отчёт Авито", exact: true }).click();
    await p.getByLabel("Допуск администратора").waitFor();
    await actions.getByRole("button", { name: "Собрать отчёт Авито", exact: true }).click();
    const trigger = actions.getByRole("button", { name: "Актуальность данных Авито", exact: true });
    await trigger.focus();
    await p.keyboard.press("Enter");
    const dialog = p.getByRole("dialog", { name: "Актуальность данных Авито", exact: true });
    await dialog.waitFor();
    await dialog.getByRole("heading", { name: "Объявления", exact: true }).waitFor();
    await dialog.getByText("Частично", { exact: true }).first().waitFor();
    await dialog.getByText("Нет обновления", { exact: true }).waitFor();
    await dialog.getByText("Как читать статусы", { exact: true }).waitFor();
    assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press("Tab");
      assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
    }
    await dialog.screenshot({ path: `/tmp/cantor-freshness-modal/modal-${width}.png` });
    await p.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await p.waitForFunction(()=>document.activeElement?.textContent?.trim()==="Актуальность данных Авито");
    assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
    await actions.screenshot({ path: `/tmp/cantor-freshness-modal/actions-${width}.png` });
    assert.deepEqual(errors, []);
    await p.close();
  }
} finally {
  await b.close();
}
console.log("Freshness modal 390/1440: row, wrapping, existing actions, statuses, keyboard passed");

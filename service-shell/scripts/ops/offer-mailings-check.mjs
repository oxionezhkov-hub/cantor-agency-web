import { chromium } from "playwright";
import assert from "node:assert/strict";
import { setGlobalProxyFromEnv } from "node:http";
import { mkdirSync } from "node:fs";
setGlobalProxyFromEnv();
const local = "http://127.0.0.1:9162",
  remote = "https://cantor-service-preview.oxion-ezhkov.workers.dev";
const base = process.argv.includes("--cloud") ? remote : local;
mkdirSync("/tmp/cantor-ads-nov18", { recursive: true });
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  for (const width of process.argv.includes("--mobile") ? [390] : [1440, 390]) {
    const c = await b.newContext({ viewport: { width, height: 900 } });
    await c.route(base + "/**", async (route) => {
      const q = route.request(),
        u = new URL(q.url());
      if (base === local && !u.pathname.startsWith("/api/demo/")) return route.continue();
      const headers = { ...q.headers() };
      delete headers.host;
      const r = await fetch((base === local ? remote : base) + u.pathname + u.search, {
        method: q.method(),
        headers,
        signal: AbortSignal.timeout(120000),
      });
      const h = Object.fromEntries(r.headers);
      for (const k of ["content-length", "content-encoding", "transfer-encoding"]) delete h[k];
      await route.fulfill({
        status: r.status,
        headers: h,
        body: Buffer.from(await r.arrayBuffer()),
      });
    });
    const p = await c.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.getByLabel("Пароль", { exact: true }).fill(process.env.DASHBOARD_PASSWORD);
    await p.getByRole("button", { name: "Войти", exact: true }).click();
    const nav = p.locator("#service-navigation");
    if (width === 390) await p.locator(".service-mobile-menu-button").waitFor({ timeout: 120000 });
    const openMenu = async () => {
      if (width === 390 && (await p.getByRole("button", { name: "Открыть меню" }).count()))
        await p.getByRole("button", { name: "Открыть меню" }).click();
    };
    await openMenu();
    await nav.getByRole("button", { name: /^Мои объявления/ }).waitFor({ timeout: 120000 });
    await nav.getByRole("button", { name: /^Мои объявления/ }).click();
    await p.locator(".aw-table tbody tr").first().waitFor();
    await openMenu();
    await nav.getByRole("button", { name: "Рассылки", exact: true }).click();
    const form = p.locator(".om");
    for (const label of [
      "Название плана",
      "Предложение ученику",
      "Общий бюджет, ₽",
      "Дата запуска",
    ])
      assert.equal(await form.getByLabel(label, { exact: true }).count(), 0);
    const check = form.getByRole("button", { name: "Проверить доступность", exact: true });
    assert.ok(await check.isDisabled());
    await form.locator(".om-ads input[type=checkbox]").first().check();
    assert.equal(await check.isDisabled(), false);
    await check.click();
    assert.ok(
      await form
        .getByText(
          "Проверка доступности рассылок пока не подключена. Данные из Авито не получены; рассылка не создана.",
        )
        .count(),
    );
    assert.equal(
      await form.getByRole("button", { name: "Оплатить и отправить", exact: true }).count(),
      0,
    );
    await p.screenshot({ path: `/tmp/cantor-ads-nov18/mailings-${width}.png` });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        apiFieldsOnly: true,
        noExternalSend: true,
        unknownMetrics: true,
        eligibilityGate: true,
        errors,
      }),
    );
    await c.close();
  }
} finally {
  await b.close();
}

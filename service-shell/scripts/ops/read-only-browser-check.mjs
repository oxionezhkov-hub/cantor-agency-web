import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const base = process.argv[2] || "http://127.0.0.1:8080";
const output = process.argv[3] || "/tmp/cantor-read-only";
assert.ok(process.env.DASHBOARD_PASSWORD, "Set DASHBOARD_PASSWORD without logging it");
mkdirSync(output, { recursive: true });
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
    if (process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1") {
      await context.route(`${new URL(base).origin}/**`, async (route) => {
        const request = route.request();
        const response = await fetch(request.url(), {
          method: request.method(),
          headers: request.headers(),
          signal: AbortSignal.timeout(120000),
        });
        const headers = Object.fromEntries(response.headers);
        for (const key of ["content-encoding", "content-length", "transfer-encoding"])
          delete headers[key];
        await route.fulfill({
          status: response.status,
          headers,
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
    }
    const page = await context.newPage();
    const errors = [],
      mutations = [],
      external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (!["GET", "HEAD"].includes(r.method()))
        mutations.push({ url: r.url(), method: r.method() });
      if (new URL(r.url()).origin !== new URL(base).origin) external.push(r.url());
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Кабинет Елены Добрыниной" }).waitFor();
    assert.equal(await page.getByRole("navigation", { name: "Разделы" }).count(), 0);
    await page.getByLabel("Пароль панели агентства").fill("invalid-test-password");
    await page.getByRole("button", { name: "Открыть демо", exact: true }).click();
    await page.getByRole("alert").waitFor();
    await page.getByLabel("Пароль панели агентства").fill(process.env.DASHBOARD_PASSWORD);
    await page.getByRole("button", { name: "Открыть демо", exact: true }).click();
    await page.getByRole("navigation", { name: "Разделы" }).waitFor({ timeout: 120000 });
    const nav = page.getByRole("navigation", { name: "Разделы" });
    for (const label of [
      "Дашборд",
      "Аналитика",
      "Мои объявления",
      "Мои диалоги",
      "База знаний",
      "Настройки",
    ]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await page
        .getByRole("heading", { level: 1, name: label, exact: true })
        .waitFor({ state: "attached" });
      await page.waitForTimeout(150);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${width}: overflow in ${label}`,
      );
      assert.doesNotMatch(
        await page.locator("main").innerText(),
        /Анна Смирнова|Математика ЕГЭ, с 60|Алгебра, 8 класс/,
      );
    }
    await nav.getByRole("button", { name: "Аналитика", exact: true }).click();
    assert.ok((await page.locator(".ro-table tbody tr").count()) > 0);
    for (const tab of ["Объявления", "Диалоги", "Экономика", "Обзор"])
      await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.screenshot({ path: `${output}/analytics-${width}.png`, fullPage: true });
    await nav.getByRole("button", { name: "Мои объявления", exact: true }).click();
    assert.equal(await page.locator(".ro-ad-list article").count(), 143);
    await page.getByPlaceholder("Название, город или ID").fill("Казань");
    assert.ok((await page.locator(".ro-ad-list article").count()) > 0);
    assert.ok((await page.locator(".ro-ad-list article").count()) < 143);
    await page.locator(".ro-ad-list summary").first().click();
    assert.ok(await page.locator(".ro-ad-text").first().isVisible());
    await nav.getByRole("button", { name: "Мои диалоги", exact: true }).click();
    assert.equal(await page.locator(".ro-chat-list button").count(), 187);
    await page.locator(".ro-chat-list button").first().click();
    await page.locator(".ro-messages article").first().waitFor({ timeout: 30000 });
    assert.equal(
      await page.locator("textarea, input[type=file], [contenteditable=true]").count(),
      0,
    );
    await page.screenshot({ path: `${output}/dialog-${width}.png`, fullPage: true });
    await nav.getByRole("button", { name: "Дашборд", exact: true }).click();
    await page.screenshot({ path: `${output}/dashboard-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(mutations, []);
    assert.deepEqual(external, []);
    const persisted = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    assert.ok(!persisted.includes(process.env.DASHBOARD_PASSWORD));
    await page.getByRole("button", { name: "Выйти из демо" }).click();
    await page.getByRole("heading", { name: "Кабинет Елены Добрыниной" }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Кабинет Елены Добрыниной" }).waitFor();
    results.push({
      width,
      sections: 6,
      ads: 143,
      chats: 187,
      mutations: 0,
      externalRequests: 0,
      errors,
    });
    await context.close();
  }
  writeFileSync(`${output}/result.json`, JSON.stringify({ base, results }, null, 2));
  console.log(JSON.stringify({ ok: true, results, output }));
} finally {
  await browser.close();
}

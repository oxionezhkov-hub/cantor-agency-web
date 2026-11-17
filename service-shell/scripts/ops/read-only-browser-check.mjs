import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const base = process.argv[2] || "http://127.0.0.1:8080";
const output = process.argv[3] || "/tmp/cantor-original-data";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
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
    if (process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1")
      await context.route(`${new URL(base).origin}/**`, async (route) => {
        const q = route.request(),
          r = await fetch(q.url(), {
            method: q.method(),
            headers: q.headers(),
            signal: AbortSignal.timeout(120000),
          }),
          headers = Object.fromEntries(r.headers);
        for (const k of ["content-length", "content-encoding", "transfer-encoding"])
          delete headers[k];
        await route.fulfill({
          status: r.status,
          headers,
          body: Buffer.from(await r.arrayBuffer()),
        });
      });
    const page = await context.newPage(),
      errors = [],
      consoleErrors = [],
      mutations = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("401")) consoleErrors.push(m.text());
    });
    page.on("request", (r) => {
      if (!["GET", "HEAD"].includes(r.method())) mutations.push(r.method() + " " + r.url());
    });
    try {
      await page.goto(base, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Вход в кабинет" }).waitFor();
      await page.getByLabel("Пароль", { exact: true }).fill(process.env.DASHBOARD_PASSWORD);
      const loaded = page.waitForResponse(
        (r) => r.url().endsWith("/api/demo/bootstrap") && r.status() === 200,
        { timeout: 120000 },
      );
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      const source = await (await loaded).json();
      const nav = page.getByRole("navigation", { name: "Разделы" });
      await nav.waitFor({ timeout: 120000 });
      assert.equal(await nav.getByRole("button").count(), 6);
      for (const label of [
        "Дашборд",
        "Аналитика",
        "Мои объявления",
        "Мои диалоги",
        "База знаний",
        "Настройки",
      ]) {
        await nav.getByRole("button", { name: label, exact: true }).click();
        await page.waitForTimeout(180);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${width}: overflow ${label}`,
        );
        assert.doesNotMatch(
          await page.locator("main").innerText(),
          /только чтение|Данные Добрыниной|сохранённые источники|Анна Смирнова|не число|NaN/i,
        );
      }
      await nav.getByRole("button", { name: "Дашборд", exact: true }).click();
      assert.equal(await page.locator(".dashboard-overview").count(), 1);
      assert.equal(await page.locator(".dashboard-funnel").count(), 2);
      await page.screenshot({ path: `${output}/dashboard-${width}.png`, fullPage: true });
      await nav.getByRole("button", { name: "Аналитика", exact: true }).click();
      assert.equal(await page.locator(".an-compact-toolbar").count(), 1);
      assert.equal(await page.getByRole("tab").count(), 4);
      for (const tab of ["Объявления", "Диалоги", "Экономика", "Обзор"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await page.waitForTimeout(100);
        assert.doesNotMatch(await page.locator("main").innerText(), /NaN|не число/);
      }
      await page.screenshot({ path: `${output}/analytics-${width}.png`, fullPage: true });
      await nav.getByRole("button", { name: "Мои объявления", exact: true }).click();
      assert.equal(await page.getByRole("tab", { name: "Автозагрузка", exact: true }).count(), 1);
      assert.equal(await page.locator(".aw-table tbody tr").count(), source.ads.length);
      await page.getByLabel("Поиск объявлений", { exact: true }).fill("Казань");
      assert.ok((await page.locator(".aw-table tbody tr").count()) > 0);
      await page.screenshot({ path: `${output}/ads-${width}.png`, fullPage: true });
      await page.getByLabel("Поиск объявлений", { exact: true }).fill("");
      await page
        .getByRole("button", { name: /^Редактировать / })
        .first()
        .click();
      const editor = page.getByRole("dialog", { name: "Редактор объявления" });
      await editor.waitFor();
      assert.ok(
        (await editor.getByLabel("Заголовок", { exact: true }).inputValue()).includes("русскому"),
      );
      await editor.getByRole("button", { name: "Отмена", exact: true }).click();
      await nav.getByRole("button", { name: "Мои диалоги", exact: true }).click();
      await page.getByRole("button", { name: "Без ответа", exact: false }).click();
      assert.equal(await page.locator(".workbench-contact").count(), source.chats.length);
      assert.equal(await page.getByRole("button", { name: "CRM", exact: true }).count(), 1);
      const target = source.chats.find(
        (c) => c.id.includes("~") && source.chats.filter((x) => x.name === c.name).length === 1,
      );
      if (target)
        await page
          .getByRole("button", { name: `Открыть обращение: ${target.name}`, exact: true })
          .click();
      else await page.locator(".workbench-contact").first().click();
      await page.locator(".contact-chat").waitFor();
      if (target) assert.equal(new URL(page.url()).searchParams.get("focus"), target.id);
      assert.ok(
        (await page.locator(".message-bubble").count()) > 0 ||
          (await page.locator(".contact-messages").innerText()),
      );
      await page.screenshot({ path: `${output}/dialog-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(mutations, []);
      results.push({
        width,
        sections: 6,
        originalShell: true,
        noAddedLabels: true,
        ads: source.ads.length,
        chats: source.chats.length,
        messages: source.chats.reduce((n, c) => n + (c.messages?.length || 0), 0),
        errors,
        mutations,
      });
    } catch (e) {
      await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true });
      console.error(
        JSON.stringify({
          errors,
          consoleErrors,
          body: (await page.locator("body").innerText()).slice(0, 2000),
        }),
      );
      throw e;
    } finally {
      await context.close();
    }
  }
  writeFileSync(`${output}/result.json`, JSON.stringify({ base, results }, null, 2));
  console.log(JSON.stringify({ ok: true, results, output }));
} finally {
  await browser.close();
}

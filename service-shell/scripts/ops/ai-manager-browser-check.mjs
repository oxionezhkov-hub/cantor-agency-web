import { chromium } from "playwright";
import assert from "node:assert/strict";
import { defaults } from "./ai-defaults.mjs";
import { models } from "./ai-manager.mjs";
const base = process.argv[2] || "http://127.0.0.1:9166";
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 960 } });
    let generated = 0;
    await ctx.route("**/api/**", (r) => r.abort());
    await ctx.route("**/api/demo/bootstrap", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tutor: "Тест",
          subject: "Предмет",
          readAt: "2026-11-18T00:00:00Z",
          catalogAt: 1,
          chatsAt: 1,
          ads: [],
          daily: [],
          chats: [
            {
              id: "ai-test",
              name: "Клиент",
              lastAt: 1794906000000,
              messages: [
                {
                  id: "m1",
                  at: 1794906000000,
                  author: "client",
                  type: "text",
                  text: "Здравствуйте, готовитесь к ЕГЭ?",
                },
              ],
            },
          ],
        }),
      }),
    );
    await ctx.route("**/api/demo/ai-manager", async (r) => {
      if (r.request().method() === "GET")
        return r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            models,
            settings: {
              ...defaults,
              model: models[0].value,
              scripts: JSON.stringify(defaults.scripts),
            },
          }),
        });
      generated++;
      assert.equal(r.request().postDataJSON().settings.knowledge, "Проверенная база");
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          text: "Здравствуйте! Давайте обсудим подготовку на диагностике. Когда Вам удобно?",
        }),
      });
    });
    const p = await ctx.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/?section=chats&view=ai", { waitUntil: "networkidle" });
    await p.locator(".ai-manager").getByRole("tab", { name: "База знаний", exact: true }).click();
    await p.getByRole("textbox", { name: "Настройки ИИ-менеджера" }).fill("Проверенная база");
    await p.screenshot({ path: `/tmp/aim-${width}-editor.png`, fullPage: true });
    await p.getByRole("tab", { name: "Сценарии", exact: true }).click();
    await p.getByRole("button", { name: "Добавить сценарий" }).click();
    await p.getByRole("textbox", { name: /^Название сценария/ }).fill("Запись на диагностику");
    await p
      .getByRole("textbox", { name: /^Когда применять сценария/ })
      .fill("Клиент готов выбрать время");
    await p.screenshot({ path: `/tmp/aim-${width}-scenarios.png`, fullPage: true });
    await p.getByRole("button", { name: /Запись на диагностику Клиент готов/ }).click();
    assert.equal(await p.getByRole("textbox", { name: /^Название сценария/ }).count(), 0);
    await p.getByRole("tab", { name: "Правки ответов" }).click();
    await p.getByText("Пока нет правок", { exact: true }).waitFor();
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (width === 390) await p.getByRole("button", { name: "Открыть меню" }).click();
    await p
      .getByRole("navigation", { name: "Разделы" })
      .getByRole("button", { name: "Сообщения", exact: true })
      .click();
    await p.getByRole("button", { name: "Открыть обращение: Клиент", exact: true }).click();
    await p.getByRole("button", { name: "Подготовить ответ ИИ" }).click();
    await p.getByRole("button", { name: "Одобрить и отправить" }).waitFor();
    await p.getByRole("button", { name: "Одобрить и отправить" }).click();
    // Protected live-read currently blocks sending; design changes must not enable Avito writes.
    await p
      .getByText(
        "Отправка отключена для этого подключения. Текст не отправлен и остаётся в редакторе.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await p.locator(".message-bubble.manager").filter({ hasText: "Давайте обсудим" }).count(),
      0,
    );
    assert.equal(await p.getByText(/Проверено \d/).count(), 0);
    assert.equal(generated, 1);
    assert.deepEqual(errors, []);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log(
      JSON.stringify({ width, settings: true, generation: true, sendBlocked: true, errors: 0 }),
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}

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
    const requests = [];
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
              knowledge: "Исходная база\nС кем работает: 5–11 классы",
              model: models[0].value,
              scripts: JSON.stringify(defaults.scripts),
            },
          }),
        });
      requests.push(r.request().postDataJSON());
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
    await p.getByRole("button", { name: /О преподавателе/ }).click();
    await p.getByRole("textbox", { name: "О преподавателе" }).fill("Проверенная база");
    await p.getByRole("button", { name: "Проверить в чате" }).click();
    await p.getByRole("button", { name: "Сколько стоит занятие?" }).click();
    await p.getByRole("textbox", { name: "Напишите как клиент" }).press("Enter");
    await p.getByRole("button", { name: "Исправить и запомнить" }).click();
    await p
      .getByRole("textbox", { name: "Как лучше ответить" })
      .fill("Обсудим условия на диагностике.");
    await p.getByRole("button", { name: "Запомнить пример" }).click();
    await p.getByRole("button", { name: "Проверить ещё раз" }).click();
    await p.getByRole("button", { name: "Исправить и запомнить" }).waitFor();
    assert.deepEqual(requests[1].messages, requests[0].messages);
    assert.match(requests[1].feedback, /Обсудим условия/);
    assert.equal(requests[1].settings.knowledge, "Проверенная база\nС кем работает: 5–11 классы");
    await p.getByRole("textbox", { name: "Напишите как клиент" }).fill("Как записаться?");
    await p.getByRole("button", { name: "Отправить тестовое сообщение" }).click();
    await p.getByRole("button", { name: "Исправить и запомнить" }).waitFor();
    assert.deepEqual(
      requests[2].messages.map((m) => m.role),
      ["user", "assistant", "user"],
    );
    await p.screenshot({ path: `/tmp/aim-${width}-test-chat.png` });
    await p.getByRole("tab", { name: /Правки ответов/ }).click();
    await p.getByText("Обсудим условия на диагностике.", { exact: true }).waitFor();
    await p.getByRole("button", { name: /Удалить пример/ }).click();
    await p.getByRole("tab", { name: "База знаний", exact: true }).click();
    assert.equal(
      await p.getByRole("textbox", { name: "О преподавателе" }).inputValue(),
      "Проверенная база",
    );
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
    assert.equal(requests.length, 4);
    assert.equal(requests[3].feedback, "");
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

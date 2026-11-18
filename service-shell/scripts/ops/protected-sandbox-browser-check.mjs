import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:9166";
const snapshot = {
  tutor: "Тест",
  subject: "Предмет",
  readAt: "2026-11-17T00:00:00Z",
  catalogAt: 1,
  chatsAt: 1,
  ads: [],
  daily: [],
  chats: [
    {
      id: "chat-a",
      name: "Клиент А",
      lastAt: 1794906000000,
      messages: [
        {
          id: "message-1",
          at: 1794906000000,
          author: "client",
          type: "text",
          text: "Здравствуйте",
        },
      ],
    },
    {
      id: "chat-b",
      name: "Клиент Б",
      lastAt: 1794905000000,
      messages: [
        { id: "message-2", at: 1794905000000, author: "client", type: "text", text: "Добрый день" },
      ],
    },
  ],
};
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
try {
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({
        viewport: { width, height: 960 },
        permissions: ["microphone"],
      }),
      api = [];
    await ctx.route("**/api/**", (r) => {
      api.push(r.request().method());
      return r.abort();
    });
    await ctx.route("**/api/demo/bootstrap", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) }),
    );
    const page = await ctx.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-11-18T09:00:00Z") });
    await page.goto(base + "/?section=chats", { waitUntil: "networkidle" });
    const list = page.getByRole("complementary", { name: "Обращения" });
    await list.getByRole("button", { name: "Открыть обращение: Клиент А" }).click();
    const card = page.getByRole("article", { name: "Карточка: Клиент А" }),
      input = card.getByRole("textbox", { name: "Ответ Клиент А" });
    if (width === 390) {
      assert.equal(await page.getByRole("navigation", { name: "Разделы" }).isVisible(), true);
      const navBox = await page.locator(".service-sidebar").boundingBox();
      const chatBox = await card.boundingBox();
      assert.ok(chatBox.y >= navBox.y + navBox.height - 1);
      const editor = await card.locator(".contact-composer").boundingBox();
      assert.ok(editor.y + editor.height <= 961 && editor.y + editor.height >= 950);
      await page.screenshot({ path: "/tmp/cantor-sandbox-mobile.png" });
    }
    await input.fill("Проверочное сообщение");
    await input.press("Enter");
    await card.locator(".message-bubble").filter({ hasText: "Проверочное сообщение" }).waitFor();
    assert.equal(await card.getByText("локально", { exact: true }).count(), 0);
    await card
      .getByRole("button", { name: /Редактировать сообщение local-/ })
      .last()
      .click();
    await input.fill("Исправленное сообщение");
    await card.getByRole("button", { name: "Сохранить изменения сообщения" }).click();
    await card.locator(".message-bubble").filter({ hasText: "Исправленное сообщение" }).waitFor();
    await card.getByRole("button", { name: "Заметка о клиенте" }).click();
    await page.getByRole("textbox", { name: "Текст заметки" }).fill("Проверочная заметка");
    await page.locator(".note-editor").getByRole("button", { name: "Сохранить" }).click();
    await card.getByRole("button", { name: "Заметка о клиенте" }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "Текст заметки" }).inputValue(),
      "Проверочная заметка",
    );
    await page.keyboard.press("Escape");
    await card.getByRole("combobox", { name: "Изменить этап обращения" }).click();
    await page.locator("[role=option][data-value=after]").click();
    assert.match(await card.getByTestId("lead-stage").innerText(), /После диагностики/);
    await card.getByRole("button", { name: "Действия диалога" }).click();
    await card.getByRole("menuitem", { name: "Задачи", exact: true }).click();
    await card.getByRole("textbox", { name: "Название задачи" }).fill("Перезвонить");
    await card.getByRole("textbox", { name: "Дата задачи" }).fill("20.11.2026");
    await card.getByRole("button", { name: "Добавить задачу", exact: true }).click();
    await card.locator(".followup-list li").filter({ hasText: "Перезвонить" }).waitFor();
    await card.getByRole("button", { name: "Действия диалога" }).click();
    await card.getByRole("menuitem", { name: "Диагностика", exact: true }).click();
    const diagnostic = card.getByRole("region", { name: "Расписание диагностик" });
    await diagnostic.getByRole("textbox", { name: "Дата диагностики" }).fill("20.11.2026");
    await diagnostic.getByRole("button", { name: "Записать на диагностику", exact: true }).click();
    await diagnostic.getByText("Запись подтверждена", { exact: true }).waitFor();

    await card.getByRole("button", { name: "К переписке" }).click();
    await card
      .getByLabel("Файл для сообщения", { exact: true })
      .setInputFiles({ name: "test.txt", mimeType: "text/plain", buffer: Buffer.from("test") });
    await card.locator(".attachment-preview").waitFor();
    await card.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await card.getByRole("link", { name: /test.txt/ }).waitFor();
    await card.getByRole("button", { name: "Записать голосовое" }).click();
    await card.getByRole("button", { name: "Завершить запись голоса" }).waitFor();
    await page.waitForTimeout(1100);
    await card.getByRole("button", { name: "Завершить запись голоса" }).click();
    await card.locator(".attachment-preview").waitFor();
    await card.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await card.getByRole("button", { name: "Слушать голосовое" }).waitFor();

    if (width === 390) await card.getByRole("button", { name: "Все обращения" }).click();
    await page
      .getByRole("navigation", { name: "Разделы" })
      .getByRole("button", { name: "CRM", exact: true })
      .click();
    const source = page.locator('[data-lead-id="chat-a"]');
    await source.waitFor();
    if (width === 1440) {
      await source.dragTo(page.locator('[data-crm-stage="after"] header'));
      await page.locator('[data-crm-stage="after"] [data-lead-id="chat-a"]').waitFor();
    }
    await page
      .locator('[data-lead-id="chat-b"]')
      .getByRole("button", { name: "Открыть обращение: Клиент Б" })
      .click();
    const second = page.getByRole("article", { name: "Карточка: Клиент Б" });
    await second
      .getByRole("textbox", { name: "Ответ Клиент Б" })
      .fill("Сообщение другому человеку");
    await second.getByRole("textbox", { name: "Ответ Клиент Б" }).press("Enter");
    await second
      .locator(".message-bubble")
      .filter({ hasText: "Сообщение другому человеку" })
      .waitFor();
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => Object.keys(localStorage).filter((k) => k.includes("cantor")).length,
      ),
      0,
    );
    console.log(
      JSON.stringify({
        width,
        send: true,
        note: true,
        stage: true,
        task: true,
        attachment: true,
        noApi: true,
      }),
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}

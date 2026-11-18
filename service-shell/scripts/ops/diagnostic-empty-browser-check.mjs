import { chromium } from "playwright";
import { setGlobalProxyFromEnv } from "node:http";
import assert from "node:assert/strict";
setGlobalProxyFromEnv();
const base = process.argv[2] || "http://127.0.0.1:9162";
const data = JSON.stringify({
  tutor: "Тестовый преподаватель",
  subject: "Предмет",
  readAt: "2026-11-17T00:00:00Z",
  catalogAt: 1,
  chatsAt: 1,
  ads: [],
  daily: [],
  chats: [
    {
      id: "test-chat",
      name: "Тестовый клиент",
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
  ],
});
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 960 } });
    await ctx.route("**/api/**", (r) => r.abort());
    await ctx.route("**/api/demo/bootstrap", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: data }),
    );
    const p = await ctx.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/?section=chats", { waitUntil: "networkidle" });
    const list = p.getByRole("complementary", { name: "Обращения" });
    await list
      .getByRole("button", { name: /Открыть обращение/ })
      .first()
      .click();
    const card = p.locator(".contact-chat");
    await card.getByRole("button", { name: "Действия диалога" }).click();
    await card.getByRole("menuitem", { name: "Диагностика", exact: true }).click();
    const section = card.getByRole("region", { name: "Расписание диагностик" });
    await section.waitFor();
    assert.equal(
      await section.getByRole("button", { name: "Записать на диагностику" }).isDisabled(),
      true,
    );
    await section.getByRole("textbox", { name: "Дата диагностики" }).waitFor();
    await section.getByText("Пока нет предстоящих встреч.").waitFor();
    await card.getByRole("textbox", { name: "Итог диагностики" }).waitFor();
    await card.getByRole("button", { name: "К переписке" }).click();
    if (width === 390) await p.getByRole("button", { name: "Все обращения" }).click();
    await p.getByRole("button", { name: "CRM", exact: true }).click();
    const crm = p.locator(".crm-contact-card").first();
    await crm.getByRole("button", { name: "Диагностика", exact: true }).click();
    await p.getByRole("region", { name: "Расписание диагностик" }).waitFor();
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    await p.screenshot({ path: `/tmp/cantor-diag-fixture-${width}.png` });
    console.log(
      JSON.stringify({ width, fromDialog: true, fromCrm: true, noSlots: true, errors: 0 }),
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}

import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:9164";
const data = JSON.stringify({
  tutor: "Тест",
  subject: "Предмет",
  readAt: "2026-11-17T00:00:00Z",
  catalogAt: 1,
  chatsAt: 1,
  ads: [],
  daily: [],
  chats: [
    {
      id: "test-chat",
      name: "Очень длинное имя тестового собеседника",
      avatarUrl: "https://example.test/avatar.png",
      lastAt: 1794906000000,
      messages: [
        { id: "m1", at: 1794906000000, author: "client", type: "text", text: "Проверка сообщения" },
      ],
    },
    { id: "test-noavatar", name: "Второй клиент", lastAt: 1794905000000, messages: [] },
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
    await ctx.route("https://example.test/avatar.png", (r) =>
      r.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR7kAAAAASUVORK5CYII=",
          "base64",
        ),
      }),
    );
    const page = await ctx.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/?section=chats", { waitUntil: "networkidle" });
    const nav = page.getByRole("navigation", { name: "Разделы" });
    if (width === 390) await page.getByRole("button", { name: "Открыть меню" }).click();
    await nav.getByRole("button", { name: "Сообщения", exact: true }).waitFor();
    await page.getByRole("complementary", { name: "Обращения" }).waitFor();
    assert.equal(await page.locator(".workbench-view-switch").count(), 0);
    await nav.getByRole("button", { name: "CRM", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("view") === "crm");
    const card = page.locator('[data-lead-id="test-chat"]');
    await card.waitFor();
    assert.equal(await card.locator(".chat-avatar img").count(), 1);
    await card.getByText("Без локации", { exact: true }).waitFor();
    assert.equal(await card.locator(".crm-card-last").innerText(), "Проверка сообщения");
    assert.equal(
      await card.locator("strong").evaluate((e) => getComputedStyle(e).textOverflow),
      "ellipsis",
    );
    const navIcons = page
      .locator(".crm-health-filters button")
      .filter({ has: page.locator("svg") });
    for (const e of await navIcons.all()) {
      const button = await e.boundingBox(),
        icon = await e.locator("svg").boundingBox();
      assert.ok(Math.abs(button.y + button.height / 2 - (icon.y + icon.height / 2)) < 2);
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-lead-id="test-chat"]').waitFor();
    if (width === 390) await page.getByRole("button", { name: "Открыть меню" }).click();
    await nav.getByRole("button", { name: "Сообщения", exact: true }).click();
    await page.getByRole("complementary", { name: "Обращения" }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({ width, menu: true, avatar: true, city: true, ellipsis: true, icons: true }),
    );
    await page.screenshot({ path: `/tmp/cantor-crm-nav-${width}.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
}

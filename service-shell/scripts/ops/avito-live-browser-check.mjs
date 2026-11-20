import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
mkdirSync("/tmp/cantor-live-browser", { recursive: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }),
      mutations = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/") && r.method() !== "GET") mutations.push(r.method());
    });
    const ad = {
      id: "123",
      title: "Синтетическое объявление",
      city: "Тест",
      price: 1500,
      status: "active",
      url: "",
      description: "",
      photos: [],
      autoloadId: "feed-test",
    };
    await page.route("**/api/demo/bootstrap", (r) =>
      r.fulfill({
        json: {
          accountId: "6c974a5d5326",
          tutor: "Тестовый преподаватель",
          subject: "Тест",
          readAt: "2026-11-01T00:00:00Z",
          catalogAt: 0,
          chatsAt: 0,
          ads: [ad],
          daily: [],
          chats: [
            {
              id: "u2i~test",
              name: "Собеседник",
              lastAt: Date.now(),
              lastText: "Последняя строка",
              lastAuthor: "client",
            },
          ],
        },
      }),
    );
    await page.route("**/api/demo/live?*", (r) => {
      const q = new URL(r.request().url()).searchParams,
        s = q.get("section"),
        at = new Date().toISOString();
      if (s === "messages")
        return r.fulfill({
          json: {
            messages: [
              {
                id: "m1",
                at: Date.now(),
                author: "client",
                type: "text",
                text: "Синтетический текст из ленивой истории",
              },
            ],
            observedAt: at,
            coverage: { complete: true, nextOffset: null },
          },
        });
      const data =
        s === "ads"
          ? { ads: [ad], coverage: { complete: true } }
          : s === "autoload"
            ? {
                rows: [
                  {
                    id: "123",
                    autoloadId: "feed-test",
                    status: "active",
                    errors: ["Тестовая ошибка фото"],
                  },
                ],
                report: { status: "success_warning" },
                coverage: { complete: true },
              }
            : s === "chats"
              ? {
                  chats: [
                    {
                      id: "u2i~test",
                      name: "Собеседник",
                      lastAt: Date.now(),
                      lastText: "Последняя строка",
                      lastAuthor: "client",
                    },
                  ],
                  coverage: { complete: false, truncated: true, nextOffset: 100 },
                }
              : {
                  wallet: { realRub: 1000, bonusRub: 50 },
                  advance: { rub: 3000 },
                  days: [],
                  errors: [],
                  coverage: { complete: false },
                };
      return r.fulfill({ json: { section: s, observedAt: at, data } });
    });
    await page.goto((process.argv[2] || "http://127.0.0.1:9168") + "/?section=today");
    await page.getByRole("heading", { name: "Средства Авито", exact: true }).waitFor();
    await page.getByText("3 000,00 ₽", { exact: true }).waitFor();
    assert.equal(
      (await page.locator(".live-funds").getByText("Кошелёк", { exact: false }).count()) > 0,
      true,
    );
    await page
      .locator(".live-funds")
      .screenshot({ path: `/tmp/cantor-live-browser/funds-${width}.png` });
    await page.goto((process.argv[2] || "http://127.0.0.1:9168") + "/?section=ads");
    await page.getByText("Тестовая ошибка фото", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByText("Тестовая ошибка фото", { exact: true })
        .locator("..")
        .getByText("В публикации", { exact: false })
        .count(),
      1,
    );
    await page.goto(
      (process.argv[2] || "http://127.0.0.1:9168") + "/?section=chats&focus=u2i~test",
    );
    await page
      .getByRole("region", { name: "Сообщения: Собеседник", exact: true })
      .getByText("Синтетический текст из ленивой истории", { exact: true })
      .waitFor();
    assert.deepEqual(mutations, []);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("Live read UI synthetic passed 390/1440; no API mutations");

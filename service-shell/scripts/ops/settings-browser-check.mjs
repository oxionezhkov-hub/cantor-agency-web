import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
mkdirSync("/tmp/cantor-settings-v2", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/demo/bootstrap", (r) =>
      r.fulfill({
        json: {
          tutor: "Елена Добрынина",
          subject: "Русский язык",
          readAt: "2026-11-18T00:00:00Z",
          catalogAt: null,
          chatsAt: null,
          ads: [],
          daily: [],
          chats: [],
        },
      }),
    );
    await page.goto("http://127.0.0.1:9156/?section=acc");
    await page.getByRole("heading", { name: "Кабинет Авито", exact: true }).waitFor();
    assert.equal(await page.locator(".st-tabs").count(), 0);
    const nav = page.getByLabel("Разделы настроек", { exact: true });
    assert.deepEqual(await nav.getByRole("button").allTextContents(), [
      "Кабинет",
      "Уведомления",
      "Тариф",
      "Поддержка",
    ]);
    assert.equal(
      await page.locator(".support-manager-link").getAttribute("href"),
      "https://t.me/cantor_agency_manager",
    );
    const icon = page.locator(".service-nav-item > svg").first();
    const firstIcon = await icon.boundingBox();
    await page.screenshot({ path: `/tmp/cantor-settings-v2/cabinet-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Параметры подключения" }).click();
    await page.getByLabel("Client ID", { exact: true }).fill("sample-app");
    await page.getByLabel("Client Secret", { exact: true }).fill("sample-secret");
    await nav.getByRole("button", { name: "Уведомления", exact: true }).click();
    assert.equal(await page.getByLabel("Адрес электронной почты", { exact: true }).count(), 0);
    await page.getByRole("switch", { name: "Уведомления по почте" }).click();
    await page.getByRole("button", { name: "Сохранить предпочтения" }).click();
    await page.getByRole("status").filter({ hasText: "Укажите корректный адрес" }).waitFor();
    await page.getByLabel("Адрес электронной почты", { exact: true }).fill("elena@example.ru");
    await page.getByRole("switch", { name: "Уведомления в Telegram" }).click();
    await page.getByRole("button", { name: "Сохранить предпочтения" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Предпочтения уведомлений сохранены" })
      .waitFor();
    await page.getByRole("switch", { name: "Ошибки подключения", exact: true }).waitFor();
    await page.getByRole("switch", { name: "Ежедневный отчёт", exact: true }).waitFor();
    await page.screenshot({
      path: `/tmp/cantor-settings-v2/notifications-${width}.png`,
      fullPage: true,
    });
    await nav.getByRole("button", { name: "Тариф", exact: true }).click();
    assert.equal(await page.getByText("Ранний доступ", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Продлить сейчас" }).count(), 0);
    assert.equal(await page.getByText("Ваш тариф", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Изменить тариф", exact: true }).click();
    let d = page.getByRole("dialog", { name: "Изменить тариф", exact: true });
    await d.waitFor();
    await d.getByRole("button", { name: "Год", exact: true }).click();
    await d.getByText("119 880 ₽", { exact: false }).waitFor();
    await page.screenshot({ path: `/tmp/cantor-settings-v2/choose-${width}.png`, fullPage: true });
    await d.getByRole("button", { name: "Настроить состав", exact: true }).click();
    d = page.getByRole("dialog", { name: "Соберите свой тариф", exact: true });
    await d.getByRole("switch", { name: "Расширенная аналитика", exact: true }).click();
    await d.getByRole("switch", { name: "ИИ-автоматизация", exact: true }).click();
    await d.getByText("77 640 ₽", { exact: true }).waitFor();
    await d.getByRole("button", { name: "Разбор диалогов", exact: true }).click();
    await page
      .locator(".st-help")
      .getByText("Помогает оценить качество переписки:", { exact: false })
      .waitFor();
    await page.getByRole("button", { name: "Закрыть подсказку" }).click();
    await page.screenshot({
      path: `/tmp/cantor-settings-v2/constructor-${width}.png`,
      fullPage: true,
    });
    await d.getByRole("button", { name: "Перейти к оплате" }).click();
    d = page.getByRole("dialog", { name: "Оформление подписки" });
    await d.waitFor();
    await d.getByRole("button", { name: "Банковская карта" }).click();
    await page.screenshot({ path: `/tmp/cantor-settings-v2/payment-${width}.png`, fullPage: true });
    await d.getByRole("button", { name: "Оплатить 77 640 ₽", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Тариф выбран" })
      .getByRole("button", { name: "Готово" })
      .click();
    await page.getByRole("switch", { name: "Автопродление", exact: true }).click();
    await page.getByText("Выключено · доступ до конца оплаченного периода").waitFor();
    await page.screenshot({ path: `/tmp/cantor-settings-v2/tariff-${width}.png`, fullPage: true });
    await nav.getByRole("button", { name: "Поддержка", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Отзыв", exact: true }).count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "5 из 5" }).getAttribute("aria-pressed"),
      "false",
    );
    await page.screenshot({ path: `/tmp/cantor-settings-v2/support-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "4 из 5" }).click();
    d = page.getByRole("dialog", { name: "Ваш отзыв о платформе" });
    await d.waitFor();
    await d.getByRole("textbox", { name: "Отзыв", exact: true }).fill("Удобно управлять кабинетом");
    await d.getByRole("button", { name: "Сохранить отзыв" }).click();
    const lastIcon = await icon.boundingBox();
    assert.equal(firstIcon.width, lastIcon.width);
    assert.equal(firstIcon.height, lastIcon.height);
    assert.equal(firstIcon.y, lastIcon.y);
    for (const label of ["Кабинет", "Уведомления", "Тариф", "Поддержка"]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${width} overflow in ${label}`,
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ width, ok: true, stableIcons: true }));
  }
} finally {
  await browser.close();
}

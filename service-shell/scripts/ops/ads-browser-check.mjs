import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const url = process.argv[2] || "http://127.0.0.1:9156";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
mkdirSync("/tmp/cantor-ads-redesign", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const c = await browser.newContext({ viewport: { width, height: 960 } });
    if (url.startsWith("https:"))
      await c.route(`${new URL(url).origin}/**`, async (route) => {
        const r = await fetch(route.request().url());
        const headers = Object.fromEntries(r.headers);
        for (const n of ["content-encoding", "content-length", "transfer-encoding"])
          delete headers[n];
        await route.fulfill({
          status: r.status,
          headers,
          body: Buffer.from(await r.arrayBuffer()),
        });
      });
    const p = await c.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${url}/?section=ads`, { waitUntil: "networkidle" });
    await p.getByRole("tab", { name: "Автозагрузка", exact: true }).click();
    assert.equal(await p.getByText("02 · ПРОВЕРКА", { exact: true }).count(), 0);
    assert.equal(await p.getByText("03 · АВТОЗАГРУЗКА", { exact: true }).count(), 0);
    await p.screenshot({ path: `/tmp/cantor-ads-redesign/feed-${width}.png`, fullPage: true });
    await p
      .getByLabel("Ссылка на Google Таблицу", { exact: true })
      .fill("https://docs.google.com/spreadsheets/d/example-id/edit");
    assert.equal(await p.getByText("02 · ПРОВЕРКА", { exact: true }).count(), 0);
    await p.getByRole("button", { name: "Сохранить настройки", exact: true }).click();
    await p.getByText("02 · ПРОВЕРКА", { exact: true }).waitFor();
    await p.getByText("03 · АВТОЗАГРУЗКА", { exact: true }).waitFor();
    await p.getByRole("tab", { name: /^Объявления/ }).click();
    await p.getByRole("button", { name: "Создать объявление", exact: true }).click();
    const d = p.getByRole("dialog", { name: "Редактор объявления" });
    await d.getByLabel("Город", { exact: true }).fill("Казань");
    await d.getByLabel("Заголовок", { exact: true }).fill("Подготовка к ОГЭ");
    await d
      .getByLabel("Текст объявления", { exact: true })
      .fill("Индивидуальные занятия по математике.");
    assert.equal(await d.getByRole("button", { name: "ИИ-помощник", exact: true }).count(), 0);
    await d.getByRole("button", { name: "Предложить заголовок", exact: true }).click();
    await d.getByLabel("Вариант заголовка", { exact: true }).fill("Вариант для отклонения");
    await d.getByRole("button", { name: "Не использовать", exact: true }).click();
    assert.equal(await d.getByLabel("Заголовок", { exact: true }).inputValue(), "Подготовка к ОГЭ");
    await d.getByRole("button", { name: "Предложить текст", exact: true }).click();
    await d
      .getByLabel("Вариант текста", { exact: true })
      .fill("Исправленный и согласованный текст.");
    assert.equal(
      await d.getByLabel("Текст объявления", { exact: true }).inputValue(),
      "Индивидуальные занятия по математике.",
    );
    await d.getByRole("button", { name: "Принять вариант", exact: true }).click();
    assert.equal(
      await d.getByLabel("Текст объявления", { exact: true }).inputValue(),
      "Исправленный и согласованный текст.",
    );
    await d.getByRole("button", { name: /^Фотографии/ }).click();
    await d.getByRole("button", { name: "Создать с ИИ", exact: true }).click();
    await d.getByLabel("Текст на обложке").fill("Подготовка к ОГЭ");
    await d.getByRole("button", { name: "Принять вариант", exact: true }).click();
    assert.equal(await d.locator(".aw-photo").count(), 1);
    await d.getByRole("button", { name: "Содержание", exact: true }).click();
    await p.screenshot({ path: `/tmp/cantor-ads-redesign/editor-${width}.png`, fullPage: true });
    const box = await d.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 961, "dialog fits viewport");
    assert.equal(await d.locator("select,input[type=time],input[type=date]").count(), 0);
    await d.getByRole("button", { name: "Ставка и расписание", exact: true }).click();
    await d.getByRole("combobox", { name: "Режим управления", exact: true }).click();
    await p.getByRole("option", { name: "По позиции", exact: true }).click();
    await d.getByLabel("Ставка за просмотр, ₽", { exact: true }).fill("35");
    await d.getByRole("combobox", { name: "Работать с, МСК", exact: true }).click();
    await p.getByRole("option", { name: "10:00", exact: true }).click();
    await d.getByRole("button", { name: "Сохранить", exact: true }).click();
    await p.reload({ waitUntil: "networkidle" });
    await p
      .getByRole("button", { name: /Подготовка к ОГЭ Казань/ })
      .first()
      .click();
    assert.equal(
      await d.getByLabel("Текст объявления", { exact: true }).inputValue(),
      "Исправленный и согласованный текст.",
    );
    await d.getByRole("button", { name: "Закрыть редактор" }).click();
    await p.getByRole("tab", { name: "Ставки", exact: true }).click();
    assert.equal(await p.getByText("Продвижение под вашим контролем").count(), 0);
    await p.getByRole("combobox", { name: "Режим Подготовка к ОГЭ", exact: true }).click();
    await p.getByRole("option", { name: "Вручную", exact: true }).click();
    await p.screenshot({ path: `/tmp/cantor-ads-redesign/bids-${width}.png`, fullPage: true });
    await p.getByRole("tab", { name: "История", exact: true }).click();
    assert.equal(
      await p.getByRole("heading", { name: "История изменений", exact: true }).count(),
      0,
    );
    assert.ok((await p.locator("body").innerText()).includes("Сохранено объявление"));
    await p.getByRole("tab", { name: /^Объявления/ }).click();
    await p.screenshot({ path: `/tmp/cantor-ads-redesign/list-${width}.png`, fullPage: true });
    assert.ok(
      (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1,
      `overflow ${width}`,
    );
    assert.deepEqual(errors, []);
    await c.close();
    console.log(
      JSON.stringify({
        width,
        create: true,
        city: true,
        candidateApproval: true,
        candidateRejection: true,
        photos: true,
        persistence: true,
        customMenus: true,
        progressiveFeed: true,
        compactBids: true,
        history: true,
        errors,
      }),
    );
  }
} finally {
  await browser.close();
}

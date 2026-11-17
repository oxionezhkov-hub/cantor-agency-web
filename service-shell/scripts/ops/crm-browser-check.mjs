import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const url = process.argv[2] || "http://127.0.0.1:9150";
const output = process.argv[3] || "/tmp/cantor-lead-workflow";
mkdirSync(output, { recursive: true });
if (
  !["127.0.0.1", "localhost", "cantor-service-preview.oxion-ezhkov.workers.dev"].includes(
    new URL(url).hostname,
  )
)
  throw new Error("Interactive checks are restricted to the isolated preview");
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 } });
    if (process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1")
      await context.route(`${new URL(url).origin}/**`, async (route) => {
        const req = route.request();
        const response = await fetch(req.url(), {
          headers: req.headers(),
          signal: AbortSignal.timeout(30000),
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
    let apiAttempts = 0;
    await context.route("**/api/**", (route) => {
      apiAttempts++;
      return route.abort("blockedbyclient");
    });
    await context.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__copiedReply = text;
          },
        },
      }),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-11-16T10:00:00Z") });
    await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(await page.getByTestId("completed-diagnostics").innerText(), "3");
    assert.equal(await page.getByTestId("new-students").innerText(), "2");
    await page.goto(`${url}/?section=chats`, { waitUntil: "networkidle" });
    const filters = page.getByRole("group", { name: "Этапы обращений" });
    await filters.getByRole("button", { name: /Ученики/ }).click();
    assert.equal(
      await page.getByRole("complementary", { name: "Обращения" }).getByRole("button").count(),
      2,
    );
    await filters.getByRole("button", { name: /^Все/ }).click();
    await page.getByRole("textbox", { name: "Поиск обращений" }).fill("несуществующий");
    await page.getByText("Ничего не найдено", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Сбросить фильтры" }).click();
    if (width === 390)
      await page.getByRole("button", { name: "Открыть обращение: Игорь", exact: true }).click();
    else await page.goto(`${url}/?section=chats&focus=igor`, { waitUntil: "networkidle" });
    const card = page.getByRole("article", { name: "Карточка: Игорь", exact: true });
    await card.getByRole("textbox", { name: "Ответ Игорь", exact: true }).waitFor();
    await card.locator(".lead-invitation summary").click();
    async function choose(control, value) {
      await control.click();
      await page.locator(`[role="option"][data-value="${value}"]`).click();
    }
    const invitation = card.getByRole("combobox", { name: "Время для приглашения" });
    assert.equal(await page.locator('[role="option"][data-value="thu"]').count(), 0);
    await choose(invitation, "sat-12");
    await card.getByRole("button", { name: "Вставить приглашение" }).click();
    assert.match(
      await card.getByRole("textbox", { name: "Ответ Игорь", exact: true }).inputValue(),
      /21 ноября.*12:00/,
    );
    await card.getByRole("button", { name: "Скопировать ответ" }).click();
    assert.match(await page.evaluate(() => window.__copiedReply), /21 ноября/);
    await card
      .getByRole("textbox", { name: "Ответ Игорь", exact: true })
      .fill("Игорь, удобно встретиться в субботу в 12:00 по Москве?");
    await card.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" });
    assert.match(
      await card.getByRole("textbox", { name: "Ответ Игорь", exact: true }).inputValue(),
      /Игорь, удобно/,
    );
    assert.equal(
      await card.locator(".lead-messages").evaluate((el) => getComputedStyle(el).overflowY),
      "auto",
    );
    const editor = await card.locator(".lead-composer").boundingBox();
    assert.ok(
      editor && editor.y >= 0 && editor.y + editor.height <= 961,
      "Editor must remain inside the viewport",
    );
    await page.screenshot({ path: `${output}/conversation-${width}.png`, fullPage: true });
    await page.goto(`${url}/?section=chats&focus=marina`, { waitUntil: "networkidle" });
    assert.equal(
      await page.getByRole("textbox", { name: "Ответ Марина", exact: true }).inputValue(),
      "",
    );
    await page.goto(`${url}/?section=chats&focus=igor`, { waitUntil: "networkidle" });
    await card.getByRole("button", { name: "Выбрать время", exact: true }).click();
    const schedule = card.getByRole("region", { name: "Расписание диагностик" });
    const slot = schedule.getByRole("combobox", { name: /Окно/ });
    await choose(slot, "tue");
    await schedule.getByRole("button", { name: "Записать на диагностику", exact: true }).click();
    assert.equal(await card.getByTestId("lead-stage").innerText(), "Записан");
    assert.equal(await schedule.getByRole("article").filter({ hasText: "Светлана" }).count(), 0);
    await schedule.getByRole("button", { name: "Перенести запись: Игорь", exact: true }).click();
    await choose(slot, "sat-12");
    await schedule.getByRole("button", { name: "Сохранить перенос", exact: true }).click();
    assert.match(await schedule.getByRole("article").innerText(), /21 ноября/);
    await schedule.getByRole("button", { name: "Перенести запись: Игорь", exact: true }).click();
    await slot.click();
    assert.notEqual(
      await page.locator('[role="option"][data-value="tue"]').getAttribute("aria-disabled"),
      "true",
    );
    await page.keyboard.press("Escape");
    await schedule.getByRole("button", { name: "Отменить перенос", exact: true }).click();
    await page.screenshot({ path: `${output}/booking-${width}.png`, fullPage: true });
    await card.getByRole("button", { name: "Закрыть обращение", exact: true }).click();
    await card
      .getByRole("textbox", { name: "Причина закрытия" })
      .fill("Выбрали другого преподавателя");
    await card.getByRole("button", { name: "Подтвердить закрытие" }).click();
    assert.equal(await card.getByTestId("lead-stage").innerText(), "Закрыто");
    await card.getByRole("button", { name: "История", exact: true }).click();
    await card
      .locator(".lead-timeline")
      .getByText(/Выбрали другого преподавателя/)
      .waitFor();
    await card.getByRole("button", { name: "Вернуть в работу", exact: true }).click();
    await card.getByRole("button", { name: "Выбрать время", exact: true }).click();
    await choose(slot, "sat-12");
    assert.match(await slot.innerText(), /21 ноября/);
    await schedule.getByRole("button", { name: "Записать на диагностику", exact: true }).click();
    await page.clock.install({ time: new Date("2026-11-22T10:00:00Z") });
    await page.reload({ waitUntil: "networkidle" });
    await card.getByRole("button", { name: "Отметить результат", exact: true }).click();
    await schedule.getByRole("button", { name: "Проведена", exact: true }).click();
    assert.equal(await card.getByTestId("lead-stage").innerText(), "После диагностики");
    await card.getByRole("button", { name: "Внести оплату", exact: true }).click();
    const payments = card.getByRole("region", { name: "Оплаты учеников", exact: true });
    assert.equal(
      await payments
        .getByRole("combobox", { name: "Ученик", exact: true })
        .getAttribute("data-value"),
      "student-igor",
    );
    await payments.getByRole("combobox", { name: "Ученик", exact: true }).click();
    assert.equal(await page.getByRole("option").count(), 1);
    await page.keyboard.press("Escape");
    await payments.getByRole("button", { name: "Дата оплаты", exact: true }).click();
    assert.equal((await page.locator(".service-calendar .rdp-day_button").count()) > 27, true);
    await page.screenshot({ path: `${output}/calendar-${width}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    for (const value of ["1 234,50", "55,50"]) {
      await payments.getByRole("textbox", { name: "Сумма, ₽", exact: true }).fill(value);
      await payments.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
      await payments.getByRole("status").waitFor();
    }
    assert.equal(await card.getByTestId("lead-stage").innerText(), "Ученик");
    assert.equal(await payments.locator("tbody tr").count(), 2);
    await payments.getByRole("textbox", { name: "Сумма, ₽", exact: true }).fill("12,345");
    await payments.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
    await payments.getByRole("alert").waitFor();
    await card.getByRole("button", { name: "История", exact: true }).click();
    assert.equal(await card.locator(".lead-timeline li").count(), 10);
    await page.screenshot({ path: `${output}/history-${width}.png`, fullPage: true });
    await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(await page.getByTestId("completed-diagnostics").innerText(), "4");
    assert.equal(await page.getByTestId("new-students").innerText(), "3");
    assert.equal(
      (await page.getByTestId("dashboard-revenue").innerText()).replace(/[^\d,]/g, ""),
      "10890",
    );
    assert.equal(await page.getByRole("link").filter({ hasText: "Игорь ждёт ответа" }).count(), 0);
    const tab = await context.newPage();
    await tab.goto(`${url}/?section=stats`, { waitUntil: "networkidle" });
    await tab.getByRole("combobox", { name: "Ученик", exact: true }).click();
    await tab.locator('[role="option"][data-value="student-oge"]').click();
    await tab.getByRole("textbox", { name: "Сумма, ₽", exact: true }).fill("500");
    await tab.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="dashboard-revenue"]')
          ?.textContent.replace(/[^\d,]/g, "") === "11390",
    );
    await page.goto(`${url}/?section=chats&focus=svetlana`, { waitUntil: "networkidle" });
    const svetlana = page.getByRole("article", { name: "Карточка: Светлана", exact: true });
    await svetlana.getByRole("button", { name: "Отметить результат", exact: true }).click();
    await svetlana.getByRole("button", { name: "Неявка", exact: true }).click();
    assert.equal(await svetlana.getByTestId("lead-stage").innerText(), "Неявка");
    await page.goto(`${url}/?section=chats&focus=igor`, { waitUntil: "networkidle" });
    assert.equal(await card.getByTestId("lead-stage").innerText(), "Ученик");
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1,
    );
    assert.deepEqual(errors, []);
    assert.equal(apiAttempts, 0);
    results.push({
      width,
      scopedClientCard: true,
      searchAndFilters: true,
      draftPersistence: true,
      copyWithoutSending: true,
      freeInvitation: true,
      bookingCancellationReschedule: true,
      closureAndHistory: true,
      meetingOutcome: true,
      repeatedPayments: true,
      independentMetrics: true,
      crossTabSync: true,
      apiAttempts,
      pageErrors: errors,
    });
    await context.close();
  }
  console.log(JSON.stringify({ ok: true, url, results, screenshots: output }));
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      console.error(
        JSON.stringify({
          url: page.url(),
          body: (await page.locator("body").innerText()).slice(0, 12000),
        }),
      );
      await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
    }
  throw error;
} finally {
  await browser.close();
}

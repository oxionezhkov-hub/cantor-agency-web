import assert from "node:assert/strict";
import { chromium } from "playwright";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const url = process.argv[2] || "http://127.0.0.1:9150";
if (
  !["127.0.0.1", "localhost", "cantor-service-preview.oxion-ezhkov.workers.dev"].includes(
    new URL(url).hostname,
  )
)
  throw new Error("Interactive checks are restricted to the isolated demo");
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
    // No interactive check may reach a real backend.
    await context.route("**/api/**", (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: "networkidle" });
    assert.match(await page.getByRole("note").innerText(), /Демонстрационные данные/);
    assert.equal(await page.getByTestId("completed-diagnostics").innerText(), "3");
    assert.equal(await page.getByTestId("new-students").innerText(), "2");
    await page.getByRole("link").filter({ hasText: "заблокировано" }).first().click();
    assert.equal(new URL(page.url()).searchParams.get("focus"), "ege");
    assert.equal(
      await page
        .getByRole("button", { name: /Математика ЕГЭ, с 60 до 80/ })
        .getAttribute("aria-expanded"),
      "true",
    );
    await page.goto(`${url}/?section=chats&focus=igor`, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Ответ Игорь", exact: true }).waitFor();
    const schedule = page.getByRole("region", { name: "Расписание диагностик" });
    await schedule.getByRole("combobox", { name: "Заявка", exact: true }).selectOption("igor");
    await schedule
      .getByRole("combobox", { name: "Окно · 30 минут", exact: true })
      .selectOption("tue");
    await schedule.getByRole("button", { name: "Записать на диагностику", exact: true }).click();
    await schedule.getByRole("heading", { name: "Запланировано · 2", exact: true }).waitFor();
    await schedule.getByRole("button", { name: "Отменить запись: Игорь", exact: true }).click();
    await schedule.getByRole("heading", { name: "Запланировано · 1", exact: true }).waitFor();
    await schedule.getByRole("button", { name: "Записать на диагностику", exact: true }).click();
    await schedule.getByRole("button", { name: "Перенести запись: Игорь", exact: true }).click();
    await schedule
      .getByRole("combobox", { name: "Окно · 30 минут", exact: true })
      .selectOption("sat-12");
    await schedule.getByRole("button", { name: "Сохранить перенос", exact: true }).click();
    assert.match(
      await schedule.getByRole("article").filter({ hasText: "Игорь" }).innerText(),
      /21 ноября/,
    );
    assert.equal(await schedule.locator('option[value="tue"]').isDisabled(), false);
    await page.goto(`${url}/?section=stats&focus=kirill`, { waitUntil: "networkidle" });
    const payments = page.getByRole("region", { name: "Оплаты учеников", exact: true });
    assert.equal(
      await payments.getByRole("combobox", { name: "Ученик", exact: true }).inputValue(),
      "student-kirill",
    );
    for (const value of ["1 234,50", "55,50"]) {
      await payments.getByRole("textbox", { name: "Сумма, ₽", exact: true }).fill(value);
      await payments.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
      await payments.getByRole("status").waitFor();
    }
    assert.equal(await page.getByTestId("paid-students").innerText(), "3");
    assert.equal(
      (await page.getByTestId("received-payments").innerText()).replace(/[^\d,]/g, ""),
      "10890",
    );
    await payments.getByRole("textbox", { name: "Сумма, ₽", exact: true }).fill("12,345");
    await payments.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
    await payments.getByRole("alert").waitFor();
    assert.equal(await page.getByTestId("paid-students").innerText(), "3");
    await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(await page.getByTestId("completed-diagnostics").innerText(), "3");
    assert.equal(await page.getByTestId("new-students").innerText(), "3");
    assert.equal(
      (await page.getByTestId("dashboard-revenue").innerText()).replace(/[^\d,]/g, ""),
      "10890",
    );
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getByTestId("new-students").innerText(), "3");
    const tab = await context.newPage();
    await tab.goto(`${url}/?section=stats`, { waitUntil: "networkidle" });
    await tab.getByRole("combobox", { name: "Ученик", exact: true }).selectOption("student-oge");
    await tab.getByRole("textbox", { name: "Сумма, ₽", exact: true }).fill("500");
    await tab.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="dashboard-revenue"]')
          ?.textContent.replace(/[^\d,]/g, "") === "11390",
    );
    await page.clock.install({ time: new Date("2026-11-22T10:00:00Z") });
    await page.goto(`${url}/?section=chats`, { waitUntil: "networkidle" });
    await page
      .getByRole("region", { name: "Расписание диагностик" })
      .getByRole("article")
      .filter({ hasText: "Игорь" })
      .getByRole("button", { name: "Неявка", exact: true })
      .click();
    await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(await page.getByTestId("completed-diagnostics").innerText(), "3");
    await page.goto(`${url}/?section=chats`, { waitUntil: "networkidle" });
    await page
      .getByRole("region", { name: "Расписание диагностик" })
      .getByRole("article")
      .filter({ hasText: "Светлана" })
      .getByRole("button", { name: "Проведена", exact: true })
      .click();
    await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(await page.getByTestId("completed-diagnostics").innerText(), "4");
    assert.equal(await page.getByTestId("new-students").innerText(), "3");
    assert.deepEqual(errors, []);
    results.push({
      width,
      bookingCancellationReschedule: true,
      deepLinks: true,
      repeatedPayments: true,
      diagnosticsIndependent: true,
      kopecks: true,
      persistence: true,
      crossTabSync: true,
      meetingOutcomes: true,
    });
    await context.close();
  }
  console.log(JSON.stringify({ ok: true, url, results }));
} catch (error) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      console.error(JSON.stringify({ url: page.url(), body: (await page.locator("body").innerText()).slice(0, 12000) }));
    }
  }
  throw error;
} finally {
  await browser.close();
}

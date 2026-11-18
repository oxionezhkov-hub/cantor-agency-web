#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { setGlobalProxyFromEnv } from "node:http";
import { chromium } from "playwright";
setGlobalProxyFromEnv();
const base = process.argv[2] || "http://127.0.0.1:9153";
const output = process.argv[3] || "/tmp/cantor-payments-check";
if (
  !["localhost", "127.0.0.1", "cantor-service-preview.oxion-ezhkov.workers.dev"].includes(
    new URL(base).hostname,
  )
)
  throw Error("Only isolated previews may be tested");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
});
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    if (process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1")
      await context.route(`${new URL(base).origin}/**`, async (route) => {
        const req = route.request();
        assert.ok(["GET", "HEAD"].includes(req.method()));
        const res = await fetch(req.url(), {
          headers: req.headers(),
          signal: AbortSignal.timeout(30000),
        });
        const headers = Object.fromEntries(res.headers);
        for (const name of ["content-encoding", "content-length", "transfer-encoding"])
          delete headers[name];
        await route.fulfill({
          status: res.status,
          headers,
          body: Buffer.from(await res.arrayBuffer()),
        });
      });
    let apiAttempts = 0;
    await context.route("**/api/**", (route) => {
      apiAttempts++;
      return route.abort();
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/?section=stats`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Экономика", exact: true }).click();
    const paymentDetails = page.locator("details.an-payment-entry");
    if ((await paymentDetails.count()) && (await paymentDetails.getAttribute("open")) === null)
      await paymentDetails.locator("summary").click();
    const region = page.getByRole("region", { name: "Оплаты учеников", exact: true });
    const add = region.getByRole("form", { name: "Внести оплату ученика", exact: true });
    assert.equal(
      await region.locator('select,input[type="date"]').evaluateAll(
        (nodes) =>
          nodes.filter((node) => {
            const r = node.getBoundingClientRect();
            return r.width > 5 && r.height > 5;
          }).length,
      ),
      0,
    );
    await add.getByRole("textbox", { name: "Сумма, ₽", exact: true }).fill("1000,50");
    await add.getByRole("textbox", { name: "Дата оплаты", exact: true }).fill("99.99.2026");
    await add.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
    await region.getByRole("alert").filter({ hasText: "Укажите дату" }).waitFor();
    await add.getByRole("textbox", { name: "Дата оплаты", exact: true }).fill("16.11.2026");
    await add.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
    await region.getByText("Оплата сохранена.", { exact: true }).waitFor();
    let state = await page.evaluate(() => JSON.parse(localStorage.getItem("cantor.demo-crm.v1")));
    const original = state.payments.find((p) => p.studentId === "student-kirill");
    assert.equal(original.amountMinor, 100050);
    const editButton = region.getByRole("button", { name: /^Редактировать оплату: Кирилл/ });
    const refundButton = region.getByRole("button", { name: /^Внести возврат: Кирилл/ });
    if (width === 390) {
      for (const button of [editButton, refundButton]) {
        const box = await button.boundingBox();
        assert.ok(
          box && box.x >= 0 && box.x + box.width <= width,
          "Payment actions must be visible without horizontal scrolling",
        );
      }
    }
    await editButton.click();
    let operation = region.getByRole("form", { name: "Редактировать оплату", exact: true });
    await operation
      .getByRole("textbox", { name: "Исправленная сумма, ₽", exact: true })
      .fill("2000,50");
    await operation
      .getByRole("textbox", { name: "Исправленная дата оплаты", exact: true })
      .fill("15.11.2026");
    await operation.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
    await region.getByText("Оплата исправлена.", { exact: true }).waitFor();
    state = await page.evaluate(() => JSON.parse(localStorage.getItem("cantor.demo-crm.v1")));
    assert.equal(state.payments.find((p) => p.id === original.id).amountMinor, 200050);
    await region.getByRole("button", { name: /^Внести возврат: Кирилл/ }).click();
    operation = region.getByRole("form", { name: "Внести возврат", exact: true });
    await operation.getByRole("textbox", { name: "Сумма возврата, ₽", exact: true }).fill("500");
    await operation.getByRole("textbox", { name: "Дата возврата", exact: true }).fill("16.11.2026");
    await operation.getByRole("button", { name: "Сохранить возврат", exact: true }).click();
    await region.getByText("Возврат внесён в учёт.", { exact: true }).waitFor();
    state = await page.evaluate(() => JSON.parse(localStorage.getItem("cantor.demo-crm.v1")));
    assert.equal(
      state.refunds
        .filter((r) => r.paymentId === original.id)
        .reduce((s, r) => s + r.amountMinor, 0),
      50000,
    );
    await region.getByRole("button", { name: /^Редактировать оплату: Кирилл/ }).click();
    operation = region.getByRole("form", { name: "Редактировать оплату", exact: true });
    await operation
      .getByRole("textbox", { name: "Исправленная сумма, ₽", exact: true })
      .fill("100");
    await operation.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
    await region.getByRole("alert").filter({ hasText: "не может быть меньше" }).waitFor();
    await operation.getByRole("button", { name: "Отмена", exact: true }).click();
    await region.getByRole("button", { name: /^Внести возврат: Кирилл/ }).click();
    operation = region.getByRole("form", { name: "Внести возврат", exact: true });
    await operation.getByRole("textbox", { name: "Дата возврата", exact: true }).fill("16.11.2026");
    await operation.getByRole("button", { name: "Весь остаток", exact: true }).click();
    await operation.getByRole("button", { name: "Сохранить возврат", exact: true }).click();
    await region.getByText("Возврат внесён в учёт.", { exact: true }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Экономика", exact: true }).click();
    if ((await paymentDetails.count()) && (await paymentDetails.getAttribute("open")) === null)
      await paymentDetails.locator("summary").click();
    state = await page.evaluate(() => JSON.parse(localStorage.getItem("cantor.demo-crm.v1")));
    assert.equal(state.payments.filter((p) => p.id === original.id).length, 1);
    assert.equal(state.refunds.filter((r) => r.paymentId === original.id).length, 2);
    assert.equal(
      state.refunds
        .filter((r) => r.paymentId === original.id)
        .reduce((s, r) => s + r.amountMinor, 0),
      200050,
    );
    assert.equal(
      await page.getByRole("button", { name: /^Внести возврат: Кирилл/ }).isDisabled(),
      true,
    );
    await add.getByRole("combobox", { name: "Ученик", exact: true }).click();
    await page.getByRole("textbox", { name: "Поиск или имя ученика", exact: true }).fill("Новый тестовый ученик");
    await page.getByRole("option", { name: "Добавить «Новый тестовый ученик»", exact: true }).click();
    await add.getByRole("textbox", { name: "Сумма, ₽", exact: true }).fill("1234");
    await add.getByRole("textbox", { name: "Дата оплаты", exact: true }).fill("16.11.2026");
    await add.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
    await region.getByText("Оплата сохранена.", { exact: true }).waitFor();
    state = await page.evaluate(() => JSON.parse(localStorage.getItem("cantor.demo-crm.v1")));
    const newStudent = state.students.find((student) => student.name === "Новый тестовый ученик");
    assert.ok(newStudent, "New student is created");
    assert.ok(state.payments.some((payment) => payment.studentId === newStudent.id && payment.amountMinor === 123400), "New student's payment is saved");
    await page.getByText("Возвраты по оплате: 2", { exact: true }).click();
    await page.screenshot({ path: `${output}/payments-${width}.png`, fullPage: true });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    assert.deepEqual(errors, []);
    assert.equal(apiAttempts, 0);
    results.push({
      width,
      editPayment: true,
      partialAndFullRefund: true,
      rejectUnderRefunded: true,
      persistent: true,
      pageErrors: errors,
      apiAttempts,
    });
    await context.close();
  }
  writeFileSync(`${output}/result.json`, JSON.stringify({ base, results }, null, 2));
  console.log(JSON.stringify({ ok: true, base, results, output }));
} finally {
  await browser.close();
}

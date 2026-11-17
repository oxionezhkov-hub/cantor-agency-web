import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const url = process.argv[2] || "http://127.0.0.1:9155",
  output = process.argv[3] || "/tmp/cantor-chat-polish";
if (
  !["127.0.0.1", "localhost", "cantor-service-preview.oxion-ezhkov.workers.dev"].includes(
    new URL(url).hostname,
  )
)
  throw Error("Only isolated preview is allowed");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 960 },
      permissions: ["microphone"],
      hasTouch: width === 390,
    });
    if (process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1")
      await context.route(`${new URL(url).origin}/**`, async (route) => {
        const r = await fetch(route.request().url(), {
          headers: route.request().headers(),
          signal: AbortSignal.timeout(30000),
        });
        const headers = Object.fromEntries(r.headers);
        for (const k of ["content-encoding", "content-length", "transfer-encoding"])
          delete headers[k];
        await route.fulfill({
          status: r.status,
          headers,
          body: Buffer.from(await r.arrayBuffer()),
        });
      });
    let apiAttempts = 0;
    await context.route("**/api/**", (r) => {
      apiAttempts++;
      return r.abort();
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const go = (focus) =>
      page.goto(`${url}/?section=chats${focus ? "&focus=" + focus : ""}`, {
        waitUntil: "networkidle",
      });
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("cantor.demo-crm.v1")));
    await go();
    const list = page.getByRole("complementary", { name: "Обращения" });
    await list
      .getByRole("button", { name: /Открыть обращение/ })
      .first()
      .waitFor();
    const row = await list.locator(".workbench-contact").first().boundingBox();
    assert.ok(row.height <= 80);
    const toggle = await page.locator(".workbench-view-switch").boundingBox(),
      listBox = await list.boundingBox();
    assert.ok(toggle.y > listBox.y + listBox.height - 90);
    await page.screenshot({ path: `${output}/list-${width}.png`, fullPage: true });
    await go("igor");
    const card = page.getByRole("article", { name: "Карточка: Игорь", exact: true }),
      input = card.getByRole("textbox", { name: "Ответ Игорь", exact: true });
    await input.waitFor();
    assert.equal(await card.locator(".reply-mode").count(), 0);
    await input.focus();
    assert.notEqual(
      await input.evaluate((el) => getComputedStyle(el).outlineColor),
      "rgb(232, 57, 29)",
    );
    const note = card.getByRole("button", { name: "Заметка о клиенте", exact: true });
    await note.click();
    const field = page.getByRole("textbox", { name: "Текст заметки", exact: true });
    await field.fill("Предпочитает занятия вечером");
    const anchorBox = await note.boundingBox(),
      popupBox = await page.locator(".note-editor").boundingBox();
    assert.ok(Math.abs(anchorBox.x - popupBox.x) < 290);
    assert.ok(Math.abs(anchorBox.y - popupBox.y) < 150);
    await page
      .locator(".note-editor")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await note.click();
    assert.equal(await field.inputValue(), "Предпочитает занятия вечером");
    await page.keyboard.press("Escape");
    await card.getByRole("combobox", { name: "Изменить этап обращения", exact: true }).click();
    await page.locator("[role=option][data-value=after]").click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("cantor.demo-crm.v1")).leads.find((l) => l.id === "igor")
          .workflowStage === "after",
    );
    await input.fill("Сообщение для проверки");
    await input.press("Enter");
    await card.locator(".message-bubble").filter({ hasText: "Сообщение для проверки" }).waitFor();
    let current = await state(),
      sent = current.messages.find((m) => m.text === "Сообщение для проверки");
    assert.equal(sent.delivery, "local");
    await card
      .getByRole("button", { name: `Редактировать сообщение ${sent.id}`, exact: true })
      .click();
    await input.fill("Исправленный текст");
    await card.getByRole("button", { name: "Сохранить изменения сообщения", exact: true }).click();
    await card.locator(".message-bubble").filter({ hasText: "Исправленный текст" }).waitFor();
    assert.equal((await state()).messages.filter((m) => m.id === sent.id).length, 1);
    await card.getByLabel("Файл для сообщения", { exact: true }).setInputFiles({
      name: "plan.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Lesson plan"),
    });
    await card.locator(".attachment-preview").waitFor();
    await card.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await card.getByRole("link", { name: /plan.txt/ }).waitFor();
    await card.getByRole("button", { name: "Записать голосовое", exact: true }).click();
    await card.getByRole("button", { name: "Завершить запись голоса", exact: true }).waitFor();
    await page.waitForTimeout(1100);
    await card.getByRole("button", { name: "Завершить запись голоса", exact: true }).click();
    await card.locator(".attachment-preview").waitFor();
    await card.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await card.getByRole("button", { name: "Слушать голосовое", exact: true }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await card.getByRole("link", { name: /plan.txt/ }).waitFor();
    await card.getByRole("button", { name: "Слушать голосовое", exact: true }).waitFor();
    await card.getByRole("button", { name: "Позвонить", exact: true }).click();
    await page.getByText("Звонок пока недоступен", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `${output}/manual-${width}.png`, fullPage: true });
    await go("example-price");
    const ai = page.getByRole("article", { name: "Карточка: Александра", exact: true }),
      aiInput = ai.getByRole("textbox", { name: "Ответ Александра", exact: true });
    await aiInput.waitFor();
    assert.ok((await aiInput.inputValue()).length > 50);
    assert.equal(await aiInput.getAttribute("readonly"), "");
    await ai.getByRole("button", { name: "Редактировать ответ", exact: true }).click();
    await aiInput.fill("Давайте обсудим задачу на диагностике. Когда вам удобно?");
    await ai.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await ai.locator(".message-bubble").filter({ hasText: "Давайте обсудим задачу" }).waitFor();
    assert.ok(
      (await state()).feedback.some((f) => f.leadId === "example-price" && f.action === "approved"),
    );
    await page.screenshot({ path: `${output}/approval-${width}.png`, fullPage: true });
    await go("example-agreement");
    await page.getByRole("button", { name: "Отклонить ответ", exact: true }).click();
    assert.equal(
      (await state()).leads.find((l) => l.id === "example-agreement").aiProposal.status,
      "rejected",
    );
    await go("example-long");
    const messages = page.locator(".contact-messages");
    await page.locator(".message-bubble").first().waitFor();
    assert.ok((await page.locator(".message-day").count()) >= 3);
    assert.ok(
      await messages.evaluate(
        (el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 5,
      ),
    );
    await go();
    await page.getByRole("button", { name: "CRM", exact: true }).click();
    await page.locator("[data-lead-id=example-result]").waitFor();
    assert.equal(await page.getByText("Источник не указан", { exact: true }).count(), 0);
    assert.match(
      await page.locator("[data-lead-id=example-result]").innerText(),
      /Задача просрочена/,
    );
    if (width === 1440) {
      const source = page.locator("[data-lead-id=example-price]"),
        target = page.locator("[data-crm-stage=after]");
      await source.dragTo(target.locator("header"));
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("cantor.demo-crm.v1")).leads.find(
            (l) => l.id === "example-price",
          ).workflowStage === "after",
      );
    }
    if (width === 390) {
      const handle = page.getByRole("button", {
        name: "Перетащить карточку: Александра",
        exact: true,
      });
      await handle.scrollIntoViewIfNeeded();
      const board = page.locator(".crm-board");
      await board.evaluate((el) => (el.scrollLeft = 0));
      const point = await handle.boundingBox();
      const target = await page.locator("[data-crm-stage=booked] > header").boundingBox();
      const cdp = await context.newCDPSession(page);
      const x = point.x + point.width / 2,
        y = point.y + point.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await page.waitForTimeout(450);
      const targetX = Math.min(width - 25, target.x + 25),
        targetY = target.y + target.height / 2;
      for (let i = 1; i <= 10; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + ((targetX - x) * i) / 10, y: y + ((targetY - y) * i) / 10 }],
        });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("cantor.demo-crm.v1")).leads.find(
            (l) => l.id === "example-price",
          ).workflowStage === "booked",
      );
      await cdp.detach();
    }
    await page.screenshot({ path: `${output}/crm-${width}.png`, fullPage: true });
    await page
      .locator("[data-lead-id=example-result]")
      .getByRole("button", { name: /Задачи/ })
      .click();
    await page.getByRole("textbox", { name: "Название задачи", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));
    assert.deepEqual(errors, []);
    assert.equal(apiAttempts, 0);
    results.push({
      width,
      compactList: true,
      anchoredNotes: true,
      customStage: true,
      localSendEditFileVoice: true,
      aiReview: true,
      crmTasks: true,
      desktopDrag: width === 1440,
      touchDrag: width === 390,
      errors,
      apiAttempts,
    });
    await context.close();
  }
  writeFileSync(`${output}/result.json`, JSON.stringify({ ok: true, url, results }, null, 2));
  console.log(JSON.stringify({ ok: true, url, results, output }));
} catch (e) {
  for (const c of browser.contexts())
    for (const p of c.pages()) {
      console.error((await p.locator("body").innerText()).slice(-10000));
      await p.screenshot({ path: `${output}/failure.png`, fullPage: true });
    }
  throw e;
} finally {
  await browser.close();
}

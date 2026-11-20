import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const url = process.argv[2] || "http://127.0.0.1:9153",
  output = process.argv[3] || "/tmp/cantor-workbench";
mkdirSync(output, { recursive: true });
if (
  !["127.0.0.1", "localhost", "cantor-service-preview.oxion-ezhkov.workers.dev"].includes(
    new URL(url).hostname,
  )
)
  throw new Error("Only an isolated preview can be tested interactively");
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const results = [],
  diagnostics = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 } });
    let apiAttempts = 0;
    if (process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1")
      await context.route(`${new URL(url).origin}/**`, async (route) => {
        const r = await fetch(route.request().url(), {
          headers: route.request().headers(),
          signal: AbortSignal.timeout(30000),
        });
        const h = Object.fromEntries(r.headers);
        for (const k of ["content-encoding", "content-length", "transfer-encoding"]) delete h[k];
        await route.fulfill({
          status: r.status,
          headers: h,
          body: Buffer.from(await r.arrayBuffer()),
        });
      });
    await context.route("**/api/**", (route) => {
      apiAttempts++;
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") diagnostics.push(m.text());
    });
    const go = (path) => page.goto(url + path, { waitUntil: "networkidle" });
    await go("/?section=chats");
    const list = page.getByRole("complementary", { name: "Обращения" });
    await list
      .getByRole("button", { name: /Открыть обращение/ })
      .first()
      .waitFor();
    assert.equal(await list.getByRole("button", { name: /Открыть обращение/ }).count(), 5);
    assert.match(
      await list.locator(".contact-name-line").first().innerText(),
      /Екатерина|Александра|Дмитрий/,
    );
    const listBox = await list.boundingBox(),
      headBox = await list.locator(".workbench-list-head").boundingBox();
    assert.ok(headBox.width <= listBox.width);
    await list.getByRole("button", { name: "Поиск", exact: true }).click();
    assert.equal(await list.getByRole("group", { name: "Фильтры диалогов" }).count(), 0);
    await list.getByRole("textbox", { name: "Поиск обращений" }).fill("вторая часть");
    assert.equal(
      await list.getByRole("button", { name: "Открыть обращение: Марина", exact: true }).count(),
      1,
    );
    await list.getByRole("textbox", { name: "Поиск обращений" }).fill("Екатеринбург");
    assert.equal(
      await list.getByRole("button", { name: "Открыть обращение: Игорь", exact: true }).count(),
      1,
    );
    await list.getByRole("button", { name: "Закрыть поиск", exact: true }).click();
    await list.getByRole("button", { name: "Открыть обращение: Игорь", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("focus") === "igor");
    await page.goBack({ waitUntil: "networkidle" });
    await list.getByRole("button", { name: "Открыть обращение: Игорь", exact: true }).waitFor();
    await list.getByRole("button", { name: "Открыть обращение: Игорь", exact: true }).click();
    const card = page.getByRole("article", { name: "Карточка: Игорь", exact: true }),
      input = card.getByRole("textbox", { name: "Ответ Игорь", exact: true });
    async function action(name) {
      await card.getByRole("button", { name: "Действия диалога", exact: true }).click();
      await card.getByRole("menuitem", { name, exact: true }).click();
    }
    assert.equal(await card.getByTestId("reply-mode").innerText(), "Ручной");
    assert.equal(await card.locator(".message-meta time").count(), 3);
    assert.equal(await card.locator(".message-day").count(), 1);
    assert.equal(await card.locator(".lead-tabs,.lead-next,.lead-close").count(), 0);
    assert.equal(
      await card.locator(".contact-messages").evaluate((el) => getComputedStyle(el).scrollbarWidth),
      "none",
    );
    if (width === 390)
      assert.equal(await page.getByRole("navigation", { name: "Разделы" }).count(), 0);
    await input.fill("Текст останется даже без интернета");
    await context.setOffline(true);
    await input.fill("Офлайн-черновик Игоря");
    const cached = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cantor.draft-cache.v1:cantor-demo-anna:igor")),
    );
    assert.equal(cached, "Офлайн-черновик Игоря");
    await context.setOffline(false);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await input.inputValue(), "Офлайн-черновик Игоря");
    await card
      .getByRole("button", { name: "Цитировать сообщение igor-source-2", exact: true })
      .click();
    await card.locator(".quote-preview").getByText("Можно в субботу?", { exact: true }).waitFor();
    await input.press("Shift+Enter");
    assert.match(await input.inputValue(), /\n/);
    await input.press("Enter");
    await card.locator(".message-bubble").filter({ hasText: "Офлайн-черновик" }).waitFor();
    assert.equal(await card.locator(".message-bubble").count(), 4);
    await card.getByRole("button", { name: "Заметка о клиенте", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Текст заметки", exact: true })
      .fill("Попросить пробник по геометрии");
    await page
      .locator(".note-editor")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    assert.equal(await card.locator(".note-button.has-note").count(), 1);
    await action("Остановить таймер");
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cantor.demo-crm.v1")).leads.find((l) => l.id === "igor")
            .timerStopped,
      ),
      true,
    );
    await action("Включить таймер");
    await action("Предложить время");
    const invitation = card.locator(".inline-invitation");
    assert.equal(await invitation.getByRole("button", { name: /19 нояб/ }).count(), 0);
    await invitation.getByRole("button", { name: /21 нояб.*12:00/ }).click();
    await invitation.getByRole("button", { name: "Вставить приглашение", exact: true }).click();
    assert.match(await input.inputValue(), /21 ноября.*12:00/);
    await page.screenshot({ path: `${output}/conversation-${width}.png`, fullPage: true });
    const editor = await card.locator(".contact-composer").boundingBox();
    assert.ok(editor.y + editor.height <= 961);
    await action("Диагностика");
    const schedule = card.getByRole("region", { name: "Расписание диагностик", exact: true }),
      slot = schedule.getByRole("combobox", { name: /Окно/ });
    await slot.click();
    await page.locator('[role="option"][data-value="tue"]').click();
    await schedule.getByRole("button", { name: "Записать на диагностику", exact: true }).click();
    assert.equal(await card.getByTestId("lead-stage").innerText(), "Записан");
    await schedule.getByRole("button", { name: "Перенести запись: Игорь", exact: true }).click();
    await slot.click();
    await page.locator('[role="option"][data-value="sat-12"]').click();
    await schedule.getByRole("button", { name: "Сохранить перенос", exact: true }).click();
    await action("Закрыть обращение");
    await card
      .getByRole("textbox", { name: "Причина закрытия", exact: true })
      .fill("Выбрали другого преподавателя");
    await card.getByRole("button", { name: "Подтвердить закрытие", exact: true }).click();
    assert.equal(await card.getByTestId("lead-stage").innerText(), "Закрыто");
    await action("Вернуть в работу");
    await action("Диагностика");
    await slot.click();
    await page.locator('[role="option"][data-value="sat-12"]').click();
    assert.match(await slot.innerText(), /21 ноября/);
    await schedule.getByRole("button", { name: "Записать на диагностику", exact: true }).click();
    await page.clock.install({ time: new Date("2026-11-22T10:00:00Z") });
    await page.reload({ waitUntil: "networkidle" });
    await action("Диагностика");
    await schedule.getByRole("button", { name: "Проведена", exact: true }).click();
    assert.equal(await card.getByTestId("lead-stage").innerText(), "После диагностики");
    await action("Итоги и задачи");
    await card
      .getByRole("textbox", { name: "Итог диагностики", exact: true })
      .fill("Проблема с геометрией, договорились о двух занятиях");
    await card.getByRole("button", { name: "Сохранить итог", exact: true }).click();
    await card.locator(".outcome-note").waitFor();
    await card
      .getByRole("textbox", { name: "Название задачи", exact: true })
      .fill("Уточнить решение после встречи");
    await card.getByRole("textbox", { name: "Дата задачи", exact: true }).fill("23.11.2026");
    await card.getByRole("button", { name: "Добавить задачу", exact: true }).click();
    await card.locator(".followup-list li").waitFor();
    await action("Оплаты");
    const payments = card.getByRole("region", { name: "Оплаты учеников", exact: true });
    assert.equal(
      await payments.getByRole("combobox", { name: "Ученик", exact: true }).isDisabled(),
      true,
    );
    assert.match(
      await payments.getByRole("combobox", { name: "Ученик", exact: true }).innerText(),
      /Игорь|Сын Игоря/,
    );
    for (const value of ["1234,50", "55,50"]) {
      await payments.getByRole("textbox", { name: "Сумма, ₽", exact: true }).fill(value);
      await payments.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
      await payments.getByRole("status").waitFor();
    }
    assert.equal(await card.getByTestId("lead-stage").innerText(), "Ученик");
    await go("/");
    assert.equal(await page.getByTestId("completed-diagnostics").innerText(), "4");
    assert.equal(await page.getByTestId("new-students").innerText(), "3");
    assert.equal(
      (await page.getByTestId("dashboard-revenue").innerText()).replace(/[^\d,]/g, ""),
      "10890",
    );
    await go("/?section=chats");
    await page.getByRole("button", { name: "CRM", exact: true }).click();
    const crmIgor = page.locator('.crm-lane[aria-label="Ученик"] [data-lead-id="igor"]');
    assert.equal(await crmIgor.count(), 1);
    assert.match(await crmIgor.innerText(), /Задачи · 1/);
    await page.screenshot({ path: `${output}/crm-${width}.png`, fullPage: true });
    await crmIgor.getByRole("button", { name: "Открыть обращение: Игорь", exact: true }).click();
    await action("Итоги и задачи");
    await card
      .getByRole("button", { name: "Выполнить: Уточнить решение после встречи", exact: true })
      .click();
    assert.equal(
      await card
        .getByRole("button", { name: "Выполнить: Уточнить решение после встречи", exact: true })
        .isDisabled(),
      true,
    );
    await action("Переписка");
    await card.getByRole("button", { name: "Действия диалога", exact: true }).click();
    await card.getByRole("menuitemradio", { name: "ИИ · согласование", exact: true }).click();
    assert.equal(await input.getAttribute("readonly"), "");
    await card.getByRole("button", { name: "Редактировать ответ", exact: true }).click();
    await input.fill("Исправленный ответ для обучения");
    await input.press("Tab");
    await card.getByRole("button", { name: "Действия диалога", exact: true }).click();
    await page.keyboard.press("Escape");
    await card.getByRole("button", { name: "Действия диалога", exact: true }).click();
    await card.getByRole("menuitemradio", { name: "Ручной", exact: true }).click();
    await go("/?section=chats&focus=marina");
    const marina = page.getByRole("article", { name: "Карточка: Марина", exact: true });
    assert.equal(await marina.locator(".message-day").count(), 2);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    assert.deepEqual(errors, []);
    assert.equal(apiAttempts, 0);
    results.push({
      width,
      compactList: true,
      searchMessagesAndCity: true,
      timerControl: true,
      offlineDraft: true,
      explicitLocalDelivery: true,
      quotesAndDates: true,
      notePopover: true,
      contextMenu: true,
      mobileFullScreen: true,
      journey: true,
      outcomesAndTasks: true,
      sameCrmContacts: true,
      modeAndEditing: true,
      pageErrors: errors,
      apiAttempts,
    });
    await context.close();
  }
  writeFileSync(`${output}/result.json`, JSON.stringify({ ok: true, url, results }, null, 2));
  console.log(JSON.stringify({ ok: true, url, results, screenshots: output }));
} catch (error) {
  for (const c of browser.contexts())
    for (const p of c.pages()) {
      console.error(
        JSON.stringify({
          url: p.url(),
          body: (await p.locator("body").innerText()).slice(0, 14000),
          diagnostics,
        }),
      );
      await p.screenshot({ path: `${output}/failure.png`, fullPage: true });
    }
  throw error;
} finally {
  await browser.close();
}

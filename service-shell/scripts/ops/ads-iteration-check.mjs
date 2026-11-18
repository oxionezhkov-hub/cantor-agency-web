import { chromium } from "playwright";
import assert from "node:assert/strict";
import { setGlobalProxyFromEnv } from "node:http";
import { mkdirSync } from "node:fs";
setGlobalProxyFromEnv();
const local = "http://127.0.0.1:9162",
  remote = "https://cantor-service-preview.oxion-ezhkov.workers.dev";
const base = process.argv.includes("--cloud") ? remote : local;
mkdirSync("/tmp/cantor-ads-nov18", { recursive: true });
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  for (const width of process.argv.includes("--mobile") ? [390] : [1440, 390]) {
    const c = await b.newContext({ viewport: { width, height: 900 } });
    await c.route(base + "/**", async (route) => {
      const q = route.request(),
        u = new URL(q.url());
      if (base === local && !u.pathname.startsWith("/api/demo/")) return route.continue();
      const headers = { ...q.headers() };
      delete headers.host;
      const r = await fetch((base === local ? remote : base) + u.pathname + u.search, {
        method: q.method(),
        headers,
        signal: AbortSignal.timeout(120000),
      });
      const h = Object.fromEntries(r.headers);
      for (const k of ["content-length", "content-encoding", "transfer-encoding"]) delete h[k];
      await route.fulfill({
        status: r.status,
        headers: h,
        body: Buffer.from(await r.arrayBuffer()),
      });
    });
    const p = await c.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.getByLabel("Пароль", { exact: true }).fill(process.env.DASHBOARD_PASSWORD);
    await p.getByRole("button", { name: "Войти", exact: true }).click();
    const nav = p.locator("#service-navigation");
    if (width === 390) await p.locator(".service-mobile-menu-button").waitFor({ timeout: 120000 });
    const openMenu = async () => {
      if (width === 390 && (await p.getByRole("button", { name: "Открыть меню" }).count()))
        await p.getByRole("button", { name: "Открыть меню" }).click();
    };
    await openMenu();
    await nav.getByRole("button", { name: /^Мои объявления/ }).waitFor({ timeout: 120000 });
    await nav.getByRole("button", { name: /^Мои объявления/ }).click();
    await p.locator(".aw-table tbody tr").first().waitFor();
    assert.equal(await nav.getByRole("button", { name: "История", exact: true }).count(), 0);
    if (width === 390) {
      const tools = p.locator(".aw-tools");
      const search = p.getByRole("textbox", { name: "Поиск объявлений" });
      const controls = [
        p.getByRole("button", { name: "Открыть поиск объявлений" }),
        p.getByLabel("Статус объявлений"),
        p.getByRole("button", { name: "Подробнее", exact: true }),
        p.getByRole("button", { name: "Ставки", exact: true }),
      ];
      const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
      assert.ok(
        boxes.every((box) => box && Math.abs(box.y - boxes[0].y) < 5),
        "mobile controls do not fit in one row",
      );
      assert.ok(
        await tools.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        "mobile toolbar overflows",
      );
      await controls[0].click();
      assert.ok(await search.evaluate((el) => document.activeElement === el));
      assert.equal(await controls[2].isVisible(), false);
      await search.fill("несуществующее объявление");
      assert.ok(
        await p.getByText("Объявлений не найдено. Измените фильтр или создайте новое.").isVisible(),
      );
      await p.getByRole("button", { name: "Закрыть поиск объявлений" }).click();
      assert.ok(await controls[2].isVisible());
      assert.equal(await p.locator('input[aria-label="Поиск объявлений"]').inputValue(), "");
    }
    await p.getByRole("button", { name: "Подробнее", exact: true }).click();
    for (const n of [
      "Цена показа",
      "Показы → просмотры",
      "Цена просмотра",
      "Просмотры → контакты",
      "Цена контакта",
    ])
      assert.ok(await p.getByRole("button", { name: new RegExp(n) }).count(), n);
    const h = p.getByRole("columnheader", { name: /Показы/ }).first();
    if (width === 390)
      await p
        .locator(".aw-table-wrap")
        .first()
        .evaluate((el) => {
          el.scrollLeft = el.querySelector("th:nth-child(4)").offsetLeft - 50;
        });
    await h.getByRole("button").click();
    assert.equal(await h.getAttribute("aria-sort"), "ascending");
    assert.ok((await h.getAttribute("class")).includes("aw-sort-active"));
    assert.equal(
      await h.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(250, 249, 247)",
    );
    const titleFits = await p
      .locator(".aw-title-full")
      .evaluateAll((els) =>
        els.every(
          (el) =>
            el.scrollHeight <= el.clientHeight + 1 && getComputedStyle(el).overflow !== "hidden",
        ),
      );
    assert.ok(titleFits, "A full title is clipped");
    if (width === 1440) {
      const maxLines = await p
        .locator(".aw-title-full")
        .evaluateAll((els) =>
          Math.max(
            ...els.map(
              (el) =>
                el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
            ),
          ),
        );
      assert.ok(maxLines <= 2.1, `title exceeds two lines: ${maxLines}`);
    }
    const wrap = p.locator(".aw-table-wrap").first();
    const before = await wrap.locator("tbody tr:first-child td:nth-child(2)").boundingBox();
    await wrap.evaluate((el) => (el.scrollLeft = 500));
    await p.waitForTimeout(100);
    const after = await wrap.locator("tbody tr:first-child td:nth-child(2)").boundingBox();
    if (width !== 390) assert.ok(Math.abs(after.x - before.x) < 2, "ad column moves during scroll");
    const check = await wrap
      .locator("tbody tr:first-child td:first-child")
      .evaluate((el) => getComputedStyle(el).position);
    assert.equal(check, "sticky");
    await wrap.evaluate((el) => (el.scrollLeft = 0));
    const headerBefore = await wrap.locator("thead th:nth-child(3)").boundingBox();
    const toolbarBefore = await p.locator(".aw-tools").boundingBox();
    await wrap.evaluate((el) => (el.scrollTop = 800));
    const headerAfter = await wrap.locator("thead th:nth-child(3)").boundingBox();
    const toolbarAfter = await p.locator(".aw-tools").boundingBox();
    assert.ok(Math.abs(headerAfter.y - headerBefore.y) < 2, "table header moved when scrolling");
    assert.ok(Math.abs(toolbarAfter.y - toolbarBefore.y) < 2, "toolbar moved when scrolling");
    await wrap.evaluate((el) => (el.scrollTop = 0));
    await p.getByRole("button", { name: "Ставки", exact: true }).click();
    assert.ok((await p.locator('input[aria-label^="Ставка "]').count()) > 0);
    assert.ok((await p.locator('input[aria-label^="Бюджет в день "]').count()) > 0);
    await p.getByLabel("Выбрать все объявления").check();
    assert.ok(
      await p
        .locator(".aw-tools")
        .getByText(/Выбрано:/)
        .count(),
    );
    await p.screenshot({ path: `/tmp/cantor-ads-nov18/list-${width}.png` });
    await openMenu();
    await nav.getByRole("button", { name: "Автозагрузка", exact: true }).click();
    await p.getByRole("heading", { name: "История", exact: true }).waitFor();
    await p.getByRole("button", { name: "Показать ошибки" }).click();
    assert.ok(await p.getByRole("region", { name: "Ошибки автозагрузки" }).isVisible());
    await p.getByRole("button", { name: "Обновить из таблицы" }).click();
    assert.ok(
      await p.getByRole("status").getByText("Обновление таблицы пока не подключено").count(),
    );
    await p.getByRole("button", { name: "Отправить в Авито" }).click();
    assert.ok(
      await p
        .getByRole("status")
        .getByText("Внеочередная загрузка в Авито пока не подключена")
        .count(),
    );
    assert.equal(
      await p
        .locator(".aw-panel")
        .first()
        .evaluate((el) => getComputedStyle(el).borderTopWidth),
      "1px",
    );
    await p.screenshot({ path: `/tmp/cantor-ads-nov18/feed-${width}.png` });
    await openMenu();
    await nav.getByRole("button", { name: "ИИ-генерация", exact: true }).click();
    const d = p.getByRole("region", { name: "Редактор объявления" });
    await d.waitFor();
    assert.equal(await p.getByRole("dialog", { name: "Редактор объявления" }).count(), 0);
    assert.equal(
      await p
        .getByText("Заполните поля самостоятельно или подготовьте текст и фотографии с помощником.")
        .count(),
      0,
    );
    const tabsBefore = await d.locator(":scope > .aw-tabs").boundingBox();
    const footerBefore = await d.locator(":scope > footer").boundingBox();
    await d.locator(".aw-editor-body").evaluate((el) => {
      const space = document.createElement("div");
      space.style.height = "1200px";
      space.dataset.testSpacer = "1";
      el.appendChild(space);
    });
    await d.locator(width === 390 ? ".aw-editor-layout" : ".aw-editor-body").evaluate((el) => {
      el.scrollTop = 500;
    });
    const tabsAfter = await d.locator(":scope > .aw-tabs").boundingBox();
    const footerAfter = await d.locator(":scope > footer").boundingBox();
    assert.ok(Math.abs(tabsAfter.y - tabsBefore.y) < 2, "editor tabs moved");
    assert.ok(Math.abs(footerAfter.y - footerBefore.y) < 2, "editor footer moved");
    await d.locator("[data-test-spacer]").evaluate((el) => el.remove());
    await d.locator(width === 390 ? ".aw-editor-layout" : ".aw-editor-body").evaluate((el) => {
      el.scrollTop = 0;
    });
    await d.getByLabel("Заголовок", { exact: true }).fill("Тест объявления");
    await d.getByLabel("Текст объявления", { exact: true }).fill("Текст объявления");
    await d.getByLabel("Город", { exact: true }).fill("Москва");
    await d.getByRole("button", { name: "Предложить текст" }).click();
    assert.ok(await d.getByText("ИИ-генерация пока не подключена").count());
    await p.screenshot({ path: `/tmp/cantor-ads-nov18/create-${width}.png` });
    await d.getByRole("button", { name: "Сохранить", exact: true }).click();
    assert.ok(
      await p
        .getByText("Изменения действуют до обновления страницы и не отправлены в Авито.")
        .count(),
    );
    await openMenu();
    await nav.getByRole("button", { name: /^Мои объявления/ }).click();
    await p.locator(".aw-table tbody tr").first().waitFor();
    assert.ok(await p.getByText("Тест объявления", { exact: true }).count());
    assert.equal(await p.getByRole("dialog", { name: "Редактор объявления" }).count(), 0);
    await openMenu();
    await nav.getByRole("button", { name: "ИИ-генерация", exact: true }).click();
    await d.waitFor();
    assert.equal(await d.getByLabel("Заголовок", { exact: true }).inputValue(), "");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        sort: true,
        funnel: true,
        inlineBids: true,
        bulk: true,
        feedHistory: true,
        creation: true,
        temporaryChanges: true,
        errors,
      }),
    );
    await c.close();
  }
} finally {
  await b.close();
}

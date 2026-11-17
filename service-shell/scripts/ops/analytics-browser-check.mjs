#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setGlobalProxyFromEnv } from "node:http";
import { chromium } from "playwright";

setGlobalProxyFromEnv();
const url = process.argv[2] || "http://127.0.0.1:9153";
const output = process.argv[3] || "/tmp/cantor-analytics-check";
const origin = new URL(url).origin;
if (
  !["localhost", "127.0.0.1", "cantor-service-preview.oxion-ezhkov.workers.dev"].includes(
    new URL(url).hostname,
  )
)
  throw new Error("Interactive checks are restricted to the isolated preview");
mkdirSync(output, { recursive: true });

// CSV parser covers separators, escaped quotes and multiline cells. Assertions
// below inspect exported values rather than trusting download/file presence.
function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  const separator = source.split(/\r?\n/)[0].includes(";") ? ";" : ",";
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === separator && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
const digits = (value) => value.replace(/[^\d,.-]/g, "").replace(",", ".");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
  args: ["--no-sandbox"],
});
const results = [];
async function checkPage(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `${label}: page overflows by ${overflow}px`);
}
async function downloadCsv(page, name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /CSV/ }).click();
  const download = await pending;
  const file = `${output}/${name}.csv`;
  await download.saveAs(file);
  const text = readFileSync(file, "utf8");
  assert.ok(text.length > 30, "Export must contain a report");
  return { text, rows: parseCsv(text) };
}

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 960 },
      acceptDownloads: true,
    });
    // Preserve TLS certificate verification for external checks. Node trusts the
    // managed proxy CA even if the standalone Chromium profile does not.
    if (process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1")
      await context.route(`${origin}/**`, async (route) => {
        const req = route.request();
        assert.ok(["GET", "HEAD"].includes(req.method()), `Unexpected write ${req.method()}`);
        const response = await fetch(req.url(), {
          method: req.method(),
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
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/?section=stats`, { waitUntil: "networkidle" });
    await checkPage(page, `${width}px initial analytics`);

    const metricCard = (label) =>
      page.locator(".an-metric").filter({ has: page.getByText(label, { exact: true }) });
    const metricText = async (label) => metricCard(label).locator("strong").innerText();
    const metricValue = async (label) => Number(digits(await metricText(label)));
    const chooseTab = async (label) => {
      await page.getByRole("tab", { name: label, exact: true }).click();
      assert.equal(
        await page.getByRole("tab", { name: label, exact: true }).getAttribute("aria-selected"),
        "true",
      );
      await checkPage(page, `${width}px ${label}`);
      assert.equal(
        await page
          .locator('.analytics select:not([aria-hidden="true"]), .analytics input[type="date"]')
          .count(),
        0,
        "No native calendar or dropdown controls",
      );
    };
    const choose = async (label, option) => {
      await page.getByRole("combobox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    const dateRange = async (from, to) => {
      await page.getByRole("button", { name: "Выбрать период", exact: true }).click();
      await page.getByRole("textbox", { name: "Начало периода", exact: true }).fill(from);
      await page.getByRole("textbox", { name: "Конец периода", exact: true }).fill(to);
      await page.getByRole("button", { name: "Готово", exact: true }).click();
    };
    const dataRows = (csv, header) => {
      const start = csv.rows.findIndex((r) => r[0] === header);
      assert.ok(start >= 0, `Missing CSV header ${header}`);
      assert.ok(
        csv.rows.some((r) => r[0] === "Источник рекламы" && r[1].includes("не выгрузка Авито")),
      );
      const end = csv.rows.findIndex(
        (r, i) => i > start && (r[0] === "По объявлениям и городам" || r[0] === header),
      );
      return csv.rows.slice(start + 1, end < 0 ? undefined : end).filter((r) => r.length > 1);
    };
    const screenshot = (name) =>
      page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
    const tabs = page.getByRole("tablist", { name: "Отчёты аналитики" });
    await tabs.getByRole("tab", { name: "Обзор", exact: true }).waitFor({ state: "visible" });
    assert.equal(await tabs.getByRole("tab").count(), 4);
    assert.equal(await page.getByText("Источники и методика расчёта", { exact: true }).count(), 0);
    assert.equal(await page.locator(".an-filterbar,.an-data-date,.an-timezone").count(), 0);
    assert.equal(
      await page.getByRole("textbox", { name: "Начало периода", exact: true }).count(),
      0,
      "Calendar starts collapsed",
    );
    if (width === 1440) {
      const boxes = await page.locator(".an-compact-toolbar > *").evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        }),
      );
      assert.ok(
        Math.max(...boxes.map((b) => b.top)) - Math.min(...boxes.map((b) => b.top)) <= 2,
        "Desktop toolbar is a single row",
      );
    }
    assert.equal(await metricValue("Просмотры"), 318);
    assert.equal(await metricValue("Контакты"), 29);
    assert.equal(await metricValue("Расход на рекламу"), 6420);
    assert.equal(await metricValue("Получено после возвратов"), 9600);
    assert.equal(await metricValue("Новые платящие ученики"), 2);
    const all = page.getByRole("button", { name: "Все", exact: true });
    assert.equal(await all.getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".an-plot").first().locator(".recharts-line").count(), 3);
    await screenshot("overview");
    for (const label of ["Показы", "Просмотры", "Контакты"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      assert.equal(
        await page.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed"),
        "true",
      );
    }
    await all.click();
    assert.equal(
      await page.locator(".an-funnel-step > div:first-child i").count(),
      0,
      "Funnel label dots removed",
    );
    assert.match(await page.locator(".an-funnel-step").nth(0).innerText(), /3,87 ₽ \/ показ/);
    assert.match(await page.locator(".an-funnel-step").nth(1).innerText(), /19,2%.*20,19 ₽/s);
    assert.equal(await page.locator(".an-rank-index").count(), 0);
    await page.getByText("Все показатели по дням", { exact: true }).click();
    assert.equal(await page.locator(".an-daily-table tbody tr").count(), 16);
    assert.equal(
      await page
        .locator(".an-daily-table")
        .getByRole("columnheader", { name: "CTR", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator(".an-daily-table")
        .getByRole("columnheader", { name: "Цена просмотра", exact: true })
        .count(),
      1,
    );
    const overview = dataRows(await downloadCsv(page, `overview-${width}`), "Дата, МСК");
    assert.equal(overview.length, 16);
    for (const [column, total] of [
      [3, 318],
      [4, 29],
      [7, 6420],
    ])
      assert.equal(
        overview.reduce((sum, r) => sum + Number(r[column]), 0),
        total,
      );

    await chooseTab("Объявления");
    assert.equal(await page.locator(".an-ad-table tbody tr").count(), 3);
    await page
      .locator(".an-ad-table")
      .getByRole("button", { name: "Контакты", exact: true })
      .click();
    assert.match(await page.locator(".an-ad-table tbody tr").first().innerText(), /ОГЭ/);
    await page
      .locator(".an-ad-table")
      .getByRole("button", { name: "Контакты", exact: true })
      .click();
    assert.match(await page.locator(".an-ad-table tbody tr").first().innerText(), /Алгебра/);
    const search = page.getByRole("searchbox", { name: "Найти объявление в отчёте" });
    await search.fill("ЕГЭ");
    assert.equal(await page.locator(".an-ad-table tbody tr").count(), 1);
    const searched = dataRows(await downloadCsv(page, `ads-search-${width}`), "Название");
    assert.equal(searched.length, 1);
    assert.equal(Number(searched[0][3]), 8);
    assert.equal(Number(searched[0][6]), 2940);
    await search.fill("несуществующее");
    await page.getByText("Объявления не найдены.", { exact: true }).waitFor();
    await search.fill("");
    await page.getByRole("heading", { name: "Объявления по городам", exact: true }).waitFor();
    assert.equal(await page.locator('[aria-label="Объявление · город"] tbody tr').count(), 3);
    const adsCsv = await downloadCsv(page, `ads-${width}`),
      adRows = dataRows(adsCsv, "Название");
    assert.equal(adRows.length, 3);
    assert.equal(
      adRows.reduce((sum, r) => sum + Number(r[3]), 0),
      29,
    );
    assert.equal(
      adRows.reduce((sum, r) => sum + Number(r[6]), 0),
      6420,
    );
    const geoHeader = adsCsv.rows.findIndex((r) => r[0] === "По объявлениям и городам");
    const geo = adsCsv.rows.slice(geoHeader + 2);
    assert.equal(geo.length, 3);
    assert.equal(
      geo.reduce((sum, r) => sum + Number(r[3]), 0),
      29,
    );
    await screenshot("ads-cities");
    await page.locator(".an-ad-table").getByRole("link").filter({ hasText: "ОГЭ" }).click();
    assert.equal(new URL(page.url()).searchParams.get("focus"), "oge");
    assert.equal(new URL(page.url()).searchParams.get("section"), "ads");
    await page.goto(`${url}/?section=stats`, { waitUntil: "networkidle" });
    await choose("Фильтр по объявлению", "ОГЭ, разбор ошибок");
    await choose("Фильтр по городу", "Область");
    assert.equal(await metricValue("Просмотры"), 62);
    assert.equal(await metricValue("Контакты"), 7);
    assert.equal(await metricValue("Расход на рекламу"), 1220);
    await chooseTab("Диалоги");
    await page.getByRole("button", { name: "Показать все города", exact: true }).click();
    assert.equal(await metricValue("Новые обращения"), 2);
    assert.equal(dataRows(await downloadCsv(page, `dialogs-oge-${width}`), "Обращение").length, 2);
    await page.getByRole("button", { name: "Сбросить фильтры", exact: true }).click();
    assert.equal(await metricValue("Новые обращения"), 7);
    assert.equal(await metricValue("Диагностик проведено"), 3);
    await page.getByRole("heading", { name: "Причины отказов", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Как улучшить диалоги", exact: true }).waitFor();
    assert.ok((await page.locator(".an-dialog-advice a").count()) > 0);
    await screenshot("dialogs");
    assert.equal(dataRows(await downloadCsv(page, `dialogs-${width}`), "Обращение").length, 7);
    await page
      .locator('[aria-label="Обращения CRM"]')
      .getByRole("link", { name: "Марина", exact: true })
      .click();
    assert.equal(new URL(page.url()).searchParams.get("focus"), "marina");
    await page.goto(`${url}/?section=stats`, { waitUntil: "networkidle" });
    await chooseTab("Экономика");
    assert.equal(await metricValue("Поступления"), 9600);
    assert.equal(await metricValue("Возвраты"), 0);
    assert.equal(await metricValue("Остаток до прочих затрат"), 3180);
    await page.getByRole("textbox", { name: "LTV ученика, ₽", exact: true }).fill("16050");
    await page.getByRole("button", { name: "Сохранить LTV", exact: true }).click();
    assert.equal(await page.getByTestId("ltv-cac").innerText(), "3 210 ₽");
    assert.equal(digits(await page.getByTestId("ltv-share").innerText()), "20");
    await page.getByText("Экономика сходится", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "LTV ученика, ₽", exact: true }).fill("10000");
    await page.getByRole("button", { name: "Сохранить LTV", exact: true }).click();
    await page.getByText("Расход выше 20% LTV", { exact: true }).waitFor();
    assert.equal(digits(await page.getByTestId("ltv-share").innerText()), "32.1");
    await page.reload({ waitUntil: "networkidle" });
    await chooseTab("Экономика");
    assert.equal(
      await page.getByRole("textbox", { name: "LTV ученика, ₽", exact: true }).inputValue(),
      "10000",
    );
    await page.getByText("Расход выше 20% LTV", { exact: true }).waitFor();
    const economy = dataRows(await downloadCsv(page, `economy-${width}`), "Дата, МСК");
    for (const [column, total] of [
      [1, 9600],
      [4, 6420],
      [5, 3180],
    ])
      assert.equal(
        economy.reduce((sum, r) => sum + Number(r[column]), 0),
        total,
      );
    const paymentSummary = page.locator(".an-payment-entry summary");
    if (await paymentSummary.count()) await paymentSummary.click();
    await page.getByRole("button", { name: "Сохранить оплату", exact: true }).waitFor();
    await checkPage(page, `${width}px payment controls`);
    await screenshot("economy");
    await chooseTab("Обзор");
    await page.getByRole("button", { name: "7 дней", exact: true }).click();
    await page.locator(".an-metric").filter({ hasText: "к прошлому периоду" }).first().waitFor();
    await page.getByRole("button", { name: "Вчера", exact: true }).click();
    const yesterday = dataRows(await downloadCsv(page, `yesterday-${width}`), "Дата, МСК");
    assert.equal(yesterday.length, 1);
    assert.equal(
      yesterday[0][0],
      new Date(Date.now() + 3 * 3600000 - 86400000).toISOString().slice(0, 10),
    );
    await dateRange("17.11.2026", "16.11.2026");
    await page.getByRole("alert").waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Скачать CSV", exact: true }).isEnabled(),
      false,
    );
    await dateRange("17.11.2026", "18.11.2026");
    await page.getByText("За выбранные даты рекламных данных нет.", { exact: true }).waitFor();
    assert.equal(await metricText("Просмотры"), "—");
    const unavailable = dataRows(await downloadCsv(page, `unavailable-${width}`), "Дата, МСК");
    assert.equal(unavailable.length, 2);
    assert.ok(unavailable.every((r) => r[1] === "Нет" && r[2] === "" && r[7] === ""));
    await page.getByRole("button", { name: "Сбросить фильтры", exact: true }).click();
    await choose("Фильтр по объявлению", "Алгебра, 8 класс");
    assert.equal(await metricValue("Просмотры"), 0);
    assert.equal(await metricText("Цена контакта"), "—");
    await page.getByRole("button", { name: "Сбросить фильтры", exact: true }).click();
    await page.getByRole("tab", { name: "Обзор", exact: true }).press("End");
    assert.equal(
      await page.getByRole("tab", { name: "Экономика", exact: true }).getAttribute("aria-selected"),
      "true",
    );
    await page.getByRole("tab", { name: "Экономика", exact: true }).press("Home");
    // A test-only refusal is written to this isolated browser profile, never any API.
    await page.evaluate(() => {
      const key = "cantor.demo-crm.v1";
      const state = JSON.parse(localStorage.getItem(key));
      const lead = state.leads.find((l) => l.id === "olga");
      lead.closedAt = "2026-11-16T12:00:00Z";
      lead.closeReason = "Не подошло расписание";
      localStorage.setItem(key, JSON.stringify(state));
      window.dispatchEvent(new Event("cantor-crm-changed"));
    });
    await chooseTab("Диалоги");
    await page
      .locator(".an-refusal-list")
      .getByText("Не подошло расписание", { exact: true })
      .waitFor();
    const closedCsv = dataRows(await downloadCsv(page, `dialogs-refusal-${width}`), "Обращение");
    assert.ok(closedCsv.some((r) => r[0] === "Ольга" && r[4] === "Не подошло расписание"));
    await screenshot("dialog-refusal");
    await checkPage(page, `${width}px complete analytics`);

    assert.deepEqual(errors, [], `${width}px JavaScript errors`);
    assert.equal(apiAttempts, 0, "Analytics must not call production APIs");
    results.push({ width, apiAttempts, pageErrors: errors });
    await context.close();
  }
  writeFileSync(`${output}/result.json`, JSON.stringify({ url, results }, null, 2));
  console.log(JSON.stringify({ ok: true, url, results, screenshots: output }));
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      console.error(
        JSON.stringify({
          url: page.url(),
          body: (await page.locator("body").innerText()).slice(0, 18000),
        }),
      );
      await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
    }
  throw error;
} finally {
  await browser.close();
}

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
    };
    const dataRows = (csv, header) => {
      const start = csv.rows.findIndex((row) => row[0] === header);
      assert.ok(start >= 0, `Missing CSV header ${header}`);
      assert.ok(
        csv.rows.some(
          (row) => row[0] === "Источник рекламы" && row[1].includes("не выгрузка Авито"),
        ),
      );
      return csv.rows.slice(start + 1);
    };
    const screenshot = (name) =>
      page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
    assert.equal(await metricValue("Просмотры"), 318);
    assert.equal(await metricValue("Контакты"), 29);
    assert.equal(await metricValue("Расход на рекламу"), 6420);
    assert.equal(await metricValue("Получено после возвратов"), 9600);
    assert.equal(await metricValue("Новые платящие ученики"), 2);
    await screenshot("overview");
    await page.getByRole("button", { name: "Показы", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "Показы", exact: true }).getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "Контакты", exact: true }).click();
    await page.getByText("Все показатели по дням", { exact: true }).click();
    assert.equal(await page.locator(".an-days tbody tr").count(), 16);
    const overview = dataRows(await downloadCsv(page, `overview-${width}`), "Дата, МСК");
    assert.equal(overview.length, 16);
    for (const [column, total] of [
      [3, 318],
      [4, 29],
      [7, 6420],
    ])
      assert.equal(
        overview.reduce((sum, row) => sum + Number(row[column]), 0),
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
    await page.getByText("По этому запросу объявлений нет.", { exact: true }).waitFor();
    await search.fill("");
    await screenshot("ads");
    const adsCsv = dataRows(await downloadCsv(page, `ads-${width}`), "Название");
    assert.equal(
      adsCsv.reduce((sum, row) => sum + Number(row[3]), 0),
      29,
    );
    assert.equal(
      adsCsv.reduce((sum, row) => sum + Number(row[6]), 0),
      6420,
    );
    await page.locator(".an-ad-table").getByRole("link").filter({ hasText: "ОГЭ" }).click();
    assert.equal(new URL(page.url()).searchParams.get("focus"), "oge");
    assert.equal(new URL(page.url()).searchParams.get("section"), "ads");
    await page.goto(`${url}/?section=stats`, { waitUntil: "networkidle" });
    await page.getByRole("combobox", { name: "Фильтр по объявлению" }).selectOption("oge");
    await page.getByRole("combobox", { name: "Фильтр по городу" }).selectOption("Область");
    assert.equal(await metricValue("Просмотры"), 62);
    assert.equal(await metricValue("Контакты"), 7);
    assert.equal(await metricValue("Расход на рекламу"), 1220);
    await chooseTab("Диалоги");
    await page.getByText("Для этого отчёта нужен общий срез", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Показать все города", exact: true }).click();
    assert.equal(await metricValue("Новые обращения CRM"), 2);
    assert.equal(dataRows(await downloadCsv(page, `dialogs-oge-${width}`), "Обращение").length, 2);
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    assert.equal(await metricValue("Новые обращения CRM"), 7);
    assert.equal(await metricValue("Диагностик проведено"), 3);
    assert.equal(await page.locator('[aria-label="Обращения CRM"] tbody tr').count(), 7);
    await screenshot("dialogs");
    assert.equal(dataRows(await downloadCsv(page, `dialogs-${width}`), "Обращение").length, 7);
    await page
      .locator('[aria-label="Обращения CRM"]')
      .getByRole("link", { name: "Марина", exact: true })
      .click();
    assert.equal(new URL(page.url()).searchParams.get("focus"), "marina");
    await page.goto(`${url}/?section=stats`, { waitUntil: "networkidle" });
    await chooseTab("Города");
    const citiesCsv = dataRows(await downloadCsv(page, `cities-${width}`), "Название");
    assert.equal(citiesCsv.length, 2);
    assert.equal(
      citiesCsv.reduce((sum, row) => sum + Number(row[3]), 0),
      29,
    );
    assert.equal(
      citiesCsv.reduce((sum, row) => sum + Number(row[6]), 0),
      6420,
    );
    await screenshot("cities");
    await chooseTab("Экономика");
    assert.equal(await metricValue("Поступления"), 9600);
    assert.equal(await metricValue("Возвраты"), 0);
    assert.equal(await metricValue("Остаток до прочих затрат"), 3180);
    const economyCsv = dataRows(await downloadCsv(page, `economy-${width}`), "Дата, МСК");
    for (const [column, total] of [
      [1, 9600],
      [4, 6420],
      [5, 3180],
    ])
      assert.equal(
        economyCsv.reduce((sum, row) => sum + Number(row[column]), 0),
        total,
      );
    await page.getByText("Денежный отчёт по дням", { exact: true }).click();
    assert.equal(await page.locator(".an-days").first().locator("tbody tr").count(), 16);
    await screenshot("economy");
    await page.getByText("Учёт оплат", { exact: true }).click();
    await page.getByRole("button", { name: "Сохранить оплату", exact: true }).waitFor();
    await checkPage(page, `${width}px payment entry`);
    await chooseTab("Обзор");
    await page.getByRole("button", { name: "7 дней", exact: true }).click();
    assert.equal(
      await page.getByLabel("Начало периода", { exact: true }).inputValue(),
      "2026-11-10",
    );
    await page.locator(".an-metric").filter({ hasText: "к прошлому периоду" }).first().waitFor();
    await page.getByLabel("Начало периода", { exact: true }).fill("2026-11-17");
    await page.getByRole("alert").waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Скачать CSV", exact: true }).isEnabled(),
      false,
    );
    await page.getByLabel("Конец периода", { exact: true }).fill("2026-11-18");
    await page.getByText(/За выбранные даты рекламной статистики нет/).waitFor();
    assert.equal(await metricText("Просмотры"), "—");
    assert.equal(await metricValue("Получено после возвратов"), 0);
    const unavailable = dataRows(await downloadCsv(page, `unavailable-${width}`), "Дата, МСК");
    assert.equal(unavailable.length, 2);
    assert.ok(unavailable.every((row) => row[1] === "Нет" && row[2] === "" && row[7] === ""));
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    await page.getByRole("combobox", { name: "Фильтр по объявлению" }).selectOption("alg");
    assert.equal(await metricValue("Просмотры"), 0);
    assert.equal(await metricText("Цена контакта"), "—");
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    await page.getByRole("tab", { name: "Обзор", exact: true }).press("End");
    assert.equal(
      await page.getByRole("tab", { name: "Экономика", exact: true }).getAttribute("aria-selected"),
      "true",
    );
    await page.getByRole("tab", { name: "Экономика", exact: true }).press("Home");
    assert.equal(
      await page.getByRole("tab", { name: "Обзор", exact: true }).getAttribute("aria-selected"),
      "true",
    );
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

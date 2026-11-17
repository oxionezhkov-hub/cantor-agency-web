#!/usr/bin/env node
// Usage: node scripts/ops/knowledge-browser-check.mjs <published-url> [screenshot-directory]
// Uses a fresh browser context at each width; writes no server data.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();

const url = process.argv[2] || "https://cantor-service-preview.oxion-ezhkov.workers.dev/";
const output = process.argv[3] || "/tmp/cantor-knowledge-checks";
const source = readFileSync(new URL("../../src/features/knowledge/content.ts", import.meta.url), "utf8");
const lessons = JSON.parse(source.slice(source.indexOf("export const knowledgeLessons: KnowledgeLesson[] = ") + "export const knowledgeLessons: KnowledgeLesson[] = ".length).trim().replace(/;$/, ""));
const courses = lessons.filter(lesson => lesson.kind === "course");
const references = lessons.filter(lesson => lesson.kind === "reference");
assert.equal(courses.length, 14);
assert.equal(references.length, 12);
const location = (focus) => { const target = new URL(url); target.searchParams.set("section", "learn"); target.searchParams.delete("focus"); if (focus) target.searchParams.set("focus", focus); target.hash = ""; return target.href; };
const normalize = value => value.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, env: process.env.CANTOR_BROWSER_DATA_HOME ? { ...process.env, XDG_DATA_HOME: process.env.CANTOR_BROWSER_DATA_HOME } : process.env, proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined, args: ["--no-sandbox"] });
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: "light" });
    // Preserve browser-check.mjs's validated TLS fallback for the managed proxy CA.
    if (process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1") {
      await context.route(`${new URL(url).origin}/**`, async route => {
        const request = route.request();
        const response = await fetch(request.url(), { method: request.method(), headers: request.headers(), body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postDataBuffer(), signal: AbortSignal.timeout(30000) });
        const headers = Object.fromEntries(response.headers);
        for (const name of ["content-encoding", "content-length", "transfer-encoding"]) delete headers[name];
        await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
      });
    }
    const page = await context.newPage();
    const pageErrors = [], consoleErrors = [], requestFailures = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("requestfailed", request => requestFailures.push(`${request.url()}: ${request.failure()?.errorText}`));
    const readerTitle = () => page.locator(".knowledge-lesson-head h2");
    const expectFocus = async id => {
      await page.waitForURL(target => target.searchParams.get("section") === "learn" && target.searchParams.get("focus") === id);
      await readerTitle().filter({ hasText: lessons.find(lesson => lesson.id === id).title }).waitFor();
      assert.equal(await readerTitle().innerText(), lessons.find(lesson => lesson.id === id).title);
    };
    const checkOverflow = async label => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, `${width}px ${label}: page overflows by ${overflow}px`);
    };
    const checkModuleTwo = async () => {
      const metrics = await page.locator(".knowledge-prose").first().evaluate(prose => {
        const funnel = prose.querySelector(".funnel");
        const steps = [...funnel.querySelectorAll(".fn")];
        const conversions = [...funnel.querySelectorAll(".fn-conv")];
        const exercise = prose.closest("article").querySelector(".knowledge-practice");
        const table = exercise.querySelector("table");
        const cells = [...table.querySelectorAll("td.num")];
        const wrapper = table.closest(".tbl-wrap,.table-wrap,.table-scroll");
        const scale = prose.querySelector(".scale");
        const scaleTrack = scale.querySelector(".scale-track");
        const cards = [...prose.querySelectorAll(".stats .stat")];
        return {
          direction: getComputedStyle(funnel).flexDirection,
          targetDisplay: getComputedStyle(scaleTrack).display,
          targetColumns: getComputedStyle(scaleTrack).gridTemplateColumns.split(" ").length,
          targetGap: parseFloat(getComputedStyle(scaleTrack).gap),
          statGap: parseFloat(getComputedStyle(prose.querySelector(".stats")).gap),
          statPadding: cards.map(card => parseFloat(getComputedStyle(card).paddingTop)),
          valueLabelGaps: cards.map(card => parseFloat(getComputedStyle(card.querySelector("b")).marginBottom)),
          stepDisplays: steps.map(step => getComputedStyle(step).display),
          stepBackgrounds: steps.map(step => getComputedStyle(step).backgroundColor),
          conversionTexts: conversions.map(item => item.textContent),
          tableDisplay: getComputedStyle(table).display,
          cellDisplays: cells.map(cell => getComputedStyle(cell).display),
          cellCount: cells.length,
          wrapperOverflow: getComputedStyle(wrapper).overflowX,
          wrapperWidth: wrapper.getBoundingClientRect().width,
          viewportWidth: innerWidth,
          targetMarkers: [...prose.querySelectorAll(".scale-zone")].filter(item => item.textContent.trim()).map(item => item.textContent.trim()),
        };
      });
      assert.equal(metrics.targetDisplay, "grid", "Target conversion thresholds use separated chips");
      assert.equal(metrics.targetColumns, width <= 760 ? 1 : 3, "Target chips stack on mobile");
      assert.ok(metrics.targetGap >= 9);
      assert.ok(metrics.statGap >= 12);
      assert.ok(metrics.statPadding.every(value => value >= 16), "Target metric cards have readable internal spacing");
      assert.ok(metrics.valueLabelGaps.every(value => value >= 8), "Metric values have space before their labels");
      assert.equal(metrics.direction, "column", "Module 2 funnel is a readable vertical sequence");
      assert.equal(metrics.stepDisplays.length, 5);
      assert.ok(metrics.stepDisplays.every(display => display === "flex"));
      assert.ok(metrics.stepBackgrounds.every(background => background !== "rgba(0, 0, 0, 0)"));
      assert.ok(metrics.conversionTexts.some(text => /10–12%/.test(text)));
      assert.ok(metrics.conversionTexts.some(text => /50%/.test(text)));
      assert.equal(metrics.tableDisplay, "table", "Metric tables preserve semantic column layout");
      assert.ok(metrics.cellCount >= 5);
      assert.ok(metrics.cellDisplays.every(display => display === "table-cell"), "Numeric values remain table cells rather than numbered badges");
      assert.equal(metrics.wrapperOverflow, "auto", "Wide tables scroll within their wrapper");
      assert.ok(metrics.wrapperWidth <= metrics.viewportWidth);
      assert.ok(metrics.targetMarkers.some(text => /10–12%/.test(text)));
      await checkOverflow("module 2 metrics and tables");
      await page.locator(".knowledge-prose .scale").screenshot({ path: `${output}/knowledge-target-thresholds-${width}.png` });
      await page.locator(".knowledge-practice .tbl-wrap").filter({ has: page.locator("td.num") }).first().screenshot({ path: `${output}/knowledge-numeric-exercise-${width}.png` });
      await page.screenshot({ path: `${output}/knowledge-metrics-${width}.png`, fullPage: true });
    };
    const checkToc = async lesson => {
      const links = page.getByRole("navigation", { name: "Содержание урока" }).locator("a");
      assert.equal(await links.count(), lesson.headings.length, `${lesson.id}: TOC coverage`);
      for (const heading of lesson.headings) assert.equal(await page.locator(`[id="${heading.id}"]`).count(), 1, `${lesson.id}: missing/duplicate heading ${heading.id}`);
    };
    try {
      await page.goto(location(), { waitUntil: "networkidle" });
      await page.getByRole("heading", { level: 2, name: "От объявления до ученика", exact: true }).waitFor();
      assert.equal(await page.locator(".knowledge > :first-child").getAttribute("class"), "knowledge-start", "Course starts with the orange learning panel");
      assert.equal(await page.locator(".knowledge-header,.knowledge-context,.knowledge-footer,.knowledge-complete").count(), 0, "Removed boilerplate stays removed");
      assert.doesNotMatch(await page.locator(".knowledge").innerText(), /материал из внутренней|исходном контексте|инструкции по работе с сервисом|собраны материалы базы знаний/i);
      assert.match(await page.title(), /Алита/);
      const brand = page.locator(".service-brand");
      assert.match(await brand.innerText(), /Алита/);
      const logo = brand.locator("img");
      await logo.waitFor({ state: "attached" });
      assert.ok(await logo.evaluate(image => image.complete && image.naturalWidth > 0), "Actual logo image loaded");
      assert.equal(await brand.locator("svg").count(), 0, "Placeholder star logo is gone");
      assert.equal(await page.getByRole("list", { name: "Программа курса", exact: true }).locator("li").count(), 14);
      await checkOverflow("overview");
      await page.screenshot({ path: `${output}/knowledge-overview-${width}.png`, fullPage: true });
      await page.getByRole("button", { name: /^Подсказки/ }).click();
      assert.equal(await page.getByRole("list", { name: "Подсказки для репетитора" }).locator("li").count(), 12);

      // Body-only phrase: ensure this cannot pass by searching titles/descriptions alone.
      const phrase = ["списалось", "наращивать", "окупаемость"].find(candidate => {
        const matches = lessons.filter(lesson => normalize(lesson.searchText).includes(candidate));
        return matches.length && matches.every(lesson => lesson.track !== "dialogues" && !normalize(`${lesson.title} ${lesson.description}`).includes(candidate));
      });
      assert.ok(phrase, "A body-only search fixture exists in the actual content");
      const queryMatches = query => lessons.filter(lesson => normalize(query).split(/\s+/).every(word => normalize(`${lesson.title} ${lesson.description} ${lesson.searchText}`).includes(word)));
      const expected = queryMatches(phrase);
      assert.ok(expected.length > 0);
      assert.ok(expected.every(lesson => !normalize(`${lesson.title} ${lesson.description}`).includes(phrase)));
      const search = page.getByRole("searchbox", { name: "Поиск по всем материалам" });
      await search.fill(phrase);
      await search.focus();
      const focusStyle = await search.evaluate(input => {
        const style = getComputedStyle(input);
        const wrapper = getComputedStyle(input.closest("label"));
        return { outline: style.outlineColor, wrapperOutline: wrapper.outlineColor, border: wrapper.borderColor, background: wrapper.backgroundColor };
      });
      assert.notEqual(focusStyle.outline, "rgb(232, 57, 29)", "Search focus is neutral rather than orange");
      assert.notEqual(focusStyle.border, "rgb(232, 57, 29)", "Search border is neutral rather than orange");
      const found = page.getByRole("list", { name: "Результаты поиска" }).locator(".knowledge-lesson-copy strong");
      assert.deepEqual(await found.allTextContents(), expected.map(lesson => lesson.title));
      const snippets = page.locator(".knowledge-snippet");
      assert.equal(await snippets.count(), expected.length, "Each search result explains its match");
      for (const snippet of await snippets.all()) {
        assert.ok(normalize(await snippet.innerText()).includes(phrase), "Search snippet contains the matched phrase");
        assert.ok((await snippet.innerText()).length < 360, "Search snippet is concise");
        assert.ok(await snippet.locator("mark").count(), "Matching text is highlighted");
      }
      assert.match(await page.locator("#knowledge-search-status").innerText(), new RegExp(phrase));
      assert.ok((await page.locator("#knowledge-search-status").innerText()).includes(String(expected.length)));
      assert.equal(await page.locator("#knowledge-search-status").getAttribute("role"), "status");
      assert.equal(await search.getAttribute("aria-describedby"), "knowledge-search-status");
      assert.equal(await page.locator(".knowledge-match>small").count(), expected.length);
      await page.screenshot({ path: `${output}/knowledge-search-${width}.png`, fullPage: true });
      // Multiple words are combined with AND even when they are separated in the lesson.
      const multiword = "конверсия диагностика";
      await search.fill(multiword);
      assert.deepEqual(await found.allTextContents(), queryMatches(multiword).map(lesson => lesson.title));
      assert.ok((await snippets.count()) > 0);
      for (const snippet of await snippets.all()) assert.ok(await snippet.locator("mark").count(), "Multiword result still explains at least one actual match");
      await page.getByRole("button", { name: "Очистить поиск", exact: true }).click();
      assert.equal(await search.inputValue(), "");
      await search.fill(phrase);
      await page.locator(".knowledge-track").filter({ hasText: "Диалоги и продажи" }).click();
      assert.equal(await page.getByRole("list", { name: "Результаты поиска" }).locator("li").count(), 0);
      await page.getByRole("heading", { name: "Материалов не найдено" }).waitFor();
      await page.getByRole("button", { name: "Сбросить поиск и фильтры" }).click();
      assert.equal(await search.inputValue(), "");
      assert.equal(await page.getByRole("list", { name: "Подсказки для репетитора" }).locator("li").count(), 12);
      await page.locator(".knowledge-track").filter({ hasText: "Продвижение на Авито" }).click();
      assert.equal(await page.getByRole("list", { name: "Подсказки для репетитора" }).locator("li").count(), references.filter(lesson => lesson.track === "promotion").length);
      await page.getByRole("button", { name: /Сбросить фильтр/ }).click();
      assert.equal(await page.getByRole("list", { name: "Подсказки для репетитора" }).locator("li").count(), 12);
      await page.getByRole("button", { name: "Начать обучение" }).click();
      await expectFocus("course-1");
      await checkToc(courses[0]);
      const firstToc = page.getByRole("navigation", { name: "Содержание урока" }).locator("a").first();
      await firstToc.click();
      assert.ok(await page.locator(`[id="${courses[0].headings[0].id}"]`).isVisible());

      // Exercise criteria are hidden until expanded.
      const criteria = page.locator(".knowledge-practice details").first();
      assert.equal(await criteria.getAttribute("open"), null);
      await criteria.locator("summary").click();
      assert.ok(await criteria.locator(".knowledge-answer").isVisible());
      assert.ok((await criteria.locator(".knowledge-answer").innerText()).length > 30);
      const actions = page.getByRole("navigation", { name: "Действия с материалом" });
      assert.equal(await actions.locator(".knowledge-mark").count(), 1, "Completion is inside the same next/previous action bar");
      await actions.getByRole("button", { name: "Отметить изученным", exact: true }).click();
      assert.equal(await page.locator(".knowledge-mark").getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator(".knowledge-mark").innerText(), "Изучено");
      await page.reload({ waitUntil: "networkidle" });
      await expectFocus("course-1");
      assert.equal(await page.locator(".knowledge-mark").getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator(".knowledge-mark").innerText(), "Изучено");
      assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("cantor-knowledge-progress-v1") || "[]").includes("course-1")));
      await page.getByRole("navigation", { name: "Действия с материалом" }).getByRole("button", { name: /Следующий материал/ }).click();
      await expectFocus("course-2");
      await checkModuleTwo();
      await page.getByRole("navigation", { name: "Действия с материалом" }).getByRole("button", { name: /Предыдущий материал/ }).click();
      await expectFocus("course-1");
      await page.getByRole("button", { name: "К программе и материалам" }).click();
      await page.getByRole("button", { name: "Продолжить обучение" }).click();
      await expectFocus("course-2");

      // Every material must survive a direct URL load, without a preceding catalog visit.
      for (const lesson of lessons) {
        await page.goto(location(lesson.id), { waitUntil: "domcontentloaded" });
        await expectFocus(lesson.id);
        await checkToc(lesson);
        assert.equal(await page.locator(".knowledge-context,.knowledge-footer,.knowledge-complete").count(), 0, `${lesson.id}: removed boilerplate stays removed`);
        await checkOverflow(lesson.id);
        if (lesson.id === "course-12") await page.screenshot({ path: `${output}/knowledge-reader-${width}.png`, fullPage: false });
      }

      // An existing reference link carries both a destination lesson and section anchor.
      await page.goto(location("base-reglament-1-zapusk"), { waitUntil: "domcontentloaded" });
      await expectFocus("base-reglament-1-zapusk");
      const crossLink = page.locator('.knowledge-prose a[data-knowledge-lesson][data-knowledge-anchor]').first();
      const targetLesson = await crossLink.getAttribute("data-knowledge-lesson");
      const targetAnchor = await crossLink.getAttribute("data-knowledge-anchor");
      assert.ok(targetLesson && targetAnchor);
      await crossLink.click();
      await expectFocus(targetLesson);
      const anchor = page.locator(`[id="${targetAnchor}"]`);
      await anchor.waitFor();
      await page.waitForFunction(id => { const element = document.getElementById(id); if (!element) return false; const rect = element.getBoundingClientRect(); return rect.top >= -2 && rect.top < innerHeight; }, targetAnchor);
      assert.equal(new URL(page.url()).origin, new URL(url).origin);
      await checkOverflow("internal cross-document anchor");
      assert.deepEqual(pageErrors, [], `${width}px JavaScript runtime errors`);
      assert.deepEqual(consoleErrors, [], `${width}px console errors`);
      assert.deepEqual(requestFailures, [], `${width}px failed requests`);
      results.push({ width, courseModules: 14, referenceDocuments: 12, directLinks: lessons.length, fullTextSearch: true, matchedSearchSnippets: true, neutralSearchFocus: true, actualAlitaLogo: true, noBoilerplate: true, styledMetricFunnel: true, semanticTables: true, completionWithNavigation: true, filters: true, selfCheck: true, progressReload: true, previousNext: true, internalAnchorNavigation: true, horizontalOverflow: false, pageErrors, consoleErrors, requestFailures });
    } catch (error) {
      await page.screenshot({ path: `${output}/knowledge-failed-${width}.png`, fullPage: true }).catch(() => {});
      writeFileSync(`${output}/failure-${width}.json`, JSON.stringify({ url: page.url(), error: error.message, pageErrors, consoleErrors, requestFailures, body: await page.locator("body").innerText().catch(() => "") }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  const report = { ok: true, url, results, screenshots: output, transport: process.env.CANTOR_BROWSER_VALIDATED_TRANSPORT === "1" ? "node-tls-verified" : "chromium" };
  writeFileSync(`${output}/result.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }

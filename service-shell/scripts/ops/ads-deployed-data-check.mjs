import { chromium } from "playwright";
import assert from "node:assert/strict";
import { setGlobalProxyFromEnv } from "node:http";
import { mkdirSync } from "node:fs";
setGlobalProxyFromEnv();
const base = "https://cantor-service-preview.oxion-ezhkov.workers.dev";
mkdirSync("/tmp/cantor-ads-deployed", { recursive: true });
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  const c = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await c.route(base + "/**", async (route) => {
    const q = route.request(),
      h = { ...q.headers() };
    delete h.host;
    const r = await fetch(q.url(), { headers: h, signal: AbortSignal.timeout(60000) });
    const headers = Object.fromEntries(r.headers);
    for (const k of ["content-length", "content-encoding", "transfer-encoding"]) delete headers[k];
    await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
  });
  const p = await c.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.name));
  const live = p.waitForResponse((r) => r.url().includes("live?section=ads"), { timeout: 120000 });
  const autoload = p.waitForResponse((r) => r.url().includes("live?section=autoload"), {
    timeout: 120000,
  });
  await p.goto(base + "/?section=ads&focus=list");
  await p.getByLabel("Пароль", { exact: true }).fill(process.env.DASHBOARD_PASSWORD);
  await p.getByRole("button", { name: "Войти", exact: true }).click();
  await p.locator(".aw-table").waitFor();
  const res = await live;
  const data = await res.json();
  await autoload;
  const t = p.locator(".aw-list-view .aw-table");
  assert.equal(
    await t.getByRole("columnheader", { name: /Статус/ }).getAttribute("aria-sort"),
    "descending",
  );
  assert.ok(await t.locator("tbody tr").first().getByText("В публикации", { exact: true }).count());
  await p.waitForFunction(() => document.querySelector(".aw-list-view img")?.naturalWidth > 0);
  const shape = await t.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    rows: el.querySelectorAll("tbody tr").length,
    images: el.querySelectorAll("img").length,
    loaded: [...el.querySelectorAll("img")].filter((x) => x.naturalWidth > 0).length,
    viewsX: el.querySelector("thead th:nth-child(5)").getBoundingClientRect().right,
    window: innerWidth,
  }));
  assert.ok(shape.viewsX < shape.window, "views pushed off screen");
  assert.deepEqual(errors, []);
  await p.screenshot({ path: "/tmp/cantor-ads-deployed/list.png" });
  console.log(
    JSON.stringify({
      publishedFirst: true,
      statusDescending: true,
      ...shape,
      liveStatus: res.status(),
      liveError: data.error,
      sourceCode: data.sourceCode,
      origin: data.origin,
      hasLastGood: !!data.lastGood,
      errors,
    }),
  );
} finally {
  await b.close();
}

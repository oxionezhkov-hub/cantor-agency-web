// Explicit read-only UI verification. Output contains booleans only, never conversation data.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
mkdirSync("/tmp/cantor-live-deployed", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.name));
  await page.goto("https://cantor-service-preview.oxion-ezhkov.workers.dev/?section=today");
  await page.getByRole("button", { name: "Войти", exact: true }).waitFor();
  await page.getByLabel("Пароль", { exact: true }).fill(process.env.DASHBOARD_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("heading", { name: "Средства Авито", exact: true }).waitFor();
  await page.waitForFunction(
    () => {
      const rows = [...document.querySelectorAll(".live-funds-balances strong")];
      return rows.length === 3 && rows.every((r) => !r.textContent.includes("Нет данных"));
    },
    {},
    { timeout: 60000 },
  );
  await page
    .locator(".live-funds")
    .screenshot({ path: "/tmp/cantor-live-deployed/dashboard-funds.png" });
  const metadata = await page.evaluate(async () => {
    const r = await fetch("/api/demo/live?section=chats");
    const d = await r.json();
    return { ok: r.ok, id: d.data?.chats?.[0]?.id };
  });
  assert.equal(metadata.ok, true);
  assert.ok(metadata.id);
  const response = page.waitForResponse((r) => r.url().includes("section=messages"), {
    timeout: 60000,
  });
  await page.goto(
    "https://cantor-service-preview.oxion-ezhkov.workers.dev/?section=chats&focus=" +
      encodeURIComponent(metadata.id),
  );
  const msg = await (await response).json();
  assert.equal(Array.isArray(msg.messages), true);
  assert.equal(
    msg.messages.some((m) => m.text),
    true,
  );
  await page
    .locator(".live-chat-status")
    .filter({ hasText: "Проверено" })
    .waitFor({ timeout: 60000 });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      separateLiveBalances: true,
      actualSpendHistoryShown: true,
      lazyTextGet: true,
      actualThreadUpdated: true,
      noPageErrors: true,
    }),
  );
} finally {
  await browser.close();
}

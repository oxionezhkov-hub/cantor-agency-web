// Explicitly authorized read-only preview check. Never prints credentials or account data.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
const base = "https://cantor-service-preview.oxion-ezhkov.workers.dev";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
  });
  await page.goto(base + "/?section=acc");
  await page.getByRole("button", { name: "Войти", exact: true }).waitFor();
  if (await page.getByRole("button", { name: "Войти", exact: true }).count()) {
    await page.getByLabel("Пароль", { exact: true }).fill(process.env.DASHBOARD_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
  }
  await page.getByRole("button", { name: "Собрать отчёт Авито", exact: true }).click();
  await page.getByLabel("Допуск администратора").fill("wrong-synthetic-value");
  await page.getByRole("button", { name: "Начать сбор", exact: true }).click();
  await page.getByText("Нужен отдельный допуск администратора", { exact: false }).waitFor();
  await page
    .getByLabel("Допуск администратора")
    .fill(
      readFileSync(
        process.env.AVITO_AUDIT_ADMIN_FILE || "/tmp/cantor-avito-audit-admin.secret",
        "utf8",
      ),
    );
  const response = page.waitForResponse((r) =>
    r.url().includes("/api/demo/avito-audit?section=identity"),
  );
  await page.getByRole("button", { name: "Начать сбор", exact: true }).click();
  await page.getByRole("button", { name: "Приостановить", exact: true }).click();
  const result = await (await response).json();
  assert.equal(result.status, "available");
  assert.equal(result.summary.identityVerified, true);
  await page.getByText("Сбор приостановлен.", { exact: false }).waitFor();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать JSON", exact: true }).click();
  const file = await (await download).path();
  const report = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(report.sections[0].pages[0].status, "available");
  assert.doesNotMatch(JSON.stringify(report), /access_token|clientSecret/);
  // Do not capture the account profile or credentials. Report area contains only status metadata.
  await page.getByLabel("Допуск администратора").fill("");
  mkdirSync("/tmp/cantor-avito-live-check", { recursive: true });
  await page
    .locator(".st-avito-audit > .st-connection-fields")
    .screenshot({ path: "/tmp/cantor-avito-live-check/report.png" });
  console.log(
    JSON.stringify({
      ordinaryDenied: true,
      adminIdentityRead: true,
      partialDownload: true,
      paused: true,
    }),
  );
} finally {
  await browser.close();
}

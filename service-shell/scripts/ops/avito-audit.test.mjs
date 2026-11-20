import test from "node:test";
import assert from "node:assert/strict";
import { avitoAudit, ACCOUNT, WORKSPACE, project, retryDelay } from "./avito-audit.mjs";
const digest = async (text) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString(
    "hex",
  );
async function fixture(source) {
  return {
    DEMO_PASSWORD_SHA256: await digest("demo"),
    AVITO_AUDIT_ADMIN_SHA256: await digest("admin"),
    AVITO_AUDIT_GATE: "synthetic",
    AVITO_AUDIT_ENABLED: "dobrynina-read-v1",
    AVITO_AUDIT_USER_ID: "12345",
    AVITO_AUDIT_LIMIT: { limit: async () => ({ success: true }) },
    AVITO_AUDIT_SOURCE: { fetch: source },
  };
}
const req = (query = "section=items&page=0", extra = {}) =>
  new Request("https://preview.test/api/demo/avito-audit?" + query, {
    headers: { "x-demo-password": "demo", "x-avito-audit-password": "admin", ...extra },
  });
const response = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: { "x-cantor-account": ACCOUNT, "x-cantor-workspace": WORKSPACE, ...headers },
  });
test("default deny, demo login alone insufficient, fixed query and methods", async () => {
  let calls = 0;
  const env = await fixture(async () => {
    calls++;
    throw Error("secret");
  });
  assert.equal((await avitoAudit(req(), {})).status, 401);
  assert.equal(
    (await avitoAudit(req(undefined, { "x-avito-audit-password": "" }), env)).status,
    403,
  );
  for (const query of [
    "section=items&accountId=other",
    "section=raw&path=/token",
    "section=items&page=20",
    "section=identity&page=1",
    "section=items&section=chats",
  ])
    assert.equal((await avitoAudit(req(query), env)).status, 400);
  assert.equal((await avitoAudit(new Request(req(), { method: "POST" }), env)).status, 405);
  assert.equal((await avitoAudit(req(), { ...env, AVITO_AUDIT_SOURCE: null })).status, 503);
  assert.equal((await avitoAudit(req(), { ...env, AVITO_AUDIT_LIMIT: null })).status, 503);
  assert.equal(calls, 0);
});
test("bounded pages, redaction, attested identity, read-only paths", async () => {
  const seen = [];
  const env = await fixture(async (request) => {
    seen.push(request);
    return response({
      resources: Array.from({ length: 50 }, () => ({ id: 12, title: "PRIVATE", phone: "SECRET" })),
    });
  });
  const page = await (await avitoAudit(req(), env)).json();
  assert.equal(page.coverage.nextPage, 1);
  assert.equal(page.summary.records, 50);
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE|SECRET/);
  assert.equal(seen[0].method, "GET");
  assert.equal(new URL(seen[0].url).pathname, "/core/v1/items");
  const end = await (await avitoAudit(req("section=items&page=19"), env)).json();
  assert.equal(end.coverage.truncated, true);
  assert.equal(end.coverage.nextPage, null);
  const bad = await fixture(async () => Response.json({ token: "SECRET" }));
  const rejected = await (await avitoAudit(req(), bad)).json();
  assert.equal(rejected.error, "connection_mismatch");
  assert.doesNotMatch(JSON.stringify(rejected), /SECRET/);
});
test("retry capped transient errors; failed page resumes independently", async () => {
  let calls = 0;
  const waits = [];
  const env = await fixture(async () => {
    calls++;
    if (calls < 3) return response({}, 429, { "retry-after": "9999" });
    return response({ resources: [] });
  });
  const result = await (
    await avitoAudit(req("section=items&page=2"), env, { sleep: async (ms) => waits.push(ms) })
  ).json();
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 2000]);
  assert.equal(result.page, 2);
  assert.equal(result.status, "available");
  env.AVITO_AUDIT_SOURCE.fetch = async () => response({}, 503);
  const failed = await (
    await avitoAudit(req("section=items&page=3"), env, { sleep: async () => {} })
  ).json();
  assert.equal(failed.coverage.nextPage, 3);
  assert.equal(failed.status, "error");
  assert.equal(failed.attempts, 3);
  env.AVITO_AUDIT_SOURCE.fetch = async () => response({ resources: [] });
  assert.equal(
    (await (await avitoAudit(req("section=items&page=3"), env)).json()).status,
    "available",
  );
  assert.equal(retryDelay("999", 0), 2000);
});
test("no retry forbidden or malformed response; response size budget", async () => {
  let calls = 0;
  const env = await fixture(async () => {
    calls++;
    return response({ secret: "PRIVATE" }, 403);
  });
  const result = await (await avitoAudit(req(), env)).json();
  assert.equal(calls, 1);
  assert.equal(result.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  env.AVITO_AUDIT_SOURCE.fetch = async () =>
    response({ resources: [], payload: "x".repeat(270000) });
  assert.equal((await (await avitoAudit(req(), env)).json()).error, "response_budget");
  assert.deepEqual(project({ name: "PRIVATE", real: 12, bonus: 3, token: "SECRET" }, "balance"), {
    real: 12,
    bonus: 3,
  });
});

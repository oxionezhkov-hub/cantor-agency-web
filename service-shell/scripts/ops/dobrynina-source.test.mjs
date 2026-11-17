import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "./preview-worker.mjs";
const password = "test-password";
function fixture() {
  const reads = [];
  const records = {
    "aisales:index:6c974a5d5326": {
      lastSyncAt: 100,
      chats: {
        one: { chatId: "one", name: "Родитель", lastText: "Здравствуйте", secret: "never" },
      },
    },
    "aisales:chat:6c974a5d5326:one": {
      messages: [
        { id: "m", at: 100, text: "Здравствуйте", author: "client", type: "text", token: "never" },
      ],
      drafts: [{ secret: "never" }],
    },
    "mbids:catalog:6c974a5d5326": {
      at: 100,
      items: [{ id: "123", title: "Русский язык", city: "Москва", price: 1500, secret: "never" }],
    },
    "feedxml:elena-dobryinina-eba937":
      "<Ads><Ad><AvitoId>123</AvitoId><Description><![CDATA[<p>Урок русского языка</p>]]></Description><ContactPhone>never</ContactPhone><EMail>never</EMail></Ad></Ads>",
    "dailyMetrics:elena-dobrynina:2026-11-01": {
      projectId: "elena-dobrynina",
      date: "2026-11-01",
      budget: 100,
      views: 5,
      contacts: 1,
      diagnostics: 0,
      sales: 0,
      secret: "never",
    },
    "dailyMetrics:elena-dobrynina:2026-11-02": {
      projectId: "another-account",
      date: "2026-11-02",
      budget: 9999,
    },
  };
  const kv = {
    async get(key) {
      reads.push(key);
      return records[key] ?? null;
    },
    async list({ prefix, cursor }) {
      assert.equal(prefix, "dailyMetrics:elena-dobrynina:");
      return {
        keys: [{ name: `dailyMetrics:elena-dobrynina:2026-11-0${cursor ? 2 : 1}` }],
        list_complete: Boolean(cursor),
        cursor: cursor ? undefined : "next",
      };
    },
    put() {
      throw new Error("writes forbidden");
    },
    delete() {
      throw new Error("writes forbidden");
    },
  };
  return {
    reads,
    env: {
      DEMO_AVITO: kv,
      DEMO_DASHBOARD: kv,
      DEMO_PASSWORD_SHA256: createHash("sha256").update(password).digest("hex"),
    },
  };
}
function request(path, method = "GET", pass = password) {
  return new Request(`https://demo.test${path}`, {
    method,
    headers: pass ? { "x-demo-password": pass } : {},
  });
}
test("personal data requires authentication and cannot select another account", async () => {
  for (const pass of [null, "wrong"]) {
    const f = fixture();
    assert.equal(
      (await worker.fetch(request("/api/demo/bootstrap", "GET", pass), f.env)).status,
      401,
    );
    assert.equal(f.reads.length, 0);
  }
  const f = fixture();
  assert.equal(
    (await worker.fetch(request("/api/demo/bootstrap?accountId=other"), f.env)).status,
    400,
  );
  assert.equal(f.reads.length, 0);
  assert.equal((await worker.fetch(request("/api/demo/chat?id=not-owned"), f.env)).status, 404);
  assert.ok(!f.reads.some((k) => k.includes("not-owned")));
});
test("every mutation is denied before reading the source", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    const f = fixture();
    const r = await worker.fetch(request("/api/demo/bootstrap", method), f.env);
    assert.equal(r.status, 405);
    assert.equal(r.headers.get("allow"), "GET");
    assert.equal(f.reads.length, 0);
  }
});
test("bootstrap paginates and projects only Dobrynina public ad and metric fields", async () => {
  const f = fixture();
  const r = await worker.fetch(request("/api/demo/bootstrap"), f.env);
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store, private");
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  assert.equal(data.mode, "read-only");
  assert.equal(data.ads[0].description, "Урок русского языка\n");
  assert.equal(data.daily.length, 1);
  assert.ok(!JSON.stringify(data).includes("never"));
  assert.ok(!f.reads.some((k) => k.startsWith("account:") || k.startsWith("token:")));
});
test("chat projects messages without credentials, drafts or write side effects", async () => {
  const f = fixture();
  const r = await worker.fetch(request("/api/demo/chat?id=one"), f.env);
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.messages.length, 1);
  assert.ok(!JSON.stringify(data).includes("never"));
});
test("unavailable sources fail closed", async () => {
  const f = fixture();
  f.env.DEMO_AVITO.get = async () => {
    throw new Error("private detail");
  };
  const r = await worker.fetch(request("/api/demo/bootstrap"), f.env);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: "source_unavailable" });
});

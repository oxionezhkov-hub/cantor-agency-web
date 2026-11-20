import test from "node:test";
import assert from "node:assert/strict";
import source, { validateRead } from "./avito-audit-source.mjs";
const request = (path, init = {}) =>
  new Request("https://api.avito.ru" + path, {
    ...init,
    headers: {
      "x-cantor-audit-gate": "synthetic",
      "x-cantor-account": "6c974a5d5326",
      "x-cantor-workspace": "elena-dobrynina",
    },
  });
test("internal source pins connection and independently denies writes/raw/body injection", async () => {
  for (const path of [
    "/token",
    "/messenger/v1/accounts/388298238/chats/x/read",
    "/core/v1/items?per_page=50&page=21",
    "/core/v1/items?per_page=50&page=1&accountId=2",
    "/core/v1/accounts/999/balance/",
  ])
    assert.equal(await validateRead(request(path)), false);
  assert.equal(await validateRead(request("/core/v1/items?per_page=50&page=1")), true);
  assert.equal(await validateRead(request("/core/v1/accounts/self", { method: "POST" })), false);
  let calls = 0;
  const env = {
    AUDIT_GATE_SHA256: Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("synthetic")),
    ).toString("hex"),
    SOURCE_LIMIT: { limit: async () => ({ success: true }) },
    AUDIT_CONNECTION_KV: {
      get: async (key) => {
        assert.equal(key, "account:6c974a5d5326");
        return {
          id: "6c974a5d5326",
          userId: "388298238",
          clientId: "synthetic-id",
          clientSecret: "synthetic-secret",
        };
      },
    },
    testFetch: async (url, init) => {
      calls++;
      assert.equal(url.origin, "https://functions.yandexcloud.net");
      assert.equal(url.searchParams.get("p"), "/avito-call/core/v1/accounts/self");
      assert.equal(init.method, "GET");
      return Response.json({ id: 388298238 });
    },
  };
  assert.equal((await source.fetch(request("/core/v1/accounts/self"), {})).status, 403);
  assert.equal(
    (await source.fetch(request("/core/v1/accounts/self"), { ...env, SOURCE_LIMIT: null })).status,
    503,
  );
  assert.equal((await source.fetch(request("/core/v1/accounts/self"), env)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await source.fetch(request("/token"), env)).status, 403);
  assert.equal(calls, 1);
  env.AUDIT_CONNECTION_KV.get = async () => ({ id: "different", userId: "388298238" });
  assert.equal((await source.fetch(request("/core/v1/accounts/self"), env)).status, 503);
  assert.equal(calls, 1);
});

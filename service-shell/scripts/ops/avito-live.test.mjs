import test from "node:test";
import assert from "node:assert/strict";
import { liveRead, collect, mapMessage } from "./avito-live.mjs";
import { validateRead } from "./avito-live-direct.mjs";
const hash = async (s) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");
const req = (q) =>
  new Request("https://preview.test/api/demo/live?" + q, {
    headers: { "x-demo-password": "test" },
  });
const headers = { "x-cantor-account": "6c974a5d5326", "x-cantor-workspace": "elena-dobrynina" };
test("live denies anonymous, writes and arbitrary parameters before network", async () => {
  const env = { DEMO_PASSWORD_SHA256: await hash("test") };
  assert.equal(
    (await liveRead(new Request("https://preview.test/api/demo/live?section=ads"), env)).status,
    401,
  );
  assert.equal(
    (await liveRead(new Request(req("section=ads"), { method: "POST" }), env)).status,
    405,
  );
  assert.equal((await liveRead(req("section=ads&account=other"), env)).status, 400);
});
test("last good cache survives error with origin; fresh cache avoids source", async () => {
  let calls = 0;
  const old = {
    section: "ads",
    observedAt: new Date(Date.now() - 500000).toISOString(),
    data: { ads: [{ id: "1" }] },
  };
  const env = {
    DEMO_PASSWORD_SHA256: await hash("test"),
    LIVE_READ_ENABLED: "direct-v1",
    LIVE_READ_GATE: "synthetic",
    LIVE_READ_LIMIT: { limit: async () => ({ success: true }) },
    DEMO_DATA: {
      get: async () => old,
      put: async () => {
        throw Error("must not write failure");
      },
    },
    LIVE_READ_SOURCE: {
      fetch: async () => {
        calls++;
        return Response.json(
          {},
          {
            status: 429,
            headers: { ...headers, "x-cantor-error-origin": "source_limiter", "retry-after": "60" },
          },
        );
      },
    },
  };
  const r = await (await liveRead(req("section=ads"), env)).json();
  assert.equal(r.error, "http_429");
  assert.equal(r.origin, "source_limiter");
  assert.deepEqual(r.lastGood, old);
  assert.equal(calls, 1);
  old.observedAt = new Date().toISOString();
  assert.equal((await (await liveRead(req("section=ads"), env)).json()).cached, true);
  assert.equal(calls, 1);
});
test("bounded list detects repeated page IDs instead of claiming uniqueness", async () => {
  let calls = 0;
  const env = {
    LIVE_READ_ENABLED: "direct-v1",
    LIVE_READ_GATE: "synthetic",
    LIVE_READ_SOURCE: {
      fetch: async () => {
        calls++;
        return Response.json(
          {
            resources: Array.from({ length: 50 }, (_, i) => ({
              id: i,
              title: "item",
              status: "active",
            })),
          },
          { headers },
        );
      },
    },
  };
  const r = await collect(env, "ads");
  assert.equal(calls, 2);
  assert.equal(r.coverage.repeated, true);
  assert.equal(r.coverage.complete, false);
  assert.equal(r.ads.length, 50);
});
test("message read with real tilde syntax allowed; no mark-read or sends", async () => {
  const base = { headers: { ...headers, "content-type": "application/json" } };
  const path = "/messenger/v3/accounts/388298238/chats/u2i~123/messages/?limit=50&offset=0";
  assert.equal(await validateRead(new Request("https://api.avito.ru" + path, base)), true);
  assert.equal(
    await validateRead(
      new Request("https://api.avito.ru/messenger/v1/accounts/388298238/chats/u2i~123/read", {
        ...base,
        method: "POST",
        body: "{}",
      }),
    ),
    false,
  );
  const mapped = mapMessage({
    id: "1",
    created: 1700000000,
    author_id: "388298238",
    type: "text",
    content: { text: "synthetic" },
  });
  assert.equal(mapped.author, "manager");
  assert.equal(mapped.text, "synthetic");
});

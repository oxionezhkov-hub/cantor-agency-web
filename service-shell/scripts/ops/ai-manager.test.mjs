import test from "node:test";
import assert from "node:assert/strict";
import { aiManager } from "./ai-manager.mjs";
test("settings read only allowlisted source fields and generation uses only AI binding", async () => {
  let run = 0;
  const env = {
    DEMO_AVITO: {
      get: async () => ({ system: "Настройки", knowledge: "База", apiKey: "never exposed" }),
    },
    AI: {
      run: async (model, input) => {
        run++;
        assert.match(input.messages[0].content, /База/);
        return { response: "Когда Вам удобно встретиться?" };
      },
    },
  };
  const get = await aiManager(new Request("https://test/api/demo/ai-manager"), env, {}),
    d = await get.json();
  assert.equal(JSON.stringify(d).includes("never exposed"), false);
  const r = await aiManager(
    new Request("https://test/api/demo/ai-manager", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: d.settings,
        messages: [{ role: "user", content: "Здравствуйте" }],
      }),
    }),
    env,
    {},
  );
  assert.equal(r.status, 200);
  assert.equal(run, 2);
  const bad = await aiManager(
    new Request("https://test/api/demo/ai-manager", {
      method: "POST",
      body: JSON.stringify({ settings: { ...d.settings, model: "foreign" }, messages: [] }),
    }),
    env,
    {},
  );
  assert.equal(bad.status, 400);
  assert.equal(run, 2);
});

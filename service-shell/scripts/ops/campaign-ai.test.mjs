import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignSuggestion } from "./campaign-ai.mjs";
const password = "test-only-password";
const digest = Buffer.from(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
).toString("hex");
const request = (body, auth = true, origin = "https://preview.test") =>
  new Request("https://preview.test/api/demo/campaign/suggest", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(auth ? { "x-demo-password": password } : {}),
    },
    body: JSON.stringify(body),
  });
const input = { facts: "Математика, онлайн, 5–9 классы.", title: "", text: "", count: 2 };
let calls = 0;
const env = {
  DEMO_PASSWORD_SHA256: digest,
  CAMPAIGN_LIMIT: { limit: async () => ({ success: true }) },
  AI: {
    run: async () => {
      calls++;
      return {
        response: JSON.stringify({
          variants: [
            { title: "Занятия математикой", text: "Математика онлайн для 5–9 классов." },
            { title: "Математика онлайн", text: "Занятия для учеников 5–9 классов." },
          ],
        }),
      };
    },
  },
};
test("AI route authenticates before inference and checks origin and input", async () => {
  assert.equal((await campaignSuggestion(request(input, false), env)).status, 401);
  assert.equal(
    (await campaignSuggestion(request(input, true, "https://other.test"), env)).status,
    403,
  );
  assert.equal((await campaignSuggestion(request({ ...input, count: 100 }), env)).status, 400);
  assert.equal(calls, 0);
});
test("AI validates response, propagates quota and never substitutes mock content", async () => {
  const r = await campaignSuggestion(request(input), env);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).variants.length, 2);
  assert.equal(
    (
      await campaignSuggestion(request(input), {
        ...env,
        CAMPAIGN_LIMIT: { limit: async () => ({ success: false }) },
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await campaignSuggestion(request(input), {
        ...env,
        AI: { run: async () => ({ response: "invalid" }) },
      })
    ).status,
    502,
  );
});

test("guided draft keeps unknown settings unknown and image generation respects auth", async () => {
  const draft = {
    action: "draft",
    request: "Уроки русского онлайн",
    template: false,
    examples: [],
  };
  const guided = {
    ...env,
    AI: {
      run: async () => ({
        response: { title: "Уроки русского", text: "Онлайн-занятия.", cities: [], price: null },
      }),
    },
  };
  const response = await campaignSuggestion(request(draft), guided);
  assert.deepEqual((await response.json()).draft, {
    title: "Уроки русского",
    text: "Онлайн-занятия.",
    cities: [],
    price: null,
  });
  const image = { action: "image", title: "Русский язык", text: "Онлайн-занятия", note: "" };
  const visuals = {
    ...env,
    AI: {
      run: async (model) => {
        assert.match(model, /flux/);
        return { image: "/9j/2Q==" };
      },
    },
  };
  assert.equal((await campaignSuggestion(request(image, false), visuals)).status, 401);
  assert.equal(
    (await (await campaignSuggestion(request(image), visuals)).json()).image,
    "data:image/jpeg;base64,/9j/2Q==",
  );
});

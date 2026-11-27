import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { isCommentRoute, workspaceComments } from "./workspace-comments.mjs";

function testDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./comment-migrations/0001_comments.sql", import.meta.url), "utf8"));
  return {
    close: () => db.close(),
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...parameters) {
          const values = parameters.map((value) =>
            value instanceof ArrayBuffer ? new Uint8Array(value) : value,
          );
          return {
            first: async () => statement.get(...values),
            run: async () => statement.run(...values),
            all: async () => ({ results: statement.all(...values) }),
          };
        },
      };
    },
  };
}
async function fixture(t) {
  const workspace = "synthetic-workspace";
  const employee = {
    role: "tester",
    workspaceId: workspace,
    employeeId: "employee-1",
    name: "Тестировщик",
    sessionId: "session-1",
  };
  const db = testDb();
  t.after(() => db.close());
  const password = crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  const env = {
    TEST_COMMENTS_DB: db,
    CABINET_SOURCE_MODE: "synthetic",
    COMMENTER_PASSWORD_SHA256: Buffer.from(digest).toString("hex"),
  };
  const root = "/api/cabinet/comments";
  const admin = "/api/admin/comments";
  const origin = "https://synthetic.example";
  async function send(
    path,
    method = "GET",
    { identity = employee, cookie, body, sameOrigin = true } = {},
  ) {
    const headers = new Headers();
    if (method !== "GET" && sameOrigin) headers.set("origin", origin);
    if (cookie) headers.set("cookie", cookie);
    if (body && !(body instanceof FormData)) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(body);
    }
    return workspaceComments(
      new Request(origin + path, { method, headers, body }),
      env,
      async () => identity,
    );
  }
  const unlock = (identity = employee) =>
    send(root + "/mode", "POST", { identity, body: { password } });
  const owner = { role: "owner" };
  return { employee, owner, root, admin, send, unlock, env };
}
function form(data, files = {}) {
  const payload = new FormData();
  payload.set(
    "comment",
    JSON.stringify({
      id: crypto.randomUUID(),
      section: "today",
      text: "",
      target: { anchor: "dashboard-summary", path: "button:nth-child(1)", x: 0.25, y: 0.5 },
      ...data,
    }),
  );
  for (const [name, file] of Object.entries(files)) payload.set(name, file);
  return payload;
}
const cookieFor = (response) => response.headers.get("set-cookie")?.split(";")[0];

test("comment routes require current tester membership, distinct password, and same Origin", async (t) => {
  const { employee, send, root, admin, unlock } = await fixture(t);
  assert.ok(isCommentRoute(`${root}/mode`));
  assert.ok(isCommentRoute(admin));
  assert.ok(!isCommentRoute("/api/admin/commentsother"));
  assert.equal((await send(root + "/mode", "GET", { identity: null })).status, 401);
  assert.equal(
    (await send(root + "/mode", "GET", { identity: { ...employee, mustChangePassword: true } }))
      .status,
    401,
  );
  assert.equal((await send(admin)).status, 401);
  assert.equal((await send(root)).status, 403);
  assert.deepEqual(await (await send(root + "/mode")).json(), {
    ok: true,
    available: true,
    enabled: false,
    screenshotsAllowed: true,
  });
  assert.equal(
    (await send(root + "/mode", "POST", { body: { password: "wrong" }, sameOrigin: false })).status,
    403,
  );
  assert.equal((await send(root + "/mode", "POST", { body: { password: "wrong" } })).status, 403);
  const access = await unlock();
  assert.match(access.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);
  const cookie = cookieFor(access);
  assert.equal((await send(root, "GET", { cookie })).status, 200);
  for (const patch of [{ sessionId: "other" }, { workspaceId: "other" }, { employeeId: "other" }]) {
    assert.equal(
      (await send(root, "GET", { cookie, identity: { ...employee, ...patch } })).status,
      403,
    );
  }
  const cleared = await send(root + "/mode", "DELETE", { cookie });
  assert.match(cleared.headers.get("set-cookie"), /Max-Age=0/);
  for (let index = 0; index < 10; index++)
    assert.equal((await send(root + "/mode", "POST", { body: { password: "wrong" } })).status, 403);
  assert.equal((await unlock()).status, 429);
});

test("saving text and media is idempotent, scoped, and independent of Whisper", async (t) => {
  const { employee, owner, send, root, admin, unlock, env } = await fixture(t);
  const cookie = cookieFor(await unlock());
  const id = crypto.randomUUID();
  const audio = new Uint8Array([1, 2, 3]);
  const screenshot = new Uint8Array([255, 216, 255, 218, 255, 217]);
  const now = Date.now();
  const data = form(
    {
      id,
      text: "Проверка",
      author: "fake",
      workspaceId: "other",
      diagnostics: [
        { kind: "runtime_error", at: now, message: "private" },
        { kind: "anything", at: now },
        { kind: "resource_error", at: 0 },
      ],
    },
    {
      audio: new Blob([audio], { type: "audio/webm" }),
      screenshot: new Blob([screenshot], { type: "image/jpeg" }),
    },
  );
  for (const body of [data, form({ id, text: "Дубль" })])
    assert.equal((await send(root, "POST", { cookie, body })).status, 201);
  const list = await (await send(root, "GET", { cookie })).json();
  assert.equal(list.comments.length, 1);
  const stored = list.comments[0];
  assert.deepEqual(
    { ...stored, createdAt: null },
    {
      author: employee.name,
      createdAt: null,
      diagnostics: [{ at: now, kind: "runtime_error" }],
      hasAudio: true,
      hasScreenshot: true,
      id,
      section: "today",
      status: "new",
      target: { anchor: "dashboard-summary", path: "button:nth-child(1)", x: 0.25, y: 0.5 },
      text: "Проверка",
      transcript: null,
      transcriptionStatus: "pending",
      workspaceId: employee.workspaceId,
    },
  );
  assert.equal((await send(`${admin}/${id}/audio`)).status, 401);
  const outsider = { ...employee, workspaceId: "other" };
  const otherCookie = cookieFor(await unlock(outsider));
  assert.equal(
    (await send(`${root}/${id}/screenshot`, "GET", { cookie, identity: outsider })).status,
    403,
  );
  assert.equal(
    (await send(`${root}/${id}/screenshot`, "GET", { cookie: otherCookie, identity: outsider }))
      .status,
    404,
  );
  const foreignList = await send(`${root}?workspace=${employee.workspaceId}`, "GET", {
    cookie: otherCookie,
    identity: outsider,
  });
  assert.deepEqual((await foreignList.json()).comments, []);
  for (const [name, bytes] of [
    ["audio", audio],
    ["screenshot", screenshot],
  ]) {
    const result = await send(`${admin}/${id}/${name}`, "GET", { identity: owner });
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
    assert.match(result.headers.get("cache-control"), /no-store/);
  }
  assert.equal(
    (await send(`${admin}/${id}`, "PATCH", { identity: owner, body: { status: "in_progress" } }))
      .status,
    200,
  );
  const filtered = await (
    await send(
      `${admin}?workspace=${employee.workspaceId}&status=in_progress&section=today`,
      "GET",
      { identity: owner },
    )
  ).json();
  assert.equal(filtered.comments.length, 1);
  const transcript = `${admin}/${id}/transcribe`;
  assert.equal((await send(transcript, "POST", { identity: owner })).status, 503);
  env.AI = {
    async run() {
      throw new Error("temporary failure");
    },
  };
  assert.equal((await send(transcript, "POST", { identity: owner })).status, 502);
  env.AI = {
    async run(model, { audio: received }) {
      assert.equal(model, "@cf/openai/whisper");
      assert.deepEqual(received, [1, 2, 3]);
      return { text: "Тестовая расшифровка" };
    },
  };
  assert.equal((await send(transcript, "POST", { identity: owner })).status, 200);
  assert.equal((await send(transcript, "POST", { identity: owner })).status, 409);
  assert.equal(
    (await (await send(admin, "GET", { identity: owner })).json()).comments[0].transcript,
    "Тестовая расшифровка",
  );
});

test("screenshots are dropped in sensitive sections and malformed targets are rejected", async (t) => {
  const { send, root, unlock, env } = await fixture(t);
  const cookie = cookieFor(await unlock());
  const screenshot = new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" });
  for (const section of ["acc", "chats"]) {
    const saved = await send(root, "POST", {
      cookie,
      body: form({ section, text: "Проверка" }, { screenshot }),
    });
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).comment.hasScreenshot, false);
  }
  env.CABINET_SOURCE_MODE = "avito";
  const restricted = await send(root, "POST", {
    cookie,
    body: form({ section: "today", text: "Проверка" }, { screenshot }),
  });
  assert.equal(restricted.status, 201);
  assert.equal((await restricted.json()).comment.hasScreenshot, false);
  const invalid = await send(root, "POST", {
    cookie,
    body: form({
      text: "Проверка",
      target: { anchor: "private token", path: "a[href]", x: 0, y: 0 },
    }),
  });
  assert.equal(invalid.status, 400);
});

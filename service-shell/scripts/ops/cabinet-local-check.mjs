import assert from "node:assert/strict";

const base = new URL(process.env.CABINET_TEST_URL ?? "http://127.0.0.1:8831");
const password = process.env.CABINET_TEST_OWNER_PASSWORD;
assert(password, "Set CABINET_TEST_OWNER_PASSWORD for the synthetic Worker");
const cookieFor = (response) => response.headers.get("set-cookie")?.split(";")[0];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(path, { cookie, body, status = 200, origin = base.origin } = {}) {
  const response = await fetch(new URL(path, base), {
    headers: {
      ...(cookie && { cookie }),
      ...(body && { "content-type": "application/json", origin }),
    },
    ...(body && { method: "POST", body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(response.status, status, `${path} (${data.error || "unexpected status"})`);
  return { data, cookie: cookieFor(response) };
}

const root = "/api/admin/cabinets";
await request(root, { status: 401 });
await request("/api/admin/login", {
  body: { password },
  origin: "https://example.com",
  status: 403,
});
const owner = (await request("/api/admin/login", { body: { password } })).cookie;
const inventory = (await request(root, { cookie: owner })).data.accounts;
assert.equal(inventory.find(({ id }) => id === "000000000101").source, "synthetic");
assert(inventory.every((account) => !("clientId" in account) && !("clientSecret" in account)));
const suffix = Date.now().toString().slice(-9);
const added = (
  await request(root, {
    cookie: owner,
    status: 201,
    body: {
      name: "Тест добавления",
      userId: "9" + suffix,
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
    },
  })
).data.account;
assert.equal(added.configured, true);
assert(!("clientSecret" in added));

const workspace = "000000000101";
const other = "000000000102";
const endpoint = root + "/" + workspace;
const first = await request(endpoint + "/activate", { cookie: owner, body: {} });
const second = await request(endpoint + "/activate", { cookie: owner, body: {} });
assert.equal(first.data.cabinet.startedAt, second.data.cabinet.startedAt);
assert.equal(second.data.replayed, true);

const login = "fixture-" + suffix;
const issued = (
  await request(endpoint + "/employees", {
    cookie: owner,
    body: { name: "Тест сотрудника", login },
  })
).data;
assert.equal(issued.employee.role, "tester");
const attempt = (id, value, status) =>
  request("/api/cabinet/login", {
    body: { workspaceId: id, login, password: value },
    status,
  });
await attempt(other, issued.temporaryPassword, 401);
const provisional = await attempt(workspace, issued.temporaryPassword, 200);
assert.equal(provisional.data.mustChangePassword, true);
await request("/api/cabinet/bootstrap", { cookie: provisional.cookie, status: 403 });
const personal = "local-synthetic-password-change";
const session = await request("/api/cabinet/password", {
  cookie: provisional.cookie,
  body: { password: personal },
});
assert.equal(session.data.mustChangePassword, false);
await request("/api/admin/session", { cookie: session.cookie, status: 401 });
await request("/api/cabinet/bootstrap", { cookie: provisional.cookie, status: 401 });
await attempt(workspace, issued.temporaryPassword, 401);

let job = first.data.cabinet;
for (let i = 0; i < 65 && job.status !== "ready"; i++) {
  await wait(1000);
  job = (await request(endpoint, { cookie: owner })).data.cabinet;
  assert.notEqual(job.status, "failed", job.error);
}
assert.equal(job.status, "ready");
const snapshot = await request("/api/cabinet/bootstrap?workspaceId=" + other, {
  cookie: session.cookie,
});
assert.equal(snapshot.data.workspaceId, workspace);
assert.equal(snapshot.data.ads[0].id, "10101");
assert.equal(snapshot.data.chats[0].id, "synthetic-chat-101");
assert.equal(snapshot.data.balance.real, 1200);
const chat = await request("/api/cabinet/chat?id=synthetic-chat-101", { cookie: session.cookie });
assert.equal(chat.data.messages.length, 1);
await request("/api/cabinet/chat?id=synthetic-chat-102", { cookie: session.cookie, status: 404 });

const reset = await request(endpoint + "/reset", {
  cookie: owner,
  body: { employeeId: issued.employee.id },
});
assert.notEqual(reset.data.temporaryPassword, issued.temporaryPassword);
await request("/api/cabinet/session", { cookie: session.cookie, status: 401 });
await attempt(workspace, personal, 401);
const fresh = await attempt(workspace, reset.data.temporaryPassword, 200);
await request(endpoint + "/revoke", { cookie: owner, body: { employeeId: issued.employee.id } });
await request("/api/cabinet/session", { cookie: fresh.cookie, status: 401 });
await attempt(workspace, reset.data.temporaryPassword, 401);
console.log(
  "Synthetic cabinet check passed: inventory, setup, idempotent activation, background import, scope, rotation, reset and revoke.",
);

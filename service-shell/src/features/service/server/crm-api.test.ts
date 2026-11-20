import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createCrmRepository, type CrmSql } from "./repository.server.ts";
import { createCrmHttpHandler } from "./http.server.ts";
import type { CrmState } from "../crm.ts";

const migration = await readFile(
  new URL("../../../../migrations/0002_service_crm.sql", import.meta.url),
  "utf8",
);
const now = "2026-11-16T11:00:00.000Z";
let pg: PGlite;
const sql: CrmSql = {
  query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
};
const repo = createCrmRepository(sql);
before(async () => {
  pg = new PGlite();
  await pg.exec(migration);
});
after(async () => {
  await pg.close();
});
let sequence = 0;
async function fixture() {
  const workspaceId = `workspace-${++sequence}`;
  const state: CrmState = {
    version: 1,
    workspaceId,
    students: [
      { id: "student-1", name: "Саша" },
      { id: "student-2", name: "Саша" },
    ],
    leads: [
      { id: "lead-1", studentId: "student-1", name: "Родитель 1", adId: null, createdAt: now },
      { id: "lead-2", studentId: "student-2", name: "Родитель 2", adId: null, createdAt: now },
    ],
    appointments: [],
    payments: [],
    refunds: [],
    events: [],
  };
  await sql.query(`INSERT INTO service_crm_workspaces(id,state) VALUES ($1,$2::jsonb)`, [
    workspaceId,
    JSON.stringify(state),
  ]);
  for (const [user, role] of [
    ["alice", "owner"],
    ["curator", "curator"],
    ["viewer", "viewer"],
  ])
    await sql.query(
      `INSERT INTO service_crm_memberships(workspace_id,user_id,role) VALUES ($1,$2,$3)`,
      [workspaceId, user, role],
    );
  const handler = createCrmHttpHandler({
    authenticate: async (request) => {
      const token = request.headers.get("authorization");
      return token?.startsWith("Bearer fixture-")
        ? { id: token.slice("Bearer fixture-".length) }
        : null;
    },
    repository: async () => repo,
    now: () => now,
  });
  const request = (body?: unknown, user = "alice", extra: Record<string, string> = {}) =>
    new Request(`https://service.test/api/service/crm?workspaceId=${workspaceId}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer fixture-${user}`,
        "content-type": "application/json",
        origin: "https://service.test",
        ...extra,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  return { workspaceId, state, handler, request };
}
const payment = (requestId = "payment-1", revision = 0, amountMinor = 123450) => ({
  revision,
  requestId,
  command: {
    type: "record_payment",
    studentId: "student-1",
    amountMinor,
    currency: "RUB",
    paidAt: now,
  },
});
const booking = (requestId = "booking-1", revision = 0, leadId = "lead-1") => ({
  revision,
  requestId,
  command: {
    type: "book_appointment",
    leadId,
    startsAt: "2026-11-17T10:00:00Z",
    endsAt: "2026-11-17T10:30:00Z",
  },
});

test("requires a verified session before touching storage; no userId/dev fallback", async () => {
  const f = await fixture();
  let touched = false;
  const handler = createCrmHttpHandler({
    authenticate: async () => null,
    repository: async () => {
      touched = true;
      return repo;
    },
  });
  for (const req of [
    new Request(`https://service.test/api/service/crm?workspaceId=${f.workspaceId}&userId=alice`),
    f.request({ ...payment(), userId: "alice" }),
  ])
    assert.equal((await handler(req)).status, 401);
  assert.equal(touched, false);
});
test("workspace membership isolates reads, payments, students and receipts", async () => {
  const a = await fixture(),
    b = await fixture();
  await sql.query(
    `UPDATE service_crm_memberships SET user_id='bob' WHERE workspace_id=$1 AND user_id='alice'`,
    [b.workspaceId],
  );
  assert.equal((await a.handler(a.request())).status, 200);
  const denied = await b.handler(b.request());
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), { error: "not_found" });
  assert.equal((await b.handler(b.request(payment()))).status, 404);
  assert.equal((await a.handler(a.request(payment()))).status, 200);
  const response = await b.handler(b.request(undefined, "bob"));
  assert.equal((await response.json()).state.payments.length, 0);
});
test("viewer can read but cannot mutate; curator is scoped; revoked rights apply", async () => {
  const f = await fixture();
  assert.equal((await f.handler(f.request(undefined, "viewer"))).status, 200);
  assert.equal((await f.handler(f.request(payment(), "viewer"))).status, 403);
  assert.equal((await f.handler(f.request(payment(), "curator"))).status, 200);
  await sql.query(
    `UPDATE service_crm_memberships SET active=false WHERE workspace_id=$1 AND user_id='curator'`,
    [f.workspaceId],
  );
  assert.equal((await f.handler(f.request(undefined, "curator"))).status, 404);
  assert.equal((await f.handler(f.request(payment(), "curator"))).status, 404);
});
test("atomic revisions prevent lost payments; explicit retry preserves both", async () => {
  const f = await fixture();
  const responses = await Promise.all([
    f.handler(f.request(payment("one"))),
    f.handler(f.request(payment("two", 0, 50050))),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const results = await Promise.all(responses.map((r) => r.json()));
  const loser = results.findIndex((r) => r.error === "revision_conflict");
  const retry = await f.handler(
    f.request(payment(loser === 0 ? "one" : "two", 1, loser === 0 ? 123450 : 50050)),
  );
  assert.equal(retry.status, 200);
  const final = await (await f.handler(f.request())).json();
  assert.equal(final.revision, 2);
  assert.equal(final.state.payments.length, 2);
  assert.equal(
    final.state.payments.reduce(
      (sum: number, p: { amountMinor: number }) => sum + p.amountMinor,
      0,
    ),
    173500,
  );
});
test("same request concurrent/repeated is one payment, with an atomic actor audit", async () => {
  const f = await fixture();
  const responses = await Promise.all([
    f.handler(f.request(payment())),
    f.handler(f.request(payment())),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  const results = await Promise.all(responses.map((r) => r.json()));
  assert.equal(results.filter((r) => r.replayed).length, 1);
  const repeated = await (await f.handler(f.request(payment()))).json();
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.revision, 1);
  assert.equal(repeated.state.payments.length, 1);
  const audit = await sql.query<{ actor_id: string; recorded_at: Date; revision: number }>(
    `SELECT actor_id,recorded_at,revision FROM service_crm_commands WHERE workspace_id=$1`,
    [f.workspaceId],
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, "alice");
  assert.equal(audit[0].revision, 1);
  assert.equal(new Date(audit[0].recorded_at).toISOString(), now);
  assert.equal((await f.handler(f.request(payment("payment-1", 1, 999)))).status, 409);
  assert.equal((await f.handler(f.request(payment(), "curator"))).status, 409);
});
test("concurrent slot requests have one winner; stale client cannot overwrite", async () => {
  const f = await fixture();
  const responses = await Promise.all([
    f.handler(f.request(booking("one"))),
    f.handler(f.request(booking("two", 0, "lead-2"))),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const data = await Promise.all(responses.map((r) => r.json()));
  const lost = data.findIndex((r) => r.error);
  const rejected = await f.handler(
    f.request(booking(lost === 0 ? "one" : "two", 1, lost === 0 ? "lead-1" : "lead-2")),
  );
  assert.equal(rejected.status, 422);
  const state = await repo.read(f.workspaceId, "alice");
  assert.equal(state?.state.appointments.length, 1);
  assert.equal(state?.revision, 1);
});
test("server owns IDs, time and audit; create lead, book, move, cancel, record payment", async () => {
  const f = await fixture();
  let r = await f.handler(
    f.request({
      revision: 0,
      requestId: "new",
      command: { type: "create_lead", name: "Мама", studentName: "Ребёнок", adId: null },
    }),
  );
  assert.equal(r.status, 200);
  let data = await r.json();
  assert.equal(data.state.leads.at(-1).createdAt, now);
  r = await f.handler(f.request({ ...booking("new-book", 1, "l-new") }));
  assert.equal(r.status, 200);
  const moved = {
    revision: 2,
    requestId: "move",
    command: {
      type: "reschedule_appointment",
      appointmentId: "apt-new-book",
      startsAt: "2026-11-18T11:00:00Z",
      endsAt: "2026-11-18T11:30:00Z",
    },
  };
  assert.equal((await f.handler(f.request(moved))).status, 200);
  assert.equal(
    (
      await f.handler(
        f.request({
          revision: 3,
          requestId: "finish",
          command: {
            type: "appointment_outcome",
            appointmentId: "apt-new-book",
            status: "completed",
          },
        }),
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await f.handler(
        f.request({
          revision: 3,
          requestId: "cancel",
          command: {
            type: "appointment_outcome",
            appointmentId: "apt-new-book",
            status: "cancelled",
          },
        }),
      )
    ).status,
    200,
  );
  r = await f.handler(
    f.request({ ...payment("new-pay", 4), command: { ...payment().command, studentId: "s-new" } }),
  );
  assert.equal(r.status, 200);
  data = await r.json();
  assert.equal(data.state.payments.at(-1).amountMinor, 123450);
  assert.equal(data.state.appointments[0].status, "cancelled");
  const keys = await sql.query(`SELECT * FROM service_crm_commands WHERE workspace_id=$1`, [
    f.workspaceId,
  ]);
  assert.equal(keys.length, 5);
});
test("rejects forged fields, currencies, future payments, wrong objects and malformed/large bodies", async () => {
  const f = await fixture();
  for (const body of [
    { ...payment(), userId: "bob" },
    { ...payment(), command: { ...payment().command, currency: "USD" } },
    { ...payment(), command: { ...payment().command, status: "completed" } },
    { ...payment(), requestId: "x".repeat(91) },
  ])
    assert.equal((await f.handler(f.request(body))).status, 400);
  assert.equal(
    (
      await f.handler(
        f.request({
          ...payment(),
          command: { ...payment().command, paidAt: "2027-01-01T00:00:00Z" },
        }),
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await f.handler(
        f.request({ ...payment(), command: { ...payment().command, studentId: "foreign" } }),
      )
    ).status,
    422,
  );
  assert.equal((await f.handler(f.request("{"))).status, 422);
  assert.equal((await f.handler(f.request(" ".repeat(17000)))).status, 413);
  assert.equal(
    (await f.handler(f.request(payment(), "alice", { "content-type": "text/plain" }))).status,
    415,
  );
  assert.equal((await repo.read(f.workspaceId, "alice"))?.revision, 0);
});
test("origin and sibling Fetch Metadata are rejected before authentication/storage", async () => {
  const f = await fixture();
  const origins: Record<string, string>[] = [
    { origin: "https://evil.test" },
    { "sec-fetch-site": "same-site" },
    { "sec-fetch-site": "cross-site" },
  ];
  for (const extra of origins)
    assert.equal((await f.handler(f.request(payment(), "alice", extra))).status, 403);
});
test("revocation between read and commit blocks mutation; does not leak a fresh snapshot", async () => {
  const f = await fixture();
  const handler = createCrmHttpHandler({
    authenticate: async () => ({ id: "alice" }),
    now: () => now,
    repository: async () => ({
      ...repo,
      commit: async (...args) => {
        await sql.query(
          `UPDATE service_crm_memberships SET active=false WHERE workspace_id=$1 AND user_id='alice'`,
          [f.workspaceId],
        );
        return repo.commit(...args);
      },
    }),
  });
  const response = await handler(f.request(payment()));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.equal((await repo.read(f.workspaceId, "curator"))?.revision, 0);
});
test("receipt failure rolls back state; SQL internals never escape", async () => {
  const f = await fixture();
  await sql.query(
    `INSERT INTO service_crm_commands(workspace_id,request_id,actor_id,payload,revision,recorded_at) VALUES ($1,'collision','alice','{}',1,$2)`,
    [f.workspaceId, now],
  );
  const response = await f.handler(f.request(payment()));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "service_unavailable" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await repo.read(f.workspaceId, "alice"))?.revision, 0);
  assert.equal((await repo.read(f.workspaceId, "alice"))?.state.payments.length, 0);
});
test("SQL state, roles and replay receipt survive database close/reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cantor-crm-db-"));
  let local: PGlite | undefined;
  try {
    local = new PGlite(dir);
    await local.exec(migration);
    const localSql: CrmSql = {
      query: async <T>(text: string, params: unknown[] = []) =>
        (await local!.query<T>(text, params)).rows,
    };
    const localRepo = createCrmRepository(localSql);
    const state: CrmState = {
      version: 1,
      workspaceId: "persistent",
      students: [{ id: "student-1", name: "Ученик" }],
      leads: [],
      appointments: [],
      payments: [],
      refunds: [],
      events: [],
    };
    await localSql.query(
      `INSERT INTO service_crm_workspaces(id,state) VALUES ('persistent',$1::jsonb)`,
      [JSON.stringify(state)],
    );
    await localSql.query(
      `INSERT INTO service_crm_memberships VALUES ('persistent','alice','owner',true)`,
    );
    const handler = createCrmHttpHandler({
      authenticate: async () => ({ id: "alice" }),
      repository: async () => localRepo,
      now: () => now,
    });
    const req = () =>
      new Request("https://service.test/api/service/crm?workspaceId=persistent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payment()),
      });
    assert.equal((await handler(req())).status, 200);
    await local.close();
    local = new PGlite(dir);
    const response = await handler(req());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.replayed, true);
    assert.equal(body.state.payments.length, 1);
    assert.equal(body.revision, 1);
  } finally {
    await local?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("replay reloads a snapshot when the receipt committed after initial read", async () => {
  const f = await fixture();
  let inject = true;
  const handler = createCrmHttpHandler({
    authenticate: async () => ({ id: "alice" }),
    now: () => now,
    repository: async () => ({
      ...repo,
      receipt: async (...args) => {
        if (inject) {
          inject = false;
          assert.equal((await f.handler(f.request(payment()))).status, 200);
        }
        return repo.receipt(...args);
      },
    }),
  });
  const response = await handler(f.request(payment()));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.replayed, true);
  assert.equal(body.revision, 1);
  assert.equal(body.state.payments.length, 1);
});
test("corrupt stored state is a server failure, never an empty success or a caller validation error", async () => {
  const f = await fixture();
  await sql.query(
    `UPDATE service_crm_workspaces SET state=jsonb_set(state,'{payments}','[{"id":"bad"}]') WHERE id=$1`,
    [f.workspaceId],
  );
  const response = await f.handler(f.request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "service_unavailable" });
});
test("role downgrade during command cannot bypass the membership check", async () => {
  const f = await fixture();
  const handler = createCrmHttpHandler({
    authenticate: async () => ({ id: "alice" }),
    now: () => now,
    repository: async () => ({
      ...repo,
      commit: async (...args) => {
        await sql.query(
          `UPDATE service_crm_memberships SET role='viewer' WHERE workspace_id=$1 AND user_id='alice'`,
          [f.workspaceId],
        );
        return repo.commit(...args);
      },
    }),
  });
  assert.equal((await handler(f.request(payment()))).status, 403);
  assert.equal((await repo.read(f.workspaceId, "curator"))?.revision, 0);
});

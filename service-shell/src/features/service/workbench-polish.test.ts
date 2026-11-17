import test from "node:test";
import assert from "node:assert/strict";
import { demoCrm, withDialogExamples } from "./crm-demo.ts";
import {
  moveLeadStage,
  leadHealth,
  applyEditedMessage,
  acceptDeliveredMessage,
  conversationMessages,
  disconnectedAdapter,
} from "./communication.ts";
import { leadProgress } from "./lead-workflow.ts";
import { periodMetrics, bookAppointment } from "./crm.ts";
import { createExampleAdapter } from "./sample-media.ts";
const metrics = (state = demoCrm) =>
  periodMetrics(state, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
const at = "2026-11-17T10:00:00Z",
  now = Date.parse(at);
test("examples upgrade existing local work without duplicate leads, tasks or overwriting edits", () => {
  const first = withDialogExamples(demoCrm);
  assert.equal(first.leads.length, demoCrm.leads.length + 5);
  const edited = {
    ...first,
    leads: first.leads.map((l) =>
      l.id === "example-price" ? { ...l, note: "important", draft: "my text" } : l,
    ),
  };
  assert.equal(withDialogExamples(edited), edited);
  assert.equal(
    withDialogExamples(edited).leads.find((l) => l.id === "example-price")?.draft,
    "my text",
  );
  const foreign = { ...demoCrm, workspaceId: "foreign" };
  assert.equal(withDialogExamples(foreign), foreign);
});
test("manual CRM stages never invent a completed appointment or payment; factual booking clears override", () => {
  let state = moveLeadStage(demoCrm, demoCrm.workspaceId, "igor", "student", at);
  assert.deepEqual(metrics(state), metrics(demoCrm));
  assert.equal(leadProgress(state, "igor", now).stage, "student");
  assert.equal(
    leadHealth(
      state,
      state.leads.find((l) => l.id === "igor")!,
      now,
    ).kind,
    "attention",
  );
  state = bookAppointment(
    state,
    state.workspaceId,
    {
      id: "booked-igor",
      leadId: "igor",
      startsAt: "2026-11-18T10:00:00Z",
      endsAt: "2026-11-18T10:30:00Z",
      status: "booked",
    },
    now,
  );
  assert.equal(leadProgress(state, "igor", now).stage, "booked");
  state = moveLeadStage(state, state.workspaceId, "igor", "closed", at);
  assert.equal(state.appointments.find((a) => a.id === "booked-igor")?.status, "cancelled");
  state = moveLeadStage(state, state.workspaceId, "igor", "after", at);
  assert.equal(state.leads.find((l) => l.id === "igor")?.closedAt, undefined);
  assert.equal(leadProgress(state, "igor", now).stage, "after");
  assert.throws(() => moveLeadStage(state, "foreign", "igor", "new", at));
});
test("CRM identifies overdue, missing-next-step, and scheduled work", () => {
  const state = withDialogExamples(demoCrm),
    health = (id: string) =>
      leadHealth(
        state,
        state.leads.find((l) => l.id === id)!,
        now,
      );
  assert.equal(health("example-result").kind, "overdue");
  assert.equal(health("kirill").kind, "missing");
  assert.equal(health("example-refusal").kind, "closed");
});
test("sample transport is local, scoped, idempotently accepted and edits replace instead of duplicate", async () => {
  const adapter = createExampleAdapter(demoCrm.workspaceId);
  const receipt = await adapter.send({
    requestId: "request",
    leadId: "igor",
    text: "hello",
    quoteId: "igor-source-2",
  });
  assert.equal(receipt.delivery, "local");
  let state = acceptDeliveredMessage(demoCrm, demoCrm.workspaceId, receipt, "request");
  state = acceptDeliveredMessage(state, state.workspaceId, receipt, "request");
  const count = conversationMessages(state, "igor").length;
  state = applyEditedMessage(state, state.workspaceId, await adapter.edit!(receipt, "corrected"));
  assert.equal(conversationMessages(state, "igor").length, count);
  assert.equal(conversationMessages(state, "igor").at(-1)?.text, "corrected");
  await assert.rejects(() => adapter.edit!({ ...receipt, author: "client" }, "hack"));
  await assert.rejects(() =>
    createExampleAdapter("foreign").send({ requestId: "x", leadId: "igor", text: "x" }),
  );
  await assert.rejects(
    () => disconnectedAdapter.send({ requestId: "x", leadId: "igor", text: "x" }),
    /не подключён/,
  );
});

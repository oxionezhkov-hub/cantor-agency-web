import { test } from "node:test";
import assert from "node:assert/strict";
import { demoCrm } from "./crm-demo.ts";
import {
  appointmentOutcome,
  bookAppointment,
  recordPayment,
  monthRangeMsk,
  periodMetrics,
} from "./crm.ts";
import {
  freeWindows,
  invitationFor,
  leadProgress,
  leadTimeline,
  saveLeadDraft,
  setLeadClosure,
} from "./lead-workflow.ts";
import { windows } from "./data.ts";
const now = Date.parse("2026-11-16T12:00:00Z");
test("actual events drive the journey from inquiry through meeting to repeat payment", () => {
  let state = structuredClone(demoCrm);
  assert.equal(leadProgress(state, "igor", now).stage, "new");
  state = bookAppointment(
    state,
    state.workspaceId,
    {
      id: "a-igor",
      leadId: "igor",
      startsAt: windows[0].startsAt,
      endsAt: "2026-11-17T14:30:00Z",
      status: "booked",
    },
    now,
  );
  assert.equal(leadProgress(state, "igor", now).stage, "booked");
  const after = Date.parse("2026-11-17T15:00:00Z");
  assert.equal(leadProgress(state, "igor", after).stage, "outcome");
  assert.equal(leadProgress(state, "igor", after).completed.length, 0);
  state = appointmentOutcome(
    state,
    state.workspaceId,
    "a-igor",
    "completed",
    new Date(after).toISOString(),
  );
  assert.equal(leadProgress(state, "igor", after).stage, "after");
  for (const [id, amountMinor] of [
    ["first", 123450],
    ["repeat", 5550],
  ] as const)
    state = recordPayment(state, state.workspaceId, {
      id,
      studentId: "student-igor",
      amountMinor,
      paidAt: new Date(after).toISOString(),
      requestId: id,
    });
  const progress = leadProgress(state, "igor", after);
  assert.equal(progress.stage, "student");
  assert.equal(progress.receivedMinor, 129000);
  const metrics = periodMetrics(state, ...monthRangeMsk(2026, 10));
  assert.equal(metrics.newStudents, 3);
  assert.equal(metrics.completedAppointments, 4);
  assert(leadTimeline(state, "igor").some((e) => e.text.includes("1 234,5")));
});
test("closing an inquiry cancels a booking, keeps payments/history and requires a reason", () => {
  let state = structuredClone(demoCrm);
  assert.throws(() =>
    setLeadClosure(state, state.workspaceId, "svetlana", " ", new Date(now).toISOString()),
  );
  state = setLeadClosure(
    state,
    state.workspaceId,
    "svetlana",
    "Выбрали другого преподавателя",
    new Date(now).toISOString(),
  );
  assert.equal(leadProgress(state, "svetlana", now).stage, "closed");
  assert.equal(state.appointments.find((a) => a.leadId === "svetlana")?.status, "cancelled");
  assert(freeWindows(state, windows, now).some((s) => s.id === "thu"));
  assert.throws(() =>
    bookAppointment(
      state,
      state.workspaceId,
      {
        id: "a-new",
        leadId: "svetlana",
        startsAt: windows[0].startsAt,
        endsAt: "2026-11-17T14:30:00Z",
        status: "booked",
      },
      now,
    ),
  );
  const count = state.events.length;
  state = setLeadClosure(
    state,
    state.workspaceId,
    "svetlana",
    "Повтор",
    new Date(now).toISOString(),
  );
  assert.equal(state.events.length, count);
  state = setLeadClosure(state, state.workspaceId, "svetlana", null, new Date(now).toISOString());
  assert.equal(leadProgress(state, "svetlana", now).stage, "new");
  assert(state.events.some((e) => e.type === "lead_closed"));
  assert(state.events.some((e) => e.type === "lead_reopened"));
  assert.equal(state.payments.length, 2);
});
test("drafts are scoped by lead ID and never mark an outgoing reply as delivered", () => {
  const state = saveLeadDraft(demoCrm, demoCrm.workspaceId, "igor", "Удобно в субботу?");
  assert.equal(state.leads.find((l) => l.id === "igor")?.draft, "Удобно в субботу?");
  assert.equal(state.leads.find((l) => l.id === "marina")?.draft, undefined);
  assert.equal(leadProgress(state, "igor", now).stage, "new");
  assert.deepEqual(state.events, demoCrm.events);
  assert.throws(() => saveLeadDraft(state, "foreign", "igor", "text"));
  assert.throws(() => saveLeadDraft(state, state.workspaceId, "igor", "x".repeat(5001)));
});
test("invitations use future free windows and do not reserve or invent availability", () => {
  const free = freeWindows(demoCrm, windows, now);
  assert(!free.some((s) => s.id === "thu"));
  assert.match(invitationFor(demoCrm, "igor", windows[2], windows, now), /21 ноября.*12:00/);
  assert.throws(() => invitationFor(demoCrm, "igor", windows[1], windows, now));
  assert.equal(demoCrm.appointments.length, 4);
  assert.equal(freeWindows(demoCrm, windows, Date.parse("2026-11-23T00:00:00Z")).length, 0);
});
test("closed status has priority, no-show is independent of conducted diagnostics", () => {
  const state = appointmentOutcome(
    demoCrm,
    demoCrm.workspaceId,
    "diagnostic-svetlana",
    "no_show",
    "2026-11-22T10:00:00Z",
  );
  assert.equal(
    leadProgress(state, "svetlana", Date.parse("2026-11-22T10:00:00Z")).stage,
    "no_show",
  );
  assert.equal(periodMetrics(state, ...monthRangeMsk(2026, 10)).completedAppointments, 3);
  const closed = setLeadClosure(
    state,
    state.workspaceId,
    "lead-ege",
    "Больше не занимается",
    new Date(now).toISOString(),
  );
  assert.equal(leadProgress(closed, "lead-ege", now).stage, "closed");
  assert.equal(periodMetrics(closed, ...monthRangeMsk(2026, 10)).newStudents, 2);
});

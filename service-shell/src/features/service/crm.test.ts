import test from "node:test";
import assert from "node:assert/strict";
import {
  appointmentOutcome,
  bookAppointment,
  monthRangeMsk,
  parseCrmState,
  parseMoneyInput,
  periodMetrics,
  recordPayment,
  recordRefund,
} from "./crm.ts";
import { demoCrm } from "./crm-demo.ts";
const range = monthRangeMsk(2026, 10);
const metrics = (state = demoCrm) => periodMetrics(state, ...range);
const payment = {
  id: "p-k",
  studentId: "student-kirill",
  amountMinor: 123450,
  paidAt: "2026-11-16T10:00:00Z",
  requestId: "request-k",
};
test("diagnostics are actual completed appointments and do not change with payments", () => {
  assert.equal(metrics().completedAppointments, 3);
  assert.equal(metrics().newStudents, 2);
  const next = recordPayment(demoCrm, demoCrm.workspaceId, payment);
  assert.equal(metrics(next).completedAppointments, 3);
  assert.equal(metrics(next).newStudents, 3);
  const twice = recordPayment(next, next.workspaceId, {
    ...payment,
    id: "p-k-2",
    requestId: "request-k-2",
  });
  assert.equal(metrics(twice).newStudents, 3);
  assert.equal(metrics(twice).receivedMinor, 960000 + 2 * 123450);
  assert.deepEqual(metrics(twice).unpaidStudentIds, []);
});
test("same display name represents separate students; same request does not create two payments", () => {
  const state = {
    ...demoCrm,
    students: demoCrm.students.map((item) => ({ ...item, name: "Александр" })),
  };
  const next = recordPayment(state, state.workspaceId, payment);
  assert.equal(metrics(next).newStudents, 3);
  assert.equal(recordPayment(next, next.workspaceId, payment), next);
  assert.throws(
    () => recordPayment(next, next.workspaceId, { ...payment, amountMinor: 1 }),
    /другой оплаты/,
  );
  assert.throws(
    () => recordPayment(next, "another-workspace", { ...payment, id: "new" }),
    /Нет доступа/,
  );
});
test("partial refund reduces revenue; full refund removes the active first payment without removing history", () => {
  let state = recordPayment(demoCrm, demoCrm.workspaceId, payment);
  state = recordRefund(state, state.workspaceId, {
    id: "r1",
    paymentId: payment.id,
    amountMinor: 23450,
    refundedAt: payment.paidAt,
    requestId: "refund1",
  });
  assert.equal(metrics(state).newStudents, 3);
  assert.equal(metrics(state).netReceivedMinor, 1060000);
  state = recordRefund(state, state.workspaceId, {
    id: "r2",
    paymentId: payment.id,
    amountMinor: 100000,
    refundedAt: payment.paidAt,
    requestId: "refund2",
  });
  assert.equal(metrics(state).newStudents, 2);
  assert.equal(metrics(state).completedAppointments, 3);
  assert.equal(state.payments.length, 3);
  assert.throws(
    () =>
      recordRefund(state, state.workspaceId, {
        id: "r3",
        paymentId: payment.id,
        amountMinor: 1,
        refundedAt: payment.paidAt,
        requestId: "refund3",
      }),
    /превышает/,
  );
});
test("repeat payment next month is not a new student; calendar boundaries use Moscow", () => {
  const october = { ...payment, paidAt: "2026-10-31T20:59:59Z" };
  let state = recordPayment(demoCrm, demoCrm.workspaceId, october);
  state = recordPayment(state, state.workspaceId, {
    ...payment,
    id: "repeat",
    requestId: "repeat",
  });
  assert.equal(metrics(state).newStudents, 2);
  assert.equal(metrics(state).receivedMinor, 1083450);
  assert.equal(range[0], "2026-10-31T21:00:00.000Z");
});
test("booking rejects overlaps, same lead twice and past slots; cancel frees a window", () => {
  const item = {
    id: "a-igor",
    leadId: "igor",
    startsAt: "2026-11-17T14:00:00Z",
    endsAt: "2026-11-17T14:30:00Z",
    status: "booked" as const,
  };
  const now = Date.parse("2026-11-16T10:00:00Z");
  let state = bookAppointment(demoCrm, demoCrm.workspaceId, item, now);
  assert.equal(metrics(state).completedAppointments, 3);
  assert.equal(bookAppointment(state, state.workspaceId, item, now), state);
  assert.throws(
    () =>
      bookAppointment(state, state.workspaceId, { ...item, id: "overlap", leadId: "marina" }, now),
    /уже занято/,
  );
  assert.throws(
    () =>
      bookAppointment(
        state,
        state.workspaceId,
        { ...item, id: "second", startsAt: "2026-11-18T14:00:00Z", endsAt: "2026-11-18T14:30:00Z" },
        now,
      ),
    /уже есть запись/,
  );
  assert.throws(
    () =>
      appointmentOutcome(state, state.workspaceId, item.id, "completed", "2026-11-17T14:01:00Z"),
    /ещё не закончилась/,
  );
  state = appointmentOutcome(
    state,
    state.workspaceId,
    item.id,
    "cancelled",
    "2026-11-17T13:00:00Z",
  );
  assert.equal(
    bookAppointment(
      state,
      state.workspaceId,
      { ...item, id: "after-cancel", leadId: "marina" },
      now,
    ).appointments.length,
    6,
  );
  assert.throws(
    () => bookAppointment(demoCrm, demoCrm.workspaceId, item, now + 10 * 86400000),
    /будущее/,
  );
});
test("no-show does not become a completed diagnostic; malformed saved relations are rejected", () => {
  const item = {
    id: "a-igor",
    leadId: "igor",
    startsAt: "2026-11-17T14:00:00Z",
    endsAt: "2026-11-17T14:30:00Z",
    status: "booked" as const,
  };
  let state = bookAppointment(
    demoCrm,
    demoCrm.workspaceId,
    item,
    Date.parse("2026-11-16T10:00:00Z"),
  );
  state = appointmentOutcome(state, state.workspaceId, item.id, "no_show", "2026-11-17T15:00:00Z");
  assert.equal(metrics(state).completedAppointments, 3);
  assert.throws(() => parseCrmState({ ...state, leads: [] }), /У заявки|У оплаты|Некорректная/);
});
test("amount input preserves kopecks and rejects rounding, exponent notation and negatives", () => {
  assert.equal(parseMoneyInput("1 234,50"), 123450);
  assert.equal(parseMoneyInput("0.01"), 1);
  for (const value of ["0", "-1", "12.345", "1e3", "", "NaN"])
    assert.equal(parseMoneyInput(value), null);
});
test("rescheduling frees the previous window and preserves the appointment history", async () => {
  const { rescheduleAppointment } = await import("./crm.ts");
  const now = Date.parse("2026-11-16T10:00:00Z");
  const slot = {
    id: "reschedule-igor",
    leadId: "igor",
    startsAt: "2026-11-17T14:00:00Z",
    endsAt: "2026-11-17T14:30:00Z",
    status: "booked" as const,
  };
  let state = bookAppointment(demoCrm, demoCrm.workspaceId, slot, now);
  state = rescheduleAppointment(
    state,
    state.workspaceId,
    slot.id,
    "2026-11-21T09:00:00Z",
    "2026-11-21T09:30:00Z",
    now,
  );
  assert.equal(state.appointments.length, 5);
  assert.equal(state.events.at(-1)?.type, "appointment_rescheduled");
  assert.equal(
    bookAppointment(
      state,
      state.workspaceId,
      { ...slot, id: "new-in-old-slot", leadId: "marina" },
      now,
    ).appointments.length,
    6,
  );
  assert.throws(
    () =>
      rescheduleAppointment(
        state,
        state.workspaceId,
        slot.id,
        "2026-11-19T16:00:00Z",
        "2026-11-19T16:30:00Z",
        now,
      ),
    /уже занято/,
  );
});
test("payment without diagnostic never fabricates a completed appointment", () => {
  const state = recordPayment(demoCrm, demoCrm.workspaceId, {
    ...payment,
    id: "direct",
    requestId: "direct",
    studentId: "student-olga",
  });
  assert.equal(metrics(state).newStudents, 3);
  assert.equal(metrics(state).completedAppointments, 3);
  assert.equal(state.leads.find((item) => item.id === "olga")?.adId, null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { demoCrm } from "./crm-demo.ts";
import { parseCrmState, paymentNet, recordRefund, updatePayment } from "./crm.ts";
import { buildAnalytics } from "./analytics-model.ts";
const input = {
  paymentId: "payment-ege",
  amountMinor: 525050,
  paidAt: "2026-11-11T12:00:00+03:00",
  changedAt: "2026-11-17T10:00:00Z",
};
const report = (crm = demoCrm) => buildAnalytics({ crm, from: "2026-11-01", to: "2026-11-16" });

test("payment correction preserves identity and updates daily receipts, not acquisition count", () => {
  const next = updatePayment(demoCrm, demoCrm.workspaceId, input);
  const payment = next.payments.find((p) => p.id === input.paymentId)!;
  assert.equal(payment.studentId, "student-ege");
  assert.equal(payment.requestId, "seed-ege");
  assert.equal(payment.amountMinor, 525050);
  assert.equal(next.events.at(-1)?.type, "payment_updated");
  assert.equal(report(next).crm?.receivedRub, 10050.5);
  assert.equal(report(next).crm?.newStudents, 2);
  assert.equal(report(next).crm?.daily.find((d) => d.date === "2026-11-10")?.receivedRub, 0);
  assert.equal(report(next).crm?.daily.find((d) => d.date === "2026-11-11")?.receivedRub, 5250.5);
  assert.equal(updatePayment(next, next.workspaceId, input), next);
  assert.equal(demoCrm.payments.find((p) => p.id === input.paymentId)?.amountMinor, 480000);
});

test("payment correction enforces scope, positive money, existing payment and valid dates", () => {
  assert.throws(() => updatePayment(demoCrm, "another", input), /Нет доступа/);
  assert.throws(
    () => updatePayment(demoCrm, demoCrm.workspaceId, { ...input, paymentId: "missing" }),
    /не найдена/,
  );
  for (const amountMinor of [0, -1, 1.2, 100000000])
    assert.throws(() => updatePayment(demoCrm, demoCrm.workspaceId, { ...input, amountMinor }));
  assert.throws(() =>
    updatePayment(demoCrm, demoCrm.workspaceId, { ...input, paidAt: "bad-date" }),
  );
  assert.throws(() =>
    updatePayment(demoCrm, demoCrm.workspaceId, { ...input, changedAt: "bad-date" }),
  );
});

test("correction cannot orphan a refund by reducing gross below refunded balance or moving payment later", () => {
  const partial = recordRefund(demoCrm, demoCrm.workspaceId, {
    id: "r-part",
    requestId: "r-part",
    paymentId: "payment-ege",
    amountMinor: 200000,
    refundedAt: "2026-11-12T10:00:00Z",
  });
  assert.throws(
    () => updatePayment(partial, partial.workspaceId, { ...input, amountMinor: 199999 }),
    /меньше/,
  );
  assert.throws(
    () => updatePayment(partial, partial.workspaceId, { ...input, paidAt: "2026-11-13T09:00:00Z" }),
    /позже/,
  );
  const corrected = updatePayment(partial, partial.workspaceId, { ...input, amountMinor: 200000 });
  assert.equal(
    paymentNet(
      corrected,
      corrected.payments.find((p) => p.id === "payment-ege")!,
    ),
    0,
  );
  assert.equal(report(corrected).crm?.newStudents, 1);
  assert.equal(corrected.refunds.length, 1);
});

test("partial then full refund of corrected payment survives serialization and reconciles analytics", () => {
  let state = updatePayment(demoCrm, demoCrm.workspaceId, input);
  state = recordRefund(state, state.workspaceId, {
    id: "r-one",
    requestId: "r-one",
    paymentId: "payment-ege",
    amountMinor: 125050,
    refundedAt: "2026-11-12T10:00:00Z",
  });
  state = recordRefund(state, state.workspaceId, {
    id: "r-two",
    requestId: "r-two",
    paymentId: "payment-ege",
    amountMinor: 400000,
    refundedAt: "2026-11-15T10:00:00Z",
  });
  const saved = parseCrmState(JSON.parse(JSON.stringify(state)));
  assert.equal(saved.refunds.length, 2);
  assert.equal(saved.events.filter((e) => e.type === "refund_recorded").length, 2);
  assert.equal(report(saved).crm?.receivedRub, 10050.5);
  assert.equal(report(saved).crm?.refundedRub, 5250.5);
  assert.equal(report(saved).crm?.netReceivedRub, 4800);
  assert.equal(report(saved).crm?.newStudents, 1);
  assert.throws(
    () =>
      recordRefund(saved, saved.workspaceId, {
        id: "r-over",
        requestId: "r-over",
        paymentId: "payment-ege",
        amountMinor: 1,
        refundedAt: "2026-11-16T10:00:00Z",
      }),
    /превышает/,
  );
});

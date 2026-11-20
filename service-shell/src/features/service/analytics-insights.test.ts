import test from "node:test";
import assert from "node:assert/strict";
import { demoCrm } from "./crm-demo.ts";
import { setLeadClosure } from "./lead-workflow.ts";
import { dialogueInsights, ltvEconomics, topRecommendations } from "./analytics-insights.ts";

test("recommendations rank the five largest groups without mutating the source", () => {
  const input = [1, 2, 8, 3, 7, 6, 4].map((count, i) => ({
    id: `r${i}`,
    title: "",
    action: "",
    leadId: "lead",
    count,
  }));
  assert.deepEqual(
    topRecommendations(input).map((item) => item.count),
    [8, 7, 6, 4, 3],
  );
  assert.deepEqual(
    input.map((item) => item.count),
    [1, 2, 8, 3, 7, 6, 4],
  );
});
import { acceptDeliveredMessage, updateLeadDetails } from "./communication.ts";
import { parseCrmState } from "./crm.ts";

test("economics leaves the exact 20% boundary neutral", () => {
  assert.deepEqual(ltvEconomics(28800, 2, 72000), {
    costRub: 14400,
    limitRub: 14400,
    sharePct: 20,
    atBoundary: true,
    works: null,
  });
  assert.equal(ltvEconomics(28801, 2, 72000).works, false);
  assert.equal(ltvEconomics(6420, 2, 72000).works, true);
  assert.equal(ltvEconomics(0, 2, 72000).works, true);
  assert.equal(ltvEconomics(2646.3, 3, 4410.5).atBoundary, true);
});
test("missing LTV, paying students or traffic coverage never creates an economics verdict", () => {
  for (const assessment of [
    ltvEconomics(6420, 0, 72000),
    ltvEconomics(6420, 2, null),
    ltvEconomics(6420, 2, 0),
    ltvEconomics(6420, 2, 72000, false),
    ltvEconomics(Infinity, 2, 72000),
    ltvEconomics(-1, 2, 72000),
  ]) {
    assert.equal(assessment.works, null);
    assert.equal(assessment.sharePct, null);
  }
});
test("refusal reasons come only from selected closed records, with honest empty data", () => {
  const none = dialogueInsights(
    demoCrm,
    demoCrm.leads.map((l) => l.id),
  );
  assert.deepEqual(none.refusalReasons, []);
  assert.equal(none.closedCount, 0);
  let state = setLeadClosure(
    demoCrm,
    demoCrm.workspaceId,
    "marina",
    " Не подходит  время ",
    "2026-11-17T09:00:00Z",
  );
  state = setLeadClosure(
    state,
    state.workspaceId,
    "igor",
    "Не подходит время",
    "2026-11-17T09:00:00Z",
  );
  const all = dialogueInsights(state, ["marina", "igor"]);
  assert.equal(all.refusalReasons.length, 1);
  assert.equal(all.refusalReasons[0].reason, "Не подходит время");
  assert.equal(all.refusalReasons[0].count, 2);
  assert.deepEqual(all.refusalReasons[0].leadIds, ["marina", "igor"]);
  assert.equal(dialogueInsights(state, ["olga"]).closedCount, 0);
});
test("recommendations link real pending records and exclude closed and paid leads", () => {
  const result = dialogueInsights(
    demoCrm,
    ["kirill", "lead-ege", "marina"],
    Date.parse("2026-11-17T09:00:00Z"),
  );
  const after = result.recommendations.find((r) => r.id === "diagnostic-payment")!;
  assert.equal(after.count, 1);
  assert.equal(after.leadId, "kirill");
  assert.equal(result.recommendations.find((r) => r.id === "reply")?.leadId, "marina");
  const closed = setLeadClosure(
    demoCrm,
    demoCrm.workspaceId,
    "marina",
    "Передумали",
    "2026-11-17T09:00:00Z",
  );
  assert.equal(
    dialogueInsights(closed, ["marina"]).recommendations.some((r) => r.id === "reply"),
    false,
  );
  assert.equal(dialogueInsights(demoCrm, []).recommendations.length, 0);
});

test("stored manager reply and stopped timer suppress stale reply recommendations", () => {
  const now = Date.parse("2026-11-17T09:00:00Z");
  const answered = acceptDeliveredMessage(
    demoCrm,
    demoCrm.workspaceId,
    {
      id: "analytics-answer",
      requestId: "analytics-answer",
      leadId: "marina",
      author: "manager",
      text: "Предлагаю выбрать время диагностики.",
      at: "2026-11-17T08:50:00Z",
      kind: "text",
    },
    "analytics-answer",
  );
  assert.equal(
    dialogueInsights(answered, ["marina"], now).recommendations.some((row) => row.id === "reply"),
    false,
  );
  const stopped = updateLeadDetails(demoCrm, demoCrm.workspaceId, "marina", { timerStopped: true });
  assert.equal(
    dialogueInsights(stopped, ["marina"], now).recommendations.some((row) => row.id === "reply"),
    false,
  );
});

test("silence recommendations use the actual last message and respect stopped timers", () => {
  const now = Date.parse("2026-11-17T09:00:00Z");
  const silent = (state: typeof demoCrm) =>
    dialogueInsights(state, ["olga"], now).recommendations.some((row) => row.id === "silent");
  assert.equal(silent(demoCrm), true);
  const answered = acceptDeliveredMessage(
    demoCrm,
    demoCrm.workspaceId,
    {
      id: "recent-followup",
      requestId: "recent-followup",
      leadId: "olga",
      author: "manager",
      text: "Подойдёт другое время?",
      at: "2026-11-17T08:50:00Z",
      kind: "text",
    },
    "recent-followup",
  );
  assert.equal(silent(answered), false);
  const replied = parseCrmState({
    ...demoCrm,
    messages: [
      {
        id: "olga-new-reply",
        leadId: "olga",
        author: "client",
        text: "Да, подходит.",
        at: "2026-11-17T08:50:00Z",
        kind: "text",
      },
    ],
  });
  assert.equal(silent(replied), false);
  const stopped = updateLeadDetails(demoCrm, demoCrm.workspaceId, "olga", { timerStopped: true });
  assert.equal(silent(stopped), false);
});

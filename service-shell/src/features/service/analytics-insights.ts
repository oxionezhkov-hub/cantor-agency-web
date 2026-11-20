import type { CrmState } from "./crm.ts";
import { leadProgress } from "./lead-workflow.ts";
import { conversationMessages, waitingForReply } from "./communication.ts";
import { REPLY_LIMIT_MS, SILENT_AFTER_MS } from "./rules.ts";

export function ltvEconomics(
  spendRub: number,
  newStudents: number,
  ltvRub: number | null,
  complete = true,
) {
  const costRub =
    complete &&
    Number.isFinite(spendRub) &&
    spendRub >= 0 &&
    Number.isInteger(newStudents) &&
    newStudents > 0
      ? spendRub / newStudents
      : null;
  const validLtv = ltvRub !== null && Number.isFinite(ltvRub) && ltvRub > 0;
  const limitRub = validLtv ? ltvRub * 0.2 : null;
  const sharePct = validLtv && costRub !== null ? (costRub / ltvRub) * 100 : null;
  const comparison =
    costRub !== null && validLtv
      ? Math.round(spendRub * 100) * 5 - newStudents * Math.round(ltvRub * 100)
      : null;
  return {
    costRub,
    limitRub,
    sharePct,
    // The owner has not resolved whether exactly 20% counts as success.
    // Compare integer minor units to keep the boundary independent of rounding.
    atBoundary: comparison === 0,
    works: comparison === null || comparison === 0 ? null : comparison < 0,
  };
}

export type RefusalReason = { reason: string; count: number; leadIds: string[] };
export type DialogueRecommendation = {
  id: string;
  title: string;
  action: string;
  count: number;
  leadId: string;
};
export function topRecommendations(recommendations: readonly DialogueRecommendation[]) {
  return [...recommendations]
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, 5);
}
export function dialogueInsights(crm: CrmState, leadIds: readonly string[], now = Date.now()) {
  const ids = new Set(leadIds);
  const leads = crm.leads.filter((lead) => ids.has(lead.id));
  const reasons = new Map<string, RefusalReason>();
  for (const lead of leads.filter((lead) => lead.closedAt)) {
    const rawReason = lead.closeReason?.replace(/\s+/g, " ").trim();
    const reason =
      !rawReason || rawReason.toLocaleLowerCase("ru-RU") === "закрыто"
        ? "Причина не указана"
        : rawReason;
    const key = reason.toLocaleLowerCase("ru-RU");
    const row = reasons.get(key) ?? { reason, count: 0, leadIds: [] };
    row.count++;
    row.leadIds.push(lead.id);
    reasons.set(key, row);
  }
  const recommendations: DialogueRecommendation[] = [];
  const grouped = (id: string, selected: typeof leads, title: string, action: string) => {
    if (selected.length)
      recommendations.push({ id, title, action, count: selected.length, leadId: selected[0].id });
  };
  const stage = (leadId: string) => leadProgress(crm, leadId, now).stage;
  grouped(
    "reply",
    leads.filter((lead) => {
      const reply = waitingForReply(crm, lead, now);
      return stage(lead.id) === "new" && reply.waiting && reply.elapsedMs > REPLY_LIMIT_MS;
    }),
    "Ответить на вопросы",
    "Вернитесь к вопросу клиента и предложите следующий шаг.",
  );
  grouped(
    "diagnostic-payment",
    leads.filter((lead) => stage(lead.id) === "after"),
    "Довести диагностику до решения",
    "Уточните результат встречи: договорились о занятиях, ждёте решение или получили отказ.",
  );
  grouped(
    "outcome",
    leads.filter((lead) => stage(lead.id) === "outcome"),
    "Отметить исход встреч",
    "Зафиксируйте проведение или неявку, чтобы видеть следующий шаг.",
  );
  grouped(
    "no-show",
    leads.filter((lead) => stage(lead.id) === "no_show"),
    "Предложить повторную запись",
    "Уточните причину неявки и предложите другое время.",
  );
  grouped(
    "silent",
    leads.filter((lead) => {
      if (lead.timerStopped || stage(lead.id) !== "new") return false;
      const last = conversationMessages(crm, lead.id)
        .filter((message) => message.author !== "system")
        .at(-1);
      return last?.author === "manager" && now - Date.parse(last.at) >= SILENT_AFTER_MS;
    }),
    "Вернуться к незавершённым обращениям",
    "Уточните, подходит ли предложенное время, и помогите выбрать следующий шаг.",
  );
  const refusalReasons = [...reasons.values()].sort(
    (a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "ru"),
  );
  if (refusalReasons.length)
    recommendations.push({
      id: "closed",
      title: "Разобрать причины отказов",
      action: "Проверьте формулировки предложения в закрытых диалогах и учтите записанные причины.",
      count: leads.filter((lead) => lead.closedAt).length,
      leadId: refusalReasons[0].leadIds[0],
    });
  return {
    refusalReasons,
    closedCount: leads.filter((lead) => lead.closedAt).length,
    recommendations,
  };
}

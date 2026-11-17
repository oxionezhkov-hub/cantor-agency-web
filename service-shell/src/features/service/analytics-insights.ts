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
  return {
    costRub,
    limitRub,
    sharePct,
    // Compare money in minor units before division so an exact 20% boundary
    // cannot become a false negative through floating point rounding.
    works:
      costRub !== null && validLtv
        ? Math.round(spendRub * 100) * 5 <= newStudents * Math.round(ltvRub * 100)
        : null,
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
export function dialogueInsights(crm: CrmState, leadIds: readonly string[], now = Date.now()) {
  const ids = new Set(leadIds);
  const leads = crm.leads.filter((lead) => ids.has(lead.id));
  const reasons = new Map<string, RefusalReason>();
  for (const lead of leads.filter((lead) => lead.closedAt)) {
    const reason = lead.closeReason?.replace(/\s+/g, " ").trim() || "Причина не указана";
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

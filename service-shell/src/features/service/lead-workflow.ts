import { appointmentOutcome, CrmError, parseCrmState, paymentNet, type CrmState } from "./crm.ts";

export type LeadStage = "new" | "booked" | "outcome" | "after" | "no_show" | "student" | "closed";
export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "Обращение",
  booked: "Записан",
  outcome: "Нужен исход",
  after: "После диагностики",
  no_show: "Неявка",
  student: "Ученик",
  closed: "Закрыто",
};
export type DetailTab = "conversation" | "appointment" | "payments" | "history";
export function leadProgress(state: CrmState, leadId: string, nowMs: number) {
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead) throw new CrmError("Обращение не найдено");
  const appointments = state.appointments.filter((item) => item.leadId === leadId);
  const booked = appointments.find((item) => item.status === "booked");
  const completed = appointments.filter((item) => item.status === "completed");
  const payments = state.payments.filter((item) => item.studentId === lead.studentId);
  const receivedMinor = payments.reduce((sum, p) => sum + paymentNet(state, p), 0);
  const latest = [...appointments].sort(
    (a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt),
  )[0];
  const stage: LeadStage = lead.closedAt
    ? "closed"
    : lead.workflowStage && lead.workflowStage !== "closed"
      ? lead.workflowStage
      : booked
        ? Date.parse(booked.endsAt) <= nowMs
          ? "outcome"
          : "booked"
        : receivedMinor > 0
          ? "student"
          : completed.length
            ? "after"
            : latest?.status === "no_show"
              ? "no_show"
              : "new";
  let nextTab: DetailTab = "appointment",
    nextLabel = "Выбрать время";
  if (stage === "closed") {
    nextTab = "history";
    nextLabel = "Вернуть в работу";
  } else if (stage === "student") {
    nextTab = "payments";
    nextLabel = "Добавить оплату";
  } else if (stage === "after") {
    nextTab = "payments";
    nextLabel = "Внести оплату";
  } else if (stage === "outcome") {
    nextLabel = "Отметить результат";
  } else if (stage === "booked") {
    nextLabel = "Открыть запись";
  } else if (stage === "no_show") {
    nextLabel = "Выбрать новое время";
  }
  return {
    stage,
    label: STAGE_LABELS[stage],
    nextTab,
    nextLabel,
    booked,
    completed,
    payments,
    receivedMinor,
  };
}
export function saveLeadDraft(
  state: CrmState,
  workspaceId: string,
  leadId: string,
  draft: string,
): CrmState {
  if (state.workspaceId !== workspaceId) throw new CrmError("Нет доступа к этому пространству");
  if (!state.leads.some((l) => l.id === leadId)) throw new CrmError("Обращение не найдено");
  return parseCrmState({
    ...state,
    leads: state.leads.map((l) => (l.id === leadId ? { ...l, draft } : l)),
  });
}
export function setLeadClosure(
  state: CrmState,
  workspaceId: string,
  leadId: string,
  reason: string | null,
  now: string,
): CrmState {
  if (state.workspaceId !== workspaceId) throw new CrmError("Нет доступа к этому пространству");
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) throw new CrmError("Обращение не найдено");
  if (!Number.isFinite(Date.parse(now))) throw new CrmError("Некорректное время");
  if (reason !== null && (!reason.trim() || reason.trim().length > 300))
    throw new CrmError("Укажите причину закрытия до 300 символов");
  if ((reason !== null && lead.closedAt) || (reason === null && !lead.closedAt)) return state;
  let next = state;
  if (reason !== null)
    for (const item of state.appointments.filter(
      (a) => a.leadId === leadId && a.status === "booked",
    ))
      next = appointmentOutcome(next, workspaceId, item.id, "cancelled", now);
  return parseCrmState({
    ...next,
    leads: next.leads.map((l) => {
      if (l.id !== leadId) return l;
      if (reason !== null) return { ...l, closedAt: now, closeReason: reason.trim() };
      const restored = { ...l };
      delete restored.closedAt;
      delete restored.closeReason;
      return restored;
    }),
    events: [
      ...next.events,
      {
        id: `event-${next.events.length + 1}`,
        objectId: leadId,
        type: reason === null ? "lead_reopened" : "lead_closed",
        at: now,
        detail: reason === null ? "Обращение возвращено в работу" : reason.trim(),
      },
    ],
  });
}
export function leadTimeline(state: CrmState, leadId: string) {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return [];
  const related = new Set([
    leadId,
    ...state.appointments.filter((a) => a.leadId === leadId).map((a) => a.id),
    ...state.payments.filter((p) => p.studentId === lead.studentId).map((p) => p.id),
  ]);
  const result = state.events
    .filter((e) => related.has(e.objectId))
    .map((e) => ({
      id: e.id,
      at: e.at,
      text:
        e.type === "payment_recorded"
          ? `Получена оплата ${(state.payments.find((p) => p.id === e.objectId)!.amountMinor / 100).toLocaleString("ru-RU")} ₽`
          : e.type === "appointment_rescheduled"
            ? `Встреча перенесена: ${e.detail
                .split(" → ")
                .map((at) =>
                  new Date(at).toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Moscow",
                  }),
                )
                .join(" → ")}`
            : e.type === "lead_closed"
              ? `Обращение закрыто: ${e.detail}`
              : e.detail,
    }));
  if (
    !result.some(
      (e) =>
        e.id === state.events.find((e) => e.objectId === leadId && e.type === "lead_created")?.id,
    )
  )
    result.push({ id: `created-${leadId}`, at: lead.createdAt, text: "Получено обращение" });
  for (const a of state.appointments.filter((a) => a.leadId === leadId))
    if (!state.events.some((e) => e.objectId === a.id))
      result.push({
        id: a.id,
        at: a.completedAt ?? a.startsAt,
        text:
          a.status === "completed"
            ? "Диагностика проведена"
            : a.status === "booked"
              ? "Назначена диагностика"
              : a.status === "no_show"
                ? "Неявка на диагностику"
                : "Запись отменена",
      });
  for (const p of state.payments.filter((p) => p.studentId === lead.studentId))
    if (!state.events.some((e) => e.objectId === p.id))
      result.push({
        id: p.id,
        at: p.paidAt,
        text: `Получена оплата ${(p.amountMinor / 100).toLocaleString("ru-RU")} ₽`,
      });
  return result.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function freeWindows(
  state: CrmState,
  slots: { id: string; startsAt: string }[],
  nowMs: number,
) {
  return slots.filter(
    (slot) =>
      Date.parse(slot.startsAt) > nowMs &&
      !state.appointments.some(
        (a) =>
          ["booked", "completed"].includes(a.status) &&
          Date.parse(a.startsAt) < Date.parse(slot.startsAt) + 1800000 &&
          Date.parse(slot.startsAt) < Date.parse(a.endsAt),
      ),
  );
}
export function invitationFor(
  state: CrmState,
  leadId: string,
  slot: { id: string; startsAt: string },
  slots: { id: string; startsAt: string }[],
  nowMs: number,
) {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead || lead.closedAt) throw new CrmError("Обращение закрыто или не найдено");
  if (
    !freeWindows(state, slots, nowMs).some((s) => s.id === slot.id && s.startsAt === slot.startsAt)
  )
    throw new CrmError("Время уже занято. Выберите другое окно");
  const date = new Date(slot.startsAt).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
  return `Давайте начнём с диагностики: посмотрим, что сейчас получается и с чего лучше начать. Можем встретиться ${date} по Москве, на 30 минут. Подойдёт?`;
}

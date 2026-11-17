import { CrmError, parseCrmState, type CrmState, type Lead } from "./crm.ts";
import { ads, dialogs } from "./data.ts";
import { leadProgress } from "./lead-workflow.ts";
export type ChatMessage = NonNullable<CrmState["messages"]>[number];
export type ReplyMode = "manual" | "ai_approval" | "ai_auto";
export const MODE_LABELS: Record<ReplyMode, string> = {
  manual: "Ручной",
  ai_approval: "ИИ · согласование",
  ai_auto: "ИИ · автоматически",
};
export function conversationMessages(state: CrmState, leadId: string): ChatMessage[] {
  const original = (dialogs.find((d) => d.id === leadId)?.messages ?? [])
    .filter((m) => m.at)
    .map((m, i) => ({
      id: m.id ?? `${leadId}-source-${i}`,
      leadId,
      author: m.author === "Анна" ? ("manager" as const) : ("client" as const),
      text: m.text,
      at: m.at!,
      kind: "text" as const,
    }));
  const merged = new Map<string, ChatMessage>(original.map((m) => [m.id, m]));
  for (const m of state.messages ?? []) if (m.leadId === leadId) merged.set(m.id, m);
  return [...merged.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
export function waitingForReply(state: CrmState, lead: Lead, nowMs: number) {
  const messages = conversationMessages(state, lead.id),
    last = messages.filter((m) => m.author !== "system").at(-1);
  const waiting = !lead.closedAt && !lead.timerStopped && last?.author === "client";
  const since = waiting ? last!.at : null;
  return {
    waiting: Boolean(waiting),
    since,
    elapsedMs: since ? Math.max(0, nowMs - Date.parse(since)) : 0,
  };
}
export function elapsedLabel(ms: number) {
  const total = Math.floor(ms / 60000),
    h = Math.floor(total / 60),
    m = total % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}
export function reminderDue(state: CrmState, lead: Lead, nowMs: number) {
  if (lead.closedAt) return false;
  if (
    (state.followups ?? []).some(
      (t) => t.leadId === lead.id && !t.doneAt && Date.parse(t.dueAt) <= nowMs,
    )
  )
    return true;
  const stage = leadProgress(state, lead.id, nowMs).stage;
  if (stage === "outcome" || stage === "after" || stage === "no_show") return true;
  const dialog = dialogs.find((d) => d.id === lead.id);
  return (
    !lead.timerStopped &&
    Boolean(dialog?.silentSince) &&
    nowMs - Date.parse(dialog!.silentSince!) >= 3 * 3600000
  );
}
export function searchableLead(state: CrmState, lead: Lead) {
  return [
    lead.id,
    lead.name,
    lead.city ?? "",
    lead.note ?? "",
    lead.closeReason ?? "",
    lead.draft ?? "",
    state.students.find((s) => s.id === lead.studentId)?.name ?? "",
    ads.find((a) => a.id === lead.adId)?.title ?? "",
    ...conversationMessages(state, lead.id).map((m) => m.text),
    ...(state.followups ?? []).filter((t) => t.leadId === lead.id).map((t) => t.title),
    ...(state.outcomes ?? []).filter((o) => o.leadId === lead.id).map((o) => o.text),
  ]
    .join(" ")
    .toLocaleLowerCase("ru-RU");
}
function checked(state: CrmState, workspaceId: string, leadId: string) {
  if (state.workspaceId !== workspaceId || !state.leads.some((l) => l.id === leadId))
    throw new CrmError("Нет доступа к обращению");
}
export function updateLeadDetails(
  state: CrmState,
  workspaceId: string,
  leadId: string,
  patch: Pick<Lead, "note" | "timerStopped" | "unreadCount" | "mode">,
) {
  checked(state, workspaceId, leadId);
  return parseCrmState({
    ...state,
    leads: state.leads.map((l) => (l.id === leadId ? { ...l, ...patch } : l)),
  });
}
export function addOutcome(
  state: CrmState,
  workspaceId: string,
  leadId: string,
  text: string,
  now: string,
  id: string,
) {
  checked(state, workspaceId, leadId);
  if (!text.trim()) throw new CrmError("Запишите итог диагностики");
  return parseCrmState({
    ...state,
    outcomes: [...(state.outcomes ?? []), { id, leadId, text: text.trim(), at: now }],
  });
}
export function addFollowup(
  state: CrmState,
  workspaceId: string,
  leadId: string,
  title: string,
  dueAt: string,
  id: string,
) {
  checked(state, workspaceId, leadId);
  if (!title.trim()) throw new CrmError("Напишите задачу");
  if (!Number.isFinite(Date.parse(dueAt))) throw new CrmError("Выберите срок");
  return parseCrmState({
    ...state,
    followups: [...(state.followups ?? []), { id, leadId, title: title.trim(), dueAt }],
  });
}
export function finishFollowup(state: CrmState, workspaceId: string, id: string, now: string) {
  if (state.workspaceId !== workspaceId) throw new CrmError("Нет доступа");
  if (!(state.followups ?? []).some((t) => t.id === id)) throw new CrmError("Задача не найдена");
  return parseCrmState({
    ...state,
    followups: state.followups?.map((t) => (t.id === id ? { ...t, doneAt: now } : t)),
  });
}
export interface MessageAdapter {
  send(input: {
    requestId: string;
    leadId: string;
    text: string;
    quoteId?: string;
  }): Promise<ChatMessage>;
}
export const disconnectedAdapter: MessageAdapter = {
  async send() {
    throw new CrmError(
      "Сообщение не отправлено: Авито не подключён. Текст сохранён на устройстве.",
    );
  },
};
export function acceptDeliveredMessage(
  state: CrmState,
  workspaceId: string,
  message: ChatMessage,
  requestId: string,
) {
  checked(state, workspaceId, message.leadId);
  if (message.author !== "manager" || (message.requestId ?? message.id) !== requestId)
    throw new CrmError("Неверное подтверждение отправки");
  const existing = (state.messages ?? []).find(
    (m) => m.id === message.id || m.requestId === requestId,
  );
  if (existing) {
    if (
      existing.leadId !== message.leadId ||
      existing.text !== message.text ||
      existing.quoteId !== message.quoteId
    )
      throw new CrmError("Ключ отправки уже использован для другого сообщения");
    return state;
  }
  if (
    message.quoteId &&
    !conversationMessages(state, message.leadId).some((m) => m.id === message.quoteId)
  )
    throw new CrmError("Исходное сообщение цитаты не найдено");
  const lead = state.leads.find((l) => l.id === message.leadId)!;
  return parseCrmState({
    ...state,
    messages: [...(state.messages ?? []), message],
    leads: state.leads.map((l) =>
      l.id === lead.id
        ? {
            ...l,
            draft: "",
            unreadCount: 0,
            ...(l.mode === "ai_auto" ? { mode: "ai_approval" as const } : {}),
          }
        : l,
    ),
  });
}
export function normalizeAvitoContact(chat: unknown, ownerId: string) {
  const c = chat as {
    users?: {
      id: unknown;
      name?: string;
      location?: { title?: string };
      public_user_profile?: { avatar?: { default?: string; images?: Record<string, string> } };
    }[];
    context?: { value?: { title?: string; location?: { title?: string } } };
  };
  const other = c?.users?.find((u) => String(u.id) !== ownerId),
    avatar = other?.public_user_profile?.avatar;
  return {
    name: other?.name ?? "",
    avatarUrl: avatar?.default ?? Object.values(avatar?.images ?? {})[0] ?? null,
    city: other?.location?.title ?? null,
    listingTitle: c?.context?.value?.title ?? null,
    listingCity: c?.context?.value?.location?.title ?? null,
  };
}

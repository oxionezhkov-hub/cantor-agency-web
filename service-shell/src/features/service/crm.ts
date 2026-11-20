import { z } from "zod";

const id = z.string().min(1).max(100);
const at = z.string().datetime({ offset: true });
const amount = z.number().int().positive().max(99_999_999);
const studentSchema = z.object({ id, name: z.string().min(1).max(120) });
const leadSchema = z.object({
  id,
  studentId: id,
  name: z.string().min(1).max(120),
  adId: id.nullable(),
  createdAt: at,
  draft: z.string().max(5000).optional(),
  city: z.string().max(120).optional(),
  avatarUrl: z.string().url().optional(),
  unreadCount: z.number().int().nonnegative().optional(),
  timerStopped: z.boolean().optional(),
  note: z.string().max(4000).optional(),
  mode: z.enum(["manual", "ai_approval", "ai_auto"]).optional(),
  workflowStage: z
    .enum(["new", "booked", "outcome", "after", "no_show", "student", "closed"])
    .optional(),
  stageChangedAt: at.optional(),
  aiProposal: z
    .object({
      text: z.string().max(5000),
      forMsgId: id,
      status: z.enum(["ready", "rejected", "approved"]),
    })
    .optional(),
  closedAt: at.optional(),
  closeReason: z.string().min(1).max(300).optional(),
});
const appointmentSchema = z.object({
  id,
  leadId: id,
  startsAt: at,
  endsAt: at,
  status: z.enum(["booked", "completed", "cancelled", "no_show"]),
  completedAt: at.optional(),
});
const paymentSchema = z.object({
  id,
  studentId: id,
  amountMinor: amount,
  paidAt: at,
  requestId: id,
});
const refundSchema = z.object({
  id,
  paymentId: id,
  amountMinor: amount,
  refundedAt: at,
  requestId: id,
});
const eventSchema = z.object({
  id,
  objectId: id,
  type: z.string().min(1).max(40),
  at,
  detail: z.string().max(200),
});
const chatMessageSchema = z.object({
  id,
  leadId: id,
  author: z.enum(["client", "manager", "system"]),
  text: z.string().max(5000),
  at,
  quoteId: id.optional(),
  requestId: id.optional(),
  kind: z.enum(["text", "image", "voice", "file", "call", "video"]).optional(),
  url: z.string().url().optional(),
  fileName: z.string().max(250).optional(),
  attachmentId: id.optional(),
  mimeType: z.string().max(200).optional(),
  delivery: z.enum(["local", "provider"]).optional(),
  editedAt: at.optional(),
});
const followupSchema = z.object({
  id,
  leadId: id,
  title: z.string().min(1).max(300),
  dueAt: at,
  doneAt: at.optional(),
});
const stateSchema = z.object({
  version: z.literal(1),
  workspaceId: id,
  students: z.array(studentSchema),
  leads: z.array(leadSchema),
  appointments: z.array(appointmentSchema),
  payments: z.array(paymentSchema),
  refunds: z.array(refundSchema),
  events: z.array(eventSchema),
  messages: z.array(chatMessageSchema).optional(),
  followups: z.array(followupSchema).optional(),
  outcomes: z.array(z.object({ id, leadId: id, text: z.string().min(1).max(4000), at })).optional(),
  feedback: z
    .array(
      z.object({
        id,
        leadId: id,
        original: z.string().max(5000),
        corrected: z.string().max(5000),
        action: z.enum(["edited", "approved", "rejected"]),
        at,
      }),
    )
    .optional(),
});
export type CrmState = z.infer<typeof stateSchema>;
export type Lead = CrmState["leads"][number];
export type Appointment = CrmState["appointments"][number];
export type PaymentRecord = CrmState["payments"][number];
export class CrmError extends Error {}

function unique(items: { id: string }[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}
export function parseCrmState(raw: unknown): CrmState {
  const state = stateSchema.parse(raw);
  if (
    ![
      state.students,
      state.leads,
      state.appointments,
      state.payments,
      state.refunds,
      state.events,
    ].every(unique)
  )
    throw new CrmError("Повторяющиеся идентификаторы в сохранённых данных");
  if (
    new Set([...state.payments, ...state.refunds].map((item) => item.requestId)).size !==
    state.payments.length + state.refunds.length
  )
    throw new CrmError("Повторяющаяся платёжная операция");
  for (const items of [
    state.messages ?? [],
    state.followups ?? [],
    state.outcomes ?? [],
    state.feedback ?? [],
  ]) {
    if (!unique(items)) throw new CrmError("Повторяющиеся идентификаторы коммуникаций");
    if (items.some((item) => !state.leads.some((lead) => lead.id === item.leadId)))
      throw new CrmError("Коммуникация не связана с обращением");
  }
  if (state.leads.some((lead) => !state.students.some((student) => student.id === lead.studentId)))
    throw new CrmError("У заявки отсутствует ученик");
  if (
    state.payments.some(
      (payment) => !state.students.some((student) => student.id === payment.studentId),
    )
  )
    throw new CrmError("У оплаты отсутствует ученик");
  for (const appointment of state.appointments) {
    if (
      !state.leads.some((lead) => lead.id === appointment.leadId) ||
      Date.parse(appointment.endsAt) <= Date.parse(appointment.startsAt)
    )
      throw new CrmError("Некорректная запись на диагностику");
    if (
      appointment.status === "completed" &&
      (!appointment.completedAt ||
        Date.parse(appointment.completedAt) < Date.parse(appointment.endsAt))
    )
      throw new CrmError("У проведённой диагностики отсутствует дата результата");
  }
  for (const refund of state.refunds)
    if (!state.payments.some((payment) => payment.id === refund.paymentId))
      throw new CrmError("Возврат не связан с оплатой");
  for (const payment of state.payments)
    if (paymentNet(state, payment) < 0) throw new CrmError("Возврат превышает исходную оплату");
  return state;
}
function scope(state: CrmState, workspaceId: string) {
  if (workspaceId !== state.workspaceId) throw new CrmError("Нет доступа к этому пространству");
}
function validDate(value: string) {
  if (!at.safeParse(value).success) throw new CrmError("Укажите корректную дату");
}
function event(
  state: CrmState,
  objectId: string,
  type: string,
  now: string,
  detail: string,
): CrmState["events"] {
  return [
    ...state.events,
    { id: `event-${state.events.length + 1}`, objectId, type, at: now, detail },
  ];
}
export function paymentNet(state: CrmState, payment: PaymentRecord): number {
  return (
    payment.amountMinor -
    state.refunds
      .filter((item) => item.paymentId === payment.id)
      .reduce((sum, item) => sum + item.amountMinor, 0)
  );
}

export function recordPayment(
  state: CrmState,
  workspaceId: string,
  input: PaymentRecord,
): CrmState {
  scope(state, workspaceId);
  const payment = paymentSchema.parse(input);
  const existing = state.payments.find((item) => item.requestId === payment.requestId);
  if (existing) {
    if (
      existing.studentId !== payment.studentId ||
      existing.amountMinor !== payment.amountMinor ||
      existing.paidAt !== payment.paidAt
    )
      throw new CrmError("Ключ повтора уже использован для другой оплаты");
    return state;
  }
  if (
    state.payments.some((item) => item.id === payment.id) ||
    state.refunds.some((item) => item.requestId === payment.requestId)
  )
    throw new CrmError("Операция уже существует");
  if (!state.students.some((student) => student.id === payment.studentId))
    throw new CrmError("Ученик не найден");
  return {
    ...state,
    payments: [...state.payments, payment],
    leads: state.leads.map((l) =>
      l.studentId === payment.studentId ? { ...l, workflowStage: undefined } : l,
    ),
    events: event(state, payment.id, "payment_recorded", payment.paidAt, "Внесена оплата ученика"),
  };
}
export function recordRefund(
  state: CrmState,
  workspaceId: string,
  input: CrmState["refunds"][number],
): CrmState {
  scope(state, workspaceId);
  const refund = refundSchema.parse(input);
  const existing = state.refunds.find((item) => item.requestId === refund.requestId);
  if (existing) {
    if (
      existing.paymentId !== refund.paymentId ||
      existing.amountMinor !== refund.amountMinor ||
      existing.refundedAt !== refund.refundedAt
    )
      throw new CrmError("Ключ повтора уже использован для другого возврата");
    return state;
  }
  if (
    state.refunds.some((item) => item.id === refund.id) ||
    state.payments.some((item) => item.requestId === refund.requestId)
  )
    throw new CrmError("Операция уже существует");
  const payment = state.payments.find((item) => item.id === refund.paymentId);
  if (
    !payment ||
    Date.parse(refund.refundedAt) < Date.parse(payment.paidAt) ||
    refund.amountMinor > paymentNet(state, payment)
  )
    throw new CrmError("Возврат превышает остаток оплаты");
  return {
    ...state,
    refunds: [...state.refunds, refund],
    events: event(
      state,
      payment.id,
      "refund_recorded",
      refund.refundedAt,
      "Отмечен фактически выполненный возврат ученику",
    ),
  };
}
export function updatePayment(
  state: CrmState,
  workspaceId: string,
  input: { paymentId: string; amountMinor: number; paidAt: string; changedAt: string },
): CrmState {
  scope(state, workspaceId);
  const original = state.payments.find((item) => item.id === input.paymentId);
  if (!original) throw new CrmError("Оплата не найдена");
  validDate(input.changedAt);
  const payment = paymentSchema.parse({
    ...original,
    amountMinor: input.amountMinor,
    paidAt: input.paidAt,
  });
  const refunds = state.refunds.filter((item) => item.paymentId === payment.id);
  const refunded = refunds.reduce((sum, item) => sum + item.amountMinor, 0);
  if (payment.amountMinor < refunded)
    throw new CrmError("Сумма оплаты не может быть меньше уже внесённых возвратов");
  if (refunds.some((item) => Date.parse(item.refundedAt) < Date.parse(payment.paidAt)))
    throw new CrmError("Дата оплаты не может быть позже связанного возврата");
  if (payment.amountMinor === original.amountMinor && payment.paidAt === original.paidAt)
    return state;
  return {
    ...state,
    payments: state.payments.map((item) => (item.id === payment.id ? payment : item)),
    events: event(
      state,
      payment.id,
      "payment_updated",
      input.changedAt,
      `Оплата исправлена: ${original.amountMinor / 100} → ${payment.amountMinor / 100} ₽; ${original.paidAt.slice(0, 10)} → ${payment.paidAt.slice(0, 10)}`,
    ),
  };
}
export function bookAppointment(
  state: CrmState,
  workspaceId: string,
  input: Appointment,
  nowMs: number,
): CrmState {
  scope(state, workspaceId);
  const appointment = appointmentSchema.parse(input);
  const existing = state.appointments.find((item) => item.id === appointment.id);
  if (existing) {
    if (
      existing.leadId !== appointment.leadId ||
      existing.startsAt !== appointment.startsAt ||
      existing.endsAt !== appointment.endsAt
    )
      throw new CrmError("Запись с этим идентификатором уже существует");
    return state;
  }
  const lead = state.leads.find((lead) => lead.id === appointment.leadId);
  if (!lead) throw new CrmError("Заявка не найдена");
  if (lead.closedAt) throw new CrmError("Сначала верните обращение в работу");
  if (
    appointment.status !== "booked" ||
    Date.parse(appointment.endsAt) <= Date.parse(appointment.startsAt) ||
    Date.parse(appointment.startsAt) <= nowMs
  )
    throw new CrmError("Выберите свободное будущее время");
  if (
    state.appointments.some(
      (item) => item.status === "booked" && item.leadId === appointment.leadId,
    )
  )
    throw new CrmError("У этой заявки уже есть запись. Перенесите существующую встречу");
  if (
    state.appointments.some(
      (item) =>
        ["booked", "completed"].includes(item.status) &&
        Date.parse(item.startsAt) < Date.parse(appointment.endsAt) &&
        Date.parse(appointment.startsAt) < Date.parse(item.endsAt),
    )
  )
    throw new CrmError("Это время уже занято. Выберите другое окно");
  return {
    ...state,
    appointments: [...state.appointments, appointment],
    leads: state.leads.map((l) =>
      l.id === appointment.leadId ? { ...l, workflowStage: undefined } : l,
    ),
    events: event(
      state,
      appointment.id,
      "appointment_booked",
      new Date(nowMs).toISOString(),
      "Создана запись на диагностику",
    ),
  };
}
export function appointmentOutcome(
  state: CrmState,
  workspaceId: string,
  appointmentId: string,
  status: "completed" | "cancelled" | "no_show",
  now: string,
): CrmState {
  scope(state, workspaceId);
  validDate(now);
  const current = state.appointments.find((item) => item.id === appointmentId);
  if (!current) throw new CrmError("Запись не найдена");
  if (current.status === status) return state;
  if (current.status !== "booked") throw new CrmError("Результат этой записи уже зафиксирован");
  if (status !== "cancelled" && Date.parse(current.endsAt) > Date.parse(now))
    throw new CrmError("Встреча ещё не закончилась. Пока можно только отменить её");
  return {
    ...state,
    leads: state.leads.map((l) =>
      l.id === current.leadId ? { ...l, workflowStage: undefined } : l,
    ),
    appointments: state.appointments.map((item) =>
      item.id === current.id
        ? { ...item, status, ...(status === "completed" ? { completedAt: now } : {}) }
        : item,
    ),
    events: event(
      state,
      current.id,
      `appointment_${status}`,
      now,
      { completed: "Диагностика проведена", cancelled: "Запись отменена", no_show: "Неявка" }[
        status
      ],
    ),
  };
}
export function periodMetrics(state: CrmState, from: string, to: string) {
  validDate(from);
  validDate(to);
  const start = Date.parse(from),
    end = Date.parse(to);
  if (end <= start) throw new CrmError("Конец периода должен быть позже начала");
  const within = (date: string) => Date.parse(date) >= start && Date.parse(date) < end;
  const completed = state.appointments.filter(
    (item) => item.status === "completed" && within(item.completedAt!),
  );
  const firstPayments = new Map<string, PaymentRecord>();
  for (const payment of state.payments
    .filter((item) => paymentNet(state, item) > 0)
    .sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt)))
    if (!firstPayments.has(payment.studentId)) firstPayments.set(payment.studentId, payment);
  const newStudents = [...firstPayments.values()].filter((item) => within(item.paidAt));
  const receivedMinor = state.payments
    .filter((item) => within(item.paidAt))
    .reduce((sum, item) => sum + item.amountMinor, 0);
  const refundedMinor = state.refunds
    .filter((item) => within(item.refundedAt))
    .reduce((sum, item) => sum + item.amountMinor, 0);
  const unpaidStudentIds = [
    ...new Set(
      completed.map((item) => state.leads.find((lead) => lead.id === item.leadId)!.studentId),
    ),
  ].filter((id) => !firstPayments.has(id));
  return {
    newLeads: state.leads.filter((item) => within(item.createdAt)).length,
    completedAppointments: completed.length,
    bookedAppointments: state.appointments.filter(
      (item) => item.status === "booked" && within(item.startsAt),
    ).length,
    newStudents: newStudents.length,
    receivedMinor,
    refundedMinor,
    netReceivedMinor: receivedMinor - refundedMinor,
    unpaidStudentIds,
  };
}
export function monthRangeMsk(year: number, month: number): [string, string] {
  return [
    new Date(Date.UTC(year, month, 1, -3)).toISOString(),
    new Date(Date.UTC(year, month + 1, 1, -3)).toISOString(),
  ];
}
export function parseMoneyInput(input: string): number | null {
  const value = input.replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return null;
  const [rub, kop = ""] = value.split(".");
  const result = Number(rub) * 100 + Number(kop.padEnd(2, "0"));
  return result > 0 && result <= 99_999_999 ? result : null;
}
export function rescheduleAppointment(
  state: CrmState,
  workspaceId: string,
  appointmentId: string,
  startsAt: string,
  endsAt: string,
  nowMs: number,
): CrmState {
  scope(state, workspaceId);
  const current = state.appointments.find((item) => item.id === appointmentId);
  if (!current || current.status !== "booked")
    throw new CrmError("Перенести можно только действующую запись");
  if (current.startsAt === startsAt && current.endsAt === endsAt) return state;
  const checked = bookAppointment(
    { ...state, appointments: state.appointments.filter((item) => item.id !== appointmentId) },
    workspaceId,
    { ...current, startsAt, endsAt },
    nowMs,
  );
  const replacement = checked.appointments.find((item) => item.id === appointmentId)!;
  return {
    ...state,
    leads: state.leads.map((l) =>
      l.id === current.leadId ? { ...l, workflowStage: undefined } : l,
    ),
    appointments: state.appointments.map((item) =>
      item.id === appointmentId ? replacement : item,
    ),
    events: event(
      state,
      appointmentId,
      "appointment_rescheduled",
      new Date(nowMs).toISOString(),
      `${current.startsAt} → ${startsAt}`,
    ),
  };
}

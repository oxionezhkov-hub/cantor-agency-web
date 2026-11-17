import { dialogExamples } from "./dialog-examples.ts";
import { parseCrmState, type CrmState } from "./crm.ts";
export const DEMO_WORKSPACE = "cantor-demo-anna";
export const demoCrm: CrmState = parseCrmState({
  version: 1,
  workspaceId: DEMO_WORKSPACE,
  students: [
    { id: "student-ege", name: "Егор" },
    { id: "student-oge", name: "Дарья" },
    { id: "student-kirill", name: "Кирилл" },
    { id: "student-marina", name: "Дочь Марины" },
    { id: "student-igor", name: "Сын Игоря" },
    { id: "student-olga", name: "Дочь Ольги" },
    { id: "student-svetlana", name: "Ученица Светланы" },
  ],
  leads: [
    {
      id: "lead-ege",
      studentId: "student-ege",
      name: "Егор",
      adId: "ege",
      createdAt: "2026-11-05T09:00:00Z",
    },
    {
      id: "lead-oge",
      studentId: "student-oge",
      name: "Дарья",
      adId: "oge",
      createdAt: "2026-11-07T09:00:00Z",
    },
    {
      id: "kirill",
      studentId: "student-kirill",
      name: "Кирилл",
      adId: null,
      createdAt: "2026-11-09T09:00:00Z",
    },
    {
      id: "marina",
      city: "Москва",
      unreadCount: 2,
      studentId: "student-marina",
      name: "Марина",
      adId: "ege",
      createdAt: "2026-11-16T06:30:00Z",
    },
    {
      id: "igor",
      city: "Екатеринбург",
      unreadCount: 1,
      studentId: "student-igor",
      name: "Игорь",
      adId: "oge",
      createdAt: "2026-11-16T05:50:00Z",
    },
    {
      id: "olga",
      studentId: "student-olga",
      name: "Ольга",
      adId: null,
      createdAt: "2026-11-15T05:00:00Z",
    },
    {
      id: "svetlana",
      studentId: "student-svetlana",
      name: "Светлана",
      adId: null,
      createdAt: "2026-11-15T09:00:00Z",
    },
  ],
  appointments: [
    {
      id: "diagnostic-ege",
      leadId: "lead-ege",
      startsAt: "2026-11-10T09:00:00Z",
      endsAt: "2026-11-10T09:30:00Z",
      status: "completed",
      completedAt: "2026-11-10T09:30:00Z",
    },
    {
      id: "diagnostic-oge",
      leadId: "lead-oge",
      startsAt: "2026-11-12T09:00:00Z",
      endsAt: "2026-11-12T09:30:00Z",
      status: "completed",
      completedAt: "2026-11-12T09:30:00Z",
    },
    {
      id: "diagnostic-kirill",
      leadId: "kirill",
      startsAt: "2026-11-14T09:00:00Z",
      endsAt: "2026-11-14T09:30:00Z",
      status: "completed",
      completedAt: "2026-11-14T09:30:00Z",
    },
    {
      id: "diagnostic-svetlana",
      leadId: "svetlana",
      startsAt: "2026-11-19T16:00:00Z",
      endsAt: "2026-11-19T16:30:00Z",
      status: "booked",
    },
  ],
  payments: [
    {
      id: "payment-ege",
      studentId: "student-ege",
      amountMinor: 480000,
      paidAt: "2026-11-10T10:00:00Z",
      requestId: "seed-ege",
    },
    {
      id: "payment-oge",
      studentId: "student-oge",
      amountMinor: 480000,
      paidAt: "2026-11-12T10:00:00Z",
      requestId: "seed-oge",
    },
  ],
  refunds: [],
  events: [],
});

// Additional interactive examples are seeded only into the isolated local workbench.
export function withDialogExamples(state: CrmState): CrmState {
  if (state.workspaceId !== DEMO_WORKSPACE) return state;
  const examples = dialogExamples.filter((e) => !state.leads.some((l) => l.id === e.id));
  if (!examples.length) return state;
  return parseCrmState({
    ...state,
    students: [
      ...state.students,
      ...examples
        .filter((e) => !state.students.some((s) => s.id === `student-${e.id}`))
        .map((e) => ({ id: `student-${e.id}`, name: e.name })),
    ],
    leads: [
      ...state.leads,
      ...examples.map((e) => ({
        id: e.id,
        studentId: `student-${e.id}`,
        name: e.name,
        city: e.city,
        adId: e.adId,
        createdAt: e.messages[0].at,
        mode: e.mode,
        workflowStage: e.stage,
        unreadCount: e.stage === "closed" ? 0 : 1,
        ...(e.stage === "closed"
          ? { closedAt: e.messages.at(-1)!.at, closeReason: "Нужны очные занятия" }
          : {}),
        ...(e.proposal
          ? {
              aiProposal: {
                text: e.proposal,
                forMsgId: `${e.id}-source-${e.messages.length - 1}`,
                status: "ready" as const,
              },
            }
          : {}),
      })),
    ],
    followups: [
      ...(state.followups ?? []),
      ...examples
        .filter((e) => e.task)
        .map((e) => ({
          id: `task-${e.id}`,
          leadId: e.id,
          title: e.task!.title,
          dueAt: e.task!.dueAt,
        })),
    ],
  });
}

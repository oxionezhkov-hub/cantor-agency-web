import { z } from "zod";
import {
  appointmentOutcome,
  bookAppointment,
  recordPayment,
  rescheduleAppointment,
  parseCrmState,
  type CrmState,
} from "../crm.ts";

export const serviceId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const timestamp = z.string().datetime({ offset: true });
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("record_payment"),
      studentId: serviceId,
      amountMinor: z.number().int().positive().max(99_999_999),
      currency: z.literal("RUB"),
      paidAt: timestamp,
    })
    .strict(),
  z
    .object({
      type: z.literal("book_appointment"),
      leadId: serviceId,
      startsAt: timestamp,
      endsAt: timestamp,
    })
    .strict(),
  z
    .object({
      type: z.literal("reschedule_appointment"),
      appointmentId: serviceId,
      startsAt: timestamp,
      endsAt: timestamp,
    })
    .strict(),
  z
    .object({
      type: z.literal("appointment_outcome"),
      appointmentId: serviceId,
      status: z.enum(["completed", "cancelled", "no_show"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("create_lead"),
      name: z.string().trim().min(1).max(120),
      studentName: z.string().trim().min(1).max(120),
      adId: z.null(),
    })
    .strict(),
]);
export const mutationSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    requestId: serviceId.max(90),
    command: commandSchema,
  })
  .strict();
export type CrmCommand = z.infer<typeof commandSchema>;
export type Mutation = z.infer<typeof mutationSchema>;

// IDs and operation time are minted on the server. The caller cannot forge audit events,
// replace a snapshot, declare a meeting completed at an arbitrary time, or set a role.
export function applyCommand(state: CrmState, input: Mutation, now: string): CrmState {
  const command = input.command;
  let next: CrmState;
  switch (command.type) {
    case "record_payment":
      if (Date.parse(command.paidAt) > Date.parse(now)) throw new Error("future_payment");
      next = recordPayment(state, state.workspaceId, {
        id: `pay-${input.requestId}`,
        requestId: input.requestId,
        studentId: command.studentId,
        amountMinor: command.amountMinor,
        paidAt: command.paidAt,
      });
      break;
    case "book_appointment":
      next = bookAppointment(
        state,
        state.workspaceId,
        {
          id: `apt-${input.requestId}`,
          leadId: command.leadId,
          startsAt: command.startsAt,
          endsAt: command.endsAt,
          status: "booked",
        },
        Date.parse(now),
      );
      break;
    case "reschedule_appointment":
      next = rescheduleAppointment(
        state,
        state.workspaceId,
        command.appointmentId,
        command.startsAt,
        command.endsAt,
        Date.parse(now),
      );
      break;
    case "appointment_outcome":
      next = appointmentOutcome(
        state,
        state.workspaceId,
        command.appointmentId,
        command.status,
        now,
      );
      break;
    case "create_lead": {
      const studentId = `s-${input.requestId}`,
        leadId = `l-${input.requestId}`;
      next = {
        ...state,
        students: [...state.students, { id: studentId, name: command.studentName }],
        leads: [
          ...state.leads,
          { id: leadId, studentId, name: command.name, adId: command.adId, createdAt: now },
        ],
        events: [
          ...state.events,
          {
            id: `event-${state.events.length + 1}`,
            objectId: leadId,
            type: "lead_created",
            at: now,
            detail: "Заявка добавлена вручную",
          },
        ],
      };
      break;
    }
  }
  return parseCrmState(next);
}

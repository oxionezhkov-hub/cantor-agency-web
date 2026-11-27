import { useEffect, useState } from "react";
import { demoCrm, withDialogExamples } from "./crm-demo.ts";
import { parseCrmState, recordPayment, bookAppointment, type CrmState } from "./crm.ts";
import { windows } from "./data.ts";
import { PREVIEW_EVENT, getPreviewData } from "./preview-data.ts";
export const CRM_KEY = "cantor.demo-crm.v1";
let protectedPreviewState: CrmState | null = null;
function previewCrm(): CrmState {
  const workspaceId = getPreviewData()?.workspaceId;
  if (!workspaceId) return protectedPreviewState ?? demoCrm;
  if (protectedPreviewState?.workspaceId === workspaceId) return protectedPreviewState;
  return {
    version: 1,
    workspaceId,
    students: [],
    leads: [],
    appointments: [],
    payments: [],
    refunds: [],
    events: [],
  };
}
export const CRM_EVENT = "cantor-crm-changed";
export function migrateLegacyDemo(payments: unknown, bookings: unknown, now: string): CrmState {
  let state = structuredClone(demoCrm);
  if (Array.isArray(payments))
    payments.forEach((item, index) => {
      if (
        item?.who !== "Кирилл" ||
        !Number.isSafeInteger(item.amountRub) ||
        item.amountRub <= 0 ||
        item.amountRub > 999999
      )
        return;
      state = recordPayment(state, state.workspaceId, {
        id: `legacy-payment-${index}`,
        studentId: "student-kirill",
        amountMinor: item.amountRub * 100,
        paidAt: now,
        requestId: `legacy-payment-${index}`,
      });
    });
  if (bookings && typeof bookings === "object" && !Array.isArray(bookings))
    for (const [slotId, who] of Object.entries(bookings)) {
      const slot = windows.find((item) => item.id === slotId);
      if (!slot || who !== "Игорь") continue;
      try {
        state = bookAppointment(
          state,
          state.workspaceId,
          {
            id: `legacy-appointment-${slotId}`,
            leadId: "igor",
            startsAt: slot.startsAt,
            endsAt: new Date(Date.parse(slot.startsAt) + 30 * 60000).toISOString(),
            status: "booked",
          },
          Date.parse(now),
        );
      } catch {
        /* Invalid or conflicting old demo entries stay untouched in their old key. */
      }
    }
  return state;
}
export function readDemoCrm(): CrmState {
  if (getPreviewData()) return previewCrm();
  if (typeof localStorage === "undefined") return demoCrm;
  const current = localStorage.getItem(CRM_KEY);
  if (current) {
    const state = parseCrmState(JSON.parse(current));
    const upgraded = withDialogExamples(state);
    if (upgraded === state) return state;
    localStorage.setItem(CRM_KEY, JSON.stringify(upgraded));
    return upgraded;
  }
  let payments: unknown = null,
    bookings: unknown = null;
  try {
    payments = JSON.parse(localStorage.getItem("cantor.extra-payments") || "null");
    bookings = JSON.parse(localStorage.getItem("cantor.window-bookings") || "null");
  } catch {
    /* Old malformed demo data is not trusted or removed. */
  }
  const state = withDialogExamples(migrateLegacyDemo(payments, bookings, new Date().toISOString()));
  // Persist the migration timestamp once; legacy keys remain intact.
  localStorage.setItem(CRM_KEY, JSON.stringify(state));
  return state;
}
export function changeDemoCrm(change: (state: CrmState) => CrmState): CrmState {
  if (getPreviewData()) {
    const current = previewCrm();
    const next = parseCrmState(change(current));
    if (next.workspaceId !== current.workspaceId) throw new Error("Нет доступа");
    protectedPreviewState = next;
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CRM_EVENT));
    return next;
  }
  const current = readDemoCrm();
  const next = parseCrmState(change(current));
  localStorage.setItem(CRM_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CRM_EVENT));
  return next;
}
export function ingestPreviewLive() {
  const preview = getPreviewData();
  if (!preview) return;
  const current = previewCrm();
  const leads = new Map(current.leads.map((l) => [l.id, l])),
    students = new Map(current.students.map((s) => [s.id, s])),
    messages = new Map((current.messages || []).map((m) => [m.id, m]));
  for (const c of preview.chats) {
    if (!c.lastAt) continue;
    const prior = leads.get(c.id),
      studentId = prior?.studentId || `student-${c.id}`;
    students.set(studentId, {
      ...students.get(studentId),
      id: studentId,
      name: c.name || "Собеседник",
    });
    leads.set(c.id, {
      ...prior,
      id: c.id,
      studentId,
      name: c.name || "Собеседник",
      adId: c.itemId || prior?.adId || null,
      city: prior?.city || "",
      createdAt: prior?.createdAt || new Date(c.lastAt).toISOString(),
      mode: prior?.mode || "manual",
    });
    if (c.lastText) {
      const id = `${c.id}:${c.lastMessageId || `last-${c.lastAt}`}`;
      messages.set(id, {
        id,
        leadId: c.id,
        author:
          c.lastAuthor === "manager" ? "manager" : c.lastAuthor === "system" ? "system" : "client",
        text: c.lastText,
        at: new Date(c.lastAt).toISOString(),
        kind: "text",
        delivery: "provider",
      });
    }
  }
  protectedPreviewState = parseCrmState({
    ...current,
    leads: [...leads.values()],
    students: [...students.values()],
    messages: [...messages.values()],
  });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CRM_EVENT));
}
if (typeof window !== "undefined") window.addEventListener(PREVIEW_EVENT, ingestPreviewLive);
export function useDemoCrm() {
  const [state, setState] = useState(() => (getPreviewData() ? previewCrm() : demoCrm));
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    const sync = () => {
      try {
        setState(readDemoCrm());
        setStorageError("");
      } catch {
        setStorageError(
          "Не удалось прочитать сохранённые данные. Данные не перезаписаны; проверьте доступ к хранилищу браузера.",
        );
      }
    };
    if (
      getPreviewData()?.workspaceId &&
      protectedPreviewState?.workspaceId !== getPreviewData()?.workspaceId
    ) {
      ingestPreviewLive();
    }
    sync();
    window.addEventListener(CRM_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CRM_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return { state, storageError };
}

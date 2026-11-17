import { useEffect, useState } from "react";
import { demoCrm, withDialogExamples } from "./crm-demo.ts";
import { parseCrmState, recordPayment, bookAppointment, type CrmState } from "./crm.ts";
import { windows } from "./data.ts";
import { getPreviewData } from "./preview-data.ts";
export const CRM_KEY = "cantor.demo-crm.v1";
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
  if (getPreviewData()) return demoCrm;
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
  if (getPreviewData()) throw new Error("Недостаточно прав для изменения");
  const current = readDemoCrm();
  const next = parseCrmState(change(current));
  localStorage.setItem(CRM_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CRM_EVENT));
  return next;
}
export function useDemoCrm() {
  const [state, setState] = useState(demoCrm);
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

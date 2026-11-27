import { useEffect, useRef } from "react";
import type { SectionId } from "../service/sections";

type Scope = { workspaceId: string; employeeId: string };
type EventData = {
  id: string;
  outcome: "click" | "navigate" | "attempt";
  action: string;
  section: SectionId;
  target?: string;
};
const attemptEvent = "cantor:audit-attempt";
const attempts = ["create-comment", "campaign-generate", "save-ad", "send-reply"] as const;
type Attempt = (typeof attempts)[number];
export function trackCabinetAttempt(action: Attempt) {
  window.dispatchEvent(new CustomEvent(attemptEvent, { detail: action }));
}

export function useCabinetAudit(scope: Scope | undefined, section: SectionId, subpage: string) {
  const workspaceId = scope?.workspaceId;
  const employeeId = scope?.employeeId;
  const currentSection = useRef(section);
  const emit = useRef<(event: Omit<EventData, "id" | "section">) => void>(() => {});
  useEffect(() => {
    if (!workspaceId || !employeeId) return;
    const queue: EventData[] = [];
    let active = true;
    let inFlight = false;
    let retryAt = 0;
    async function flush(leaving = false) {
      if (!active || (inFlight && !leaving) || !queue.length || Date.now() < retryAt) return;
      const batch = queue.splice(0, 20);
      if (!leaving) inFlight = true;
      try {
        const response = await fetch("/api/cabinet/audit", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId, employeeId, events: batch }),
        });
        if (response.status === 429) {
          retryAt = Date.now() + 60_000;
          throw new Error();
        }
        if (response.status >= 500) throw new Error();
        if (response.status === 401 || response.status === 403) queue.length = 0;
      } catch {
        if (active && !leaving) {
          queue.unshift(...batch);
          queue.splice(80);
        }
      } finally {
        if (!leaving) inFlight = false;
      }
    }
    emit.current = (event) => {
      if (queue.length < 80)
        queue.push({ ...event, id: crypto.randomUUID(), section: currentSection.current });
      if (queue.length >= 20) void flush();
    };
    const click = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>("button[data-cabinet-audit]");
      const action = button?.dataset.cabinetAudit;
      if (action) emit.current({ action, outcome: "click", target: button.dataset.auditTarget });
    };
    const attempt = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (attempts.some((name) => name === action)) emit.current({ action, outcome: "attempt" });
    };
    const exit = () => void flush(true);
    const hidden = () => {
      if (document.visibilityState === "hidden") exit();
    };
    document.addEventListener("click", click, true);
    window.addEventListener(attemptEvent, attempt);
    window.addEventListener("pagehide", exit);
    document.addEventListener("visibilitychange", hidden);
    const timer = window.setInterval(() => void flush(), 5000);
    return () => {
      active = false;
      emit.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener("click", click, true);
      window.removeEventListener(attemptEvent, attempt);
      window.removeEventListener("pagehide", exit);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [workspaceId, employeeId]);
  useEffect(() => {
    currentSection.current = section;
    emit.current({ outcome: "navigate", action: "workspace-section", target: section });
  }, [workspaceId, employeeId, section, subpage]);
}

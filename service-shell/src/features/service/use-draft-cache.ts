import { useEffect, useRef, useState } from "react";
import { changeDemoCrm } from "./demo-crm-store.ts";
import { getPreviewData } from "./preview-data.ts";
import { saveLeadDraft } from "./lead-workflow.ts";
const key = (workspaceId: string, leadId: string) =>
  `cantor.draft-cache.v1:${workspaceId}:${leadId}`;
export function readDraftCache(workspaceId: string, leadId: string): string | null {
  if (getPreviewData() || typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key(workspaceId, leadId));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "string") throw new Error("Черновик повреждён; данные не перезаписаны");
  return value;
}
export function writeDraftCache(workspaceId: string, leadId: string, text: string) {
  if (!getPreviewData()) localStorage.setItem(key(workspaceId, leadId), JSON.stringify(text));
}
export function useDraftCache(workspaceId: string, leadId: string, saved: string | undefined) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const dirty = useRef(false),
    latest = useRef("");
  useEffect(() => {
    try {
      const cached = readDraftCache(workspaceId, leadId);
      if (!dirty.current) {
        latest.current = cached ?? saved ?? "";
        setText(latest.current);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать черновик");
    }
  }, [workspaceId, leadId, saved]);
  useEffect(
    () => () => {
      if (dirty.current)
        try {
          changeDemoCrm((s) => saveLeadDraft(s, workspaceId, leadId, latest.current));
        } catch {
          /* Device cache remains intact. */
        }
    },
    [workspaceId, leadId],
  );
  function change(value: string) {
    dirty.current = true;
    latest.current = value;
    setText(value);
    try {
      writeDraftCache(workspaceId, leadId, value);
      changeDemoCrm((s) => saveLeadDraft(s, workspaceId, leadId, value));
      setError("");
    } catch {
      setError("Не удалось сохранить черновик. Не закрывайте страницу; скопируйте текст.");
    }
  }
  return { text, change, error };
}

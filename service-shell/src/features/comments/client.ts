import type { SectionId } from "../service/sections";

export const COMMENTS = "/api/cabinet/comments";
export const ADMIN_COMMENTS = "/api/admin/comments";
export const STATUSES = { new: "Новое", in_progress: "В работе", fixed: "Исправлено" } as const;

export type Status = keyof typeof STATUSES;
export type Target = {
  anchor: string | null;
  path: string;
  x: number;
  y: number;
  focus?: string;
  view?: "crm" | "ai";
};
export type Diagnostic = {
  kind: "runtime_error" | "resource_error" | "request_failed";
  at: number;
};
export const DIAGNOSTIC_LABELS: Record<Diagnostic["kind"], string> = {
  runtime_error: "Ошибка интерфейса",
  resource_error: "Ресурс не загрузился",
  request_failed: "Необработанный сбой операции",
};
export type Comment = {
  id: string;
  workspaceId: string;
  section: SectionId;
  author: string;
  createdAt: string;
  target: Target;
  text: string;
  diagnostics: Diagnostic[];
  status: Status;
  hasAudio: boolean;
  hasScreenshot: boolean;
  transcript: string | null;
  transcriptionStatus: "pending" | "processing" | "complete" | "failed" | null;
};
type Page = { comments: Comment[]; next: string | null };
export class CommentError extends Error {
  constructor(
    readonly status: number,
    code: string,
  ) {
    super(code);
  }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok)
    throw new CommentError(response.status, result?.error || "unavailable");
  return result as T;
}
export function fetchComments(base: string, query: URLSearchParams, signal?: AbortSignal) {
  return request<Page>(`${base}?${query}`, { signal });
}
export const jsonBody = (data: object) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

const main = () => document.querySelector("#service-content");
const anchorPattern = /^[a-zA-Z0-9_-]{1,100}$/;
function bounded(value: number) {
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}
export function anchorElement(element: Element): Element | null {
  return main()?.contains(element) || element.closest(".service-sidebar")
    ? (element.closest("button, a, input, label, select, textarea, [role='button']") ?? element)
    : null;
}
export function targetFor(element: Element, x: number, y: number): Target {
  const stable = element.closest("[data-comment-anchor]:not(.service-layout)");
  const name = stable?.getAttribute("data-comment-anchor");
  const hasStable = name && anchorPattern.test(name);
  const root =
    (hasStable && stable) ||
    (main()?.contains(element) ? main() : element.closest(".service-layout"));
  const path = [];
  for (let node = element; node !== root && node.parentElement; node = node.parentElement) {
    const index = Array.prototype.indexOf.call(node.parentElement.children, node) + 1;
    path.unshift(`${node.localName}:nth-child(${index})`);
  }
  const rect = element.getBoundingClientRect();
  const selector = path.join(" > ");
  return {
    anchor:
      (hasStable && name) ||
      (root?.matches(".service-layout") ? "shell-layout" : "service-content"),
    path: selector.length <= 360 ? selector : "",
    x: bounded(rect.width ? (x - rect.left) / rect.width : 0.5),
    y: bounded(rect.height ? (y - rect.top) / rect.height : 0.5),
  };
}
export function findTarget(target: Target) {
  const root =
    target.anchor === "service-content"
      ? main()
      : target.anchor && anchorPattern.test(target.anchor)
        ? document.querySelector(`[data-comment-anchor="${target.anchor}"]`)
        : null;
  if (!root || !target.path) return root;
  try {
    return root.querySelector(`:scope > ${target.path}`) ?? root;
  } catch {
    return root;
  }
}
export function pointFor(target: Target) {
  const element = findTarget(target);
  const rect = element?.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return null;
  const x = rect.left + rect.width * target.x;
  const y = rect.top + rect.height * target.y;
  return { x, y };
}
export function captureViewport(section: SectionId): Promise<Blob | null> {
  if (section === "acc" || section === "chats") return Promise.resolve(null);
  return import("html2canvas")
    .then(({ default: render }) =>
      render(document.body, {
        width: window.innerWidth,
        height: window.innerHeight,
        x: window.scrollX,
        y: window.scrollY,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scale: Math.min(1, 1100 / window.innerWidth),
        backgroundColor: "#f4f3f0",
        ignoreElements: (el) =>
          el.matches(
            "input, textarea, [contenteditable], iframe, video, audio, [data-comment-private], [data-comment-ui], [role='dialog']",
          ),
        allowTaint: false,
        useCORS: false,
        logging: false,
        imageTimeout: 500,
      }),
    )
    .then(
      (canvas) =>
        new Promise<Blob | null>((resolve) =>
          canvas.toBlob(
            (blob) => resolve(blob && blob.size <= 400 * 1024 ? blob : null),
            "image/jpeg",
            0.68,
          ),
        ),
    )
    .catch(() => null);
}

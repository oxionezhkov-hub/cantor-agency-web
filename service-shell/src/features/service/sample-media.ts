import { useEffect, useState } from "react";
import { getPreviewData } from "./preview-data.ts";
import type { ChatMessage, MessageAdapter } from "./communication.ts";
const sessionMedia = new Map<string, { workspaceId: string; blob: Blob }>();
const isProtectedSandbox = (workspaceId: string) =>
  Boolean(getPreviewData()) && workspaceId === "cantor-elena-dobrynina";
const MAX_FILE = 20 * 1024 * 1024;
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("cantor-example-media", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("files", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("Хранилище файлов недоступно"));
  });
}
export async function cacheExampleMedia(workspaceId: string, blob: Blob, name: string) {
  if (workspaceId !== "cantor-demo-anna" && !isProtectedSandbox(workspaceId))
    throw new Error("Недоступно для этого кабинета");
  if (blob.size > MAX_FILE)
    throw new Error("Файл больше 20 МБ — выберите файл поменьше для локального примера");
  const id = crypto.randomUUID();
  if (isProtectedSandbox(workspaceId)) {
    sessionMedia.set(id, { workspaceId, blob });
    return id;
  }
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ id, workspaceId, blob, name });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).finally(() => db.close());
  return id;
}
async function readMedia(workspaceId: string, id: string): Promise<Blob | null> {
  if (isProtectedSandbox(workspaceId)) {
    const item = sessionMedia.get(id);
    return item?.workspaceId === workspaceId ? item.blob : null;
  }
  const db = await database();
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction("files", "readonly"),
      r = tx.objectStore("files").get(id);
    r.onsuccess = () => resolve(r.result?.workspaceId === workspaceId ? r.result.blob : null);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
export function useMessageMedia(workspaceId: string, message: ChatMessage) {
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let alive = true,
      objectUrl: string | null = null;
    setError(false);
    setUrl(null);
    if (!message.attachmentId) return;
    void readMedia(workspaceId, message.attachmentId)
      .then((blob) => {
        if (!alive) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        } else setError(true);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [workspaceId, message.attachmentId]);
  return {
    url: message.attachmentId ? url : message.url?.startsWith("https://") ? message.url : null,
    error,
  };
}
export function createExampleAdapter(workspaceId: string): MessageAdapter {
  function scope() {
    if (workspaceId !== "cantor-demo-anna" && !isProtectedSandbox(workspaceId))
      throw new Error("Локальный адаптер запрещён для рабочего кабинета");
  }
  return {
    kind: "sample",
    async send(input) {
      scope();
      return {
        id: `local-${input.requestId}`,
        requestId: input.requestId,
        leadId: input.leadId,
        author: "manager",
        text: input.text,
        at: new Date().toISOString(),
        delivery: "local",
        ...(input.quoteId ? { quoteId: input.quoteId } : {}),
        ...(input.attachment
          ? {
              kind: input.attachment.kind,
              attachmentId: input.attachment.id,
              fileName: input.attachment.name,
              mimeType: input.attachment.mimeType,
            }
          : { kind: "text" }),
      };
    },
    async edit(message, text) {
      scope();
      if (message.author !== "manager") throw new Error("Чужое сообщение нельзя изменить");
      return { ...message, text, delivery: "local", editedAt: new Date().toISOString() };
    },
  };
}

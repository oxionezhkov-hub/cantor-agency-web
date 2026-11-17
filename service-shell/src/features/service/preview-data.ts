export type PreviewDaily = {
  date: string;
  budget: number;
  views: number;
  contacts: number;
  diagnostics: number;
  sales: number;
  updatedAt: string;
};
export type PreviewAd = {
  id: string;
  title: string;
  city: string;
  price: number | null;
  status: string;
  url: string;
  description: string | null;
};
export type PreviewChat = {
  id: string;
  name: string;
  city?: string;
  itemId?: string;
  itemTitle?: string;
  lastAt: number;
  lastText?: string;
  lastAuthor?: string;
  messageCount?: number;
  messages?: PreviewMessage[];
};
export type PreviewMessage = { id: string; at: number; author: string; type: string; text: string };
export type PreviewSnapshot = {
  tutor: string;
  subject: string;
  readAt: string;
  catalogAt: number | null;
  chatsAt: number | null;
  ads: PreviewAd[];
  daily: PreviewDaily[];
  chats: PreviewChat[];
};
let snapshot: PreviewSnapshot | null = null;
let password = "";
export const getPreviewData = () => snapshot;
export function setPreviewData(data: PreviewSnapshot, credential: string) {
  snapshot = data;
  password = credential;
}
export async function readPreviewChat(id: string, signal?: AbortSignal): Promise<PreviewMessage[]> {
  const response = await fetch(`/api/demo/chat?id=${encodeURIComponent(id)}`, {
    headers: { "x-demo-password": password },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Не удалось загрузить переписку");
  const data = await response.json();
  return data.messages;
}
export function previewTotals(from: string, to: string) {
  const rows = snapshot?.daily.filter((r) => r.date >= from && r.date <= to) || [];
  return rows.reduce(
    (s, r) => ({
      budget: s.budget + r.budget,
      views: s.views + r.views,
      contacts: s.contacts + r.contacts,
      diagnostics: s.diagnostics + r.diagnostics,
      sales: s.sales + r.sales,
    }),
    { budget: 0, views: 0, contacts: 0, diagnostics: 0, sales: 0 },
  );
}

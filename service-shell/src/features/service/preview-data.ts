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
  photos?: string[];
  address?: string;
  autoloadId?: string;
  startsAt?: string;
  finishesAt?: string;
  attributes?: Record<string, string>;
  source?: "cantor" | "sheet";
  bidding?: {
    mode: string | null;
    currentRub: number | null;
    baseRub: number | null;
    minRub: number | null;
    maxRub: number | null;
    recommendedRub: number | null;
    compare: number | null;
    scale: { rub: number; compare: number; minForecast: number; maxForecast: number }[];
    dailyBudgetRub?: number | null;
  };
};
export type PreviewTraffic = { shows: number; views: number; contacts: number; spendRub: number };
export type PreviewAdDaily = PreviewTraffic & { date: string; adId: string; city: string };
export type PreviewPeriod = {
  from: string;
  to: string;
  items: (PreviewTraffic & { adId: string })[];
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
  workflowStage?: "new" | "booked" | "outcome" | "after" | "no_show" | "student" | "closed";
  reviewReason?: string;
  reviewedAt?: string;
  avatarUrl?: string;
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
  accountDaily?: (PreviewTraffic & { date: string })[];
  adDaily?: PreviewAdDaily[];
  trafficCoverage?: string[];
  periods?: PreviewPeriod[];
  defaultPeriod?: { from: string; to: string };
  feed?: {
    sheetUrl: string;
    tabs: string[];
    enabled: boolean;
    xmlUrl: string | null;
    builtAt: string | null;
    adCount: number;
    problems: { row?: number; id?: string; msg: string }[];
    report?: { status?: string; finishedAt?: string; published?: number; errors?: number };
    schedule?: string;
  };
  balance?: { real: number; bonus: number };
  tariff?: {
    active: boolean | null;
    lastPaidAt: string | null;
    paidUntil: string | null;
    autoRenew: boolean | null;
    amount: number | null;
  };
  history?: { at: string; text: string }[];
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
  const saved = rows.reduce(
    (s, r) => ({
      budget: s.budget + r.budget,
      views: s.views + r.views,
      contacts: s.contacts + r.contacts,
      diagnostics: s.diagnostics + r.diagnostics,
      sales: s.sales + r.sales,
    }),
    { budget: 0, views: 0, contacts: 0, diagnostics: 0, sales: 0 },
  );
  if (!snapshot?.accountDaily) return { ...saved, shows: NaN };
  return snapshot.accountDaily
    .filter((r) => r.date >= from && r.date <= to)
    .reduce(
      (s, r) => ({
        ...s,
        shows: s.shows + r.shows,
        views: s.views + r.views,
        contacts: s.contacts + r.contacts,
        budget: Math.round((s.budget + r.spendRub) * 100) / 100,
      }),
      { ...saved, budget: 0, views: 0, contacts: 0, shows: 0 },
    );
}
export function previewPeriod(from: string, to: string): PreviewPeriod | undefined {
  const cached = snapshot?.periods?.find((p) => p.from === from && p.to === to);
  if (cached) return cached;
  if (!snapshot?.adDaily || !snapshot.trafficCoverage) return undefined;
  for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 86400000)
    if (!snapshot.trafficCoverage.includes(new Date(ms).toISOString().slice(0, 10)))
      return undefined;
  const byAd = new Map<string, PreviewTraffic>();
  for (const row of snapshot.adDaily.filter((r) => r.date >= from && r.date <= to)) {
    const total = byAd.get(row.adId) || { shows: 0, views: 0, contacts: 0, spendRub: 0 };
    byAd.set(row.adId, {
      shows: total.shows + row.shows,
      views: total.views + row.views,
      contacts: total.contacts + row.contacts,
      spendRub: Math.round((total.spendRub + row.spendRub) * 100) / 100,
    });
  }
  return { from, to, items: [...byAd].map(([adId, total]) => ({ adId, ...total })) };
}
export function previewAdTotals(id: string) {
  const period = snapshot?.defaultPeriod || { from: "2026-11-01", to: "2026-11-17" };
  const report = previewPeriod(period.from, period.to);
  return report
    ? report.items.find((r) => r.adId === id) || { shows: 0, views: 0, contacts: 0, spendRub: 0 }
    : { shows: NaN, views: NaN, contacts: NaN, spendRub: NaN };
}
export const previewImageUrl = (adId: string, index: number) =>
  `/api/demo/image?adId=${encodeURIComponent(adId)}&index=${index}`;

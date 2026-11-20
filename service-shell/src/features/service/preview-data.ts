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
  liveConfirmedAt?: string;
  autoloadError?: string;
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
  lastMessageId?: string;
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
  live?: Record<string, LiveMeta>;
  liveMoney?: LiveMoney;
  tutor: string;
  tutorAvatarUrl?: string;
  subject: string;
  readAt: string;
  catalogAt: number | null;
  chatsAt: number | null;
  ads: PreviewAd[];
  daily: PreviewDaily[];
  chats: PreviewChat[];
  diagnosticBookings?: { date: string; adId: string | null }[];
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

export const PREVIEW_EVENT = "cantor-preview-live";
export type LiveMeta = {
  observedAt?: string;
  error?: string;
  origin?: string;
  coverage?: { complete?: boolean; truncated?: boolean; repeated?: boolean; nextOffset?:number|null };
  historical?: boolean;
};
export type LiveMoney = {
  wallet: {
    realRub: number | null;
    bonusRub: number | null;
    observedAt?: string;
    stale?: boolean;
  } | null;
  advance: { rub: number | null; observedAt?: string; stale?: boolean } | null;
  days: {
    date: string;
    shows: number | null;
    views: number | null;
    contacts: number | null;
    spendRub: number | null;
  }[];
  expenses?: { date: string; spendings: { type: string; rub: number | null }[] }[];
  errors?: { part: string; code: string; origin?: string }[];
  coverage: { complete: boolean; from?: string; to?: string; eligibleBalance?: string };
};
let liveRunning = false;
export async function refreshLivePreview(signal?: AbortSignal) {
  if (liveRunning || !snapshot) return;
  liveRunning = true;
  try {
    for (const section of ["ads", "autoload", "chats", "metrics"]) {
      if (signal?.aborted) return;
      try {
        const response = await fetch(`/api/demo/live?section=${section}`, {
          headers: { "x-demo-password": password },
          cache: "no-store",
          credentials: "same-origin",
          signal,
        });
        const body = await response.json(),
          value = response.ok ? body : body.lastGood;
        snapshot.live ??= {};
        snapshot.live[section] = {
          observedAt: value?.observedAt,
          error: response.ok ? undefined : body.error,
          origin: body.origin,
          coverage: value?.data?.coverage,
        };
        if (value?.data) {
          const data = value.data;
          if (section === "ads") {
            const old = new Map(snapshot.ads.map((a) => [a.id, a]));
            const fresh = data.ads.map((a: PreviewAd) => ({
              ...old.get(a.id),
              ...a,
              description: a.description ?? old.get(a.id)?.description ?? null,
              city: a.city || old.get(a.id)?.city || "",
              photos: old.get(a.id)?.photos,
              liveConfirmedAt: value.observedAt,
            }));
            const ids = new Set(fresh.map((a: PreviewAd) => a.id));
            snapshot.ads = [
              ...fresh,
              ...snapshot.ads
                .filter((a) => !ids.has(a.id))
                .map((a) => ({ ...a, liveConfirmedAt: undefined })),
            ];
            snapshot.catalogAt = Date.parse(value.observedAt);
          }
          if (section === "autoload") {
            const problems = (data.rows || []).flatMap(
              (r: { id: string; autoloadId: string; errors: string[] }) =>
                r.errors.map((msg) => ({ id: r.id || r.autoloadId, msg })),
            );
            snapshot.ads = snapshot.ads.map((a) => {
              const row = data.rows.find(
                (r: { id: string; autoloadId: string }) =>
                  (r.id && r.id === a.id) || (r.autoloadId && r.autoloadId === a.autoloadId),
              );
              return row
                ? { ...a, status: row.status || a.status, autoloadError: row.errors.join("; ") }
                : a;
            });
            snapshot.feed = {
              sheetUrl: snapshot.feed?.sheetUrl || "",
              tabs: snapshot.feed?.tabs || [],
              enabled: snapshot.feed?.enabled ?? false,
              xmlUrl: snapshot.feed?.xmlUrl || null,
              builtAt: value.observedAt,
              adCount: data.rows.length,
              problems,
              report: {
                status: data.report.status,
                finishedAt: data.report.finishedAt,
                errors: problems.length,
              },
              schedule: snapshot.feed?.schedule,
            };
          }
          if (section === "chats") {
            const old = new Map(snapshot.chats.map((c) => [c.id, c]));
            const fresh = data.chats.map((c: PreviewChat) => ({
              ...old.get(c.id),
              ...c,
              messages: old.get(c.id)?.messages || [],
            }));
            const ids = new Set(fresh.map((c: PreviewChat) => c.id));
            snapshot.chats = [...fresh, ...snapshot.chats.filter((c) => !ids.has(c.id))];
            snapshot.chatsAt = Date.parse(value.observedAt);
          }
          if (section === "metrics") {
            snapshot.liveMoney = data;
            const verified=data.days.filter((d:LiveMoney["days"][number])=>[d.shows,d.views,d.contacts,d.spendRub].every(v=>v!==null&&Number.isFinite(v))).map((d:LiveMoney["days"][number])=>({date:d.date,shows:d.shows!,views:d.views!,contacts:d.contacts!,spendRub:d.spendRub!}));
            const rows=new Map((snapshot.accountDaily||[]).map(r=>[r.date,r]));for(const row of verified)rows.set(row.date,row);snapshot.accountDaily=[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
          }
        }
        // Arrays are shared by existing screens; update provider rows without remounting editors.
        if (typeof window !== "undefined") window.dispatchEvent(new Event(PREVIEW_EVENT));
      } catch {
        if (signal?.aborted) return;
        snapshot.live ??= {};
        snapshot.live[section] = { ...snapshot.live[section], error: "network" };
        if (typeof window !== "undefined") window.dispatchEvent(new Event(PREVIEW_EVENT));
      }
    }
  } finally {
    liveRunning = false;
  }
}
export async function readLiveMessages(id: string, offset = 0, signal?: AbortSignal) {
  const response = await fetch(
    `/api/demo/live?section=messages&id=${encodeURIComponent(id)}&offset=${offset}`,
    {
      headers: { "x-demo-password": password },
      cache: "no-store",
      credentials: "same-origin",
      signal,
    },
  );
  const body = await response.json();
  if (!response.ok) {
    if (body.lastGood) return { ...body.lastGood, stale: true };
    throw new Error(
      body.error === "http_403"
        ? "Авито не разрешил чтение этой переписки"
        : "Не удалось обновить переписку; сохранённая история доступна",
    );
  }
  return body as {
    messages: PreviewMessage[];
    observedAt: string;
    stale?: boolean;
    coverage: { complete: boolean; nextOffset: number | null; truncated: boolean };
  };
}

export async function moreLiveChats(){
 if(!snapshot)return;const offset=snapshot.live?.chats?.coverage?.nextOffset;if(offset==null)return;
 const response=await fetch(`/api/demo/live?section=chats&offset=${offset}`,{headers:{"x-demo-password":password},credentials:"same-origin",cache:"no-store"});
 if(!response.ok)throw Error("Не удалось загрузить более ранние диалоги");const result=await response.json();
 const rows=new Map(snapshot.chats.map(c=>[c.id,c]));for(const c of result.data.chats)rows.set(c.id,{...rows.get(c.id),...c});snapshot.chats=[...rows.values()];
 snapshot.live!.chats={observedAt:result.observedAt,coverage:result.data.coverage};window.dispatchEvent(new Event(PREVIEW_EVENT));
}

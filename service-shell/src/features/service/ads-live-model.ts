import type { PreviewAd, PreviewTraffic } from "./preview-data.ts";
export const listingStatus = (status: string) =>
  ({
    active: "published",
    published: "published",
    old: "archived",
    archived: "archived",
    blocked: "blocked",
    rejected: "rejected",
    removed: "removed",
    draft: "draft",
  })[status] || "unknown";
export const statusOrder = (status: string) =>
  ({ published: 0, draft: 1, rejected: 2, blocked: 3, removed: 4, archived: 5 })[status] ?? 6;
export function liveListingFields(a: PreviewAd, traffic: PreviewTraffic | null) {
  return {
    id: a.id,
    title: a.title,
    text: a.description || "",
    city: a.city || "",
    price: a.price ?? NaN,
    status: listingStatus(a.status),
    source: a.source || ("cantor" as const),
    photos: (a.photos || []).map(
      (_, i) => `/api/demo/image?adId=${encodeURIComponent(a.id)}&index=${i}`,
    ),
    shows: traffic?.shows ?? NaN,
    views: traffic?.views ?? NaN,
    contacts: traffic?.contacts ?? NaN,
    spend: traffic?.spendRub ?? NaN,
    bid: a.bidding?.currentRub ?? NaN,
    max: a.bidding?.maxRub ?? NaN,
    budget: a.bidding?.dailyBudgetRub ?? NaN,
    mode: a.bidding?.mode || "",
    target: NaN,
    query: "",
    start: "",
    end: "",
    attributes: a.attributes || {},
    bidding: a.bidding,
    address: a.address,
    autoloadId: a.autoloadId,
    startsAt: a.startsAt,
    finishesAt: a.finishesAt,
  };
}

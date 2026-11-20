import type { Ad, Dialog, WindowSlot } from "./data.ts";
import type { SectionId } from "./sections.ts";

export const PHOTO_TARGET = 10;
export const TOP_PLACE = 20;
export const CONTACT_GOAL_MIN = 10;
export const CONTACT_GOAL_MAX = 12;
export const REPLY_LIMIT_MS = 30 * 60 * 1000;
export const SILENT_AFTER_MS = 3 * 60 * 60 * 1000; // Demo default for the base's first contact after several hours.

export function contactRate(views: number, contacts: number): number | null {
  if (!Number.isFinite(views) || !Number.isFinite(contacts)) return null;
  if (views <= 0 || contacts < 0) return null;
  return (contacts / views) * 100;
}

export function formatPercent(rate: number): string {
  return `${rate.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function inContactGoal(rate: number): boolean {
  return rate >= CONTACT_GOAL_MIN && rate <= CONTACT_GOAL_MAX;
}

export function missingSlotNames(filled: readonly string[], required: readonly string[]): string[] {
  const have = new Set(filled);
  return required.filter((name) => !have.has(name));
}

export function placeTone(place: number): "ok" | "bad" {
  return place > 0 && place <= TOP_PLACE ? "ok" : "bad";
}

export function replyLate(waitingSince: string | null, nowMs: number): boolean {
  if (!waitingSince) return false;
  const asked = Date.parse(waitingSince);
  if (!Number.isFinite(asked) || !Number.isFinite(nowMs)) return false;
  return nowMs - asked > REPLY_LIMIT_MS;
}

export function nudgeReady(dialog: Dialog, nowMs: number): boolean {
  if (!dialog.silentSince) return false;
  const since = Date.parse(dialog.silentSince);
  if (!Number.isFinite(since) || !Number.isFinite(nowMs)) return false;
  return nowMs - since >= SILENT_AFTER_MS;
}

export type ReminderState = "нет записи" | "в день встречи" | "пора напомнить" | "нужен исход встречи" | "дату не разобрать";

export function reminderState(startsAt: string | null, nowMs: number): ReminderState {
  if (!startsAt) return "нет записи";
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start) || !Number.isFinite(nowMs)) return "дату не разобрать";
  if (nowMs >= start) return "нужен исход встречи";
  const mskDay = (ms: number) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
  return mskDay(start) === mskDay(nowMs) ? "пора напомнить" : "в день встречи";
}

export function studentCost(spendRub: number, paymentCount: number): number | null {
  if (!Number.isFinite(spendRub) || spendRub < 0) return null;
  if (!Number.isInteger(paymentCount) || paymentCount <= 0) return null;
  return Math.round(spendRub / paymentCount);
}

export function promotionSpend(items: Ad[]): number {
  return items.reduce((sum, ad) => sum + (Number.isFinite(ad.spendRub) ? ad.spendRub : 0), 0);
}

export function attention(input: {
  ads: Ad[];
  dialogs: Dialog[];
  windows: WindowSlot[];
  photoSlots: readonly string[];
  blockedTitles: readonly string[];
  unpaid: number;
  nowMs: number;
}): Record<SectionId, number> {
  const blocked = new Set(input.blockedTitles);
  const adsShort = input.ads.filter((ad) => {
    const missing = missingSlotNames(ad.photos, input.photoSlots);
    return missing.length > 0 || !ad.offerHasDiagnostic || blocked.has(ad.title);
  }).length;
  const belowTop = input.ads.flatMap((ad) => ad.cities).filter((city) => city.place > TOP_PLACE).length;
  const autobidder = input.ads.filter((ad) => ad.autobidder).length;
  const weakContact = input.ads.filter((ad) => {
    const rate = contactRate(ad.views, ad.contacts);
    return rate !== null && rate < CONTACT_GOAL_MIN;
  }).length;
  const late = input.dialogs.filter((dialog) => replyLate(dialog.waitingSince, input.nowMs)).length;
  const nudges = input.dialogs.filter((dialog) => nudgeReady(dialog, input.nowMs)).length;
  const remind = input.windows.filter(
    (slot) => slot.takenBy && reminderState(slot.startsAt, input.nowMs) === "пора напомнить",
  ).length;
  return {
    today: 0,
    stats: weakContact + belowTop + autobidder + (input.unpaid > 0 ? input.unpaid : 0),
    ads: adsShort,
    chats: late + nudges + remind,
    learn: 0,
    acc: 0,
  };
}

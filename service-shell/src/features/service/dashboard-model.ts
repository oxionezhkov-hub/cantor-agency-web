import type { PreviewSnapshot, PreviewTraffic } from "./preview-data.ts";

export const moscowDay = (now: number) => new Date(now + 3 * 3600000).toISOString().slice(0, 10);
export const shiftDay = (day: string, offset: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);

export function dailyBrief(snapshot: PreviewSnapshot | null, now: number) {
  const yesterday = shiftDay(moscowDay(now), -1);
  // Only a complete calendar day is eligible. Missing days remain unknown.
  const rows =
    snapshot?.accountDaily ??
    snapshot?.daily.map((row) => ({
      date: row.date,
      shows: NaN,
      views: row.views,
      contacts: row.contacts,
      spendRub: row.budget,
    })) ??
    [];
  const day = rows
    .filter((row) => row.date <= yesterday)
    .map((row) => row.date)
    .sort()
    .at(-1);
  const total = (date: string): PreviewTraffic | null => {
    const found = rows.filter((row) => row.date === date);
    if (!found.length) return null;
    return found.reduce(
      (sum, row) => ({
        shows: sum.shows + row.shows,
        views: sum.views + row.views,
        contacts: sum.contacts + row.contacts,
        spendRub: Math.round((sum.spendRub + row.spendRub) * 100) / 100,
      }),
      { shows: 0, views: 0, contacts: 0, spendRub: 0 },
    );
  };
  return {
    day,
    yesterday,
    current: day ? total(day) : null,
    previous: day ? total(shiftDay(day, -1)) : null,
  };
}

export function dayLabel(day: string) {
  return new Date(`${day}T12:00:00+03:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  });
}

import { ads } from "./data.ts";
import type { CrmState } from "./crm.ts";

export type AnalyticsRange = { from: string; to: string };
export const ANALYTICS_COVERAGE: AnalyticsRange = { from: "2026-11-01", to: "2026-11-16" };
export const ANALYTICS_CITIES = ["Москва", "Область"] as const;
export type AdDailyStat = {
  date: string;
  adId: string;
  city: string;
  shows: number;
  views: number;
  contacts: number;
  spendRub: number;
};
export type MarketingTotals = {
  shows: number;
  views: number;
  contacts: number;
  spendRub: number;
  ctr: number | null;
  contactRate: number | null;
  cpc: number | null;
  cpl: number | null;
};
export type CrmTotals = {
  leads: number;
  completedAppointments: number;
  bookedAppointments: number;
  newStudents: number;
  receivedRub: number;
  refundedRub: number;
  netReceivedRub: number;
};
export type Coverage = { complete: boolean; daysWithData: number; daysRequested: number };
const DAY = 86_400_000;

function dateMs(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  )
    throw new Error("Укажите корректную дату");
  return parsed;
}
export function analyticsDates({ from, to }: AnalyticsRange): string[] {
  const start = dateMs(from),
    end = dateMs(to);
  if (end < start || end - start > DAY * 365) throw new Error("Выберите период от 1 до 366 дней");
  return Array.from({ length: Math.round((end - start) / DAY) + 1 }, (_, index) =>
    new Date(start + index * DAY).toISOString().slice(0, 10),
  );
}
export function previousAnalyticsRange(range: AnalyticsRange): AnalyticsRange {
  const days = analyticsDates(range).length;
  return {
    from: new Date(dateMs(range.from) - days * DAY).toISOString().slice(0, 10),
    to: new Date(dateMs(range.from) - DAY).toISOString().slice(0, 10),
  };
}
export function mskAnalyticsDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Некорректное время события");
  return new Date(timestamp + 3 * 3_600_000).toISOString().slice(0, 10);
}

// Illustrative daily/city breakdown, not an Avito export. Its integer totals reconcile
// exactly with the existing example ad cards. Bids and search positions are NOT traffic.
const weights = [3, 4, 3, 5, 4, 7, 6, 8, 6, 9, 8, 7, 9, 7, 8, 6];
function distribute(total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  let prefix = 0;
  return weights.map((weight) => {
    const before = Math.round((total * prefix) / sum);
    prefix += weight;
    return Math.round((total * prefix) / sum) - before;
  });
}
const fixtureGroups = [
  { adId: "ege", city: "Москва", shows: 920, views: 140, contacts: 8, spendRub: 2940 },
  { adId: "oge", city: "Москва", shows: 480, views: 116, contacts: 14, spendRub: 2260 },
  { adId: "oge", city: "Область", shows: 260, views: 62, contacts: 7, spendRub: 1220 },
];
export const DEMO_AD_DAILY: readonly AdDailyStat[] = fixtureGroups.flatMap((group) => {
  const shows = distribute(group.shows),
    views = distribute(group.views),
    contacts = distribute(group.contacts),
    spendRub = distribute(group.spendRub);
  return weights.map((_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, "0")}`,
    adId: group.adId,
    city: group.city,
    shows: shows[index],
    views: views[index],
    contacts: contacts[index],
    spendRub: spendRub[index],
  }));
});
const ratio = (numerator: number, denominator: number, scale = 1) =>
  denominator > 0 ? (numerator / denominator) * scale : null;
export function marketingTotals(rows: readonly AdDailyStat[]): MarketingTotals {
  const total = rows.reduce(
    (sum, row) => ({
      shows: sum.shows + row.shows,
      views: sum.views + row.views,
      contacts: sum.contacts + row.contacts,
      spendRub: sum.spendRub + row.spendRub,
    }),
    { shows: 0, views: 0, contacts: 0, spendRub: 0 },
  );
  return {
    ...total,
    ctr: ratio(total.views, total.shows, 100),
    contactRate: ratio(total.contacts, total.views, 100),
    cpc: ratio(total.spendRub, total.views),
    cpl: ratio(total.spendRub, total.contacts),
  };
}
function coverage(dates: string[]): Coverage {
  const daysWithData = dates.filter(
    (date) => date >= ANALYTICS_COVERAGE.from && date <= ANALYTICS_COVERAGE.to,
  ).length;
  return { complete: daysWithData === dates.length, daysWithData, daysRequested: dates.length };
}
const emptyCrm = (): CrmTotals => ({
  leads: 0,
  completedAppointments: 0,
  bookedAppointments: 0,
  newStudents: 0,
  receivedRub: 0,
  refundedRub: 0,
  netReceivedRub: 0,
});

// Payment attribution is available only when ALL recorded leads of a student have
// the same known ad. An unknown or ambiguous source is never assigned by guesswork.
function studentAd(state: CrmState, studentId: string): string | null {
  const sources = new Set(
    state.leads.filter((lead) => lead.studentId === studentId).map((lead) => lead.adId),
  );
  return sources.size === 1 ? [...sources][0] : null;
}
function crmRows(state: CrmState, range: AnalyticsRange, adId?: string) {
  const dates = analyticsDates(range);
  const cutoff = dateMs(range.to) + DAY - 3 * 3_600_000;
  const adMatches = (source: string | null | undefined) =>
    !adId || (adId === "unattributed" ? !source : source === adId);
  const rows = new Map(dates.map((date) => [date, emptyCrm()]));
  const within = (at: string) => rows.get(mskAnalyticsDate(at));
  for (const lead of state.leads) {
    if (!adMatches(lead.adId)) continue;
    const row = within(lead.createdAt);
    if (row) row.leads += 1;
  }
  for (const appointment of state.appointments) {
    const lead = state.leads.find((item) => item.id === appointment.leadId);
    if (!adMatches(lead?.adId)) continue;
    if (appointment.status === "completed" && appointment.completedAt) {
      const row = within(appointment.completedAt);
      if (row) row.completedAppointments += 1;
    } else if (appointment.status === "booked") {
      const row = within(appointment.startsAt);
      if (row) row.bookedAppointments += 1;
    }
  }
  // First payment with a positive unrefunded balance as of this report cutoff.
  // Later refunds never leak into an earlier report. Repeated payments count once.
  // Daily acquisition follows the same period-end snapshot so its sum reconciles.
  const firstPayment = new Map<string, CrmState["payments"][number]>();
  for (const payment of state.payments) {
    const returnedMinor = state.refunds
      .filter((refund) => refund.paymentId === payment.id && Date.parse(refund.refundedAt) < cutoff)
      .reduce((sum, refund) => sum + refund.amountMinor, 0);
    const existing = firstPayment.get(payment.studentId);
    if (
      Date.parse(payment.paidAt) < cutoff &&
      payment.amountMinor > returnedMinor &&
      (!existing || Date.parse(payment.paidAt) < Date.parse(existing.paidAt))
    )
      firstPayment.set(payment.studentId, payment);
    if (!adMatches(studentAd(state, payment.studentId))) continue;
    const row = within(payment.paidAt);
    if (row) row.receivedRub += payment.amountMinor / 100;
  }
  for (const payment of firstPayment.values()) {
    if (!adMatches(studentAd(state, payment.studentId))) continue;
    const row = within(payment.paidAt);
    if (row) row.newStudents += 1;
  }
  for (const refund of state.refunds) {
    const payment = state.payments.find((item) => item.id === refund.paymentId);
    if (!payment || !adMatches(studentAd(state, payment.studentId))) continue;
    const row = within(refund.refundedAt);
    if (row) row.refundedRub += refund.amountMinor / 100;
  }
  const daily = [...rows].map(([date, row]) => ({
    date,
    ...row,
    receivedRub: Math.round(row.receivedRub * 100) / 100,
    refundedRub: Math.round(row.refundedRub * 100) / 100,
    netReceivedRub: Math.round((row.receivedRub - row.refundedRub) * 100) / 100,
  }));
  const totals = daily.reduce(
    (sum, row) => ({
      leads: sum.leads + row.leads,
      completedAppointments: sum.completedAppointments + row.completedAppointments,
      bookedAppointments: sum.bookedAppointments + row.bookedAppointments,
      newStudents: sum.newStudents + row.newStudents,
      receivedRub: sum.receivedRub + row.receivedRub,
      refundedRub: sum.refundedRub + row.refundedRub,
      netReceivedRub: sum.netReceivedRub + row.netReceivedRub,
    }),
    emptyCrm(),
  );
  return {
    ...totals,
    receivedRub: Math.round(totals.receivedRub * 100) / 100,
    refundedRub: Math.round(totals.refundedRub * 100) / 100,
    netReceivedRub: Math.round(totals.netReceivedRub * 100) / 100,
    daily,
  };
}
export function buildAnalytics(
  input: AnalyticsRange & { crm: CrmState; adId?: string; city?: string },
) {
  const dates = analyticsDates(input),
    previousRange = previousAnalyticsRange(input),
    previousDates = analyticsDates(previousRange);
  const matches = (row: AdDailyStat) =>
    (!input.adId || row.adId === input.adId) && (!input.city || row.city === input.city);
  const selected = DEMO_AD_DAILY.filter(matches);
  const rows = selected.filter((row) => row.date >= input.from && row.date <= input.to);
  const previous = selected.filter(
    (row) => row.date >= previousRange.from && row.date <= previousRange.to,
  );
  const crm = input.city ? null : crmRows(input.crm, input, input.adId);
  return {
    totals: marketingTotals(rows),
    previousTotals: marketingTotals(previous),
    daily: dates.map((date) => ({
      date,
      ...marketingTotals(rows.filter((row) => row.date === date)),
      available: date >= ANALYTICS_COVERAGE.from && date <= ANALYTICS_COVERAGE.to,
    })),
    byAd: ads
      .filter((ad) => !input.adId || ad.id === input.adId)
      .map((ad) => ({
        id: ad.id,
        name: ad.title,
        ...marketingTotals(rows.filter((row) => row.adId === ad.id)),
      })),
    byCity: ANALYTICS_CITIES.filter((city) => !input.city || city === input.city).map((city) => ({
      id: city,
      name: city,
      ...marketingTotals(rows.filter((row) => row.city === city)),
    })),
    crm: crm
      ? {
          ...crm,
          byAd: [
            ...ads
              .filter((ad) => !input.adId || ad.id === input.adId)
              .map((ad) => ({ id: ad.id, name: ad.title, ...crmRows(input.crm, input, ad.id) })),
            ...(!input.adId
              ? [
                  {
                    id: "unattributed",
                    name: "Источник не указан",
                    ...crmRows(input.crm, input, "unattributed"),
                  },
                ]
              : []),
          ],
        }
      : null,
    previousCrm: input.city ? null : crmRows(input.crm, previousRange, input.adId),
    previousRange,
    coverage: coverage(dates),
    previousCoverage: coverage(previousDates),
  };
}

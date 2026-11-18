import test from "node:test";
import assert from "node:assert/strict";
import { ads } from "./data.ts";
import { demoCrm } from "./crm-demo.ts";
import { parseCrmState, recordPayment, recordRefund } from "./crm.ts";
import {
  ANALYTICS_COVERAGE,
  DEMO_AD_DAILY,
  adTitleFilter,
  analyticsDates,
  buildAnalytics,
  marketingTotals,
  mskAnalyticsDate,
  previousAnalyticsRange,
} from "./analytics-model.ts";
const report = (options: Partial<Parameters<typeof buildAnalytics>[0]> = {}) =>
  buildAnalytics({ ...ANALYTICS_COVERAGE, crm: demoCrm, ...options });

test("dated city fixtures reconcile with every existing ad, all integers and sane counts", () => {
  for (const ad of ads) {
    const total = marketingTotals(DEMO_AD_DAILY.filter((row) => row.adId === ad.id));
    assert.deepEqual(
      [total.shows, total.views, total.contacts, total.spendRub],
      [ad.shows, ad.views, ad.contacts, ad.spendRub],
    );
  }
  for (const row of DEMO_AD_DAILY) {
    assert.ok(
      [row.shows, row.views, row.contacts, row.spendRub].every(
        (value) => Number.isInteger(value) && value >= 0,
      ),
    );
    assert.ok(row.contacts <= row.views && row.views <= row.shows);
  }
  assert.deepEqual(
    [
      report().totals.shows,
      report().totals.views,
      report().totals.contacts,
      report().totals.spendRub,
    ],
    [1660, 318, 29, 6420],
  );
});
test("weighted ratios use sum of numerators/denominators and zero denominators stay unavailable", () => {
  const rows = [
    { date: "2026-11-01", adId: "x", city: "a", shows: 10, views: 10, contacts: 5, spendRub: 100 },
    { date: "2026-11-01", adId: "y", city: "a", shows: 990, views: 90, contacts: 5, spendRub: 900 },
  ];
  const total = marketingTotals(rows);
  assert.equal(total.ctr, 10);
  assert.equal(total.contactRate, 10);
  assert.equal(total.cpc, 10);
  assert.equal(total.cpl, 100);
  const empty = marketingTotals([]);
  assert.deepEqual([empty.ctr, empty.contactRate, empty.cpc, empty.cpl], [null, null, null, null]);
});
test("inclusive range partitions match full totals and all grouping totals reconcile", () => {
  const full = report(),
    first = report({ to: "2026-11-08" }),
    second = report({ from: "2026-11-09" });
  for (const key of ["shows", "views", "contacts", "spendRub"] as const) {
    assert.equal(first.totals[key] + second.totals[key], full.totals[key]);
    assert.equal(
      full.byCity.reduce((sum, row) => sum + row[key], 0),
      full.totals[key],
    );
    assert.equal(
      full.byAd.reduce((sum, row) => sum + row[key], 0),
      full.totals[key],
    );
    assert.equal(
      full.daily.reduce((sum, row) => sum + row[key], 0),
      full.totals[key],
    );
  }
  assert.equal(report({ from: "2026-11-10", to: "2026-11-10" }).daily.length, 1);
});
test("combined ad and city filters apply consistently and never fabricate CRM city attribution", () => {
  const selected = report({ adId: "oge", city: "Область" });
  assert.deepEqual(
    [
      selected.totals.shows,
      selected.totals.views,
      selected.totals.contacts,
      selected.totals.spendRub,
    ],
    [260, 62, 7, 1220],
  );
  assert.equal(selected.byAd.length, 1);
  assert.equal(selected.byCity.length, 1);
  assert.equal(selected.crm, null);
  assert.equal(selected.previousCrm, null);
  assert.equal(report({ adId: "ege", city: "Область" }).totals.views, 0);
  assert.equal(report({ adId: "alg" }).totals.cpl, null);
});
test("coverage distinguishes absence of dated data from actual zero activity", () => {
  const full = report();
  assert.equal(full.coverage.complete, true);
  assert.equal(full.previousCoverage.complete, false);
  assert.equal(full.previousCoverage.daysWithData, 0);
  const partial = report({ from: "2026-10-31", to: "2026-11-02" });
  assert.deepEqual(partial.coverage, { complete: false, daysRequested: 3, daysWithData: 2 });
  assert.equal(partial.daily[0].available, false);
  assert.equal(
    report({ adId: "alg" }).daily.every((day) => day.available && day.views === 0),
    true,
  );
});
test("previous period has equal inclusive length and works across calendar boundaries", () => {
  assert.deepEqual(previousAnalyticsRange({ from: "2026-11-09", to: "2026-11-16" }), {
    from: "2026-11-01",
    to: "2026-11-08",
  });
  assert.deepEqual(previousAnalyticsRange({ from: "2026-01-01", to: "2026-01-01" }), {
    from: "2025-12-31",
    to: "2025-12-31",
  });
  assert.equal(analyticsDates({ from: "2024-02-28", to: "2024-03-01" }).length, 3);
});
test("invalid ranges cannot overflow or silently normalize invalid dates", () => {
  for (const range of [
    { from: "2026-02-29", to: "2026-03-01" },
    { from: "2026-11-02", to: "2026-11-01" },
    { from: "2026-1-01", to: "2026-11-01" },
    { from: "2020-01-01", to: "2026-11-01" },
  ])
    assert.throws(() => analyticsDates(range));
});
test("CRM events use inclusive Moscow calendar days at UTC boundary", () => {
  const state = recordPayment(demoCrm, demoCrm.workspaceId, {
    id: "boundary",
    studentId: "student-kirill",
    requestId: "boundary",
    amountMinor: 12345,
    paidAt: "2026-11-15T21:00:00Z",
  });
  assert.equal(mskAnalyticsDate("2026-11-15T20:59:59Z"), "2026-11-15");
  assert.equal(mskAnalyticsDate("2026-11-15T21:00:00Z"), "2026-11-16");
  assert.equal(
    report({ crm: state, from: "2026-11-16", to: "2026-11-16" }).crm?.receivedRub,
    123.45,
  );
  assert.equal(report({ crm: state, from: "2026-11-15", to: "2026-11-15" }).crm?.receivedRub, 0);
});
test("daily CRM cash flow reconciles, refunds dated independently and repeat payments do not acquire twice", () => {
  let state = recordPayment(demoCrm, demoCrm.workspaceId, {
    id: "repeat",
    studentId: "student-ege",
    amountMinor: 12345,
    paidAt: "2026-11-15T10:00:00Z",
    requestId: "repeat",
  });
  state = recordRefund(state, state.workspaceId, {
    id: "refund",
    paymentId: "payment-ege",
    amountMinor: 480000,
    refundedAt: "2026-11-16T10:00:00Z",
    requestId: "refund",
  });
  const all = report({ crm: state }).crm!;
  assert.equal(all.newStudents, 2);
  assert.equal(all.receivedRub, 9723.45);
  assert.equal(all.refundedRub, 4800);
  assert.equal(all.netReceivedRub, 4923.45);
  assert.equal(
    report({ crm: state, from: "2026-11-10", to: "2026-11-10" }).crm?.netReceivedRub,
    4800,
  );
  assert.equal(
    report({ crm: state, from: "2026-11-16", to: "2026-11-16" }).crm?.netReceivedRub,
    -4800,
  );
  assert.equal(
    Math.round(all.daily.reduce((sum, day) => sum + day.netReceivedRub, 0) * 100),
    492345,
  );
});
test("CRM counts completed events independently from payments and preserves unattributed revenue", () => {
  const all = report().crm!,
    ege = report({ adId: "ege" }).crm!,
    oge = report({ adId: "oge" }).crm!;
  assert.equal(all.leads, 7);
  assert.equal(all.completedAppointments, 3);
  assert.equal(all.newStudents, 2);
  assert.equal(ege.leads, 2);
  assert.equal(ege.completedAppointments, 1);
  assert.equal(oge.receivedRub, 4800);
  const state = recordPayment(demoCrm, demoCrm.workspaceId, {
    id: "unknown",
    studentId: "student-kirill",
    amountMinor: 10000,
    paidAt: "2026-11-15T10:00:00Z",
    requestId: "unknown",
  });
  assert.equal(report({ crm: state }).crm?.receivedRub, 9700);
  assert.equal(
    report({ crm: state }).crm?.byAd.reduce((sum, row) => sum + row.receivedRub, 0),
    9700,
  );
  assert.equal(
    report({ crm: state }).crm?.byAd.find((row) => row.id === "unattributed")?.receivedRub,
    100,
  );
});
test("ambiguous student source never duplicates payment revenue between ads", () => {
  const state = parseCrmState({
    ...demoCrm,
    leads: [...demoCrm.leads, { ...demoCrm.leads[0], id: "second-source", adId: "oge" }],
  });
  assert.equal(report({ crm: state }).crm?.receivedRub, 9600);
  assert.equal(report({ crm: state, adId: "ege" }).crm?.receivedRub, 0);
  assert.equal(report({ crm: state, adId: "oge" }).crm?.receivedRub, 4800);
});

test("first active payment uses report cutoff, and later full refunds never rewrite an older report", () => {
  const refunded = recordRefund(demoCrm, demoCrm.workspaceId, {
    id: "future-refund",
    paymentId: "payment-ege",
    amountMinor: 480000,
    refundedAt: "2026-11-16T10:00:00Z",
    requestId: "future-refund",
  });
  assert.equal(report({ crm: refunded, from: "2026-11-01", to: "2026-11-15" }).crm?.newStudents, 2);
  assert.equal(report({ crm: refunded }).crm?.newStudents, 1);
  const renewed = recordPayment(refunded, refunded.workspaceId, {
    id: "renewed",
    studentId: "student-ege",
    amountMinor: 10000,
    paidAt: "2026-11-16T12:00:00Z",
    requestId: "renewed",
  });
  assert.equal(report({ crm: renewed }).crm?.newStudents, 2);
  assert.equal(
    report({ crm: renewed }).crm?.daily.find((row) => row.date === "2026-11-10")?.newStudents,
    0,
  );
  assert.equal(
    report({ crm: renewed }).crm?.daily.find((row) => row.date === "2026-11-16")?.newStudents,
    1,
  );
  assert.equal(report({ crm: renewed, from: "2026-11-01", to: "2026-11-15" }).crm?.newStudents, 2);
});
test("unattributed CRM source makes report rows reconcile without duplicating ambiguous students", () => {
  const total = report().crm!;
  for (const key of [
    "leads",
    "completedAppointments",
    "newStudents",
    "receivedRub",
    "refundedRub",
    "netReceivedRub",
  ] as const)
    assert.equal(
      total.byAd.reduce((sum, row) => sum + row[key], 0),
      total[key],
    );
  assert.equal(total.byAd.find((row) => row.id === "unattributed")?.completedAppointments, 1);
});

test("ad-by-city rows reconcile with ad and city summaries under combined filters", () => {
  for (const options of [
    {},
    { adId: "oge" },
    { city: "Москва" },
    { adId: "oge", city: "Область" },
  ]) {
    const result = report(options);
    for (const key of ["shows", "views", "contacts", "spendRub"] as const) {
      assert.equal(
        result.byAdCity.reduce((sum, row) => sum + row[key], 0),
        result.totals[key],
      );
      for (const ad of result.byAd)
        assert.equal(
          result.byAdCity
            .filter((row) => row.adId === ad.id)
            .reduce((sum, row) => sum + row[key], 0),
          ad[key],
        );
    }
  }
});


test("a title filter combines every matching ad and attributed CRM events", () => {
  const original = ads[1].title;
  ads[1].title = ads[0].title;
  try {
    const first = report({ adId: ads[0].id });
    const second = report({ adId: ads[1].id });
    const group = report({ adId: adTitleFilter(ads[0].title) });
    for (const metric of ["shows", "views", "contacts", "spendRub"] as const)
      assert.equal(group.totals[metric], first.totals[metric] + second.totals[metric]);
    for (const metric of ["leads", "completedAppointments", "newStudents", "receivedRub"] as const)
      assert.equal(group.crm![metric], first.crm![metric] + second.crm![metric]);
    assert.equal(group.byAd.length, 2);
    const groupedCity = report({ adId: adTitleFilter(ads[0].title), city: "Москва" });
    assert.equal(groupedCity.totals.views, 256);
    assert.equal(groupedCity.crm, null);
  } finally {
    ads[1].title = original;
  }
});

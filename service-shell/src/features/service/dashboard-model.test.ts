import test from "node:test";
import assert from "node:assert/strict";
import { dailyBrief, moscowDay } from "./dashboard-model.ts";
import type { PreviewSnapshot } from "./preview-data.ts";

const snapshot = (rows: { date: string; contacts: number }[]) =>
  ({
    accountDaily: rows.map((row) => ({ ...row, views: 20, shows: 100, spendRub: 10.25 })),
  }) as PreviewSnapshot;

test("morning brief uses Moscow boundaries and excludes the unfinished day", () => {
  const now = Date.parse("2026-11-17T21:10:00Z");
  assert.equal(moscowDay(now), "2026-11-18");
  const brief = dailyBrief(
    snapshot([
      { date: "2026-11-17", contacts: 0 },
      { date: "2026-11-18", contacts: 8 },
    ]),
    now,
  );
  assert.equal(brief.day, "2026-11-17");
  assert.equal(brief.current?.contacts, 0);
  assert.equal(brief.previous, null);
});

test("old data keeps its date and a missing comparison day is not treated as zero", () => {
  const brief = dailyBrief(
    snapshot([
      { date: "2026-11-14", contacts: 2 },
      { date: "2026-11-16", contacts: 5 },
    ]),
    Date.parse("2026-11-18T09:00:00Z"),
  );
  assert.equal(brief.day, "2026-11-16");
  assert.notEqual(brief.day, brief.yesterday);
  assert.equal(brief.previous, null);
  assert.equal(brief.current?.spendRub, 10.25);
});

test("no data is unknown; consecutive days can be compared", () => {
  assert.equal(dailyBrief(null, Date.now()).current, null);
  const brief = dailyBrief(
    snapshot([
      { date: "2026-11-16", contacts: 2 },
      { date: "2026-11-17", contacts: 5 },
    ]),
    Date.parse("2026-11-18T09:00:00Z"),
  );
  assert.equal(brief.current!.contacts - brief.previous!.contacts, 3);
});

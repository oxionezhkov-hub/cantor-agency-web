import test from "node:test";
import assert from "node:assert/strict";
import { fundsEstimate } from "./live-funds-model.ts";
import type { LiveMoney } from "./preview-data.ts";
const now = Date.parse("2026-11-20T10:00:00Z"),
  at = new Date(now).toISOString();
const data: LiveMoney = {
  wallet: { realRub: 1000, bonusRub: 500 },
  advance: { rub: 3000 },
  days: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-11-${i + 1}`,
    shows: 1,
    views: 1,
    contacts: 0,
    spendRub: 100,
  })),
  coverage: { complete: true, eligibleBalance: "unverified" },
};
test("separate wallet/advance, no guessed eligible balance or bonus sum", () => {
  assert.equal(fundsEstimate(data, at, now).available, false);
  const r = fundsEstimate(
    { ...data, coverage: { complete: true, eligibleBalance: "wallet_real" } },
    at,
    now,
  );
  assert.equal(r.available, true);
  if (r.available) assert.equal(r.remainingDays, 10);
  const a = fundsEstimate(
    { ...data, coverage: { complete: true, eligibleBalance: "advance_cpa" } },
    at,
    now,
  );
  if (a.available) assert.equal(a.remainingDays, 30);
});
test("missing, zero, stale and incomplete data do not invent estimates", () => {
  assert.equal(fundsEstimate(undefined, undefined, now).available, false);
  assert.equal(fundsEstimate(data, new Date(now - 700000).toISOString(), now).available, false);
  assert.equal(fundsEstimate({ ...data, coverage: { complete: false } }, at, now).available, false);
  assert.equal(
    fundsEstimate({ ...data, days: data.days.map((d) => ({ ...d, spendRub: 0 })) }, at, now)
      .available,
    false,
  );
  const zero = fundsEstimate(
    {
      ...data,
      wallet: { realRub: 0, bonusRub: 500 },
      coverage: { complete: true, eligibleBalance: "wallet_real" },
    },
    at,
    now,
  );
  assert.equal(zero.available, true);
  if (zero.available) assert.equal(zero.remainingDays, 0);
});
test("stale individual wallet cannot borrow freshness from advance", () => {
  const r = fundsEstimate(
    {
      ...data,
      wallet: { realRub: 1000, bonusRub: 0, stale: true },
      coverage: { complete: true, eligibleBalance: "wallet_real" },
    },
    at,
    now,
  );
  assert.equal(r.available, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  balanceRows,
  blockRows,
  daysUntil,
  reserveDays,
  subscriptionRows,
} from "./rules.ts";

const NOW = new Date("2026-11-15T14:19:00.000Z");

test("reserve days is advance divided by yesterday spend", () => {
  assert.equal(reserveDays(2100, 840), 2.5);
});

test("zero or negative spend cannot be divided", () => {
  assert.equal(reserveDays(2100, 0), null);
  assert.equal(reserveDays(2100, -10), null);
});

test("empty or negative advance is zero days, not a negative reserve", () => {
  assert.equal(reserveDays(0, 840), 0);
  assert.equal(reserveDays(-4, 840), 0);
});

test("non-numbers do not become a reserve", () => {
  assert.equal(reserveDays(Number.NaN, 840), null);
  assert.equal(reserveDays(2100, Number.POSITIVE_INFINITY), null);
});

test("subscription is active only while whole days remain", () => {
  const rows = subscriptionRows(
    {
      planName: "Профессиональный план",
      paidUntil: "2026-12-02",
      lastPaidAt: "2026-11-02",
      autoRenew: true,
    },
    NOW,
  );
  assert.equal(rows.find((row) => row.label === "Статус")?.value, "активна");
  assert.equal(rows.find((row) => row.label === "Осталось")?.value, "17 дней");
  assert.equal(rows.find((row) => row.label === "Оплачена до")?.value, "2 декабря");
});

test("subscription on the paid-until date is already inactive", () => {
  const rows = subscriptionRows(
    { planName: "План", paidUntil: "2026-11-15", lastPaidAt: "2026-10-15", autoRenew: false },
    NOW,
  );
  assert.equal(rows.find((row) => row.label === "Статус")?.value, "не активна");
  assert.equal(daysUntil("not-a-date", NOW), null);
});

test("balance below three days is marked", () => {
  const rows = balanceRows({
    advanceRub: 2100,
    yesterdayPromotionRub: 840,
    autoTopUp: false,
    walletRealRub: 120,
    walletBonusRub: 0,
  });
  const reserve = rows.find((row) => row.label === "Хватит");
  assert.equal(reserve?.value, "на 2,5 дня");
  assert.equal(reserve?.tone, "bad");
  assert.equal(rows.find((row) => row.label === "Кошелёк")?.value, "120 ₽");
});

test("no yesterday spend does not invent a reserve", () => {
  const rows = balanceRows({
    advanceRub: 2100,
    yesterdayPromotionRub: 0,
    autoTopUp: true,
    walletRealRub: 0,
    walletBonusRub: 0,
  });
  assert.equal(rows.find((row) => row.label === "Хватит")?.value, "не посчитать");
  assert.equal(rows.find((row) => row.label === "Кто пополняет")?.value, "само");
});

test("block rows show evidence and do not invent an hour to fix a block", () => {
  const rows = blockRows(
    {
      cabinetBlocked: false,
      items: [{ title: "Математика ЕГЭ", kind: "blocked", foundAt: "2026-11-15T13:40:00.000Z" }],
    },
    Date.parse("2026-11-15T14:15:00.000Z"),
  );
  assert.match(rows[1]?.detail || "", /Обнаружено.*МСК.*причину/);
  assert.doesNotMatch(rows[1]?.detail || "", /ещё|час прошёл/);
  assert.equal(rows.find((row) => row.label === "Отклонённые")?.value, "нет");
  assert.equal(rows.find((row) => row.label === "Снятые")?.value, "нет");
});

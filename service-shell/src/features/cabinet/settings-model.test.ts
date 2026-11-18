import test from "node:test";
import assert from "node:assert/strict";
import { monthlyPrice, paymentPrice, paidThrough, settingsPage } from "./settings-model.ts";
test("constructor modules add and remove costs; annual billing has no discount", () => {
  assert.equal(monthlyPrice(0, [false, false, false]), 1990);
  assert.equal(monthlyPrice(0, [true, false, true]), 6470);
  assert.equal(monthlyPrice(0, [true, true, true]), 7460);
  assert.equal(paymentPrice(0, [true, false, true], true), 6470 * 12);
  assert.equal(paymentPrice(1, [false, false, false], true), 9990 * 12);
});
test("premium includes the first-month setup difference only for the first payment", () => {
  assert.equal(paymentPrice(2, [], false, true), 50000);
  assert.equal(paymentPrice(2, [], true, true), 325000);
  assert.equal(paymentPrice(2, [], true, false), 300000);
});
test("period ends at the valid calendar date; unknown settings focus opens cabinet", () => {
  assert.equal(paidThrough(false, new Date(2026, 0, 31)).getDate(), 28);
  assert.equal(paidThrough(true, new Date(2024, 1, 29)).getDate(), 28);
  assert.equal(settingsPage("unknown"), "cabinet");
  assert.equal(settingsPage("tariff"), "tariff");
});

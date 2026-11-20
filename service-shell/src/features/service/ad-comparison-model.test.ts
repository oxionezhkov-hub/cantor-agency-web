import assert from "node:assert/strict";
import { test } from "node:test";
import { comparisonNumber, comparisonRatio } from "./ad-comparison-model.ts";
test("comparison preserves measured zero and distinguishes missing data", () => {
  assert.equal(comparisonNumber(0), "0");
  assert.equal(comparisonNumber(undefined), "Нет данных");
  assert.equal(comparisonNumber(NaN), "Нет данных");
  assert.equal(comparisonRatio(0, 100), 0);
  assert.equal(comparisonRatio(10, 100), 0.1);
  assert.equal(comparisonRatio(100, 4), 25);
});
test("rates and CPL require positive known denominators and valid numerators", () => {
  for (const d of [0, NaN, undefined, -1]) assert.equal(comparisonRatio(100, d), null);
  for (const n of [NaN, undefined, -1]) assert.equal(comparisonRatio(n, 10), null);
});

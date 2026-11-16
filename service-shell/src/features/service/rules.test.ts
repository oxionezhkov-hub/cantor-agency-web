import assert from "node:assert/strict";
import test from "node:test";
import { ads, dialogs } from "./data.ts";
import {
  contactRate,
  formatPercent,
  inContactGoal,
  missingSlotNames,
  nudgeReady,
  placeTone,
  reminderState,
  replyLate,
  studentCost,
} from "./rules.ts";

test("contact rate is empty when there are no views", () => {
  assert.equal(contactRate(0, 0), null);
  assert.equal(contactRate(-1, 2), null);
  assert.equal(contactRate(Number.NaN, 1), null);
});

test("goal band is 10 to 12 inclusive", () => {
  assert.equal(inContactGoal(10), true);
  assert.equal(inContactGoal(12), true);
  assert.equal(inContactGoal(9.9), false);
  assert.equal(inContactGoal(12.1), false);
  assert.equal(formatPercent(8 / 1.4), "5,7%");
});

test("a photo counts only when its slot name is present", () => {
  const required = ["Репетитор", "Доска", "Формат"];
  assert.deepEqual(missingSlotNames(["Репетитор", "Формат", "Тетрадь"], required), ["Доска"]);
  assert.deepEqual(missingSlotNames(["Репетитор", "Доска", "Формат", "Лишнее"], required), []);
  assert.equal(missingSlotNames([], required).length, 3);
});

test("place inside top 20 is fine, past it is not", () => {
  assert.equal(placeTone(20), "ok");
  assert.equal(placeTone(21), "bad");
  assert.equal(placeTone(0), "bad");
});

test("a reply past 30 minutes is late, an empty wait is not", () => {
  const now = Date.parse("2026-11-16T06:45:00.000Z");
  assert.equal(replyLate("2026-11-16T06:30:00.000Z", now), false);
  assert.equal(replyLate("2026-11-16T05:50:00.000Z", now), true);
  assert.equal(replyLate(null, now), false);
  assert.equal(replyLate("nope", now), false);
});

test("silent dialogue can be reviewed after several hours, while an unanswered inbound needs a reply", () => {
  const now = Date.parse("2026-11-16T06:45:00.000Z");
  const olga = dialogs.find((dialog) => dialog.id === "olga");
  const marina = dialogs.find((dialog) => dialog.id === "marina");
  assert.ok(olga);
  assert.ok(marina);
  assert.equal(nudgeReady(olga, now), true);
  assert.equal(nudgeReady(marina, now), false);
});

test("meeting reminder follows the Moscow day, not an invented three-hour threshold", () => {
  const start = Date.parse("2026-11-19T16:00:00.000Z");
  assert.equal(reminderState("2026-11-19T16:00:00.000Z", start - 20 * 60 * 60 * 1000), "в день встречи");
  assert.equal(reminderState("2026-11-19T16:00:00.000Z", start - 4 * 60 * 60 * 1000), "пора напомнить");
  assert.equal(reminderState("2026-11-19T16:00:00.000Z", start - 2 * 60 * 60 * 1000), "пора напомнить");
  assert.equal(reminderState("2026-11-19T16:00:00.000Z", start), "нужен исход встречи");
  assert.equal(reminderState(null, start), "нет записи");
});

test("student cost needs at least one payment", () => {
  assert.equal(studentCost(6420, 0), null);
  assert.equal(studentCost(6420, 2), 3210);
  assert.equal(studentCost(-1, 2), null);
});

test("sample ads keep one contact total", () => {
  const views = ads.reduce((sum, ad) => sum + ad.views, 0);
  const contacts = ads.reduce((sum, ad) => sum + ad.contacts, 0);
  assert.equal(views, 318);
  assert.equal(contacts, 29);
  assert.equal(formatPercent(contactRate(views, contacts) ?? 0), "9,1%");
});

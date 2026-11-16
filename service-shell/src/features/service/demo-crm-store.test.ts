import test from "node:test";
import assert from "node:assert/strict";
import { CRM_KEY, changeDemoCrm, migrateLegacyDemo, readDemoCrm } from "./demo-crm-store.ts";
import { demoCrm } from "./crm-demo.ts";
import { monthRangeMsk, periodMetrics } from "./crm.ts";
test("legacy demo entries migrate to known IDs without interpreting unknown names as people", () => {
  const state = migrateLegacyDemo(
    [
      { who: "Кирилл", amountRub: 1234 },
      { who: "Кто-то", amountRub: 500 },
      { who: "Кирилл", amountRub: -1 },
    ],
    { tue: "Игорь", unknown: "Марина" },
    "2026-11-16T10:00:00Z",
  );
  assert.equal(state.payments.length, 3);
  assert.equal(state.payments[2].studentId, "student-kirill");
  assert.equal(state.appointments.length, 5);
  assert.equal(periodMetrics(state, ...monthRangeMsk(2026, 10)).completedAppointments, 3);
});
test("corrupted storage is not silently replaced; failed writes do not emit success", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map([[CRM_KEY, "{broken"]]);
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) || null,
      setItem: () => {
        writes++;
        throw new Error("quota");
      },
    },
  });
  try {
    assert.throws(() => readDemoCrm());
    assert.throws(() => changeDemoCrm((state) => state));
    assert.equal(writes, 0);
    assert.equal(data.get(CRM_KEY), "{broken");
    data.set(CRM_KEY, JSON.stringify(demoCrm));
    assert.throws(() => changeDemoCrm((state) => state), /quota/);
    assert.equal(writes, 1);
    assert.equal(data.get(CRM_KEY), JSON.stringify(demoCrm));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { getAdPreflightWarnings } from "./ad-preflight.ts";

const base = { title: "Репетитор по математике", price: 2000, text: "" };

test("flags an explicit lesson price in the copy and clears a corrected mismatch", () => {
  const text = "Стоимость занятия — от 1 500 ₽.";
  assert.match(getAdPreflightWarnings({ ...base, text })[0], /В тексте указано 1\s500/);
  assert.deepEqual(getAdPreflightWarnings({ ...base, text, price: 1500 }), []);
  assert.match(
    getAdPreflightWarnings({ ...base, title: "Математика — 1500 руб. за урок" })[0],
    /В заголовке/,
  );
});

test("ignores unrelated prices, multiple rates and unavailable price fields", () => {
  const text = "В группе — 800 ₽ за урок. Индивидуально — 2000 ₽ за урок. Учебник — 500 ₽.";
  assert.deepEqual(getAdPreflightWarnings({ ...base, text }), []);
  assert.deepEqual(getAdPreflightWarnings({ ...base, text: "Учебник — 500 ₽." }), []);
  assert.deepEqual(
    getAdPreflightWarnings({ ...base, price: NaN, text: "Стоимость занятия — 1 500 ₽." }),
    [],
  );
});

test("compares explicit modes and skips a combination of formats", () => {
  const attributes = { "Формат занятий": "Онлайн" };
  assert.match(
    getAdPreflightWarnings({ ...base, attributes, text: "Формат занятий: очно" })[0],
    /«онлайн».+«очно»/,
  );
  assert.deepEqual(
    getAdPreflightWarnings({ ...base, attributes, text: "Формат занятий: очно и онлайн" }),
    [],
  );
  assert.match(
    getAdPreflightWarnings({ ...base, title: "Формат: очно", text: "Занятия только онлайн." })[0],
    /заголовок.+текст/,
  );
});

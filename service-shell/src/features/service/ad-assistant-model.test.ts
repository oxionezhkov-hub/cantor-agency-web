import assert from "node:assert/strict";
import { test } from "node:test";
import { adVariants, checkAdVariants, recommendAdSettings } from "./ad-assistant-model.ts";

test("phrase choices create stable, distinct drafts without unresolved tokens", () => {
  const cities = ["Казань", "Омск", "Тверь", "Самара"];
  const text =
    "{Разберём ОГЭ|Подготовимся к экзамену}\n\nЗанятия онлайн.\n\n{Напишите в чат|Расскажите о задаче в чате}";
  const variants = adVariants(text, cities);
  assert.equal(new Set(variants).size, 4);
  assert.ok(variants.every((value) => !/[{}|]/.test(value)));
  assert.deepEqual(adVariants(text, cities), variants);
  assert.match(
    checkAdVariants("Русский язык", variants, 1000, cities, [
      { title: "Русский язык", text: "", city: "Казань" },
    ]).warnings[0],
    /Казань/,
  );
  assert.match(
    checkAdVariants("Русский язык", ["Стоимость занятия — 1500 ₽."], 1000, ["Казань"], [])
      .errors[0],
    /Сверьте/,
  );
});

test("recommendations separate measured contacts from unknowns and use known prices", () => {
  const result = recommendAdSettings([
    { city: "Казань", contacts: 3, views: 40, price: 1500 },
    { city: "казань", contacts: 2, views: 25, price: 1800 },
    { city: "Омск", contacts: 1, views: 10, price: 2000 },
    { city: "Самара", contacts: NaN, views: 10, price: NaN },
  ]);
  assert.deepEqual(result.cities[0], { city: "Казань", contacts: 5, views: 65 });
  assert.equal(result.price, 1800);
  assert.equal(result.samples, 3);
});

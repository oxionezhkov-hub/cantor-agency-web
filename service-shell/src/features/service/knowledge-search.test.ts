import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesLesson, searchExcerpt, highlightedParts, materialCount } from "../knowledge/search.ts";

const lesson = { title: "Диалоги", description: "Первое сообщение", searchText: "Проверяйте отчёт по объявлениям. Сравните расходы на продвижение и число контактов, прежде чем менять ставку." };
test("knowledge search supports multiple words in any order, case and ё", () => {
  assert.ok(matchesLesson(lesson, "ОТЧЕТ расходы"));
  assert.ok(matchesLesson(lesson, " расходы   отчет "));
  assert.ok(!matchesLesson(lesson, "расходы неизвестно"));
});
test("search result explains body match and highlights safely without HTML", () => {
  const result = searchExcerpt(lesson, "отчет");
  assert.equal(result.label, "Совпадение в тексте");
  const parts = highlightedParts(result.text, "отчет");
  assert.equal(parts.filter(part => part.match).map(part => part.text).join(""), "отчёт");
  assert.equal(parts.map(part => part.text).join(""), result.text);
  assert.deepEqual(highlightedParts("<script>цена</script>", "цена").filter(part => part.match), [{ text: "цена", match: true }]);
});
test("search excerpts retain context around late matches and title matches", () => {
  const result = searchExcerpt({ ...lesson, searchText: "Начало. ".repeat(80) + "Нужная ставка для объявления. " + "Конец. ".repeat(80) }, "ставка");
  assert.match(result.text, /ставка/);
  assert.ok(result.text.length < 250);
  assert.equal(searchExcerpt(lesson, "диалоги").label, "Совпадение в названии");
  assert.equal(materialCount(2), "2 материала");
  assert.equal(materialCount(12), "12 материалов");
});
test("split-field matches show an actual match instead of an unrelated body excerpt", () => {
  const value = { title: "Объявления", description: "Бюджет на месяц", searchText: "Проверяйте результаты ежедневно." };
  assert.ok(matchesLesson(value, "объявления бюджет"));
  const excerpt = searchExcerpt(value, "объявления бюджет");
  assert.ok(highlightedParts(excerpt.text, "объявления бюджет").some(part => part.match));
  assert.notEqual(excerpt.label, "Совпадение в тексте");
});

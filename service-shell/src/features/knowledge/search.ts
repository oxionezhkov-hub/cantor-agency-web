import type { KnowledgeLesson } from "./content.ts";

export const normalizeSearch = (value: string) => value.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();

export function matchesLesson(lesson: Pick<KnowledgeLesson, "title" | "description" | "searchText">, query: string) {
  const text = normalizeSearch(`${lesson.title} ${lesson.description} ${lesson.searchText}`);
  return normalizeSearch(query).split(" ").filter(Boolean).every(word => text.includes(word));
}

export function searchExcerpt(lesson: Pick<KnowledgeLesson, "title" | "description" | "searchText">, query: string) {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  const fields = [
    { label: "Совпадение в названии", text: lesson.title },
    { label: "Совпадение в описании", text: lesson.description },
    { label: "Совпадение в тексте", text: lesson.searchText },
  ];
  const field = fields.find(item => words.every(word => normalizeSearch(item.text).includes(word))) ||
    fields.reduce((best, item) => {
      const count = (value: string) => words.filter(word => normalizeSearch(value).includes(word)).length;
      return count(item.text) > count(best.text) ? item : best;
    }, fields[0]);
  const text = field.text.replace(/\s+/g, " ").trim();
  const normalized = normalizeSearch(text);
  const positions = words.map(word => normalized.indexOf(word)).filter(index => index >= 0);
  const first = positions.length ? Math.min(...positions) : 0;
  let start = Math.max(0, first - 65);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < first) start = space + 1;
  }
  const end = Math.min(text.length, Math.max(start + 220, first + (words[0]?.length || 0)));
  return { label: field.label, text: `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}` };
}

export function highlightedParts(text: string, query: string) {
  const words = normalizeSearch(query).split(" ").filter(Boolean).sort((a, b) => b.length - a.length);
  const normalized = text.toLocaleLowerCase("ru").replace(/ё/g, "е");
  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let index = -1;
    let found = "";
    for (const word of words) {
      const next = normalized.indexOf(word, cursor);
      if (next >= 0 && (index === -1 || next < index)) { index = next; found = word; }
    }
    if (index < 0) { parts.push({ text: text.slice(cursor), match: false }); break; }
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + found.length), match: true });
    cursor = index + found.length;
  }
  return parts;
}

export function materialCount(count: number) {
  const last = count % 10;
  const suffix = count % 100 >= 11 && count % 100 <= 14 ? "материалов" : last === 1 ? "материал" : last >= 2 && last <= 4 ? "материала" : "материалов";
  return `${count} ${suffix}`;
}

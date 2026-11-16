export const SECTIONS = [
  { id: "today", label: "Дашборд" },
  { id: "stats", label: "Аналитика" },
  { id: "ads", label: "Мои объявления" },
  { id: "chats", label: "Мои диалоги" },
  { id: "learn", label: "База знаний" },
  { id: "acc", label: "Настройки" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export function isSection(value: string): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

export type ServiceSearch = { section?: SectionId; focus?: string };
export function validateServiceSearch(search: Record<string, unknown>): ServiceSearch {
  const result: ServiceSearch = {};
  if (typeof search.section === "string" && isSection(search.section)) result.section = search.section;
  if (typeof search.focus === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(search.focus)) result.focus = search.focus;
  return result;
}

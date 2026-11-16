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

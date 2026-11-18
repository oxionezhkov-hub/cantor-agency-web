export const ANALYTICS_TABS = [
  { id: "overview", label: "Обзор" },
  { id: "dialogs", label: "Диалоги" },
  { id: "economy", label: "Экономика" },
] as const;
type Tab = (typeof ANALYTICS_TABS)[number]["id"];
export function analyticsTabFromFocus(focus?: string): Tab {
  if (!focus || focus === "overview") return "overview";
  if (focus === "dialogs") return "dialogs";
  return "economy";
}

export const SETTINGS_PAGES = [
  { id: "cabinet", label: "Кабинет" },
  { id: "notifications", label: "Уведомления" },
  { id: "tariff", label: "Тариф" },
  { id: "support", label: "Поддержка" },
] as const;
export function settingsPage(focus?: string) {
  return SETTINGS_PAGES.find((p) => p.id === focus)?.id ?? "cabinet";
}
export const modules = [
  {
    id: "analytics",
    title: "Расширенная аналитика",
    price: 1490,
    detail:
      "Показывает результаты и стоимость обращений по объявлениям и городам. Помогает сравнивать направления продвижения.",
  },
  {
    id: "dialogs",
    title: "Разбор диалогов",
    price: 990,
    detail:
      "Помогает оценить качество переписки: как обрабатываются обращения, где прерывается общение и что можно улучшить.",
  },
  {
    id: "ai",
    title: "ИИ-автоматизация",
    price: 2990,
    detail:
      "Подготовка ответов ученикам, ответы по согласованию и автоматический режим. Режим работы выбираете вы.",
  },
] as const;
export const baseFeatures = [
  {
    title: "Базовая аналитика Авито",
    detail: "Просмотры, обращения и расходы кабинета за выбранный период.",
  },
  {
    title: "Диагностики и оплаты",
    detail:
      "Учёт встреч и оплат, которые вы отмечаете в кабинете. Платформа не списывает деньги с учеников.",
  },
  {
    title: "Стоимость ученика",
    detail: "Соотношение расходов на продвижение и числа учеников с отмеченной оплатой.",
  },
];
export const plans = [
  { name: "Конструктор", description: "Соберите свой набор возможностей", price: 1990 },
  { name: "Всё включено", description: "Все модули без лимитов", price: 9990 },
  { name: "Премиум", description: "Полное ведение командой", price: 25000 },
];
export function monthlyPrice(plan: number, enabled: readonly boolean[]) {
  return plan === 0
    ? 1990 + modules.reduce((sum, m, i) => sum + (enabled[i] ? m.price : 0), 0)
    : plans[plan].price;
}
export function paymentPrice(
  plan: number,
  enabled: readonly boolean[],
  annual: boolean,
  firstPremium = false,
) {
  return monthlyPrice(plan, enabled) * (annual ? 12 : 1) + (plan === 2 && firstPremium ? 25000 : 0);
}
export function paidThrough(annual: boolean, now = new Date()) {
  const next = new Date(now);
  const day = now.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + (annual ? 12 : 1));
  const end = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, end));
  return next;
}
export const money = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

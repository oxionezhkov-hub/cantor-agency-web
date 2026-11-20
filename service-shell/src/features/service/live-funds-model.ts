import type { LiveMoney } from "./preview-data.ts";
export function fundsEstimate(
  data: LiveMoney | undefined,
  observedAt: string | undefined,
  now = Date.now(),
) {
  if (!data || !observedAt)
    return { available: false, reason: "Нет подтверждённых данных баланса и расходов" } as const;
  if (now - Date.parse(observedAt) > 10 * 60000)
    return { available: false, reason: "Данные устарели; расчёт недоступен" } as const;
  const days = data.days.filter((d) => d.spendRub !== null);
  if (!data.coverage.complete || days.length < 7)
    return { available: false, reason: "Недостаточно полной истории завершённых дней" } as const;
  const average = days.reduce((n, d) => n + (d.spendRub ?? 0), 0) / days.length;
  if (average <= 0)
    return {
      available: false,
      reason: "За выбранный период нет положительного среднего расхода",
    } as const;
  const kind = data.coverage.eligibleBalance;
  if (kind === "wallet_real" || kind === "advance_cpa") {
    if (kind === "wallet_real" ? data.wallet?.stale : data.advance?.stale)
      return {
        available: false,
        reason: "Остаток этого баланса устарел; расчёт недоступен",
      } as const;
    const balance = kind === "wallet_real" ? data.wallet?.realRub : data.advance?.rub;
    if (balance == null)
      return { available: false, reason: "Баланс этого источника недоступен" } as const;
    if (balance < 0)
      return {
        available: false,
        reason: "У баланса отрицательный остаток; требуется пополнение",
      } as const;
    const remainingDays = balance / average;
    return {
      available: true,
      reason: `Оценка по среднему за ${days.length} завершённых дней`,
      remainingDays,
      exhaustsAt: new Date(now + remainingDays * 86400000).toISOString(),
      average,
      formula: "подтверждённый доступный баланс / средний дневной расход этого баланса",
    } as const;
  }
  // Account allSpending includes multiple charging sources. Never sum wallet+advance or
  // pretend that all spending is debited from either one without verified attribution.
  return {
    available: false,
    reason: "Не подтверждено, какой баланс покрывает этот состав расходов",
    average,
    days: days.length,
  } as const;
}

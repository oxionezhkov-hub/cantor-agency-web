export type ComparisonMetrics = {
  shows?: number;
  views: number;
  contacts: number;
  spend: number;
};
export function comparisonRatio(numerator: number | undefined, denominator: number | undefined) {
  return numerator != null &&
    denominator != null &&
    Number.isFinite(numerator) &&
    Number.isFinite(denominator) &&
    numerator >= 0 &&
    denominator > 0
    ? numerator / denominator
    : null;
}
export function comparisonNumber(value: number | undefined, unit = "") {
  return value != null && Number.isFinite(value) && value >= 0
    ? `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}${unit}`
    : "Нет данных";
}

export type Metric = "views" | "contacts" | "spendRub";
export type Row = { name: string; views: number; contacts: number; spendRub: number };
export function rankGroups(rows: readonly Row[], metric: Metric, limit: number) {
  const groups = new Map<string, { name: string; value: number | null }>();
  for (const row of rows) {
    const name = row.name.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("ru-RU"),
      previous = groups.get(key),
      value = Number.isFinite(row[metric]) ? row[metric] : null;
    if (!previous) groups.set(key, { name, value });
    else previous.value = previous.value === null || value === null ? null : previous.value + value;
  }
  return [...groups.values()]
    .filter((row) => row.value !== null)
    .sort((a, b) => b.value! - a.value! || a.name.localeCompare(b.name, "ru"))
    .slice(0, limit);
}

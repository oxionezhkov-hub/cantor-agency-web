export type SheetField = "Title" | "Description" | "Address" | "Price" | "Images" | "Category";

export type SheetStatus =
  "pending" | "validation" | "conflict" | "write_failed" | "applied" | "rejected";

export type SheetRow = {
  feedId: string;
  avitoId?: string;
  revision: string;
  row: number;
  status: SheetStatus;
  message?: string;
  fields: Partial<Record<SheetField, string>>;
  missing: SheetField[];
};

export type SheetSnapshot = {
  rows: SheetRow[];
  problems: { row: number; message: string }[];
  sheetUrl: string;
  tab: string;
};

export type SheetEdit = {
  feedId: string;
  revision?: string;
  fields: Partial<Record<SheetField, string>>;
};

export type SheetResult = {
  feedId: string;
  status: SheetStatus;
  message?: string;
  row?: SheetRow;
};

export const sheetStatusLabels: Record<SheetStatus, string> = {
  pending: "Ожидается автозагрузка",
  validation: "Требуется исправление",
  conflict: "Конфликт версий",
  write_failed: "Строка не записалась",
  applied: "Применено в Авито",
  rejected: "Авито отклонило изменение",
};

const route = "/api/demo/ad-sheet";

export async function readAdSheet(signal: AbortSignal): Promise<SheetSnapshot | null> {
  const response = await fetch(route, { cache: "no-store", signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Не удалось прочитать таблицу автозагрузки.");
  return response.json();
}

export async function saveAdSheet(edits: SheetEdit[]): Promise<SheetResult[]> {
  const response = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ edits }),
  });
  if (!response.ok)
    throw new Error("Не удалось подтвердить запись в таблицу. Обновите список перед повтором.");
  const { results } = await response.json();
  return results;
}

export const BALANCE_RESERVE_DAYS = 3;

export type RowTone = "plain" | "ok" | "bad";

export type CabinetRow = {
  label: string;
  value: string;
  detail: string | null;
  tone: RowTone;
};

export type SubscriptionInput = {
  planName: string;
  paidUntil: string;
  lastPaidAt: string;
  autoRenew: boolean;
};

export type BalanceInput = {
  advanceRub: number;
  yesterdayPromotionRub: number;
  autoTopUp: boolean;
  walletRealRub: number;
  walletBonusRub: number;
};

export type BlockKind = "blocked" | "rejected" | "removed";

export type BlockItem = {
  title: string;
  kind: BlockKind;
  foundAt: string;
};

export type BlocksInput = {
  cabinetBlocked: boolean;
  items: BlockItem[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function formatRuDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const name = MONTHS[month - 1];
  if (!name || day < 1 || day > 31) return iso;
  return `${day} ${name}`;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function daysUntil(untilIso: string, now: Date): number | null {
  if (!DATE_RE.test(untilIso)) return null;
  const [year, month, day] = untilIso.split("-").map(Number);
  if (!year || !month || !day) return null;
  const until = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!Number.isFinite(until)) return null;
  return Math.floor((until - today) / 86_400_000);
}

export function dayWord(value: number): string {
  if (!Number.isInteger(value)) return "дня";
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

function formatRub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

function formatDayCount(value: number): string {
  const shown = Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return `${shown} ${dayWord(value)}`;
}

export function reserveDays(advanceRub: number, yesterdaySpendRub: number): number | null {
  if (!finite(advanceRub) || !finite(yesterdaySpendRub)) return null;
  if (yesterdaySpendRub <= 0) return null;
  if (advanceRub <= 0) return 0;
  return advanceRub / yesterdaySpendRub;
}

export function subscriptionRows(input: SubscriptionInput, now: Date): CabinetRow[] {
  const left = daysUntil(input.paidUntil, now);
  const active = left !== null && left > 0;
  return [
    { label: "План", value: input.planName.trim() || "не назван", detail: null, tone: "plain" },
    {
      label: "Статус",
      value: left === null ? "дату не разобрать" : active ? "активна" : "не активна",
      detail: null,
      tone: left === null ? "bad" : active ? "ok" : "bad",
    },
    {
      label: "Оплачена до",
      value: formatRuDate(input.paidUntil),
      detail: input.lastPaidAt ? `последнее списание ${formatRuDate(input.lastPaidAt)}` : null,
      tone: "plain",
    },
    {
      label: "Осталось",
      value: left === null ? "—" : formatDayCount(left),
      detail: null,
      tone: left !== null && left <= 0 ? "bad" : "plain",
    },
    { label: "Автопродление", value: input.autoRenew ? "да" : "нет", detail: null, tone: "plain" },
    {
      label: "Размещение",
      value: "По тарифу Авито",
      detail: "Стоимость размещения здесь не загружена",
      tone: "plain",
    },
  ];
}

export function balanceRows(input: BalanceInput): CabinetRow[] {
  const walletKnown = finite(input.walletRealRub) && finite(input.walletBonusRub);
  const days = reserveDays(input.advanceRub, input.yesterdayPromotionRub);
  const short = days !== null && days < BALANCE_RESERVE_DAYS;
  const reserveValue =
    days === null
      ? "не посчитать"
      : `на ${formatDayCount(days)}`;
  const reserveDetail =
    days === null
      ? "вчера расхода на продвижение не было"
      : `порог — ${BALANCE_RESERVE_DAYS} дня расхода`;

  return [
    {
      label: "Аванс",
      value: finite(input.advanceRub) ? formatRub(input.advanceRub) : "нет данных",
      detail: null,
      tone: finite(input.advanceRub) && input.advanceRub <= 0 ? "bad" : "plain",
    },
    {
      label: "Расход вчера",
      value: finite(input.yesterdayPromotionRub) ? formatRub(input.yesterdayPromotionRub) : "нет данных",
      detail: "продвижение, без платы за размещение",
      tone: "plain",
    },
    { label: "Хватит", value: reserveValue, detail: reserveDetail, tone: short ? "bad" : "plain" },
    {
      label: "Кто пополняет",
      value: input.autoTopUp ? "само" : "репетитор",
      detail: input.autoTopUp ? "проверяем, что списание проходит" : "автопополнения нет",
      tone: short && !input.autoTopUp ? "bad" : "plain",
    },
    {
      label: "Кошелёк",
      value: walletKnown ? formatRub(input.walletRealRub + input.walletBonusRub) : "нет данных",
      detail: walletKnown
        ? `${formatRub(input.walletRealRub)} своих, бонусов ${formatRub(input.walletBonusRub)}`
        : null,
      tone: "plain",
    },
  ];
}

function kindLabel(kind: BlockKind): string {
  if (kind === "blocked") return "заблокировано";
  if (kind === "rejected") return "отклонено";
  return "снято";
}

export function blockRows(input: BlocksInput, _nowMs: number): CabinetRow[] {
  const items = Array.isArray(input.items) ? input.items : [];
  const rows: CabinetRow[] = [
    {
      label: "Кабинет",
      value: input.cabinetBlocked ? "заблокирован" : "не заблокирован",
      detail: null,
      tone: input.cabinetBlocked ? "bad" : "ok",
    },
  ];

  for (const item of items) {
    const found = Date.parse(item.foundAt);
    const detail = Number.isFinite(found) ? `Обнаружено ${new Date(found).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} МСК. Проверьте причину в Авито` : "Проверьте причину в Авито";
    rows.push({
      label: item.title.trim() || "Объявление без названия",
      value: kindLabel(item.kind),
      detail,
      tone: "bad",
    });
  }

  const rejected = items.filter((item) => item.kind === "rejected").length;
  const removed = items.filter((item) => item.kind === "removed").length;
  if (rejected === 0) rows.push({ label: "Отклонённые", value: "нет", detail: null, tone: "plain" });
  if (removed === 0) rows.push({ label: "Снятые", value: "нет", detail: null, tone: "plain" });
  return rows;
}

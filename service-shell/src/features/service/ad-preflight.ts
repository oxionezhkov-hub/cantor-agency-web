type AdContent = {
  title: string;
  text: string;
  price: number;
  attributes?: Record<string, string>;
};

const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 0,
});
const amount = String.raw`(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[,.]\d{1,2})?`;
const currency = String.raw`\s*(?:₽|руб(?:лей|ля|\.)?)(?!\p{L})`;
const explicitPrice = new RegExp(
  String.raw`(?:^|[^\p{L}])(?:стоимость|цена)\s+(?:одного\s+)?(?:занятия|урока)\s*[:—–-]?\s*(?:от\s+)?(?<amount>${amount})${currency}|(?<![\p{L}\d.,])(?<perLesson>${amount})${currency}\s*(?:за\s+(?:одно\s+)?(?:занятие|урок)|\/\s*(?:занятие|урок))(?=$|[^\p{L}])`,
  "giu",
);

function format(value: string) {
  const normalized = value.trim().toLocaleLowerCase("ru");
  if (/^(?:онлайн|дистанционно|дистанционные)$/.test(normalized)) return "онлайн";
  if (/^(?:очно|офлайн|оффлайн|очные)$/.test(normalized)) return "очно";
}

function explicitlyStatedFormat(value: string) {
  return format(
    value.match(
      /(?:^|\n)\s*(?:формат(?: занятий)?\s*[:—–-]\s*|занятия\s+только\s+)((?:онлайн|дистанционно|очно|офф?лайн))\s*(?=$|\n|[.!])/iu,
    )?.[1] ?? "",
  );
}

export function getAdPreflightWarnings({ title, text, price, attributes }: AdContent): string[] {
  const warnings: string[] = [];
  if (Number.isFinite(price) && price > 0) {
    for (const [label, content] of [
      ["заголовке", title],
      ["тексте", text],
    ] as const) {
      const prices = new Set(
        [...content.matchAll(explicitPrice)].map(({ groups }) =>
          Number((groups?.amount ?? groups?.perLesson ?? "").replace(/\s/g, "").replace(",", ".")),
        ),
      );
      // Several prices may describe separate lesson options.
      if (prices.size !== 1 || prices.has(price)) continue;
      const [stated] = prices;
      warnings.push(
        `В ${label} указано ${rubles.format(stated)} за занятие, в поле «Цена занятия» — ${rubles.format(price)}. Сверьте эти суммы.`,
      );
    }
  }

  const configured = new Set(
    Object.entries(attributes ?? {})
      .filter(([name]) =>
        /^(?:формат занятий|формат обучения|способ проведения занятий)$/iu.test(name.trim()),
      )
      .map(([, value]) => format(value))
      .filter(Boolean),
  );
  const titleFormat = explicitlyStatedFormat(title);
  const textFormat = explicitlyStatedFormat(text);
  const [attributeFormat] = configured;
  const reference = configured.size === 1 ? attributeFormat : titleFormat;
  const stated = textFormat ?? titleFormat;
  if (reference && stated && reference !== stated) {
    const location = configured.size === 1 ? "параметры объявления" : "заголовок";
    const statedLocation = textFormat ? "текст" : "заголовок";
    warnings.push(
      `Указаны разные форматы занятий: «${reference}» (${location}) и «${stated}» (${statedLocation}). Сверьте формулировки.`,
    );
  }
  return warnings;
}

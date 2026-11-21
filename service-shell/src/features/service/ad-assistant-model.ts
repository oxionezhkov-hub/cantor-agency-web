import { getAdPreflightWarnings } from "./ad-preflight.ts";

type HistoricalAd = { city: string; price: number; views?: number; contacts?: number };
export const adKey = (value: string) =>
  value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function recommendAdSettings(ads: HistoricalAd[]) {
  const groups = new Map<string, { city: string; views: number; contacts: number }>();
  const prices: number[] = [];
  for (const ad of ads) {
    if (Number.isFinite(ad.price) && ad.price > 0) prices.push(ad.price);
    const key = adKey(ad.city);
    if (
      !key ||
      typeof ad.views !== "number" ||
      !Number.isFinite(ad.views) ||
      typeof ad.contacts !== "number" ||
      !Number.isFinite(ad.contacts)
    )
      continue;
    const group = groups.get(key) ?? { city: ad.city, views: 0, contacts: 0 };
    group.views += ad.views;
    group.contacts += ad.contacts;
    groups.set(key, group);
  }
  const cities = [...groups.values()]
    .filter((item) => item.contacts > 0)
    .sort((a, b) => b.contacts - a.contacts || b.views - a.views)
    .slice(0, 5);
  prices.sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const price = prices.length
    ? (prices[middle] + prices[Math.ceil(prices.length / 2) - 1]) / 2
    : null;
  return { cities, price, samples: prices.length, low: prices[0], high: prices.at(-1) };
}

const group = /\{([^{}\n]+\|[^{}\n]+)\}/g;
export function adVariants(text: string, cities: string[]) {
  return cities.map((city, index) =>
    text
      .replaceAll("{город}", city)
      .replace(group, (_, choices: string) => {
        const options = [
          ...new Set(
            choices
              .split("|")
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ];
        if (options.length < 2) return "{" + choices + "}";
        const selection = index % options.length;
        index = Math.floor(index / options.length);
        return options[selection];
      })
      .trim(),
  );
}
export function checkAdVariants(
  title: string,
  texts: string[],
  price: number,
  cities: string[],
  existing: { title: string; text: string; city: string }[],
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (title.length > 50) errors.push("Сократите заголовок до 50 символов.");
  if (texts.some((text) => !text || text.length > 4000))
    errors.push("Описание должно содержать от 1 до 4 000 символов.");
  if (texts.some((text) => /[{}]|\*\*/.test(text)))
    errors.push("Проверьте разметку вариантов: используйте {фраза|другая фраза}.");
  if (
    texts.some((text) =>
      /https?:\/\/|(?:\+7|8)(?:[\s()-]*\d){10}(?!\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(text),
    )
  )
    errors.push("Уберите внешние ссылки и контактные данные из описания.");
  if (texts.some((text) => text.split(/\n\s*\n/).filter(Boolean).length < 3))
    warnings.push("Разделите описание на абзацы: предложение, формат занятий и следующий шаг.");
  for (const text of new Set(texts)) errors.push(...getAdPreflightWarnings({ title, text, price }));
  const repeats = cities.filter((city, index) =>
    existing.some(
      (ad) =>
        adKey(ad.city) === adKey(city) &&
        (adKey(ad.title) === adKey(title) ||
          (adKey(ad.text) && adKey(ad.text) === adKey(texts[index]))),
    ),
  );
  if (repeats.length)
    warnings.push(
      "Совпадает заголовок или текст с объявлением в городе: " +
        repeats.join(", ") +
        ". Проверьте, что у нового объявления есть самостоятельное предложение.",
    );
  const unique = new Set(texts.map(adKey)).size;
  if (unique < texts.length)
    warnings.push(
      "Разных описаний: " +
        unique +
        " из " +
        texts.length +
        ". Добавьте варианты фраз или сократите список городов.",
    );
  return { errors: [...new Set(errors)], warnings, unique };
}

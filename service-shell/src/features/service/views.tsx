import { ads } from "./data.ts";
import { TOP_PLACE, contactRate, formatPercent, inContactGoal, placeTone } from "./rules.ts";

function Percent({ views, contacts }: { views: number; contacts: number }) {
  const rate = contactRate(views, contacts);
  if (rate === null) return <span className="text-muted">нет просмотров</span>;
  const tone = rate < 10 ? "text-red" : inContactGoal(rate) ? "text-ok" : "text-ink";
  return <span className={tone}>{formatPercent(rate)}</span>;
}

export { AdsWorkspace as AdsSection } from "./ads-workspace";

export function ShowsSection() {
  const rows = ads.flatMap((ad) => ad.cities.map((city) => ({ ad, city })));
  return (
    <div className="mt-8">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line text-left text-sm text-muted">
            <th className="py-2 pr-3 font-medium">Объявление</th>
            <th className="py-2 pr-3 font-medium">Город</th>
            <th className="py-2 pr-3 font-medium">Ставка</th>
            <th className="py-2 font-medium">Место</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ ad, city }) => (
            <tr key={`${ad.id}-${city.city}`} className="border-b border-line">
              <th scope="row" className="py-3 pr-3 text-left font-medium">
                {ad.title}
                <span
                  className={`mt-0.5 block text-sm font-normal ${ad.autobidder ? "text-red" : "text-muted"}`}
                >
                  {ad.autobidder ? "автобидер включён" : "автобидер выключен"}
                </span>
              </th>
              <td className="py-3 pr-3">{city.city}</td>
              <td className="py-3 pr-3">{city.bidRub} ₽</td>
              <td className={`py-3 ${placeTone(city.place) === "bad" ? "text-red" : "text-ok"}`}>
                {city.place}
                <span className="mt-0.5 block text-sm font-normal text-muted">топ-{TOP_PLACE}</span>
              </td>
            </tr>
          ))}
          {ads
            .filter((ad) => ad.cities.length === 0)
            .map((ad) => (
              <tr key={ad.id} className="border-b border-line">
                <th scope="row" className="py-3 pr-3 text-left font-medium">
                  {ad.title}
                </th>
                <td className="py-3 text-muted" colSpan={3}>
                  не в показе
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function ContactSection() {
  const views = ads.reduce((sum, ad) => sum + ad.views, 0);
  const contacts = ads.reduce((sum, ad) => sum + ad.contacts, 0);
  return (
    <div>
      <p className="font-display text-4xl font-medium">
        <Percent views={views} contacts={contacts} />
      </p>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {ads.map((ad) => (
          <li key={ad.id} className="flex min-h-11 items-baseline justify-between gap-4 py-3">
            <span>{ad.title}</span>
            <span>
              {ad.contacts} из {ad.views} · <Percent views={ad.views} contacts={ad.contacts} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { LeadWorkspace as DialogsSection } from "./lead-workspace.tsx";

export { DiagnosticSection, PaymentsSection } from "./crm-ui.tsx";

export { DashboardSection } from "./DashboardSection.tsx";

const KNOWLEDGE = [
  {
    name: "Объявление",
    items: ["Текст по модели", "10 фото", "Оффер с диагностикой"],
  },
  {
    name: "Диалог",
    items: ["Ответ за минуты", "На цену — окно, не прайс", "Молчит сутки — одно сообщение"],
  },
  {
    name: "Диагностика",
    items: ["Запись в свободное окно", "Напоминание за 3 часа"],
  },
];

export function LearnSection() {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {KNOWLEDGE.flatMap((group) => group.items).map((item) => (
        <li key={item} className="py-3">
          {item}
        </li>
      ))}
    </ul>
  );
}

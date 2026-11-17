import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { sampleCabinet } from "@/features/cabinet/sample.ts";
import { ads, dialogs, PHOTO_SLOTS } from "./data.ts";
import {
  PHOTO_TARGET,
  TOP_PLACE,
  contactRate,
  formatPercent,
  inContactGoal,
  missingSlotNames,
  nudgeReady,
  placeTone,
  promotionSpend,
  replyLate,
} from "./rules.ts";
import { useDemoCrm } from "./demo-crm-store.ts";
import { leadProgress } from "./lead-workflow.ts";
import { monthRangeMsk, periodMetrics } from "./crm.ts";
import { getPreviewData, previewTotals } from "./preview-data.ts";

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

const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
const DATA_YEAR = 2026;
const DATA_MONTH = 10;

function countLabel(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
  return `${count} ${word}`;
}

function rubPer(spend: number, count: number): string {
  if (!Number.isFinite(spend) || !Number.isFinite(count) || count <= 0 || spend < 0) return "—";
  return `${Math.round(spend / count).toLocaleString("ru-RU")} ₽`;
}

function placeLabel(best: number, worst: number): string {
  if (best === worst) return `${best}-е место`;
  return `${best}–${worst} место`;
}

function moneyRange(min: number, max: number): string {
  if (min === max) return `${min.toLocaleString("ru-RU")} ₽`;
  return `${min.toLocaleString("ru-RU")}–${max.toLocaleString("ru-RU")} ₽`;
}

const AD_NAME: Record<string, string> = {
  ege: "ЕГЭ",
  oge: "ОГЭ",
  alg: "8 класс",
};

type Sag = "bad" | "warn" | null;

function Mark({ tone }: { tone: Sag }) {
  if (!tone) return null;
  return (
    <TriangleAlert
      className={`h-4 w-4 shrink-0 ${tone === "bad" ? "text-red" : "text-warn"}`}
      aria-label={tone === "bad" ? "сильно ниже" : "проседает"}
    />
  );
}

export function DashboardSection() {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: DATA_YEAR, month: DATA_MONTH });
  const [now, setNow] = useState(() => Date.now());
  const { state: crm } = useDemoCrm();
  const [tipsOpen, setTipsOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const isDataMonth = cursor.year === DATA_YEAR && cursor.month === DATA_MONTH;
  const isCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth();
  const preview = getPreviewData();
  const prefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
  const totals = preview ? previewTotals(`${prefix}-01`, `${prefix}-31`) : null;
  const shows = totals
    ? totals.shows
    : isDataMonth
      ? ads.reduce((sum, ad) => sum + ad.shows, 0)
      : 0;
  const views = totals
    ? totals.views
    : isDataMonth
      ? ads.reduce((sum, ad) => sum + ad.views, 0)
      : 0;
  const contacts = totals
    ? totals.contacts
    : isDataMonth
      ? ads.reduce((sum, ad) => sum + ad.contacts, 0)
      : 0;
  const spend = totals ? totals.budget : isDataMonth ? promotionSpend(ads) : 0;
  const crmMetrics = periodMetrics(crm, ...monthRangeMsk(cursor.year, cursor.month));
  const paidCount = totals ? totals.sales : crmMetrics.newStudents;
  const kirillPaid = !crmMetrics.unpaidStudentIds.includes("student-kirill");
  const diagnosed = totals ? totals.diagnostics : crmMetrics.completedAppointments;
  const viewRate = contactRate(shows, views);
  const wroteRate = contactRate(views, contacts);

  const steps: { label: string; value: number; conversion: string; cost: string; tone: Sag }[] = [
    { label: "показов", value: shows, conversion: "—", cost: rubPer(spend, shows), tone: null },
    {
      label: "просмотров",
      value: views,
      conversion: viewRate === null ? "—" : formatPercent(viewRate),
      cost: rubPer(spend, views),
      tone: null,
    },
    {
      label: "контактов",
      value: contacts,
      conversion: wroteRate === null ? "—" : formatPercent(wroteRate),
      cost: rubPer(spend, contacts),
      tone: wroteRate !== null && wroteRate < 10 ? "bad" : null,
    },
    {
      label: "диагностик",
      value: diagnosed,
      conversion: preview ? "проведено" : "проведено · CRM",
      cost: rubPer(spend, diagnosed),
      tone: null,
    },
    {
      label: "новых учеников",
      value: paidCount,
      conversion: preview ? "—" : "первая оплата · CRM",
      cost: rubPer(spend, paidCount),
      tone: null,
    },
  ];

  const contactAds = (isDataMonth ? ads : [])
    .filter((ad) => ad.contacts > 0)
    .sort((a, b) => b.contacts / b.views - a.contacts / a.views);
  const leader = contactAds[0];
  const trailer = contactAds[contactAds.length - 1];
  const adCompare =
    leader && trailer && leader.id !== trailer.id
      ? `${AD_NAME[leader.id] ?? leader.title} даёт контакты чаще, чем ${AD_NAME[trailer.id] ?? trailer.title}`
      : null;

  const cityMap = new Map<string, { places: number[]; bids: number[] }>();
  if (isDataMonth) {
    for (const ad of ads) {
      for (const city of ad.cities.filter(
        (city) => Number.isFinite(city.place) && Number.isFinite(city.bidRub),
      )) {
        const row = cityMap.get(city.city) ?? { places: [], bids: [] };
        row.places.push(city.place);
        row.bids.push(city.bidRub);
        cityMap.set(city.city, row);
      }
    }
  }
  const cities = [...cityMap.entries()]
    .map(([name, row]) => ({
      name,
      best: Math.min(...row.places),
      worst: Math.max(...row.places),
      bidMin: Math.min(...row.bids),
      bidMax: Math.max(...row.bids),
    }))
    .sort((a, b) => a.best - b.best);
  const cityCompare =
    cities.length > 1
      ? `${cities[0].name} в топе выше, чем ${cities[cities.length - 1].name}`
      : null;

  const blockedTitles = new Set(sampleCabinet.blocks.items.map((item) => item.title));
  const recommendations: {
    id: string;
    title: string;
    text: string;
    section: "ads" | "stats" | "chats";
    focus?: string;
    rank: number;
  }[] = [];
  const openDialogs = dialogs.filter(
    (dialog) =>
      crm.leads.some((l) => l.id === dialog.id) &&
      leadProgress(crm, dialog.id, now).stage === "new",
  );
  const late = openDialogs
    .filter((dialog) => replyLate(dialog.waitingSince, now))
    .sort((a, b) => Date.parse(a.waitingSince ?? "") - Date.parse(b.waitingSince ?? ""));
  for (const dialog of late) {
    recommendations.push({
      id: dialog.id,
      focus: dialog.id,
      title: `${dialog.name} ждёт ответа больше получаса`,
      text: "На вопрос о цене предложите окно, не прайс.",
      section: "chats",
      rank: 1,
    });
  }
  for (const dialog of openDialogs) {
    if (!nudgeReady(dialog, now)) continue;
    recommendations.push({
      id: dialog.id,
      focus: dialog.id,
      title: `${dialog.name}: проверьте следующий шаг в диалоге`,
      text: "Продолжите диалог по сценарию повторных касаний из базы знаний.",
      section: "chats",
      rank: 2,
    });
  }
  for (const ad of ads) {
    const name = AD_NAME[ad.id] ?? ad.title;
    if (blockedTitles.has(ad.title)) {
      recommendations.push({
        id: `block-${ad.id}`,
        focus: ad.id,
        title: `Объявление «${name}» заблокировано`,
        text: "Проверьте причину блокировки и рекомендации Авито по исправлению.",
        section: "ads",
        rank: 0,
      });
    }
    const missing = missingSlotNames(ad.photos, PHOTO_SLOTS);
    if (!preview && (missing.length > 0 || !ad.offerHasDiagnostic)) {
      recommendations.push({
        id: `photo-${ad.id}`,
        focus: ad.id,
        title: `У «${name}» ${PHOTO_TARGET - missing.length} фото из ${PHOTO_TARGET}`,
        text: ad.offerHasDiagnostic
          ? "Доберите десятку, иначе показ слабый."
          : "Нет оффера с диагностикой. В показ такое лучше не ставить.",
        section: "ads",
        rank: 5,
      });
    }
  }
  for (const city of cities) {
    if (city.worst <= TOP_PLACE) continue;
    recommendations.push({
      id: `city-${city.name}`,
      title: `${city.name}: ${city.worst}-е место, это уже не топ-${TOP_PLACE}`,
      text: "Поднимите ставку вручную, без автобиддера.",
      section: "stats",
      rank: 3,
    });
  }
  if (isDataMonth && !kirillPaid && !crm.leads.find((l) => l.id === "kirill")?.closedAt) {
    recommendations.push({
      id: "kirill",
      focus: "kirill",
      title: `Кирилл: не отмечена оплата после диагностики`,
      text: "Если ученик оплатил занятия — внесите оплату. Число диагностик не изменится.",
      section: "chats",
      rank: 4,
    });
  }
  recommendations.sort((a, b) => a.rank - b.rank);
  const visibleTips = tipsOpen ? recommendations : recommendations.slice(0, 3);
  const linkText = { ads: "К объявлениям", stats: "К аналитике", chats: "К диалогам" };

  function shift(delta: number) {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    if (next.getFullYear() * 12 + next.getMonth() > today.getFullYear() * 12 + today.getMonth())
      return;
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="h-11 w-11 rounded-full text-xl"
          aria-label="Предыдущий месяц"
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <span className="min-w-36 text-center font-medium">
          {MONTHS[cursor.month]} {cursor.year}
        </span>
        <button
          type="button"
          className="h-11 w-11 rounded-full text-xl disabled:text-line"
          aria-label="Следующий месяц"
          disabled={isCurrentMonth}
          onClick={() => shift(1)}
        >
          ›
        </button>
      </div>

      <div className="dashboard-overview">
        <div>
          <span>Поступления за период</span>
          <strong data-testid="dashboard-revenue">
            {preview ? "—" : `${(crmMetrics.netReceivedMinor / 100).toLocaleString("ru-RU")} ₽`}
          </strong>
        </div>
        <div>
          <span>Новых заявок в CRM</span>
          <strong>{crmMetrics.newLeads}</strong>
        </div>
        <div>
          <span>Встреч запланировано</span>
          <strong>{preview ? "—" : crmMetrics.bookedAppointments}</strong>
        </div>
      </div>
      {[
        { title: "Продвижение на Авито", items: steps.slice(0, 3) },
        { title: "Диагностики и ученики", items: steps.slice(3) },
      ].map((group) => (
        <section key={group.title} className="dashboard-metric-group">
          <div className="crm-heading">
            <h2>{group.title}</h2>
          </div>
          <div className="dashboard-funnel mt-3 flex gap-2 overflow-x-auto pb-1">
            {group.items.map((step) => (
              <article
                key={step.label}
                className="min-w-36 flex-1 rounded-2xl border border-line bg-surface px-4 py-4"
              >
                <p className="flex items-center gap-2 text-sm text-muted">
                  {step.label}
                  <Mark tone={step.tone} />
                </p>
                <p
                  data-testid={
                    step.label === "диагностик"
                      ? "completed-diagnostics"
                      : step.label === "новых учеников"
                        ? "new-students"
                        : undefined
                  }
                  className="mt-1 font-display text-3xl font-medium"
                >
                  {Number.isFinite(step.value) ? step.value.toLocaleString("ru-RU") : "—"}
                </p>
                <p className={`mt-3 text-sm ${step.tone === "bad" ? "text-red" : "text-muted"}`}>
                  {step.conversion}
                </p>
                <p className="text-sm text-muted">{step.cost} · расходы на этап</p>
              </article>
            ))}
          </div>
        </section>
      ))}

      {isDataMonth && wroteRate !== null ? (
        <p className={`mt-4 ${wroteRate < 10 ? "text-red" : "text-ok"}`}>
          Норма контактов — 10–12% от просмотров. Сейчас {formatPercent(wroteRate)}.
          {wroteRate < 10
            ? " Это меньше."
            : inContactGoal(wroteRate)
              ? " Это норма."
              : " Это выше нормы."}
        </p>
      ) : (
        <p className="mt-4 text-muted">За этот месяц цифр нет.</p>
      )}

      {adCompare ? (
        <article className="mt-6 rounded-2xl border border-line bg-surface px-4 py-4">
          <p className="font-medium">{adCompare}</p>
          <ul className="mt-3 grid gap-3">
            {contactAds.map((ad) => {
              const rate = contactRate(ad.views, ad.contacts);
              const tone: Sag = rate !== null && rate < 10 ? "bad" : null;
              return (
                <li key={ad.id} className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2">
                    {AD_NAME[ad.id] ?? ad.title}
                    <Mark tone={tone} />
                  </span>
                  <span className="text-right text-sm">
                    {countLabel(ad.contacts, "контакт", "контакта", "контактов")}
                    <span className={`ml-2 ${tone === "bad" ? "text-red" : "text-muted"}`}>
                      {rate === null ? "—" : formatPercent(rate)}
                    </span>
                    <span className="ml-2 text-muted">{rubPer(ad.spendRub, ad.contacts)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </article>
      ) : null}

      {cityCompare ? (
        <article className="mt-2 rounded-2xl border border-line bg-surface px-4 py-4">
          <p className="font-medium">{cityCompare}</p>
          <ul className="mt-3 grid gap-3">
            {cities.map((city) => {
              const tone: Sag = city.worst > TOP_PLACE ? "bad" : city.worst > 15 ? "warn" : null;
              return (
                <li key={city.name} className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2">
                    {city.name}
                    <Mark tone={tone} />
                  </span>
                  <span className="text-right text-sm">
                    <span
                      className={tone === "bad" ? "text-red" : tone === "warn" ? "text-warn" : ""}
                    >
                      {placeLabel(city.best, city.worst)}
                    </span>
                    <span className="ml-2 text-muted">
                      ставка {moneyRange(city.bidMin, city.bidMax)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </article>
      ) : null}

      {recommendations.length > 0 ? (
        <div className="mt-8 grid gap-3">
          {visibleTips.map((item) => (
            <Link
              key={item.id}
              to="/"
              search={{ section: item.section, focus: item.focus }}
              className="rounded-2xl border border-line bg-surface px-4 py-4"
            >
              <span className="block font-medium">{item.title}</span>
              <span className="mt-1 block text-sm leading-5 text-muted">{item.text}</span>
              <span className="mt-2 block text-sm text-red">{linkText[item.section]}</span>
            </Link>
          ))}
          {recommendations.length > 3 ? (
            <button
              type="button"
              className="h-11 text-left text-sm text-muted"
              onClick={() => setTipsOpen((open) => !open)}
            >
              {tipsOpen ? "Свернуть" : `Ещё ${recommendations.length - 3}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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

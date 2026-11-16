import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { sampleCabinet } from "@/features/cabinet/sample.ts";
import { formatRuDate } from "@/features/cabinet/rules.ts";
import { ads, dialogs, payments, unpaidDiagnostic, windows, PHOTO_SLOTS, type Ad } from "./data.ts";
import {
  PHOTO_TARGET,
  TOP_PLACE,
  contactRate,
  formatPercent,
  inContactGoal,
  missingSlotNames,
  nudgeReady,
  payingStudentCount,
  placeTone,
  promotionSpend,
  reminderState,
  replyLate,
  studentCost,
} from "./rules.ts";
import { readBookings, readExtraPayments, writeBookings, writeExtraPayments, STORE_EVENT, type ExtraPayment } from "./store.ts";

function Percent({ views, contacts }: { views: number; contacts: number }) {
  const rate = contactRate(views, contacts);
  if (rate === null) return <span className="text-muted">нет просмотров</span>;
  const tone = rate < 10 ? "text-red" : inContactGoal(rate) ? "text-ok" : "text-ink";
  return <span className={tone}>{formatPercent(rate)}</span>;
}

export function AdsSection() {
  const [openId, setOpenId] = useState(ads[0]?.id ?? "");
  const open = ads.find((ad) => ad.id === openId) ?? null;
  if (ads.length === 0) {
    return (
      <div>
        <p className="text-muted">Объявлений нет.</p>
      </div>
    );
  }
  return (
    <div>
      <ul className="divide-y divide-line border-y border-line">
        {ads.map((ad) => {
          const missing = missingSlotNames(ad.photos, PHOTO_SLOTS);
          const blocked = sampleCabinet.blocks.items.some((item) => item.title === ad.title);
          return (
            <li key={ad.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-baseline justify-between gap-4 py-3 text-left"
                onClick={() => setOpenId(ad.id)}
                aria-expanded={ad.id === openId}
              >
                <span className="font-medium">{ad.title}</span>
                <span className={missing.length > 0 || !ad.offerHasDiagnostic || blocked ? "text-red" : "text-muted"}>
                  {PHOTO_TARGET - missing.length} из {PHOTO_TARGET} фото
                  {ad.offerHasDiagnostic ? "" : " · нет оффера"}
                  {blocked ? " · заблокировано" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open ? <AdDetail ad={open} /> : null}
    </div>
  );
}

function AdDetail({ ad }: { ad: Ad }) {
  const filled = new Set(ad.photos);
  const blocked = sampleCabinet.blocks.items.some((item) => item.title === ad.title);
  return (
    <div className="mt-6">
      <p>{ad.text}</p>
      <p className={`mt-3 ${ad.offerHasDiagnostic ? "text-ok" : "text-red"}`}>
        {ad.offerHasDiagnostic ? "Оффер с диагностикой есть" : "Оффера с диагностикой нет"}
      </p>
      {blocked ? <p className="mt-1 text-red">Заблокировано</p> : null}
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PHOTO_SLOTS.map((name, index) => {
          const has = filled.has(name);
          return (
            <li
              key={name}
              className={`rounded-2xl border px-3 py-3 text-sm ${has ? "border-line" : "border-red text-red"}`}
            >
              <span className="block text-muted">{index + 1}</span>
              {name}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

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
                <span className={`mt-0.5 block text-sm font-normal ${ad.autobidder ? "text-red" : "text-muted"}`}>
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

export function DialogsSection() {
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState(dialogs[0]?.id ?? "");
  const [thread, setThread] = useState(false);
  const [replies, setReplies] = useState(() => Object.fromEntries(dialogs.map((dialog) => [dialog.id, dialog.reply])));
  const open = dialogs.find((dialog) => dialog.id === openId) ?? null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-line md:grid md:grid-cols-[240px_minmax(0,1fr)]">
        <ul className={`md:border-r md:border-line ${thread ? "max-md:hidden" : ""}`}>
          {dialogs.map((dialog) => {
            const late = replyLate(dialog.waitingSince, now);
            const nudge = nudgeReady(dialog, now);
            return (
              <li key={dialog.id} className="border-b border-line">
                <button
                  type="button"
                  className={`min-h-11 w-full px-3 py-3 text-left ${dialog.id === openId ? "ring-1 ring-inset ring-line" : ""}`}
                  onClick={() => {
                    setOpenId(dialog.id);
                    setThread(true);
                  }}
                >
                  <span className="block font-medium">{dialog.name}</span>
                  <span className={`block text-sm ${late || nudge ? "text-red" : "text-muted"}`}>
                    {late ? "ждёт дольше 30 минут" : nudge ? "молчит сутки, одно сообщение" : dialog.topic}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {open ? (
          <div className={`grid min-h-80 grid-rows-[auto_1fr_auto] ${thread ? "" : "max-md:hidden"}`}>
            <div className="flex items-center gap-3 border-b border-line px-3 py-3">
              <button type="button" className="font-medium text-red md:hidden" onClick={() => setThread(false)}>
                Назад
              </button>
              <div>
                <p className="font-medium">{open.name}</p>
                <p className="text-sm text-muted">{open.topic}</p>
              </div>
            </div>
            <div className="grid content-start gap-2 p-3">
              {open.messages.map((message, index) => (
                <p
                  key={`${open.id}-${index}`}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${message.author === "Анна" ? "justify-self-end bg-ink text-bg" : "border border-line bg-line text-ink"}`}
                >
                  <span className="mb-0.5 block text-xs opacity-70">{message.author}</span>
                  {message.text}
                </p>
              ))}
            </div>
            <label className="border-t border-line p-3 text-sm text-muted">
              Ответ
              <textarea
                className="mt-1 min-h-20 w-full resize-y rounded-xl border border-line bg-bg px-3 py-2 text-ink"
                value={replies[open.id] ?? ""}
                aria-label={`Ответ ${open.name}`}
                onChange={(event) => setReplies((prev) => ({ ...prev, [open.id]: event.target.value }))}
              />
            </label>
          </div>
        ) : (
          <p className="p-4 text-muted">Диалогов нет.</p>
        )}
      </div>
    </div>
  );
}

export function DiagnosticSection() {
  const [now, setNow] = useState(() => Date.now());
  const [booked, setBooked] = useState<Record<string, string>>({});

  useEffect(() => {
    setBooked(readBookings());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  function book(windowId: string, name: string) {
    setBooked((prev) => {
      const already =
        windows.some((slot) => slot.takenBy === name) || Object.values(prev).includes(name) || Boolean(prev[windowId]);
      if (already || windows.find((slot) => slot.id === windowId)?.takenBy) return prev;
      const next = { ...prev, [windowId]: name };
      writeBookings(next);
      return next;
    });
  }

  return (
    <div>
      <ul className="mt-8 divide-y divide-line border-y border-line">
        {windows.map((slot) => {
          const taken = slot.takenBy || booked[slot.id] || null;
          const reminder = reminderState(taken ? slot.startsAt : null, now);
          const igorTaken = windows.some((item) => item.takenBy === "Игорь") || Object.values(booked).includes("Игорь");
          return (
            <li key={slot.id} className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{slot.label}</p>
                <p className={`text-sm ${reminder === "пора напомнить" ? "text-red" : "text-muted"}`}>
                  {taken ? `${taken} · ${reminder}` : "свободно"}
                </p>
              </div>
              {taken || igorTaken ? null : (
                <button type="button" className="min-h-11 rounded-full bg-ink px-4 text-sm font-medium text-bg" onClick={() => book(slot.id, "Игорь")}>
                  Записать Игоря
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PaymentsSection() {
  const [extra, setExtra] = useState<ExtraPayment[]>([]);
  const [draft, setDraft] = useState("");
  const extraRef = useRef<ExtraPayment[]>([]);
  const lock = useRef(false);

  useEffect(() => {
    const stored = readExtraPayments();
    extraRef.current = stored;
    setExtra(stored);
  }, []);

  const all = [
    ...payments.map((payment) => ({ who: payment.who, amountRub: payment.amountRub, at: payment.at })),
    ...extra.map((payment) => ({ who: payment.who, amountRub: payment.amountRub, at: "сейчас" })),
  ];
  const kirillPaid = all.some((payment) => payment.who === unpaidDiagnostic);
  const cost = studentCost(promotionSpend(ads), payingStudentCount(all.map((payment) => payment.who)));

  function add(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const amount = Math.round(Number(draft.replace(/\s/g, "").replace(",", ".")));
    if (!Number.isInteger(amount) || amount <= 0 || amount > 999_999) return;
    if (extraRef.current.some((item) => item.who === unpaidDiagnostic)) return;
    if (payments.some((item) => item.who === unpaidDiagnostic)) return;
    lock.current = true;
    const next = [...extraRef.current, { who: unpaidDiagnostic, amountRub: amount }];
    extraRef.current = next;
    setDraft("");
    setExtra(next);
    writeExtraPayments(next);
    lock.current = false;
  }

  return (
    <div className="mt-8">
      <p className="font-display text-4xl font-medium">{cost === null ? "не посчитать" : `${cost.toLocaleString("ru-RU")} ₽`}</p>
      <p className="mt-1 text-muted">
        на одного из {payingStudentCount(all.map((payment) => payment.who))} · расход {promotionSpend(ads).toLocaleString("ru-RU")} ₽
      </p>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {all.map((payment, index) => (
          <li key={`${payment.who}-${index}`} className="flex items-baseline justify-between gap-4 py-3">
            <span>
              {payment.who}
              <span className="mt-0.5 block text-sm text-muted">{formatRuDate(payment.at)}</span>
            </span>
            <span>{payment.amountRub.toLocaleString("ru-RU")} ₽</span>
          </li>
        ))}
        {kirillPaid ? null : (
          <li className="flex items-baseline justify-between gap-4 py-3 text-red">
            <span>{unpaidDiagnostic}</span>
            <span>оплаты нет</span>
          </li>
        )}
      </ul>
      {kirillPaid ? null : (
        <form className="mt-4 flex gap-2" onSubmit={add}>
          <input
            className="h-11 w-36 rounded-xl border border-line bg-bg px-3"
            inputMode="numeric"
            placeholder="Кирилл, ₽"
            aria-label="Оплата Кирилла"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="h-11 rounded-full bg-ink px-4 font-medium text-bg">
            Внести
          </button>
        </form>
      )}
    </div>
  );
}

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const DATA_YEAR = 2026;
const DATA_MONTH = 10;

function countLabel(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${count} ${word}`;
}

function rubPer(spend: number, count: number): string {
  if (count <= 0 || spend < 0) return "—";
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
  return <TriangleAlert className={`h-4 w-4 shrink-0 ${tone === "bad" ? "text-red" : "text-warn"}`} aria-label={tone === "bad" ? "сильно ниже" : "проседает"} />;
}

export function DashboardSection() {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [now, setNow] = useState(() => Date.now());
  const [extra, setExtra] = useState<ExtraPayment[]>([]);
  const [booked, setBooked] = useState<Record<string, string>>({});
  const [tipsOpen, setTipsOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      setExtra(readExtraPayments());
      setBooked(readBookings());
    };
    sync();
    window.addEventListener(STORE_EVENT, sync);
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.removeEventListener(STORE_EVENT, sync);
      window.clearInterval(timer);
    };
  }, []);

  const isDataMonth = cursor.year === DATA_YEAR && cursor.month === DATA_MONTH;
  const isCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth();
  const shows = isDataMonth ? ads.reduce((sum, ad) => sum + ad.shows, 0) : 0;
  const views = isDataMonth ? ads.reduce((sum, ad) => sum + ad.views, 0) : 0;
  const contacts = isDataMonth ? ads.reduce((sum, ad) => sum + ad.contacts, 0) : 0;
  const spend = isDataMonth ? promotionSpend(ads) : 0;
  const payers = isDataMonth ? [...payments.map((payment) => payment.who), ...extra.map((payment) => payment.who)] : [];
  const paidCount = payingStudentCount(payers);
  const kirillPaid = payers.includes(unpaidDiagnostic);
  const diagnosed = isDataMonth ? paidCount + (kirillPaid ? 0 : 1) : 0;
  const viewRate = contactRate(shows, views);
  const wroteRate = contactRate(views, contacts);
  const diagRate = contactRate(contacts, diagnosed);
  const saleRate = contactRate(diagnosed, paidCount);
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
      conversion: diagRate === null ? "—" : formatPercent(diagRate),
      cost: rubPer(spend, diagnosed),
      tone: null,
    },
    {
      label: "продаж",
      value: paidCount,
      conversion: saleRate === null ? "—" : formatPercent(saleRate),
      cost: rubPer(spend, paidCount),
      tone: saleRate !== null && saleRate < 100 ? "warn" : null,
    },
  ];

  const contactAds = (isDataMonth ? ads : []).filter((ad) => ad.contacts > 0).sort((a, b) => b.contacts - a.contacts);
  const leader = contactAds[0];
  const trailer = contactAds[contactAds.length - 1];
  const adCompare =
    leader && trailer && leader.id !== trailer.id
      ? `${AD_NAME[leader.id]} даёт контакты чаще, чем ${AD_NAME[trailer.id]}`
      : null;

  const cityMap = new Map<string, { places: number[]; bids: number[] }>();
  if (isDataMonth) {
    for (const ad of ads) {
      for (const city of ad.cities) {
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
  const cityCompare = cities.length > 1 ? `${cities[0].name} в топе выше, чем ${cities[cities.length - 1].name}` : null;

  const blockedTitles = new Set(sampleCabinet.blocks.items.map((item) => item.title));
  const recommendations: { id: string; title: string; text: string; section: "ads" | "stats" | "chats"; rank: number }[] = [];
  const late = dialogs
    .filter((dialog) => replyLate(dialog.waitingSince, now))
    .sort((a, b) => Date.parse(a.waitingSince ?? "") - Date.parse(b.waitingSince ?? ""));
  for (const dialog of late) {
    recommendations.push({
      id: dialog.id,
      title: `${dialog.name} ждёт ответа больше получаса`,
      text: "На вопрос о цене предложите окно, не прайс.",
      section: "chats",
      rank: 1,
    });
  }
  for (const dialog of dialogs) {
    if (!nudgeReady(dialog, now)) continue;
    recommendations.push({
      id: dialog.id,
      title: `${dialog.name} молчит уже сутки`,
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
        title: `Объявление «${name}» заблокировано`,
        text: "Проверьте причину блокировки и рекомендации Авито по исправлению.",
        section: "ads",
        rank: 0,
      });
    }
    const missing = missingSlotNames(ad.photos, PHOTO_SLOTS);
    if (missing.length > 0 || !ad.offerHasDiagnostic) {
      recommendations.push({
        id: `photo-${ad.id}`,
        title: `У «${name}» ${PHOTO_TARGET - missing.length} фото из ${PHOTO_TARGET}`,
        text: ad.offerHasDiagnostic ? "Доберите десятку, иначе показ слабый." : "Нет оффера с диагностикой. В показ такое лучше не ставить.",
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
  void booked;
  if (isDataMonth && !kirillPaid) {
    recommendations.push({
      id: "kirill",
      title: `${unpaidDiagnostic} не оплатил после диагностики`,
      text: "Напомните один раз.",
      section: "stats",
      rank: 4,
    });
  }
  recommendations.sort((a, b) => a.rank - b.rank);
  const visibleTips = tipsOpen ? recommendations : recommendations.slice(0, 3);
  const linkText = { ads: "К объявлениям", stats: "К аналитике", chats: "К диалогам" };

  function shift(delta: number) {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    if (next.getFullYear() * 12 + next.getMonth() > today.getFullYear() * 12 + today.getMonth()) return;
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <button type="button" className="h-11 w-11 rounded-full text-xl" aria-label="Предыдущий месяц" onClick={() => shift(-1)}>
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

      <div className="dashboard-funnel mt-6 flex gap-2 overflow-x-auto pb-1">
        {steps.map((step) => (
          <article key={step.label} className="min-w-36 flex-1 rounded-2xl border border-line bg-surface px-3 py-4">
            <p className="flex items-center gap-2 text-sm text-muted">
              {step.label}
              <Mark tone={step.tone} />
            </p>
            <p className="mt-1 font-display text-3xl font-medium">{step.value.toLocaleString("ru-RU")}</p>
            <p className={`mt-3 text-sm ${step.tone === "bad" ? "text-red" : step.tone === "warn" ? "text-warn" : ""}`}>{step.conversion}</p>
            <p className="text-sm text-muted">{step.cost}</p>
          </article>
        ))}
      </div>

      {isDataMonth && wroteRate !== null ? (
        <p className={`mt-4 ${wroteRate < 10 ? "text-red" : "text-ok"}`}>
          Норма контактов — 10–12% от просмотров. Сейчас {formatPercent(wroteRate)}.
          {wroteRate < 10 ? " Это меньше." : inContactGoal(wroteRate) ? " Это норма." : " Это выше нормы."}
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
                    <span className={`ml-2 ${tone === "bad" ? "text-red" : "text-muted"}`}>{rate === null ? "—" : formatPercent(rate)}</span>
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
                    <span className={tone === "bad" ? "text-red" : tone === "warn" ? "text-warn" : ""}>{placeLabel(city.best, city.worst)}</span>
                    <span className="ml-2 text-muted">ставка {moneyRange(city.bidMin, city.bidMax)}</span>
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
              search={{ section: item.section }}
              className="rounded-2xl border border-line bg-surface px-4 py-4"
            >
              <span className="block font-medium">{item.title}</span>
              <span className="mt-1 block text-sm leading-5 text-muted">{item.text}</span>
              <span className="mt-2 block text-sm text-red">{linkText[item.section]}</span>
            </Link>
          ))}
          {recommendations.length > 3 ? (
            <button type="button" className="h-11 text-left text-sm text-muted" onClick={() => setTipsOpen((open) => !open)}>
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

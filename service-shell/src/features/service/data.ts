import { dialogExamples } from "./dialog-examples.ts";
import { getPreviewData } from "./preview-data.ts";
import { previewAdTotals, previewImageUrl } from "./preview-data.ts";
export type CityBid = {
  city: string;
  bidRub: number;
  place: number;
};

export type Ad = {
  id: string;
  title: string;
  text: string;
  photos: string[];
  offerHasDiagnostic: boolean;
  shows: number;
  views: number;
  contacts: number;
  spendRub: number;
  cities: CityBid[];
  autobidder: boolean;
  status?: string;
  price?: number | null;
  bidding?: import("./preview-data.ts").PreviewAd["bidding"];
  address?: string;
  autoloadId?: string;
  startsAt?: string;
  finishesAt?: string;
  attributes?: Record<string, string>;
  source?: "cantor" | "sheet";
};

export type DialogMessage = {
  id?: string;
  at?: string;
  author: string;
  text: string;
};

export type Dialog = {
  id: string;
  name: string;
  topic: string;
  messages: DialogMessage[];
  reply: string;
  waitingSince: string | null;
  silentSince: string | null;
};

export type WindowSlot = {
  id: string;
  label: string;
  startsAt: string;
  takenBy: string | null;
};

export const PHOTO_SLOTS = [
  "Репетитор",
  "Доска",
  "Пробник",
  "Баллы",
  "Оффер",
  "Отзыв",
  "Формат",
  "Расписание",
  "Результат",
  "Запись",
] as const;

const egeText =
  "Готовлю к профильному ЕГЭ: с школьных 50–60 к 80+. На первой встрече смотрю пробник и говорю, что закрывать первым. Цена — после диагностики, 30 минут.";

const ogeText =
  "ОГЭ по математике: разбираем ошибки, а не прорешиваем вариант подряд. На диагностике смотрю работу и называю, сколько занятий нужно до экзамена.";

const exampleAds: Ad[] = [
  {
    id: "ege",
    title: "Математика ЕГЭ, с 60 до 80+",
    text: egeText,
    photos: [...PHOTO_SLOTS],
    offerHasDiagnostic: true,
    shows: 920,
    views: 140,
    contacts: 8,
    spendRub: 2940,
    cities: [{ city: "Москва", bidRub: 42, place: 14 }],
    autobidder: false,
  },
  {
    id: "oge",
    title: "ОГЭ, разбор ошибок",
    text: ogeText,
    photos: [...PHOTO_SLOTS],
    offerHasDiagnostic: true,
    shows: 740,
    views: 178,
    contacts: 21,
    spendRub: 3480,
    cities: [
      { city: "Москва", bidRub: 28, place: 6 },
      { city: "Область", bidRub: 22, place: 18 },
    ],
    autobidder: false,
  },
  {
    id: "alg",
    title: "Алгебра, 8 класс",
    text: "Дроби, уравнения, оценка за четверть. В показ не стоит: нет четырёх фото и оффера с диагностикой.",
    photos: [...PHOTO_SLOTS.slice(0, 6)],
    offerHasDiagnostic: false,
    shows: 0,
    views: 0,
    contacts: 0,
    spendRub: 0,
    cities: [],
    autobidder: false,
  },
];

const exampleDialogs: Dialog[] = [
  ...dialogExamples.map((e) => ({
    id: e.id,
    name: e.name,
    topic: e.topic,
    messages: e.messages,
    reply: e.proposal ?? "",
    waitingSince: e.messages.at(-1)?.author !== "Анна" ? e.messages.at(-1)!.at : null,
    silentSince: null,
  })),
  {
    id: "marina",
    name: "Марина",
    topic: "ЕГЭ",
    waitingSince: "2026-11-16T06:30:00.000Z",
    silentSince: null,
    reply:
      "Цену назову на диагностике: за 30 минут посмотрим пробник и скажу, что закрывать первым. В четверг свободно в 19:00. Подойдёт?",
    messages: [
      {
        at: "2026-11-15T15:20:00Z",
        author: "Марина",
        text: "Здравствуйте. Дочь в 11 классе, пробник по профилю на 58. К ЕГЭ берёте?",
      },
      {
        at: "2026-11-15T15:22:00Z",
        author: "Анна",
        text: "Да, к профилю веду. Пробник решала целиком или отдельные номера?",
      },
      {
        at: "2026-11-16T06:30:00Z",
        author: "Марина",
        text: "Целиком, вторая часть почти пустая. А сколько стоит подготовка?",
      },
    ],
  },
  {
    id: "igor",
    name: "Игорь",
    topic: "ОГЭ",
    waitingSince: "2026-11-16T05:50:00.000Z",
    silentSince: null,
    reply: "21 ноября есть 12:00 и 16:00. Какое записать?",
    messages: [
      {
        at: "2026-11-16T05:40:00Z",
        author: "Игорь",
        text: "Здравствуйте, сын в 9 классе, математика — тройка. Нужен ОГЭ.",
      },
      {
        at: "2026-11-16T05:45:00Z",
        author: "Анна",
        text: "К ОГЭ беру. Удобно на 30 минут и посмотреть, где сыпется?",
      },
      { at: "2026-11-16T05:50:00Z", author: "Игорь", text: "Можно в субботу?" },
    ],
  },
  {
    id: "olga",
    name: "Ольга",
    topic: "10 класс",
    waitingSince: null,
    silentSince: "2026-11-15T05:00:00.000Z",
    reply: "Ольга, окно в среду 18:00 ещё держу. Если неудобно — напишите день.",
    messages: [
      {
        at: "2026-11-14T12:00:00Z",
        author: "Ольга",
        text: "Добрый день. Дочь в 10 классе, алгебра проседает.",
      },
      {
        at: "2026-11-15T05:00:00Z",
        author: "Анна",
        text: "Могу посмотреть тетрадь на диагностике. В среду свободно в 18:00.",
      },
    ],
  },
];

const exampleWindows: WindowSlot[] = [
  { id: "tue", label: "Вт 17:00", startsAt: "2026-11-17T14:00:00.000Z", takenBy: null },
  { id: "thu", label: "Чт 19:00", startsAt: "2026-11-19T16:00:00.000Z", takenBy: "Светлана" },
  { id: "sat-12", label: "Сб 12:00", startsAt: "2026-11-21T09:00:00.000Z", takenBy: null },
  { id: "sat-16", label: "Сб 16:00", startsAt: "2026-11-21T13:00:00.000Z", takenBy: null },
];
const preview = getPreviewData();
export const ads: Ad[] = preview
  ? preview.ads.map((a) => {
      const traffic = previewAdTotals(a.id);
      return {
        id: a.id,
        title: a.title,
        text: a.description || "",
        photos: (a.photos || []).map((_, i) => previewImageUrl(a.id, i)),
        offerHasDiagnostic: /диагност/i.test(a.description || ""),
        shows: traffic.shows,
        views: traffic.views,
        contacts: traffic.contacts,
        spendRub: traffic.spendRub,
        cities: a.city ? [{ city: a.city, bidRub: a.bidding?.currentRub ?? NaN, place: NaN }] : [],
        autobidder: a.bidding?.mode === "2",
        status: a.status,
        price: a.price,
        bidding: a.bidding,
        address: a.address,
        autoloadId: a.autoloadId,
        startsAt: a.startsAt,
        finishesAt: a.finishesAt,
        attributes: a.attributes,
        source: a.source,
      };
    })
  : exampleAds;
export const dialogs: Dialog[] = preview
  ? preview.chats.map((c) => ({
      id: c.id,
      name: c.name || "Собеседник",
      topic: c.itemTitle || "",
      reply: "",
      messages: (c.messages || []).map((m) => ({
        id: m.id,
        at: new Date(m.at).toISOString(),
        author:
          m.author === "manager"
            ? "Елена"
            : m.author === "client"
              ? c.name || "Собеседник"
              : "Система",
        text: m.text,
      })),
      waitingSince: c.lastAuthor === "client" && c.lastAt ? new Date(c.lastAt).toISOString() : null,
      silentSince: null,
    }))
  : exampleDialogs;
export const windows: WindowSlot[] = preview ? [] : exampleWindows;

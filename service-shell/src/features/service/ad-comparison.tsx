import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { bidModes } from "./ads-options";
import { getPreviewData } from "./preview-data";
import {
  comparisonNumber as number,
  comparisonRatio as ratio,
  type ComparisonMetrics,
} from "./ad-comparison-model";
import "./ad-comparison.css";

type ComparisonAd = ComparisonMetrics & {
  id: string;
  title: string;
  city: string;
  price: number;
  bidding?: import("./preview-data").PreviewAd["bidding"];
};
export function AdComparison({ items, onClose }: { items: ComparisonAd[]; onClose: () => void }) {
  const returnFocus = useRef(document.activeElement);
  const snapshot = getPreviewData();
  const period = snapshot?.defaultPeriod || { from: "2026-11-01", to: "2026-11-17" };
  const rows: { label: string; value: (a: ComparisonAd) => string }[] = [
    { label: "Город объявления", value: (a) => a.city || "Нет данных" },
    { label: "Цена объявления", value: (a) => number(a.price, " ₽") },
    { label: "Показы", value: (a) => number(a.shows) },
    { label: "Просмотры", value: (a) => number(a.views) },
    { label: "Контакты", value: (a) => number(a.contacts) },
    { label: "Расходы", value: (a) => number(a.spend, " ₽") },
    { label: "Показы → просмотры · просмотры / показы", value: (a) => rate(a.views, a.shows) },
    {
      label: "Просмотры → контакты · контакты / просмотры",
      value: (a) => rate(a.contacts, a.views),
    },
    { label: "Цена просмотра · расходы / просмотры", value: (a) => cost(a.spend, a.views) },
    { label: "Цена контакта (CPL) · расходы / контакты", value: (a) => cost(a.spend, a.contacts) },
    {
      label: "Ставка в сохранённом срезе",
      value: (a) => number(a.bidding?.currentRub ?? undefined, " ₽"),
    },
    {
      label: "Режим ставки · источник",
      value: (a) =>
        bidModes.find((mode) => mode.value === a.bidding?.mode)?.label ||
        a.bidding?.mode ||
        "Нет данных",
    },
    {
      label: "Дневной бюджет в срезе",
      value: (a) => number(a.bidding?.dailyBudgetRub ?? undefined, " ₽"),
    },
  ];
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ac-overlay" />
        <Dialog.Content
          className="ac-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
          }}
        >
          <div className="ac-heading">
            <Dialog.Title>Сравнение объявлений · {items.length}</Dialog.Title>
            <Dialog.Close className="aw-btn" aria-label="Закрыть сравнение">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="ac-description">
            {snapshot
              ? `Период: ${period.from} — ${period.to}, МСК. Источник: сохранённая статистика Авито.`
              : "Источник: локальные примеры. Период не задан."}
            {snapshot?.readAt
              ? ` Срез прочитан: ${new Date(snapshot.readAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.`
              : ""}
          </Dialog.Description>
          <div
            className="ac-scroll"
            tabIndex={0}
            role="region"
            aria-label="Таблица сравнения, прокрутка по горизонтали"
          >
            <table className="ac-table">
              <caption className="sr-only">Показатели выбранных объявлений за один период</caption>
              <thead>
                <tr>
                  <th scope="col">Показатель</th>
                  {items.map((a) => (
                    <th scope="col" key={a.id}>
                      {a.title}
                      <small>ID {a.id}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {items.map((a) => (
                      <td key={a.id}>{row.value(a)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ac-note">
            «Нет данных» — значение отсутствует; 0 — измеренный ноль. «Не рассчитывается» — нет
            исходных данных или знаменатель равен нулю. Объём выборки — показы, просмотры и контакты
            выше.
          </p>
          <p className="ac-note">
            Ставка и бюджет относятся к сохранённому срезу, а не ко всему периоду. История ставок и
            подтверждённые дни платного продвижения недоступны. По этим показателям нельзя
            установить причину различий.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function rate(n: number, d: number | undefined) {
  const r = ratio(n, d);
  return r === null ? "Не рассчитывается" : number(r * 100, "%");
}
function cost(n: number, d: number) {
  const r = ratio(n, d);
  return r === null ? "Не рассчитывается" : number(r, " ₽");
}

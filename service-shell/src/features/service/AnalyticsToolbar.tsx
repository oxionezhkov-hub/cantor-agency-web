import * as Popover from "@radix-ui/react-popover";
import { ArrowDownToLine, CalendarDays, RotateCcw, MapPin, LayoutList } from "lucide-react";
import { ads } from "./data.ts";
import { ANALYTICS_CITIES, ANALYTICS_COVERAGE, adTitleFilter } from "./analytics-model.ts";
import { ServiceDatePicker, ServiceSelect } from "./service-controls.tsx";
import "./service-controls.css";

export type AnalyticsToolbarProps = {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  adId: string;
  onAdChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
  onReset: () => void;
  onExport: () => void;
  invalid: boolean;
  dirty: boolean;
};
const addDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function AnalyticsToolbar(props: AnalyticsToolbarProps) {
  const {
    from,
    to,
    onFromChange,
    onToChange,
    adId,
    onAdChange,
    city,
    onCityChange,
    onReset,
    onExport,
    invalid,
    dirty,
  } = props;
  const yesterday = addDay(new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10), -1);
  const choose = (from: string, to: string) => {
    onFromChange(from);
    onToChange(to);
  };
  return (
    <div className="an-compact-toolbar">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="an-calendar-trigger"
            aria-label="Выбрать период"
            title="Выбрать период"
          >
            <CalendarDays size={18} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="sc-range-popover"
            sideOffset={8}
            align="start"
            collisionPadding={12}
            aria-label="Выбор периода"
          >
            <ServiceDatePicker label="Начало периода" value={from} onChange={onFromChange} />
            <ServiceDatePicker label="Конец периода" value={to} onChange={onToChange} />
            <Popover.Close className="sc-range-done">Готово</Popover.Close>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <div className="an-compact-presets" aria-label="Быстрый период">
        <button
          type="button"
          aria-pressed={from === ANALYTICS_COVERAGE.from && to === ANALYTICS_COVERAGE.to}
          onClick={() => choose(ANALYTICS_COVERAGE.from, ANALYTICS_COVERAGE.to)}
        >
          Ноябрь
        </button>
        <button
          type="button"
          aria-pressed={from === addDay(ANALYTICS_COVERAGE.to, -6) && to === ANALYTICS_COVERAGE.to}
          onClick={() => choose(addDay(ANALYTICS_COVERAGE.to, -6), ANALYTICS_COVERAGE.to)}
        >
          7 дней
        </button>
        <button
          type="button"
          aria-pressed={from === yesterday && to === yesterday}
          onClick={() => choose(yesterday, yesterday)}
        >
          Вчера
        </button>
      </div>
      <ServiceSelect
        label="Фильтр по объявлению"
        value={adId}
        onChange={onAdChange}
        options={[
          { value: "", label: "Все объявления" },
          ...[...new Set(ads.map((ad) => ad.title))].map((title) => ({ value: adTitleFilter(title), label: title })),
        ]}
        mobileIcon={<LayoutList size={17} />}
        menuClassName="an-ad-menu"
        className="an-ad-select"
      />
      <ServiceSelect
        label="Фильтр по городу"
        value={city}
        onChange={onCityChange}
        options={[
          { value: "", label: "Все города" },
          ...ANALYTICS_CITIES.map((city) => ({ value: city, label: city })),
        ]}
        mobileIcon={<MapPin size={17} />}
        className="an-city-select"
      />
      {dirty ? (
        <button
          type="button"
          className="an-reset-compact"
          onClick={onReset}
          aria-label="Сбросить фильтры"
          title="Сбросить фильтры"
        >
          <RotateCcw size={16} />
        </button>
      ) : null}
      <button type="button" className={`an-export-compact ${dirty ? "an-export-when-clean" : ""}`} aria-label="Скачать CSV" title="Скачать CSV" disabled={invalid} onClick={onExport}>
        <ArrowDownToLine size={16} />
        <span>Скачать CSV</span>
      </button>
    </div>
  );
}

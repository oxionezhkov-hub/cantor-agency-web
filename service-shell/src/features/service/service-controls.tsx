import { useEffect, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import "./service-controls.css";

export type ServiceOption = { value: string; label: string; disabled?: boolean };
const EMPTY_VALUE = "__cantor_all__";
export function ServiceSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  className = "",
  placeholder,
  portalContainer,
  mobileIcon,
  menuClassName = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ServiceOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  portalContainer?: Element;
  mobileIcon?: ReactNode;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Select.Root
      value={value || EMPTY_VALUE}
      onValueChange={(next) => onChange(next === EMPTY_VALUE ? "" : next)}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
    >
      <Select.Trigger
        data-value={value}
        className={`sc-select-trigger ${className}`}
        aria-label={label}
        title={options.find((option) => option.value === value)?.label}
      >
        {mobileIcon ? <span className="sc-select-mobile-icon" aria-hidden="true">{mobileIcon}</span> : null}
        <Select.Value placeholder={placeholder || label}>
          {options.find((option) => option.value === value)?.label || placeholder || label}
        </Select.Value>
        <Select.Icon>
          <ChevronDown size={15} />
        </Select.Icon>
      </Select.Trigger>
      {open && (
        <Select.Portal container={portalContainer}>
          <Select.Content
            className={`sc-select-menu ${menuClassName}`}
            position="popper"
            sideOffset={7}
            collisionPadding={12}
          >
            <Select.Viewport>
              {options.map((option) => (
                <Select.Item
                  className="sc-select-option"
                  key={option.value}
                  data-value={option.value}
                  value={option.value || EMPTY_VALUE}
                  disabled={option.disabled}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={15} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      )}
    </Select.Root>
  );
}
const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const displayDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value.slice(8)}.${value.slice(5, 7)}.${value.slice(0, 4)}`
    : value;
const parseDisplay = (value: string) =>
  /^\d{2}\.\d{2}\.\d{4}$/.test(value)
    ? `${value.slice(6)}-${value.slice(3, 5)}-${value.slice(0, 2)}`
    : value;
export function ServiceDatePicker({
  label,
  value,
  onChange,
  max,
  min,
  disabled,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: string;
  min?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : null;
  const initial = parsed && Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const [month, setMonth] = useState({
    year: initial.getUTCFullYear(),
    month: initial.getUTCMonth(),
  });
  const [draft, setDraft] = useState(displayDate(value));
  useEffect(() => setDraft(displayDate(value)), [value]);
  const start = (new Date(Date.UTC(month.year, month.month, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  const shift = (step: number) =>
    setMonth((current) => {
      const date = new Date(Date.UTC(current.year, current.month + step, 1));
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
    });
  return (
    <div className={`sc-date-field ${className}`}>
      <span className="sc-field-label">{label}</span>
      <div className="sc-date-input">
        <input
          aria-label={label}
          type="text"
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          placeholder="ДД.ММ.ГГГГ"
          onChange={(event) => {
            setDraft(event.target.value);
            onChange(parseDisplay(event.target.value));
          }}
        />
        <Popover.Root
          open={open}
          onOpenChange={(next) => {
            if (next && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
              const date = new Date(`${value}T12:00:00Z`);
              if (Number.isFinite(date.getTime()))
                setMonth({ year: date.getUTCFullYear(), month: date.getUTCMonth() });
            }
            setOpen(next);
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              className="sc-calendar-icon"
              aria-label={`Открыть календарь: ${label}`}
              disabled={disabled}
            >
              <CalendarDays size={17} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="sc-calendar-popover"
              sideOffset={8}
              collisionPadding={12}
              aria-label={`Календарь: ${label}`}
            >
              <div className="sc-calendar-nav">
                <button type="button" onClick={() => shift(-1)} aria-label="Предыдущий месяц">
                  <ChevronLeft size={17} />
                </button>
                <strong aria-live="polite">
                  {MONTHS[month.month]} {month.year}
                </strong>
                <button type="button" onClick={() => shift(1)} aria-label="Следующий месяц">
                  <ChevronRight size={17} />
                </button>
              </div>
              <div className="sc-calendar-weekdays">
                {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="sc-calendar-grid" role="group" aria-label={MONTHS[month.month]}>
                {Array.from({ length: start }, (_, index) => (
                  <span key={`empty-${index}`} />
                ))}
                {Array.from({ length: count }, (_, index) => {
                  const date = isoDate(month.year, month.month, index + 1);
                  return (
                    <button
                      type="button"
                      key={date}
                      aria-label={displayDate(date)}
                      aria-pressed={value === date}
                      className={value === date ? "selected" : ""}
                      disabled={Boolean((max && date > max) || (min && date < min))}
                      onClick={() => {
                        onChange(date);
                        setDraft(displayDate(date));
                        setOpen(false);
                      }}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

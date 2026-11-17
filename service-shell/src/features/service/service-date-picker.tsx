import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { ru } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
export function ServiceDatePicker({
  value,
  max,
  onChange,
}: {
  value: string;
  max: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T12:00:00`) : undefined;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger type="button" className="aw-select" aria-label="Дата оплаты">
        <span>
          {date?.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) ||
            "Выберите дату"}
        </span>
        <CalendarDays size={15} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="service-calendar" sideOffset={8} collisionPadding={12}>
          <DayPicker
            mode="single"
            locale={ru}
            selected={date}
            defaultMonth={date}
            disabled={{ after: new Date(`${max}T23:59:59`) }}
            onSelect={(day) => {
              if (!day) return;
              onChange(
                `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
              );
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

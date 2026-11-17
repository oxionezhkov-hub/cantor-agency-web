import * as Select from "@radix-ui/react-select";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, CircleHelp } from "lucide-react";
import type { ReactNode } from "react";

export function AdsSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  compact = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <Select.Root
      disabled={disabled}
      value={value || "__empty"}
      onValueChange={(v) => onChange(v === "__empty" ? "" : v)}
    >
      <Select.Trigger
        data-value={value}
        aria-label={label}
        className={`aw-select ${compact ? "compact" : ""}`}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal
        container={
          typeof document === "undefined"
            ? undefined
            : (document.querySelector(".aw-editor") ?? undefined)
        }
      >
        <Select.Content
          className="aw-select-menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                data-value={option.value}
                value={option.value || "__empty"}
                disabled={option.disabled}
                className="aw-select-option"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
export function AdsHelp({ label = "Справка", children }: { label?: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="aw-icon aw-help-button" aria-label={label}>
        <CircleHelp size={16} />
      </Popover.Trigger>
      <Popover.Portal
        container={
          typeof document === "undefined"
            ? undefined
            : (document.querySelector(".aw-editor") ?? undefined)
        }
      >
        <Popover.Content sideOffset={8} collisionPadding={16} className="aw-help-popover">
          <div>{children}</div>
          <Popover.Arrow className="aw-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

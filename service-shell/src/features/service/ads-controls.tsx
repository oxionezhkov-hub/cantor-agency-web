import { ServiceSelect } from "./service-controls";
import * as Popover from "@radix-ui/react-popover";
import { CircleHelp } from "lucide-react";
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
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <ServiceSelect
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      className={compact ? "aw-mode-select" : ""}
      portalContainer={
        typeof document === "undefined"
          ? undefined
          : (document.querySelector(".aw-editor") ?? undefined)
      }
    />
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

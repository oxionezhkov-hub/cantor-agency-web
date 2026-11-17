import { useState, type ReactNode, type RefObject } from "react";
import * as Popover from "@radix-ui/react-popover";
import { MessageSquareText, X } from "lucide-react";
import { ServiceSelect } from "./service-controls.tsx";
import { STAGE_LABELS, type LeadStage } from "./lead-workflow.ts";
import type { Lead } from "./crm.ts";
export function AnchoredPanel({
  anchor,
  onClose,
  children,
  label,
  width = 280,
  role = "dialog",
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  label: string;
  width?: number;
  role?: "dialog" | "menu";
}) {
  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <Popover.Content
          className="anchored-workbench-panel"
          role={role}
          aria-label={label}
          align="start"
          sideOffset={8}
          collisionPadding={10}
          style={{ width: `min(${width}px, calc(100vw - 20px))` }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function NoteEditor({ lead, onSave }: { lead: Lead; onSave: (text: string) => boolean }) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(lead.note ?? "");
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setText(lead.note ?? "");
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`icon-control note-button ${lead.note ? "has-note" : ""}`}
          aria-label="Заметка о клиенте"
          title={lead.note ? "Открыть заметку" : "Добавить заметку"}
        >
          <MessageSquareText size={16} />
          {lead.note ? <i /> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="anchored-workbench-panel"
          aria-label="Заметка о клиенте"
          align="start"
          sideOffset={7}
          collisionPadding={12}
          style={{ width: "min(280px, calc(100vw - 24px))" }}
        >
          <div className="note-editor">
            <div>
              <strong>Заметка</strong>
              <button
                type="button"
                className="icon-control"
                aria-label="Закрыть заметку"
                onClick={() => setOpen(false)}
              >
                <X size={15} />
              </button>
            </div>
            <textarea
              autoFocus
              aria-label="Текст заметки"
              value={text}
              maxLength={4000}
              onChange={(e) => setText(e.target.value)}
              placeholder="Напишите важное…"
            />
            <button
              type="button"
              className="crm-secondary"
              onClick={() => {
                if (onSave(text)) setOpen(false);
              }}
            >
              Сохранить
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function StageControl({
  stage,
  onChange,
}: {
  stage: LeadStage;
  onChange: (stage: LeadStage) => void;
}) {
  return (
    <span data-testid="lead-stage" className="stage-select-wrap">
      <ServiceSelect
        label="Изменить этап обращения"
        value={stage}
        onChange={(value) => onChange(value as LeadStage)}
        options={(Object.keys(STAGE_LABELS) as LeadStage[]).map((value) => ({
          value,
          label: STAGE_LABELS[value],
        }))}
        className={`stage-control stage-${stage}`}
      />
    </span>
  );
}

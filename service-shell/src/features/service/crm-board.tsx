import { useRef, useState, useEffect, type PointerEvent } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Plus,
  AlertCircle,
  MapPin,
  ArrowRight,
  Search,
  SlidersHorizontal,
  ClipboardList,
  CreditCard,
  History,
} from "lucide-react";
import { STAGE_LABELS, leadProgress, type LeadStage } from "./lead-workflow.ts";
import { leadHealth, conversationMessages } from "./communication.ts";
import { ads } from "./data.ts";
import { ServiceSelect } from "./service-controls.tsx";
import type { CrmState, Lead } from "./crm.ts";
const date = (at: string) =>
  new Date(at).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
export function CrmBoard({
  state,
  now,
  onOpen,
  onMove,
}: {
  state: CrmState;
  now: number;
  onOpen: (
    id: string,
    panel?: "tasks" | "conversation" | "appointment" | "payments" | "history",
  ) => void;
  onMove: (id: string, stage: LeadStage) => void;
}) {
  const [drag, setDrag] = useState<string | null>(null),
    [over, setOver] = useState<LeadStage | null>(null),
    [filter, setFilter] = useState<"all" | "attention" | "missing" | "ok">("all");
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false),
    [showFilters, setShowFilters] = useState(false);
  const [city, setCity] = useState(""),
    [adId, setAdId] = useState("");
  const board = useRef<HTMLDivElement>(null),
    touch = useRef<{
      id: string;
      x: number;
      y: number;
      timer: ReturnType<typeof setTimeout>;
      active: boolean;
    } | null>(null),
    skipClick = useRef(false);
  useEffect(
    () => () => {
      if (touch.current) clearTimeout(touch.current.timer);
    },
    [],
  );
  const rows = state.leads
    .filter(
      (l) =>
        (!city || l.city === city) &&
        (!adId || l.adId === adId) &&
        (!query.trim() ||
          `${l.name} ${l.city ?? ""} ${conversationMessages(state, l.id)
            .map((m) => m.text)
            .join(" ")}`
            .toLocaleLowerCase("ru-RU")
            .includes(query.trim().toLocaleLowerCase("ru-RU"))),
    )
    .map((lead) => ({
      lead,
      progress: leadProgress(state, lead.id, now),
      health: leadHealth(state, lead, now),
    }));
  const attention = rows.filter((r) => ["overdue", "attention"].includes(r.health.kind)),
    missing = rows.filter((r) => r.health.kind === "missing"),
    ok = rows.filter((r) => r.health.kind === "ok");
  function drop(id: string, stage: LeadStage) {
    if (!state.leads.some((l) => l.id === id)) return;
    onMove(id, stage);
    setDrag(null);
    setOver(null);
  }
  function pointerDown(e: PointerEvent<HTMLElement>, lead: Lead) {
    if (e.pointerType !== "touch") return;
    skipClick.current = false;
    const node = e.currentTarget;
    const timer = setTimeout(() => {
      if (touch.current) {
        touch.current.active = true;
        setDrag(lead.id);
        skipClick.current = true;
        node.setPointerCapture(e.pointerId);
      }
    }, 350);
    touch.current = { id: lead.id, x: e.clientX, y: e.clientY, timer, active: false };
  }
  function pointerMove(e: PointerEvent<HTMLElement>) {
    const t = touch.current;
    if (!t) return;
    if (!t.active) {
      if (Math.abs(t.x - e.clientX) + Math.abs(t.y - e.clientY) > 12) {
        clearTimeout(t.timer);
        touch.current = null;
      }
      return;
    }
    e.preventDefault();
    const rect = board.current?.getBoundingClientRect();
    if (rect) {
      if (e.clientX > rect.right - 36) board.current!.scrollLeft += 18;
      else if (e.clientX < rect.left + 36) board.current!.scrollLeft -= 18;
    }
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-crm-stage]");
    setOver((target?.dataset.crmStage as LeadStage) ?? null);
  }
  function pointerUp(e: PointerEvent<HTMLElement>) {
    const t = touch.current;
    if (!t) return;
    clearTimeout(t.timer);
    if (t.active) {
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-crm-stage]");
      if (target?.dataset.crmStage) drop(t.id, target.dataset.crmStage as LeadStage);
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    }
    touch.current = null;
    setDrag(null);
    setOver(null);
  }
  return (
    <div className="crm-pipeline">
      <div className="crm-toolbar">
        <div className="crm-tools">
          <button
            type="button"
            className="icon-control"
            aria-label="Поиск в CRM"
            onClick={() => {
              setShowSearch(!showSearch);
              setShowFilters(false);
            }}
          >
            <Search size={18} />
          </button>
          {showSearch ? (
            <input
              aria-label="Поиск в CRM"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setShowSearch(false);
                }
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              autoFocus
            />
          ) : null}
          <button
            type="button"
            className="icon-control"
            aria-label="Фильтры CRM"
            onClick={() => {
              setShowFilters(!showFilters);
              setShowSearch(false);
            }}
          >
            <SlidersHorizontal size={18} />
          </button>
          {showFilters ? (
            <div className="crm-filter-controls">
              <ServiceSelect
                label="Город"
                value={city || "all"}
                onChange={(v) => setCity(v === "all" ? "" : v)}
                options={[
                  { value: "all", label: "Все города" },
                  ...[
                    ...new Set(
                      state.leads.map((l) => l.city).filter((v): v is string => Boolean(v)),
                    ),
                  ]
                    .sort()
                    .map((v) => ({ value: v, label: v })),
                ]}
              />
              <ServiceSelect
                label="Объявление"
                value={adId || "all"}
                onChange={(v) => setAdId(v === "all" ? "" : v)}
                options={[
                  { value: "all", label: "Все объявления" },
                  ...[
                    ...new Set(
                      state.leads.map((l) => l.adId).filter((v): v is string => Boolean(v)),
                    ),
                  ].map((v) => ({ value: v, label: ads.find((a) => a.id === v)?.title || v })),
                ]}
              />
            </div>
          ) : null}
        </div>
        <div className="crm-health-filters" role="group" aria-label="Состояние работы">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            Все обращения <span>{rows.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={filter === "attention"}
            onClick={() => setFilter("attention")}
          >
            <AlertCircle size={14} />
            Требуют внимания <span>{attention.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={filter === "missing"}
            onClick={() => setFilter("missing")}
          >
            Без следующего шага <span>{missing.length}</span>
          </button>
          <button type="button" aria-pressed={filter === "ok"} onClick={() => setFilter("ok")}>
            <CheckCircle2 size={14} />В работе <span>{ok.length}</span>
          </button>
        </div>
      </div>
      <div ref={board} className="crm-board" aria-label="CRM обращений">
        {(Object.keys(STAGE_LABELS) as LeadStage[]).map((stage) => {
          const entries = rows.filter(
            (r) =>
              r.progress.stage === stage &&
              (filter === "all" ||
                (filter === "attention" && ["attention", "overdue"].includes(r.health.kind)) ||
                (filter === "missing" && r.health.kind === "missing") ||
                (filter === "ok" && r.health.kind === "ok")),
          );
          return (
            <section
              key={stage}
              className={`crm-lane ${over === stage ? "drop-target" : ""}`}
              data-crm-stage={stage}
              aria-label={STAGE_LABELS[stage]}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(stage);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(e.dataTransfer.getData("application/x-cantor-lead"), stage);
              }}
            >
              <header>
                {STAGE_LABELS[stage]}
                <span>{entries.length}</span>
              </header>
              <div>
                {entries.map(({ lead, progress, health }) => {
                  const last = conversationMessages(state, lead.id).at(-1);
                  return (
                    <article
                      key={lead.id}
                      className={`crm-contact-card health-${health.kind} ${drag === lead.id ? "dragging" : ""}`}
                      draggable
                      data-lead-id={lead.id}
                      aria-label={`Карточка CRM: ${lead.name}`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-cantor-lead", lead.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDrag(lead.id);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                      onPointerDown={(e) => pointerDown(e, lead)}
                      onPointerMove={pointerMove}
                      onPointerUp={pointerUp}
                      onPointerCancel={() => {
                        if (touch.current) clearTimeout(touch.current.timer);
                        touch.current = null;
                        setDrag(null);
                        setOver(null);
                      }}
                      onContextMenu={(e) => {
                        if (touch.current?.active) e.preventDefault();
                      }}
                    >
                      <button
                        type="button"
                        className="crm-card-open"
                        aria-label={`Открыть обращение: ${lead.name}`}
                        onClick={() => {
                          if (skipClick.current) {
                            skipClick.current = false;
                            return;
                          }
                          onOpen(lead.id);
                        }}
                      >
                        <span className="crm-card-person">
                          <span className="chat-avatar">{lead.name.slice(0, 1)}</span>
                          <span>
                            <strong>{lead.name}</strong>
                            {lead.city ? (
                              <small>
                                <MapPin size={11} />
                                {lead.city}
                              </small>
                            ) : null}
                          </span>
                          <ArrowRight size={13} />
                        </span>
                        {last ? <p className="crm-card-last">{last.text}</p> : null}
                        {progress.booked ? (
                          <span className="crm-card-date">
                            <CalendarDays size={13} />
                            {date(progress.booked.startsAt)}
                          </span>
                        ) : null}
                        {progress.receivedMinor > 0 ? (
                          <span className="crm-card-paid">
                            Получено {(progress.receivedMinor / 100).toLocaleString("ru-RU")} ₽
                          </span>
                        ) : null}
                      </button>
                      <div className="crm-card-followup">
                        <span className={`health-label ${health.kind}`}>
                          {health.kind === "ok" ? (
                            <CheckCircle2 size={12} />
                          ) : health.kind !== "closed" ? (
                            <AlertCircle size={12} />
                          ) : null}
                          {health.label}
                        </span>
                        {health.tasks[0] ? (
                          <button
                            type="button"
                            className="crm-next-task"
                            onClick={() => onOpen(lead.id, "tasks")}
                          >
                            <span>{health.tasks[0].title}</span>
                            <time>
                              <Clock3 size={11} />
                              {date(health.tasks[0].dueAt)}
                            </time>
                          </button>
                        ) : null}
                        <div className="crm-card-actions">
                          <button
                            type="button"
                            aria-label="Добавить задачу"
                            title="Добавить задачу"
                            onClick={() => onOpen(lead.id, "tasks")}
                          >
                            <Plus size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label="Диагностика"
                            title="Диагностика"
                            onClick={() => onOpen(lead.id, "appointment")}
                          >
                            <ClipboardList size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label="Оплаты"
                            title="Оплаты"
                            onClick={() => onOpen(lead.id, "payments")}
                          >
                            <CreditCard size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label="История"
                            title="История"
                            onClick={() => onOpen(lead.id, "history")}
                          >
                            <History size={15} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {!entries.length ? <p className="lane-empty">Нет обращений</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

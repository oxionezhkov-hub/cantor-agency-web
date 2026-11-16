import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Copy, Search, X } from "lucide-react";
import { ads, dialogs, windows } from "./data.ts";
import { changeDemoCrm, useDemoCrm } from "./demo-crm-store.ts";
import { DiagnosticSection, PaymentsSection } from "./crm-ui.tsx";
import {
  freeWindows,
  invitationFor,
  leadProgress,
  leadTimeline,
  saveLeadDraft,
  setLeadClosure,
  type DetailTab,
  type LeadStage,
} from "./lead-workflow.ts";
import type { CrmState, Lead } from "./crm.ts";

const FILTERS: { id: string; label: string; stages: LeadStage[] }[] = [
  { id: "all", label: "Все", stages: [] },
  { id: "new", label: "Без записи", stages: ["new"] },
  { id: "booked", label: "Диагностика", stages: ["booked", "outcome"] },
  { id: "after", label: "После встречи", stages: ["after", "no_show"] },
  { id: "student", label: "Ученики", stages: ["student"] },
  { id: "closed", label: "Закрыты", stages: ["closed"] },
];
const TABS: { id: DetailTab; label: string }[] = [
  { id: "conversation", label: "Переписка" },
  { id: "appointment", label: "Диагностика" },
  { id: "payments", label: "Оплаты" },
  { id: "history", label: "История" },
];
const stamp = (at: string) =>
  new Date(at).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });

export function LeadWorkspace({ focus }: { focus?: string }) {
  const { state, storageError } = useDemoCrm();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(focus ?? "marina");
  const [thread, setThread] = useState(Boolean(focus));
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (focus) {
      setSelectedId(focus);
      setThread(true);
    }
  }, [focus]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const selected = state.leads.find((l) => l.id === selectedId) ?? null;
  const rows = state.leads.map((lead) => ({ lead, progress: leadProgress(state, lead.id, now) }));
  const order: Record<LeadStage, number> = {
    outcome: 0,
    new: 1,
    after: 2,
    no_show: 2,
    booked: 3,
    student: 4,
    closed: 5,
  };
  rows.sort(
    (a, b) =>
      order[a.progress.stage] - order[b.progress.stage] ||
      Date.parse(b.lead.createdAt) - Date.parse(a.lead.createdAt),
  );
  const currentFilter = FILTERS.find((f) => f.id === filter)!;
  const found = rows.filter(
    ({ lead, progress }) =>
      (!currentFilter.stages.length || currentFilter.stages.includes(progress.stage)) &&
      `${lead.name} ${state.students.find((s) => s.id === lead.studentId)?.name ?? ""} ${dialogs.find((d) => d.id === lead.id)?.topic ?? ""}`
        .toLocaleLowerCase("ru-RU")
        .includes(query.trim().toLocaleLowerCase("ru-RU")),
  );
  return (
    <div className="lead-workspace">
      <div className="lead-toolbar">
        <label className="lead-search">
          <Search size={17} />
          <input
            aria-label="Поиск обращений"
            placeholder="Имя, ученик, предмет"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setThread(false);
            }}
          />
        </label>
        <div className="lead-filters" role="group" aria-label="Этапы обращений">
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f.id}
              aria-pressed={f.id === filter}
              onClick={() => {
                setFilter(f.id);
                setThread(false);
              }}
            >
              {f.label}
              <span>
                {rows.filter((r) => !f.stages.length || f.stages.includes(r.progress.stage)).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      {storageError ? (
        <p className="crm-error" role="alert">
          {storageError}
        </p>
      ) : null}
      <div className={`lead-split ${thread ? "lead-thread-open" : ""}`}>
        <aside className="lead-list" aria-label="Обращения">
          {found.length ? (
            found.map(({ lead, progress }) => {
              const dialog = dialogs.find((d) => d.id === lead.id),
                last = dialog?.messages.at(-1);
              return (
                <button
                  type="button"
                  key={lead.id}
                  className={`lead-row ${selectedId === lead.id ? "selected" : ""}`}
                  aria-current={selectedId === lead.id ? "true" : undefined}
                  aria-label={`Открыть обращение: ${lead.name}`}
                  onClick={() => {
                    setSelectedId(lead.id);
                    setThread(true);
                    navigate({ to: "/", search: { section: "chats", focus: lead.id } });
                  }}
                >
                  <span className="lead-row-top">
                    <strong>{lead.name}</strong>
                    <span className={`lead-stage stage-${progress.stage}`}>{progress.label}</span>
                  </span>
                  <span className="lead-row-student">
                    {state.students.find((s) => s.id === lead.studentId)?.name}
                  </span>
                  <span className="lead-preview">
                    {progress.stage === "closed"
                      ? lead.closeReason
                      : progress.booked
                        ? stamp(progress.booked.startsAt)
                        : (last?.text ??
                          (progress.receivedMinor
                            ? `Получено ${(progress.receivedMinor / 100).toLocaleString("ru-RU")} ₽`
                            : "Диагностика проведена · ждёт следующего шага"))}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="lead-empty">
              <p>Ничего не найдено</p>
              <button
                type="button"
                className="crm-secondary"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Сбросить фильтры
              </button>
            </div>
          )}
        </aside>
        <div className="lead-detail">
          {selected ? (
            <LeadCard
              key={selected.id}
              state={state}
              lead={selected}
              now={now}
              back={() => setThread(false)}
            />
          ) : (
            <div className="lead-empty">Обращение не найдено. Выберите его в списке.</div>
          )}
        </div>
      </div>
    </div>
  );
}
function LeadCard({
  state,
  lead,
  now,
  back,
}: {
  state: CrmState;
  lead: Lead;
  now: number;
  back: () => void;
}) {
  const progress = leadProgress(state, lead.id, now);
  const conversation = dialogs.find((d) => d.id === lead.id);
  const [tab, setTab] = useState<DetailTab>(conversation ? "conversation" : progress.nextTab);
  const [draft, setDraft] = useState(lead.draft ?? "");
  const [draftDirty, setDraftDirty] = useState(false);
  useEffect(() => {
    if (!draftDirty) setDraft(lead.draft ?? "");
  }, [lead.draft, draftDirty]);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [closing, setClosing] = useState(false),
    [reason, setReason] = useState("");
  const student = state.students.find((s) => s.id === lead.studentId)!;
  const ad = ads.find((a) => a.id === lead.adId);
  function persist() {
    changeDemoCrm((current) => saveLeadDraft(current, current.workspaceId, lead.id, draft));
    setDraftDirty(false);
  }
  async function copy() {
    setError("");
    setNotice("");
    try {
      persist();
      await navigator.clipboard.writeText(draft);
      setNotice("Ответ скопирован.");
    } catch {
      setError("Не удалось скопировать. Сохраните черновик и скопируйте текст вручную.");
    }
  }
  function save() {
    setError("");
    try {
      persist();
      setNotice("Черновик сохранён.");
    } catch {
      setError("Не удалось сохранить черновик.");
    }
  }
  function close(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    try {
      changeDemoCrm((current) =>
        setLeadClosure(
          current,
          current.workspaceId,
          lead.id,
          lead.closedAt ? null : reason,
          new Date().toISOString(),
        ),
      );
      setClosing(false);
      setNotice(lead.closedAt ? "Обращение возвращено в работу." : "Обращение закрыто.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить изменения.");
    }
  }
  const timeline = leadTimeline(state, lead.id);
  const slots = freeWindows(state, windows, now);
  const [invitationSlot, setInvitationSlot] = useState("");
  const slotId = slots.some((s) => s.id === invitationSlot) ? invitationSlot : (slots[0]?.id ?? "");
  function suggestTime() {
    setError("");
    setNotice("");
    try {
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) throw new Error("Свободных окон нет.");
      setDraft(invitationFor(state, lead.id, slot, windows, Date.now()));
      setDraftDirty(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выбрать время.");
    }
  }
  return (
    <article aria-label={`Карточка: ${lead.name}`}>
      <header className="lead-card-header">
        <button className="lead-back crm-quiet" type="button" onClick={back}>
          <ArrowLeft size={17} />
          Все обращения
        </button>
        <div className="lead-card-title">
          <div>
            <h2>{lead.name}</h2>
            <p>{student.name}</p>
          </div>
          <span className={`lead-stage stage-${progress.stage}`} data-testid="lead-stage">
            {progress.label}
          </span>
        </div>
        <div className="lead-source">
          {ad ? (
            <Link to="/" search={{ section: "ads", focus: ad.id }}>
              {ad.title}
              <ArrowRight size={13} />
            </Link>
          ) : (
            <span>Источник не указан</span>
          )}
          <span>{stamp(lead.createdAt)}</span>
        </div>
      </header>
      <div className="lead-next">
        <span>
          {progress.stage === "closed"
            ? lead.closeReason
            : progress.booked
              ? `${stamp(progress.booked.startsAt)} · 30 минут`
              : progress.stage === "after"
                ? "Диагностика проведена"
                : progress.stage === "student"
                  ? `Получено ${(progress.receivedMinor / 100).toLocaleString("ru-RU")} ₽`
                  : progress.stage === "no_show"
                    ? "Ученик не пришёл на встречу"
                    : "Следующий шаг — диагностика"}
        </span>
        <button
          type="button"
          className="crm-primary"
          onClick={() => (progress.stage === "closed" ? close() : setTab(progress.nextTab))}
        >
          {progress.nextLabel}
          <ArrowRight size={15} />
        </button>
      </div>
      <nav className="lead-tabs" aria-label="Карточка обращения">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setNotice("");
              setError("");
            }}
          >
            {t.label}
            {t.id === "payments" && progress.payments.length ? (
              <span>{progress.payments.length}</span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="lead-tab-content">
        {tab === "conversation" ? (
          <div>
            <div className="lead-messages">
              {conversation ? (
                conversation.messages.map((message, i) => (
                  <div
                    key={i}
                    className={`lead-message ${message.author === "Анна" ? "outgoing" : "incoming"}`}
                  >
                    <span>{message.author}</span>
                    <p>{message.text}</p>
                  </div>
                ))
              ) : (
                <p className="lead-empty">Переписка ещё не загружена.</p>
              )}
            </div>
            {!lead.closedAt ? (
              <div className="lead-composer">
                {progress.stage === "new" || progress.stage === "no_show" ? (
                  <div className="lead-invitation">
                    <label>
                      Предложить время
                      <select
                        aria-label="Время для приглашения"
                        value={slotId}
                        onChange={(e) => setInvitationSlot(e.target.value)}
                      >
                        {slots.length ? (
                          slots.map((s) => (
                            <option key={s.id} value={s.id}>
                              {stamp(s.startsAt)} · МСК
                            </option>
                          ))
                        ) : (
                          <option value="">Свободных окон нет</option>
                        )}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="crm-secondary"
                      onClick={suggestTime}
                      disabled={!slots.length}
                    >
                      Вставить приглашение
                    </button>
                  </div>
                ) : null}
                <label>
                  Черновик ответа
                  <textarea
                    aria-label={`Ответ ${lead.name}`}
                    value={draft}
                    maxLength={5000}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setDraftDirty(true);
                      setNotice("");
                    }}
                  />
                </label>
                <div>
                  <button
                    type="button"
                    className="crm-primary"
                    onClick={copy}
                    disabled={!draft.trim()}
                  >
                    <Copy size={16} />
                    Скопировать ответ
                  </button>
                  <button type="button" className="crm-secondary" onClick={save}>
                    <Check size={16} />
                    Сохранить черновик
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {tab === "appointment" ? (
          lead.closedAt ? (
            <p className="lead-empty">
              Обращение закрыто. Верните его в работу, чтобы выбрать время.
            </p>
          ) : (
            <DiagnosticSection key={`appointments-${lead.id}`} leadScope={lead.id} />
          )
        ) : null}
        {tab === "payments" ? (
          <PaymentsSection key={`payments-${lead.studentId}`} studentScope={lead.studentId} />
        ) : null}
        {tab === "history" ? (
          <ol className="lead-timeline">
            {timeline.map((item) => (
              <li key={item.id}>
                <span className="timeline-dot" />
                <div>
                  <p>{item.text}</p>
                  <time dateTime={item.at}>{stamp(item.at)}</time>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        {notice ? (
          <p className="crm-success" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="crm-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {!lead.closedAt ? (
        <div className="lead-close">
          {closing ? (
            <form onSubmit={close}>
              <label>
                Причина закрытия
                <input
                  aria-label="Причина закрытия"
                  value={reason}
                  maxLength={300}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  placeholder="Например, выбрали другого преподавателя"
                />
              </label>
              {progress.booked ? (
                <p>Запись на диагностику будет отменена, окно освободится.</p>
              ) : null}
              <div>
                <button type="submit" className="crm-secondary">
                  Подтвердить закрытие
                </button>
                <button type="button" className="crm-quiet" onClick={() => setClosing(false)}>
                  Отмена
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="crm-quiet" onClick={() => setClosing(true)}>
              <X size={15} />
              Закрыть обращение
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

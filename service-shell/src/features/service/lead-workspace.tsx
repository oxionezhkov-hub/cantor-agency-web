import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Search,
  X,
  MoreHorizontal,
  StickyNote,
  Send,
  Paperclip,
  Reply,
  Check,
  Pencil,
  Columns3,
  MessagesSquare,
  Pause,
  Play,
} from "lucide-react";
import { ads, windows } from "./data.ts";
import { changeDemoCrm, useDemoCrm } from "./demo-crm-store.ts";
import { DiagnosticSection, PaymentsSection } from "./crm-ui.tsx";
import { LeadFollowups } from "./lead-panels.tsx";
import {
  leadProgress,
  leadTimeline,
  freeWindows,
  invitationFor,
  setLeadClosure,
  STAGE_LABELS,
  type LeadStage,
} from "./lead-workflow.ts";
import {
  conversationMessages,
  waitingForReply,
  elapsedLabel,
  reminderDue,
  searchableLead,
  updateLeadDetails,
  disconnectedAdapter,
  acceptDeliveredMessage,
  MODE_LABELS,
  type ReplyMode,
  type ChatMessage,
  type MessageAdapter,
} from "./communication.ts";
import { useDraftCache } from "./use-draft-cache.ts";
import type { CrmState, Lead } from "./crm.ts";
const stamp = (at: string) =>
  new Date(at).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
const hour = (at: string) =>
  new Date(at).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
const day = (at: string) => new Date(Date.parse(at) + 3 * 3600000).toISOString().slice(0, 10);
type Panel = "conversation" | "appointment" | "payments" | "history" | "tasks";
function Avatar({ lead }: { lead: Lead }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="chat-avatar" aria-hidden="true">
      {lead.avatarUrl?.startsWith("https://") && !failed ? (
        <img src={lead.avatarUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        lead.name.slice(0, 1)
      )}
    </span>
  );
}
export function LeadWorkspace({
  focus,
  adapter = disconnectedAdapter,
}: {
  focus?: string;
  adapter?: MessageAdapter;
}) {
  const { state, storageError } = useDemoCrm();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(focus ?? null),
    [view, setView] = useState<"dialogs" | "crm">("dialogs");
  const [filter, setFilter] = useState<"unanswered" | "reminders" | null>("unanswered"),
    [searching, setSearching] = useState(false),
    [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) setSelectedId(focus);
  }, [focus]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle(
      "cantor-chat-open",
      Boolean(selectedId) && view === "dialogs",
    );
    return () => document.documentElement.classList.remove("cantor-chat-open");
  }, [selectedId, view]);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);
  function open(id: string) {
    setSelectedId(id);
    setView("dialogs");
    try {
      changeDemoCrm((s) => updateLeadDetails(s, s.workspaceId, id, { unreadCount: 0 }));
    } catch {
      /* Reading is still possible when storage is unavailable. */
    }
    navigate({ to: "/", search: { section: "chats", focus: id } });
  }
  function back() {
    setSelectedId(null);
    navigate({ to: "/", search: { section: "chats" } });
  }
  const selected = state.leads.find((l) => l.id === selectedId) ?? null;
  const rows = state.leads.map((lead) => ({
    lead,
    progress: leadProgress(state, lead.id, now),
    waiting: waitingForReply(state, lead, now),
    reminder: reminderDue(state, lead, now),
    messages: conversationMessages(state, lead.id),
  }));
  rows.sort(
    (a, b) =>
      Number(Boolean(b.lead.unreadCount)) - Number(Boolean(a.lead.unreadCount)) ||
      Date.parse(b.lead.createdAt) - Date.parse(a.lead.createdAt),
  );
  const found = rows.filter((r) =>
    query.trim()
      ? searchableLead(state, r.lead).includes(query.trim().toLocaleLowerCase("ru-RU"))
      : filter === "unanswered"
        ? r.waiting.waiting
        : filter === "reminders"
          ? r.reminder
          : true,
  );
  const counts = {
    unanswered: rows.filter((r) => r.waiting.waiting).length,
    reminders: rows.filter((r) => r.reminder).length,
  };
  return (
    <div className={`dialog-workbench ${selected ? "contact-open" : ""} view-${view}`}>
      <div className="workbench-view-switch" role="group" aria-label="Представление обращений">
        <button type="button" aria-pressed={view === "dialogs"} onClick={() => setView("dialogs")}>
          <MessagesSquare size={15} />
          Диалоги
        </button>
        <button type="button" aria-pressed={view === "crm"} onClick={() => setView("crm")}>
          <Columns3 size={15} />
          CRM
        </button>
      </div>
      {storageError ? (
        <p role="alert" className="crm-error">
          {storageError}
        </p>
      ) : null}
      {view === "crm" ? (
        <div className="crm-board" aria-label="CRM обращений">
          {(Object.keys(STAGE_LABELS) as LeadStage[]).map((stage) => {
            const entries = rows.filter((r) => r.progress.stage === stage);
            return (
              <section className="crm-lane" key={stage} aria-label={STAGE_LABELS[stage]}>
                <header>
                  {STAGE_LABELS[stage]}
                  <span>{entries.length}</span>
                </header>
                <div>
                  {entries.map(({ lead, waiting }) => {
                    const tasks = (state.followups ?? []).filter(
                      (t) => t.leadId === lead.id && !t.doneAt,
                    );
                    return (
                      <button
                        key={lead.id}
                        className="crm-contact-card"
                        type="button"
                        onClick={() => open(lead.id)}
                      >
                        <span>
                          <Avatar lead={lead} />
                          <strong>{lead.name}</strong>
                        </span>
                        <small>{lead.city ?? "Город не указан"}</small>
                        <p>{ads.find((a) => a.id === lead.adId)?.title ?? "Источник не указан"}</p>
                        {tasks.length ? (
                          <span className="task-count">Задач: {tasks.length}</span>
                        ) : null}
                        {waiting.waiting ? <time>{elapsedLabel(waiting.elapsedMs)}</time> : null}
                      </button>
                    );
                  })}
                  {!entries.length ? <p className="lane-empty">Нет обращений</p> : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="workbench-split">
          <aside className="workbench-list" aria-label="Обращения">
            <div className="workbench-list-head">
              {searching ? (
                <>
                  <input
                    ref={search}
                    aria-label="Поиск обращений"
                    placeholder="Поиск по всем данным"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button
                    type="button"
                    className="icon-control"
                    aria-label="Закрыть поиск"
                    onClick={() => {
                      setSearching(false);
                      setQuery("");
                    }}
                  >
                    <X size={17} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="icon-control"
                    aria-label="Поиск"
                    onClick={() => setSearching(true)}
                  >
                    <Search size={18} />
                  </button>
                  <div role="group" aria-label="Фильтры диалогов">
                    {(["unanswered", "reminders"] as const).map((f) => (
                      <button
                        type="button"
                        key={f}
                        aria-pressed={filter === f}
                        onClick={() => setFilter(filter === f ? null : f)}
                      >
                        {f === "unanswered" ? "Без ответа" : "Напомнить"}
                        <span>{counts[f]}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="workbench-list-items">
              {found.map(({ lead, progress, waiting, messages }) => (
                <button
                  type="button"
                  key={lead.id}
                  aria-label={`Открыть обращение: ${lead.name}`}
                  aria-current={selected?.id === lead.id ? "true" : undefined}
                  className={`workbench-contact ${selected?.id === lead.id ? "selected" : ""} ${lead.unreadCount ? "unread" : ""}`}
                  onClick={() => open(lead.id)}
                >
                  <Avatar lead={lead} />
                  <span className="contact-body">
                    <span className="contact-name-line">
                      <span>{lead.name}</span>
                      <time>
                        {waiting.waiting
                          ? elapsedLabel(waiting.elapsedMs)
                          : lead.timerStopped
                            ? "Таймер выкл."
                            : ""}
                      </time>
                    </span>
                    <span className="contact-city">{lead.city ?? "Город не указан"}</span>
                    <span className="contact-last-message">
                      {messages.at(-1)?.text ?? "Нет сообщений"}
                    </span>
                    <span className="contact-bottom">
                      <span className={`lead-stage stage-${progress.stage}`}>{progress.label}</span>
                      {lead.unreadCount ? (
                        <span className="unread-count">{lead.unreadCount}</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              ))}
              {!found.length ? (
                <div className="lead-empty">
                  {query
                    ? "Ничего не найдено"
                    : filter === "unanswered"
                      ? "Нет диалогов без ответа"
                      : "Нет напоминаний"}
                </div>
              ) : null}
            </div>
          </aside>
          <div className="workbench-chat">
            {selected ? (
              <ContactChat
                key={selected.id}
                state={state}
                lead={selected}
                now={now}
                back={back}
                adapter={adapter}
              />
            ) : (
              <div className="workbench-empty">
                <MessagesSquare size={30} />
                <p>Выберите диалог</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function ContactChat({
  state,
  lead,
  now,
  back,
  adapter,
}: {
  state: CrmState;
  lead: Lead;
  now: number;
  back: () => void;
  adapter: MessageAdapter;
}) {
  const progress = leadProgress(state, lead.id, now),
    ad = ads.find((a) => a.id === lead.adId),
    messages = conversationMessages(state, lead.id);
  const [panel, setPanel] = useState<Panel>("conversation"),
    [menu, setMenu] = useState(false),
    [info, setInfo] = useState(false),
    [closing, setClosing] = useState(false),
    [reason, setReason] = useState("");
  const [quote, setQuote] = useState<ChatMessage | null>(null),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const [inviting, setInviting] = useState(false),
    [slotId, setSlotId] = useState("");
  const { text, change, error: cacheError } = useDraftCache(state.workspaceId, lead.id, lead.draft);
  const [editing, setEditing] = useState(false);
  const reviewOriginal = useRef<string | null>(null);
  const mode = lead.mode ?? "manual",
    ai = mode !== "manual";
  const popup = useRef<HTMLDivElement>(null),
    messageBox = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    requestId = useRef<string | null>(null);
  useEffect(() => {
    function dismiss(e: PointerEvent) {
      if (popup.current && !popup.current.contains(e.target as Node)) {
        setMenu(false);
        setInfo(false);
      }
    }
    function escape(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setMenu(false);
        setInfo(false);
        setClosing(false);
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    if (panel === "conversation" && messageBox.current)
      messageBox.current.scrollTop = messageBox.current.scrollHeight;
  }, [lead.id, panel, messages.length]);
  function patch(value: Parameters<typeof updateLeadDetails>[3]) {
    try {
      changeDemoCrm((s) => updateLeadDetails(s, s.workspaceId, lead.id, value));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }
  function recordEdit() {
    if (ai && editing && reviewOriginal.current !== null && reviewOriginal.current !== text) {
      const original = reviewOriginal.current;
      changeDemoCrm((s) => ({
        ...s,
        feedback: [
          ...(s.feedback ?? []),
          {
            id: crypto.randomUUID(),
            leadId: lead.id,
            original,
            corrected: text,
            action: "edited" as const,
            at: new Date().toISOString(),
          },
        ],
      }));
      reviewOriginal.current = text;
    }
  }
  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    const pendingRequestId = requestId.current;
    const pendingText = text.trim();
    const pendingQuoteId = quote?.id;
    try {
      recordEdit();
      const confirmed = await adapter.send({
        requestId: pendingRequestId,
        leadId: lead.id,
        text: pendingText,
        ...(pendingQuoteId ? { quoteId: pendingQuoteId } : {}),
      });
      changeDemoCrm((s) => acceptDeliveredMessage(s, s.workspaceId, confirmed, pendingRequestId));
      if (ai)
        changeDemoCrm((s) => ({
          ...s,
          feedback: [
            ...(s.feedback ?? []),
            {
              id: crypto.randomUUID(),
              leadId: lead.id,
              original: reviewOriginal.current ?? text,
              corrected: text,
              action: "approved" as const,
              at: new Date().toISOString(),
            },
          ],
        }));
      change("");
      setQuote(null);
      setEditing(false);
      requestId.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Сообщение не отправлено. Черновик сохранён.");
    } finally {
      setSending(false);
    }
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (ai && !editing) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }
  function reject() {
    try {
      const original = text;
      changeDemoCrm((s) => ({
        ...s,
        feedback: [
          ...(s.feedback ?? []),
          {
            id: crypto.randomUUID(),
            leadId: lead.id,
            original,
            corrected: "",
            action: "rejected",
            at: new Date().toISOString(),
          },
        ],
      }));
      change("");
      setEditing(false);
    } catch (e) {
      setError(String(e));
    }
  }
  function close(e?: FormEvent) {
    e?.preventDefault();
    try {
      changeDemoCrm((s) =>
        setLeadClosure(
          s,
          s.workspaceId,
          lead.id,
          lead.closedAt ? null : reason,
          new Date().toISOString(),
        ),
      );
      setClosing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось закрыть обращение");
    }
  }
  const slots = freeWindows(state, windows, now),
    chosen = slots.find((s) => s.id === slotId) ?? slots[0];
  const menus: [Panel, string][] = [
    ["conversation", "Переписка"],
    ["appointment", "Диагностика"],
    ["tasks", "Итоги и задачи"],
    ["payments", "Оплаты"],
    ["history", "История"],
  ];
  return (
    <article className="contact-chat" aria-label={`Карточка: ${lead.name}`}>
      <header className="contact-chat-header" ref={popup}>
        <button
          type="button"
          className="icon-control contact-back"
          aria-label="Все обращения"
          onClick={back}
        >
          <ArrowLeft size={19} />
        </button>
        <Avatar lead={lead} />
        <div className="contact-chat-person">
          <div>
            <h2>{lead.name}</h2>
            <button
              type="button"
              className={`icon-control note-button ${lead.note ? "has-note" : ""}`}
              aria-label="Информация о клиенте"
              title={lead.note ? "Есть заметка" : "Информация о клиенте"}
              onClick={() => {
                setInfo(!info);
                setMenu(false);
              }}
            >
              <StickyNote size={15} />
            </button>
          </div>
          <p>
            {ad ? (
              <Link to="/" search={{ section: "ads", focus: ad.id }}>
                {ad.title}
              </Link>
            ) : (
              "Объявление не указано"
            )}{" "}
            · {lead.city ?? "Город не указан"}
          </p>
        </div>
        <div className="contact-chat-controls">
          <span className={`lead-stage stage-${progress.stage}`} data-testid="lead-stage">
            {progress.label}
          </span>
          <span className="reply-mode" data-testid="reply-mode">
            {MODE_LABELS[mode]}
          </span>
        </div>
        <button
          type="button"
          className="icon-control"
          aria-label="Действия диалога"
          aria-expanded={menu}
          onClick={() => {
            setMenu(!menu);
            setInfo(false);
          }}
        >
          <MoreHorizontal size={21} />
        </button>
        {menu ? (
          <div className="contact-menu" role="menu" aria-label="Действия диалога">
            {menus.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                aria-current={panel === id ? "page" : undefined}
                onClick={() => {
                  setPanel(id);
                  setMenu(false);
                  setError("");
                }}
              >
                {label}
              </button>
            ))}
            <hr />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                patch({ timerStopped: !lead.timerStopped });
                setMenu(false);
              }}
            >
              {lead.timerStopped ? <Play size={14} /> : <Pause size={14} />}{" "}
              {lead.timerStopped ? "Включить таймер" : "Остановить таймер"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setPanel("conversation");
                setInviting(true);
                setMenu(false);
              }}
            >
              Предложить время
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (lead.closedAt) close();
                else setClosing(true);
                setMenu(false);
              }}
            >
              {lead.closedAt ? "Вернуть в работу" : "Закрыть обращение"}
            </button>
            <hr />
            <span className="menu-label">Режим ответа</span>
            {(Object.keys(MODE_LABELS) as ReplyMode[]).map((m) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={mode === m}
                key={m}
                onClick={() => {
                  patch({ mode: m });
                  setEditing(false);
                  setMenu(false);
                }}
              >
                {MODE_LABELS[m]}
                {mode === m ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
        ) : null}
        {info ? (
          <div className="contact-info" role="dialog" aria-label="Информация о клиенте">
            <button
              type="button"
              className="icon-control popup-close"
              aria-label="Закрыть информацию"
              onClick={() => setInfo(false)}
            >
              <X size={16} />
            </button>
            <strong>{lead.name}</strong>
            <p>{lead.city ?? "Город не указан"}</p>
            <p>{ad?.title ?? "Объявление не указано"}</p>
            <label>
              Заметка
              <textarea
                aria-label="Заметка о клиенте"
                value={lead.note ?? ""}
                maxLength={4000}
                onChange={(e) => patch({ note: e.target.value })}
                placeholder="Важное о человеке"
              />
            </label>
          </div>
        ) : null}
      </header>
      {closing ? (
        <form className="close-contact-form" onSubmit={close}>
          <label>
            Причина закрытия
            <input
              aria-label="Причина закрытия"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
          {progress.booked ? <p>Запись будет отменена, время освободится.</p> : null}
          <div>
            <button className="crm-secondary" type="submit">
              Подтвердить закрытие
            </button>
            <button className="crm-quiet" type="button" onClick={() => setClosing(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}
      {panel === "conversation" ? (
        <>
          <div
            className="contact-messages"
            ref={messageBox}
            role="region"
            aria-label={`Сообщения: ${lead.name}`}
            tabIndex={0}
          >
            {messages.map((m, i) => {
              const quoted = messages.find((q) => q.id === m.quoteId);
              return (
                <div key={m.id} className="message-group">
                  {i === 0 || day(m.at) !== day(messages[i - 1].at) ? (
                    <div className="message-day">
                      {new Date(m.at).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        timeZone: "Europe/Moscow",
                      })}
                    </div>
                  ) : null}
                  <div className={`message-bubble ${m.author}`}>
                    <span className="sr-only">{m.author === "manager" ? "Вы" : lead.name}</span>
                    {quoted ? <blockquote>{quoted.text}</blockquote> : null}
                    <MessageBody message={m} />
                    <div className="message-meta">
                      <button
                        type="button"
                        className="message-quote"
                        aria-label={`Цитировать сообщение ${m.id}`}
                        title="Ответить с цитатой"
                        onClick={() => {
                          setQuote(m);
                          input.current?.focus();
                        }}
                      >
                        <Reply size={13} />
                      </button>
                      <time dateTime={m.at}>{hour(m.at)}</time>
                    </div>
                  </div>
                </div>
              );
            })}
            {!messages.length ? <div className="lead-empty">Сообщений пока нет.</div> : null}
          </div>
          {!lead.closedAt ? (
            <div className="contact-composer">
              {quote ? (
                <div className="quote-preview">
                  <Reply size={15} />
                  <span>
                    {quote.author === "manager" ? "Вы" : lead.name}
                    <small>{quote.text}</small>
                  </span>
                  <button
                    type="button"
                    className="icon-control"
                    aria-label="Убрать цитату"
                    onClick={() => setQuote(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : null}
              {inviting ? (
                <div className="inline-invitation">
                  <div>
                    <strong>Свободное время · МСК</strong>
                    <button
                      type="button"
                      className="icon-control"
                      aria-label="Закрыть выбор времени"
                      onClick={() => setInviting(false)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="time-options">
                    {slots.map((s) => (
                      <button
                        type="button"
                        key={s.id}
                        aria-pressed={chosen?.id === s.id}
                        onClick={() => setSlotId(s.id)}
                      >
                        {stamp(s.startsAt)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="crm-secondary"
                    disabled={!chosen}
                    onClick={() => {
                      try {
                        change(invitationFor(state, lead.id, chosen, windows, Date.now()));
                        setInviting(false);
                        input.current?.focus();
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    Вставить приглашение
                  </button>
                  {!slots.length ? <p>Свободных окон нет.</p> : null}
                </div>
              ) : null}
              <div className="message-input-row">
                <button
                  type="button"
                  className="icon-control attachment-control"
                  aria-label="Прикрепить файл"
                  title="Отправка вложений станет доступна после подключения Авито"
                  disabled
                >
                  <Paperclip size={19} />
                </button>
                <textarea
                  ref={input}
                  aria-label={`Ответ ${lead.name}`}
                  placeholder={ai && !editing ? "Ожидается черновик ИИ" : "Написать сообщение…"}
                  value={text}
                  maxLength={5000}
                  rows={1}
                  readOnly={ai && !editing}
                  disabled={sending}
                  onChange={(e) => {
                    requestId.current = null;
                    change(e.target.value);
                  }}
                  onBlur={() => {
                    try {
                      recordEdit();
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                  onKeyDown={onKey}
                />
                {ai && !editing ? (
                  <div className="ai-response-actions">
                    <button
                      type="button"
                      className="send-control"
                      aria-label="Одобрить и отправить"
                      title="Одобрить и отправить"
                      disabled={!text.trim() || sending}
                      onClick={() => void send()}
                    >
                      <Check size={19} />
                    </button>
                    <button
                      type="button"
                      className="icon-control"
                      aria-label="Отклонить ответ"
                      onClick={reject}
                      disabled={!text.trim()}
                    >
                      <X size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-control"
                      aria-label="Редактировать ответ"
                      onClick={() => {
                        reviewOriginal.current = text;
                        setEditing(true);
                        input.current?.focus();
                      }}
                    >
                      <Pencil size={17} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="send-control"
                    aria-label="Отправить сообщение"
                    title="Отправить · Enter"
                    disabled={!text.trim() || sending}
                    onClick={() => void send()}
                  >
                    <Send size={19} />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="closed-contact-state">Обращение закрыто. Таймер остановлен.</div>
          )}
        </>
      ) : (
        <div className="contact-panel">
          <button
            type="button"
            className="back-to-messages"
            onClick={() => setPanel("conversation")}
          >
            <ArrowLeft size={15} />К переписке
          </button>
          {panel === "appointment" ? <DiagnosticSection leadScope={lead.id} /> : null}
          {panel === "payments" ? <PaymentsSection studentScope={lead.studentId} /> : null}
          {panel === "tasks" ? <LeadFollowups state={state} leadId={lead.id} /> : null}
          {panel === "history" ? (
            <ol className="lead-timeline">
              {leadTimeline(state, lead.id).map((item) => (
                <li key={item.id}>
                  <span className="timeline-dot" />
                  <div>
                    <p>{item.text}</p>
                    <time>{stamp(item.at)}</time>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      )}
      {error || cacheError ? (
        <p role="alert" className="message-error">
          {error || cacheError}
        </p>
      ) : null}
    </article>
  );
}
function MessageBody({ message: m }: { message: ChatMessage }) {
  const mediaUrl = m.url?.startsWith("https://") ? m.url : null;
  if (m.kind === "image" && mediaUrl)
    return (
      <>
        <a href={mediaUrl} target="_blank" rel="noreferrer">
          <img className="message-image" src={mediaUrl} alt={m.fileName ?? "Фото"} />
        </a>
        {m.text ? <p>{m.text}</p> : null}
      </>
    );
  if (m.kind === "voice" && mediaUrl) return <VoiceMessage url={mediaUrl} />;
  if (m.kind === "video" && mediaUrl) return <VideoMessage url={mediaUrl} />;
  if (m.kind === "file" && mediaUrl)
    return (
      <a href={mediaUrl} target="_blank" rel="noreferrer">
        {m.fileName ?? "Открыть файл"}
      </a>
    );
  return <p>{m.kind === "call" ? "Звонок через Авито" : m.text || "Вложение недоступно"}</p>;
}
function VoiceMessage({ url }: { url: string }) {
  const audio = useRef<HTMLAudioElement>(null),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState(false);
  return (
    <div className="voice-message">
      <audio
        ref={audio}
        src={url}
        preload="none"
        onEnded={() => setPlaying(false)}
        onError={() => setError(true)}
      />
      <button
        type="button"
        className="icon-control"
        aria-label={playing ? "Пауза голосового" : "Слушать голосовое"}
        onClick={async () => {
          try {
            if (playing) audio.current?.pause();
            else await audio.current?.play();
            setPlaying(!playing);
          } catch {
            setError(true);
          }
        }}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <span>{error ? "Не удалось загрузить голосовое" : "Голосовое сообщение"}</span>
    </div>
  );
}

function VideoMessage({ url }: { url: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="custom-video">
      <video
        ref={video}
        className="message-video"
        preload="none"
        src={url}
        onEnded={() => setPlaying(false)}
        onError={() => setError(true)}
      />
      <button
        type="button"
        className="icon-control"
        aria-label={playing ? "Пауза видео" : "Смотреть видео"}
        onClick={async () => {
          try {
            if (playing) video.current?.pause();
            else await video.current?.play();
            setPlaying(!playing);
          } catch {
            setError(true);
          }
        }}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      {error ? <span>Не удалось загрузить видео</span> : null}
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Search,
  X,
  MoreHorizontal,
  Phone,
  Mic,
  Square,
  Trash2,
  ChevronRight,
  CalendarDays,
  ListTodo,
  Wallet,
  History,
  MessageCircle,
  Send,
  Paperclip,
  Reply,
  Check,
  CheckCheck,
  Pencil,
  MessagesSquare,
  Pause,
  Play,
} from "lucide-react";
import { Avatar } from "./contact-avatar.tsx";
import { AiManager } from "./ai-manager";
import { generateAi } from "./ai-manager-client";
import { ads, windows } from "./data.ts";
import { changeDemoCrm, useDemoCrm } from "./demo-crm-store.ts";
import { DiagnosticSection, PaymentsSection } from "./crm-ui.tsx";
import { CrmBoard } from "./crm-board.tsx";
import { StageControl, NoteEditor, AnchoredPanel } from "./workbench-controls.tsx";
import { createExampleAdapter, cacheExampleMedia, useMessageMedia } from "./sample-media.ts";
import { LeadFollowups } from "./lead-panels.tsx";
import {
  leadProgress,
  leadTimeline,
  freeWindows,
  invitationFor,
  setLeadClosure,
  type LeadStage,
} from "./lead-workflow.ts";
import {
  conversationMessages,
  waitingForReply,
  acknowledgeReply,
  elapsedLabel,
  reminderDue,
  searchableLead,
  updateLeadDetails,
  disconnectedAdapter,
  acceptDeliveredMessage,
  MODE_LABELS,
  moveLeadStage,
  applyEditedMessage,
  type ReplyMode,
  type ChatMessage,
  type MessageAdapter,
} from "./communication.ts";
import { useDraftCache } from "./use-draft-cache.ts";
import { readLiveMessages, getPreviewData } from "./preview-data.ts";
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
const liveReadOnlyAdapter: MessageAdapter = {
  async send() {
    throw new Error(
      "Отправка отключена для этого подключения. Текст не отправлен и остаётся в редакторе.",
    );
  },
};
export function LeadWorkspace({
  focus,
  adapter,
  view,
}: {
  focus?: string;
  adapter?: MessageAdapter;
  view?: "crm" | "ai";
}) {
  const { state, storageError } = useDemoCrm();
  const activeAdapter =
    adapter ??
    (getPreviewData()
      ? liveReadOnlyAdapter
      : import.meta.env.VITE_SERVICE_PREVIEW === "true" &&
          (state.workspaceId === "cantor-demo-anna" ||
            (state.workspaceId === "cantor-elena-dobrynina" && Boolean(getPreviewData())))
        ? createExampleAdapter(state.workspaceId)
        : disconnectedAdapter);
  const [, refreshReplyState] = useState(0);
  const [startPanel, setStartPanel] = useState<Panel>("conversation");
  const [moveError, setMoveError] = useState("");
  function move(id: string, stage: LeadStage) {
    try {
      changeDemoCrm((s) => moveLeadStage(s, s.workspaceId, id, stage, new Date().toISOString()));
      setMoveError("");
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : "Не удалось переместить обращение");
    }
  }
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(focus ?? null);
  const historyLeadReady = state.leads.some((lead) => lead.id === selectedId);
  const [historyState, setHistoryState] = useState<{
    id: string;
    at?: string;
    next: number | null;
    busy: boolean;
    error: string;
    stale?: boolean;
  }>({ id: "", next: null, busy: false, error: "" });
  async function loadHistory(id: string, offset = 0, signal?: AbortSignal) {
    setHistoryState((h) =>
      h.id === id ? { ...h, busy: true, error: "" } : { id, busy: true, error: "", next: null },
    );
    try {
      const page = await readLiveMessages(id, offset, signal);
      if (signal?.aborted) return;
      changeDemoCrm((current) => {
        const rows = new Map((current.messages || []).map((m) => [m.id, m]));
        for (const m of page.messages) {
          rows.set(`${id}:${m.id}`, {
            id: `${id}:${m.id}`,
            leadId: id,
            author:
              m.author === "manager" ? "manager" : m.author === "system" ? "system" : "client",
            text: m.text,
            at: new Date(m.at).toISOString(),
            kind: ["text", "image", "voice", "file", "call", "video"].includes(m.type)
              ? (m.type as "text" | "image" | "voice" | "file" | "call" | "video")
              : "text",
            delivery: "provider",
          });
        }
        return { ...current, messages: [...rows.values()] };
      });
      setHistoryState((previous) => ({
        id,
        at: page.observedAt,
        next:
          offset === 0 && previous.id === id && previous.at
            ? previous.next
            : page.coverage.nextOffset,
        busy: false,
        error: "",
        stale: page.stale,
      }));
    } catch (e) {
      if (!signal?.aborted)
        setHistoryState((h) => ({
          ...h,
          id,
          busy: false,
          error: e instanceof Error ? e.message : "Ошибка чтения",
        }));
    }
  }
  useEffect(() => {
    if (!selectedId || !historyLeadReady || !getPreviewData()) return;
    const controller = new AbortController();
    void loadHistory(selectedId, 0, controller.signal);
    const timer = setInterval(() => {
      if (!document.hidden) void loadHistory(selectedId, 0, controller.signal);
    }, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selectedId, historyLeadReady]);

  const [filter, setFilter] = useState<"unanswered" | "reminders" | null>(null),
    [searching, setSearching] = useState(false),
    [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSelectedId(focus ?? null);
  }, [focus]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("cantor-chat-open", Boolean(selectedId) && !view);
    return () => document.documentElement.classList.remove("cantor-chat-open");
  }, [selectedId, view]);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);
  function open(id: string, panel: Panel = "conversation") {
    setStartPanel(panel);
    setSelectedId(id);
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
      {selectedId &&
        getPreviewData() &&
        (historyState.busy || historyState.error || historyState.next !== null) && (
          <div className="live-chat-status" role="status">
            {historyState.busy ? "Обновляем переписку…" : historyState.error || null}
            {historyState.next !== null && !historyState.busy && (
              <button
                className="st-button"
                onClick={() => void loadHistory(selectedId, historyState.next!)}
              >
                Загрузить более ранние сообщения
              </button>
            )}
          </div>
        )}
      {moveError ? (
        <p role="alert" className="crm-error">
          {moveError}
        </p>
      ) : null}
      {storageError ? (
        <p role="alert" className="crm-error">
          {storageError}
        </p>
      ) : null}
      {view === "ai" ? (
        <AiManager />
      ) : view === "crm" ? (
        <CrmBoard state={state} now={now} onOpen={open} onMove={move} />
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
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setQuery("");
                        setSearching(false);
                      }
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
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
              {found.map(({ lead, waiting, reminder, messages }) => (
                <button
                  type="button"
                  key={lead.id}
                  data-comment-anchor={`lead-${lead.id}`}
                  aria-label={`Открыть обращение: ${lead.name}`}
                  aria-current={selected?.id === lead.id ? "true" : undefined}
                  className={`workbench-contact ${selected?.id === lead.id ? "selected" : ""} ${lead.unreadCount ? "unread" : ""} ${waiting.waiting ? "needs-reply" : reminder ? "needs-reminder" : ""}`}
                  onClick={() => open(lead.id)}
                >
                  <Avatar lead={lead} />
                  <span className="contact-body">
                    <span className="contact-name-line">
                      <span>{lead.name}</span>
                      {lead.city ? <span className="contact-city">{lead.city}</span> : null}
                      <time className="sr-only">
                        {waiting.waiting
                          ? elapsedLabel(waiting.elapsedMs)
                          : lead.timerStopped
                            ? "Таймер выкл."
                            : ""}
                      </time>
                    </span>
                    <span className="contact-last-message">
                      {(() => {
                        const match =
                          query.trim() &&
                          [...messages]
                            .reverse()
                            .find((m) =>
                              m.text
                                .toLocaleLowerCase("ru-RU")
                                .includes(query.trim().toLocaleLowerCase("ru-RU")),
                            );
                        const m = match || messages.at(-1);
                        if (m?.kind === "call") return "Звонок через Авито";
                        const text =
                          m?.text?.replace(/^\[Системное сообщение\]\s*/i, "") || "Нет сообщений";
                        if (!match) return text;
                        const index = text
                          .toLocaleLowerCase("ru-RU")
                          .indexOf(query.trim().toLocaleLowerCase("ru-RU"));
                        const start = Math.max(0, index - 24);
                        return `${start ? "…" : ""}${text.slice(start, start + Math.max(90, query.trim().length + 30))}`;
                      })()}
                    </span>
                    {lead.unreadCount ? (
                      <span className="unread-count">{lead.unreadCount}</span>
                    ) : null}
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
                adapter={activeAdapter}
                startPanel={startPanel}
                onAcknowledge={() => {
                  if (acknowledgeReply(state, selected.id)) refreshReplyState((value) => value + 1);
                }}
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
  startPanel,
  onAcknowledge,
}: {
  onAcknowledge: () => void;
  startPanel?: Panel;
  state: CrmState;
  lead: Lead;
  now: number;
  back: () => void;
  adapter: MessageAdapter;
}) {
  const progress = leadProgress(state, lead.id, now),
    ad = ads.find((a) => a.id === lead.adId),
    messages = conversationMessages(state, lead.id);
  const [panel, setPanel] = useState<Panel>(startPanel ?? "conversation"),
    [menu, setMenu] = useState(false),
    [closing, setClosing] = useState(false),
    [reason, setReason] = useState("");
  const [quote, setQuote] = useState<ChatMessage | null>(null),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const [inviting, setInviting] = useState(false),
    [slotId, setSlotId] = useState("");
  const {
    text,
    change,
    error: cacheError,
  } = useDraftCache(
    state.workspaceId,
    lead.id,
    lead.draft ?? (lead.aiProposal?.status === "ready" ? lead.aiProposal.text : ""),
  );
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [attachment, setAttachment] = useState<{
    id: string;
    kind: "image" | "voice" | "file" | "video";
    name: string;
    mimeType: string;
  } | null>(null);
  const [preparing, setPreparing] = useState(false),
    [recording, setRecording] = useState(false),
    [recordSeconds, setRecordSeconds] = useState(0),
    [callOpen, setCallOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    callButton = useRef<HTMLButtonElement>(null),
    recorder = useRef<MediaRecorder | null>(null),
    mediaStream = useRef<MediaStream | null>(null),
    discardRecording = useRef(false);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecordSeconds((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(
    () => () => {
      discardRecording.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      mediaStream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  async function attachFile(file: File, kind?: "voice") {
    setPreparing(true);
    setError("");
    try {
      const id = await cacheExampleMedia(state.workspaceId, file, file.name);
      setAttachment({
        id,
        kind:
          kind ??
          (file.type.startsWith("image/")
            ? "image"
            : file.type.startsWith("video/")
              ? "video"
              : "file"),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
      });
      requestId.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить файл");
    } finally {
      setPreparing(false);
    }
  }
  async function startRecording() {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error("Запись голоса не поддерживается этим браузером");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream.current = stream;
      discardRecording.current = false;
      const r = new MediaRecorder(stream),
        chunks: BlobPart[] = [];
      recorder.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (discardRecording.current) return;
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        void attachFile(
          new File([blob], `Голосовое-${Date.now()}.webm`, { type: blob.type }),
          "voice",
        );
      };
      r.start();
      setRecordSeconds(0);
      setRecording(true);
    } catch (e) {
      mediaStream.current?.getTracks().forEach((t) => t.stop());
      setError(e instanceof Error ? e.message : "Не удалось включить микрофон");
    }
  }

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
      }
    }
    function escape(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setMenu(false);
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      return false;
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
    if ((!text.trim() && !attachment) || sending || preparing) return;
    setSending(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    const pendingRequestId = requestId.current;
    const pendingText = text.trim();
    const pendingQuoteId = quote?.id;
    const pendingAttachment = attachment;
    try {
      if (editingMessage) {
        if (!adapter.edit) throw new Error("Редактирование недоступно для этого канала");
        const updated = await adapter.edit(editingMessage, pendingText);
        changeDemoCrm((s) => applyEditedMessage(s, s.workspaceId, updated));
        change("");
        setEditingMessage(null);
        setEditing(false);
        requestId.current = null;
        return;
      }
      recordEdit();
      const confirmed = await adapter.send({
        requestId: pendingRequestId,
        leadId: lead.id,
        text: pendingText,
        ...(pendingQuoteId ? { quoteId: pendingQuoteId } : {}),
        ...(pendingAttachment ? { attachment: pendingAttachment } : {}),
      });
      changeDemoCrm((s) => acceptDeliveredMessage(s, s.workspaceId, confirmed, pendingRequestId));
      if (ai)
        changeDemoCrm((s) => ({
          ...s,
          leads: s.leads.map((l) =>
            l.id === lead.id && l.aiProposal
              ? { ...l, aiProposal: { ...l.aiProposal, status: "approved" as const } }
              : l,
          ),
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
      setAttachment(null);
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
      changeDemoCrm((s) => ({
        ...s,
        leads: s.leads.map((l) =>
          l.id === lead.id && l.aiProposal
            ? { ...l, aiProposal: { ...l.aiProposal, status: "rejected" as const } }
            : l,
        ),
      }));
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
    ["tasks", "Задачи"],
    ["appointment", "Диагностика"],
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
            <NoteEditor lead={lead} onSave={(note) => patch({ note })} />
          </div>
          <p>
            {ad ? (
              <Link to="/" search={{ section: "ads", focus: ad.id }}>
                {ad.title}
              </Link>
            ) : (
              getPreviewData()?.chats.find((c) => c.id === lead.id)?.itemTitle ||
              "Объявление не указано"
            )}{" "}
            · {lead.city ?? "Город не указан"}
          </p>
        </div>
        <button
          type="button"
          className="reply-ack"
          aria-label="Подготовить ответ ИИ"
          title="Подготовить ответ ИИ"
          disabled={generating}
          onClick={async () => {
            setGenerating(true);
            setError("");
            try {
              const forMessage = messages.at(-1)?.id;
              const draft = await generateAi(
                messages
                  .filter((m) => m.author !== "system")
                  .map((m) => ({
                    role: m.author === "manager" ? "assistant" : "user",
                    content: m.text || "[Вложение]",
                  })),
                (state.feedback ?? [])
                  .slice(-8)
                  .map((f) => `${f.original} → ${f.corrected}`)
                  .join("\n"),
              );
              if (
                forMessage !==
                conversationMessages((await import("./demo-crm-store")).readDemoCrm(), lead.id).at(
                  -1,
                )?.id
              )
                throw Error("Появилось новое сообщение. Подготовьте ответ заново.");
              patch({ mode: "ai_approval" });
              change(draft);
              setEditing(false);
              setPanel("conversation");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Не удалось подготовить ответ");
            } finally {
              setGenerating(false);
            }
          }}
        >
          {generating ? "…" : "ИИ"}
        </button>
        {waitingForReply(state, lead, now).waiting ? (
          <button
            type="button"
            className="reply-ack"
            title="Снять отметку «Без ответа» на время просмотра"
            onClick={onAcknowledge}
            aria-label="Ответ не требуется"
          >
            <CheckCheck size={16} />
          </button>
        ) : null}
        <div className="contact-chat-controls">
          <StageControl
            stage={progress.stage}
            onChange={(stage) => {
              try {
                changeDemoCrm((s) =>
                  moveLeadStage(s, s.workspaceId, lead.id, stage, new Date().toISOString()),
                );
              } catch (e) {
                setError(String(e));
              }
            }}
          />
          <span className={mode === "manual" ? "sr-only" : "reply-mode"} data-testid="reply-mode">
            {MODE_LABELS[mode]}
          </span>
        </div>
        <button
          ref={callButton}
          type="button"
          className="icon-control call-control"
          aria-label="Позвонить"
          title="Звонок"
          onClick={() => setCallOpen(!callOpen)}
        >
          <Phone size={17} />
        </button>
        {callOpen ? (
          <AnchoredPanel
            anchor={callButton}
            onClose={() => setCallOpen(false)}
            label="Звонок"
            width={270}
          >
            <div className="call-unavailable">
              <Phone size={22} />
              <strong>Звонок пока недоступен</strong>
              <p>Вызовы через API Авито ещё не подключены. Эта кнопка не совершает звонок.</p>
            </div>
          </AnchoredPanel>
        ) : null}
        <button
          type="button"
          className="icon-control"
          aria-label="Действия диалога"
          aria-expanded={menu}
          onClick={() => {
            setMenu(!menu);
          }}
        >
          <MoreHorizontal size={21} />
        </button>
        {menu ? (
          <div className="contact-menu" role="menu" aria-label="Действия диалога">
            <span className="menu-label">Разделы карточки</span>
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
                {id === "conversation" ? (
                  <MessageCircle size={15} />
                ) : id === "appointment" ? (
                  <CalendarDays size={15} />
                ) : id === "tasks" ? (
                  <ListTodo size={15} />
                ) : id === "payments" ? (
                  <Wallet size={15} />
                ) : (
                  <History size={15} />
                )}
                {label}
                <ChevronRight size={13} className="menu-navigation-arrow" />
              </button>
            ))}
            <hr />
            <span className="menu-label">Действия</span>
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
                  <div className={`message-bubble ${m.kind === "call" ? "system" : m.author}`}>
                    <span className="sr-only">{m.author === "manager" ? "Вы" : lead.name}</span>
                    {quoted ? <blockquote>{quoted.text}</blockquote> : null}
                    <MessageBody message={m} workspaceId={state.workspaceId} />
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
                      {m.author === "manager" && adapter.edit ? (
                        <button
                          type="button"
                          className="message-quote"
                          aria-label={`Редактировать сообщение ${m.id}`}
                          title="Редактировать"
                          onClick={() => {
                            setEditingMessage(m);
                            setEditing(true);
                            change(m.text);
                            setPanel("conversation");
                            input.current?.focus();
                          }}
                        >
                          <Pencil size={12} />
                        </button>
                      ) : null}
                      {m.editedAt ? <span title={stamp(m.editedAt)}>изменено</span> : null}
                      {m.delivery === "local" && !getPreviewData() ? (
                        <span title="Сохранено только в локальном примере, не отправлено в Авито">
                          локально
                        </span>
                      ) : null}
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
              {editingMessage ? (
                <div className="quote-preview editing-preview">
                  <Pencil size={15} />
                  <span>Редактирование сообщения</span>
                  <button
                    type="button"
                    className="icon-control"
                    aria-label="Отменить редактирование"
                    onClick={() => {
                      setEditingMessage(null);
                      setEditing(false);
                      change("");
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : null}
              {attachment ? (
                <div className="attachment-preview">
                  <Paperclip size={16} />
                  <span>
                    {attachment.kind === "voice" ? "Голосовое сообщение" : attachment.name}
                  </span>
                  <button
                    type="button"
                    className="icon-control"
                    aria-label="Убрать вложение"
                    onClick={() => setAttachment(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : null}
              {preparing ? (
                <div className="attachment-progress" role="status">
                  Подготовка вложения…
                </div>
              ) : null}
              <input
                ref={fileInput}
                className="sr-only"
                type="file"
                aria-label="Файл для сообщения"
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void attachFile(f);
                  e.target.value = "";
                }}
              />
              {recording ? (
                <div className="voice-recording">
                  <span className="record-dot" />
                  <time>
                    {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")}
                  </time>
                  <span>Запись голоса</span>
                  <button
                    type="button"
                    className="icon-control"
                    aria-label="Отменить запись голоса"
                    onClick={() => {
                      discardRecording.current = true;
                      recorder.current?.stop();
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                  <button
                    type="button"
                    className="send-control"
                    aria-label="Завершить запись голоса"
                    onClick={() => recorder.current?.stop()}
                  >
                    <Square size={16} />
                  </button>
                </div>
              ) : (
                <div className="message-input-row">
                  <button
                    type="button"
                    className="icon-control attachment-control"
                    aria-label="Прикрепить файл"
                    title={
                      adapter.kind === "sample"
                        ? "Прикрепить файл"
                        : "Вложения не подключены для этого канала"
                    }
                    disabled={
                      adapter.kind !== "sample" || sending || preparing || Boolean(editingMessage)
                    }
                    onClick={() => fileInput.current?.click()}
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
                  {!ai && !editingMessage ? (
                    <button
                      type="button"
                      className="icon-control voice-control"
                      aria-label="Записать голосовое"
                      title={
                        adapter.kind === "sample" ? "Записать голосовое" : "Голосовые не подключены"
                      }
                      disabled={adapter.kind !== "sample" || sending || preparing}
                      onClick={() => void startRecording()}
                    >
                      <Mic size={18} />
                    </button>
                  ) : null}
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
                      aria-label={
                        editingMessage ? "Сохранить изменения сообщения" : "Отправить сообщение"
                      }
                      title={editingMessage ? "Сохранить изменения" : "Отправить · Enter"}
                      disabled={(!text.trim() && !attachment) || sending || preparing}
                      onClick={() => void send()}
                    >
                      {editingMessage ? <Check size={19} /> : <Send size={19} />}
                    </button>
                  )}
                </div>
              )}
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
          {panel === "appointment" ? (
            <>
              <DiagnosticSection leadScope={lead.id} />
              <LeadFollowups state={state} leadId={lead.id} section="outcome" />
            </>
          ) : null}
          {panel === "payments" ? <PaymentsSection studentScope={lead.studentId} /> : null}
          {panel === "tasks" ? (
            <LeadFollowups state={state} leadId={lead.id} section="tasks" />
          ) : null}
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
function MessageBody({ message: m, workspaceId }: { message: ChatMessage; workspaceId: string }) {
  const { url: mediaUrl, error } = useMessageMedia(workspaceId, m);
  if (error) return <p>Вложение не найдено на устройстве</p>;
  if (m.attachmentId && !mediaUrl) return <p>Загрузка вложения…</p>;
  if (m.kind === "image" && mediaUrl)
    return (
      <>
        <a href={mediaUrl} target="_blank" rel="noreferrer">
          <img className="message-image" src={mediaUrl} alt={m.fileName ?? "Фото"} />
        </a>
        {m.text ? <p>{m.text}</p> : null}
      </>
    );
  if (m.kind === "voice" && mediaUrl)
    return (
      <>
        <VoiceMessage url={mediaUrl} />
        {m.text ? <p>{m.text}</p> : null}
      </>
    );
  if (m.kind === "video" && mediaUrl)
    return (
      <>
        <VideoMessage url={mediaUrl} />
        {m.text ? <p>{m.text}</p> : null}
      </>
    );
  if (m.kind === "file" && mediaUrl)
    return (
      <>
        <a href={mediaUrl} target="_blank" rel="noreferrer">
          {m.fileName ?? "Открыть файл"}
        </a>
        {m.text ? <p>{m.text}</p> : null}
      </>
    );
  return (
    <p>
      {m.kind === "call"
        ? "Звонок через Авито"
        : m.text?.replace(/^\[Системное сообщение\]\s*/i, "") || "Вложение недоступно"}
    </p>
  );
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

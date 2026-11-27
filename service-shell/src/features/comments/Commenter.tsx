import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { List, MapPinPlus, MessageCircle, Mic, Send, Square, Trash2, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { SECTIONS, type SectionId } from "../service/sections";
import {
  COMMENTS,
  STATUSES,
  anchorElement,
  captureViewport,
  fetchComments,
  findTarget,
  jsonBody,
  pointFor,
  request,
  targetFor,
  CommentError,
  type Comment,
  type Diagnostic,
  type Target,
} from "./client";
import "./comments.css";

type Location = { section: SectionId; focus?: string; view?: "crm" | "ai" };
type Mode = { available: boolean; enabled: boolean };
type Draft = {
  id: string;
  section: SectionId;
  target: Target;
  screenshot: Promise<Blob | null>;
  diagnostics: Diagnostic[];
};
const Context = createContext<{ mode: Mode; setMode: (mode: Mode) => void } | null>(null);
const disabled = { available: false, enabled: false };

function failure(error: unknown) {
  if (!(error instanceof CommentError))
    return "Не удалось связаться с сервером. Попробуйте ещё раз.";
  if (error.message === "invalid_password") return "Неверный пароль режима комментатора.";
  if (error.status === 429) return "Слишком много попыток. Попробуйте через 15 минут.";
  if (error.status === 401 || error.message === "mode_disabled")
    return "Доступ истёк. Войдите в кабинет и включите режим заново.";
  if (error.status === 413) return "Вложение слишком большое.";
  return "Не удалось завершить действие. Попробуйте ещё раз.";
}

export function CommenterProvider({
  children,
  location,
}: {
  children: ReactNode;
  location: Location;
}) {
  const [mode, setMode] = useState<Mode>(disabled);
  useEffect(() => {
    const controller = new AbortController();
    void request<Mode>(`${COMMENTS}/mode`, { signal: controller.signal })
      .then(setMode)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <Context.Provider value={{ mode, setMode }}>
      {children}
      {mode.enabled && <Commenter location={location} />}
    </Context.Provider>
  );
}

export function CommenterSettings() {
  const context = useContext(Context);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!context?.mode.available) return null;
  const { mode, setMode } = context;
  async function change() {
    setBusy(true);
    setError("");
    try {
      const data = await request<{ enabled: boolean }>(`${COMMENTS}/mode`, {
        method: mode.enabled ? "DELETE" : "POST",
        ...(!mode.enabled && jsonBody({ password })),
      });
      setPassword("");
      setMode({ available: true, enabled: data.enabled });
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="st-card commenter-settings" data-comment-ui="">
      <div className="st-heading-row">
        <h3>Режим комментатора</h3>
        {mode.enabled && (
          <span className="st-connected">
            <span />
            Включён
          </span>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void change();
        }}
      >
        {!mode.enabled && (
          <label>
            Пароль режима
            <input
              type="password"
              autoComplete="off"
              required
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        <button className={mode.enabled ? "st-button" : "st-primary"} disabled={busy}>
          {mode.enabled ? "Выключить" : "Включить"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function sameLocation(comment: Comment, location: Location) {
  return (
    comment.section === location.section &&
    (comment.target.focus ?? "") === (location.focus ?? "") &&
    (comment.target.view ?? "") === (location.view ?? "")
  );
}
function Commenter({ location }: { location: Location }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const [screenshot, setScreenshot] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<Comment | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingJump, setPendingJump] = useState<Comment | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number } | null>>({});
  const diagnostics = useRef<Diagnostic[]>([]);
  const start = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchComments(COMMENTS, new URLSearchParams(), controller.signal)
      .then(({ comments, next }) => {
        setComments(comments);
        setNext(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(failure(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function more() {
    if (!next || loading) return;
    setLoading(true);
    setError("");
    try {
      const page = await fetchComments(COMMENTS, new URLSearchParams({ before: next }));
      setComments((items) => {
        const seen = new Set(items.map((item) => item.id));
        return [...items, ...page.comments.filter((item) => !seen.has(item.id))];
      });
      setNext(page.next);
    } catch (error) {
      setError(failure(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    diagnostics.current = [];
    const record = (kind: Diagnostic["kind"]) => {
      diagnostics.current = [...diagnostics.current.slice(-7), { kind, at: Date.now() }];
    };
    const onError = (event: Event) =>
      record(event instanceof ErrorEvent ? "runtime_error" : "resource_error");
    const onRejection = () => record("request_failed");
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [location.section, location.focus, location.view]);

  useEffect(() => {
    if (!selecting) return;
    function pick(element: Element, x: number, y: number) {
      const target = { ...targetFor(element, x, y), focus: location.focus, view: location.view };
      const at = Date.now();
      setDraft({
        id: crypto.randomUUID(),
        section: location.section,
        target,
        screenshot: screenshot ? captureViewport(location.section) : Promise.resolve(null),
        diagnostics: diagnostics.current.filter((item) => item.at >= at - 120_000),
      });
      setSelecting(false);
      setHover(null);
    }
    function hovered(event: Event) {
      const element =
        event.target instanceof Element && !event.target.closest("[data-comment-ui]")
          ? anchorElement(event.target)
          : null;
      setHover(element?.getBoundingClientRect() ?? null);
    }
    function click(event: MouseEvent) {
      if (!(event.target instanceof Element) || event.target.closest("[data-comment-ui]")) return;
      const element = anchorElement(event.target);
      if (!element) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pick(element, event.clientX, event.clientY);
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelecting(false);
        setHover(null);
        start.current?.focus();
        return;
      }
      if (
        !(event.target instanceof Element) ||
        event.target.closest("[data-comment-ui]") ||
        (event.key !== "Enter" && event.key !== " ")
      )
        return;
      const element = anchorElement(event.target);
      if (!element) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = element.getBoundingClientRect();
      pick(element, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    window.addEventListener("pointermove", hovered, true);
    window.addEventListener("focusin", hovered, true);
    window.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", hovered, true);
      window.removeEventListener("focusin", hovered, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [selecting, screenshot, location.section, location.focus, location.view]);

  useLayoutEffect(() => {
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchors = comments.filter((comment) => sameLocation(comment, location));
        const saved = anchors.map((comment) => [comment.id, pointFor(comment.target)] as const);
        setPositions(
          Object.fromEntries(draft ? [...saved, [draft.id, pointFor(draft.target)]] : saved),
        );
      });
    };
    refresh();
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    const observer = new MutationObserver(refresh);
    const root = document.querySelector(".service-layout");
    if (root) observer.observe(root, { childList: true, subtree: true, attributes: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      observer.disconnect();
    };
  }, [comments, draft, location]);

  useEffect(() => {
    if (!pendingJump || !sameLocation(pendingJump, location)) return;
    const root = document.querySelector(".service-layout");
    let timer = 0;
    const resolve = () => {
      const target = findTarget(pendingJump.target);
      if (!target) return;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      setSelected(pendingJump);
      setPendingJump(null);
    };
    const watch = new MutationObserver(resolve);
    if (root) watch.observe(root, { childList: true, subtree: true });
    resolve();
    timer = window.setTimeout(() => {
      setSelected(pendingJump);
      setPendingJump(null);
    }, 1800);
    return () => {
      clearTimeout(timer);
      watch.disconnect();
    };
  }, [pendingJump, location]);

  function jump(comment: Comment) {
    setOpen(false);
    setSelected(null);
    setPendingJump(comment);
    if (!sameLocation(comment, location)) {
      void navigate({
        to: "/",
        search: {
          section: comment.section,
          focus: comment.target.focus,
          view: comment.target.view,
        },
      });
    }
  }

  async function save(draft: Draft, text: string, audio: Blob | null) {
    const form = new FormData();
    form.set(
      "comment",
      JSON.stringify({
        id: draft.id,
        section: draft.section,
        target: draft.target,
        diagnostics: draft.diagnostics,
        text,
      }),
    );
    if (audio) form.set("audio", audio, "comment");
    let timeout = 0;
    const image = await Promise.race([
      draft.screenshot,
      new Promise<null>((resolve) => {
        timeout = window.setTimeout(() => resolve(null), 1600);
      }),
    ]).finally(() => clearTimeout(timeout));
    if (image) form.set("screenshot", image, "viewport.jpg");
    const { comment } = await request<{ comment: Comment }>(COMMENTS, {
      method: "POST",
      body: form,
    });
    setComments((items) => [comment, ...items.filter((item) => item.id !== comment.id)]);
    setDraft(null);
    start.current?.focus();
  }

  function placement(id: string) {
    const point = positions[id];
    if (!point) return undefined;
    return {
      left: Math.max(12, Math.min(point.x + 14, window.innerWidth - 346)),
      top: Math.max(12, Math.min(point.y + 14, window.innerHeight - 288)),
    };
  }
  const showDraft =
    draft?.section === location.section &&
    draft.target.focus === location.focus &&
    draft.target.view === location.view;
  const showSelected = selected && sameLocation(selected, location);

  return createPortal(
    <div data-comment-ui="" className="commenter-layer">
      {hover && selecting && (
        <div
          className="commenter-highlight"
          style={{ top: hover.top, left: hover.left, width: hover.width, height: hover.height }}
        />
      )}
      {comments
        .filter((comment) => sameLocation(comment, location))
        .map((comment, index) => {
          const point = positions[comment.id];
          if (
            !point ||
            point.x < 0 ||
            point.y < 0 ||
            point.x > window.innerWidth ||
            point.y > window.innerHeight
          )
            return null;
          return (
            <button
              key={comment.id}
              className="commenter-pin"
              style={{ top: point.y, left: point.x }}
              aria-label={`Комментарий ${index + 1}`}
              onClick={() => {
                setSelected(comment);
                setDraft(null);
                setOpen(false);
              }}
            >
              <MessageCircle size={15} aria-hidden="true" />
            </button>
          );
        })}
      {selecting && (
        <div className="commenter-prompt" role="status">
          <MapPinPlus size={18} aria-hidden="true" /> Выберите место на странице
          <button
            type="button"
            onClick={() => {
              setSelecting(false);
              setHover(null);
              start.current?.focus();
            }}
          >
            Отмена
          </button>
        </div>
      )}
      <button
        ref={start}
        className="commenter-launch"
        type="button"
        aria-label="Комментарии"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setSelecting(false);
          setHover(null);
        }}
      >
        <MessageCircle size={22} aria-hidden="true" />
      </button>
      {open && (
        <section className="commenter-panel commenter-menu" aria-label="Комментарии кабинета">
          <header>
            <h2>Комментарии</h2>
            <button
              type="button"
              className="commenter-icon"
              aria-label="Закрыть"
              onClick={() => {
                setOpen(false);
                start.current?.focus();
              }}
            >
              <X size={18} />
            </button>
          </header>
          <button
            type="button"
            className="commenter-primary"
            onClick={() => {
              setOpen(false);
              setDraft(null);
              setSelected(null);
              setSelecting(true);
            }}
          >
            <MapPinPlus size={17} /> Новый комментарий
          </button>
          {location.section !== "acc" && location.section !== "chats" && (
            <label className="commenter-checkbox">
              <input
                type="checkbox"
                checked={screenshot}
                onChange={(event) => setScreenshot(event.target.checked)}
              />{" "}
              Приложить снимок
            </label>
          )}
          <h3>
            <List size={17} aria-hidden="true" /> Список комментариев
          </h3>
          <div className="commenter-list">
            {comments.map((comment) => (
              <button key={comment.id} type="button" onClick={() => jump(comment)}>
                <strong>{comment.text || "Голосовой комментарий"}</strong>
                <small>
                  {SECTIONS.find(({ id }) => id === comment.section)?.label} ·{" "}
                  {STATUSES[comment.status]}
                </small>
              </button>
            ))}
            {loading && <p role="status">Загрузка…</p>}
            {!loading && !error && !comments.length && <p>Комментариев пока нет.</p>}
            {error && <p role="alert">{error}</p>}
            {next && (
              <button type="button" disabled={loading} onClick={() => void more()}>
                Показать ещё
              </button>
            )}
          </div>
        </section>
      )}
      {draft && showDraft && (
        <Composer
          key={draft.id}
          style={placement(draft.id)}
          close={() => {
            setDraft(null);
            start.current?.focus();
          }}
          save={(text, audio) => save(draft, text, audio)}
        />
      )}
      {showSelected && (
        <section
          className="commenter-panel commenter-anchor"
          style={placement(selected.id)}
          aria-label="Сохранённый комментарий"
        >
          <header>
            <h2>{selected.author}</h2>
            <button
              type="button"
              className="commenter-icon"
              aria-label="Закрыть комментарий"
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </button>
          </header>
          <small>{STATUSES[selected.status]}</small>
          {selected.text && <p className="commenter-text">{selected.text}</p>}
          {selected.hasAudio && (
            <audio controls preload="none" src={`${COMMENTS}/${selected.id}/audio`} />
          )}
          {selected.transcript && <p className="commenter-text">{selected.transcript}</p>}
        </section>
      )}
    </div>,
    document.body,
  );
}

function Composer({
  close,
  save,
  style,
}: {
  close: () => void;
  save: (text: string, audio: Blob | null) => Promise<void>;
  style?: { left: number; top: number };
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef(0);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    box.current?.focus();
    return () => {
      live.current = false;
      clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (!audio) return;
    const url = URL.createObjectURL(audio);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);

  async function record() {
    setPermission(true);
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error();
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!live.current) return media.getTracks().forEach((track) => track.stop());
      stream.current = media;
      const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const active = new MediaRecorder(media, { mimeType, audioBitsPerSecond: 48000 });
      recorder.current = active;
      const chunks: Blob[] = [];
      active.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      active.addEventListener("stop", () => {
        clearTimeout(timer.current);
        media.getTracks().forEach((track) => track.stop());
        if (!live.current) return;
        const clip = new Blob(chunks, { type: active.mimeType });
        setRecording(false);
        if (clip.size && clip.size <= 1024 * 1024) setAudio(clip);
        else setError("Не удалось сохранить запись. Попробуйте снова.");
      });
      active.start();
      setRecording(true);
      timer.current = window.setTimeout(stop, 60_000);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (live.current) setError("Микрофон недоступен. Проверьте разрешение браузера.");
    } finally {
      if (live.current) setPermission(false);
    }
  }
  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  async function submit() {
    if (busy || permission || recording || (!text.trim() && !audio)) return;
    setBusy(true);
    setError("");
    try {
      await save(text.trim(), audio);
    } catch (error) {
      setError(failure(error));
      setBusy(false);
    }
  }

  return (
    <section
      className="commenter-panel commenter-anchor"
      style={style}
      aria-label="Новый комментарий"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <header>
        <h2>Новый комментарий</h2>
        <button
          type="button"
          className="commenter-icon"
          disabled={busy}
          aria-label="Закрыть"
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!recording && !audio && (
          <textarea
            ref={box}
            value={text}
            maxLength={4000}
            rows={3}
            placeholder="Оставьте комментарий"
            aria-label="Текст комментария"
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        )}
        {recording && <p role="status">Идёт запись</p>}
        {audio && preview && <audio controls src={preview} />}
        <div className="commenter-actions">
          {recording ? (
            <button type="button" className="commenter-primary" onClick={stop}>
              <Square size={15} /> Остановить запись
            </button>
          ) : (
            <>
              {audio && (
                <button
                  type="button"
                  className="commenter-icon"
                  aria-label="Удалить запись"
                  disabled={busy}
                  onClick={() => {
                    setAudio(null);
                    setPreview("");
                  }}
                >
                  <Trash2 size={18} />
                </button>
              )}
              {text.trim() || audio ? (
                <button type="submit" className="commenter-primary" disabled={busy}>
                  <Send size={16} /> {busy ? "Отправляем…" : "Отправить"}
                </button>
              ) : (
                <button
                  type="button"
                  className="commenter-icon"
                  aria-label="Записать голосовой комментарий"
                  disabled={permission}
                  onClick={() => void record()}
                >
                  <Mic size={21} />
                </button>
              )}
            </>
          )}
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

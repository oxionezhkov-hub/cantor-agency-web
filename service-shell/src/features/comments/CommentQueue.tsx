import { useEffect, useState } from "react";
import { SECTIONS } from "../service/sections";
import {
  ADMIN_COMMENTS,
  DIAGNOSTIC_LABELS,
  STATUSES,
  fetchComments,
  jsonBody,
  request,
  type Comment,
  type Status,
} from "./client";
import "./comments.css";

const timestamp = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});
const transcriptStatus = {
  pending: "Ожидает расшифровки",
  processing: "Расшифровка выполняется",
  complete: "Расшифровано",
  failed: "Ошибка расшифровки",
} as const;

export function CommentQueue() {
  const [workspace, setWorkspace] = useState("");
  const [section, setSection] = useState("");
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<Comment[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [before, setBefore] = useState("");
  const [previous, setPrevious] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ workspace: workspace.trim(), section, status, before });
    setLoading(true);
    setError("");
    void fetchComments(ADMIN_COMMENTS, query, controller.signal)
      .then(({ comments, next }) => {
        setResults(comments);
        setNext(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Не удалось загрузить замечания.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspace, section, status, before, version]);

  function filter(set: (value: string) => void, value: string) {
    set(value);
    setBefore("");
    setPrevious([]);
  }
  function refresh() {
    setVersion((value) => value + 1);
  }
  return (
    <section className="comment-queue" aria-labelledby="comment-queue-title">
      <header>
        <h1 id="comment-queue-title">Замечания</h1>
        <button className="commenter-primary" type="button" disabled={loading} onClick={refresh}>
          Обновить
        </button>
      </header>
      <div className="comment-queue-filters">
        <label>
          Кабинет{" "}
          <input
            maxLength={150}
            value={workspace}
            placeholder="ID кабинета"
            onChange={(event) => filter(setWorkspace, event.target.value)}
          />
        </label>
        <label>
          Раздел
          <select
            aria-label="Раздел"
            value={section}
            onChange={(event) => filter(setSection, event.target.value)}
          >
            <option value="">Все разделы</option>
            {SECTIONS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Состояние
          <select
            aria-label="Состояние"
            value={status}
            onChange={(event) => filter(setStatus, event.target.value)}
          >
            <option value="">Все состояния</option>
            {Object.entries(STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading && <p role="status">Загрузка замечаний…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading &&
        !error &&
        (results.length ? (
          <div className="comment-queue-items">
            {results.map((comment) => (
              <QueueItem key={comment.id} comment={comment} refresh={refresh} />
            ))}
          </div>
        ) : (
          <p>Замечаний нет.</p>
        ))}
      {!loading && !error && (previous.length > 0 || next) && (
        <nav aria-label="Страницы замечаний" className="comment-queue-pages">
          <button
            type="button"
            disabled={!previous.length}
            onClick={() => {
              setBefore(previous.at(-1) ?? "");
              setPrevious(previous.slice(0, -1));
            }}
          >
            Назад
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => {
              if (!next) return;
              setPrevious([...previous, before]);
              setBefore(next);
            }}
          >
            Дальше
          </button>
        </nav>
      )}
    </section>
  );
}
function QueueItem({ comment, refresh }: { comment: Comment; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showShot, setShowShot] = useState(false);
  const base = `${ADMIN_COMMENTS}/${comment.id}`;
  async function update(action: "status" | "transcribe", status?: Status) {
    setBusy(true);
    setError("");
    try {
      if (action === "status") await request(base, { method: "PATCH", ...jsonBody({ status }) });
      else await request(`${base}/transcribe`, { method: "POST" });
      refresh();
    } catch {
      setError(
        action === "status"
          ? "Не удалось изменить состояние."
          : "Не удалось расшифровать запись. Можно повторить.",
      );
    } finally {
      setBusy(false);
    }
  }
  const { target } = comment;
  return (
    <article className="comment-queue-item">
      <header>
        <div>
          <h2>
            {SECTIONS.find(({ id }) => id === comment.section)?.label} · {comment.workspaceId}
          </h2>
          <small>
            {comment.author} · {timestamp.format(new Date(comment.createdAt))} МСК
          </small>
        </div>
        <label>
          Состояние
          <select
            aria-label="Состояние"
            value={comment.status}
            disabled={busy}
            onChange={(event) => void update("status", event.target.value as Status)}
          >
            {Object.entries(STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <details>
        <summary>Привязка к элементу</summary>
        <p>
          <code>
            {target.anchor || "Страница"}
            {target.path && ` / ${target.path}`}
          </code>
        </p>
        <p>
          {[target.focus, target.view].filter(Boolean).join(" · ")} · {Math.round(target.x * 100)}%
          × {Math.round(target.y * 100)}%
        </p>
      </details>
      {comment.text && <p className="commenter-text">{comment.text}</p>}
      {comment.hasAudio && <audio controls preload="none" src={`${base}/audio`} />}
      {comment.transcriptionStatus && (
        <div className="comment-queue-transcript">
          <small>{transcriptStatus[comment.transcriptionStatus]}</small>
          {comment.transcript && <p className="commenter-text">{comment.transcript}</p>}
          {comment.transcriptionStatus !== "complete" && (
            <button type="button" disabled={busy} onClick={() => void update("transcribe")}>
              {busy
                ? "Обработка…"
                : comment.transcriptionStatus === "pending"
                  ? "Расшифровать"
                  : "Повторить расшифровку"}
            </button>
          )}
        </div>
      )}
      {comment.hasScreenshot && (
        <details onToggle={(event) => setShowShot(event.currentTarget.open)}>
          <summary>Снимок экрана</summary>
          {showShot && (
            <img src={`${base}/screenshot`} alt="Снимок видимой области на момент выбора точки" />
          )}
        </details>
      )}
      {comment.diagnostics.length > 0 && (
        <details>
          <summary>Ошибки страницы</summary>
          <ul>
            {comment.diagnostics.map(({ kind, at }, index) => (
              <li key={index}>
                {DIAGNOSTIC_LABELS[kind]} · {timestamp.format(new Date(at))} МСК
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

import { useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import { changeDemoCrm } from "./demo-crm-store.ts";
import { addOutcome, addFollowup, finishFollowup } from "./communication.ts";
import type { CrmState } from "./crm.ts";
export function LeadFollowups({ state, leadId }: { state: CrmState; leadId: string }) {
  const [summary, setSummary] = useState(""),
    [title, setTitle] = useState(""),
    [due, setDue] = useState("");
  const [error, setError] = useState("");
  const tasks = (state.followups ?? []).filter((t) => t.leadId === leadId);
  function outcome(e: FormEvent) {
    e.preventDefault();
    try {
      changeDemoCrm((s) =>
        addOutcome(
          s,
          s.workspaceId,
          leadId,
          summary,
          new Date().toISOString(),
          crypto.randomUUID(),
        ),
      );
      setSummary("");
      setTitle("Связаться после диагностики");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить итог");
    }
  }
  function task(e: FormEvent) {
    e.preventDefault();
    try {
      if (!due) throw new Error("Выберите дату и время");
      changeDemoCrm((s) =>
        addFollowup(
          s,
          s.workspaceId,
          leadId,
          title,
          new Date(due + ":00+03:00").toISOString(),
          crypto.randomUUID(),
        ),
      );
      setTitle("");
      setDue("");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить задачу");
    }
  }
  return (
    <section className="followup-panel" aria-label="Итоги и задачи">
      <h3>Итог диагностики</h3>
      {(state.outcomes ?? [])
        .filter((o) => o.leadId === leadId)
        .map((o) => (
          <p className="outcome-note" key={o.id}>
            {o.text}
          </p>
        ))}
      <form onSubmit={outcome}>
        <textarea
          aria-label="Итог диагностики"
          placeholder="Что выяснили и о чём договорились"
          value={summary}
          maxLength={4000}
          onChange={(e) => setSummary(e.target.value)}
          required
        />
        <button type="submit" className="crm-secondary">
          Сохранить итог
        </button>
      </form>
      <h3>Задачи</h3>
      <ul className="followup-list">
        {tasks.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              aria-label={`Выполнить: ${t.title}`}
              disabled={Boolean(t.doneAt)}
              className={t.doneAt ? "done" : ""}
              onClick={() => {
                try {
                  changeDemoCrm((s) =>
                    finishFollowup(s, s.workspaceId, t.id, new Date().toISOString()),
                  );
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <Check size={15} />
            </button>
            <span>
              {t.title}
              <time>
                {t.doneAt
                  ? "Выполнено"
                  : new Date(t.dueAt).toLocaleString("ru-RU", {
                      timeZone: "Europe/Moscow",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
              </time>
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={task} aria-label="Новая задача">
        <input
          aria-label="Название задачи"
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что сделать"
          required
        />
        <label>
          Срок · МСК
          <input
            aria-label="Срок задачи"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            required
          />
        </label>
        <button className="crm-secondary" type="submit">
          <Plus size={15} />
          Добавить задачу
        </button>
      </form>
      {error ? (
        <p role="alert" className="crm-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { ChevronDown, RotateCcw, Send } from "lucide-react";
import { generateAi, rememberAiExample, type AiBlock } from "./ai-manager-client";

const prompts = ["Сколько стоит занятие?", "Готовите к ЕГЭ?", "Когда можно на диагностику?"];
type Turn = { role: "user" | "assistant"; content: string };

export function AiTestChat({ active, onRemember }: { active: boolean; onRemember: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [correction, setCorrection] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previousAnswer, setPreviousAnswer] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) input.current?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => {
    if (active && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [active, turns, pending]);

  const last = turns.at(-1);
  const answered = last?.role === "assistant";

  async function reply(history: Turn[], previous = "") {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const content = await generateAi(history, "");
      setTurns([...history, { role: "assistant", content }]);
      setPreviousAnswer(previous);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подготовить ответ");
    } finally {
      setPending(false);
    }
  }

  function submit() {
    const content = draft.trim();
    if (!content || pending || correction !== null) return;
    // Replace an unanswered message after a failed generation.
    const history: Turn[] = [
      ...(last?.role === "user" ? turns.slice(0, -1) : turns),
      { role: "user", content },
    ];
    setPreviousAnswer("");
    setTurns(history);
    setDraft("");
    void reply(history);
  }

  return (
    <div className="aim-test">
      <div className="aim-test-head">
        <p>Пишите от лица клиента. Ответ появится только в этом чате.</p>
        <button
          type="button"
          className="st-button"
          disabled={pending || !turns.length}
          onClick={() => {
            setTurns([]);
            setPreviousAnswer("");
            setDraft("");
            setCorrection(null);
            setError("");
            setNotice("");
            input.current?.focus();
          }}
        >
          <RotateCcw size={15} /> Новый тест
        </button>
      </div>
      {turns.length ? (
        <div className="aim-thread" ref={thread} role="log" aria-label="Тестовая переписка">
          {turns.map((turn, index) => (
            <div key={index} className={`aim-turn ${turn.role}`}>
              <span>{turn.role === "user" ? "Клиент" : "ИИ"}</span>
              <p>{turn.content}</p>
            </div>
          ))}
          {pending ? <p role="status">ИИ готовит ответ…</p> : null}
        </div>
      ) : (
        <div className="aim-prompts">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="st-button"
              onClick={() => {
                setDraft(prompt);
                input.current?.focus();
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
      {answered && !pending && correction === null ? (
        <div className="aim-test-actions">
          <button type="button" className="st-button" onClick={() => setCorrection(last.content)}>
            Исправить и запомнить
          </button>
          <button
            type="button"
            className="st-button"
            onClick={() => void reply(turns.slice(0, -1), last.content)}
          >
            Проверить ещё раз
          </button>
        </div>
      ) : null}
      {previousAnswer && answered ? (
        <details className="aim-previous-answer">
          <summary>Предыдущий ответ для сравнения</summary>
          <p>{previousAnswer}</p>
        </details>
      ) : null}
      {correction !== null ? (
        <form
          className="aim-correction"
          onSubmit={(e) => {
            e.preventDefault();
            if (!correction.trim() || !answered) return;
            rememberAiExample(turns.at(-2)?.content ?? "", last.content, correction.trim());
            onRemember();
            setCorrection(null);
            setNotice(
              "Пример добавлен в «Правки ответов». Повторите вопрос, чтобы сравнить ответы.",
            );
          }}
        >
          <label>
            Как лучше ответить
            <textarea
              autoFocus
              value={correction}
              maxLength={1000}
              onChange={(e) => setCorrection(e.target.value)}
            />
          </label>
          <div className="aim-test-actions">
            <button type="submit" className="st-button" disabled={!correction.trim()}>
              Запомнить пример
            </button>
            <button type="button" className="st-button" onClick={() => setCorrection(null)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}
      {notice ? (
        <p role="status" className="aim-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="crm-error">
          {error}
        </p>
      ) : null}
      {error && last?.role === "user" ? (
        <button
          type="button"
          className="st-button"
          disabled={pending}
          onClick={() => void reply(turns)}
        >
          Повторить запрос
        </button>
      ) : null}
      <form
        className="aim-client-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={input}
          aria-label="Напишите как клиент"
          placeholder="Напишите как клиент…"
          value={draft}
          maxLength={1000}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="st-button"
          aria-label="Отправить тестовое сообщение"
          disabled={pending || !draft.trim() || correction !== null}
        >
          <Send size={17} />
        </button>
      </form>
    </div>
  );
}

export function AiBlockEditor({
  blocks,
  expanded,
  onExpand,
  onEdit,
  onTest,
}: {
  blocks: AiBlock[];
  expanded: number;
  onExpand: (index: number) => void;
  onEdit: (blocks: AiBlock[]) => void;
  onTest: () => void;
}) {
  const length = blocks.reduce((n, block) => n + block.text.length + block.separator.length, 0);
  return (
    <div className="aim-scenarios">
      {blocks.map((block, index) => (
        <article key={index} className="aim-scenario">
          <div className="aim-scenario-top">
            <button
              type="button"
              className="aim-scenario-open"
              aria-expanded={expanded === index}
              onClick={() => onExpand(expanded === index ? -1 : index)}
            >
              <span>
                <strong>{block.title}</strong>
                <small>{block.text.trim().split("\n")[0] || "Пустой блок"}</small>
              </span>
              <ChevronDown size={16} />
            </button>
          </div>
          {expanded === index ? (
            <div className="aim-scenario-fields">
              <textarea
                aria-label={block.title}
                value={block.text}
                rows={Math.min(12, Math.max(5, block.text.split("\n").length + 2))}
                maxLength={Math.max(block.text.length, 16000 - length + block.text.length)}
                onChange={(e) =>
                  onEdit(
                    blocks.map((item, i) =>
                      i === index ? { ...item, text: e.target.value } : item,
                    ),
                  )
                }
              />
              <button type="button" className="st-button aim-block-test" onClick={onTest}>
                Проверить в чате
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  BookOpen,
  SlidersHorizontal,
  MessagesSquare,
  CalendarDays,
  History,
  Plus,
  Trash2,
  ChevronDown,
  ShieldCheck,
  FlaskConical,
} from "lucide-react";
import { ServiceSelect } from "./service-controls";
import { useDemoCrm } from "./demo-crm-store";
import {
  settings,
  splitAiBlocks,
  aiExamples,
  removeAiExample,
  modelOptions,
  loadAiSettings,
  updateAiSettings,
  type AiSettings,
} from "./ai-manager-client";
import "./ai-manager.css";
import { AiBlockEditor, AiTestChat } from "./ai-manager-training";
type Tab = "test" | "system" | "knowledge" | "scripts" | "slots" | "feedback";
const tabs = [
  { id: "test", label: "Тестовый чат", icon: FlaskConical },
  { id: "system", label: "Инструкции", icon: SlidersHorizontal },
  { id: "knowledge", label: "База знаний", icon: BookOpen },
  { id: "scripts", label: "Сценарии", icon: MessagesSquare },
  { id: "slots", label: "Свободное время", icon: CalendarDays },
  { id: "feedback", label: "Правки ответов", icon: History },
] as const;
type Scenario = { title: string; when: string; text: string };
export function AiManager() {
  const [value, setValue] = useState<AiSettings | null>(settings),
    [tab, setTab] = useState<Tab>("test"),
    [error, setError] = useState(""),
    [expanded, setExpanded] = useState<number | null>(null);
  const { state } = useDemoCrm();
  const [examples, setExamples] = useState(aiExamples);
  const [blocks, setBlocks] = useState(() =>
    settings
      ? {
          system: splitAiBlocks(settings.system, "Роль и цель"),
          knowledge: splitAiBlocks(settings.knowledge, "О преподавателе"),
        }
      : null,
  );
  const [openBlock, setOpenBlock] = useState({ system: -1, knowledge: -1 });
  function openTest() {
    setTab("test");
    document
      .getElementById("aim-tab-test")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  useEffect(() => {
    let active = true;
    loadAiSettings()
      .then((s) => {
        if (active) {
          setValue(s);
          setBlocks(
            (current) =>
              current ?? {
                system: splitAiBlocks(s.system, "Роль и цель"),
                knowledge: splitAiBlocks(s.knowledge, "О преподавателе"),
              },
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  function update(patch: Partial<AiSettings>) {
    if (!value) return;
    const next = { ...value, ...patch };
    updateAiSettings(next);
    setValue(next);
  }
  let rows: Scenario[] = [];
  let invalid = false;
  try {
    if (value) {
      const parsed: unknown = JSON.parse(value.scripts);
      if (!Array.isArray(parsed)) invalid = true;
      else rows = parsed;
    }
  } catch {
    invalid = true;
  }
  const feedback = [...(state.feedback ?? [])].reverse();
  return (
    <section className="ai-manager" aria-label="ИИ-менеджер">
      <div className="aim-toolbar">
        <div className="aim-model">
          <ServiceSelect
            label="Модель ответа"
            value={value?.model || modelOptions[0].value}
            onChange={(model) => update({ model })}
            options={modelOptions}
          />
        </div>
        <button
          type="button"
          className="aim-check"
          role="switch"
          aria-label="Проверять ответ перед согласованием"
          aria-checked={Boolean(value?.selfCheck)}
          disabled={!value}
          onClick={() => update({ selfCheck: !value?.selfCheck })}
        >
          <ShieldCheck size={16} />
          <span>Самопроверка</span>
          <i />
        </button>
      </div>
      <div className="aim-tabs" role="tablist" aria-label="Настройки менеджера">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`aim-panel-${id}`}
            id={`aim-tab-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
              e.preventDefault();
              const index = tabs.findIndex((item) => item.id === id);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? tabs.length - 1
                    : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              setTab(tabs[next].id);
              document.getElementById(`aim-tab-${tabs[next].id}`)?.focus();
            }}
            onClick={() => setTab(id)}
          >
            <Icon size={16} />
            {label}
            {id === "feedback" && feedback.length + examples.length > 0 ? (
              <small>{feedback.length + examples.length}</small>
            ) : null}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`aim-panel-${tab}`}
        aria-labelledby={`aim-tab-${tab}`}
        className="aim-panel"
      >
        {!value && !error ? (
          <div className="aim-loading" role="status">
            Загрузка настроек…
          </div>
        ) : null}
        {value ? (
          <div hidden={tab !== "test"}>
            <AiTestChat active={tab === "test"} onRemember={() => setExamples(aiExamples)} />
          </div>
        ) : null}
        {value && blocks && (tab === "system" || tab === "knowledge") ? (
          <AiBlockEditor
            blocks={blocks[tab]}
            expanded={openBlock[tab]}
            onExpand={(index) => setOpenBlock({ ...openBlock, [tab]: index })}
            onEdit={(next) => {
              setBlocks({ ...blocks, [tab]: next });
              update({ [tab]: next.map((block) => block.separator + block.text).join("") });
            }}
            onTest={openTest}
          />
        ) : null}
        {value && tab === "slots" ? (
          <div className="aim-editor-wrap">
            <textarea
              className="aim-editor"
              aria-label="Свободное время"
              value={value.slots}
              maxLength={16000}
              placeholder="Добавьте доступные дни и время для диагностики…"
              onChange={(e) => update({ slots: e.target.value })}
            />
          </div>
        ) : null}
        {value && tab === "scripts" ? (
          <div className="aim-scenarios">
            {invalid ? (
              <p role="alert" className="crm-error">
                Не удалось прочитать сценарии. Проверьте настройки источника.
              </p>
            ) : (
              <>
                {rows.map((row, index) => (
                  <article className="aim-scenario" key={index}>
                    <div className="aim-scenario-top">
                      <button
                        type="button"
                        className="aim-scenario-open"
                        aria-expanded={expanded === index}
                        onClick={() => setExpanded(expanded === index ? null : index)}
                      >
                        <span>
                          <strong>{row.title || "Без названия"}</strong>
                          <small>{row.when || "Условия не заданы"}</small>
                        </span>
                        <ChevronDown size={16} />
                      </button>
                      <button
                        type="button"
                        className="aim-delete"
                        aria-label={`Удалить сценарий ${index + 1}`}
                        onClick={() => {
                          update({ scripts: JSON.stringify(rows.filter((_, i) => i !== index)) });
                          setExpanded(null);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    {expanded === index ? (
                      <div className="aim-scenario-fields">
                        {(
                          [
                            ["title", "Название"],
                            ["when", "Когда применять"],
                            ["text", "Ответ"],
                          ] as const
                        ).map(([field, label]) => (
                          <label key={field}>
                            {label}
                            {field === "title" ? (
                              <input
                                aria-label={`${label} сценария ${index + 1}`}
                                value={row[field] || ""}
                                maxLength={300}
                                onChange={(e) =>
                                  update({
                                    scripts: JSON.stringify(
                                      rows.map((r, i) =>
                                        i === index ? { ...r, [field]: e.target.value } : r,
                                      ),
                                    ),
                                  })
                                }
                              />
                            ) : (
                              <textarea
                                aria-label={`${label} сценария ${index + 1}`}
                                value={row[field] || ""}
                                maxLength={4000}
                                onChange={(e) =>
                                  update({
                                    scripts: JSON.stringify(
                                      rows.map((r, i) =>
                                        i === index ? { ...r, [field]: e.target.value } : r,
                                      ),
                                    ),
                                  })
                                }
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
                <button
                  type="button"
                  className="aim-add"
                  onClick={() => {
                    update({
                      scripts: JSON.stringify([
                        ...rows,
                        { title: "Новый сценарий", when: "", text: "" },
                      ]),
                    });
                    setExpanded(rows.length);
                  }}
                >
                  <Plus size={16} />
                  Добавить сценарий
                </button>
              </>
            )}
          </div>
        ) : null}
        {tab === "feedback" ? (
          <div className="aim-feedback">
            <div className="aim-training-help">
              <p>
                В тестовом чате исправьте ответ и нажмите «Запомнить пример». ИИ учитывает свежие
                примеры в следующих ответах до обновления страницы.
              </p>
              <button type="button" className="st-button" onClick={openTest}>
                Открыть тестовый чат
              </button>
            </div>
            {examples
              .slice()
              .reverse()
              .map((example) => (
                <article key={example.id}>
                  <div className="aim-feedback-head">
                    <span>Пример ответа</span>
                    <button
                      type="button"
                      className="aim-delete"
                      aria-label={`Удалить пример: ${example.question}`}
                      onClick={() => {
                        removeAiExample(example.id);
                        setExamples(aiExamples);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <strong>{example.question}</strong>
                  <p>{example.original}</p>
                  <blockquote>{example.answer}</blockquote>
                </article>
              ))}
            {!feedback.length && !examples.length ? (
              <div className="aim-empty">
                <History size={24} />
                <strong>Пока нет правок</strong>
                <p>
                  Одобрите или отредактируйте предложенный ответ в сообщениях — он появится здесь.
                </p>
              </div>
            ) : (
              feedback.map((f) => (
                <article key={f.id}>
                  <div className="aim-feedback-head">
                    <span>
                      {f.action === "approved"
                        ? "Одобрен"
                        : f.action === "edited"
                          ? "Отредактирован"
                          : "Отклонён"}
                    </span>
                    <time>
                      {new Date(f.at).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{f.original}</p>
                  {f.corrected && f.corrected !== f.original ? (
                    <blockquote>{f.corrected}</blockquote>
                  ) : null}
                </article>
              ))
            )}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="crm-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

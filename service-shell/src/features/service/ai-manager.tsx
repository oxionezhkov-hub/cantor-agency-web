import { useEffect, useState } from "react";
import { ServiceSelect } from "./service-controls";
import { useDemoCrm } from "./demo-crm-store";
import {
  settings,
  modelOptions,
  loadAiSettings,
  updateAiSettings,
  type AiSettings,
} from "./ai-manager-client";
export function AiManager() {
  const [value, setValue] = useState<AiSettings | null>(settings),
    [tab, setTab] = useState<"system" | "knowledge" | "scripts" | "slots">("system"),
    [error, setError] = useState("");
  const { state } = useDemoCrm();
  useEffect(() => {
    let active = true;
    loadAiSettings()
      .then((s) => {
        if (active) setValue(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="ai-manager">
      <div className="ai-manager-tools">
        <ServiceSelect
          label="Модель ответа"
          value={value?.model || modelOptions[0].value}
          onChange={(model) => {
            if (value) {
              const next = { ...value, model };
              updateAiSettings(next);
              setValue(next);
            }
          }}
          options={modelOptions}
        />
      </div>
      {value ? (
        <label>
          <input
            type="checkbox"
            checked={Boolean(value.selfCheck)}
            onChange={(e) => {
              const next = { ...value, selfCheck: e.target.checked };
              updateAiSettings(next);
              setValue(next);
            }}
          />{" "}
          Проверять ответ перед согласованием
        </label>
      ) : null}
      <div className="ai-manager-tabs">
        {(
          [
            ["system", "Инструкции"],
            ["knowledge", "База знаний"],
            ["scripts", "Сценарии"],
            ["slots", "Свободное время"],
          ] as const
        ).map(([id, label]) => (
          <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {value && tab === "scripts" ? (
        <div className="ai-scripts">
          {(() => {
            let rows: { title: string; when: string; text: string }[] = [];
            try {
              rows = JSON.parse(value.scripts);
            } catch {
              return <p role="alert">Проверьте формат сценариев</p>;
            }
            return (
              <>
                {rows.map((row, index) => (
                  <article key={index}>
                    {(
                      [
                        ["title", "Название"],
                        ["when", "Когда применять"],
                        ["text", "Ответ"],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field}>
                        {label}
                        <textarea
                          aria-label={`${label} сценария ${index + 1}`}
                          value={row[field] || ""}
                          onChange={(e) => {
                            const next = {
                              ...value,
                              scripts: JSON.stringify(
                                rows.map((r, i) =>
                                  i === index ? { ...r, [field]: e.target.value } : r,
                                ),
                              ),
                            };
                            updateAiSettings(next);
                            setValue(next);
                          }}
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      className="crm-quiet"
                      onClick={() => {
                        const next = {
                          ...value,
                          scripts: JSON.stringify(rows.filter((_, i) => i !== index)),
                        };
                        updateAiSettings(next);
                        setValue(next);
                      }}
                    >
                      Удалить сценарий
                    </button>
                  </article>
                ))}
                <button
                  className="crm-secondary"
                  type="button"
                  onClick={() => {
                    const next = {
                      ...value,
                      scripts: JSON.stringify([
                        ...rows,
                        { title: "Новый сценарий", when: "", text: "" },
                      ]),
                    };
                    updateAiSettings(next);
                    setValue(next);
                  }}
                >
                  Добавить сценарий
                </button>
              </>
            );
          })()}
        </div>
      ) : value ? (
        <textarea
          aria-label="Настройки ИИ-менеджера"
          value={value[tab]}
          maxLength={16000}
          onChange={(e) => {
            const next = { ...value, [tab]: e.target.value };
            updateAiSettings(next);
            setValue(next);
          }}
        />
      ) : (
        <p role="status">Загрузка настроек…</p>
      )}
      <details>
        <summary>Правки ответов · {state.feedback?.length || 0}</summary>
        {state.feedback?.map((f) => (
          <article key={f.id}>
            <p>{f.original}</p>
            <strong>{f.corrected || "Ответ отклонён"}</strong>
          </article>
        ))}
      </details>
      {error ? (
        <p role="alert" className="crm-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

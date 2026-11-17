import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, CircleHelp, Pencil, Target } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import type { CrmState } from "./crm.ts";
import { parseMoneyInput } from "./crm.ts";
import type { buildAnalytics } from "./analytics-model.ts";
import { useDemoCrm } from "./demo-crm-store.ts";
import { getPreviewData } from "./preview-data.ts";
import { dialogueInsights, ltvEconomics, topRecommendations } from "./analytics-insights.ts";
import "./analytics-insights.css";
const rub = (amount: number | null) =>
  amount === null ? "—" : `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
let previewSessionLtv: number | null = null;
export function LtvEconomics({ report }: { report: ReturnType<typeof buildAnalytics> }) {
  const { state } = useDemoCrm();
  const key = `cantor.analytics.ltv.${state.workspaceId}`;
  const previewOnly = Boolean(getPreviewData());
  const [ltv, setLtv] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        const value = previewOnly
          ? previewSessionLtv === null
            ? null
            : String(previewSessionLtv)
          : localStorage.getItem(key);
        const parsed = value === null ? null : Number(value);
        if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
          setLtv(null);
          setDraft("");
        } else {
          setLtv(parsed);
          setDraft(String(parsed).replace(".", ","));
        }
      } catch {
        setError("Не удалось прочитать LTV из хранилища браузера.");
      }
    };
    read();
    const changed = (event: StorageEvent) => {
      if (event.key === key) read();
    };
    if (!previewOnly) window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key, previewOnly]);
  const assessment = ltvEconomics(
    report.totals.spendRub,
    report.crm?.newStudents ?? 0,
    ltv,
    report.coverage.complete && report.crm !== null,
  );
  function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);
    const minor = parseMoneyInput(draft);
    if (minor === null) {
      setError("Введите LTV больше 0 ₽ с точностью до копеек.");
      return;
    }
    try {
      if (previewOnly) previewSessionLtv = minor / 100;
      else localStorage.setItem(key, String(minor / 100));
      setLtv(minor / 100);
      setSaved(true);
      setEditing(false);
    } catch {
      setError("LTV не сохранён: хранилище браузера недоступно.");
    }
  }
  return (
    <article className="an-card an-ltv" aria-label="Экономика по LTV">
      <div className="an-card-title">
        <h2>Сходится ли экономика</h2>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="an-ltv-help" aria-label="Как считается экономика">
              <CircleHelp size={16} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="an-ltv-help-content" sideOffset={8} align="end">
              LTV = цена занятия × занятий в месяц × месяцев обучения. Стоимость привлечения ученика
              — до 20% его LTV. Расход на ученика рассчитан по событиям выбранного периода.
              <Popover.Arrow className="an-ltv-help-arrow" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {ltv === null || editing ? (
        <form onSubmit={save} className="an-ltv-form">
          <label>
            LTV ученика, ₽
            <input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaved(false);
              }}
              inputMode="decimal"
              placeholder="Например, 72 000"
              aria-invalid={!!error}
            />
          </label>
          <button type="submit">Сохранить LTV</button>
          {ltv !== null ? (
            <button
              type="button"
              onClick={() => {
                setDraft(String(ltv).replace(".", ","));
                setEditing(false);
                setError("");
              }}
            >
              Отмена
            </button>
          ) : null}
        </form>
      ) : null}
      {saved && !editing ? (
        <span className="sr-only" role="status">
          <Check size={15} />
          {previewOnly ? "Сохранено на время сеанса" : "Сохранено"}
        </span>
      ) : null}
      {error ? (
        <p className="crm-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className={`an-ltv-values ${ltv === null ? "no-ltv" : ""}`}>
        <div>
          <span>
            Расход на нового ученика{" "}
            <small title="Расход на рекламу ÷ новые платящие ученики за выбранные даты">
              · оценка периода
            </small>
          </span>
          <strong data-testid="ltv-cac">{rub(assessment.costRub)}</strong>
        </div>
        <div>
          <span>Допустимо · 20% LTV</span>
          <strong data-testid="ltv-limit">{rub(assessment.limitRub)}</strong>
        </div>
        <div>
          <span>
            LTV ученика{" "}
            {ltv !== null ? (
              <button
                className="an-ltv-edit"
                type="button"
                aria-label="Изменить LTV"
                onClick={() => {
                  setEditing(true);
                  setSaved(false);
                }}
              >
                <Pencil size={15} />
              </button>
            ) : null}
          </span>
          <strong data-testid="ltv-value">{rub(ltv)}</strong>
          {previewOnly && ltv !== null ? <small>На время сеанса</small> : null}
        </div>
      </div>
      {assessment.atBoundary ? (
        <p className="an-ltv-pending" role="status">
          Расход составляет ровно 20% LTV.
        </p>
      ) : assessment.works === null ? (
        <p className="an-ltv-pending">
          {ltv === null
            ? "Укажите LTV, чтобы проверить экономику."
            : !report.crm
              ? "Выберите все города для расчёта по ученикам."
              : !report.coverage.complete
                ? "Для оценки нужен период с полными рекламными данными."
                : "В выбранном периоде ещё нет новых платящих учеников."}
        </p>
      ) : (
        <div className={`an-ltv-result ${assessment.works ? "is-good" : "is-bad"}`} role="status">
          <Target size={19} />
          <strong>{assessment.works ? "Экономика сходится" : "Расход выше 20% LTV"}</strong>
          <span>
            {assessment.works
              ? "В пределах целевой доли"
              : `Снизить расход на ученика на ${rub(assessment.costRub! - assessment.limitRub!)}`}
          </span>
        </div>
      )}
      {assessment.sharePct !== null ? (
        <div
          className="an-ltv-meter"
          role="meter"
          aria-label="Доля расходов от LTV"
          aria-valuemin={0}
          aria-valuemax={Math.max(100, assessment.sharePct)}
          aria-valuenow={assessment.sharePct}
        >
          <i style={{ width: `${Math.min(100, assessment.sharePct)}%` }} />
          <b style={{ left: "20%" }} />
          <span>0%</span>
          <span>20% — цель</span>
          <span>100% LTV</span>
        </div>
      ) : null}
    </article>
  );
}
export function DialogInsights({ crm, leadIds }: { crm: CrmState; leadIds: string[] }) {
  const insight = dialogueInsights(crm, leadIds);
  return (
    <div className="an-grid an-equal an-dialog-insights">
      <article className="an-card">
        <div className="an-card-title">
          <h2>Причины отказов</h2>
        </div>
        {insight.refusalReasons.length ? (
          <div className="an-refusal-list">
            {insight.refusalReasons.slice(0, 5).map((reason) => (
              <div key={reason.reason}>
                <Link to="/" search={{ section: "chats", focus: reason.leadIds[0] }}>
                  <span>{reason.reason}</span>
                  <strong>
                    {reason.count}
                    <ArrowUpRight size={14} />
                  </strong>
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="an-inline-empty">В выбранных обращениях пока нет записанных отказов.</p>
        )}
      </article>
      <article className="an-card">
        <div className="an-card-title">
          <h2>Как улучшить диалоги</h2>
        </div>
        {insight.recommendations.length ? (
          <div className="an-dialog-advice">
            {topRecommendations(insight.recommendations).map((item) => (
              <Link key={item.id} to="/" search={{ section: "chats", focus: item.leadId }}>
                <div>
                  <strong>
                    {item.title}
                    <span>{item.count}</span>
                  </strong>
                  <p>{item.action}</p>
                </div>
                <ArrowUpRight size={16} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="an-inline-empty">В выбранных обращениях нет незавершённых шагов.</p>
        )}
      </article>
    </div>
  );
}

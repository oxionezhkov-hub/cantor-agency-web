import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, CircleHelp, Target } from "lucide-react";
import type { CrmState } from "./crm.ts";
import { parseMoneyInput } from "./crm.ts";
import type { buildAnalytics } from "./analytics-model.ts";
import { useDemoCrm } from "./demo-crm-store.ts";
import { dialogueInsights, ltvEconomics } from "./analytics-insights.ts";
import "./analytics-insights.css";
const rub = (amount: number | null) =>
  amount === null ? "—" : `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
const percent = (amount: number | null) =>
  amount === null ? "—" : `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
export function LtvEconomics({ report }: { report: ReturnType<typeof buildAnalytics> }) {
  const { state } = useDemoCrm();
  const key = `cantor.analytics.ltv.${state.workspaceId}`;
  const [ltv, setLtv] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        const value = localStorage.getItem(key);
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
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
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
      localStorage.setItem(key, String(minor / 100));
      setLtv(minor / 100);
      setSaved(true);
    } catch {
      setError("LTV не сохранён: хранилище браузера недоступно.");
    }
  }
  return (
    <article className="an-card an-ltv" aria-label="Экономика по LTV">
      <div className="an-card-title">
        <h2>Сходится ли экономика</h2>
        <span
          className="an-ltv-help"
          title="LTV = цена занятия × занятий в месяц × месяцев обучения. Ориентир из базы знаний: стоимость привлечения ученика — до 20% его LTV. Расход на ученика здесь рассчитан по событиям выбранного периода, это не когортный CAC."
        >
          <CircleHelp size={16} aria-label="Правило 20% LTV" />
        </span>
      </div>
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
        {saved ? (
          <span className="an-ltv-saved" role="status">
            <Check size={15} />
            Сохранено
          </span>
        ) : null}
      </form>
      {error ? (
        <p className="crm-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="an-ltv-values">
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
          <span>Доля расходов от LTV</span>
          <strong data-testid="ltv-share">{percent(assessment.sharePct)}</strong>
        </div>
      </div>
      {assessment.works === null ? (
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
            {insight.refusalReasons.map((reason) => (
              <div key={reason.reason}>
                <Link to="/" search={{ section: "chats", focus: reason.leadIds[0] }}>
                  <span>{reason.reason}</span>
                  <strong>
                    {reason.count}
                    <ArrowUpRight size={14} />
                  </strong>
                </Link>
                <div>
                  <i style={{ width: `${(reason.count / insight.closedCount) * 100}%` }} />
                </div>
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
            {insight.recommendations.map((item) => (
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

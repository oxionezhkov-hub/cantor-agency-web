import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown, ChartNoAxesCombined, History } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ads } from "./data.ts";
import type { CrmState } from "./crm.ts";
import type { buildAnalytics } from "./analytics-model.ts";
import { leadProgress, STAGE_LABELS, type LeadStage } from "./lead-workflow.ts";
import { DialogInsights, LtvEconomics } from "./AnalyticsInsights.tsx";
import "./analytics-reports.css";
type Report = ReturnType<typeof buildAnalytics>;
import { rankGroups, type Row, type Metric } from "./analytics-ranking.ts";
const number = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const money = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
const shortDate = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const dayMsk = (s: string) => new Date(Date.parse(s) + 10800000).toISOString().slice(0, 10);
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="an-card an-ranking-card">
      <div className="an-card-title">
        <h2>{title}</h2>
      </div>
      {children}
    </article>
  );
}
function Ranking({
  title,
  rows,
  metric,
  limit = 5,
  available = true,
}: {
  title: string;
  rows: readonly Row[];
  metric: Metric;
  limit?: number;
  available?: boolean;
}) {
  const ranked = available ? rankGroups(rows, metric, limit) : [];
  return (
    <Section title={title}>
      {ranked.length ? (
        <ol className="an-ranking-list">
          {ranked.map((r, i) => (
            <li key={r.name}>
              <span className="an-ranking-number">{i + 1}</span>
              <span className="an-ranking-name" title={r.name}>
                {r.name}
              </span>
              <strong>{metric === "spendRub" ? money(r.value!) : number(r.value!)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="an-inline-empty">Нет данных за выбранный период.</p>
      )}
    </Section>
  );
}
export function AdsReport({ report }: { report: Report }) {
  const available = report.coverage.daysWithData > 0;
  return (
    <>
      <div className="an-grid an-equal an-report-rankings">
        <Ranking
          title="Заголовки · контакты"
          rows={report.byAd}
          metric="contacts"
          available={available}
        />
        <Ranking
          title="Города · контакты"
          rows={report.byCity}
          metric="contacts"
          available={available}
        />
        <Ranking
          title="Заголовки · просмотры"
          rows={report.byAd}
          metric="views"
          available={available}
        />
        <Ranking
          title="Города · просмотры"
          rows={report.byCity}
          metric="views"
          available={available}
        />
      </div>
    </>
  );
}
function CityUnavailable({ onReset }: { onReset: () => void }) {
  return (
    <div className="an-empty">
      <ChartNoAxesCombined size={28} />
      <h2>Оплаты и обращения не привязаны к городу</h2>
      <button type="button" className="an-export" onClick={onReset}>
        Показать все города <ArrowUpRight size={15} />
      </button>
    </div>
  );
}
export function DialogReport({
  report,
  crm,
  selectedLeads,
  now,
  onResetCity,
}: {
  report: Report;
  crm: CrmState;
  selectedLeads: CrmState["leads"];
  now: number;
  onResetCity: () => void;
}) {
  const c = report.crm;
  if (!c) return <CityUnavailable onReset={onResetCity} />;
  const stages = (Object.keys(STAGE_LABELS) as LeadStage[])
    .map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      count: selectedLeads.filter((l) => leadProgress(crm, l.id, now).stage === stage).length,
    }))
    .filter((stage) => stage.count > 0);
  return (
    <>
      <div className="an-grid an-equal">
        <Section title="Новые обращения по дням">
          <div className="an-plot an-dialog-plot" role="img" aria-label="Обращения по дням">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={c.daily} margin={{ left: -24, right: 8, top: 10 }}>
                <CartesianGrid vertical={false} stroke="#eeece8" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11 }}
                  minTickGap={25}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip labelFormatter={(v) => shortDate(String(v))} />
                <Bar
                  dataKey="leads"
                  name="Обращения"
                  fill="#e8391d"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={26}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Текущие этапы обращений">
          {stages.length ? (
            <ul className="an-report-stages">
              {stages.map((s) => (
                <li key={s.stage}>
                  <span>{s.label}</span>
                  <strong>{s.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="an-inline-empty">Нет обращений за выбранный период.</p>
          )}
        </Section>
      </div>
      <DialogInsights crm={crm} leadIds={selectedLeads.map((l) => l.id)} />
      <details className="an-days an-dialog-history">
        <summary>
          <span>
            <History size={16} />
            История обращений
          </span>
          <span>
            {selectedLeads.length}
            <ChevronDown size={15} />
          </span>
        </summary>
        <div className="an-table-scroll" tabIndex={0} aria-label="История обращений">
          <table className="an-table">
            <thead>
              <tr>
                <th>Обращение</th>
                <th>Создано</th>
                <th>Объявление</th>
                <th>Текущий этап</th>
                <th>Причина отказа</th>
              </tr>
            </thead>
            <tbody>
              {selectedLeads.map((l) => (
                <tr key={l.id}>
                  <th scope="row">
                    <Link to="/" search={{ section: "chats", focus: l.id }}>
                      {l.name}
                      <ArrowUpRight size={13} />
                    </Link>
                  </th>
                  <td>{shortDate(dayMsk(l.createdAt))}</td>
                  <td>{ads.find((a) => a.id === l.adId)?.title ?? "Не определено"}</td>
                  <td>
                    <span className="an-stage-badge">{leadProgress(crm, l.id, now).label}</span>
                  </td>
                  <td>{l.closedAt ? (l.closeReason ?? "Не указана") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!selectedLeads.length ? (
          <p className="an-inline-empty">Обращений за выбранный период нет.</p>
        ) : null}
      </details>
    </>
  );
}
export function EconomyReport({
  report,
  onResetCity,
  payments,
  dailyTable,
}: {
  report: Report;
  onResetCity: () => void;
  payments: ReactNode;
  dailyTable: ReactNode;
}) {
  const c = report.crm,
    t = report.totals,
    available = report.coverage.daysWithData > 0;
  if (!c) return <CityUnavailable onReset={onResetCity} />;
  const safe = (n: number) => (Number.isFinite(n) ? money(n) : "—");
  return (
    <>
      <LtvEconomics report={report} />
      <div className="an-kpis an-kpis-four">
        {[
          { label: "Поступления", value: safe(c.receivedRub) },
          { label: "Возвраты", value: safe(c.refundedRub) },
          { label: "Расход на рекламу", value: available ? safe(t.spendRub) : "—" },
          {
            label: "Остаток до прочих затрат",
            value: report.coverage.complete ? safe(c.netReceivedRub - t.spendRub) : "—",
          },
        ].map((item, i) => (
          <article key={item.label} className={`an-metric ${i === 3 ? "an-metric-accent" : ""}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </div>
      <Section title="Поступления и рекламные расходы">
        <div
          className="an-plot"
          role="img"
          aria-label="Поступления после возвратов и рекламные расходы по дням"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={report.daily.map((day) => {
                const d = c.daily.find((r) => r.date === day.date);
                return {
                  ...day,
                  spendRub: day.available && Number.isFinite(day.spendRub) ? day.spendRub : null,
                  netReceivedRub: d && Number.isFinite(d.netReceivedRub) ? d.netReceivedRub : null,
                };
              })}
              margin={{ top: 10, right: 10, left: -12 }}
            >
              <CartesianGrid vertical={false} stroke="#eeece8" />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11 }}
                minTickGap={25}
              />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v) => money(Number(v))}
                labelFormatter={(v) => shortDate(String(v))}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
              <ReferenceLine y={0} stroke="#d8d3cd" />
              <Bar
                dataKey="netReceivedRub"
                name="После возвратов, ₽"
                fill="#3d6c61"
                radius={[4, 4, 0, 0]}
                maxBarSize={26}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="spendRub"
                name="Реклама, ₽"
                stroke="#e8391d"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <div className="an-grid an-equal an-report-rankings">
        <Ranking
          title="Расходы по заголовкам"
          rows={report.byAd}
          metric="spendRub"
          limit={10}
          available={available}
        />
        <Ranking
          title="Расходы по городам"
          rows={report.byCity}
          metric="spendRub"
          limit={10}
          available={available}
        />
      </div>
      {payments}
      {dailyTable}
    </>
  );
}

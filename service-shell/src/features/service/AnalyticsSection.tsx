import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, CircleHelp, TrendingUp } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ads } from "./data.ts";
import { useDemoCrm } from "./demo-crm-store.ts";
import { leadProgress } from "./lead-workflow.ts";
import { ANALYTICS_COVERAGE, adFilterLabel, adMatchesFilter, analyticsDates, buildAnalytics } from "./analytics-model.ts";
import { PaymentsSection } from "./crm-ui.tsx";
import { ANALYTICS_TABS, analyticsTabFromFocus } from "./analytics-navigation.ts";
import { AnalyticsToolbar } from "./AnalyticsToolbar.tsx";
import { AdsReport, DialogReport, EconomyReport } from "./AnalyticsReports.tsx";
import { getPreviewData } from "./preview-data.ts";
import "./analytics.css";

const COLORS = ["#e8391d", "#3d6c61", "#d9aa61", "#8175a0", "#7395ae", "#b8b2a7", "#59606b"];
type Report = ReturnType<typeof buildAnalytics>;
const integer = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) : "—";
const rub = (n: number | null) =>
  n === null || !Number.isFinite(n)
    ? "—"
    : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
const pct = (n: number | null) =>
  n === null || !Number.isFinite(n)
    ? "—"
    : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const mskDay = (date: string) =>
  new Date(Date.parse(date) + 3 * 3600000).toISOString().slice(0, 10);
function Chart({
  title,
  action,
  children,
  wide = false,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`an-card ${wide ? "an-wide" : ""}`}>
      <div className="an-card-title">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </article>
  );
}
function Metric({
  label,
  value,
  hint,
  hintTitle,
  previous,
  current,
  compare,
  positive = true,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
  hintTitle?: string;
  previous?: number | null;
  current?: number | null;
  compare?: boolean;
  positive?: boolean;
  accent?: boolean;
}) {
  const change =
    previous && current !== undefined && current !== null
      ? ((current - previous) / previous) * 100
      : null;
  return (
    <article className={`an-metric ${accent ? "an-metric-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <div>
        {compare && change !== null ? (
          <small className={change >= 0 === positive ? "an-good" : "an-bad"}>
            {change > 0 ? "+" : ""}
            {pct(change)} <span>к прошлому периоду</span>
          </small>
        ) : (
          <small title={hintTitle}>{hint}</small>
        )}
      </div>
    </article>
  );
}
function CountTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly {
    name?: string;
    value?: number | string;
    color?: string;
    dataKey?: string | number;
  }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="an-tooltip">
      <strong>
        {typeof label === "string" && /^\d{4}-/.test(label) ? shortDate(label) : label}
      </strong>
      {payload.map((p, i) => (
        <div key={i}>
          <i style={{ background: p.color }} />
          <span>{p.name}</span>
          <b>
            {String(p.dataKey).toLowerCase().includes("rub")
              ? rub(Number(p.value))
              : integer(Number(p.value))}
          </b>
        </div>
      ))}
    </div>
  );
}
function TrafficChart({
  daily,
  metric,
}: {
  daily: Report["daily"];
  metric: "views" | "shows" | "contacts" | "all";
}) {
  const all = metric === "all";
  const names = { shows: "Показы", views: "Просмотры", contacts: "Контакты" };
  const keys = all ? (["shows", "views", "contacts"] as const) : [metric];
  const colorIndex = { shows: 0, views: 1, contacts: 2 };
  return (
    <div
      className="an-plot"
      role="img"
      aria-label={all ? "Показы, просмотры и контакты по дням" : `${names[metric]} по дням`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={daily.map((d) => ({
            ...d,
            shows: d.available ? d.shows : null,
            views: d.available ? d.views : null,
            contacts: d.available ? d.contacts : null,
          }))}
          margin={{ top: 10, right: all ? 5 : 12, left: -20, bottom: 0 }}
        >
          <defs>
            {COLORS.slice(0, 3).map((color, index) => (
              <linearGradient
                key={color}
                id={`analytics-traffic-fill-${index}`}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={color} stopOpacity={0.01} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="#eeece8" />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tickLine={false}
            axisLine={false}
            minTickGap={25}
            tick={{ fill: "#716c65", fontSize: 11 }}
          />
          <YAxis
            yAxisId="main"
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tick={{ fill: "#716c65", fontSize: 11 }}
          />
          {all ? (
            <YAxis
              yAxisId="engagement"
              orientation="right"
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={34}
              tick={{ fill: "#3d6c61", fontSize: 11 }}
            />
          ) : null}
          <Tooltip content={<CountTooltip />} />
          {keys.map((key) => (
            <Area
              key={key}
              type="monotone"
              yAxisId={all && key !== "shows" ? "engagement" : "main"}
              dataKey={key}
              name={names[key]}
              stroke={COLORS[colorIndex[key]]}
              strokeWidth={2.3}
              fill={`url(#analytics-traffic-fill-${colorIndex[key]})`}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
function saveCsv(rows: (string | number | null)[][], filename: string) {
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (value) =>
              `"${(typeof value === "string" && /^[=+@\-\t\r]/.test(value) ? "'" + value : String(typeof value === "number" && !Number.isFinite(value) ? "" : (value ?? ""))).replaceAll('"', '""')}"`,
          )
          .join(";"),
      )
      .join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const reportHeader = [
  "Название",
  "Показы",
  "Просмотры",
  "Контакты",
  "CTR, %",
  "Просмотр → контакт, %",
  "Расход, ₽",
  "Цена контакта, ₽",
];

export function AnalyticsSection({ focus }: { focus?: string }) {
  const { state: crm } = useDemoCrm();
  const tab = analyticsTabFromFocus(focus);
  const [from, setFrom] = useState(ANALYTICS_COVERAGE.from),
    [to, setTo] = useState(ANALYTICS_COVERAGE.to);
  const [adId, setAdId] = useState(""),
    [city, setCity] = useState("");
  const [metric, setMetric] = useState<"views" | "shows" | "contacts" | "all">("all");
  const [exported, setExported] = useState(false);
  const invalid = useMemo(() => {
    try {
      analyticsDates({ from, to });
      return false;
    } catch {
      return true;
    }
  }, [from, to]);
  const report = useMemo(
    () =>
      buildAnalytics({
        from: invalid ? ANALYTICS_COVERAGE.from : from,
        to: invalid ? ANALYTICS_COVERAGE.to : to,
        adId: adId || undefined,
        city: city || undefined,
        crm,
      }),
    [from, to, adId, city, crm, invalid],
  );
  const t = report.totals,
    c = report.crm,
    hasTraffic = report.coverage.daysWithData > 0;
  const mInt = (n: number) => (hasTraffic ? integer(n) : "—"),
    mRub = (n: number | null) => (hasTraffic ? rub(n) : "—"),
    mPct = (n: number | null) => (hasTraffic ? pct(n) : "—");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const selectedLeads = crm.leads.filter(
    (l) =>
      !invalid &&
      mskDay(l.createdAt) >= from &&
      mskDay(l.createdAt) <= to &&
      adMatchesFilter(l.adId, adId),
  );
  const reset = () => {
    setFrom(ANALYTICS_COVERAGE.from);
    setTo(ANALYTICS_COVERAGE.to);
    setAdId("");
    setCity("");
  };
  const exportReport = () => {
    const meta: (string | number | null)[][] = [
      ["Отчёт Cantor", ANALYTICS_TABS.find((t) => t.id === tab)!.label],
      ["Период, МСК", from, to],
      ["Объявление", adFilterLabel(adId)],
      ["Город размещения", city || "Все"],
      [
        "Источник рекламы",
        getPreviewData()
          ? "Защищённый срез статистики Авито"
          : "Пример дневной статистики; не выгрузка Авито",
      ],
      ["Источник CRM", getPreviewData() ? "Защищённый срез кабинета" : "Локальные записи браузера"],
      [],
    ];
    let rows: (string | number | null)[][];
    if (tab === "dialogs")
      rows = c
        ? [
            ["Обращение", "Создано, МСК", "Объявление", "Текущий этап", "Причина отказа"],
            ...selectedLeads.map((l) => [
              l.name,
              mskDay(l.createdAt),
              ads.find((a) => a.id === l.adId)?.title ?? "Не определено",
              leadProgress(crm, l.id, now).label,
              l.closedAt ? (l.closeReason ?? "Не указана") : "",
            ]),
          ]
        : [["Недоступно", "Выберите все города"]];
    else if (tab === "economy")
      rows = [
        [
          "Дата, МСК",
          "Получено, ₽",
          "Возвращено, ₽",
          "После возвратов, ₽",
          "Расход на рекламу, ₽",
          "Остаток до прочих затрат, ₽",
          "Новые платящие ученики",
        ],
        ...report.daily.map((d) => {
          const day = c?.daily.find((r) => r.date === d.date);
          return [
            d.date,
            day?.receivedRub ?? null,
            day?.refundedRub ?? null,
            day?.netReceivedRub ?? null,
            d.available ? d.spendRub : null,
            d.available && day ? day.netReceivedRub - d.spendRub : null,
            day?.newStudents ?? null,
          ];
        }),
      ];
    else
      rows = [
        [
          "Дата, МСК",
          "Реклама доступна",
          ...reportHeader.slice(1),
          "Обращения CRM",
          "Проведено диагностик",
          "Новые платящие ученики",
          "После возвратов, ₽",
          "Цена показа, ₽",
          "Цена просмотра, ₽",
        ],
        ...report.daily.map((d) => {
          const day = c?.daily.find((r) => r.date === d.date);
          return [
            d.date,
            d.available ? "Да" : "Нет",
            ...[d.shows, d.views, d.contacts, d.ctr, d.contactRate, d.spendRub, d.cpl].map((v) =>
              d.available ? v : null,
            ),
            day?.leads ?? null,
            day?.completedAppointments ?? null,
            day?.newStudents ?? null,
            day?.netReceivedRub ?? null,
            d.available && d.shows ? d.spendRub / d.shows : null,
            d.available ? d.cpc : null,
          ];
        }),
      ];
    saveCsv([...meta, ...rows], `cantor-${tab}-${from}-${to}.csv`);
    setExported(true);
    window.setTimeout(() => setExported(false), 3000);
  };
  return (
    <div className="analytics">
      <AnalyticsToolbar
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        adId={adId}
        onAdChange={setAdId}
        city={city}
        onCityChange={setCity}
        onReset={reset}
        onExport={exportReport}
        invalid={invalid}
        dirty={!!(adId || city || from !== ANALYTICS_COVERAGE.from || to !== ANALYTICS_COVERAGE.to)}
      />
      <span className="sr-only" role="status">
        {exported ? "CSV скачан" : ""}
      </span>
      {invalid ? (
        <div className="an-empty" role="alert">
          <CalendarDays size={28} />
          <h2>Проверьте даты</h2>
          <p>Выберите период от 1 до 366 дней.</p>
        </div>
      ) : (
        <section className="an-report" data-comment-anchor={`analytics-${tab}`} aria-label={ANALYTICS_TABS.find((item) => item.id === tab)?.label}>
          {!report.coverage.complete ? (
            <div className="an-notice">
              <CircleHelp size={17} />
              <p>
                {hasTraffic
                  ? "Рекламные данные есть только за часть периода."
                  : "За выбранные даты рекламных данных нет."}
              </p>
            </div>
          ) : null}
          {tab === "overview" ? (
            <>
              <div className="an-kpis">
                <Metric
                  label="Расход на рекламу"
                  value={mRub(t.spendRub)}
                  hint={`Окупаемость по поступлениям: ${pct(report.coverage.complete && c && t.spendRub > 0 && Number.isFinite(c.netReceivedRub) ? (c.netReceivedRub / t.spendRub) * 100 : null)}`}
                />
                <Metric
                  label="Показы"
                  value={mInt(t.shows)}
                  hint={t.shows > 0 ? `${mRub(t.spendRub / t.shows)} за показ` : ""}
                />
                <Metric
                  label="Просмотры"
                  value={mInt(t.views)}
                  hint={`CTR ${mPct(t.ctr)} · ${mRub(t.cpc)} за просмотр`}
                />
                <Metric
                  label="Контакты"
                  value={mInt(t.contacts)}
                  hint={`${mPct(t.contactRate)} от просмотров · ${mRub(t.cpl)} за контакт`}
                  accent
                />
                <Metric
                  label="Диагностики"
                  hintTitle="Соотношение диагностик и контактов за период; события не обязательно относятся к одним людям. Стоимость: расходы периода на одну диагностику."
                  value={c ? integer(c.completedAppointments) : "—"}
                  hint={`${pct(report.coverage.complete && c && Number.isFinite(c.completedAppointments) && t.contacts > 0 ? (c.completedAppointments / t.contacts) * 100 : null)} за период · ${mRub(report.coverage.complete && c && c.completedAppointments > 0 ? t.spendRub / c.completedAppointments : null)}`}
                />
                <Metric
                  label="Продажи"
                  hintTitle="Соотношение продаж и диагностик за период; события не обязательно относятся к одним людям. Стоимость: расходы периода на одну продажу."
                  value={c ? integer(c.newStudents) : "—"}
                  hint={`${pct(report.coverage.complete && c && Number.isFinite(c.newStudents) && c.completedAppointments > 0 ? (c.newStudents / c.completedAppointments) * 100 : null)} за период · ${mRub(report.coverage.complete && c && c.newStudents > 0 ? t.spendRub / c.newStudents : null)}`}
                />
              </div>
              <Chart
                title="Как меняется интерес"
                wide
                action={
                  <div className="an-chart-switch" aria-label="Показатель графика">
                    {(["all", "shows", "views", "contacts"] as const).map((key) => (
                      <button
                        type="button"
                        aria-pressed={metric === key}
                        className={metric === key ? "active" : ""}
                        key={key}
                        onClick={() => setMetric(key)}
                      >
                        {key === "all"
                          ? "Все"
                          : key === "shows"
                            ? "Показы"
                            : key === "views"
                              ? "Просмотры"
                              : "Контакты"}
                      </button>
                    ))}
                  </div>
                }
              >
                <TrafficChart daily={report.daily} metric={metric} />
              </Chart>
              <AdsReport report={report} />
              <DayTable report={report} />
            </>
          ) : null}
          {tab === "dialogs" ? (
            <DialogReport
              report={report}
              crm={crm}
              selectedLeads={selectedLeads}
              now={now}
              onResetCity={() => setCity("")}
            />
          ) : null}
          {tab === "economy" ? (
            <EconomyReport
              report={report}
              onResetCity={() => setCity("")}
              payments={<PaymentsSection focus={focus} />}
              dailyTable={<DayTable report={report} economy />}
            />
          ) : null}
        </section>
      )}
    </div>
  );
}
function DayTable({ report, economy = false }: { report: Report; economy?: boolean }) {
  return (
    <details className="an-days">
      <summary>
        <span>
          <TrendingUp size={16} />
          {economy ? "Денежный отчёт по дням" : "Все показатели по дням"}
        </span>
        <span>
          {report.daily.length} дней
          <ChevronDown size={15} />
        </span>
      </summary>
      <div className="an-table-scroll" tabIndex={0} aria-label="Показатели по дням">
        <table className="an-table an-daily-table">
          <thead>
            <tr>
              <th>Дата</th>
              {economy ? (
                <>
                  <th>Получено</th>
                  <th>Возвраты</th>
                  <th>После возвратов</th>
                  <th>Реклама</th>
                  <th>До прочих затрат</th>
                </>
              ) : (
                <>
                  <th>Показы</th>
                  <th>Просмотры</th>
                  <th>Контакты</th>
                  <th>CTR</th>
                  <th>В контакт</th>
                  <th>Цена показа</th>
                  <th>Цена просмотра</th>
                  <th>Цена контакта</th>
                  <th>Расход</th>
                  <th>Обращения CRM</th>
                  <th>Диагностики</th>
                  <th>Новые ученики</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {report.daily.map((d) => {
              const c = report.crm?.daily.find((r) => r.date === d.date);
              return (
                <tr key={d.date}>
                  <th scope="row">{shortDate(d.date)}</th>
                  {economy ? (
                    <>
                      <td>{c ? rub(c.receivedRub) : "—"}</td>
                      <td>{c ? rub(c.refundedRub) : "—"}</td>
                      <td>{c ? rub(c.netReceivedRub) : "—"}</td>
                      <td>{d.available ? rub(d.spendRub) : "—"}</td>
                      <td>{d.available && c ? rub(c.netReceivedRub - d.spendRub) : "—"}</td>
                    </>
                  ) : (
                    <>
                      <td>{d.available ? integer(d.shows) : "—"}</td>
                      <td>{d.available ? integer(d.views) : "—"}</td>
                      <td>{d.available ? integer(d.contacts) : "—"}</td>
                      <td>{d.available ? pct(d.ctr) : "—"}</td>
                      <td>{d.available ? pct(d.contactRate) : "—"}</td>
                      <td>{d.available && d.shows ? rub(d.spendRub / d.shows) : "—"}</td>
                      <td>{d.available ? rub(d.cpc) : "—"}</td>
                      <td>{d.available ? rub(d.cpl) : "—"}</td>
                      <td>{d.available ? rub(d.spendRub) : "—"}</td>
                      <td>{c?.leads ?? "—"}</td>
                      <td>{c ? integer(c.completedAppointments) : "—"}</td>
                      <td>{c ? integer(c.newStudents) : "—"}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

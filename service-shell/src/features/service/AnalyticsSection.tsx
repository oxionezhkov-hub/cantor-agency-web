import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownUp,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  Search,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ads } from "./data.ts";
import { useDemoCrm } from "./demo-crm-store.ts";
import { leadProgress, STAGE_LABELS, type LeadStage } from "./lead-workflow.ts";
import {
  ANALYTICS_COVERAGE,
  analyticsDates,
  buildAnalytics,
  marketingTotals,
} from "./analytics-model.ts";
import { PaymentsSection } from "./crm-ui.tsx";
import { AnalyticsToolbar } from "./AnalyticsToolbar.tsx";
import { LtvEconomics, DialogInsights } from "./AnalyticsInsights.tsx";
import "./analytics.css";

const COLORS = ["#e8391d", "#3d6c61", "#d9aa61", "#8175a0", "#7395ae", "#b8b2a7", "#59606b"];
const TABS = [
  { id: "overview", label: "Обзор" },
  { id: "ads", label: "Объявления" },
  { id: "dialogs", label: "Диалоги" },
  { id: "economy", label: "Экономика" },
] as const;
type Tab = (typeof TABS)[number]["id"];
type Report = ReturnType<typeof buildAnalytics>;
type Marketing = Report["totals"];
type SortKey = "views" | "contacts" | "spendRub" | "contactRate" | "cpl";
const integer = (n: number) => Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) : "—";
const rub = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
const pct = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
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
  previous,
  current,
  compare,
  positive = true,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
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
          <small>{hint}</small>
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
            <linearGradient id="analytics-traffic-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#e8391d" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#e8391d" stopOpacity={0.01} />
            </linearGradient>
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
          {all ? (
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
          ) : null}
          {keys.map((key, i) =>
            all ? (
              <Line
                key={key}
                type="linear"
                yAxisId={key === "shows" ? "main" : "engagement"}
                dataKey={key}
                name={`${names[key]} · ${key === "shows" ? "левая" : "правая"} шкала`}
                stroke={COLORS[i]}
                strokeWidth={2.3}
                dot={false}
                isAnimationActive={false}
              />
            ) : (
              <Area
                key={key}
                yAxisId="main"
                type="monotone"
                dataKey={key}
                name={names[key]}
                stroke="#e8391d"
                strokeWidth={2.5}
                fill="url(#analytics-traffic-fill)"
                isAnimationActive={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
function MarketingTable({
  rows,
  label,
  available = true,
}: {
  rows: Report["byAd"];
  label: string;
  available?: boolean;
}) {
  return (
    <div className="an-table-scroll" tabIndex={0} aria-label={label}>
      <table className="an-table">
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col">Показы</th>
            <th scope="col">Просмотры</th>
            <th scope="col">Контакты</th>
            <th scope="col">CTR</th>
            <th scope="col">В контакт</th>
            <th scope="col">Расход</th>
            <th scope="col">Цена контакта</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.name}</th>
              <td>{available ? integer(row.shows) : "—"}</td>
              <td>{available ? integer(row.views) : "—"}</td>
              <td>{available ? integer(row.contacts) : "—"}</td>
              <td>{available ? pct(row.ctr) : "—"}</td>
              <td>{available ? pct(row.contactRate) : "—"}</td>
              <td>{available ? rub(row.spendRub) : "—"}</td>
              <td>{available ? rub(row.cpl) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Funnel({ totals }: { totals: Marketing }) {
  const rows = [
    {
      label: "Показы",
      count: totals.shows,
      rate: null,
      cost: totals.shows ? totals.spendRub / totals.shows : null,
    },
    { label: "Просмотры", count: totals.views, rate: totals.ctr, cost: totals.cpc },
    { label: "Контакты", count: totals.contacts, rate: totals.contactRate, cost: totals.cpl },
  ];
  return (
    <div className="an-funnel">
      {rows.map((row, i) => (
        <div className="an-funnel-step" key={row.label}>
          <div>
            <span>{row.label}</span>
            <strong>{integer(row.count)}</strong>
          </div>
          <div className="an-funnel-track">
            <i
              style={{
                width: `${totals.shows && row.count ? (row.count / totals.shows) * 100 : 0}%`,
                background: COLORS[i],
              }}
            />
          </div>
          <small>
            {i ? <>{pct(row.rate)} · </> : null}
            {rub(row.cost)} / {i === 0 ? "показ" : i === 1 ? "просмотр" : "контакт"}
          </small>
        </div>
      ))}
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
              `"${(typeof value === "string" && /^[=+@\-\t\r]/.test(value) ? "'" + value : String(value ?? "")).replaceAll('"', '""')}"`,
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
const reportRows = (rows: Report["byAd"]) =>
  rows.map((r) => [r.name, r.shows, r.views, r.contacts, r.ctr, r.contactRate, r.spendRub, r.cpl]);
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
  const [tab, setTab] = useState<Tab>(focus ? "economy" : "overview");
  useEffect(() => {
    if (focus) setTab("economy");
  }, [focus]);
  const [from, setFrom] = useState(ANALYTICS_COVERAGE.from),
    [to, setTo] = useState(ANALYTICS_COVERAGE.to);
  const [adId, setAdId] = useState(""),
    [city, setCity] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("spendRub"),
    [descending, setDescending] = useState(true);
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
      (!adId || l.adId === adId),
  );
  const stages = (Object.keys(STAGE_LABELS) as LeadStage[]).map((stage) => ({
    name: STAGE_LABELS[stage],
    value: selectedLeads.filter((l) => leadProgress(crm, l.id, now).stage === stage).length,
  }));
  const filteredAds = report.byAd
    .filter((r) =>
      r.name.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU")),
    )
    .sort((a, b) =>
      a[sort] === null
        ? b[sort] === null
          ? 0
          : 1
        : b[sort] === null
          ? -1
          : (a[sort]! - b[sort]!) * (descending ? -1 : 1),
    );
  const shownTotals = marketingTotals(
    filteredAds.map((row) => ({ ...row, date: "", adId: row.id, city: "" })),
  );
  const comparable = report.coverage.complete && report.previousCoverage.complete;
  const reset = () => {
    setFrom(ANALYTICS_COVERAGE.from);
    setTo(ANALYTICS_COVERAGE.to);
    setAdId("");
    setCity("");
    setQuery("");
  };
  const chooseSort = (key: SortKey) => {
    if (sort === key) setDescending((v) => !v);
    else {
      setSort(key);
      setDescending(true);
    }
  };
  const exportReport = () => {
    const meta: (string | number | null)[][] = [
      ["Отчёт Cantor", TABS.find((t) => t.id === tab)!.label],
      ["Период, МСК", from, to],
      ["Объявление", ads.find((a) => a.id === adId)?.title ?? "Все"],
      ["Город размещения", city || "Все"],
      ["Источник рекламы", "Пример дневной статистики; не выгрузка Авито"],
      ["Источник CRM", "Локальные записи браузера"],
      [],
    ];
    let rows: (string | number | null)[][];
    if (tab === "ads") {
      const ids = new Set(filteredAds.map((a) => a.id));
      rows = [
        reportHeader,
        ...reportRows(filteredAds).map((row) =>
          hasTraffic ? row : row.map((v, i) => (i ? null : v)),
        ),
        [],
        ["По объявлениям и городам"],
        reportHeader,
        ...reportRows(report.byAdCity.filter((row) => ids.has(row.adId))).map((row) =>
          hasTraffic ? row : row.map((v, i) => (i ? null : v)),
        ),
      ];
    } else if (tab === "dialogs")
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
        dirty={
          !!(
            adId ||
            city ||
            query ||
            from !== ANALYTICS_COVERAGE.from ||
            to !== ANALYTICS_COVERAGE.to
          )
        }
      />
      <div className="an-tabs" role="tablist" aria-label="Отчёты аналитики">
        {TABS.map((item, index) => (
          <button
            type="button"
            role="tab"
            id={`an-tab-${item.id}`}
            aria-controls={`an-panel-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            key={item.id}
            onClick={() => setTab(item.id)}
            onKeyDown={(e) => {
              if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? TABS.length - 1
                      : (index + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
                setTab(TABS[next].id);
                document.getElementById(`an-tab-${TABS[next].id}`)?.focus();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
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
        <div role="tabpanel" id={`an-panel-${tab}`} aria-labelledby={`an-tab-${tab}`}>
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
                  label="Просмотры"
                  value={mInt(t.views)}
                  hint={`${mInt(t.shows)} показов · CTR ${mPct(t.ctr)}`}
                  previous={report.previousTotals.views}
                  current={t.views}
                  compare={comparable}
                />
                <Metric
                  label="Контакты"
                  value={mInt(t.contacts)}
                  hint={`${mPct(t.contactRate)} от просмотров`}
                  previous={report.previousTotals.contacts}
                  current={t.contacts}
                  compare={comparable}
                  accent
                />
                <Metric
                  label="Цена контакта"
                  value={mRub(t.cpl)}
                  hint="Расход ÷ контакты"
                  previous={report.previousTotals.cpl}
                  current={t.cpl}
                  compare={comparable}
                  positive={false}
                />
                <Metric
                  label="Расход на рекламу"
                  value={mRub(t.spendRub)}
                  hint={`${mRub(t.cpc)} за просмотр`}
                />
                <Metric
                  label="Новые платящие ученики"
                  value={c ? integer(c.newStudents) : "—"}
                  hint="Первая активная оплата"
                />
                <Metric
                  label="Получено после возвратов"
                  value={c ? rub(c.netReceivedRub) : "—"}
                  hint="Поступления − возвраты"
                />
              </div>
              <div className="an-grid">
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
                            : key === "views"
                              ? "Просмотры"
                              : key === "shows"
                                ? "Показы"
                                : "Контакты"}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <TrafficChart daily={report.daily} metric={metric} />
                </Chart>
                <Chart title="Воронка рекламы">
                  {hasTraffic ? (
                    <Funnel totals={t} />
                  ) : (
                    <p className="an-inline-empty">Нет данных</p>
                  )}
                </Chart>
              </div>
              <div className="an-grid an-equal">
                <Chart title="Какие объявления приводят контакты">
                  <div className="an-rank-list">
                    {[...report.byAd]
                      .sort((a, b) => b.contacts - a.contacts)
                      .map((a, i) => (
                        <Link
                          key={a.id}
                          to="/"
                          search={{ section: "ads", focus: a.id }}
                          className="an-rank-row"
                        >
                          <div>
                            <strong>{a.name}</strong>
                            <div className="an-rank-track">
                              <i
                                style={{
                                  width: `${t.contacts ? (a.contacts / t.contacts) * 100 : 0}%`,
                                  background: COLORS[i],
                                }}
                              />
                            </div>
                            <small>
                              {mRub(a.spendRub)} расход · {mRub(a.cpl)} / контакт
                            </small>
                          </div>
                          <b>
                            {mInt(a.contacts)}
                            <ArrowUpRight size={14} />
                          </b>
                        </Link>
                      ))}
                  </div>
                </Chart>
                <Chart title="От обращения к первой оплате">
                  {c ? (
                    <>
                      <div className="an-crm-events">
                        <div>
                          <span>Обращения</span>
                          <strong>{c.leads}</strong>
                        </div>
                        <div>
                          <span>Проведено диагностик</span>
                          <strong>{integer(c.completedAppointments)}</strong>
                        </div>
                        <div>
                          <span>Новые платящие ученики</span>
                          <strong>{integer(c.newStudents)}</strong>
                        </div>
                      </div>
                      <button
                        className="an-text-button"
                        onClick={() => setTab("dialogs")}
                        type="button"
                      >
                        Посмотреть обращения
                        <ArrowUpRight size={15} />
                      </button>
                    </>
                  ) : (
                    <UnavailableCity onReset={() => setCity("")} />
                  )}
                </Chart>
              </div>
              <DayTable report={report} />
            </>
          ) : null}
          {tab === "ads" ? (
            <>
              <div className="an-kpis an-kpis-four">
                <Metric
                  label="Расход"
                  value={mRub(t.spendRub)}
                  hint={`${report.byAd.filter((a) => a.shows > 0).length} активных объявлений`}
                />
                <Metric label="Просмотры" value={mInt(t.views)} hint={`CTR ${mPct(t.ctr)}`} />
                <Metric
                  label="Контакты"
                  value={mInt(t.contacts)}
                  hint={`${mPct(t.contactRate)} от просмотров`}
                  accent
                />
                <Metric label="Цена контакта" value={mRub(t.cpl)} hint="Расход ÷ контакты" />
              </div>
              <article className="an-card an-report-table">
                <div className="an-card-title an-table-toolbar">
                  <h2>Сводка по объявлениям</h2>
                  <label className="an-search">
                    <Search size={15} />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Найти объявление"
                      aria-label="Найти объявление в отчёте"
                    />
                  </label>
                </div>
                <div className="an-table-scroll" tabIndex={0} aria-label="Эффективность объявлений">
                  <table className="an-table an-ad-table">
                    <thead>
                      <tr>
                        <th>Объявление</th>
                        <th>Показы</th>
                        <th>CTR</th>
                        {(
                          [
                            { key: "views", label: "Просмотры" },
                            { key: "contacts", label: "Контакты" },
                            { key: "contactRate", label: "В контакт" },
                            { key: "spendRub", label: "Расход" },
                            { key: "cpl", label: "Цена контакта" },
                          ] as const
                        ).map((item) => (
                          <th
                            key={item.key}
                            aria-sort={
                              sort === item.key ? (descending ? "descending" : "ascending") : "none"
                            }
                          >
                            <button type="button" onClick={() => chooseSort(item.key)}>
                              {item.label}
                              <ArrowDownUp size={12} />
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAds.map((a) => (
                        <tr key={a.id}>
                          <th scope="row">
                            <Link to="/" search={{ section: "ads", focus: a.id }}>
                              {a.name}
                              <ArrowUpRight size={13} />
                            </Link>
                          </th>
                          <td>{mInt(a.shows)}</td>
                          <td>{mPct(a.ctr)}</td>
                          <td>{mInt(a.views)}</td>
                          <td>
                            <b>{mInt(a.contacts)}</b>
                          </td>
                          <td>{mPct(a.contactRate)}</td>
                          <td>{mRub(a.spendRub)}</td>
                          <td>{mRub(a.cpl)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Итого по строкам</th>
                        <td>{mInt(shownTotals.shows)}</td>
                        <td>{mPct(shownTotals.ctr)}</td>
                        <td>{mInt(shownTotals.views)}</td>
                        <td>{mInt(shownTotals.contacts)}</td>
                        <td>{mPct(shownTotals.contactRate)}</td>
                        <td>{mRub(shownTotals.spendRub)}</td>
                        <td>{mRub(shownTotals.cpl)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {!filteredAds.length ? (
                  <p className="an-inline-empty">Объявления не найдены.</p>
                ) : null}
              </article>
              <div className="an-grid an-equal">
                <Chart title="Контакты по объявлениям">
                  <HorizontalBars
                    rows={hasTraffic ? report.byAd : []}
                    field="contacts"
                    name="Контакты"
                  />
                </Chart>
                <Chart title="Цена контакта по объявлениям">
                  <HorizontalBars
                    rows={hasTraffic ? report.byAd.filter((a) => a.cpl !== null) : []}
                    field="cpl"
                    name="Цена контакта, ₽"
                  />
                </Chart>
              </div>
              <Chart title="Объявления по городам">
                <MarketingTable
                  rows={report.byAdCity.filter((r) => filteredAds.some((a) => a.id === r.adId))}
                  label="Объявление · город"
                  available={hasTraffic}
                />
              </Chart>
              <div className="an-grid an-equal">
                <Chart title="Контакты по городам">
                  <HorizontalBars
                    rows={hasTraffic ? report.byCity : []}
                    field="contacts"
                    name="Контакты"
                  />
                </Chart>
                <Chart title="Сводка по городам">
                  <MarketingTable rows={report.byCity} label="Город" available={hasTraffic} />
                </Chart>
              </div>
            </>
          ) : null}
          {tab === "dialogs" ? (
            c ? (
              <>
                <div className="an-kpis an-kpis-four">
                  <Metric label="Новые обращения" value={integer(c.leads)} hint="" accent />
                  <Metric
                    label="Записей на диагностику"
                    value={integer(c.bookedAppointments)}
                    hint=""
                  />
                  <Metric
                    label="Диагностик проведено"
                    value={integer(c.completedAppointments)}
                    hint=""
                  />
                  <Metric label="Новых платящих учеников" value={integer(c.newStudents)} hint="" />
                </div>
                <div className="an-grid an-equal">
                  <Chart title="Новые обращения по дням">
                    <div className="an-plot" role="img" aria-label="Обращения CRM по дням">
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
                          <Tooltip content={<CountTooltip />} />
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
                  </Chart>
                  <Chart title="Текущие этапы обращений">
                    <div className="an-stage-list">
                      {stages.map((s, i) => (
                        <div key={s.name}>
                          <span>{s.name}</span>
                          <div>
                            <i
                              style={{
                                width: `${selectedLeads.length ? (s.value / selectedLeads.length) * 100 : 0}%`,
                                background: COLORS[i],
                              }}
                            />
                          </div>
                          <b>{s.value}</b>
                        </div>
                      ))}
                    </div>
                  </Chart>
                </div>
                <DialogInsights crm={crm} leadIds={selectedLeads.map((l) => l.id)} />
                <Chart title="Обращения выбранного периода">
                  <div className="an-table-scroll" tabIndex={0} aria-label="Обращения CRM">
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
                            <td>{shortDate(mskDay(l.createdAt))}</td>
                            <td>{ads.find((a) => a.id === l.adId)?.title ?? "Не определено"}</td>
                            <td>
                              <span className="an-stage-badge">
                                {leadProgress(crm, l.id, now).label}
                              </span>
                            </td>
                            <td>{l.closedAt ? (l.closeReason ?? "Не указана") : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!selectedLeads.length ? (
                    <p className="an-inline-empty">Новых обращений нет.</p>
                  ) : null}
                </Chart>
              </>
            ) : (
              <UnavailableCity onReset={() => setCity("")} />
            )
          ) : null}
          {tab === "economy" ? (
            c ? (
              <>
                <LtvEconomics report={report} />
                <div className="an-kpis an-kpis-four">
                  <Metric label="Поступления" value={rub(c.receivedRub)} hint="" />
                  <Metric label="Возвраты" value={rub(c.refundedRub)} hint="" />
                  <Metric label="Расход на рекламу" value={mRub(t.spendRub)} hint="" />
                  <Metric
                    label="Остаток до прочих затрат"
                    value={report.coverage.complete ? rub(c.netReceivedRub - t.spendRub) : "—"}
                    hint=""
                    accent
                  />
                </div>
                <div className="an-grid">
                  <Chart title="Поступления и рекламные расходы" wide>
                    <div
                      className="an-plot"
                      role="img"
                      aria-label="Поступления после возвратов и рекламный расход по дням"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={report.daily.map((d) => ({
                            ...d,
                            spendRub: d.available ? d.spendRub : null,
                            netReceivedRub:
                              c.daily.find((r) => r.date === d.date)?.netReceivedRub ?? 0,
                          }))}
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
                          <Tooltip content={<CountTooltip />} />
                          <Legend
                            iconType="circle"
                            wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                          />
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
                  </Chart>
                  <Chart title="Распределение рекламного бюджета">
                    {t.spendRub ? (
                      <>
                        <div className="an-donut">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={report.byAd.filter((a) => a.spendRub > 0)}
                                dataKey="spendRub"
                                nameKey="name"
                                innerRadius={58}
                                outerRadius={83}
                                paddingAngle={3}
                                stroke="none"
                                isAnimationActive={false}
                              >
                                {report.byAd
                                  .filter((a) => a.spendRub > 0)
                                  .map((a, i) => (
                                    <Cell key={a.id} fill={COLORS[i]} />
                                  ))}
                              </Pie>
                              <Tooltip formatter={(v) => rub(Number(v))} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="an-donut-center">
                            <strong>{mRub(t.spendRub)}</strong>
                          </div>
                        </div>
                        <div className="an-donut-legend">
                          {report.byAd
                            .filter((a) => a.spendRub > 0)
                            .map((a, i) => (
                              <div key={a.id}>
                                <i style={{ background: COLORS[i] }} />
                                <span>{a.name}</span>
                                <b>{pct((a.spendRub / t.spendRub) * 100)}</b>
                              </div>
                            ))}
                        </div>
                      </>
                    ) : (
                      <p className="an-inline-empty">
                        {hasTraffic ? "Расходов нет." : "Нет данных."}
                      </p>
                    )}
                  </Chart>
                </div>
                <DayTable report={report} economy />
                <PaymentsSection focus={focus} />
              </>
            ) : (
              <UnavailableCity onReset={() => setCity("")} />
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
function UnavailableCity({ onReset }: { onReset: () => void }) {
  return (
    <div className="an-empty">
      <ChartNoAxesCombined size={28} />
      <h2>Оплаты и обращения не привязаны к городу</h2>
      <button type="button" className="an-export" onClick={onReset}>
        Показать все города
        <ArrowUpRight size={15} />
      </button>
    </div>
  );
}
function HorizontalBars({
  rows,
  field,
  name,
}: {
  rows: Report["byAd"];
  field: "contacts" | "cpl";
  name: string;
}) {
  if (!rows.length) return <p className="an-inline-empty">Нет данных</p>;
  return (
    <div className="an-plot an-horizontal-plot" role="img" aria-label={name}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={rows.map((r) => ({
            ...r,
            name: r.name.length > 20 ? r.name.slice(0, 18) + "…" : r.name,
          }))}
          margin={{ left: 0, right: 24, top: 15, bottom: 10 }}
        >
          <CartesianGrid horizontal={false} stroke="#eeece8" />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            allowDecimals={field !== "contacts"}
          />
          <YAxis
            dataKey="name"
            type="category"
            axisLine={false}
            tickLine={false}
            width={125}
            tick={{ fontSize: 11, fill: "#716c65" }}
          />
          <Tooltip formatter={(v) => (field === "cpl" ? rub(Number(v)) : integer(Number(v)))} />
          <Bar
            dataKey={field}
            name={name}
            radius={[0, 5, 5, 0]}
            barSize={24}
            isAnimationActive={false}
          >
            {rows.map((r, i) => (
              <Cell key={r.id} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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

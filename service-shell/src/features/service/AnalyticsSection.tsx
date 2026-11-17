import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  RotateCcw,
  Search,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
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
  ANALYTICS_CITIES,
  ANALYTICS_COVERAGE,
  analyticsDates,
  buildAnalytics,
} from "./analytics-model.ts";
import { PaymentsSection } from "./crm-ui.tsx";
import "./analytics.css";

const COLORS = ["#e8391d", "#3d6c61", "#d9aa61", "#8175a0", "#7395ae", "#b8b2a7", "#59606b"];
const TABS = [
  { id: "overview", label: "Обзор" },
  { id: "ads", label: "Объявления" },
  { id: "dialogs", label: "Диалоги" },
  { id: "cities", label: "Города" },
  { id: "economy", label: "Экономика" },
] as const;
type Tab = (typeof TABS)[number]["id"];
type Report = ReturnType<typeof buildAnalytics>;
type Marketing = Report["totals"];
type SortKey = "views" | "contacts" | "spendRub" | "contactRate" | "cpl";
const integer = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const rub = (n: number | null) =>
  n === null ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
const pct = (n: number | null) =>
  n === null ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const addDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const mskDay = (date: string) =>
  new Date(Date.parse(date) + 3 * 3600000).toISOString().slice(0, 10);
function Chart({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`an-card ${wide ? "an-wide" : ""}`}>
      <div className="an-card-title">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
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
  metric: "views" | "shows" | "contacts";
}) {
  const name = metric === "views" ? "Просмотры" : metric === "shows" ? "Показы" : "Контакты";
  return (
    <div
      className="an-plot"
      role="img"
      aria-label={`${name} по дням. Точные значения доступны в таблице по дням и CSV.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={daily.map((d) => ({ ...d, [metric]: d.available ? d[metric] : null }))}
          margin={{ top: 10, right: 10, left: -24, bottom: 0 }}
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
            tick={{ fill: "#817a72", fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tick={{ fill: "#817a72", fontSize: 11 }}
          />
          <Tooltip content={<CountTooltip />} />
          <Area
            type="monotone"
            dataKey={metric}
            name={name}
            stroke="#e8391d"
            strokeWidth={2.5}
            fill="url(#analytics-traffic-fill)"
            isAnimationActive={false}
            activeDot={{ r: 5, stroke: "white", strokeWidth: 3 }}
          />
        </AreaChart>
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
    { label: "Показы", count: totals.shows, rate: null },
    { label: "Просмотры", count: totals.views, rate: totals.ctr },
    { label: "Контакты", count: totals.contacts, rate: totals.contactRate },
  ];
  return (
    <div className="an-funnel">
      {rows.map((row, index) => (
        <div className="an-funnel-step" key={row.label}>
          <div>
            <span>
              <i style={{ background: COLORS[index] }} />
              {row.label}
            </span>
            <strong>{integer(row.count)}</strong>
          </div>
          <div className="an-funnel-track">
            <i
              style={{
                width: `${totals.shows && row.count > 0 ? Math.max(2, (row.count / totals.shows) * 100) : 0}%`,
                background: COLORS[index],
              }}
            />
          </div>
          <small>
            {index === 0
              ? "Вся рекламная выдача"
              : `${pct(row.rate)} ${index === 1 ? "от показов" : "от просмотров"}`}
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
  const [from, setFrom] = useState(ANALYTICS_COVERAGE.from);
  const [to, setTo] = useState(ANALYTICS_COVERAGE.to);
  const [adId, setAdId] = useState("");
  const [city, setCity] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("spendRub");
  const [descending, setDescending] = useState(true);
  const [metric, setMetric] = useState<"views" | "shows" | "contacts">("views");
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
    c = report.crm;
  const hasTraffic = report.coverage.daysWithData > 0;
  const mInt = (n: number) => (hasTraffic ? integer(n) : "—");
  const mRub = (n: number | null) => (hasTraffic ? rub(n) : "—");
  const mPct = (n: number | null) => (hasTraffic ? pct(n) : "—");
  const [now] = useState(() => Date.now());
  const selectedLeads = crm.leads.filter(
    (lead) =>
      !invalid &&
      mskDay(lead.createdAt) >= from &&
      mskDay(lead.createdAt) <= to &&
      (!adId || lead.adId === adId),
  );
  const stages = (Object.keys(STAGE_LABELS) as LeadStage[]).map((stage) => ({
    name: STAGE_LABELS[stage],
    value: selectedLeads.filter((lead) => leadProgress(crm, lead.id, now).stage === stage).length,
  }));
  const filteredAds = report.byAd
    .filter((r) =>
      r.name.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU")),
    )
    .sort((a, b) => {
      const av = a[sort],
        bv = b[sort];
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (av - bv) * (descending ? -1 : 1);
    });
  const comparable = report.previousCoverage.complete && report.coverage.complete;
  const spendDistribution = report.byAd
    .filter((a) => a.spendRub > 0)
    .map((a) => ({ name: a.name, value: a.spendRub }));
  const reset = () => {
    setFrom(ANALYTICS_COVERAGE.from);
    setTo(ANALYTICS_COVERAGE.to);
    setAdId("");
    setCity("");
    setQuery("");
  };
  const chooseSort = (key: SortKey) => {
    if (sort === key) setDescending((value) => !value);
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
    if (tab === "ads")
      rows = [
        reportHeader,
        ...reportRows(filteredAds).map((row) =>
          hasTraffic ? row : row.map((v, i) => (i === 0 ? v : null)),
        ),
      ];
    else if (tab === "cities")
      rows = [
        reportHeader,
        ...reportRows(report.byCity).map((row) =>
          hasTraffic ? row : row.map((v, i) => (i === 0 ? v : null)),
        ),
      ];
    else if (tab === "dialogs")
      rows = c
        ? [
            ["Обращение", "Создано, МСК", "Объявление", "Текущий этап"],
            ...selectedLeads.map((l) => [
              l.name,
              mskDay(l.createdAt),
              ads.find((a) => a.id === l.adId)?.title ?? "Не определено",
              leadProgress(crm, l.id, now).label,
            ]),
          ]
        : [["Недоступно", "В CRM нет города обращения; сбросьте фильтр города"]];
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
          const day = c?.daily.find((row) => row.date === d.date);
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
        ],
        ...report.daily.map((d) => {
          const day = c?.daily.find((row) => row.date === d.date);
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
          ];
        }),
      ];
    saveCsv([...meta, ...rows], `cantor-${tab}-${from}-${to}.csv`);
    setExported(true);
    window.setTimeout(() => setExported(false), 3000);
  };
  return (
    <div className="analytics">
      <div className="an-toolbar">
        <div className="an-date-control">
          <CalendarDays size={17} aria-hidden="true" />
          <label>
            <span className="sr-only">Начало периода</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <span className="an-date-dash">—</span>
          <label>
            <span className="sr-only">Конец периода</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <span className="an-timezone">МСК</span>
        </div>
        <div className="an-presets">
          <button
            type="button"
            className={
              from === ANALYTICS_COVERAGE.from && to === ANALYTICS_COVERAGE.to ? "selected" : ""
            }
            onClick={() => {
              setFrom(ANALYTICS_COVERAGE.from);
              setTo(ANALYTICS_COVERAGE.to);
            }}
          >
            Ноябрь
          </button>
          <button
            type="button"
            className={
              from === addDay(ANALYTICS_COVERAGE.to, -6) && to === ANALYTICS_COVERAGE.to
                ? "selected"
                : ""
            }
            onClick={() => {
              setFrom(addDay(ANALYTICS_COVERAGE.to, -6));
              setTo(ANALYTICS_COVERAGE.to);
            }}
          >
            7 дней
          </button>
        </div>
        <button type="button" className="an-export" disabled={invalid} onClick={exportReport}>
          <ArrowDownToLine size={16} />
          Скачать CSV
        </button>
      </div>
      <div className="an-filterbar">
        <label>
          <span>Объявление</span>
          <select
            aria-label="Фильтр по объявлению"
            value={adId}
            onChange={(e) => setAdId(e.target.value)}
          >
            <option value="">Все объявления</option>
            {ads.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Город размещения</span>
          <select
            aria-label="Фильтр по городу"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            <option value="">Все города</option>
            {ANALYTICS_CITIES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        {adId || city || from !== ANALYTICS_COVERAGE.from || to !== ANALYTICS_COVERAGE.to ? (
          <button type="button" className="an-reset" onClick={reset}>
            <RotateCcw size={14} />
            Сбросить
          </button>
        ) : null}
        <span className="an-data-date">Рекламный срез: 1–16 ноября 2026</span>
      </div>
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
          <p>Начало должно быть не позже конца. Максимальный период — 366 дней.</p>
        </div>
      ) : (
        <div role="tabpanel" id={`an-panel-${tab}`} aria-labelledby={`an-tab-${tab}`}>
          {!report.coverage.complete ? (
            <div className="an-notice">
              <CircleHelp size={17} />
              <p>
                {report.coverage.daysWithData === 0
                  ? "За выбранные даты рекламной статистики нет."
                  : "Рекламная статистика покрывает только часть периода."}{" "}
                Доступный срез: 1–16 ноября 2026. Пропуски на графиках не считаются нулём.
              </p>
            </div>
          ) : null}
          {city ? (
            <div className="an-notice">
              <CircleHelp size={17} />
              <p>
                Выбран город размещения «{city}». Диалоги, диагностики и оплаты по городам не
                распределены — для этих отчётов выберите все города.
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
                  hint="Первая активная оплата на конец периода"
                />
                <Metric
                  label="Получено после возвратов"
                  value={c ? rub(c.netReceivedRub) : "—"}
                  hint="Поступления − возвраты периода"
                />
              </div>
              <div className="an-grid">
                <Chart title="Как меняется интерес" subtitle="Дневная статистика рекламы" wide>
                  <div className="an-chart-switch" aria-label="Показатель графика">
                    {(["views", "shows", "contacts"] as const).map((key) => (
                      <button
                        type="button"
                        aria-pressed={metric === key}
                        className={metric === key ? "active" : ""}
                        key={key}
                        onClick={() => setMetric(key)}
                      >
                        {key === "views" ? "Просмотры" : key === "shows" ? "Показы" : "Контакты"}
                      </button>
                    ))}
                  </div>
                  <TrafficChart daily={report.daily} metric={metric} />
                  <p className="an-chart-note">
                    Наведение показывает день. Все значения — в таблице ниже.
                  </p>
                </Chart>
                <Chart title="Воронка рекламы" subtitle="Каждый следующий шаг — доля предыдущего">
                  {hasTraffic ? (
                    <Funnel totals={t} />
                  ) : (
                    <p className="an-inline-empty">Нет рекламных данных за выбранный период.</p>
                  )}
                  <div className="an-card-callout">
                    {t.contacts ? (
                      <>
                        Один контакт обходится в <strong>{mRub(t.cpl)}</strong>. Контакт Авито и
                        обращение CRM — разные события.
                      </>
                    ) : (
                      "Контактов за выбранный период нет. Стоимость контакта не рассчитывается."
                    )}
                  </div>
                </Chart>
              </div>
              <div className="an-grid an-equal">
                <Chart
                  title="Какие объявления приводят контакты"
                  subtitle="Количество контактов и расход за выбранный период"
                >
                  <div className="an-rank-list">
                    {report.byAd.map((a, i) => (
                      <Link
                        key={a.id}
                        to="/"
                        search={{ section: "ads", focus: a.id }}
                        className="an-rank-row"
                      >
                        <span className="an-rank-index">0{i + 1}</span>
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
                <Chart
                  title="От обращения к первой оплате"
                  subtitle="События CRM в выбранные даты, без сквозной атрибуции"
                >
                  {c ? (
                    <>
                      <div className="an-crm-events">
                        <div>
                          <span>Обращения</span>
                          <strong>{c.leads}</strong>
                        </div>
                        <div>
                          <span>Проведено диагностик</span>
                          <strong>{c.completedAppointments}</strong>
                        </div>
                        <div>
                          <span>Новые платящие ученики</span>
                          <strong>{c.newStudents}</strong>
                        </div>
                      </div>
                      <p className="an-chart-note">
                        Диагностика и оплата могут относиться к обращениям прошлого периода. Процент
                        перехода между этими числами не рассчитывается.
                      </p>
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
                  label="Объявлений в срезе"
                  value={String(report.byAd.length)}
                  hint={`${report.byAd.filter((a) => a.shows > 0).length} получали показы`}
                />
                <Metric
                  label="Контакты"
                  value={mInt(t.contacts)}
                  hint={`${mPct(t.contactRate)} от просмотров`}
                  accent
                />
                <Metric
                  label="Цена контакта"
                  value={mRub(t.cpl)}
                  hint="Общий расход ÷ все контакты"
                />
                <Metric label="Расход" value={mRub(t.spendRub)} hint="За выбранный период" />
              </div>
              <div className="an-grid an-equal">
                <Chart title="Контакты по объявлениям" subtitle="Где сосредоточен спрос">
                  <HorizontalBars
                    rows={hasTraffic ? report.byAd : []}
                    field="contacts"
                    name="Контакты"
                  />
                </Chart>
                <Chart
                  title="Цена контакта по объявлениям"
                  subtitle="Меньше — дешевле; без контактов нет значения"
                >
                  <HorizontalBars
                    rows={hasTraffic ? report.byAd.filter((a) => a.cpl !== null) : []}
                    field="cpl"
                    name="Цена контакта, ₽"
                  />
                </Chart>
              </div>
              <article className="an-card an-report-table">
                <div className="an-card-title an-table-toolbar">
                  <div>
                    <h2>Эффективность каждого объявления</h2>
                    <p>Нажмите на заголовок, чтобы изменить сортировку</p>
                  </div>
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
                            <small>
                              {mInt(a.shows)} показов · CTR {mPct(a.ctr)}
                            </small>
                          </th>
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
                  </table>
                </div>
                {!filteredAds.length ? (
                  <p className="an-inline-empty">По этому запросу объявлений нет.</p>
                ) : null}
                <p className="an-chart-note">
                  Цена контакта считается по суммарному расходу и контактам, а не как среднее цен
                  строк. Объявления без активности остаются в отчёте.
                </p>
              </article>
            </>
          ) : null}
          {tab === "dialogs" ? (
            c ? (
              <>
                <div className="an-kpis an-kpis-four">
                  <Metric
                    label="Новые обращения CRM"
                    value={integer(c.leads)}
                    hint="По дате создания обращения"
                    accent
                  />
                  <Metric
                    label="Записей на диагностику"
                    value={integer(c.bookedAppointments)}
                    hint="Запланированные встречи периода"
                  />
                  <Metric
                    label="Диагностик проведено"
                    value={integer(c.completedAppointments)}
                    hint="По дате отметки о проведении"
                  />
                  <Metric
                    label="Новых платящих учеников"
                    value={integer(c.newStudents)}
                    hint="По первой активной оплате на конец периода"
                  />
                </div>
                <div className="an-grid an-equal">
                  <Chart title="Новые обращения по дням" subtitle="CRM, по дате создания">
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
                  <Chart
                    title="Где сейчас новые обращения"
                    subtitle="Текущие этапы обращений, созданных в выбранный период"
                  >
                    <div className="an-stage-list">
                      {stages.map((s, i) => (
                        <div key={s.name}>
                          <span>
                            <i style={{ background: COLORS[i] }} />
                            {s.name}
                          </span>
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
                    <p className="an-chart-note">
                      Этапы обновляются при работе с обращением. Это состояние сейчас, а не
                      исторический снимок на конец периода.
                    </p>
                  </Chart>
                </div>
                <article className="an-card">
                  <div className="an-card-title">
                    <h2>Обращения выбранного периода</h2>
                    <p>Перейдите в диалог, чтобы продолжить работу</p>
                  </div>
                  <div className="an-table-scroll" tabIndex={0} aria-label="Обращения CRM">
                    <table className="an-table">
                      <thead>
                        <tr>
                          <th>Обращение</th>
                          <th>Создано, МСК</th>
                          <th>Объявление</th>
                          <th>Текущий этап</th>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!selectedLeads.length ? (
                    <p className="an-inline-empty">Новых обращений за выбранный период нет.</p>
                  ) : null}
                  <p className="an-chart-note">
                    Скорость ответа и число сообщений не рассчитываются: в текущих переписках нет
                    временных меток сообщений.
                  </p>
                </article>
              </>
            ) : (
              <UnavailableCity onReset={() => setCity("")} />
            )
          ) : null}
          {tab === "cities" ? (
            <>
              <div className="an-kpis an-kpis-four">
                <Metric
                  label="Города размещения"
                  value={String(report.byCity.length)}
                  hint="География рекламных показов"
                />
                <Metric label="Просмотры" value={mInt(t.views)} hint={`CTR ${mPct(t.ctr)}`} />
                <Metric
                  label="Контакты"
                  value={mInt(t.contacts)}
                  hint={`${mPct(t.contactRate)} от просмотров`}
                  accent
                />
                <Metric
                  label="Цена контакта"
                  value={mRub(t.cpl)}
                  hint={`${mRub(t.spendRub)} общий расход`}
                />
              </div>
              <div className="an-grid an-equal">
                <Chart title="Контакты по географии" subtitle="Город размещения объявления">
                  <HorizontalBars
                    rows={hasTraffic ? report.byCity : []}
                    field="contacts"
                    name="Контакты"
                  />
                </Chart>
                <Chart
                  title="Стоимость привлечения контакта"
                  subtitle="Расход города ÷ контакты города"
                >
                  <HorizontalBars
                    rows={hasTraffic ? report.byCity.filter((a) => a.cpl !== null) : []}
                    field="cpl"
                    name="Цена контакта, ₽"
                  />
                </Chart>
              </div>
              <article className="an-card">
                <div className="an-card-title">
                  <h2>Сравнение городов</h2>
                  <p>Полный рекламный путь от показов до контакта</p>
                </div>
                <MarketingTable
                  rows={report.byCity}
                  label="Город размещения"
                  available={hasTraffic}
                />
                <p className="an-chart-note">
                  «Область» — отдельная зона размещения. Город размещения не определяет место
                  проживания ученика. Оплаты и выручка к городам не привязаны.
                </p>
              </article>
            </>
          ) : null}
          {tab === "economy" ? (
            c ? (
              <>
                <div className="an-kpis an-kpis-four">
                  <Metric
                    label="Поступления"
                    value={rub(c.receivedRub)}
                    hint="Все оплаты выбранного периода"
                  />
                  <Metric label="Возвраты" value={rub(c.refundedRub)} hint="По дате возврата" />
                  <Metric
                    label="Расход на рекламу"
                    value={mRub(t.spendRub)}
                    hint="Рекламный срез выбранных дат"
                  />
                  <Metric
                    label="Остаток до прочих затрат"
                    value={report.coverage.complete ? rub(c.netReceivedRub - t.spendRub) : "—"}
                    hint="Оплаты − возвраты − реклама"
                    accent
                  />
                </div>
                <div className="an-notice an-economy-note">
                  <CircleHelp size={17} />
                  <p>
                    Остаток не является прибылью: налоги, подписка, стоимость занятий и другие
                    расходы здесь не учтены. Оплаты периода могут приходить от учеников,
                    привлечённых раньше.
                  </p>
                </div>
                <div className="an-grid">
                  <Chart
                    title="Поступления и рекламные расходы"
                    subtitle="Движение денег по дням, ₽"
                    wide
                  >
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
                              c.daily.find((row) => row.date === d.date)?.netReceivedRub ?? 0,
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
                  <Chart
                    title="Куда уходит рекламный бюджет"
                    subtitle="Доля расходов по объявлениям"
                  >
                    {t.spendRub ? (
                      <>
                        <div
                          className="an-donut"
                          role="img"
                          aria-label="Распределение рекламного расхода по объявлениям"
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={spendDistribution}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={58}
                                outerRadius={83}
                                paddingAngle={3}
                                stroke="none"
                                isAnimationActive={false}
                              >
                                {spendDistribution.map((r, i) => (
                                  <Cell key={r.name} fill={COLORS[i % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => rub(Number(value))} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="an-donut-center">
                            <small>Реклама</small>
                            <strong>{mRub(t.spendRub)}</strong>
                          </div>
                        </div>
                        <div className="an-donut-legend">
                          {spendDistribution.map((r, i) => (
                            <div key={r.name}>
                              <i style={{ background: COLORS[i] }} />
                              <span>{r.name}</span>
                              <b>{pct((r.value / t.spendRub) * 100)}</b>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="an-inline-empty">
                        {hasTraffic
                          ? "Расходов за выбранный период нет."
                          : "Рекламных данных за выбранный период нет."}
                      </p>
                    )}
                  </Chart>
                </div>
                <div className="an-economy-bottom">
                  <article className="an-card">
                    <div className="an-card-title">
                      <h2>Что стоит результат</h2>
                      <p>Отношение событий одного периода</p>
                    </div>
                    <dl className="an-costs">
                      <div>
                        <dt>
                          Один рекламный контакт<small>Расход ÷ контакты Авито</small>
                        </dt>
                        <dd>{mRub(t.cpl)}</dd>
                      </div>
                      <div>
                        <dt>
                          Одна проведённая диагностика
                          <small>Расход ÷ проведённые встречи периода</small>
                        </dt>
                        <dd>
                          {rub(
                            c.completedAppointments && report.coverage.complete
                              ? t.spendRub / c.completedAppointments
                              : null,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          Один новый платящий ученик
                          <small>Расход ÷ новые платящие ученики периода</small>
                        </dt>
                        <dd>
                          {rub(
                            c.newStudents && report.coverage.complete
                              ? t.spendRub / c.newStudents
                              : null,
                          )}
                        </dd>
                      </div>
                    </dl>
                    <p className="an-chart-note">
                      Это ориентиры периода. Они не доказывают стоимость привлечения конкретного
                      ученика и не являются когортным CAC.
                    </p>
                  </article>
                  <article className="an-card">
                    <div className="an-card-title">
                      <h2>Состав денежного результата</h2>
                      <p>Все суммы за выбранные даты</p>
                    </div>
                    <dl className="an-costs">
                      <div>
                        <dt>Получено</dt>
                        <dd>{rub(c.receivedRub)}</dd>
                      </div>
                      <div>
                        <dt>Возвращено</dt>
                        <dd>− {rub(c.refundedRub)}</dd>
                      </div>
                      <div>
                        <dt>После возвратов</dt>
                        <dd>{rub(c.netReceivedRub)}</dd>
                      </div>
                      <div>
                        <dt>Реклама</dt>
                        <dd>− {report.coverage.daysWithData > 0 ? mRub(t.spendRub) : "—"}</dd>
                      </div>
                      <div className="an-cost-total">
                        <dt>До прочих затрат</dt>
                        <dd>
                          {report.coverage.complete ? rub(c.netReceivedRub - t.spendRub) : "—"}
                        </dd>
                      </div>
                    </dl>
                  </article>
                </div>
                <DayTable report={report} economy />
                <details className="an-days an-payment-entry" open={focus ? true : undefined}>
                  <summary>
                    <span>Учёт оплат</span>
                    <ChevronDown size={15} />
                  </summary>
                  <PaymentsSection focus={focus} />
                </details>
              </>
            ) : (
              <UnavailableCity onReset={() => setCity("")} />
            )
          ) : null}
          <details className="an-method">
            <summary>
              <CircleHelp size={15} />
              <span>Источники и методика расчёта</span>
              <ChevronDown size={15} />
            </summary>
            <div>
              <p>
                Рекламные графики используют пример дневной статистики за 1–16 ноября 2026: 1 660
                показов, 318 просмотров, 29 контактов и 6 420 ₽ расхода. Дневное распределение и
                города — подготовленный пример, не данные подключённого Авито. Обращения, встречи,
                оплаты и возвраты берутся из локальной CRM этого браузера и обновляются при работе с
                ней.
              </p>
              <p>
                CTR = просмотры ÷ показы; конверсия в контакт = контакты ÷ просмотры; цена просмотра
                = расход ÷ просмотры; цена контакта = расход ÷ контакты. При нулевом знаменателе —
                «—». Все даты включены, часовой пояс — Москва. Рекламная статистика вне доступного
                среза отсутствует.
              </p>
              <p>
                Обращение считается по дате создания; проведённая диагностика — по дате отметки о
                проведении; новый платящий ученик — по первой оплате с невозвращённым остатком на
                конец периода. Поступления и возвраты учитываются по собственным датам. При выборе
                объявления CRM ограничена известной связью с ним; записи без связи в этот срез не
                входят. При выборе города CRM-показатели недоступны.
              </p>
              <p>
                {comparable
                  ? `Сравнение с равным по длине периодом: ${shortDate(report.previousRange.from)}–${shortDate(report.previousRange.to)}.`
                  : "Сравнение с предыдущим периодом скрыто: нет полного рекламного покрытия за равный по длине предыдущий период. Отсутствие данных не считается нулём."}
              </p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
function UnavailableCity({ onReset }: { onReset: () => void }) {
  return (
    <div className="an-empty">
      <ChartNoAxesCombined size={28} />
      <h2>Для этого отчёта нужен общий срез</h2>
      <p>
        В CRM пока нет привязки к городу размещения. Выберите все города, чтобы увидеть обращения и
        оплаты.
      </p>
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
  if (!rows.length)
    return <p className="an-inline-empty">Нет данных для расчёта за выбранный период.</p>;
  return (
    <div
      className="an-plot an-horizontal-plot"
      role="img"
      aria-label={`${name}. Точные значения в таблице отчёта.`}
    >
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
          <Tooltip
            formatter={(value) => (field === "cpl" ? rub(Number(value)) : integer(Number(value)))}
          />
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
        <table className="an-table">
          <thead>
            <tr>
              <th>Дата, МСК</th>
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
                  <th>Расход</th>
                  <th>Обращения CRM</th>
                  <th>Диагностики</th>
                  <th>Новые платящие ученики</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {report.daily.map((d) => {
              const c = report.crm?.daily.find((row) => row.date === d.date);
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
                      <td>{d.available ? rub(d.spendRub) : "—"}</td>
                      <td>{c?.leads ?? "—"}</td>
                      <td>{c?.completedAppointments ?? "—"}</td>
                      <td>{c?.newStudents ?? "—"}</td>
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

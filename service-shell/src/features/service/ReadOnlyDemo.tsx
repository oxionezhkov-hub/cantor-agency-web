import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  ChartNoAxesCombined,
  LayoutDashboard,
  LockKeyhole,
  MessageSquare,
  PanelTop,
  Settings2,
} from "lucide-react";
import { SECTIONS, type SectionId } from "./sections";
import { ServiceDatePicker } from "./service-controls";
import "./read-only-demo.css";

const Knowledge = lazy(() =>
  import("@/features/knowledge/KnowledgeSection").then((m) => ({ default: m.KnowledgeSection })),
);
type Daily = {
  date: string;
  budget: number;
  views: number;
  contacts: number;
  diagnostics: number;
  sales: number;
  updatedAt: string;
};
type Ad = {
  id: string;
  title: string;
  city: string;
  price: number | null;
  status: string;
  url: string;
  description: string | null;
};
type Chat = {
  id: string;
  name: string;
  city?: string;
  itemTitle?: string;
  lastAt: number;
  lastText?: string;
  lastAuthor?: string;
  messageCount?: number;
};
type Message = { id: string; at: number; author: string; type: string; text: string };
export type DemoSnapshot = {
  mode: "read-only";
  tutor: string;
  subject: string;
  readAt: string;
  catalogAt: number | null;
  chatsAt: number | null;
  ads: Ad[];
  daily: Daily[];
  chats: Chat[];
};
const icons = {
  today: LayoutDashboard,
  stats: ChartNoAxesCombined,
  ads: PanelTop,
  chats: MessageSquare,
  learn: BookOpen,
  acc: Settings2,
};
const number = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const rub = (n: number | null) => (n == null ? "Нет данных" : `${number(n)} ₽`);
const date = (value: string | number | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "не указана";
const safeAdUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ["www.avito.ru", "avito.ru"].includes(u.hostname)
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
};
async function getData<T>(path: string, password: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { "x-demo-password": password },
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Нужен пароль панели агентства."
        : "Источник временно недоступен. Попробуйте ещё раз.",
    );
  return response.json();
}
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="ro-card">
      <h2>{title}</h2>
      {children}
    </article>
  );
}
function Metrics({ rows }: { rows: Daily[] }) {
  const total = rows.reduce(
    (s, r) => ({
      budget: s.budget + r.budget,
      views: s.views + r.views,
      contacts: s.contacts + r.contacts,
      diagnostics: s.diagnostics + r.diagnostics,
      sales: s.sales + r.sales,
    }),
    { budget: 0, views: 0, contacts: 0, diagnostics: 0, sales: 0 },
  );
  return (
    <div className="ro-metrics">
      {[
        ["Расход", rub(total.budget)],
        ["Просмотры", number(total.views)],
        ["Контакты", number(total.contacts)],
        ["Диагностики", number(total.diagnostics)],
        ["Продажи", number(total.sales)],
        ["Цена контакта", total.contacts ? rub(total.budget / total.contacts) : "—"],
      ].map(([label, value]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{rows.length ? value : "Нет данных"}</strong>
        </article>
      ))}
    </div>
  );
}
function Analytics({ data }: { data: DemoSnapshot }) {
  const last = data.daily.at(-1)?.date || "2026-11-16";
  const [from, setFrom] = useState(`${last.slice(0, 7)}-01`);
  const [to, setTo] = useState(last);
  const [tab, setTab] = useState("Обзор");
  const rows = data.daily.filter((r) => r.date >= from && r.date <= to);
  const max = Math.max(...rows.map((r) => r.views), 1);
  const expectedDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  return (
    <>
      <h2 className="ro-heading">Аналитика</h2>
      <div className="ro-filters">
        <ServiceDatePicker label="С" value={from} onChange={setFrom} max={to} />
        <ServiceDatePicker label="По" value={to} onChange={setTo} min={from} max={last} />
      </div>
      <div className="ro-tabs" role="tablist" aria-label="Отчёты">
        {["Обзор", "Объявления", "Диалоги", "Экономика"].map((t) => (
          <button role="tab" aria-selected={tab === t} key={t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <p className="ro-source">
        Сохранённые показатели панели агентства · {from} — {to} · дней с данными: {rows.length} из{" "}
        {expectedDays}.{" "}
        {rows.length < expectedDays ? "Отсутствующие дни не считаются нулевыми." : ""}
      </p>
      {tab === "Обзор" || tab === "Экономика" ? <Metrics rows={rows} /> : null}
      {tab === "Обзор" ? (
        <>
          <Card title="Просмотры по дням">
            <div className="ro-chart" aria-label="Просмотры по дням">
              {rows.map((r) => (
                <div key={r.date} title={`${r.date}: ${r.views} просмотров`}>
                  <span style={{ height: `${Math.max((r.views / max) * 140, 2)}px` }} />
                  <small>{r.date.slice(8)}</small>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Дневные показатели">
            <div className="ro-scroll">
              <table className="ro-table">
                <thead>
                  <tr>
                    {["Дата", "Расход", "Просмотры", "Контакты", "Диагностики", "Продажи"].map(
                      (h) => (
                        <th key={h}>{h}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.date}>
                      <th>{r.date}</th>
                      <td>{rub(r.budget)}</td>
                      <td>{r.views}</td>
                      <td>{r.contacts}</td>
                      <td>{r.diagnostics}</td>
                      <td>{r.sales}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
      {tab === "Объявления" ? (
        <Card title="Объявления и города">
          <p>
            В каталоге {data.ads.length} объявлений и {new Set(data.ads.map((a) => a.city)).size}{" "}
            городов. Дневная статистика сохранена по кабинету целиком; распределение расходов и
            контактов по объявлениям недоступно.
          </p>
          <AdList ads={data.ads} compact />
        </Card>
      ) : null}
      {tab === "Диалоги" ? (
        <Card title="Переписки кабинета">
          <p>
            {data.chats.length} сохранённых диалогов. Последняя синхронизация: {date(data.chatsAt)}{" "}
            МСК.
          </p>
          <p>
            Этапы CRM, записи на диагностику и оплаты не подтверждены структурированными данными.
            Они не выводятся из текста переписки автоматически.
          </p>
        </Card>
      ) : null}
      {tab === "Экономика" ? (
        <Card title="Оплаты и LTV">
          <p>
            Расход, диагностики и количество продаж взяты из панели агентства. Суммы оплат, возвраты
            и LTV отсутствуют в подключённом источнике, поэтому выручка, прибыль и ROAS не
            рассчитываются.
          </p>
        </Card>
      ) : null}
    </>
  );
}
function AdList({ ads, compact = false }: { ads: Ad[]; compact?: boolean }) {
  const [query, setQuery] = useState("");
  const visible = ads.filter((a) =>
    `${a.title} ${a.city} ${a.id}`.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")),
  );
  return (
    <>
      <label className="ro-search">
        Поиск по объявлению или городу
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Название, город или ID"
        />
      </label>
      <p className="ro-source">Найдено: {visible.length}</p>
      <div className="ro-ad-list">
        {visible.map((a) => (
          <article key={a.id}>
            <div>
              <strong>{a.title}</strong>
              <p>
                {a.city || "Город не указан"} · {rub(a.price)} · ID {a.id}
              </p>
              <small>
                {(
                  {
                    active: "Активно",
                    closed: "Закрыто",
                    removed: "Снято",
                    blocked: "Заблокировано",
                    rejected: "Отклонено",
                  } as Record<string, string>
                )[a.status] || a.status}
              </small>
            </div>
            {!compact ? (
              <details>
                <summary>Содержание объявления</summary>
                <p className="ro-ad-text">
                  {a.description || "Текст объявления отсутствует в сохранённом источнике."}
                </p>
                {safeAdUrl(a.url) ? (
                  <a href={safeAdUrl(a.url)} target="_blank" rel="noreferrer">
                    Открыть на Авито ↗
                  </a>
                ) : null}
              </details>
            ) : null}
          </article>
        ))}
      </div>
      {!visible.length ? <p>По вашему запросу объявлений нет.</p> : null}
    </>
  );
}
function Dialogs({ data, password }: { data: DemoSnapshot; password: string }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setMessages([]);
    setError("");
    setLoading(true);
    getData<{ messages: Message[] }>(
      `/api/demo/chat?id=${encodeURIComponent(selected.id)}`,
      password,
      controller.signal,
    )
      .then((r) => {
        setMessages(r.messages);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(String(e.message));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [selected, password]);
  const visible = data.chats.filter((c) =>
    `${c.name} ${c.city || ""} ${c.lastText || ""}`
      .toLocaleLowerCase("ru")
      .includes(query.toLocaleLowerCase("ru")),
  );
  return (
    <>
      <h2 className="ro-heading">
        Мои диалоги <small>{data.chats.length}</small>
      </h2>
      <p className="ro-source">
        Сохранённые переписки Авито · синхронизация {date(data.chatsAt)} МСК. Чтение здесь не меняет
        статус прочтения в Авито.
      </p>
      <div className={`ro-dialogs ${selected ? "ro-chat-open" : ""}`}>
        <aside>
          <label className="ro-search">
            Поиск диалога
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Имя, город, сообщение"
            />
          </label>
          <div className="ro-chat-list">
            {visible.map((c) => (
              <button
                key={c.id}
                aria-pressed={selected?.id === c.id}
                onClick={() => setSelected(c)}
              >
                <strong>
                  {c.name || "Собеседник"}
                  <small>{c.city}</small>
                </strong>
                <span>{c.lastText || "Нет текста сообщения"}</span>
              </button>
            ))}
          </div>
          {!visible.length ? <p>Диалоги не найдены.</p> : null}
        </aside>
        <section aria-label="Переписка">
          <button className="ro-back" onClick={() => setSelected(null)}>
            ← Все диалоги
          </button>
          {selected ? (
            <>
              <header>
                <h3>{selected.name}</h3>
                <p>{selected.itemTitle}</p>
              </header>
              {loading ? <p role="status">Загружаем переписку…</p> : null}
              {error ? <p role="alert">{error}</p> : null}
              <div className="ro-messages">
                {messages.map((m, i) => (
                  <article
                    key={m.id || i}
                    className={
                      m.author === "manager"
                        ? "ro-outgoing"
                        : m.author === "system"
                          ? "ro-system"
                          : ""
                    }
                  >
                    <small>
                      {m.author === "manager"
                        ? "Елена"
                        : m.author === "system"
                          ? "Авито"
                          : selected.name}{" "}
                      · {date(m.at)} МСК
                    </small>
                    <p>{m.text || `[${m.type || "вложение"}]`}</p>
                  </article>
                ))}
              </div>
              <p className="ro-locked">
                <LockKeyhole size={16} /> Только чтение. Отправка, редактирование, ИИ и изменения
                CRM отключены.
              </p>
            </>
          ) : (
            <p className="ro-empty">Выберите диалог, чтобы прочитать переписку.</p>
          )}
        </section>
      </div>
    </>
  );
}
export function ReadOnlyDemo({ section, focus }: { section: SectionId; focus?: string }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState("");
  const [data, setData] = useState<DemoSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function unlock() {
    setError("");
    setLoading(true);
    try {
      const next = await getData<DemoSnapshot>("/api/demo/bootstrap", draft);
      setData(next);
      setPassword(draft);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить данные.");
    } finally {
      setLoading(false);
    }
  }
  if (!data)
    return (
      <main className="ro-login">
        <img src="/images/brand/logo.svg" width="72" alt="Cantor" />
        <h1>Кабинет Елены Добрыниной</h1>
        <p>Демо на реальных данных · только чтение</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <label>
            Пароль панели агентства
            <input
              type="password"
              autoComplete="current-password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              required
            />
          </label>
          <button disabled={loading}>{loading ? "Загружаем данные…" : "Открыть демо"}</button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
        <p className="ro-source">Пароль и переписки не сохраняются в хранилище браузера.</p>
      </main>
    );
  const latest = data.daily.at(-1)?.date;
  const month = latest?.slice(0, 7);
  const monthRows = data.daily.filter((r) => r.date.startsWith(month || "—"));
  const selected = SECTIONS.find((s) => s.id === section)!;
  return (
    <div className="service-layout">
      <a className="skip-link" href="#service-content">
        Перейти к содержимому
      </a>
      <aside className="service-sidebar">
        <a href="/?section=today" className="service-brand">
          <img
            className="service-brand-logo"
            src="/images/brand/logo.svg"
            width="48"
            height="30"
            alt=""
          />
          <span>Авито</span>
        </a>
        <div className="workspace-profile">
          <span className="profile-avatar">ЕД</span>
          <div>
            <strong>{data.tutor}</strong>
            <small>{data.subject}</small>
          </div>
        </div>
        <nav className="service-nav" aria-label="Разделы">
          {SECTIONS.map((s) => {
            const Icon = icons[s.id];
            return (
              <button
                key={s.id}
                className={`service-nav-item ${s.id === section ? "active" : ""}`}
                aria-current={s.id === section ? "page" : undefined}
                onClick={() => navigate({ to: "/", search: { section: s.id } })}
              >
                <Icon size={18} />
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <p className="ro-locked">
            <LockKeyhole size={16} /> Только чтение
          </p>
        </div>
      </aside>
      <div className="service-body">
        <main id="service-content" className="service-content" tabIndex={-1}>
          <h1 className="sr-only">{selected.label}</h1>
          <div className="ro-banner">
            <LockKeyhole size={16} />
            <span>Данные Добрыниной · только чтение. Изменения и отправка отключены.</span>
            <button
              className="ro-signout"
              onClick={() => {
                setData(null);
                setPassword("");
              }}
            >
              Выйти из демо
            </button>
          </div>
          <div className={`service-section section-${section}`}>
            {section === "today" ? (
              <>
                <h2 className="ro-heading">Елена Добрынина</h2>
                <p className="ro-source">
                  Показатели за {month || "доступный период"}, по {latest || "—"}. Источник:
                  сохранённые данные панели агентства.
                </p>
                <Metrics rows={monthRows} />
                <div className="ro-grid">
                  <Card title="Объявления">
                    <strong className="ro-large">{data.ads.length}</strong>
                    <p>
                      {new Set(data.ads.map((a) => a.city)).size} городов · каталог от{" "}
                      {date(data.catalogAt)} МСК
                    </p>
                  </Card>
                  <Card title="Диалоги">
                    <strong className="ro-large">{data.chats.length}</strong>
                    <p>Сохранённые переписки · синхронизация {date(data.chatsAt)} МСК</p>
                  </Card>
                  <Card title="Записи и оплаты">
                    <p>
                      Нет подтверждённых данных о расписании, платежах и возвратах. Показатели
                      продаж и диагностик доступны в аналитике как сводные данные панели.
                    </p>
                  </Card>
                  <Card title="База знаний">
                    <p>
                      Общий курс репетитора и практические материалы доступны в разделе «База
                      знаний». Прогресс Добрыниной не подключён.
                    </p>
                  </Card>
                </div>
              </>
            ) : null}
            {section === "stats" ? <Analytics data={data} /> : null}
            {section === "ads" ? (
              <>
                <h2 className="ro-heading">Мои объявления</h2>
                <p className="ro-source">
                  Каталог Авито от {date(data.catalogAt)} МСК. Текст — из сохранённой автозагрузки,
                  он может отличаться от опубликованной версии. Ставки, позиции, публикация и
                  автозагрузка отключены.
                </p>
                <AdList ads={data.ads} />
              </>
            ) : null}
            {section === "chats" ? <Dialogs data={data} password={password} /> : null}
            {section === "learn" ? (
              <>
                <p className="ro-source">
                  Общие материалы для репетитора по русскому языку. Отметки изучения сохраняются
                  только на этом устройстве и не являются прогрессом Добрыниной.
                </p>
                <Suspense fallback={<p role="status">Загружаем базу знаний…</p>}>
                  <Knowledge focus={focus} />
                </Suspense>
              </>
            ) : null}
            {section === "acc" ? (
              <>
                <h2 className="ro-heading">Настройки</h2>
                <Card title="Кабинет">
                  <dl className="ro-settings">
                    <dt>Владелец</dt>
                    <dd>{data.tutor}</dd>
                    <dt>Предмет</dt>
                    <dd>{data.subject}</dd>
                    <dt>Режим доступа</dt>
                    <dd>Только чтение</dd>
                    <dt>Источник</dt>
                    <dd>Сохранённые данные Авито и панели агентства</dd>
                    <dt>Данные прочитаны</dt>
                    <dd>{date(data.readAt)} МСК</dd>
                    <dt>Баланс и подписка</dt>
                    <dd>Не подключены к источнику демо</dd>
                    <dt>Изменение ставок, публикация, сообщения, ИИ</dt>
                    <dd>Отключены на сервере</dd>
                  </dl>
                </Card>
              </>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

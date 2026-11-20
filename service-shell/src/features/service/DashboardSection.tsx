import { LiveFunds } from "./LiveFunds";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, BookOpen, Check, MessageSquare, PanelTop } from "lucide-react";
import { getPreviewData } from "./preview-data.ts";
import { useDemoCrm } from "./demo-crm-store.ts";
import { waitingForReply, reminderDue } from "./communication.ts";
import { leadProgress } from "./lead-workflow.ts";
import { sampleCabinet } from "../cabinet/sample.ts";
import { ads } from "./data.ts";
import { dailyBrief, dayLabel } from "./dashboard-model.ts";
import type { ServiceSearch } from "./sections.ts";
import "./dashboard.css";

const number = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const money = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n) ? "—" : `${number(n)} ₽`;
type Action = {
  id: string;
  title: string;
  detail: string;
  search: ServiceSearch;
  label: string;
  urgent?: boolean;
};

function Jump({ children, search }: { children: React.ReactNode; search: ServiceSearch }) {
  return (
    <Link className="brief-jump" to="/" search={search}>
      {children}
      <ArrowUpRight size={16} />
    </Link>
  );
}

export function DashboardSection() {
  const [now, setNow] = useState(Date.now);
  const { state: crm } = useDemoCrm();
  const snapshot = getPreviewData();
  const brief = dailyBrief(snapshot, now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const [hasStudied] = useState(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("cantor-knowledge-progress-v1") || "[]",
      );
      return Array.isArray(saved) && saved.some((id) => typeof id === "string");
    } catch {
      return false;
    }
  });
  const waiting = crm.leads
    .map((lead) => ({ lead, ...waitingForReply(crm, lead, now) }))
    .filter((row) => row.waiting)
    .sort((a, b) => Date.parse(a.since!) - Date.parse(b.since!));
  const reminders = crm.leads.filter((lead) => reminderDue(crm, lead, now));
  const openLeads = crm.leads.filter((lead) => !lead.closedAt);
  const newLeads = openLeads.filter((lead) => leadProgress(crm, lead.id, now).stage === "new");
  const badAds = snapshot
    ? snapshot.ads.filter((ad) => ["blocked", "rejected"].includes(ad.status))
    : ads.filter((ad) => sampleCabinet.blocks.items.some((item) => item.title === ad.title));
  const activeAds = snapshot
    ? snapshot.ads.filter((ad) => ad.status === "active").length
    : ads.filter((ad) => !badAds.some((bad) => bad.id === ad.id)).length;
  const feedErrors = Math.max(
    snapshot?.feed?.problems.length ?? 0,
    snapshot?.feed?.report?.errors ?? 0,
  );
  const actions: Action[] = [];
  if (waiting.length)
    actions.push({
      id: "reply",
      urgent: true,
      title: `Ответить в диалогах · ${waiting.length}`,
      detail:
        waiting.length > 1
          ? `${waiting[0].lead.name} и другие ждут ответа. Начните с самого раннего обращения.`
          : `${waiting[0].lead.name} ждёт ответа. Откройте последнее сообщение.`,
      search: { section: "chats", focus: waiting[0].lead.id },
      label: "Открыть сообщение",
    });
  if (badAds.length)
    actions.push({
      id: "ads",
      urgent: true,
      title: `Проверить объявления · ${badAds.length}`,
      detail: "Есть блокировки или отклонения. Откройте карточку и проверьте причину.",
      search: { section: "ads", focus: badAds[0].id },
      label: "Проверить",
    });
  if (feedErrors)
    actions.push({
      id: "feed",
      urgent: true,
      title: `Разобрать ошибки автозагрузки · ${feedErrors}`,
      detail: snapshot?.feed?.problems[0]?.msg || "В последнем отчёте автозагрузки есть ошибки.",
      search: { section: "ads", focus: "feeds" },
      label: "К автозагрузке",
    });
  const metrics = [
    {
      label: "Расход на продвижение",
      value: money(brief.current?.spendRub),
      delta: null,
      note: "за один день",
    },
    {
      label: "Просмотры",
      value: number(brief.current?.views),
      delta: brief.current && brief.previous ? brief.current.views - brief.previous.views : null,
      note: "интерес к объявлениям",
    },
    {
      label: "Контакты",
      value: number(brief.current?.contacts),
      delta:
        brief.current && brief.previous ? brief.current.contacts - brief.previous.contacts : null,
      note: "обращения с Авито",
    },
    {
      label: "Стоимость контакта",
      value: money(
        brief.current && brief.current.contacts > 0
          ? brief.current.spendRub / brief.current.contacts
          : undefined,
      ),
      delta: null,
      note: brief.current?.contacts === 0 ? "за день не было контактов" : "расход / контакты",
    },
  ];
  return (
    <div className="daily-brief">
      <LiveFunds />
      <section className="brief-promotion" aria-label="Сводка продвижения">
        <div className="brief-section-heading">
          <div>
            <h2>
              {brief.day === brief.yesterday
                ? "Результаты за вчера"
                : brief.day
                  ? `Результаты за ${dayLabel(brief.day)}`
                  : "Статистика пока недоступна"}
            </h2>
          </div>
          <Jump search={{ section: "stats" }}>Вся аналитика</Jump>
        </div>
        <div className="brief-metrics">
          {metrics.map((metric) => (
            <article key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <p>
                {metric.delta !== null ? (
                  <>
                    <b className={metric.delta > 0 ? "brief-positive" : ""}>
                      {metric.delta > 0 ? "+" : ""}
                      {number(metric.delta)}
                    </b>{" "}
                    к предыдущему дню
                  </>
                ) : (
                  metric.note
                )}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="brief-attention" aria-label="Приоритетные действия">
        <div className="brief-section-heading">
          <div>
            <h2>С чего начать сегодня</h2>
            <p>
              {actions.length
                ? "То, что сейчас требует вашего внимания"
                : "По доступным данным срочных действий нет"}
            </p>
          </div>
        </div>
        {actions.length ? (
          <div className="brief-actions">
            {actions.slice(0, 3).map((action, i) => (
              <Link key={action.id} to="/" search={action.search} className="brief-action">
                <span className={`brief-action-number ${action.urgent ? "attention" : ""}`}>
                  {i + 1}
                </span>
                <span className="brief-action-copy">
                  <strong>{action.title}</strong>
                  <span>{action.detail}</span>
                </span>
                <span className="brief-action-cta">
                  {action.label}
                  <ArrowRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="brief-clear">
            <Check size={20} />
            <p>Можно спокойно заняться продвижением или продолжить обучение.</p>
          </div>
        )}
      </section>

      <div className="brief-workspaces">
        <section className="brief-workspace">
          <div className="brief-section-heading">
            <h2>
              <PanelTop size={18} />
              Объявления
            </h2>
            <Jump search={{ section: "ads" }}>Открыть</Jump>
          </div>
          <div className="brief-workspace-total">
            <strong>{activeAds}</strong>
            <span>активных на Авито</span>
          </div>
          <div className="brief-status-row">
            <span>Блокировки и отклонения</span>
            <b className={badAds.length ? "brief-warning" : ""}>
              {badAds.length || (
                <>
                  <Check size={14} />
                  Нет
                </>
              )}
            </b>
          </div>
          <div className="brief-status-row">
            <span>Ошибки автозагрузки</span>
            <b className={feedErrors ? "brief-warning" : ""}>
              {snapshot?.feed
                ? feedErrors || (
                    <>
                      <Check size={14} />
                      Нет
                    </>
                  )
                : "Нет данных"}
            </b>
          </div>
        </section>
        <section className="brief-workspace">
          <div className="brief-section-heading">
            <h2>
              <MessageSquare size={18} />
              Диалоги
            </h2>
            <Jump search={{ section: "chats" }}>Открыть</Jump>
          </div>
          <div className="brief-workspace-total">
            <strong>{waiting.length}</strong>
            <span>ждут вашего ответа</span>
          </div>
          <div className="brief-status-row">
            <span>Новые обращения в работе</span>
            <b>{newLeads.length}</b>
          </div>
          <div className="brief-status-row">
            <span>Напоминания и результаты встреч</span>
            <b>{reminders.length}</b>
          </div>
        </section>
      </div>
      {!hasStudied ? (
        <Link to="/" search={{ section: "learn" }} className="brief-learn">
          <BookOpen size={21} />
          <span>
            <strong>От объявления до первого ученика</strong>
            <span>Короткий практический курс: продвижение, диалоги и диагностика</span>
          </span>
          <ArrowRight size={18} />
        </Link>
      ) : null}
    </div>
  );
}

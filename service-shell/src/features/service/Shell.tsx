import { lazy, Suspense, useEffect, useState } from "react";
import { ServiceLoading } from "./ServiceLoading";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  CircleHelp,
  LayoutDashboard,
  MessageSquare,
  PanelTop,
  Settings2,
} from "lucide-react";
import { CabinetPage } from "@/features/cabinet/CabinetPage";
import { balanceRows, blockRows } from "@/features/cabinet/rules";
import { sampleCabinet } from "@/features/cabinet/sample";
import { ads, dialogs, windows, PHOTO_SLOTS } from "./data.ts";
import { attention } from "./rules.ts";
import { SECTIONS, type SectionId } from "./sections.ts";
import { useDemoCrm } from "./demo-crm-store.ts";
import { leadProgress } from "./lead-workflow.ts";
import { monthRangeMsk, periodMetrics } from "./crm.ts";
import { AdsSection, DashboardSection, DialogsSection } from "./views.tsx";
import { AnalyticsSection } from "./AnalyticsSection.tsx";
import { ANALYTICS_TABS, analyticsTabFromFocus } from "./analytics-navigation.ts";
import { getPreviewData } from "./preview-data.ts";

const KnowledgeSection = lazy(() =>
  import("@/features/knowledge/KnowledgeSection").then((module) => ({
    default: module.KnowledgeSection,
  })),
);

const ICONS = {
  today: LayoutDashboard,
  stats: ChartNoAxesCombined,
  ads: PanelTop,
  chats: MessageSquare,
  learn: BookOpen,
  acc: Settings2,
};

export function Shell({
  section,
  focus,
  view,
}: {
  section: SectionId;
  focus?: string;
  view?: "crm";
}) {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const { state: crm, storageError } = useDemoCrm();
  const tutorAvatarUrl = getPreviewData()?.tutorAvatarUrl;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const crmMetrics = periodMetrics(crm, ...monthRangeMsk(2026, 10));
  const liveWindows = windows.map((slot) => {
    const appointment = crm.appointments.find(
      (item) => item.startsAt === slot.startsAt && item.status === "booked",
    );
    return {
      ...slot,
      takenBy: appointment
        ? crm.leads.find((item) => item.id === appointment.leadId)?.name || null
        : null,
    };
  });
  const marks = attention({
    ads,
    dialogs: dialogs.filter(
      (d) => crm.leads.some((l) => l.id === d.id) && leadProgress(crm, d.id, now).stage === "new",
    ),
    windows: liveWindows,
    photoSlots: PHOTO_SLOTS,
    blockedTitles: sampleCabinet.blocks.items.map((item) => item.title),
    unpaid: crmMetrics.unpaidStudentIds.filter((id) =>
      crm.leads.some((l) => l.studentId === id && !l.closedAt),
    ).length,
    nowMs: now,
  });
  const cabinetShort = balanceRows(sampleCabinet.balance).some(
    (row) => row.label === "Хватит" && row.tone === "bad",
  );
  marks.acc =
    (cabinetShort ? 1 : 0) +
    blockRows(sampleCabinet.blocks, now).filter((row) => row.tone === "bad").length;
  if (getPreviewData()) {
    marks.ads = sampleCabinet.blocks.items.length;
    marks.stats = 0;
  }
  marks.today = marks.stats + marks.ads + marks.chats;
  const selected = SECTIONS.find((item) => item.id === section)!;

  return (
    <div className="service-layout">
      <a className="skip-link" href="#service-content">
        Перейти к содержимому
      </a>
      <aside className="service-sidebar">
        <a href="/?section=today" className="service-brand" aria-label="Авито — главная">
          <img
            className="service-brand-logo"
            src="/images/brand/logo.svg"
            alt=""
            width="48"
            height="30"
          />
          <span>Авито</span>
        </a>
        <div className="workspace-profile">
          <span className="profile-avatar">
            {tutorAvatarUrl ? (
              <img
                src={tutorAvatarUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
              />
            ) : getPreviewData() ? (
              "ЕД"
            ) : (
              "АС"
            )}
          </span>
          <div>
            <strong>{sampleCabinet.tutor}</strong>
            <small>{sampleCabinet.subject}</small>
          </div>
        </div>
        <nav className="service-nav" aria-label="Разделы">
          {SECTIONS.map((item) => {
            const Icon = ICONS[item.id];
            return (
              <div key={item.id}>
                <button
                  type="button"
                  className={`service-nav-item ${item.id === section ? "active" : ""}`}
                  aria-current={item.id === section ? "page" : undefined}
                  onClick={() => navigate({ to: "/", search: { section: item.id } })}
                >
                  <Icon size={18} strokeWidth={1.7} />
                  <span>{item.label}</span>
                  {marks[item.id] > 0 && item.id !== "today" && item.id !== "ads" ? (
                    <span className="nav-badge">{marks[item.id]}</span>
                  ) : null}
                </button>
                {item.id === "chats" && section === "chats" && (
                  <div className="ads-subnav chat-subnav">
                    <button
                      type="button"
                      className={view !== "crm" ? "active" : ""}
                      aria-current={view !== "crm" ? "page" : undefined}
                      onClick={() => navigate({ to: "/", search: { section: "chats" } })}
                    >
                      Сообщения
                    </button>
                    <button
                      type="button"
                      className={view === "crm" ? "active" : ""}
                      aria-current={view === "crm" ? "page" : undefined}
                      onClick={() =>
                        navigate({ to: "/", search: { section: "chats", view: "crm" } })
                      }
                    >
                      CRM
                    </button>
                  </div>
                )}
                {item.id === "stats" && section === "stats" && (
                  <div className="ads-subnav" aria-label="Разделы аналитики">
                    {ANALYTICS_TABS.map(({ id, label }) => (
                      <button
                        type="button"
                        key={id}
                        className={analyticsTabFromFocus(focus) === id ? "active" : ""}
                        aria-current={analyticsTabFromFocus(focus) === id ? "page" : undefined}
                        onClick={() => navigate({ to: "/", search: { section: "stats", focus: id } })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {item.id === "ads" && section === "ads" && (
                  <div className="ads-subnav">
                    {[
                      ["list", "Объявления"],
                      ["generate", "ИИ-генерация"],
                      ["feeds", "Автозагрузка"],
                    ].map(([id, label]) => (
                      <button
                        type="button"
                        key={id}
                        className={focus === id || (!focus && id === "list") ? "active" : ""}
                        onClick={() => navigate({ to: "/", search: { section: "ads", focus: id } })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="support-icon">
              <CircleHelp size={19} />
            </span>
            <strong>Мы рядом</strong>
            <p>
              Куратор и команда Cantor
              <br />
              10:00–18:00 МСК
            </p>
            <a
              href="https://t.me/cantor_agency_manager"
              target="_blank"
              rel="noreferrer"
              className="support-manager-link"
            >
              Связь с командой <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </aside>
      <div className="service-body">
        <main id="service-content" className="service-content" tabIndex={-1}>
          <h1 className="sr-only">{selected.label}</h1>
          {storageError ? (
            <p role="alert" className="crm-error">
              {storageError}
            </p>
          ) : null}
          <div className={`service-section section-${section}`}>
            {section === "today" ? <DashboardSection /> : null}
            {section === "stats" ? <AnalyticsSection focus={focus} /> : null}
            {section === "ads" ? <AdsSection focus={focus} /> : null}
            {section === "chats" ? <DialogsSection focus={focus} view={view} /> : null}
            {section === "learn" ? (
              <Suspense fallback={<ServiceLoading variant="knowledge" />}>
                <KnowledgeSection focus={focus} />
              </Suspense>
            ) : null}
            {section === "acc" ? <CabinetPage /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

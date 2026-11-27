import { useCabinetAudit } from "../cabinet-admin/use-cabinet-audit";
import { SidebarFunds } from "./SidebarFunds";
import { SETTINGS_PAGES, settingsPage } from "../cabinet/settings-model";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ServiceLoading } from "./ServiceLoading";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  CircleHelp,
  LayoutDashboard,
  Menu,
  MessageSquare,
  PanelTop,
  Settings2,
  X,
} from "lucide-react";
import { CabinetPage } from "@/features/cabinet/CabinetPage";
import { CommenterProvider } from "@/features/comments/Commenter";
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
import { PREVIEW_EVENT, getPreviewData } from "./preview-data.ts";

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
  testSession,
}: {
  section: SectionId;
  focus?: string;
  view?: "crm" | "ai";
  testSession?: {
    workspaceId: string;
    employeeId: string;
    logout: () => void;
    loading: boolean;
    error: string;
  };
}) {
  const navigate = useNavigate();
  useCabinetAudit(
    testSession,
    section,
    section === "stats"
      ? analyticsTabFromFocus(focus)
      : section === "acc"
        ? settingsPage(focus)
        : section === "chats"
          ? (view ?? "")
          : section === "ads" && ["list", "generate", "feeds", "offers"].includes(focus ?? "")
            ? focus!
            : "",
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    window.addEventListener(PREVIEW_EVENT, update);
    return () => window.removeEventListener(PREVIEW_EVENT, update);
  }, []);
  const { state: crm, storageError } = useDemoCrm();
  const tutorAvatarUrl = getPreviewData()?.tutorAvatarUrl;

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || window.matchMedia("(max-width: 760px)").matches) return;
    const active = nav.querySelector<HTMLElement>(".service-nav-item.active");
    const submenu = active?.parentElement?.querySelector<HTMLElement>(".ads-subnav");
    if (!active || !submenu) return;
    const viewport = nav.getBoundingClientRect();
    const top = active.getBoundingClientRect().top;
    const bottom = submenu.getBoundingClientRect().bottom;
    const delta =
      bottom - top > viewport.height
        ? top - viewport.top
        : bottom > viewport.bottom
          ? bottom - viewport.bottom
          : top < viewport.top
            ? top - viewport.top
            : 0;
    if (delta)
      nav.scrollTo({
        top: nav.scrollTop + delta,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [section]);

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

  const layout = (
    <div className="service-layout" data-comment-anchor="shell-layout">
      <a className="skip-link" href="#service-content">
        Перейти к содержимому
      </a>
      <aside className="service-sidebar">
        <div className="service-mobile-header">
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
          <button
            type="button"
            className="service-mobile-menu-button"
            data-cabinet-audit="mobile-menu"
            aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={mobileMenuOpen}
            aria-controls="service-navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        <button
          type="button"
          className="workspace-profile"
          data-cabinet-audit="cabinet-profile"
          aria-label="Открыть настройки кабинета"
          onClick={() => navigate({ to: "/", search: { section: "acc", focus: "cabinet" } })}
        >
          <span className="profile-avatar">
            {tutorAvatarUrl ? (
              <img
                src={tutorAvatarUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
              />
            ) : getPreviewData() ? (
              getPreviewData()
                ?.tutor.split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase()
            ) : (
              "АС"
            )}
          </span>
          <div>
            <strong>{sampleCabinet.tutor}</strong>
            <small>{sampleCabinet.subject}</small>
          </div>
        </button>
        <SidebarFunds mobileOpen={mobileMenuOpen} onNavigate={() => setMobileMenuOpen(false)} />
        <nav
          ref={navRef}
          id="service-navigation"
          className={`service-nav${mobileMenuOpen ? " mobile-open" : ""}`}
          aria-label="Разделы"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest(".ads-subnav button"))
              setMobileMenuOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMobileMenuOpen(false);
          }}
        >
          {SECTIONS.map((item) => {
            const Icon = ICONS[item.id];
            return (
              <div key={item.id}>
                <button
                  type="button"
                  className={`service-nav-item ${item.id === section ? "active" : ""}`}
                  data-comment-anchor={`navigation-${item.id}`}
                  data-cabinet-audit="workspace-nav"
                  data-audit-target={item.id}
                  aria-current={item.id === section ? "page" : undefined}
                  onClick={() => {
                    if (!["chats", "stats", "ads", "acc"].includes(item.id))
                      setMobileMenuOpen(false);
                    void navigate({ to: "/", search: { section: item.id } });
                  }}
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
                      data-cabinet-audit="workspace-subnav"
                      className={!view ? "active" : ""}
                      aria-current={!view ? "page" : undefined}
                      onClick={() => navigate({ to: "/", search: { section: "chats" } })}
                    >
                      Сообщения
                    </button>
                    <button
                      type="button"
                      data-cabinet-audit="workspace-subnav"
                      className={view === "crm" ? "active" : ""}
                      aria-current={view === "crm" ? "page" : undefined}
                      onClick={() =>
                        navigate({ to: "/", search: { section: "chats", view: "crm" } })
                      }
                    >
                      CRM
                    </button>
                    <button
                      type="button"
                      data-cabinet-audit="workspace-subnav"
                      className={view === "ai" ? "active" : ""}
                      onClick={() =>
                        navigate({ to: "/", search: { section: "chats", view: "ai" } })
                      }
                    >
                      ИИ-менеджер
                    </button>
                  </div>
                )}
                {item.id === "stats" && section === "stats" && (
                  <div className="ads-subnav" aria-label="Разделы аналитики">
                    {ANALYTICS_TABS.map(({ id, label }) => (
                      <button
                        type="button"
                        key={id}
                        data-cabinet-audit="workspace-subnav"
                        className={analyticsTabFromFocus(focus) === id ? "active" : ""}
                        aria-current={analyticsTabFromFocus(focus) === id ? "page" : undefined}
                        onClick={() =>
                          navigate({ to: "/", search: { section: "stats", focus: id } })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {item.id === "acc" && section === "acc" && (
                  <div className="ads-subnav settings-subnav" aria-label="Разделы настроек">
                    {SETTINGS_PAGES.map(({ id, label }) => (
                      <button
                        type="button"
                        key={id}
                        data-cabinet-audit="workspace-subnav"
                        className={settingsPage(focus) === id ? "active" : ""}
                        aria-current={settingsPage(focus) === id ? "page" : undefined}
                        onClick={() => navigate({ to: "/", search: { section: "acc", focus: id } })}
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
                      ["offers", "Рассылки"],
                    ].map(([id, label]) => (
                      <button
                        type="button"
                        key={id}
                        data-cabinet-audit="workspace-subnav"
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
          {testSession && (
            <div className="cabinet-test-session">
              {testSession.loading && <small role="status">Загружаем данные Авито…</small>}
              <button type="button" className="cabinet-button quiet" onClick={testSession.logout}>
                Выйти из кабинета
              </button>
              {testSession.error && <small role="alert">{testSession.error}</small>}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="support-icon">
              <CircleHelp size={19} />
            </span>
            <strong>Мы рядом</strong>
            <p>
              Команда Cantor Agency
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
            {section === "acc" ? <CabinetPage focus={focus} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
  return testSession ? (
    <CommenterProvider location={{ section, focus, view }}>{layout}</CommenterProvider>
  ) : (
    layout
  );
}

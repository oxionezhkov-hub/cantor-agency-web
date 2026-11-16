import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Asterisk, BookOpen, ChartNoAxesCombined, ChevronRight, CircleHelp, LayoutDashboard, MessageSquare, Moon, PanelTop, Settings2, Sun } from "lucide-react";
import { CabinetPage } from "@/features/cabinet/CabinetPage";
import { balanceRows, blockRows } from "@/features/cabinet/rules";
import { sampleCabinet } from "@/features/cabinet/sample";
import { ads, dialogs, windows, PHOTO_SLOTS } from "./data.ts";
import { attention } from "./rules.ts";
import { SECTIONS, type SectionId } from "./sections.ts";
import { useDemoCrm } from "./demo-crm-store.ts";
import { monthRangeMsk, periodMetrics } from "./crm.ts";
import { AdsSection, ContactSection, DashboardSection, DiagnosticSection, DialogsSection, LearnSection, PaymentsSection, ShowsSection } from "./views.tsx";

const ICONS = { today: LayoutDashboard, stats: ChartNoAxesCombined, ads: PanelTop, chats: MessageSquare, learn: BookOpen, acc: Settings2 };
const DESCRIPTIONS: Record<SectionId, string> = {
  today: "Путь от первого просмотра до нового ученика — в одном месте.",
  stats: "Понимайте, что работает и на каком шаге теряются обращения.",
  ads: "Объявления, которые помогают ученикам найти вас.",
  chats: "Каждое обращение — следующий шаг к диагностике.",
  learn: "Методика Cantor и знания, которые помогают в работе.",
  acc: "Ваш кабинет Авито, подписка и состояние подключения.",
};

export function Shell({ section, focus }: { section: SectionId; focus?: string }) {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const { state: crm, storageError } = useDemoCrm();
  const [dark, setDark] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    let theme: string | null = null;
    try { theme = localStorage.getItem("cantor.service-theme"); } catch { /* Storage can be disabled by browser privacy settings. */ }
    const prefersDark = theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(prefersDark);
    document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
    return () => { window.clearInterval(timer); };
  }, []);

  const crmMetrics = periodMetrics(crm, ...monthRangeMsk(2026, 10));
  const liveWindows = windows.map(slot => {
    const appointment = crm.appointments.find(item => item.startsAt === slot.startsAt && item.status === "booked");
    return { ...slot, takenBy: appointment ? crm.leads.find(item => item.id === appointment.leadId)?.name || null : null };
  });
  const marks = attention({ ads, dialogs, windows: liveWindows, photoSlots: PHOTO_SLOTS, blockedTitles: sampleCabinet.blocks.items.map(item => item.title), unpaid: crmMetrics.unpaidStudentIds.length, nowMs: now });
  const cabinetShort = balanceRows(sampleCabinet.balance).some(row => row.label === "Хватит" && row.tone === "bad");
  marks.acc = (cabinetShort ? 1 : 0) + blockRows(sampleCabinet.blocks, now).filter(row => row.tone === "bad").length;
  marks.today = marks.stats + marks.ads + marks.chats;
  const selected = SECTIONS.find(item => item.id === section)!;

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("cantor.service-theme", next ? "dark" : "light"); } catch { /* Preference remains active for this visit. */ }
  }

  return <div className="service-layout">
    <a className="skip-link" href="#service-content">Перейти к содержимому</a>
    <aside className="service-sidebar">
      <a href="/?section=today" className="service-brand" aria-label="Cantor — главная"><span className="brand-mark"><Asterisk size={24} /></span><span>Cantor<span className="brand-caption">сервис для репетиторов</span></span></a>
      <div className="workspace-profile"><span className="profile-avatar">АС</span><div><strong>{sampleCabinet.tutor}</strong><small>{sampleCabinet.subject}</small></div></div>
      <p className="nav-caption">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p>
      <nav className="service-nav" aria-label="Разделы">{SECTIONS.map(item => {
        const Icon = ICONS[item.id];
        return <button key={item.id} type="button" className={`service-nav-item ${item.id === section ? "active" : ""}`} aria-current={item.id === section ? "page" : undefined} onClick={() => navigate({ to: "/", search: { section: item.id } })}>
          <Icon size={18} strokeWidth={1.7} /><span>{item.label}</span>{marks[item.id] > 0 && item.id !== "today" ? <span className="nav-badge">{marks[item.id]}</span> : null}
        </button>;
      })}</nav>
      <div className="sidebar-bottom"><div className="support-card"><span className="support-icon"><CircleHelp size={19} /></span><strong>Мы рядом</strong><p>Куратор и команда Cantor<br />10:00–18:00 МСК</p><button type="button" onClick={() => setHelpOpen(open => !open)} aria-expanded={helpOpen}>Связь с командой<ArrowUpRight size={15} /></button>{helpOpen ? <p className="support-detail" role="status">Общение с командой — в вашем Telegram-чате. В демоверсии чат ещё не привязан.</p> : null}</div><span className="sidebar-signature">Больше времени преподавать</span></div>
    </aside>
    <div className="service-body">
      <header className="service-topbar"><p>Личный кабинет<ChevronRight size={14} /><strong>{selected.label}</strong></p><div><span className="preview-tag">Превью</span><button className="theme-toggle" type="button" aria-label={dark ? "Светлая тема" : "Тёмная тема"} onClick={toggleTheme}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><span className="topbar-avatar" aria-label="Анна Смирнова">АС</span></div></header>
      <main id="service-content" className="service-content" tabIndex={-1}>
        <div className="service-page-heading"><div><p className="page-eyebrow">CANTOR / ВАШ РЕЗУЛЬТАТ</p><h1>{section === "today" ? "Всё под вашим контролем" : selected.label}<span>.</span></h1><p>{DESCRIPTIONS[section]}</p></div><span className="account-tag"><span />Кабинет репетитора</span></div>
        <div role="note" className="preview-notice"><span className="preview-notice-dot" /><p><strong>Демонстрационные данные.</strong> Авито не подключён. Записи и оплаты сохраняются только в этом браузере.</p></div>
        {storageError ? <p role="alert" className="crm-error">{storageError}</p> : null}
        <div className={`service-section section-${section}`}>
          {section === "today" ? <DashboardSection /> : null}
          {section === "stats" ? <div><ContactSection /><ShowsSection /><PaymentsSection focus={focus} /></div> : null}
          {section === "ads" ? <AdsSection focus={focus} /> : null}
          {section === "chats" ? <div><DialogsSection focus={focus} /><DiagnosticSection focus={focus} /></div> : null}
          {section === "learn" ? <LearnSection /> : null}
          {section === "acc" ? <CabinetPage /> : null}
        </div>
        <footer className="service-footer"><span>Cantor · Сервис для репетиторов</span><span>От первого обращения до нового ученика</span></footer>
      </main>
    </div>
  </div>;
}

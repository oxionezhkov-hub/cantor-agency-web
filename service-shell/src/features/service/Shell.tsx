import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Asterisk, BookOpen, ChartNoAxesCombined, CircleHelp, LayoutDashboard, MessageSquare, PanelTop, Settings2 } from "lucide-react";
import { CabinetPage } from "@/features/cabinet/CabinetPage";
import { balanceRows, blockRows } from "@/features/cabinet/rules";
import { sampleCabinet } from "@/features/cabinet/sample";
import { ads, dialogs, windows, PHOTO_SLOTS } from "./data.ts";
import { attention } from "./rules.ts";
import { SECTIONS, type SectionId } from "./sections.ts";
import { useDemoCrm } from "./demo-crm-store.ts";
import { leadProgress } from "./lead-workflow.ts";
import { monthRangeMsk, periodMetrics } from "./crm.ts";
import { AdsSection, ContactSection, DashboardSection, DialogsSection, LearnSection, PaymentsSection, ShowsSection } from "./views.tsx";

const ICONS = { today: LayoutDashboard, stats: ChartNoAxesCombined, ads: PanelTop, chats: MessageSquare, learn: BookOpen, acc: Settings2 };

export function Shell({ section, focus }: { section: SectionId; focus?: string }) {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const { state: crm, storageError } = useDemoCrm();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { window.clearInterval(timer); };
  }, []);

  const crmMetrics = periodMetrics(crm, ...monthRangeMsk(2026, 10));
  const liveWindows = windows.map(slot => {
    const appointment = crm.appointments.find(item => item.startsAt === slot.startsAt && item.status === "booked");
    return { ...slot, takenBy: appointment ? crm.leads.find(item => item.id === appointment.leadId)?.name || null : null };
  });
  const marks = attention({ ads, dialogs: dialogs.filter(d => leadProgress(crm, d.id, now).stage === "new"), windows: liveWindows, photoSlots: PHOTO_SLOTS, blockedTitles: sampleCabinet.blocks.items.map(item => item.title), unpaid: crmMetrics.unpaidStudentIds.filter(id => crm.leads.some(l => l.studentId === id && !l.closedAt)).length, nowMs: now });
  const cabinetShort = balanceRows(sampleCabinet.balance).some(row => row.label === "Хватит" && row.tone === "bad");
  marks.acc = (cabinetShort ? 1 : 0) + blockRows(sampleCabinet.blocks, now).filter(row => row.tone === "bad").length;
  marks.today = marks.stats + marks.ads + marks.chats;
  const selected = SECTIONS.find(item => item.id === section)!;


  return <div className="service-layout">
    <a className="skip-link" href="#service-content">Перейти к содержимому</a>
    <aside className="service-sidebar">
      <a href="/?section=today" className="service-brand" aria-label="Cantor — главная"><span className="brand-mark"><Asterisk size={24} /></span><span>Cantor</span></a>
      <div className="workspace-profile"><span className="profile-avatar">АС</span><div><strong>{sampleCabinet.tutor}</strong><small>{sampleCabinet.subject}</small></div></div>
      <nav className="service-nav" aria-label="Разделы">{SECTIONS.map(item => {
        const Icon = ICONS[item.id];
        return <button key={item.id} type="button" className={`service-nav-item ${item.id === section ? "active" : ""}`} aria-current={item.id === section ? "page" : undefined} onClick={() => navigate({ to: "/", search: { section: item.id } })}>
          <Icon size={18} strokeWidth={1.7} /><span>{item.label}</span>{marks[item.id] > 0 && item.id !== "today" ? <span className="nav-badge">{marks[item.id]}</span> : null}
        </button>;
      })}</nav>
      <div className="sidebar-bottom"><div className="support-card"><span className="support-icon"><CircleHelp size={19} /></span><strong>Мы рядом</strong><p>Куратор и команда Cantor<br />10:00–18:00 МСК</p><button type="button" onClick={() => setHelpOpen(open => !open)} aria-expanded={helpOpen}>Связь с командой<ArrowUpRight size={15} /></button>{helpOpen ? <p className="support-detail" role="status">Ваш Telegram-чат с командой ещё не привязан.</p> : null}</div></div>
    </aside>
    <div className="service-body">
      <main id="service-content" className="service-content" tabIndex={-1}>
        <h1 className="sr-only">{selected.label}</h1>
        {storageError ? <p role="alert" className="crm-error">{storageError}</p> : null}
        <div className={`service-section section-${section}`}>
          {section === "today" ? <DashboardSection /> : null}
          {section === "stats" ? <div><ContactSection /><ShowsSection /><PaymentsSection focus={focus} /></div> : null}
          {section === "ads" ? <AdsSection focus={focus} /> : null}
          {section === "chats" ? <DialogsSection focus={focus} /> : null}
          {section === "learn" ? <LearnSection /> : null}
          {section === "acc" ? <CabinetPage /> : null}
        </div>

      </main>
    </div>
  </div>;
}

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CabinetPage } from "@/features/cabinet/CabinetPage";
import { balanceRows, blockRows } from "@/features/cabinet/rules";
import { sampleCabinet } from "@/features/cabinet/sample";
import { ads, dialogs, windows, PHOTO_SLOTS } from "./data.ts";
import { attention } from "./rules.ts";
import { SECTIONS, type SectionId } from "./sections.ts";
import { readBookings, readExtraPayments, STORE_EVENT } from "./store.ts";
import { AdsSection, ContactSection, DashboardSection, DiagnosticSection, DialogsSection, LearnSection, PaymentsSection, ShowsSection } from "./views.tsx";

export function Shell({ section }: { section: SectionId }) {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const [extraPayments, setExtraPayments] = useState(0);
  const [booked, setBooked] = useState<Record<string, string>>({});

  useEffect(() => {
    const sync = () => {
      setExtraPayments(readExtraPayments().length);
      setBooked(readBookings());
    };
    sync();
    window.addEventListener(STORE_EVENT, sync);
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.removeEventListener(STORE_EVENT, sync);
      window.clearInterval(timer);
    };
  }, [section]);

  const liveWindows = windows.map((slot) => ({
    ...slot,
    takenBy: slot.takenBy || booked[slot.id] || null,
  }));
  const marks = attention({
    ads,
    dialogs,
    windows: liveWindows,
    photoSlots: PHOTO_SLOTS,
    blockedTitles: sampleCabinet.blocks.items.map((item) => item.title),
    unpaid: extraPayments > 0 ? 0 : 1,
    nowMs: now,
  });
  const cabinetShort = balanceRows(sampleCabinet.balance).some((row) => row.label === "Хватит" && row.tone === "bad");
  const cabinetBlocks = blockRows(sampleCabinet.blocks, now).filter((row) => row.tone === "bad").length;
  marks.acc = (cabinetShort ? 1 : 0) + cabinetBlocks;
  marks.today = marks.stats + marks.ads + marks.chats;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-10 border-b border-line bg-bg md:h-screen md:border-r md:border-b-0">
        <div className="px-4 py-4 md:px-5 md:py-6">
          <p className="font-display text-sm font-bold text-red">Cantor</p>
          <p className="mt-3 hidden text-sm md:block">
            <span className="block font-medium">{sampleCabinet.tutor}</span>
            <span className="text-muted">{sampleCabinet.subject}</span>
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:grid md:px-3 md:pb-0" aria-label="Разделы">
          {SECTIONS.map((item) => {
            const on = item.id === section;
            const count = marks[item.id];
            return (
              <button
                key={item.id}
                type="button"
                className={`flex h-11 shrink-0 items-center justify-between gap-3 rounded-full px-3 text-left font-medium md:w-full ${on ? "text-ink ring-1 ring-line" : "text-muted"}`}
                aria-current={on ? "page" : undefined}
                onClick={() => navigate({ to: "/", search: { section: item.id } })}
              >
                {item.label}
                {count > 0 ? <span className="text-red tabular-nums">{count}</span> : null}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 px-5 py-8 pb-16 md:px-8">
        <div className={section === "today" ? "max-w-5xl" : "max-w-3xl"}>
          {section === "today" ? <DashboardSection /> : null}
          {section === "stats" ? (
            <div>
              <ContactSection />
              <ShowsSection />
              <PaymentsSection />
            </div>
          ) : null}
          {section === "ads" ? <AdsSection /> : null}
          {section === "chats" ? (
            <div>
              <DialogsSection />
              <DiagnosticSection />
            </div>
          ) : null}
          {section === "learn" ? <LearnSection /> : null}
          {section === "acc" ? <CabinetPage /> : null}
        </div>
      </main>
    </div>
  );
}

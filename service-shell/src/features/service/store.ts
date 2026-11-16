export type ExtraPayment = {
  who: string;
  amountRub: number;
};

const PAY_KEY = "cantor.extra-payments";
const BOOK_KEY = "cantor.window-bookings";
export const STORE_EVENT = "cantor-store";

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STORE_EVENT));
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

export function readExtraPayments(): ExtraPayment[] {
  const raw = readJson(PAY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const who = "who" in item && typeof item.who === "string" ? item.who.trim().slice(0, 40) : "";
    const amount = "amountRub" in item ? Number(item.amountRub) : Number.NaN;
    if (!who || !Number.isInteger(amount) || amount <= 0 || amount > 999_999) return [];
    return [{ who, amountRub: amount }];
  });
}

export function writeExtraPayments(items: ExtraPayment[]) {
  try {
    localStorage.setItem(PAY_KEY, JSON.stringify(items));
  } catch {
    /* the screen still shows what was entered */
  }
  notify();
}

export function readBookings(): Record<string, string> {
  const raw = readJson(BOOK_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, 40);
  }
  return out;
}

export function writeBookings(bookings: Record<string, string>) {
  try {
    localStorage.setItem(BOOK_KEY, JSON.stringify(bookings));
  } catch {
    /* keep the booking on screen */
  }
  notify();
}

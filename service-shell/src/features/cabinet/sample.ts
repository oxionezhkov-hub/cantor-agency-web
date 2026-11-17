import type { BalanceInput, BlocksInput, SubscriptionInput } from "./rules.ts";
import { getPreviewData } from "../service/preview-data.ts";

export type CabinetSnapshot = {
  tutor: string;
  subject: string;
  subscription: SubscriptionInput;
  balance: BalanceInput;
  blocks: BlocksInput;
};

const exampleCabinet: CabinetSnapshot = {
  tutor: "Анна Смирнова",
  subject: "Математика ОГЭ/ЕГЭ",
  subscription: {
    planName: "Профессиональный план",
    paidUntil: "2026-12-02",
    lastPaidAt: "2026-11-02",
    autoRenew: true,
  },
  balance: {
    advanceRub: 2100,
    yesterdayPromotionRub: 840,
    autoTopUp: false,
    walletRealRub: 120,
    walletBonusRub: 0,
  },
  blocks: {
    cabinetBlocked: false,
    items: [
      {
        title: "Математика ЕГЭ, с 60 до 80+",
        kind: "blocked",
        foundAt: "2026-11-15T13:40:00.000Z",
      },
    ],
  },
};
const preview = getPreviewData();
export const sampleCabinet: CabinetSnapshot = preview
  ? {
      tutor: preview.tutor,
      subject: preview.subject,
      subscription: {
        planName: "Подписка (набор услуг)",
        paidUntil: preview.tariff?.paidUntil || "",
        lastPaidAt: preview.tariff?.lastPaidAt || "",
        autoRenew: preview.tariff?.autoRenew ?? false,
      },
      balance: {
        advanceRub: NaN,
        yesterdayPromotionRub:
          preview.accountDaily?.find((r) => r.date === "2026-11-16")?.spendRub ?? NaN,
        autoTopUp: null,
        walletRealRub: preview.balance?.real ?? NaN,
        walletBonusRub: preview.balance?.bonus ?? NaN,
      },
      blocks: {
        cabinetBlocked: false,
        items: preview.ads
          .filter((a) => ["blocked", "rejected", "removed"].includes(a.status))
          .map((a) => ({
            title: a.title,
            kind: a.status as "blocked" | "rejected" | "removed",
            foundAt: new Date(preview.catalogAt || Date.now()).toISOString(),
          })),
      },
    }
  : exampleCabinet;

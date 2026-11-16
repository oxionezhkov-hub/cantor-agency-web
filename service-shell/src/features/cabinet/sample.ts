import type { BalanceInput, BlocksInput, SubscriptionInput } from "./rules.ts";

export type CabinetSnapshot = {
  tutor: string;
  subject: string;
  subscription: SubscriptionInput;
  balance: BalanceInput;
  blocks: BlocksInput;
};

export const sampleCabinet: CabinetSnapshot = {
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

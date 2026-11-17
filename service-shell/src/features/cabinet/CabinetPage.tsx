import { useEffect, useState } from "react";
import { sampleCabinet, type CabinetSnapshot } from "./sample.ts";
import { balanceRows, blockRows, subscriptionRows, type CabinetRow } from "./rules.ts";
import { getPreviewData } from "../service/preview-data.ts";

const TICK_MS = 15_000;

type CabinetPageProps = {
  snapshot?: CabinetSnapshot | null;
  error?: string | null;
  sheets?: Array<"subscription" | "balance" | "blocks">;
};

function toneClass(tone: CabinetRow["tone"]): string {
  if (tone === "bad") return "text-red";
  if (tone === "ok") return "text-ok";
  return "text-ink";
}

function Sheet({ rows }: { rows: CabinetRow[] }) {
  const body = rows.length > 0 ? rows : [{ label: "Данные", value: "нет", detail: null, tone: "plain" as const }];
  return (
    <section className="mt-8 first:mt-0">
      <table className="w-full border-collapse">
        <tbody>
          {body.map((row, index) => (
            <tr key={`${row.label}-${index}`} className="border-b border-line">
              <th scope="row" className="py-3 pr-4 text-left text-sm font-medium text-muted">
                {row.label}
              </th>
              <td className={`py-3 text-right ${toneClass(row.tone)}`}>
                {row.value}
                {row.detail ? <span className="mt-0.5 block text-sm font-normal text-muted">{row.detail}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function CabinetPage({
  snapshot = sampleCabinet,
  error = null,
  sheets = ["subscription", "balance", "blocks"],
}: CabinetPageProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  if (error) {
    return <p className="font-display text-lg text-red">{error}</p>;
  }

  if (!snapshot) {
    return <p className="text-muted">Кабинет не загружен.</p>;
  }

  return (
    <div>
      {sheets.includes("subscription") ? <Sheet rows={getPreviewData() ? ["План", "Статус", "Оплачена до", "Осталось", "Автопродление", "Размещение"].map(label => ({ label, value: "—", detail: null, tone: "plain" as const })) : subscriptionRows(snapshot.subscription, now)} /> : null}
      {sheets.includes("balance") ? <Sheet rows={getPreviewData() ? balanceRows(snapshot.balance).map(row => row.label === "Расход вчера" ? { ...row, detail: null } : { ...row, value: "—", detail: null, tone: "plain" }) : balanceRows(snapshot.balance)} /> : null}
      {sheets.includes("blocks") ? <Sheet rows={blockRows(snapshot.blocks, now.getTime())} /> : null}
    </div>
  );
}

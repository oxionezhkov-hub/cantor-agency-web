import { Link } from "@tanstack/react-router";
import { Coins, Wallet } from "lucide-react";
import { getPreviewData } from "./preview-data";
import "./sidebar-funds.css";

export function SidebarFunds({
  mobileOpen,
  onNavigate,
}: {
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const preview = getPreviewData();
  const money = preview?.liveMoney;
  const loading = Boolean(preview && !preview.workspaceId && !money && !preview.live?.metrics);
  const items = [
    {
      id: "wallet",
      name: "Кошелёк",
      value: money?.wallet?.realRub ?? preview?.balance?.real,
      observedAt: money?.wallet?.observedAt ?? (preview?.balance ? preview.readAt : undefined),
      stale: money?.wallet?.stale,
      Icon: Wallet,
    },
    {
      id: "advance",
      name: "Аванс",
      value: money?.advance?.rub,
      observedAt: money?.advance?.observedAt,
      stale: money?.advance?.stale,
      Icon: Coins,
    },
  ];
  return (
    <div className={`sidebar-funds ${mobileOpen ? "mobile-open" : ""}`}>
      {items.map(({ id, name, value, observedAt, stale, Icon }) => {
        const validDate = observedAt && Number.isFinite(Date.parse(observedAt));
        const updated = loading
          ? "Загружаем данные"
          : validDate
            ? `Обновлено ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(observedAt))}${stale ? " · данные устарели" : ""}`
            : "Время обновления неизвестно";
        const amount =
          value != null && Number.isFinite(value)
            ? `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`
            : "—";
        return (
          <Link
            key={id}
            to="/"
            search={{ section: "stats", focus: "overview" }}
            onClick={onNavigate}
            className="sidebar-fund"
            aria-label={loading ? `${name}: загрузка данных` : `${name}: ${amount}. ${updated}`}
          >
            <Icon size={16} aria-hidden="true" />
            {loading ? (
              <span className="sidebar-fund-skeleton" aria-hidden="true" />
            ) : (
              <span className="sidebar-fund-amount">{amount.replace(/\u00a0/g, " ")}</span>
            )}
            <span className="sidebar-fund-tooltip" role="tooltip">
              <strong>{name}</strong>
              <small>{updated}</small>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

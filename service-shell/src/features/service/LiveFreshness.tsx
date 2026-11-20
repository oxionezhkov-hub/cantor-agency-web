import { useState } from "react";
import { moreLiveChats, getPreviewData } from "./preview-data";
export function LiveFreshness({ section }: { section?: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const p = getPreviewData();
  if (!p) return null;
  const labels: Record<string, string> = {
    ads: "Объявления",
    autoload: "Автозагрузка",
    chats: "Диалоги",
    metrics: "Средства и расходы",
  };
  return (
    <details className="live-freshness">
      <summary>Актуальность данных Авито</summary>
      {Object.entries(labels).map(([id, label]) => {
        const m = p.live?.[id];
        return (
          <p key={id}>
            {label}:{" "}
            {m?.observedAt
              ? new Date(m.observedAt).toLocaleString("ru-RU")
              : "сохранённый снимок, ожидаем проверку"}
            {m?.error ? " · обновление не удалось; последние доступные данные" : ""}
            {m?.coverage?.truncated ? " · получена только часть списка" : ""}
          </p>
        );
      })}
      {section === "chats" && p.live?.chats?.coverage?.nextOffset != null && (
        <button
          className="st-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await moreLiveChats();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Ошибка загрузки");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Загружаем…" : "Показать более ранние диалоги"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <p>
        Тексты и фотографии старых карточек сохраняются из предыдущего снимка, если API не вернул
        обновление. Диагностики и оплаты — учёт Cantor.
      </p>
    </details>
  );
}

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, Clock3, AlertCircle, Layers3, X } from "lucide-react";
import { PREVIEW_EVENT, moreLiveChats, getPreviewData, type LiveMeta } from "./preview-data";
const sources = [
  { id: "ads", label: "Объявления", maxAge: 300 },
  { id: "autoload", label: "Автозагрузка", maxAge: 300 },
  { id: "chats", label: "Диалоги", maxAge: 120 },
  { id: "metrics", label: "Средства и расходы", maxAge: 600 },
];
const date = (value: string | number | null | undefined) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Дата неизвестна";
  return `${new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Moscow" })} МСК`;
};
function status(meta: LiveMeta | undefined, age: number, now: number, partial = false) {
  if (!meta?.observedAt)
    return { label: meta?.error ? "Нет обновления" : "Снимок", tone: "muted", Icon: Clock3 };
  if (!Number.isFinite(Date.parse(meta.observedAt)))
    return { label: "Дата неизвестна", tone: "muted", Icon: Clock3 };
  if (meta.error) return { label: "Нет обновления", tone: "warn", Icon: AlertCircle };
  if (now - Date.parse(meta.observedAt) > age * 1000)
    return { label: "Устарело", tone: "warn", Icon: Clock3 };
  if (
    partial ||
    meta.coverage?.truncated ||
    meta.coverage?.repeated ||
    meta.coverage?.complete === false
  )
    return { label: "Частично", tone: "warn", Icon: Layers3 };
  return { label: "Актуально", tone: "ok", Icon: CheckCircle2 };
}
export function LiveFreshness() {
  const [open, setOpen] = useState(false),
    [now, setNow] = useState(Date.now),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const update = () => setNow(Date.now());
    window.addEventListener(PREVIEW_EVENT, update);
    const timer = setInterval(update, 15000);
    return () => {
      window.removeEventListener(PREVIEW_EVENT, update);
      clearInterval(timer);
    };
  }, [open]);
  const p = getPreviewData();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setNow(Date.now());
      }}
    >
      <Dialog.Trigger asChild>
        <button className="st-button" type="button">
          Актуальность данных Авито
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="st-overlay" />
        <Dialog.Content className="st-dialog st-freshness-dialog">
          <div className="st-dialog-heading">
            <Dialog.Title>Актуальность данных Авито</Dialog.Title>
            <Dialog.Close className="st-close" aria-label="Закрыть актуальность данных">
              <X size={21} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            Последние успешные проверки и полнота данных подключённого кабинета. Время указано по
            Москве.
          </Dialog.Description>
          <div className="st-freshness-sources">
            {sources.map(({ id, label, maxAge }) => {
              const meta = p?.live?.[id],
                errors = id === "metrics" ? p?.liveMoney?.errors || [] : [];
              const state = status(
                  meta,
                  maxAge,
                  now,
                  errors.length > 0 ||
                    (id === "metrics" &&
                      Boolean(p?.liveMoney?.wallet?.stale || p?.liveMoney?.advance?.stale)),
                ),
                Icon = state.Icon;
              const saved =
                id === "ads"
                  ? p?.catalogAt
                  : id === "chats"
                    ? p?.chatsAt
                    : id === "autoload"
                      ? p?.feed?.builtAt
                      : p?.readAt;
              return (
                <section className="st-freshness-source" key={id} aria-label={label}>
                  <div className="st-freshness-source-heading">
                    <h3>{label}</h3>
                    <span className={`st-freshness-badge ${state.tone}`}>
                      <Icon size={14} />
                      {state.label}
                    </span>
                  </div>
                  <p className="st-freshness-time">
                    {meta?.observedAt
                      ? `Успешная проверка: ${date(meta.observedAt)}`
                      : `Сохранённые данные: ${date(saved)}`}
                  </p>
                  {!meta?.observedAt && (
                    <p>
                      Живое чтение ещё не подтверждено. Сведения из снимка могут отличаться от
                      текущего состояния.
                    </p>
                  )}
                  {meta?.error && (
                    <p>
                      {meta.error === "http_429" || meta.error === "rate_limit"
                        ? "Временно достигнут лимит запросов."
                        : meta.error === "http_403"
                          ? "Источник не разрешил чтение."
                          : "Не удалось обновить источник."}{" "}
                      Показаны последние доступные данные.
                    </p>
                  )}
                  {meta?.coverage?.truncated && (
                    <p>
                      Получена часть списка. Этот результат не означает, что загружена вся история.
                    </p>
                  )}
                  {meta?.coverage?.repeated && (
                    <p>
                      Проверка списка не завершена: повторившаяся страница не учитывается повторно.
                    </p>
                  )}
                  {id === "metrics" && (
                    <>
                      {p?.liveMoney?.wallet?.observedAt && (
                        <p>
                          Кошелёк: {date(p.liveMoney.wallet.observedAt)}
                          {p.liveMoney.wallet.stale ? " · последнее сохранённое значение" : ""}
                        </p>
                      )}
                      {p?.liveMoney?.advance?.observedAt && (
                        <p>
                          Аванс CPA: {date(p.liveMoney.advance.observedAt)}
                          {p.liveMoney.advance.stale ? " · последнее сохранённое значение" : ""}
                        </p>
                      )}
                      {errors.map((part) => (
                        <p key={part.part}>
                          {(
                            {
                              wallet: "Кошелёк",
                              advance: "Аванс CPA",
                              spend: "История расходов",
                              expenseBreakdown: "Детализация расходов",
                            } as Record<string, string>
                          )[part.part] || "Часть данных"}
                          : обновление недоступно.
                        </p>
                      ))}
                    </>
                  )}
                  {id === "chats" && meta?.coverage?.nextOffset != null && (
                    <button
                      className="st-button st-freshness-more"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await moreLiveChats();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Не удалось загрузить диалоги");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {busy ? "Загружаем…" : "Загрузить более ранние диалоги"}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="st-freshness-legend">
            <h3>Как читать статусы</h3>
            <p>
              <strong>Актуально</strong> — есть недавний успешный ответ. <strong>Частично</strong> —
              загружена только часть данных. <strong>Устарело / нет обновления</strong> — показаны
              последние хорошие сведения. <strong>Снимок</strong> — сохранённые данные до
              подтверждения живого чтения.
            </p>
            <p>
              Видимая вкладка проверяет источники примерно раз в минуту, открытый диалог — раз в 30
              секунд. Остатки средств могут обновляться до пяти минут.
            </p>
            <p>
              Тексты и фотографии карточек могут оставаться из сохранённого снимка. Диагностики и
              оплаты ведутся в Cantor.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useEffect, useRef, useState } from "react";
const sections = [
  ["identity", "Профиль"],
  ["items", "Объявления"],
  ["chats", "Диалоги"],
  ["stats", "Статистика"],
  ["spendings", "Расходы"],
  ["balance", "Кошелёк"],
  ["autoload", "Автозагрузка"],
  ["rating", "Рейтинг"],
  ["reviews", "Отзывы"],
];
type Page = {
  section: string;
  page: number;
  status: string;
  coverage?: { nextPage: number | null; complete: boolean; truncated?: boolean };
  summary?: Record<string, number | boolean>;
  error?: string;
  message?: string;
};
export function AvitoAudit() {
  const [open, setOpen] = useState(false),
    [password, setPassword] = useState(""),
    [pages, setPages] = useState<Page[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const stop = useRef(false),
    running = useRef(false);
  const [calls, setCalls] = useState(0);
  const totalCalls = useRef(0);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    stop.current = false;
    setNotice("");
    let result = [...pages];
    const start = Date.now();
    let batch = 0;
    try {
      for (const [section] of sections) {
        for (;;) {
          const done = result
            .filter((p) => p.section === section && p.status === "available")
            .sort((a, b) => a.page - b.page);
          const last = done.at(-1);
          if (last?.coverage?.complete || last?.coverage?.truncated) break;
          const page = last ? (last.coverage?.nextPage ?? 0) : 0;
          if (
            stop.current ||
            batch >= 10 ||
            totalCalls.current >= 80 ||
            Date.now() - start > 45000
          ) {
            setNotice(
              totalCalls.current >= 80
                ? "Достигнут предел 80 страниц. Скачайте частичный отчёт."
                : "Сбор приостановлен. Можно продолжить с сохранённой страницы.",
            );
            return;
          }
          const response = await fetch(`/api/demo/avito-audit?section=${section}&page=${page}`, {
            credentials: "same-origin",
            cache: "no-store",
            headers: { "x-avito-audit-password": password },
            signal: AbortSignal.timeout(22000),
          });
          batch++;
          totalCalls.current++;
          setCalls(totalCalls.current);
          const value = await response.json();
          if (!response.ok) {
            if (response.status !== 401 && response.status !== 403) {
              const blocked: Page = {
                section,
                page,
                status: "error",
                error:
                  response.status === 503
                    ? "not_configured_or_unavailable"
                    : `http_${response.status}`,
                coverage: { complete: false, nextPage: page },
              };
              result = [
                ...result.filter((p) => !(p.section === section && p.page === page)),
                blocked,
              ];
              setPages(result);
            }
            setNotice(
              value.message ||
                (
                  {
                    401: "Войдите в кабинет.",
                    403: "Нужен отдельный допуск администратора.",
                    429: "Лимит запросов: подождите и продолжите.",
                    503: "Источник отчёта не настроен.",
                  } as Record<number, string>
                )[response.status] ||
                "Ошибка доступа.",
            );
            return;
          }
          const item = value as Page;
          if (
            item.section !== section ||
            item.page !== page ||
            !["available", "unavailable", "error"].includes(item.status)
          )
            throw Error("invalid_response");
          result = [...result.filter((p) => !(p.section === section && p.page === page)), item];
          if (JSON.stringify(result).length > 500000) {
            setNotice("Достигнут предел файла 500 КБ. Скачайте частичный отчёт.");
            return;
          }
          setPages(result);
          if (item.status !== "available") break;
        }
      }
      setNotice(
        "Проход завершён. Ошибочные разделы можно повторить; успешные страницы сохраняются.",
      );
    } catch {
      setNotice(
        "Связь прервалась. Успешные страницы сохранены; продолжение повторит только незавершённую страницу.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function download() {
    const report = {
      schemaVersion: 1,
      workspace: "elena-dobrynina",
      account: "6c974a5d5326",
      exportedAt: new Date().toISOString(),
      source: "bounded_live_read_when_configured",
      requests: calls,
      resume: "Только эта вкладка; после перезагрузки сбор начинается заново.",
      redaction:
        "Тексты переписок и отзывов, имена, контакты, внешние ID, URL, токены и сырые ответы не включены. Доступность переписок проверяется списком чатов, тела сообщений не запрашиваются.",
      excluded: [
        "Ставки/продвижение и спецпредложения: требуется отдельная проверка доступности; изменяющие методы запрещены.",
        "Тарифные API Транспорта и Недвижимости не проверяют подписку репетитора Услуг.",
        "Голосовые, записи звонков и фотографии не скачиваются.",
        "Диагностики, ученики и их оплаты не являются данными Avito API.",
      ],
      sections: sections.map(([id, label]) => ({
        id,
        label,
        pages: pages.filter((p) => p.section === id),
        status: pages.some((p) => p.section === id) ? "observed" : "not_requested",
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "avito-dobrynina-audit.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="st-avito-audit">
      <button className="st-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        Собрать отчёт Авито
      </button>
      {open && (
        <div className="st-connection-fields">
          <p>
            Отчёт администратора: доступность данных кабинета Добрыниной, покрытие и ошибки.
            Переписки и личные данные в файл не попадают.
          </p>
          <label className="st-field">
            Допуск администратора
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <p>
            По 10 страниц за проход, последовательно. Продолжение и повтор ошибок работают в этой
            вкладке; после перезагрузки прогресс теряется.
          </p>
          <div className="st-actions">
            <button
              className="st-button"
              disabled={busy || !password || calls >= 80}
              onClick={() => void run()}
            >
              {busy ? "Собираем…" : pages.length ? "Продолжить / повторить ошибки" : "Начать сбор"}
            </button>
            {busy && (
              <button
                className="st-button"
                onClick={() => {
                  stop.current = true;
                  setNotice("Пауза после текущей страницы.");
                }}
              >
                Приостановить
              </button>
            )}
            <button className="st-button" disabled={!pages.length} onClick={download}>
              Скачать JSON{busy ? " — частичный" : ""}
            </button>
          </div>
          <p role="status">
            {notice ||
              `Получено страниц: ${pages.filter((p) => p.status === "available").length}. Запросов страниц: ${calls}.`}
          </p>
          <ul>
            {sections.map(([id, label]) => {
              const rows = pages.filter((p) => p.section === id),
                last = rows.at(-1);
              return (
                <li key={id}>
                  {label}:{" "}
                  {last
                    ? last.status === "available"
                      ? last.coverage?.complete
                        ? "готово"
                        : last.coverage?.truncated
                          ? "достигнут предел 20 страниц"
                          : `получено ${rows.length} стр., есть продолжение`
                      : last.status === "unavailable"
                        ? "нет доступа"
                        : "ошибка, можно повторить"
                    : "не запрошено"}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

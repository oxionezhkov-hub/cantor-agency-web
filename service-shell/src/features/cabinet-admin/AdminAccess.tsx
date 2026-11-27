import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, LogOut, Plus, RefreshCw } from "lucide-react";
import { cabinetReason, cabinetRequest } from "./client";
import "./cabinet-admin.css";

type Job = {
  id: string;
  status: "queued" | "running" | "ready" | "partial" | "failed";
  phase: string;
  page: number;
  steps: number;
  attempts: number;
  nextAt: number | null;
  updatedAt: string;
  error: string | null;
  unavailable?: Record<string, string>;
};
type Account = {
  id: string;
  name: string;
  userId: string;
  configured: boolean;
  cabinet: Job | null;
};
type Employee = {
  id: string;
  name: string;
  login: string;
  role: "tester";
  temporaryUntil: number | null;
  revokedAt: number | null;
};
type Details = { cabinet: Job | null; employees: Employee[]; imported: Record<string, number> };
const status: Record<Job["status"], string> = {
  queued: "В очереди",
  running: "Загружается",
  ready: "Готов",
  partial: "Частично загружен",
  failed: "Ошибка загрузки",
};
const phase: Record<string, string> = {
  profile: "Проверка подключения",
  ads: "Объявления",
  chats: "Диалоги",
  messages: "Сообщения",
  stats: "Статистика",
  balance: "Баланс",
};
const hub = "/api/admin/cabinets";
function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="cabinet-button quiet" href={href}>
      {children}
      <ArrowRight size={15} />
    </a>
  );
}

export function AdminAccess({ comments }: { comments?: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    cabinetRequest("/api/admin/session", undefined, controller.signal)
      .then(() => setSignedIn(true))
      .catch(() => {
        if (!controller.signal.aborted) setSignedIn(false);
      });
    return () => controller.abort();
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await cabinetRequest("/api/admin/login", { password: form.get("password") });
      setSignedIn(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (signedIn === null)
    return (
      <main className="cabinet-auth">
        <p role="status">Проверяем доступ…</p>
      </main>
    );
  if (!signedIn)
    return (
      <main className="cabinet-auth">
        <h1>Вход владельца Cantor</h1>
        <form onSubmit={login} className="cabinet-form">
          <label>
            Пароль
            <input required type="password" name="password" autoComplete="current-password" />
          </label>
          <button className="cabinet-button primary" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
          {error && (
            <p className="cabinet-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </main>
    );
  return (
    <main className="cabinet-admin">
      <header className="cabinet-top">
        <a href="/admin" className="cabinet-brand">
          Cantor
        </a>
        <nav aria-label="Разделы админки">
          <a aria-current={!comments ? "page" : undefined} href="/admin">
            Кабинеты
          </a>
          <a aria-current={comments ? "page" : undefined} href="/admin/comments">
            Комментарии
          </a>
        </nav>
        <button
          className="cabinet-button quiet"
          onClick={() => {
            cabinetRequest("/api/admin/logout", {})
              .then(() => setSignedIn(false))
              .catch((e) => setError(e.message));
          }}
        >
          <LogOut size={16} /> Выйти
        </button>
      </header>
      {error && (
        <p className="cabinet-error" role="alert">
          {error}
        </p>
      )}
      {comments || <Cabinets />}
    </main>
  );
}

function Cabinets() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Account | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ temporaryPassword: string; employee: Employee } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const endpoint = selected && `${hub}/${selected.id}`;
  async function loadAccounts(page?: string, signal?: AbortSignal) {
    const data = await cabinetRequest<{ accounts: Account[]; cursor: string | null }>(
      page ? `${hub}?cursor=${encodeURIComponent(page)}` : hub,
      undefined,
      signal,
    );
    setAccounts((prior) =>
      page
        ? [...prior, ...data.accounts.filter((row) => !prior.some((entry) => entry.id === row.id))]
        : data.accounts,
    );
    setCursor(data.cursor);
  }
  async function loadDetails(url: string, signal?: AbortSignal) {
    const data = await cabinetRequest<Details>(url, undefined, signal);
    if (signal?.aborted) return;
    setDetails(data);
    setAccounts((rows) =>
      rows.map((entry) =>
        entry.id === url.split("/").at(-1) ? { ...entry, cabinet: data.cabinet } : entry,
      ),
    );
  }
  useEffect(() => {
    const controller = new AbortController();
    loadAccounts(undefined, controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    const read = () =>
      loadDetails(endpoint, controller.signal).catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    void read();
    const timer = setInterval(read, 4500);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [endpoint]);
  function choose(account: Account) {
    setSelected(account);
    setDetails(null);
    setAdding(false);
    setIssued(null);
    setError("");
  }
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      await run();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action(async () => {
      const response = await cabinetRequest<{ account: Account }>(hub, Object.fromEntries(form));
      await loadAccounts();
      choose(response.account);
    });
  }
  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    await action(async () => {
      setIssued(await cabinetRequest(`${endpoint}/employees`, body));
      form.reset();
      await loadDetails(endpoint!);
    });
  }
  const job = details?.cabinet;
  const loginPath = selected && `/cabinet?workspace=${selected.id}`;
  return (
    <>
      <div className="cabinet-title">
        <div>
          <h1>Кабинеты Авито</h1>
          <p>Подключения, ход загрузки и доступ сотрудников</p>
        </div>
        <button
          className="cabinet-button primary"
          disabled={busy}
          onClick={() => {
            setAdding(!adding);
            setSelected(null);
            setError("");
            setIssued(null);
          }}
        >
          <Plus size={17} /> Подключить кабинет
        </button>
      </div>
      {error && (
        <p className="cabinet-error" role="alert">
          {error}
        </p>
      )}
      <div className="cabinet-admin-grid">
        <section className="cabinet-card" aria-labelledby="connections">
          <h2 id="connections">Подключения</h2>
          {loading ? (
            <p role="status">Загружаем подключения…</p>
          ) : !accounts.length ? (
            <p>Добавьте первое подключение к Авито.</p>
          ) : (
            <ul className="cabinet-accounts">
              {accounts.map((account) => (
                <li key={account.id}>
                  <button
                    type="button"
                    aria-pressed={selected?.id === account.id}
                    disabled={busy}
                    onClick={() => choose(account)}
                  >
                    <strong>{account.name}</strong>
                    <span>
                      {account.userId} ·{" "}
                      {account.cabinet
                        ? status[account.cabinet.status]
                        : account.configured
                          ? "Подключён"
                          : "Нужна настройка"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cursor && (
            <button
              className="cabinet-button quiet"
              disabled={busy}
              onClick={() => void action(() => loadAccounts(cursor))}
            >
              Показать ещё
            </button>
          )}
        </section>
        {adding ? (
          <section className="cabinet-card">
            <h2>Подключение к Авито</h2>
            <form className="cabinet-form" onSubmit={(e) => void saveConnection(e)}>
              <label>
                Название
                <input name="name" required maxLength={120} />
              </label>
              <label>
                ID пользователя Авито
                <input name="userId" inputMode="numeric" pattern="[0-9]{1,20}" required />
              </label>
              <label>
                Client ID
                <input name="clientId" required maxLength={512} autoComplete="off" />
              </label>
              <label>
                Client Secret
                <input
                  name="clientSecret"
                  required
                  maxLength={512}
                  type="password"
                  autoComplete="off"
                />
              </label>
              <button className="cabinet-button primary" disabled={busy}>
                Сохранить подключение
              </button>
            </form>
          </section>
        ) : (
          selected && (
            <section className="cabinet-card" aria-labelledby="cabinet-name">
              <h2 id="cabinet-name">{selected.name}</h2>
              {!details ? (
                <p role="status">Загружаем кабинет…</p>
              ) : !job ? (
                <>
                  <p>
                    При активации Cantor создаст отдельный кабинет и загрузит объявления, диалоги и
                    переписки в фоне.
                  </p>
                  <button
                    className="cabinet-button primary"
                    disabled={busy || !selected.configured}
                    onClick={() =>
                      void action(async () => {
                        await cabinetRequest(`${endpoint}/activate`, {});
                        await loadDetails(endpoint!);
                      })
                    }
                  >
                    Активировать кабинет
                  </button>
                </>
              ) : (
                <>
                  <div className="cabinet-status" role="status">
                    <strong>{status[job.status]}</strong>
                    {phase[job.phase] && (
                      <span>
                        {phase[job.phase]}
                        {["ads", "chats", "messages"].includes(job.phase)
                          ? `, страница ${job.page + 1}`
                          : ""}
                      </span>
                    )}
                    <span>
                      Объявлений {details.imported.ads || 0} · диалогов{" "}
                      {details.imported.chats || 0} · сообщений {details.imported.messages || 0}
                    </span>
                    {job.error && (
                      <span>
                        {cabinetReason(job.error)}
                        {job.attempts ? ` Попытка ${job.attempts} из 5.` : ""}
                      </span>
                    )}
                    {job.nextAt && job.error && (
                      <span>
                        Следующая попытка в{" "}
                        {new Date(job.nextAt).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                    {job.status === "partial" && (
                      <span>Часть данных недоступна. В кабинете показаны загруженные записи.</span>
                    )}
                    {Object.entries(job.unavailable || {}).map(([key, code]) => (
                      <span key={key}>
                        {phase[key]} · {cabinetReason(code)}
                      </span>
                    ))}
                  </div>
                  {job.status === "failed" && (
                    <button
                      className="cabinet-button quiet"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await cabinetRequest(`${endpoint}/retry`, {});
                          await loadDetails(endpoint!);
                        })
                      }
                    >
                      <RefreshCw size={16} /> Продолжить загрузку
                    </button>
                  )}
                  <div className="cabinet-access-title">
                    <h3>Сотрудники</h3>
                    <LinkButton href={loginPath!}>Страница входа</LinkButton>
                  </div>
                  {details.employees.length > 0 && (
                    <ul className="cabinet-people">
                      {details.employees.map((employee) => (
                        <li key={employee.id}>
                          <div>
                            <strong>{employee.name}</strong>
                            <small>
                              {employee.login} ·{" "}
                              {employee.revokedAt
                                ? "Доступ отозван"
                                : employee.temporaryUntil
                                  ? "Временный пароль"
                                  : "Тестировщик"}
                            </small>
                          </div>
                          <div className="cabinet-row-actions">
                            <button
                              className="cabinet-button quiet"
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  setIssued(
                                    await cabinetRequest(`${endpoint}/reset`, {
                                      employeeId: employee.id,
                                    }),
                                  );
                                  await loadDetails(endpoint!);
                                })
                              }
                            >
                              {employee.revokedAt ? "Восстановить доступ" : "Сбросить пароль"}
                            </button>
                            {!employee.revokedAt && (
                              <button
                                className="cabinet-button quiet danger"
                                disabled={busy}
                                onClick={() =>
                                  void action(async () => {
                                    await cabinetRequest(`${endpoint}/revoke`, {
                                      employeeId: employee.id,
                                    });
                                    setIssued(null);
                                    await loadDetails(endpoint!);
                                  })
                                }
                              >
                                Отозвать
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="cabinet-form cabinet-add-employee"
                    onSubmit={(e) => void addEmployee(e)}
                  >
                    <label>
                      Имя сотрудника
                      <input name="name" required maxLength={120} />
                    </label>
                    <label>
                      Логин
                      <input
                        name="login"
                        required
                        minLength={3}
                        maxLength={80}
                        autoCapitalize="none"
                        autoComplete="off"
                      />
                    </label>
                    <button className="cabinet-button primary" disabled={busy}>
                      <Plus size={16} /> Выдать доступ
                    </button>
                  </form>
                  {issued && (
                    <div className="cabinet-invite" role="status">
                      <button
                        type="button"
                        className="cabinet-button quiet"
                        onClick={() => setIssued(null)}
                      >
                        Скрыть
                      </button>
                      <strong>{issued.employee.name}</strong>
                      <span>
                        Логин <code>{issued.employee.login}</code>
                      </span>
                      <span>
                        Временный пароль <code>{issued.temporaryPassword}</code>
                      </span>
                      <p>Действует 24 часа. Сотрудник сменит его при входе.</p>
                      <button
                        className="cabinet-button"
                        onClick={() => {
                          const link = new URL(loginPath!, location.origin).href;
                          const invitation = [
                            link,
                            issued.employee.login,
                            issued.temporaryPassword,
                          ].join("\n");
                          navigator.clipboard
                            .writeText(invitation)
                            .then(() => setCopied(true))
                            .catch(() => setError("Не удалось скопировать приглашение."));
                        }}
                      >
                        {copied ? "Скопировано" : "Скопировать приглашение"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )
        )}
      </div>
    </>
  );
}

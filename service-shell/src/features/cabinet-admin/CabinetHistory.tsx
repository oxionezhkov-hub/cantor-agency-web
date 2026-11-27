import { useEffect, useState, type FormEvent } from "react";
import { ServiceDatePicker, ServiceSelect } from "../service/service-controls";
import { SECTIONS } from "../service/sections";
import { cabinetRequest } from "./client";

const accountsPath = "/api/admin/cabinets";
const actions: Record<string, string> = {
  "mobile-menu": "Меню на телефоне",
  "cabinet-profile": "Настройки кабинета",
  "workspace-nav": "Раздел кабинета",
  "workspace-subnav": "Подраздел кабинета",
  "workspace-section": "Переход в разделе",
  "open-ad": "Открытие объявления",
  "open-dialog": "Открытие диалога",
  "commenter-menu": "Меню комментариев",
  "create-comment": "Сохранение комментария",
  "campaign-generate": "Генерация объявления",
  "save-ad": "Сохранение объявления",
  "send-reply": "Отправка ответа",
  configure: "Сохранение подключения",
  activate: "Активация кабинета",
  retry: "Повтор загрузки",
  "employee-create": "Выдача доступа",
  "employee-reset": "Сброс пароля сотрудника",
  "employee-revoke": "Отзыв доступа",
  "password-change": "Смена пароля",
  logout: "Выход из кабинета",
};
const outcomes: Record<string, string> = {
  click: "Нажатие",
  navigate: "Переход",
  attempt: "Попытка",
  changed: "Изменено",
  failed: "Операция не прошла",
};
const fields: Record<string, string> = {
  access: "Доступ",
  configured: "Подключение",
  importStatus: "Загрузка",
  signedIn: "Сеанс",
};
const values: Record<string, string> = {
  temporary: "Временный",
  active: "Действует",
  revoked: "Отозван",
  queued: "В очереди",
  failed: "Ошибка",
  true: "Да",
  false: "Нет",
  null: "—",
};
const any = (label: string) => ({ value: "", label });
const time = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "UTC",
});
type Account = { id: string; name: string };
type Catalog = { accounts: Account[]; cursor: string | null };
type Actor = { id: string; name: string };
type Event = {
  id: string;
  at: string;
  actor: string;
  actorName: string | null;
  section: string;
  action: string;
  outcome: string;
  object: string | null;
  changes: Record<string, [unknown, unknown]> | null;
};
type Page = { events: Event[]; next: string | null };

export function CabinetHistory() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [inventoryCursor, setInventoryCursor] = useState<string | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [actors, setActors] = useState<Actor[]>([]);
  const [actor, setActor] = useState("");
  const [section, setSection] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ search: "", revision: 0 });
  const [page, setPage] = useState<Page | null>(null);
  const [before, setBefore] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    cabinetRequest<Catalog>(accountsPath, undefined, controller.signal)
      .then((catalog) => {
        setAccounts(catalog.accounts);
        setInventoryCursor(catalog.cursor);
      })
      .catch(() => {
        if (!controller.signal.aborted) setInventoryError("Не удалось загрузить кабинеты.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setInventoryLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    cabinetRequest<{ employees: Actor[] }>(
      `${accountsPath}/${workspace}`,
      undefined,
      controller.signal,
    )
      .then(({ employees }) => setActors(employees))
      .catch(() => {
        if (!controller.signal.aborted) setActors([]);
      });
    return () => controller.abort();
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      actor,
      section,
      action,
      from,
      to,
      q: query.search,
      before,
    });
    setLoading(true);
    setError("");
    cabinetRequest<Page>(
      `${accountsPath}/${workspace}/history?${params}`,
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setPage((previous) => ({
          events: before ? [...(previous?.events ?? []), ...data.events] : data.events,
          next: data.next,
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Не удалось загрузить историю.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspace, actor, section, action, from, to, query, before]);

  async function moreAccounts() {
    if (!inventoryCursor) return;
    setInventoryLoading(true);
    setInventoryError("");
    try {
      const params = new URLSearchParams({ cursor: inventoryCursor });
      const catalog = await cabinetRequest<Catalog>(`${accountsPath}?${params}`);
      setAccounts((previous) => [...previous, ...catalog.accounts]);
      setInventoryCursor(catalog.cursor);
    } catch {
      setInventoryError("Не удалось загрузить кабинеты.");
    } finally {
      setInventoryLoading(false);
    }
  }
  function filter() {
    setBefore("");
    setPage(null);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    filter();
    setQuery((previous) => ({ search: search.trim(), revision: previous.revision + 1 }));
  }
  function headingSection(id: string) {
    return SECTIONS.find((item) => item.id === id)?.label ?? id;
  }
  return (
    <section className="cabinet-card cabinet-history" aria-labelledby="cabinet-history-title">
      <h1 id="cabinet-history-title">История действий</h1>
      <form className="cabinet-history-filters" onSubmit={submit}>
        <ServiceSelect
          label="Кабинет"
          value={workspace}
          options={[
            any("Выберите кабинет"),
            ...accounts.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={(value) => {
            if (value === workspace) return;
            filter();
            setActor("");
            setActors([]);
            setError("");
            setWorkspace(value);
          }}
        />
        {inventoryCursor && (
          <button
            className="cabinet-button quiet"
            type="button"
            disabled={inventoryLoading}
            onClick={() => void moreAccounts()}
          >
            Ещё кабинеты
          </button>
        )}
        <ServiceSelect
          label="Сотрудник"
          value={actor}
          disabled={!workspace}
          options={[
            any("Все сотрудники"),
            { value: "owner", label: "Владелец" },
            ...actors.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={(value) => {
            if (value !== actor) {
              filter();
              setActor(value);
            }
          }}
        />
        <ServiceSelect
          label="Раздел"
          value={section}
          options={[any("Все разделы"), ...SECTIONS.map(({ id, label }) => ({ value: id, label }))]}
          onChange={(value) => {
            if (value !== section) {
              filter();
              setSection(value);
            }
          }}
        />
        <ServiceSelect
          label="Действие"
          value={action}
          options={[
            any("Все действия"),
            ...Object.entries(actions).map(([value, label]) => ({ value, label })),
          ]}
          onChange={(value) => {
            if (value !== action) {
              filter();
              setAction(value);
            }
          }}
        />
        <ServiceDatePicker
          label="С даты (UTC)"
          value={from}
          max={to || undefined}
          onChange={(value) => {
            if (value !== from) {
              filter();
              setFrom(value);
            }
          }}
        />
        <ServiceDatePicker
          label="По дату (UTC)"
          value={to}
          min={from || undefined}
          onChange={(value) => {
            if (value !== to) {
              filter();
              setTo(value);
            }
          }}
        />
        <label>
          Поиск по сотруднику или ID
          <input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={80} />
        </label>
        <button type="submit" className="cabinet-button primary" disabled={!workspace}>
          Найти
        </button>
      </form>
      {inventoryError && (
        <p className="cabinet-error" role="alert">
          {inventoryError}
        </p>
      )}
      {error && (
        <p className="cabinet-error" role="alert">
          {error}
        </p>
      )}
      {(loading || inventoryLoading) && <p role="status">Загружаем…</p>}
      {!loading && page?.events.length === 0 && <p role="status">Действия не найдены.</p>}
      {page && page.events.length > 0 && (
        <div
          className="cabinet-history-table"
          tabIndex={0}
          role="region"
          aria-label="Записи истории действий"
        >
          <table>
            <thead>
              <tr>
                <th>Время (UTC)</th>
                <th>Сотрудник</th>
                <th>Раздел</th>
                <th>Действие</th>
                <th>Объект</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {page.events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <time dateTime={event.at}>{time.format(new Date(event.at))}</time>
                  </td>
                  <td>{event.actorName || (event.actor === "owner" ? "Владелец" : event.actor)}</td>
                  <td>{headingSection(event.section)}</td>
                  <td>{actions[event.action] || event.action}</td>
                  <td>
                    {event.object ? actions[event.object] || headingSection(event.object) : "—"}
                  </td>
                  <td>
                    {outcomes[event.outcome] || event.outcome}
                    {Object.entries(event.changes || {}).map(([field, [previous, next]]) => (
                      <small key={field}>
                        {fields[field]} · {values[String(previous)]} → {values[String(next)]}
                      </small>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page?.next && (
        <button
          className="cabinet-button quiet"
          disabled={loading}
          onClick={() => {
            if (page.next === before)
              setQuery((previous) => ({ ...previous, revision: previous.revision + 1 }));
            else setBefore(page.next!);
          }}
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}

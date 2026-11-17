import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
  cloneElement,
  isValidElement,
  useId,
} from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Search,
  Check,
  Copy,
  FileSpreadsheet,
  ImagePlus,
  Sparkles,
  X,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  MapPin,
  Eye,
} from "lucide-react";
import { ads as samples } from "./data";
import "./ads-workspace.css";
import { AdsSelect, AdsHelp } from "./ads-controls";
import { bidModes, timeOptions } from "./ads-options";
import { getPreviewData, previewTotals } from "./preview-data";

type Listing = {
  id: string;
  title: string;
  text: string;
  city: string;
  price: number;
  status: "published" | "draft";
  source: "cantor" | "sheet";
  photos: string[];
  views: number;
  contacts: number;
  spend: number;
  bid: number;
  mode: string;
  max: number;
  budget: number;
  target: number;
  query: string;
  start: string;
  end: string;
};
type State = {
  items: Listing[];
  sheet: string;
  tab: string;
  history: { at: string; text: string }[];
};
const KEY = "cantor-ads-workspace-v1";
const initial: State = {
  items: samples.map((a, i) => ({
    id: a.id,
    title: a.title,
    text: a.text,
    city: a.cities[0]?.city ?? "Москва",
    price: getPreviewData() ? getPreviewData()!.ads.find(item => item.id === a.id)?.price ?? NaN : 2000,
    status: getPreviewData() ? getPreviewData()!.ads.find(item => item.id === a.id)?.status === "active" ? "published" : "draft" : i === 2 ? "draft" : "published",
    source: "cantor",
    photos: [],
    views: a.views,
    contacts: a.contacts,
    spend: a.spendRub,
    bid: a.cities[0]?.bidRub ?? 20,
    mode: getPreviewData() ? "" : "manual",
    max: getPreviewData() ? NaN : 80,
    budget: getPreviewData() ? NaN : 500,
    target: getPreviewData() ? NaN : 10,
    query: getPreviewData() ? "репетитор по русскому языку" : "репетитор по математике",
    start: getPreviewData() ? "" : "09:00",
    end: getPreviewData() ? "" : "21:00",
  })),
  sheet: "",
  tab: "Авито_выгрузка",
  history: [],
};
function load(): State {
  if (getPreviewData()) return initial;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return s?.items && Array.isArray(s.history) ? s : initial;
  } catch {
    return initial;
  }
}
function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["\ufeff", text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const rub = (n: number) => Number.isFinite(n) ? `${n.toLocaleString("ru-RU")} ₽` : "—";
function cover(title: string, city: string) {
  const escape = (v: string) =>
    v
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const words = title.split(" "),
    lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).length > 21) {
      lines.push(line);
      line = word;
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#f4f1eb"/><circle cx="715" cy="75" r="145" fill="#f1c2ae"/><circle cx="740" cy="600" r="190" fill="#e8e4da"/><path d="M55 85h50m-25-25v50" stroke="#e8391d" stroke-width="6"/><text x="55" y="170" font-family="sans-serif" font-size="18" letter-spacing="3" fill="#81776d">ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ</text>${lines
        .slice(0, 4)
        .map(
          (l, i) =>
            `<text x="55" y="${245 + i * 60}" font-family="sans-serif" font-weight="600" font-size="46" fill="#23201c">${escape(l)}</text>`,
        )
        .join(
          "",
        )}<text x="55" y="550" font-family="sans-serif" font-size="22" fill="#81776d">${escape(city)}</text></svg>`,
    )
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const native =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "textarea", "select"].includes(children.type);
  return (
    <div className="aw-field">
      <label htmlFor={native ? id : undefined}>{label}</label>
      {native ? cloneElement(children as ReactElement<{ id: string }>, { id }) : children}
    </div>
  );
}
export function AdsWorkspace({ focus }: { focus?: string }) {
  const [state, setState] = useState<State>(load);
  const [tab, setTab] = useState("list");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [edit, setEdit] = useState<Listing | null>(() =>
    focus ? (load().items.find((a) => a.id === focus) ?? null) : null,
  );
  const [editorTab, setEditorTab] = useState("content");
  const [sheet, setSheet] = useState(state.sheet);
  const [sheetTab, setSheetTab] = useState(state.tab);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [candidate, setCandidate] = useState<{
    kind: "title" | "text" | "photo";
    value: string;
  } | null>(null);
  const [photoCaption, setPhotoCaption] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const [bulkBid, setBulkBid] = useState(30);
  const dialogRef = useRef<HTMLElement>(null);
  const editing = edit !== null;
  useEffect(() => {
    if (!editing) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const nodes = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, textarea, select, [tabindex="0"]',
        ) ?? []),
      ].filter((n) => n.offsetParent !== null);
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", trap);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [editing]);
  function persist(next: State) {
    if (getPreviewData()) { setNotice("Недостаточно прав для изменения"); return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setState(next);
      return true;
    } catch {
      setNotice("Не удалось сохранить: хранилище браузера заполнено или недоступно.");
      return false;
    }
  }
  function commit(items: Listing[], text: string) {
    return persist({
      ...state,
      items,
      history: [{ at: new Date().toISOString(), text }, ...state.history].slice(0, 100),
    });
  }
  function open(a: Listing) {
    setEdit({ ...a, photos: [...a.photos] });
    setEditorTab("content");
    setCandidate(null);
    setPreview(false);
    setNotice("");
    setImageUrl("");
  }
  function create() {
    open({
      ...initial.items[2],
      id: crypto.randomUUID(),
      title: "",
      text: "",
      status: "draft",
      photos: [],
      views: 0,
      contacts: 0,
      spend: 0,
    });
  }
  function save() {
    if (!edit) return;
    if (!edit.title.trim() || !edit.text.trim() || !edit.city.trim())
      return setNotice("Заполните заголовок, текст и город.");
    if (edit.price < 0 || edit.bid < 0 || edit.max < edit.bid || edit.budget < 0)
      return setNotice(
        "Проверьте цену, бюджет и предел ставки. Максимум должен быть не ниже ставки.",
      );
    if (edit.mode === "position" && (!edit.query.trim() || edit.target < 1))
      return setNotice("Для стратегии по позиции укажите запрос и целевое место.");
    const existing = state.items.some((a) => a.id === edit.id);
    if (
      commit(
        existing ? state.items.map((a) => (a.id === edit.id ? edit : a)) : [...state.items, edit],
        `Сохранено объявление «${edit.title}»`,
      )
    ) {
      setEdit(null);
      setNotice("Изменения сохранены в этом браузере.");
    }
  }
  const visible = state.items.filter(
    (a) =>
      (!query || `${a.title} ${a.city} ${a.id}`.toLowerCase().includes(query.toLowerCase())) &&
      (filter === "all" || a.status === filter),
  );
  const total = state.items.reduce(
    (s, a) => ({
      views: s.views + a.views,
      contacts: s.contacts + a.contacts,
      spend: s.spend + a.spend,
    }),
    { views: 0, contacts: 0, spend: 0 },
  );
  const sheetValid = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+/.test(sheet);
  function propose(kind: "title" | "text" | "photo") {
    if (getPreviewData()) return setNotice("Недостаточно прав для изменения");
    if (!edit) return;
    if (kind === "photo") {
      setPhotoCaption(edit.title || "Математика");
      setCandidate({ kind, value: cover(edit.title || "Математика", edit.city) });
    } else
      setCandidate({
        kind,
        value:
          kind === "title"
            ? edit.title || "Индивидуальные занятия по математике"
            : edit.text ||
              `Индивидуальные занятия по математике. Город: ${edit.city}. Стоимость занятия — ${edit.price} ₽. Напишите, чтобы обсудить вашу задачу и удобное время.`,
      });
  }
  function acceptCandidate() {
    if (!candidate || !edit) return;
    const value = candidate.kind === "photo" ? candidate.value : candidate.value.trim();
    if (!value) return setNotice("Вариант не может быть пустым.");
    setEdit(
      candidate.kind === "photo"
        ? { ...edit, photos: [...edit.photos, value] }
        : { ...edit, [candidate.kind]: value },
    );
    setCandidate(null);
  }
  const sourceOptions = [
    { value: "cantor", label: "В сервисе" },
    { value: "sheet", label: "Google Таблица" },
  ];
  const sheetSaved = Boolean(state.sheet && state.sheet === sheet && state.tab === sheetTab);
  const suggestion = candidate && (
    <div className="aw-suggestion" aria-label="Предложенный вариант">
      <div className="aw-suggestion-heading">
        <span>
          <Sparkles size={14} />
          Пример варианта
        </span>
        <AdsHelp label="О варианте">
          Пока ИИ не подключён, здесь показан пример для проверки сценария согласования. Он не
          применяется без вашего решения.
        </AdsHelp>
      </div>
      {candidate.kind === "photo" ? (
        <>
          <img className="aw-candidate-image" src={candidate.value} alt="Вариант обложки" />
          <Field label="Текст на обложке">
            <input
              value={photoCaption}
              onChange={(e) => {
                setPhotoCaption(e.target.value);
                setCandidate({ ...candidate, value: cover(e.target.value, edit?.city || "") });
              }}
            />
          </Field>
        </>
      ) : (
        <Field label={candidate.kind === "title" ? "Вариант заголовка" : "Вариант текста"}>
          <textarea
            rows={candidate.kind === "title" ? 2 : 5}
            value={candidate.value}
            onChange={(e) => setCandidate({ ...candidate, value: e.target.value })}
          />
        </Field>
      )}
      <div className="aw-suggestion-actions">
        <button className="aw-btn aw-primary" onClick={acceptCandidate}>
          <Check size={14} />
          Принять вариант
        </button>
        <button className="aw-btn aw-quiet" onClick={() => setCandidate(null)}>
          Не использовать
        </button>
      </div>
    </div>
  );
  return (
    <div className="aw">
      <div className="aw-top">
        <div className="aw-tabs" role="tablist" aria-label="Работа с объявлениями">
          {[
            ["list", "Объявления"],
            ["feeds", "Автозагрузка"],
            ["bids", "Ставки"],
            ["history", "История"],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setNotice("");
              }}
            >
              {label}
              {id === "list" && <span>{state.items.length}</span>}
            </button>
          ))}
        </div>
        <AdsHelp label="Как начать работу">
          Создайте объявление или подключите таблицу, затем настройте продвижение.
        </AdsHelp>
      </div>
      {notice && (
        <div className="aw-notice" role="status">
          {notice}
          <button aria-label="Скрыть уведомление" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {tab === "list" && (
        <>
          <div className="aw-summary">
            {[
              [state.items.filter((a) => a.status === "published").length, "в публикации"],
              [getPreviewData() ? previewTotals("2026-11-01", "2026-11-30").views : total.views, "просмотров"],
              [getPreviewData() ? previewTotals("2026-11-01", "2026-11-30").contacts : total.contacts, "контактов"],
              [rub(getPreviewData() ? previewTotals("2026-11-01", "2026-11-30").budget : total.spend), "расходы за ноябрь"],
            ].map(([v, l]) => (
              <div key={l}>
                <strong>{v}</strong>
                <span>{l}</span>
              </div>
            ))}
          </div>
          <div className="aw-tools">
            <div className="aw-search">
              <Search size={17} />
              <input
                aria-label="Поиск объявлений"
                placeholder="Название, город или номер"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <AdsSelect
              label="Статус объявлений"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "Все статусы" },
                { value: "published", label: "В публикации" },
                { value: "draft", label: "Черновики" },
              ]}
            />
            <button className="aw-btn aw-primary" onClick={create}>
              <Plus size={17} />
              Создать объявление
            </button>
          </div>
          {selected.length > 0 && (
            <div className="aw-bulk">
              <strong>Выбрано: {selected.length}</strong>
              <button
                onClick={() => {
                  commit(
                    state.items.map((a) =>
                      selected.includes(a.id) ? { ...a, status: "draft" } : a,
                    ),
                    `Переведено в черновики: ${selected.length}`,
                  );
                  setSelected([]);
                }}
              >
                В черновики
              </button>
              <button onClick={() => setTab("bids")}>Настроить ставки</button>
              <button onClick={() => setSelected([])}>Снять выбор</button>
            </div>
          )}
          <div className="aw-table-wrap">
            <table className="aw-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Выбрать все объявления"
                      checked={visible.length > 0 && visible.every((a) => selected.includes(a.id))}
                      onChange={(e) =>
                        setSelected(e.target.checked ? visible.map((a) => a.id) : [])
                      }
                    />
                  </th>
                  <th>Объявление</th>
                  <th>Статус</th>
                  <th>Просмотры</th>
                  <th>Контакты</th>
                  <th>Расходы</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((a, i) => (
                  <tr key={a.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Выбрать ${a.title}`}
                        checked={selected.includes(a.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, a.id]
                              : selected.filter((id) => id !== a.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button className="aw-ad" onClick={() => open(a)}>
                        <span className={`aw-thumb aw-thumb-${i % 3}`}>
                          {a.photos[0] ? (
                            <img src={a.photos[0]} alt="" />
                          ) : (
                            <span>
                              {a.title.includes("ОГЭ")
                                ? "ОГЭ"
                                : a.title.includes("ЕГЭ")
                                  ? "ЕГЭ"
                                  : "8 кл."}
                              <small>МАТЕМАТИКА</small>
                            </span>
                          )}
                        </span>
                        <span>
                          <strong>{a.title}</strong>
                          <small>
                            {a.city} · {rub(a.price)}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className={`aw-status ${a.status === "draft" ? "draft" : ""}`}>
                        <i />
                        {a.status === "draft" ? "Черновик" : "В публикации"}
                      </span>
                    </td>
                    <td>{a.views || "—"}</td>
                    <td>{a.contacts || "—"}</td>
                    <td>{a.spend ? rub(a.spend) : "—"}</td>
                    <td>
                      <button
                        className="aw-icon"
                        aria-label={`Редактировать ${a.title}`}
                        onClick={() => open(a)}
                      >
                        <SlidersHorizontal size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <div className="aw-empty">
                Объявлений не найдено. Измените фильтр или создайте новое.
              </div>
            )}
          </div>
        </>
      )}
      {tab === "feeds" && (
        <div className={`aw-feed-layout ${sheetSaved ? "" : "first-step"}`}>
          <div className="aw-panel">
            <div className="aw-panel-heading">
              <span className="aw-eyebrow">01 · ТАБЛИЦА</span>
              <AdsHelp label="Как подключить таблицу">
                Скачайте шаблон и импортируйте в Google Таблицы: Файл → Импорт → Загрузить. Откройте
                доступ по ссылке для чтения. У каждой строки должен быть постоянный Id, у фото —
                прямая ссылка.
              </AdsHelp>
            </div>
            <div className="aw-form">
              <Field label="Ссылка на Google Таблицу">
                <input
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  value={sheet}
                  onChange={(e) => setSheet(e.target.value)}
                />
              </Field>
              <Field label="Вкладка с объявлениями">
                <input value={sheetTab} onChange={(e) => setSheetTab(e.target.value)} />
              </Field>
              <div className="aw-feed-actions">
                <button
                  className="aw-btn aw-primary"
                  onClick={() => {
                    if (!sheetValid || !sheetTab.trim())
                      return setNotice(
                        "Укажите корректную ссылку Google Таблицы и название вкладки.",
                      );
                    if (
                      persist({
                        ...state,
                        sheet,
                        tab: sheetTab,
                        history: [
                          {
                            at: new Date().toISOString(),
                            text: "Сохранены настройки Google Таблицы",
                          },
                          ...state.history,
                        ],
                      })
                    )
                      setNotice(
                        "Настройки сохранены. Чтение таблицы появится после подключения интеграции.",
                      );
                  }}
                >
                  Сохранить настройки
                </button>
                <button
                  className="aw-text-button"
                  onClick={() =>
                    download(
                      "cantor-avito-template.csv",
                      "Id;Title;Description;Price;Address;ImageUrls\nexample-001;Репетитор по математике;Описание занятий;2000;Москва;https://example.com/photo.jpg\n",
                    )
                  }
                >
                  <FileSpreadsheet size={15} />
                  Шаблон таблицы
                </button>
              </div>
            </div>
          </div>
          {sheetSaved && (
            <>
              <div className="aw-panel">
                <div className="aw-panel-heading">
                  <span className="aw-eyebrow">02 · ПРОВЕРКА</span>
                  <AdsHelp label="О проверке таблицы">
                    Проверяем доступ, обязательные поля, постоянные Id и ссылки на фотографии. Перед
                    заменой существующего фида сравниваем изменения. Чтение таблицы пока не
                    подключено.
                  </AdsHelp>
                </div>
                <div className="aw-pending">
                  <span className="aw-pending-dot" />
                  Ожидает подключения интеграции
                </div>
              </div>
              <div className="aw-panel">
                <div className="aw-panel-heading">
                  <span className="aw-eyebrow">03 · АВТОЗАГРУЗКА</span>
                  <AdsHelp label="Как подключить XML">
                    После успешной проверки здесь появится персональная XML-ссылка. Её нужно указать
                    в настройках автозагрузки Авито, затем выбрать расписание и проверить отчёт.
                  </AdsHelp>
                </div>
                <div className="aw-placeholder">XML ещё не сформирован</div>
              </div>
            </>
          )}
        </div>
      )}
      {tab === "bids" && (
        <>
          <div className="aw-bids-toolbar">
            {getPreviewData() ? null : <span className="aw-status draft">Авито не подключено</span>}
            <AdsHelp label="Как работают ставки">
              Ставка — цена за просмотр. Выберите режим рядом с объявлением, нажмите ставку для её
              изменения. В режиме по позиции нужны запрос, город и предел ставки.
            </AdsHelp>
          </div>
          {selected.length > 0 && (
            <div className="aw-bulk">
              <strong>Выбрано: {selected.length}</strong>
              <Field label="Ставка, ₽">
                <input
                  type="number"
                  min="0"
                  value={bulkBid}
                  onChange={(e) => setBulkBid(Number(e.target.value))}
                />
              </Field>
              <button
                onClick={() => {
                  if (getPreviewData()) return setNotice("Недостаточно прав для изменения");
                  if (bulkBid < 0 || !Number.isFinite(bulkBid))
                    return setNotice("Укажите ставку от 0 ₽.");
                  commit(
                    state.items.map((a) =>
                      selected.includes(a.id)
                        ? { ...a, bid: bulkBid, max: Math.max(a.max, bulkBid) }
                        : a,
                    ),
                    `Массовая ставка ${bulkBid} ₽ для ${selected.length} объявлений`,
                  );
                  setNotice("Ставки сохранены локально. В Авито не отправлены.");
                }}
              >
                Сохранить для выбранных
              </button>
            </div>
          )}
          <div className="aw-table-wrap">
            <table className="aw-table">
              <thead>
                <tr>
                  <th>Объявление</th>
                  <th>Режим</th>
                  <th>Ставка</th>
                  <th>Бюджет в день</th>
                  <th>Позиция</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.items.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <button
                        className="aw-link"
                        onClick={() => {
                          open(a);
                          setEditorTab("promotion");
                        }}
                      >
                        {a.title}
                        <small>{a.city}</small>
                      </button>
                    </td>
                    <td>
                      <AdsSelect
                        label={`Режим ${a.title}`}
                        value={a.mode}
                        options={bidModes}
                        compact
                        onChange={(mode) =>
                          commit(
                            state.items.map((item) =>
                              item.id === a.id ? { ...item, mode } : item,
                            ),
                            `Изменён режим «${a.title}»`,
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="aw-value-button"
                        aria-label={`Изменить ставку ${a.title}`}
                        onClick={() => {
                          open(a);
                          setEditorTab("promotion");
                        }}
                      >
                        {rub(a.bid)}
                      </button>
                    </td>
                    <td>{rub(a.budget)}</td>
                    <td>
                      <span className="aw-muted">Нет замера</span>
                    </td>
                    <td>
                      <button
                        className="aw-btn"
                        onClick={() => {
                          open(a);
                          setEditorTab("promotion");
                        }}
                      >
                        Настроить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "history" && (
        <div className="aw-history-list">
          {state.history.length ? (
            state.history.map((h, i) => (
              <div className="aw-history" key={i}>
                <span>
                  <Check size={17} />
                </span>
                <div>
                  <strong>{h.text}</strong>
                  <small>
                    {new Date(h.at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК · Вы
                  </small>
                </div>
              </div>
            ))
          ) : (
            <div className="aw-empty">
              Пока нет изменений. Сохраните объявление — действие появится здесь.
            </div>
          )}
        </div>
      )}
      {edit &&
        createPortal(
          <div
            className="aw aw-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEdit(null);
            }}
          >
            <section
              ref={dialogRef}
              className="aw-editor"
              role="dialog"
              aria-modal="true"
              aria-label="Редактор объявления"
              onKeyDown={(e) => {
                if (e.key === "Escape") setEdit(null);
              }}
            >
              <header>
                <div>
                  <small>
                    {state.items.some((a) => a.id === edit.id)
                      ? "Редактирование"
                      : "Создание объявления"}
                  </small>
                  <h2>
                    {state.items.some((a) => a.id === edit.id) ? edit.title : "Новое объявление"}
                  </h2>
                </div>
                <button
                  className="aw-icon"
                  aria-label="Закрыть редактор"
                  onClick={() => setEdit(null)}
                >
                  <X />
                </button>
              </header>
              <div className="aw-tabs">
                {[
                  ["content", "Содержание"],
                  ["photos", `Фотографии · ${edit.photos.length}`],
                  ["promotion", "Ставка и расписание"],
                ].map(([id, label]) => (
                  <button key={id} onClick={() => setEditorTab(id)} aria-pressed={editorTab === id}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="aw-editor-layout">
                <div className="aw-editor-body">
                  {notice && (
                    <div className="aw-notice" role="status">
                      {notice}
                    </div>
                  )}
                  {editorTab === "content" && (
                    <div className="aw-form">
                      <div className="aw-grid aw-location">
                        <Field label="Город размещения">
                          <div className="aw-city-input">
                            <MapPin size={16} />
                            <input
                              aria-label="Город"
                              placeholder="Введите город"
                              value={edit.city}
                              onChange={(e) => setEdit({ ...edit, city: e.target.value })}
                            />
                          </div>
                        </Field>
                        <Field label="Цена занятия, ₽">
                          <input
                            type="number"
                            min="0"
                            value={Number.isFinite(edit.price) ? edit.price : ""}
                            onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })}
                          />
                        </Field>
                      </div>
                      <div>
                        <div className="aw-field-heading">
                          <label htmlFor="aw-title">Заголовок</label>
                          <button className="aw-ai-button" onClick={() => propose("title")}>
                            <Sparkles size={14} />
                            Предложить заголовок
                          </button>
                        </div>
                        <input
                          id="aw-title"
                          className="aw-input"
                          value={edit.title}
                          placeholder="Например, подготовка к ЕГЭ"
                          maxLength={100}
                          onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                        />
                        {candidate?.kind === "title" && suggestion}
                      </div>
                      <div>
                        <div className="aw-field-heading">
                          <label htmlFor="aw-text">Текст объявления</label>
                          <button className="aw-ai-button" onClick={() => propose("text")}>
                            <Sparkles size={14} />
                            Предложить текст
                          </button>
                        </div>
                        <textarea
                          id="aw-text"
                          className="aw-input"
                          rows={7}
                          placeholder="Расскажите о занятиях, формате и первой встрече"
                          value={edit.text}
                          onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                        />
                        {candidate?.kind === "text" && suggestion}
                      </div>
                      <div className="aw-editor-meta">
                        <Field label="Управление объявлением">
                          <AdsSelect
                            label="Источник управления"
                            value={edit.source}
                            options={sourceOptions}
                            onChange={(source) =>
                              setEdit({ ...edit, source: source as Listing["source"] })
                            }
                          />
                        </Field>
                        <AdsHelp label="Об источнике управления">
                          Выберите, где редактировать объявление.
                        </AdsHelp>
                      </div>
                      {state.items.some((a) => a.id === edit.id) && (
                        <button
                          className="aw-text-button"
                          onClick={() =>
                            open({
                              ...edit,
                              id: crypto.randomUUID(),
                              title: `${edit.title} — копия`,
                              status: "draft",
                              views: 0,
                              contacts: 0,
                              spend: 0,
                            })
                          }
                        >
                          <Copy size={14} />
                          Дублировать
                        </button>
                      )}
                    </div>
                  )}
                  {editorTab === "photos" && (
                    <>
                      <div className="aw-photo-toolbar">
                        <button className="aw-ai-button" onClick={() => propose("photo")}>
                          <Sparkles size={15} />
                          Создать с ИИ
                        </button>
                        <AdsHelp label="О фотографиях">
                          Первое изображение — обложка. Меняйте порядок стрелками.
                        </AdsHelp>
                      </div>
                      {candidate?.kind === "photo" && suggestion}
                      {!edit.photos.length && candidate?.kind !== "photo" && (
                        <div className="aw-photo-empty">
                          <ImagePlus size={28} />
                          <span>Добавьте первую фотографию</span>
                        </div>
                      )}
                      <div className="aw-photo-grid">
                        {edit.photos.map((url, i) => (
                          <div className="aw-photo" key={`${url}-${i}`}>
                            <img src={url} alt={`Фотография ${i + 1}`} />
                            <div>
                              <button
                                aria-label={`Переместить фото ${i + 1} выше`}
                                disabled={i === 0}
                                onClick={() => {
                                  const p = [...edit.photos];
                                  [p[i - 1], p[i]] = [p[i], p[i - 1]];
                                  setEdit({ ...edit, photos: p });
                                }}
                              >
                                <ArrowUp size={15} />
                              </button>
                              <button
                                aria-label={`Переместить фото ${i + 1} ниже`}
                                disabled={i === edit.photos.length - 1}
                                onClick={() => {
                                  const p = [...edit.photos];
                                  [p[i + 1], p[i]] = [p[i], p[i + 1]];
                                  setEdit({ ...edit, photos: p });
                                }}
                              >
                                <ArrowDown size={15} />
                              </button>
                              <button
                                aria-label={`Удалить фото ${i + 1}`}
                                onClick={() =>
                                  setEdit({
                                    ...edit,
                                    photos: edit.photos.filter((_, j) => j !== i),
                                  })
                                }
                              >
                                <X size={15} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="aw-form">
                        <Field label="Прямая ссылка на изображение">
                          <input
                            type="url"
                            value={imageUrl}
                            placeholder="https://…/photo.jpg"
                            onChange={(e) => setImageUrl(e.target.value)}
                          />
                        </Field>
                        <button
                          className="aw-btn"
                          onClick={() => {
                            try {
                              const u = new URL(imageUrl);
                              if (u.protocol !== "https:") throw Error();
                              setEdit({ ...edit, photos: [...edit.photos, u.href] });
                              setImageUrl("");
                            } catch {
                              setNotice("Укажите HTTPS-ссылку на изображение.");
                            }
                          }}
                        >
                          <ImagePlus size={17} />
                          Добавить по ссылке
                        </button>
                        <Field label="Или загрузите файл">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              if (f.size > 1500000)
                                return setNotice("Для превью выберите изображение до 1,5 МБ.");
                              const r = new FileReader();
                              r.onload = () =>
                                setEdit({ ...edit, photos: [...edit.photos, String(r.result)] });
                              r.readAsDataURL(f);
                            }}
                          />
                        </Field>
                      </div>
                    </>
                  )}
                  {editorTab === "promotion" && (
                    <div className="aw-form">
                      <div className="aw-mode-row">
                        <Field label="Режим управления">
                          <AdsSelect
                            label="Режим управления"
                            value={edit.mode}
                            options={bidModes}
                            onChange={(mode) => setEdit({ ...edit, mode })}
                          />
                        </Field>
                        <AdsHelp label="О режимах ставок">
                          Вручную — ваша ставка. С рекомендациями — изменения после вашего решения.
                          По позиции — будущий биддер в заданных пределах; сейчас настройки не
                          отправляются в Авито.
                        </AdsHelp>
                      </div>
                      <div className="aw-grid">
                        <Field label="Ставка за просмотр, ₽">
                          <input
                            type="number"
                            min="0"
                            value={Number.isFinite(edit.bid) ? edit.bid : ""}
                            onChange={(e) => setEdit({ ...edit, bid: Number(e.target.value) })}
                          />
                        </Field>
                        <Field label="Максимальная ставка, ₽">
                          <input
                            type="number"
                            min="0"
                            value={Number.isFinite(edit.max) ? edit.max : ""}
                            onChange={(e) => setEdit({ ...edit, max: Number(e.target.value) })}
                          />
                        </Field>
                        <Field label="Дневной бюджет, ₽">
                          <input
                            type="number"
                            min="0"
                            value={Number.isFinite(edit.budget) ? edit.budget : ""}
                            onChange={(e) => setEdit({ ...edit, budget: Number(e.target.value) })}
                          />
                        </Field>
                        {edit.mode === "position" && (
                          <Field label="Целевая позиция">
                            <input
                              type="number"
                              min="1"
                              value={Number.isFinite(edit.target) ? edit.target : ""}
                              onChange={(e) => setEdit({ ...edit, target: Number(e.target.value) })}
                            />
                          </Field>
                        )}
                      </div>
                      {edit.mode === "position" && (
                        <>
                          <Field label="Поисковый запрос">
                            <input
                              value={edit.query}
                              onChange={(e) => setEdit({ ...edit, query: e.target.value })}
                            />
                          </Field>
                          <Field label="Город замера">
                            <input
                              value={edit.city}
                              onChange={(e) => setEdit({ ...edit, city: e.target.value })}
                            />
                          </Field>
                        </>
                      )}
                      <div className="aw-grid">
                        <Field label="Работать с, МСК">
                          <AdsSelect
                            label="Работать с, МСК"
                            value={edit.start}
                            options={timeOptions}
                            onChange={(start) => setEdit({ ...edit, start })}
                          />
                        </Field>
                        <Field label="Работать до, МСК">
                          <AdsSelect
                            label="Работать до, МСК"
                            value={edit.end}
                            options={timeOptions}
                            onChange={(end) => setEdit({ ...edit, end })}
                          />
                        </Field>
                      </div>
                    </div>
                  )}
                </div>
                <aside className={`aw-live-preview ${preview ? "mobile-open" : ""}`}>
                  <div className="aw-preview-heading">
                    <span>Предпросмотр</span>
                    <button
                      className="aw-icon aw-mobile-close"
                      aria-label="Скрыть предпросмотр"
                      onClick={() => setPreview(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="aw-preview-image">
                    {edit.photos[0] ? (
                      <img src={edit.photos[0]} alt="Обложка объявления" />
                    ) : (
                      <ImagePlus size={36} />
                    )}
                  </div>
                  <div className="aw-preview-content">
                    <h3>{edit.title || "Заголовок объявления"}</h3>
                    <strong>{rub(edit.price)}</strong>
                    <span>
                      <MapPin size={12} />
                      {edit.city || "Город"}
                    </span>
                    <p>{edit.text || "Текст вашего объявления появится здесь"}</p>
                  </div>
                </aside>
              </div>
              <footer>
                <button
                  className="aw-text-button aw-preview-toggle"
                  onClick={() => setPreview(!preview)}
                >
                  <Eye size={15} />
                  Предпросмотр
                </button>
                <AdsHelp label="О сохранении">
                  Проверьте заголовок, текст и фотографии перед сохранением.
                </AdsHelp>
                <button className="aw-btn" onClick={() => setEdit(null)}>
                  Отмена
                </button>
                <button className="aw-btn aw-primary" onClick={save}>
                  Сохранить
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}

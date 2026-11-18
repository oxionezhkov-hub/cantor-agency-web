import { useMemo, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { AdsSelect, AdsHelp } from "./ads-controls";
import "./offer-mailings.css";
type Ad = { id: string; title: string; city: string; status: string };
export function OfferMailings({ ads }: { ads: Ad[] }) {
  const [ids, setIds] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [city, setCity] = useState(""),
    [message, setMessage] = useState("");
  const active = useMemo(() => ads.filter((a) => a.status === "published"), [ads]);
  const cities = useMemo(
    () => [...new Set(active.map((a) => a.city))].sort((a, b) => a.localeCompare(b, "ru")),
    [active],
  );
  const visible = active.filter(
    (a) =>
      (!city || a.city === city) &&
      `${a.title} ${a.city}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="om">
      <div className="om-heading">
        <h2>Рассылки</h2>
        <AdsHelp label="Как устроены рассылки Авито">
          Сначала проверяется доступность объявлений. Авито возвращает варианты предложения,
          доступную аудиторию и стоимость. Текст задаётся Авито. Подтверждение отправляет и
          оплачивает рассылку; в превью оно не подключено.
        </AdsHelp>
      </div>
      <div className="om-layout">
        <section className="om-panel">
          <div className="om-picker-heading">
            <strong>Объявления · {ids.length} выбрано</strong>
            <AdsHelp label="Какие объявления доступны">
              Статус «В публикации» не гарантирует доступность рассылки. Она проверяется в Авито
              отдельно для каждого объявления с причиной отказа.
            </AdsHelp>
          </div>
          <div className="om-filters">
            <input
              aria-label="Поиск объявлений для рассылки"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название или город"
            />
            <AdsSelect
              label="Город объявлений рассылки"
              value={city}
              onChange={setCity}
              options={[
                { value: "", label: "Все города" },
                ...cities.map((x) => ({ value: x, label: x })),
              ]}
            />
          </div>
          <div className="om-select-actions">
            <button onClick={() => setIds([...new Set([...ids, ...visible.map((a) => a.id)])])}>
              Выбрать найденные ({visible.length})
            </button>
            <button onClick={() => setIds([])}>Снять выбор</button>
          </div>
          <div className="om-ads">
            {visible.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(a.id)}
                  onChange={(e) =>
                    setIds(e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id))
                  }
                />
                <span>
                  <strong>{a.title}</strong>
                  <small>{a.city}</small>
                </span>
              </label>
            ))}
            {!visible.length && <p>Подходящих публикаций нет.</p>}
          </div>
          <div className="om-actions om-check">
            <button
              className="aw-btn aw-primary"
              disabled={!ids.length}
              onClick={() =>
                setMessage(
                  "Проверка доступности рассылок пока не подключена. Данные из Авито не получены; рассылка не создана.",
                )
              }
            >
              Проверить доступность
            </button>
          </div>
          {message && (
            <div className="aw-notice" role="status">
              {message}
              <button aria-label="Скрыть уведомление рассылок" onClick={() => setMessage("")}>
                <X size={15} />
              </button>
            </div>
          )}
        </section>
        <aside className="om-panel om-summary">
          <div className="om-heading">
            <h3>Предложения Авито</h3>
            <Megaphone size={18} />
          </div>
          <p>Варианты появятся после получения данных из Авито.</p>
          <ol className="om-process">
            <li>
              <strong>Доступность объявлений</strong>
              <span>Проверка каждого объявления и причины отказа.</span>
            </li>
            <li>
              <strong>Вариант и аудитория</strong>
              <span>
                Предложения и доступное число получателей из ответа Авито. Размер скидки — только
                для предложения со скидкой.
              </span>
            </li>
            <li>
              <strong>Проверка и оплата</strong>
              <span>
                Количество получателей, допустимый срок действия и стоимость перед подтверждением
                отправки.
              </span>
            </li>
          </ol>
          <AdsHelp label="О результатах рассылки">
            Отчёт Авито содержит отправленные и принятые предложения, стоимость, дату отправки и
            срок действия. Принятое предложение не является автоматически оплатой занятий или новым
            учеником.
          </AdsHelp>
        </aside>
      </div>
    </div>
  );
}

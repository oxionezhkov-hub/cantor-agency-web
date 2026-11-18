import { useMemo, useState } from "react";
import { Check, Copy, Megaphone, X } from "lucide-react";
import { ServiceDatePicker } from "./service-controls";
import { AdsSelect, AdsHelp } from "./ads-controls";
import { timeOptions } from "./ads-options";
import "./offer-mailings.css";

type Ad = { id: string; title: string; city: string; status: string };
type Plan = {
  id: string;
  name: string;
  text: string;
  ids: string[];
  budget: number;
  date: string;
  time: string;
  status: "planned" | "cancelled";
};
const money = (n: number) =>
  n.toLocaleString("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
export function OfferMailings({ ads }: { ads: Ad[] }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [budget, setBudget] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("12:00");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState(false);
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
  const picked = ads.filter((a) => ids.includes(a.id));
  function clear() {
    setEditing(null);
    setName("");
    setText("");
    setIds([]);
    setBudget("");
    setDate("");
    setTime("12:00");
    setReview(false);
    setMessage("");
  }
  function validate() {
    if (
      !name.trim() ||
      !text.trim() ||
      !ids.length ||
      !budget.trim() ||
      !/^\d+(?:\.\d{1,2})?$/.test(budget) ||
      !Number.isSafeInteger(Math.round(Number(budget) * 100)) ||
      !Number.isFinite(Number(budget)) ||
      Number(budget) <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !time
    ) {
      setMessage("Заполните название, предложение, объявления, дату и общий бюджет больше нуля.");
      return false;
    }
    const start = new Date(`${date}T${time}:00+03:00`).getTime();
    const calendarDate = new Date(`${date}T12:00:00Z`);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 10) !== date ||
      start <= Date.now()
    ) {
      setMessage("Выберите будущие дату и время по Москве.");
      return false;
    }
    if (picked.length !== ids.length || picked.some((a) => a.status !== "published")) {
      setMessage("Проверьте объявления: в плане должны быть только действующие публикации.");
      return false;
    }
    return true;
  }
  function save() {
    if (!validate()) return;
    const plan: Plan = {
      id: editing || crypto.randomUUID(),
      name: name.trim(),
      text: text.trim(),
      ids: [...ids],
      budget: Math.round(Number(budget) * 100) / 100,
      date,
      time,
      status: "planned",
    };
    setPlans(editing ? plans.map((p) => (p.id === editing ? plan : p)) : [plan, ...plans]);
    setReview(false);
    setMessage(
      "План сохранён до обновления страницы. Автоматический запуск не назначен; деньги не списаны.",
    );
    setEditing(plan.id);
  }
  function edit(p: Plan) {
    setEditing(p.id);
    setName(p.name);
    setText(p.text);
    setIds([...p.ids]);
    setBudget(String(p.budget));
    setDate(p.date);
    setTime(p.time);
    setReview(false);
    setMessage("");
  }
  return (
    <div className="om">
      <div className="om-heading">
        <h2>Рассылки</h2>
        <AdsHelp label="О платных предложениях">
          Платные предложения новым потенциальным ученикам внутри Авито. Состав аудитории, доступные
          предложения, стоимость и возможность запуска должны подтверждаться Авито для выбранных
          объявлений. В превью можно подготовить план; он не запускает рассылку.
        </AdsHelp>
      </div>
      <div className="om-layout">
        <section className="om-panel">
          <h3>{editing ? "Изменить план" : "Подготовить рассылку"}</h3>
          <label>
            Название плана
            <input
              value={name}
              maxLength={120}
              onChange={(e) => {
                setName(e.target.value);
                setReview(false);
              }}
              placeholder="Например, набор учеников на декабрь"
            />
          </label>
          <label>
            Предложение ученику
            <textarea
              rows={4}
              maxLength={2000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setReview(false);
              }}
              placeholder="Что вы предлагаете и на каких условиях"
            />
          </label>
          <small>
            Укажите реальные условия. Доступный формат предложения необходимо проверить в Авито.
          </small>
          <div className="om-picker-heading">
            <strong>Объявления · {ids.length} выбрано</strong>
            <AdsHelp label="Выбор объявлений для рассылки">
              Здесь отображаются объявления со статусом «В публикации» в текущем срезе. Это не
              подтверждает доступность рассылки по ним. Город относится к объявлению; ручной список
              получателей не создаётся.
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
            <button
              onClick={() => {
                setIds([...new Set([...ids, ...visible.map((a) => a.id)])]);
                setReview(false);
              }}
            >
              Выбрать найденные ({visible.length})
            </button>
            <button
              onClick={() => {
                setIds([]);
                setReview(false);
              }}
            >
              Снять выбор
            </button>
          </div>
          <div className="om-ads">
            {visible.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(a.id)}
                  onChange={(e) => {
                    setIds(e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id));
                    setReview(false);
                  }}
                />
                <span>
                  <strong>{a.title}</strong>
                  <small>{a.city}</small>
                </span>
              </label>
            ))}
            {!visible.length && <p>Подходящих публикаций нет.</p>}
          </div>
          <div className="om-fields">
            <label>
              Общий бюджет, ₽
              <input
                inputMode="decimal"
                value={budget}
                onChange={(e) => {
                  setBudget(e.target.value.replace(",", "."));
                  setReview(false);
                }}
                placeholder="На всю рассылку"
              />
            </label>
            <ServiceDatePicker
              label="Дата запуска"
              value={date}
              onChange={(value) => {
                setDate(value);
                setReview(false);
              }}
            />
            <label>
              Время, МСК
              <AdsSelect
                label="Время рассылки, МСК"
                value={time}
                options={timeOptions}
                onChange={(value) => {
                  setTime(value);
                  setReview(false);
                }}
              />
            </label>
          </div>
          <div className="om-actions">
            <button className="aw-btn" onClick={clear}>
              Очистить
            </button>
            <button
              className="aw-btn aw-primary"
              onClick={() => {
                if (validate()) {
                  setReview(true);
                  setMessage("");
                }
              }}
            >
              Проверить план
            </button>
          </div>
          {review && (
            <div className="om-review">
              <h3>Проверка перед сохранением</h3>
              <p>
                {name} · {picked.length} объявлений
              </p>
              <p>
                {date.split("-").reverse().join(".")} в {time} МСК · {money(Number(budget))} на всю
                рассылку
              </p>
              <p className="om-offer">{text}</p>
              <p>
                Стоимость отправки, охват и доступность услуги ещё не получены от Авито. По этому
                плану рассылка автоматически не запустится.
              </p>
              <div className="om-actions">
                <button className="aw-btn" onClick={() => setReview(false)}>
                  Изменить
                </button>
                <button className="aw-btn aw-primary" onClick={save}>
                  <Check size={15} />
                  Сохранить план
                </button>
              </div>
            </div>
          )}
        </section>
        <aside className="om-panel om-summary">
          <div className="om-heading">
            <h3>Планы и результаты</h3>
            <Megaphone size={18} />
          </div>
          {!plans.length ? (
            <p>
              Сохранённые планы появятся здесь. Результаты будут доступны после подключения отчёта
              Авито.
            </p>
          ) : (
            plans.map((p) => (
              <article key={p.id}>
                <div className="om-heading">
                  <strong>{p.name}</strong>
                  <span>{p.status === "planned" ? "План" : "Отменён"}</span>
                </div>
                <p>
                  {p.date.split("-").reverse().join(".")} · {p.time} МСК
                  <br />
                  {p.ids.length} объявлений · {money(p.budget)}
                </p>
                <dl>
                  <div>
                    <dt>Фактический расход</dt>
                    <dd>—</dd>
                  </div>
                  <div>
                    <dt>Отправлено</dt>
                    <dd>—</dd>
                  </div>
                  <div>
                    <dt>Контакты</dt>
                    <dd>—</dd>
                  </div>
                  <div>
                    <dt>Цена контакта</dt>
                    <dd>—</dd>
                  </div>
                </dl>
                <div className="om-plan-actions">
                  <button className="aw-text-button" onClick={() => edit(p)}>
                    Изменить
                  </button>
                  <button
                    className="aw-text-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${p.name}\n${p.text}\nОбъявления: ${p.ids.join(", ")}\nБюджет: ${money(p.budget)}\nДата: ${p.date} ${p.time} МСК`,
                        );
                        setMessage("План скопирован");
                      } catch {
                        setMessage("Не удалось скопировать план");
                      }
                    }}
                  >
                    <Copy size={13} />
                    Скопировать
                  </button>
                  {p.status === "planned" && (
                    <button
                      className="aw-text-button"
                      onClick={() => {
                        setPlans(
                          plans.map((x) => (x.id === p.id ? { ...x, status: "cancelled" } : x)),
                        );
                        setMessage("План отменён в превью. Операций в Авито не было.");
                      }}
                    >
                      Отменить план
                    </button>
                  )}
                </div>
                <button
                  className="aw-btn"
                  disabled={p.status === "cancelled"}
                  onClick={() =>
                    setMessage(
                      "Запуск платных предложений из сервиса пока не подключён. План не отправлен в Авито; деньги не списаны.",
                    )
                  }
                >
                  Перейти к запуску
                </button>
              </article>
            ))
          )}
        </aside>
      </div>
      {message && (
        <div className="aw-notice" role="status">
          {message}
          <button aria-label="Скрыть уведомление рассылок" onClick={() => setMessage("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

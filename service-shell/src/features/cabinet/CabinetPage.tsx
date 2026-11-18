import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Star } from "lucide-react";
import { ServiceSelect } from "../service/service-controls";
import { sampleCabinet } from "./sample";
import "./settings.css";
const manager = "https://t.me/cantor_agency_manager";
const plans = [
  {
    name: "Конструктор",
    price: 1990,
    term: "месяц",
    desc: "Базовый набор без дополнительных модулей",
    features: [
      "Базовая аналитика Авито",
      "Учёт диагностик и оплат",
      "Стоимость привлечения ученика",
    ],
  },
  {
    name: "Всё включено",
    price: 9990,
    term: "месяц",
    desc: "Все возможности платформы без лимитов",
    features: [
      "Все модули конструктора",
      "Расширенная аналитика и разбор диалогов",
      "ИИ, автоматизация и база знаний",
    ],
  },
  {
    name: "Премиум",
    price: 25000,
    term: "месяц",
    desc: "Команда организует и ведёт работу за вас",
    features: ["Все возможности платформы", "Полное ведение командой", "Первый месяц — 50 000 ₽"],
  },
  {
    name: "Ранний доступ",
    price: 49900,
    term: "год",
    desc: "Полный набор возможностей на целый год",
    features: ["Все предусмотренные модули", "Без лимитов и доплат", "Сопровождение команды"],
  },
];
const money = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
const topics = [
  "Новые обращения",
  "Диагностики и встречи",
  "Оплаты учеников",
  "Состояние объявлений",
  "Еженедельный отчёт",
  "Продление подписки",
];
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      className="st-toggle"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
export function CabinetPage() {
  const [tab, setTab] = useState("Тариф"),
    [current, setCurrent] = useState(0),
    [renew, setRenew] = useState(true),
    [checkout, setCheckout] = useState<number | null>(null),
    [stage, setStage] = useState(false),
    [method, setMethod] = useState("sbp"),
    [notice, setNotice] = useState("");
  const [email, setEmail] = useState(""),
    [channels, setChannels] = useState([false, false]),
    [events, setEvents] = useState(topics.map(() => true)),
    [rating, setRating] = useState(5),
    [review, setReview] = useState(""),
    [name, setName] = useState(sampleCabinet.tutor),
    [zone, setZone] = useState("moscow"),
    [mode, setMode] = useState("manual"),
    [accountOpen, setAccountOpen] = useState(false);
  const plan = plans[current],
    chosen = checkout === null ? null : plans[checkout];
  return (
    <div className="st-settings">
      <nav className="st-tabs" aria-label="Настройки">
        {["Тариф", "Кабинет", "Уведомления", "Профиль", "Поддержка и отзывы"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => {
              setTab(t);
              setNotice("");
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {notice && (
        <p className="st-notice" role="status">
          {notice}
        </p>
      )}
      {tab === "Тариф" && (
        <>
          <section className="st-current">
            <div>
              <span className="st-muted">Ваш тариф</span>
              <h2>{plan.name}</h2>
              <p>{plan.desc}</p>
              <span className="st-status">Активен</span>
            </div>
            <div className="st-period">
              <strong>
                {money(plan.price)} <small>/ {plan.term}</small>
              </strong>
              <p>Оплачен до 18 {current === 3 ? "ноября 2027" : "декабря 2026"}</p>
              <a href="#st-plans">Изменить тариф ↓</a>
            </div>
          </section>
          <section className="st-card">
            <div className="st-row">
              <div>
                <h3>Автопродление</h3>
                <p>
                  {renew
                    ? `Следующее продление — 18 ${current === 3 ? "ноября 2027" : "декабря 2026"}, ${money(plan.price)}`
                    : "Отключено. Доступ сохранится до конца оплаченного периода."}
                </p>
              </div>
              <Toggle label="Автопродление" checked={renew} onChange={() => setRenew(!renew)} />
            </div>
            <button
              className="st-link"
              onClick={() => {
                setCheckout(current);
                setStage(false);
              }}
            >
              Продлить сейчас
            </button>
          </section>
          <div className="st-title" id="st-plans">
            <h3>Выберите свой формат</h3>
            <span>Подписка Cantor</span>
          </div>
          <div className="st-plans">
            {plans.map((p, i) => (
              <article className={`st-plan ${i === current ? "selected" : ""}`} key={p.name}>
                <div className="st-plan-top">
                  <h3>{p.name}</h3>
                  {i === current && <span className="st-status">Ваш тариф</span>}
                </div>
                <p>{p.desc}</p>
                <strong className="st-price">
                  {money(p.price)}
                  <small> / {p.term}</small>
                </strong>
                <ul>
                  {p.features.map((f) => (
                    <li key={f}>
                      ✓ <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  className={i === 1 ? "st-primary" : "st-button"}
                  onClick={() => {
                    setCheckout(i);
                    setStage(false);
                  }}
                >
                  {i === current ? "Продлить" : "Выбрать тариф"}
                </button>
              </article>
            ))}
          </div>
          <section className="st-card">
            <h3>Состав вашего тарифа</h3>
            {[
              "Базовая аналитика, диагностики и оплаты",
              "Расширенная аналитика и атрибуция",
              "Разбор качества диалогов",
              "ИИ и автоматизация",
              "Полное ведение командой",
            ].map((f, i) => (
              <div className="st-row st-feature" key={f}>
                <span>{f}</span>
                <span className="st-muted">
                  {i === 0 || (current > 0 && (i !== 4 || current >= 2)) ? "Включено" : "Не входит"}
                </span>
              </div>
            ))}
          </section>
          <p className="st-policy">
            Месяц подписки начинается с даты оплаты. Отключение продления сохраняет оплаченный
            период. Для возврата за неиспользованное время{" "}
            <a href={manager} target="_blank" rel="noreferrer">
              напишите менеджеру ↗
            </a>
            .
          </p>
        </>
      )}
      {tab === "Кабинет" && (
        <>
          <section className="st-card">
            <div className="st-row">
              <div>
                <h3>Кабинет Авито</h3>
                <p>
                  {sampleCabinet.tutor} · {sampleCabinet.subject}
                </p>
              </div>
              <span className="st-status">Подключён</span>
            </div>
            <p>Один кабинет Авито для вашего пространства Cantor.</p>
            <button
              className="st-button"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen(!accountOpen)}
            >
              Управлять подключением
            </button>
            {accountOpen && (
              <div className="st-inset">
                <h3>Доступ к кабинету</h3>
                <p>
                  Объявления, статистика и диалоги. Изменения подключения согласуйте с командой.
                </p>
                <a href={manager} target="_blank" rel="noreferrer">
                  Изменить кабинет ↗
                </a>
              </div>
            )}
          </section>
          <section className="st-card">
            <h3>Ответы ученикам</h3>
            <p>Режим по умолчанию для новых диалогов</p>
            <ServiceSelect
              label="Режим ответов"
              value={mode}
              onChange={setMode}
              options={[
                { value: "manual", label: "Вручную" },
                { value: "approval", label: "ИИ по согласованию" },
                { value: "auto", label: "ИИ автоматически" },
              ]}
            />
            <p>
              <button className="st-primary" onClick={() => setNotice("Предпочтения сохранены")}>
                Сохранить
              </button>
            </p>
          </section>
        </>
      )}
      {tab === "Уведомления" && (
        <>
          <section className="st-card">
            <h3>Куда уведомлять</h3>
            <div className="st-row">
              <div>
                <h4>По электронной почте</h4>
                <p>Отчёты и важные события кабинета</p>
              </div>
              <Toggle
                label="Уведомления по почте"
                checked={channels[0]}
                onChange={() => setChannels([!channels[0], channels[1]])}
              />
            </div>
            <label className="st-field">
              Электронная почта
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.ru"
              />
            </label>
            <div className="st-row">
              <div>
                <h4>В Telegram-боте</h4>
                <p>Оперативные уведомления о событиях</p>
              </div>
              <Toggle
                label="Уведомления в Telegram"
                checked={channels[1]}
                onChange={() => setChannels([channels[0], !channels[1]])}
              />
            </div>
            {channels[1] && (
              <div className="st-inset">
                <p>Telegram-бот не подключён</p>
                <a href={manager} target="_blank" rel="noreferrer">
                  Запросить подключение у менеджера ↗
                </a>
              </div>
            )}
          </section>
          <section className="st-card">
            <h3>О чём уведомлять</h3>
            {topics.map((t, i) => (
              <div className="st-row st-feature" key={t}>
                <span>{t}</span>
                <Toggle
                  label={t}
                  checked={events[i]}
                  onChange={() => setEvents(events.map((v, n) => (n === i ? !v : v)))}
                />
              </div>
            ))}
          </section>
          <button
            className="st-primary"
            onClick={() =>
              setNotice(
                channels[0] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                  ? "Укажите корректный адрес электронной почты"
                  : "Предпочтения уведомлений сохранены",
              )
            }
          >
            Сохранить предпочтения
          </button>
        </>
      )}
      {tab === "Профиль" && (
        <section className="st-card">
          <h3>Личные данные</h3>
          <label className="st-field">
            Имя
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="st-field">
            Часовой пояс
            <ServiceSelect
              label="Часовой пояс"
              value={zone}
              onChange={setZone}
              options={[
                { value: "moscow", label: "Москва · UTC+3" },
                { value: "samara", label: "Самара · UTC+4" },
                { value: "ekaterinburg", label: "Екатеринбург · UTC+5" },
                { value: "novosibirsk", label: "Новосибирск · UTC+7" },
              ]}
            />
          </label>
          <button
            className="st-primary"
            onClick={() => setNotice(name.trim() ? "Профиль сохранён" : "Укажите имя")}
          >
            Сохранить
          </button>
        </section>
      )}
      {tab === "Поддержка и отзывы" && (
        <>
          <section className="st-card">
            <h3>Мы рядом</h3>
            <p>Живая команда Cantor · 10:00–18:00 МСК</p>
            <div className="st-support-grid">
              {[
                ["Работа в сервисе", "Настройки, подключение Авито и помощь с разделами"],
                ["Тариф и оплата", "Смена тарифа, продление и возврат"],
                ["Ошибка или предложение", "Расскажите, что произошло или что можно улучшить"],
              ].map(([title, desc]) => (
                <div key={title}>
                  <h4>{title}</h4>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
            <a className="st-primary" href={manager} target="_blank" rel="noreferrer">
              Написать менеджеру ↗
            </a>
          </section>
          <section className="st-card">
            <h3>Ваш отзыв о Cantor</h3>
            <p>Что вам нравится и что стоит улучшить?</p>
            <div className="st-stars" role="group" aria-label="Оценка сервиса">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  aria-label={`${n} из 5`}
                  aria-pressed={rating === n}
                  onClick={() => setRating(n)}
                >
                  <Star fill={n <= rating ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
            <label className="st-field">
              Отзыв
              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                rows={4}
                placeholder="Поделитесь впечатлениями"
              />
            </label>
            <button
              className="st-button"
              onClick={() =>
                setNotice(review.trim() ? "Отзыв сохранён" : "Напишите несколько слов о сервисе")
              }
            >
              Сохранить отзыв
            </button>
            <a className="st-link" href={manager} target="_blank" rel="noreferrer">
              Передать отзыв менеджеру ↗
            </a>
          </section>
        </>
      )}
      <Dialog.Root
        open={checkout !== null}
        onOpenChange={(o) => {
          if (!o) setCheckout(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="st-overlay" />
          <Dialog.Content className="st-dialog">
            <Dialog.Title>{stage ? "Тариф выбран" : "Оформление подписки"}</Dialog.Title>
            <Dialog.Description>
              {stage ? "Параметры подписки обновлены." : "Проверьте тариф, период и способ оплаты."}
            </Dialog.Description>
            <Dialog.Close className="st-close" aria-label="Закрыть">
              <X size={20} />
            </Dialog.Close>
            {chosen && (
              <>
                <div className="st-inset">
                  <h3>{chosen.name}</h3>
                  <strong className="st-price">
                    {money(checkout === 2 ? 50000 : chosen.price)}
                  </strong>
                  <p>
                    {checkout === 2
                      ? "Первый месяц, далее 25 000 ₽ / месяц"
                      : `Период — один ${chosen.term}`}
                  </p>
                </div>
                {!stage ? (
                  <>
                    <ul>
                      {chosen.features.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <ServiceSelect
                      label="Способ оплаты"
                      value={method}
                      onChange={setMethod}
                      options={[
                        { value: "sbp", label: "Система быстрых платежей" },
                        { value: "card", label: "Банковская карта" },
                      ]}
                    />
                    <div className="st-row">
                      <span>Автоматическое продление</span>
                      <Toggle
                        label="Продлевать подписку"
                        checked={renew}
                        onChange={() => setRenew(!renew)}
                      />
                    </div>
                    <p>
                      Возврат за неиспользованный период — по запросу{" "}
                      <a href={manager} target="_blank" rel="noreferrer">
                        менеджеру
                      </a>
                      .
                    </p>
                    <button
                      className="st-primary"
                      onClick={() => {
                        setCurrent(checkout!);
                        setStage(true);
                      }}
                    >
                      Оплатить {money(checkout === 2 ? 50000 : chosen.price)}
                    </button>
                  </>
                ) : (
                  <Dialog.Close className="st-primary">Вернуться к тарифу</Dialog.Close>
                )}
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Mail,
  MessageCircle,
  Puzzle,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { ServiceSelect } from "../service/service-controls";
import { getPreviewData } from "../service/preview-data";
import { sampleCabinet } from "./sample";
import {
  baseFeatures,
  modules,
  plans,
  monthlyPrice,
  paymentPrice,
  paidThrough,
  money,
  settingsPage,
} from "./settings-model";
import "./settings.css";
const manager = "https://t.me/cantor_agency_manager";
const topics = [
  ["Новые обращения", "Новые сообщения и обращения учеников в Авито"],
  ["Диагностики и встречи", "Предстоящие встречи, переносы и отмены"],
  ["Учёт оплат", "Оплаты занятий, которые вы отмечаете в кабинете"],
  ["Состояние объявлений", "Отклонения, блокировки и изменения статуса"],
  ["Ошибки подключения", "Сбои доступа к Авито и загрузки данных"],
  ["Ежедневный отчёт", "Итоги обращений и продвижения за день"],
  ["Еженедельный отчёт", "Итоги недели и изменения показателей"],
  ["Продление подписки", "Предстоящее продление и окончание доступа"],
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
      type="button"
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
function Feature({ title, detail }: { title: string; detail: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="st-feature-button">
        <Check size={16} />
        <span>{title}</span>
        <CircleHelp size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="st-help" sideOffset={8} collisionPadding={16}>
          <strong>{title}</strong>
          <p>{detail}</p>
          <Popover.Close aria-label="Закрыть подсказку">
            <X size={14} />
          </Popover.Close>
          <Popover.Arrow className="st-help-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
function Modal({
  open,
  onOpenChange,
  title,
  description,
  wide,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="st-overlay" />
        <Dialog.Content className={`st-dialog ${wide ? "st-dialog-wide" : ""}`}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close className="st-close" aria-label="Закрыть">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function CabinetPage({ focus }: { focus?: string }) {
  const tab = settingsPage(focus);
  const [current, setCurrent] = useState(0),
    [annual, setAnnual] = useState(false),
    [paidAnnual, setPaidAnnual] = useState(false),
    [enabled, setEnabled] = useState([false, false, false]),
    [paidModules, setPaidModules] = useState([false, false, false]),
    [renew, setRenew] = useState(true);
  const [picker, setPicker] = useState(false),
    [configure, setConfigure] = useState(false),
    [checkout, setCheckout] = useState<number | null>(null),
    [complete, setComplete] = useState(false),
    [method, setMethod] = useState("sbp"),
    [noticeState, setNoticeState] = useState({ page: tab, text: "" });
  const notice = noticeState.page === tab ? noticeState.text : "";
  const setNotice = (text: string) => setNoticeState({ page: tab, text });
  const [email, setEmail] = useState(""),
    [channels, setChannels] = useState([false, false]),
    [events, setEvents] = useState(topics.map(() => true)),
    [rating, setRating] = useState(0),
    [review, setReview] = useState(""),
    [reviewOpen, setReviewOpen] = useState(false),
    [name, setName] = useState(sampleCabinet.tutor),
    [zone, setZone] = useState("moscow"),
    [mode, setMode] = useState("manual"),
    [apiOpen, setApiOpen] = useState(false),
    [accountId, setAccountId] = useState(
      (getPreviewData() as { accountId?: string } | null)?.accountId ?? "",
    ),
    [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const expiry = paidThrough(paidAnnual).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const choose = (i: number) => {
    setPicker(false);
    setConfigure(false);
    setCheckout(i);
    setComplete(false);
  };
  const periodControl = (
    <div className="st-segment" role="group" aria-label="Период оплаты">
      <button aria-pressed={!annual} onClick={() => setAnnual(false)}>
        Месяц
      </button>
      <button aria-pressed={annual} onClick={() => setAnnual(true)}>
        Год
      </button>
    </div>
  );
  const planCards = (
    <div className="st-plans">
      {plans.map((p, i) => (
        <article className="st-plan" key={p.name}>
          <div className="st-plan-title">
            <span className="st-plan-symbol">
              {i === 0 ? (
                <Puzzle size={18} />
              ) : i === 1 ? (
                <Sparkles size={18} />
              ) : (
                <ShieldCheck size={18} />
              )}
            </span>
            {current === i && <span className="st-current-label">Текущий</span>}
          </div>
          <h3>{p.name}</h3>
          <p className="st-plan-description">{p.description}</p>
          <div className="st-plan-price">
            {i === 0 && <small>от </small>}
            {money((i === 0 ? 1990 : p.price) * (annual ? 12 : 1))}
            <small> / {annual ? "год" : "мес"}</small>
          </div>
          {i === 2 && (
            <p className="st-first-price">
              Первый {annual ? "год — 325 000 ₽" : "месяц — 50 000 ₽"}
            </p>
          )}
          <div className="st-plan-features">
            {(i === 0
              ? baseFeatures
              : [
                  {
                    title: "Все модули конструктора",
                    detail:
                      "Базовая и расширенная аналитика, учёт диагностик и оплат, разбор диалогов и ИИ-автоматизация.",
                  },
                  {
                    title: "Без лимитов",
                    detail: "Все возможности тарифа без скрытых квот и доплат за превышение.",
                  },
                  {
                    title: i === 2 ? "Полное ведение командой" : "Сопровождение куратора",
                    detail:
                      i === 2
                        ? "Команда сама организует и контролирует работу кабинета, продвижение и обработку обращений."
                        : "Куратор помогает разобраться в сервисе, консультирует и помогает с задачами.",
                  },
                ]
            ).map((f) => (
              <Feature key={f.title} {...f} />
            ))}
          </div>
          <button
            className={i === 1 ? "st-primary" : "st-button"}
            onClick={() => (i === 0 ? (setPicker(false), setConfigure(true)) : choose(i))}
          >
            {i === 0 ? "Настроить состав" : "Выбрать тариф"}
            <ChevronRight size={15} />
          </button>
        </article>
      ))}
    </div>
  );
  return (
    <div className="st-settings">
      {notice && (
        <div className="st-notice" role="status">
          {notice}
          <button aria-label="Закрыть уведомление" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {tab === "cabinet" && (
        <>
          <section className="st-card">
            <div className="st-heading-row">
              <h3>Кабинет Авито</h3>
              <span className="st-connected">
                <span />
                Подключён
              </span>
            </div>
            <div className="st-account-summary">
              <div className="st-account-avatar">
                {sampleCabinet.tutor
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div>
                <strong>{sampleCabinet.tutor}</strong>
                <p>{sampleCabinet.subject}</p>
              </div>
            </div>
            <div className="st-actions">
              <a
                className="st-button"
                href="https://www.avito.ru/profile"
                target="_blank"
                rel="noreferrer"
              >
                Открыть кабинет
                <ArrowUpRight size={15} />
              </a>
              <button
                className="st-button"
                aria-expanded={apiOpen}
                onClick={() => setApiOpen(!apiOpen)}
              >
                Параметры подключения
                <ChevronRight size={15} />
              </button>
            </div>
            {apiOpen && (
              <div className="st-connection-fields">
                <div className="st-form-grid">
                  <label className="st-field">
                    ID кабинета
                    <input
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      placeholder="ID кабинета Авито"
                    />
                  </label>
                  <label className="st-field">
                    Client ID
                    <input
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="Идентификатор приложения"
                      autoComplete="off"
                    />
                  </label>
                  <label className="st-field">
                    Client Secret
                    <input
                      type="password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                <div className="st-actions">
                  <button
                    className="st-button"
                    onClick={() => {
                      setSecret("");
                      setNotice("Для изменения подключения обратитесь к менеджеру");
                    }}
                  >
                    Обновить подключение
                  </button>
                  <a className="st-text-link" href={manager} target="_blank" rel="noreferrer">
                    Помощь с подключением
                    <ArrowUpRight size={14} />
                  </a>
                </div>
              </div>
            )}
          </section>
          <section className="st-card">
            <h3>Профиль</h3>
            <div className="st-form-grid">
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
            </div>
            <button
              className="st-button"
              onClick={() => setNotice(name.trim() ? "Профиль сохранён" : "Укажите имя")}
            >
              Сохранить профиль
            </button>
          </section>
          <section className="st-card st-replies">
            <div>
              <h3>Ответы ученикам</h3>
              <p>Режим для новых диалогов</p>
            </div>
            <ServiceSelect
              label="Режим ответов"
              value={mode}
              onChange={(v) => {
                setMode(v);
                setNotice("Режим для новых диалогов выбран");
              }}
              options={[
                { value: "manual", label: "Вручную" },
                { value: "approval", label: "ИИ по согласованию" },
                { value: "auto", label: "ИИ автоматически" },
              ]}
            />
          </section>
        </>
      )}
      {tab === "notifications" && (
        <>
          <section className="st-card">
            <h3>Куда уведомлять</h3>
            <div className="st-channel">
              <span className="st-channel-icon">
                <Mail size={20} />
              </span>
              <div>
                <h4>Электронная почта</h4>
                <p>Отчёты и важные события</p>
              </div>
              <Toggle
                label="Уведомления по почте"
                checked={channels[0]}
                onChange={() => setChannels([!channels[0], channels[1]])}
              />
            </div>
            {channels[0] && (
              <label className="st-field st-channel-field">
                Адрес электронной почты
                <input
                  type="email"
                  placeholder="name@example.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            <div className="st-channel">
              <span className="st-channel-icon">
                <Send size={20} />
              </span>
              <div>
                <h4>Telegram-бот</h4>
                <p>Быстрые уведомления в мессенджере</p>
              </div>
              <Toggle
                label="Уведомления в Telegram"
                checked={channels[1]}
                onChange={() => setChannels([channels[0], !channels[1]])}
              />
            </div>
            {channels[1] && (
              <div className="st-telegram-connect">
                <span>Бот не подключён</span>
                <a href={manager} target="_blank" rel="noreferrer">
                  Подключить через менеджера
                  <ArrowUpRight size={14} />
                </a>
              </div>
            )}
          </section>
          <section className="st-card">
            <h3>О чём уведомлять</h3>
            {topics.map(([title, desc], i) => (
              <div className="st-row st-event" key={title}>
                <div>
                  <h4>{title}</h4>
                  <p>{desc}</p>
                </div>
                <Toggle
                  label={title}
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
      {tab === "tariff" && (
        <>
          <section className="st-current">
            <div>
              <div className="st-heading-row">
                <h2>{plans[current].name}</h2>
                <span className="st-neutral-status">Активен</span>
              </div>
              <p>
                {current === 0
                  ? `${paidModules.filter(Boolean).length === 0 ? "Базовый набор" : `База и ${paidModules.filter(Boolean).length} доп. модуля`}`
                  : plans[current].description}
              </p>
              <button className="st-text-link" onClick={() => setPicker(true)}>
                Изменить тариф
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="st-period">
              <strong>
                {money(monthlyPrice(current, paidModules) * (paidAnnual ? 12 : 1))}
                <small> / {paidAnnual ? "год" : "мес"}</small>
              </strong>
              <p>Оплачен до {expiry}</p>
            </div>
          </section>
          <section className="st-renew">
            <div>
              <strong>Автопродление</strong>
              <p>
                {renew
                  ? `${expiry} · ${money(monthlyPrice(current, paidModules) * (paidAnnual ? 12 : 1))}`
                  : "Выключено · доступ до конца оплаченного периода"}
              </p>
            </div>
            <Toggle label="Автопродление" checked={renew} onChange={() => setRenew(!renew)} />
          </section>
          <div className="st-heading-row st-options-heading">
            <h3>Тарифы</h3>
            {periodControl}
          </div>
          {planCards}
          <section className="st-card">
            <div className="st-heading-row">
              <h3>Состав тарифа</h3>
              {current === 0 && (
                <button
                  className="st-text-link"
                  onClick={() => {
                    setEnabled([...paidModules]);
                    setConfigure(true);
                  }}
                >
                  Настроить
                  <ChevronRight size={15} />
                </button>
              )}
            </div>
            {baseFeatures.map((f) => (
              <div className="st-composition" key={f.title}>
                <Feature {...f} />
                <span>Включено</span>
              </div>
            ))}
            {modules.map((m, i) => (
              <div className="st-composition" key={m.id}>
                <Feature title={m.title} detail={m.detail} />
                <span>{current > 0 || paidModules[i] ? "Включено" : "Не подключено"}</span>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "support" && (
        <>
          <section className="st-card">
            <div className="st-heading-row">
              <h3>Мы рядом</h3>
              <span className="st-muted">10:00–18:00 МСК</span>
            </div>
            <p>Команда Cantor Agency поможет с кабинетом, тарифом и работой на платформе.</p>
            <div className="st-support-grid">
              {[
                ["Работа в сервисе", "Подключение Авито, настройки и помощь с разделами"],
                ["Тариф и оплата", "Смена тарифа, продление и вопросы возврата"],
                ["Ошибки и идеи", "Что не работает и что хочется улучшить"],
              ].map(([title, desc]) => (
                <div key={title}>
                  <h4>{title}</h4>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
            <a className="st-manager" href={manager} target="_blank" rel="noreferrer">
              <span className="st-manager-icon">
                <MessageCircle size={22} />
              </span>
              <span>
                <strong>Написать менеджеру</strong>
                <small>@cantor_agency_manager · Telegram</small>
              </span>
              <ArrowUpRight size={19} />
            </a>
          </section>
          <section className="st-card st-review-card">
            <div>
              <h3>Ваш отзыв о платформе</h3>
              <p>Как вам работается с Cantor Agency?</p>
            </div>
            <div className="st-stars" role="group" aria-label="Оценка платформы">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  aria-label={`${n} из 5`}
                  aria-pressed={rating === n}
                  onClick={() => {
                    setRating(n);
                    setReviewOpen(true);
                  }}
                >
                  <Star size={26} fill={n <= rating ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      <Modal
        open={picker}
        onOpenChange={setPicker}
        wide
        title="Изменить тариф"
        description="Выберите состав возможностей и период оплаты."
      >
        <div className="st-modal-period">{periodControl}</div>
        {planCards}
      </Modal>
      <Modal
        open={configure}
        onOpenChange={setConfigure}
        title="Соберите свой тариф"
        description="Базовый набор уже включён. Добавляйте только нужные модули."
      >
        <div className="st-config-base">
          <span>Базовый набор</span>
          <strong>
            {money(1990 * (annual ? 12 : 1))} / {annual ? "год" : "мес"}
          </strong>
        </div>
        {baseFeatures.map((f) => (
          <Feature key={f.title} {...f} />
        ))}
        <div className="st-config-modules">
          {modules.map((m, i) => (
            <div className="st-module" key={m.id}>
              <div>
                <Feature title={m.title} detail={m.detail} />
                <span>
                  + {money(m.price * (annual ? 12 : 1))} / {annual ? "год" : "мес"}
                </span>
              </div>
              <Toggle
                label={m.title}
                checked={enabled[i]}
                onChange={() => setEnabled(enabled.map((v, n) => (n === i ? !v : v)))}
              />
            </div>
          ))}
        </div>
        <div className="st-total">
          <span>Итого за {annual ? "год" : "месяц"}</span>
          <strong>{money(paymentPrice(0, enabled, annual))}</strong>
        </div>
        <button className="st-primary st-full" onClick={() => choose(0)}>
          Перейти к оплате
          <ChevronRight size={16} />
        </button>
      </Modal>
      <Modal
        open={checkout !== null}
        onOpenChange={(o) => {
          if (!o) setCheckout(null);
        }}
        title={complete ? "Тариф выбран" : "Оформление подписки"}
        description={
          complete
            ? "Состав и период подписки обновлены."
            : "Проверьте состав, период и итоговую сумму."
        }
      >
        {checkout !== null &&
          (complete ? (
            <div className="st-success">
              <CheckCircle2 size={42} />
              <h3>{plans[checkout].name}</h3>
              <p>{annual ? "Годовая оплата" : "Ежемесячная оплата"}</p>
              <button className="st-primary st-full" onClick={() => setCheckout(null)}>
                Готово
              </button>
            </div>
          ) : (
            <>
              <div className="st-order-heading">
                <span>{plans[checkout].name}</span>
                {periodControl}
              </div>
              <div className="st-order-features">
                {baseFeatures.map((f) => (
                  <Feature key={f.title} {...f} />
                ))}
                {modules
                  .filter((_, i) => checkout > 0 || enabled[i])
                  .map((m) => (
                    <Feature key={m.id} title={m.title} detail={m.detail} />
                  ))}
                {checkout === 2 && (
                  <Feature
                    title="Полное ведение командой"
                    detail="Команда организует и контролирует работу кабинета."
                  />
                )}
              </div>
              <div className="st-payment-methods" role="group" aria-label="Способ оплаты">
                {[
                  ["sbp", "СБП"],
                  ["card", "Банковская карта"],
                ].map(([id, label]) => (
                  <button key={id} aria-pressed={method === id} onClick={() => setMethod(id)}>
                    <CreditCard size={17} />
                    {label}
                    {method === id && <Check size={15} />}
                  </button>
                ))}
              </div>
              <div className="st-row">
                <span>Автопродление</span>
                <Toggle
                  label="Продлевать подписку"
                  checked={renew}
                  onChange={() => setRenew(!renew)}
                />
              </div>
              {checkout === 2 && current !== 2 && (
                <p className="st-muted">
                  Первый{" "}
                  {annual
                    ? "год: 50 000 ₽ за первый месяц и 25 000 ₽ за каждый из следующих 11 месяцев"
                    : "месяц — 50 000 ₽; далее 25 000 ₽ / месяц"}
                  .
                </p>
              )}
              <div className="st-total">
                <span>К оплате</span>
                <strong>{money(paymentPrice(checkout, enabled, annual, current !== 2))}</strong>
              </div>
              <button
                className="st-primary st-full"
                onClick={() => {
                  setCurrent(checkout);
                  setPaidAnnual(annual);
                  setPaidModules([...enabled]);
                  setComplete(true);
                }}
              >
                Оплатить {money(paymentPrice(checkout, enabled, annual, current !== 2))}
                <ChevronRight size={16} />
              </button>
              <a className="st-refund" href={manager} target="_blank" rel="noreferrer">
                Вопросы об оплате и возврате
                <ArrowUpRight size={13} />
              </a>
            </>
          ))}
      </Modal>
      <Modal
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title="Ваш отзыв о платформе"
        description={`Ваша оценка — ${rating} из 5. Расскажите, что понравилось и что можно улучшить.`}
      >
        <label className="st-field">
          Отзыв
          <textarea
            autoFocus
            value={review}
            onChange={(e) => setReview(e.target.value)}
            rows={5}
            placeholder="Поделитесь впечатлениями"
          />
        </label>
        <button
          className="st-primary st-full"
          disabled={!review.trim()}
          onClick={() => {
            if (review.trim()) {
              setReviewOpen(false);
              setNotice("Отзыв сохранён");
            } else setNotice("Напишите несколько слов о платформе");
          }}
        >
          Сохранить отзыв
        </button>
        <a className="st-refund" href={manager} target="_blank" rel="noreferrer">
          Передать отзыв менеджеру
          <ArrowUpRight size={13} />
        </a>
      </Modal>
    </div>
  );
}

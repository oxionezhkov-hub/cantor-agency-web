import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Check, Plus, Wallet } from "lucide-react";
import {
  appointmentOutcome,
  bookAppointment,
  monthRangeMsk,
  parseMoneyInput,
  periodMetrics,
  recordPayment,
  rescheduleAppointment,
} from "./crm.ts";
import { changeDemoCrm, useDemoCrm } from "./demo-crm-store.ts";
import { ads, windows } from "./data.ts";
import { promotionSpend, studentCost } from "./rules.ts";
const rub = (minor: number) =>
  `${(minor / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
const todayMsk = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const dateLabel = (at: string) =>
  new Date(at).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  });
const timeLabel = (at: string) =>
  new Date(at).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
function problem(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Не удалось сохранить демо. Проверьте доступ к хранилищу браузера.";
}

export function PaymentsSection({ focus }: { focus?: string }) {
  const { state, storageError } = useDemoCrm();
  const [studentId, setStudentId] = useState("student-kirill");
  const [amount, setAmount] = useState("");
  const [paidDate, setPaidDate] = useState(todayMsk);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const focusedStudentId =
    state.leads.find((item) => item.id === focus)?.studentId ||
    state.students.find((item) => item.id === focus)?.id;
  useEffect(() => {
    if (focusedStudentId) {
      setStudentId(focusedStudentId);
      form.current?.scrollIntoView({ block: "center" });
    }
  }, [focusedStudentId]);
  const [from, to] = monthRangeMsk(2026, 10);
  const metrics = periodMetrics(state, from, to);
  const cost = studentCost(promotionSpend(ads), metrics.newStudents);
  function add(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const minor = parseMoneyInput(amount);
    if (minor === null) {
      setError("Введите сумму больше 0 ₽, не более 999 999,99 ₽ и с точностью до копеек.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || paidDate > todayMsk()) {
      setError("Укажите дату уже полученной оплаты.");
      return;
    }
    request.current ??= crypto.randomUUID();
    try {
      changeDemoCrm((current) =>
        recordPayment(current, current.workspaceId, {
          id: `payment-${request.current}`,
          requestId: request.current!,
          studentId,
          amountMinor: minor,
          paidAt: `${paidDate}T12:00:00+03:00`,
        }),
      );
      setAmount("");
      setNotice("Оплата сохранена в демо. Показатели на дашборде обновлены.");
    } catch (e) {
      setError(problem(e));
    }
  }
  const ledger = [...state.payments].sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));
  return (
    <section className="crm-panel" aria-label="Оплаты учеников">
      <div className="crm-heading">
        <div>
          <span className="crm-kicker">ОТ ДИАГНОСТИКИ К ЗАНЯТИЯМ</span>
          <h2>
            <Wallet size={18} />
            Оплаты учеников
          </h2>
        </div>
        <span className="crm-period">Ноябрь 2026 · МСК</span>
      </div>
      <dl className="crm-metrics">
        <div>
          <dt>Получено оплат</dt>
          <dd data-testid="received-payments">{rub(metrics.receivedMinor)}</dd>
        </div>
        <div>
          <dt>Новых учеников</dt>
          <dd data-testid="paid-students">{metrics.newStudents}</dd>
        </div>
        <div>
          <dt>Расходы на ученика</dt>
          <dd>{cost === null ? "Не рассчитано" : `${cost.toLocaleString("ru-RU")} ₽`}</dd>
        </div>
      </dl>
      <p className="crm-hint">
        Повторная оплата увеличивает сумму, но не число новых учеников. Показатели — за ноябрь;
        журнал хранит все даты.
      </p>
      {storageError ? (
        <p role="alert" className="crm-error">
          {storageError}
        </p>
      ) : null}
      <form ref={form} className="crm-form" onSubmit={add} aria-label="Внести оплату ученика">
        <label>
          Ученик
          <select
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              request.current = null;
            }}
          >
            {state.students.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Сумма, ₽
          <input
            value={amount}
            inputMode="decimal"
            placeholder="Например, 4 800"
            onChange={(e) => {
              setAmount(e.target.value);
              request.current = null;
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "payment-error" : undefined}
          />
        </label>
        <label>
          Дата оплаты
          <input
            type="date"
            value={paidDate}
            max={todayMsk()}
            onChange={(e) => {
              setPaidDate(e.target.value);
              request.current = null;
            }}
            required
          />
        </label>
        <button type="submit" className="crm-primary" disabled={Boolean(storageError)}>
          <Plus size={16} />
          Сохранить оплату
        </button>
      </form>
      {error ? (
        <p id="payment-error" role="alert" className="crm-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="crm-success">
          <Check size={15} />
          {notice}
        </p>
      ) : null}
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Дата</th>
              <th>Получено</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((payment) => (
              <tr key={payment.id}>
                <th scope="row">
                  {state.students.find((item) => item.id === payment.studentId)?.name || "Ученик"}
                </th>
                <td>{dateLabel(payment.paidAt)}</td>
                <td>{rub(payment.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {metrics.unpaidStudentIds.length ? (
        <div className="crm-unpaid">
          <strong>После диагностики, без отмеченной оплаты</strong>
          <span>
            {metrics.unpaidStudentIds
              .map((id) => state.students.find((item) => item.id === id)?.name)
              .join(", ")}
          </span>
          <small>Это отсутствие записи об оплате в демо, а не подтверждённая задолженность.</small>
        </div>
      ) : null}
      <p className="crm-hint">
        Учёт полученных денег в демоверсии. Кнопка не списывает деньги и не отправляет сообщения.
      </p>
    </section>
  );
}

export function DiagnosticSection({ focus }: { focus?: string }) {
  const { state, storageError } = useDemoCrm();
  const [leadId, setLeadId] = useState("igor");
  const [slotId, setSlotId] = useState(windows[0].id);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now);
  const request = useRef<string | null>(null);
  const focusedLeadId = state.leads.find((item) => item.id === focus)?.id;
  useEffect(() => {
    if (focusedLeadId) setLeadId(focusedLeadId);
  }, [focusedLeadId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const busy = (start: string) =>
    state.appointments.some(
      (item) =>
        item.id !== editing &&
        ["booked", "completed"].includes(item.status) &&
        Date.parse(item.startsAt) < Date.parse(start) + 1800000 &&
        Date.parse(start) < Date.parse(item.endsAt),
    );
  const active = state.appointments
    .filter((item) => item.status === "booked")
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const completed = state.appointments.filter((item) => item.status === "completed");
  function book(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const slot = windows.find((item) => item.id === slotId);
    if (!slot) return;
    request.current ??= crypto.randomUUID();
    try {
      changeDemoCrm((current) =>
        editing
          ? rescheduleAppointment(
              current,
              current.workspaceId,
              editing,
              slot.startsAt,
              new Date(Date.parse(slot.startsAt) + 1800000).toISOString(),
              Date.now(),
            )
          : bookAppointment(
              current,
              current.workspaceId,
              {
                id: `appointment-${request.current}`,
                leadId,
                startsAt: slot.startsAt,
                endsAt: new Date(Date.parse(slot.startsAt) + 1800000).toISOString(),
                status: "booked",
              },
              Date.now(),
            ),
      );
      setNotice(
        editing
          ? "Встреча перенесена. Старое окно освобождено."
          : "Запись сохранена в демо. Это ещё не проведённая диагностика.",
      );
      setEditing(null);
      request.current = null;
    } catch (e) {
      setError(problem(e));
    }
  }
  function outcome(id: string, status: "completed" | "cancelled" | "no_show") {
    setError("");
    setNotice("");
    try {
      changeDemoCrm((current) =>
        appointmentOutcome(current, current.workspaceId, id, status, new Date().toISOString()),
      );
      setNotice(
        status === "completed"
          ? "Проведение диагностики отмечено."
          : status === "cancelled"
            ? "Запись отменена. Окно снова свободно."
            : "Неявка отмечена; проведённых диагностик не прибавилось.",
      );
    } catch (e) {
      setError(problem(e));
    }
  }
  return (
    <section className="crm-panel" aria-label="Расписание диагностик">
      <div className="crm-heading">
        <div>
          <span className="crm-kicker">СЛЕДУЮЩИЙ ШАГ К УЧЕНИКУ</span>
          <h2>
            <CalendarDays size={18} />
            Расписание диагностик
          </h2>
        </div>
        <span className="crm-period">Московское время</span>
      </div>
      <p className="crm-hint">
        Запись, проведение и оплата — разные события. Создание записи не увеличивает число
        проведённых диагностик.
      </p>
      {storageError ? (
        <p role="alert" className="crm-error">
          {storageError}
        </p>
      ) : null}
      <form
        className="crm-form appointment-form"
        onSubmit={book}
        aria-label="Запись на диагностику"
      >
        <label>
          Заявка
          <select
            value={leadId}
            disabled={Boolean(editing)}
            onChange={(e) => {
              setLeadId(e.target.value);
              request.current = null;
            }}
          >
            {state.leads.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ·{" "}
                {state.students.find((student) => student.id === item.studentId)?.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Окно · 30 минут
          <select
            value={slotId}
            onChange={(e) => {
              setSlotId(e.target.value);
              request.current = null;
            }}
          >
            {windows.map((slot) => (
              <option
                key={slot.id}
                value={slot.id}
                disabled={busy(slot.startsAt) || Date.parse(slot.startsAt) <= now}
              >
                {dateLabel(slot.startsAt)}, {timeLabel(slot.startsAt)}
                {busy(slot.startsAt) ? " · занято" : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="crm-primary" type="submit" disabled={Boolean(storageError)}>
          {editing ? "Сохранить перенос" : "Записать на диагностику"}
        </button>
        {editing ? (
          <button
            type="button"
            className="crm-secondary"
            onClick={() => {
              setEditing(null);
              request.current = null;
            }}
          >
            Отменить перенос
          </button>
        ) : null}
      </form>
      {error ? (
        <p role="alert" className="crm-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="crm-success">
          {notice}
        </p>
      ) : null}
      <h3 className="crm-subheading">Запланировано · {active.length}</h3>
      <div className="crm-appointments">
        {active.map((item) => {
          const lead = state.leads.find((lead) => lead.id === item.leadId)!;
          const ended = Date.parse(item.endsAt) <= now;
          return (
            <article className="crm-appointment" key={item.id}>
              <div>
                <strong>{lead.name}</strong>
                <p>
                  {dateLabel(item.startsAt)}, {timeLabel(item.startsAt)}–{timeLabel(item.endsAt)}
                </p>
                <span className="crm-status">
                  {ended ? "Нужен исход встречи" : "Запись подтверждена в демо"}
                </span>
              </div>
              <div className="crm-appointment-actions">
                {ended ? (
                  <>
                    <button
                      type="button"
                      className="crm-secondary"
                      onClick={() => outcome(item.id, "completed")}
                    >
                      Проведена
                    </button>
                    <button
                      type="button"
                      className="crm-secondary"
                      onClick={() => outcome(item.id, "no_show")}
                    >
                      Неявка
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="crm-secondary"
                    aria-label={`Перенести запись: ${lead.name}`}
                    onClick={() => {
                      setEditing(item.id);
                      setLeadId(item.leadId);
                      setSlotId(
                        windows.find((slot) => slot.startsAt === item.startsAt)?.id ||
                          windows[0].id,
                      );
                      setNotice("");
                      setError("");
                    }}
                  >
                    Перенести
                  </button>
                )}
                <button
                  type="button"
                  className="crm-quiet"
                  aria-label={`Отменить запись: ${lead.name}`}
                  onClick={() => outcome(item.id, "cancelled")}
                >
                  Отменить запись
                </button>
              </div>
            </article>
          );
        })}
        {!active.length ? (
          <p className="crm-hint">Пока нет предстоящих встреч. Выберите заявку и свободное окно.</p>
        ) : null}
      </div>
      <details className="crm-history">
        <summary>Проведённые диагностики · {completed.length}</summary>
        {completed.map((item) => (
          <p key={item.id}>
            {state.leads.find((lead) => lead.id === item.leadId)?.name}
            <span>{dateLabel(item.completedAt!)}</span>
          </p>
        ))}
      </details>
    </section>
  );
}

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Check, Plus, Wallet } from "lucide-react";
import {
  appointmentOutcome,
  bookAppointment,
  parseMoneyInput,
  recordPayment,
  recordRefund,
  paymentNet,
  updatePayment,
  rescheduleAppointment,
} from "./crm.ts";
import { changeDemoCrm, useDemoCrm } from "./demo-crm-store.ts";
import { windows } from "./data.ts";
import { ServiceDatePicker, ServiceSelect } from "./service-controls.tsx";
import "./payments.css";
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
    : "Не удалось сохранить изменения. Проверьте доступ к хранилищу браузера.";
}

export function PaymentsSection({
  focus,
  studentScope,
}: {
  focus?: string;
  studentScope?: string;
}) {
  const { state, storageError } = useDemoCrm();
  const [selectedStudentId, setStudentId] = useState(studentScope ?? "student-kirill");
  const studentId = studentScope ?? selectedStudentId;
  const [amount, setAmount] = useState("");
  const [paidDate, setPaidDate] = useState(todayMsk);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operation, setOperation] = useState<{ id: string; mode: "edit" | "refund" } | null>(null);
  const [operationAmount, setOperationAmount] = useState("");
  const [operationDate, setOperationDate] = useState(todayMsk);
  const request = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const operationForm = useRef<HTMLFormElement>(null);
  const focusedStudentId =
    state.leads.find((item) => item.id === focus)?.studentId ||
    state.students.find((item) => item.id === focus)?.id;
  useEffect(() => {
    if (focusedStudentId) {
      setStudentId(focusedStudentId);
      if (!studentScope) form.current?.scrollIntoView({ block: "center" });
    }
  }, [focusedStudentId, studentScope]);
  const isDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00+03:00`)) &&
    new Date(`${value}T12:00:00+03:00`).toISOString().slice(0, 10) === value;
  const dayOf = (value: string) =>
    new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 10);
  function add(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const minor = parseMoneyInput(amount);
    if (minor === null) {
      setError("Введите сумму больше 0 ₽, не более 999 999,99 ₽ и с точностью до копеек.");
      return;
    }
    if (!isDate(paidDate) || paidDate > todayMsk()) {
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
      request.current = null;
      setAmount("");
      setNotice("Оплата сохранена.");
    } catch (e) {
      setError(problem(e));
    }
  }
  const ledger = state.payments
    .filter((p) => !studentScope || p.studentId === studentScope)
    .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));
  const selectedPayment = operation ? ledger.find((payment) => payment.id === operation.id) : null;
  const selectedBalance = selectedPayment ? paymentNet(state, selectedPayment) : 0;
  const studentName = (id: string) =>
    state.students.find((student) => student.id === id)?.name || "Ученик";
  function begin(id: string, mode: "edit" | "refund") {
    const payment = ledger.find((item) => item.id === id);
    if (!payment) return;
    setOperation({ id, mode });
    setOperationAmount(
      ((mode === "edit" ? payment.amountMinor : paymentNet(state, payment)) / 100).toLocaleString(
        "ru-RU",
        { useGrouping: false, maximumFractionDigits: 2 },
      ),
    );
    setOperationDate(mode === "edit" ? dayOf(payment.paidAt) : todayMsk());
    setError("");
    setNotice("");
    window.setTimeout(
      () => operationForm.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
      0,
    );
  }
  function saveOperation(event: FormEvent) {
    event.preventDefault();
    if (!operation || !selectedPayment) return;
    setError("");
    setNotice("");
    const minor = parseMoneyInput(operationAmount);
    if (minor === null) {
      setError("Введите сумму больше 0 ₽ с точностью до копеек.");
      return;
    }
    if (!isDate(operationDate) || operationDate > todayMsk()) {
      setError("Укажите корректную дату не позже сегодняшней.");
      return;
    }
    const currentOperation = operation;
    try {
      changeDemoCrm((current) => {
        const payment = current.payments.find((item) => item.id === currentOperation.id);
        if (!payment) throw new Error("Оплата не найдена");
        if (currentOperation.mode === "edit")
          return updatePayment(current, current.workspaceId, {
            paymentId: payment.id,
            amountMinor: minor,
            paidAt:
              operationDate === dayOf(payment.paidAt)
                ? payment.paidAt
                : `${operationDate}T12:00:00+03:00`,
            changedAt: new Date().toISOString(),
          });
        // The date editor has day precision: a same-day refund must not precede
        // the payment solely because it uses noon as its technical timestamp.
        const refundedAt =
          operationDate === dayOf(payment.paidAt) &&
          Date.parse(payment.paidAt) > Date.parse(`${operationDate}T12:00:00+03:00`)
            ? payment.paidAt
            : `${operationDate}T12:00:00+03:00`;
        const key = crypto.randomUUID();
        return recordRefund(current, current.workspaceId, {
          id: `refund-${key}`,
          requestId: key,
          paymentId: payment.id,
          amountMinor: minor,
          refundedAt,
        });
      });
      setNotice(currentOperation.mode === "edit" ? "Оплата исправлена." : "Возврат внесён в учёт.");
      setOperation(null);
    } catch (e) {
      setError(problem(e));
    }
  }
  return (
    <section className="crm-panel payments-workspace" aria-label="Оплаты учеников">
      {!studentScope ? (
        <div className="crm-heading">
          <h2>
            <Wallet size={18} />
            Оплаты учеников
          </h2>
        </div>
      ) : null}
      {storageError ? (
        <p role="alert" className="crm-error">
          {storageError}
        </p>
      ) : null}
      <form ref={form} className="crm-form" onSubmit={add} aria-label="Внести оплату ученика">
        <div className="payments-student-field">
          <span>Ученик</span>
          <ServiceSelect
            label="Ученик"
            value={studentId}
            onChange={(value) => {
              setStudentId(value);
              request.current = null;
            }}
            options={state.students
              .filter((item) => !studentScope || item.id === studentScope)
              .map((item) => ({ value: item.id, label: item.name }))}
            disabled={Boolean(studentScope)}
          />
        </div>
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
          />
        </label>
        <ServiceDatePicker
          label="Дата оплаты"
          value={paidDate}
          max={todayMsk()}
          onChange={(value) => {
            setPaidDate(value);
            request.current = null;
          }}
        />
        <button type="submit" className="crm-primary" disabled={Boolean(storageError)}>
          <Plus size={16} />
          Сохранить оплату
        </button>
      </form>
      <div className="crm-table-wrap" tabIndex={0} aria-label="Реестр оплат и возвратов">
        <table className="crm-table payments-ledger">
          <thead>
            <tr>
              <th scope="col">Ученик</th>
              <th scope="col">Дата оплаты</th>
              <th scope="col">Получено</th>
              <th scope="col">Возвращено</th>
              <th scope="col">После возвратов</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((payment) => {
              const balance = paymentNet(state, payment),
                refunds = state.refunds
                  .filter((item) => item.paymentId === payment.id)
                  .sort((a, b) => Date.parse(b.refundedAt) - Date.parse(a.refundedAt));
              return (
                <Fragment key={payment.id}>
                  <tr>
                    <th scope="row">
                      <strong>{studentName(payment.studentId)}</strong>
                      <div className="payments-actions">
                        <button
                          type="button"
                          className="crm-quiet"
                          onClick={() => begin(payment.id, "edit")}
                          disabled={Boolean(storageError)}
                          aria-label={`Редактировать оплату: ${studentName(payment.studentId)}, ${dateLabel(payment.paidAt)}`}
                        >
                          Редактировать
                        </button>
                        <button
                          type="button"
                          className="crm-quiet"
                          disabled={!balance || Boolean(storageError)}
                          onClick={() => begin(payment.id, "refund")}
                          aria-label={`Внести возврат: ${studentName(payment.studentId)}, ${dateLabel(payment.paidAt)}`}
                        >
                          Внести возврат
                        </button>
                      </div>
                    </th>
                    <td data-label="Дата оплаты">{dateLabel(payment.paidAt)}</td>
                    <td data-label="Получено">{rub(payment.amountMinor)}</td>
                    <td data-label="Возвращено">{rub(payment.amountMinor - balance)}</td>
                    <td data-label="После возвратов">
                      <strong>{rub(balance)}</strong>
                    </td>
                  </tr>
                  {refunds.length ? (
                    <tr className="payments-refund-history">
                      <td colSpan={5}>
                        <details>
                          <summary>Возвраты по оплате: {refunds.length}</summary>
                          <ul>
                            {refunds.map((refund) => (
                              <li key={refund.id}>
                                <span>{dateLabel(refund.refundedAt)}</span>
                                <strong>− {rub(refund.amountMinor)}</strong>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!ledger.length ? <p className="payments-empty">Оплат пока нет.</p> : null}
      {selectedPayment && operation ? (
        <form
          ref={operationForm}
          className="crm-form payments-operation"
          onSubmit={saveOperation}
          aria-label={operation.mode === "edit" ? "Редактировать оплату" : "Внести возврат"}
        >
          <div className="payments-operation-title">
            <strong>
              {operation.mode === "edit" ? "Редактировать оплату" : "Внести возврат"} ·{" "}
              {studentName(selectedPayment.studentId)}
            </strong>
            <span>
              Оплата от {dateLabel(selectedPayment.paidAt)} · {rub(selectedPayment.amountMinor)}
            </span>
          </div>
          <label>
            {operation.mode === "edit" ? "Исправленная сумма, ₽" : "Сумма возврата, ₽"}
            <input
              inputMode="decimal"
              value={operationAmount}
              onChange={(e) => setOperationAmount(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </label>
          <ServiceDatePicker
            label={operation.mode === "edit" ? "Исправленная дата оплаты" : "Дата возврата"}
            value={operationDate}
            onChange={setOperationDate}
            max={todayMsk()}
            min={operation.mode === "refund" ? dayOf(selectedPayment.paidAt) : undefined}
          />
          {operation.mode === "refund" ? (
            <div className="payments-refund-total">
              <span>Можно вернуть: {rub(selectedBalance)}</span>
              <button
                type="button"
                className="crm-quiet"
                onClick={() =>
                  setOperationAmount(
                    (selectedBalance / 100).toLocaleString("ru-RU", {
                      useGrouping: false,
                      maximumFractionDigits: 2,
                    }),
                  )
                }
              >
                Весь остаток
              </button>
            </div>
          ) : null}
          <div className="payments-actions">
            <button className="crm-primary" type="submit" disabled={Boolean(storageError)}>
              {operation.mode === "edit" ? "Сохранить изменения" : "Сохранить возврат"}
            </button>
            <button
              className="crm-secondary"
              type="button"
              onClick={() => {
                setOperation(null);
                setError("");
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="crm-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="crm-success">
          <Check size={15} />
          {notice}
        </p>
      ) : null}
    </section>
  );
}

export function DiagnosticSection({ focus, leadScope }: { focus?: string; leadScope?: string }) {
  const { state, storageError } = useDemoCrm();
  const [selectedLeadId, setLeadId] = useState(leadScope ?? "igor");
  const leadId = leadScope ?? selectedLeadId;
  const [slotId, setSlotId] = useState(windows[0]?.id ?? "");
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
    .filter((item) => item.status === "booked" && (!leadScope || item.leadId === leadScope))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const completed = state.appointments.filter(
    (item) => item.status === "completed" && (!leadScope || item.leadId === leadScope),
  );
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
      setNotice(editing ? "Встреча перенесена. Старое окно освобождено." : "Запись сохранена.");
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
      {!leadScope ? (
        <div className="crm-heading">
          <div>
            <h2>
              <CalendarDays size={18} />
              Расписание диагностик
            </h2>
          </div>
          <span className="crm-period">Московское время</span>
        </div>
      ) : null}
      {storageError ? (
        <p role="alert" className="crm-error">
          {storageError}
        </p>
      ) : null}
      {!leadScope || !active.length || editing ? (
        <form
          className="crm-form appointment-form"
          onSubmit={book}
          aria-label="Запись на диагностику"
        >
          <label>
            Заявка
            <ServiceSelect
              label="Заявка"
              value={leadId}
              disabled={Boolean(editing)}
              onChange={(value) => {
                setLeadId(value);
                request.current = null;
              }}
              options={state.leads
                .filter((item) => !item.closedAt && (!leadScope || item.id === leadScope))
                .map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${state.students.find((student) => student.id === item.studentId)?.name || ""}`,
                }))}
            />
          </label>
          <label>
            Окно · 30 минут, МСК
            <ServiceSelect
              label="Окно · 30 минут, МСК"
              value={slotId}
              disabled={!windows.length}
              placeholder={windows.length ? "Выберите окно" : "Нет доступных окон"}
              onChange={(value) => {
                setSlotId(value);
                request.current = null;
              }}
              options={windows.map((slot) => ({
                value: slot.id,
                label: `${dateLabel(slot.startsAt)}, ${timeLabel(slot.startsAt)}${Date.parse(slot.startsAt) <= now ? " · прошло" : busy(slot.startsAt) ? " · занято" : ""}`,
                disabled: busy(slot.startsAt) || Date.parse(slot.startsAt) <= now,
              }))}
            />
          </label>
          <button
            className="crm-primary"
            type="submit"
            disabled={
              Boolean(storageError) ||
              !slotId ||
              (!editing &&
                windows.some(
                  (slot) =>
                    slot.id === slotId && (busy(slot.startsAt) || Date.parse(slot.startsAt) <= now),
                ))
            }
          >
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
      ) : null}
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
                  {ended ? "Нужен исход встречи" : "Запись подтверждена"}
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
                        (windows.find((slot) => slot.startsAt === item.startsAt)?.id ||
                          windows[0]?.id) ??
                          "",
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
          <p className="crm-hint">
            {windows.length
              ? "Пока нет предстоящих встреч. Выберите заявку и свободное окно."
              : "Пока нет предстоящих встреч и доступных окон."}
          </p>
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

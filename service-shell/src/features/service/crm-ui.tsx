import { AdsSelect } from "./ads-controls";
import { ServiceDatePicker } from "./service-date-picker";
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
  const request = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const focusedStudentId =
    state.leads.find((item) => item.id === focus)?.studentId ||
    state.students.find((item) => item.id === focus)?.id;
  useEffect(() => {
    if (focusedStudentId) {
      setStudentId(focusedStudentId);
      if (!studentScope) form.current?.scrollIntoView({ block: "center" });
    }
  }, [focusedStudentId, studentScope]);
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
      setNotice("Оплата сохранена.");
    } catch (e) {
      setError(problem(e));
    }
  }
  const ledger = state.payments
    .filter((p) => !studentScope || p.studentId === studentScope)
    .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));
  return (
    <section className="crm-panel" aria-label="Оплаты учеников">
      {!studentScope ? (
        <div className="crm-heading">
          <div>
            <h2>
              <Wallet size={18} />
              Оплаты учеников
            </h2>
          </div>
          <span className="crm-period">Ноябрь 2026 · МСК</span>
        </div>
      ) : null}
      {!studentScope ? (
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
      ) : null}
      {storageError ? (
        <p role="alert" className="crm-error">
          {storageError}
        </p>
      ) : null}
      <form ref={form} className="crm-form" onSubmit={add} aria-label="Внести оплату ученика">
        <label>
          Ученик
          <AdsSelect
            label="Ученик"
            value={studentId}
            onChange={(value) => {
              setStudentId(value);
              request.current = null;
            }}
            options={state.students
              .filter((item) => !studentScope || item.id === studentScope)
              .map((item) => ({ value: item.id, label: item.name }))}
          />
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
          <ServiceDatePicker
            value={paidDate}
            max={todayMsk()}
            onChange={(value) => {
              setPaidDate(value);
              request.current = null;
            }}
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
      {!studentScope && metrics.unpaidStudentIds.length ? (
        <div className="crm-unpaid">
          <strong>После диагностики, без отмеченной оплаты</strong>
          <span>
            {metrics.unpaidStudentIds
              .map((id) => state.students.find((item) => item.id === id)?.name)
              .join(", ")}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function DiagnosticSection({ focus, leadScope }: { focus?: string; leadScope?: string }) {
  const { state, storageError } = useDemoCrm();
  const [selectedLeadId, setLeadId] = useState(leadScope ?? "igor");
  const leadId = leadScope ?? selectedLeadId;
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
            <AdsSelect
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
            <AdsSelect
              label="Окно · 30 минут, МСК"
              value={slotId}
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

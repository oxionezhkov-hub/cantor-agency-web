import { getPreviewData } from "./preview-data";
import { fundsEstimate } from "./live-funds-model";
const rub = (v: number | null | undefined) =>
  v == null ? "Нет данных" : v.toLocaleString("ru-RU", { style: "currency", currency: "RUB" });
export function LiveFunds() {
  const p = getPreviewData(),
    data = p?.liveMoney,
    meta = p?.live?.metrics;
  if (!p) return null;
  const estimate = fundsEstimate(data, meta?.observedAt);
  return (
    <article className="brief-panel live-funds">
      <h3>Средства Авито</h3>
      <div className="live-funds-balances">
        <p>
          Кошелёк <strong>{rub(data?.wallet?.realRub)}</strong>
          {data?.wallet?.stale ? "Последний полученный остаток" : ""}
          {data?.wallet?.observedAt ? (
            <small> · {new Date(data.wallet.observedAt).toLocaleTimeString("ru-RU")}</small>
          ) : null}
        </p>
        <p>
          Бонусы кошелька <strong>{rub(data?.wallet?.bonusRub)}</strong>
        </p>
        <p>
          Аванс CPA <strong>{rub(data?.advance?.rub)}</strong>
          {data?.advance?.stale ? "Последний полученный остаток" : ""}
          {data?.advance?.observedAt ? (
            <small> · {new Date(data.advance.observedAt).toLocaleTimeString("ru-RU")}</small>
          ) : null}
        </p>
      </div>
      {!meta?.observedAt || meta?.error ? (
        <p>
          {meta?.error
            ? "Не удалось обновить; показаны последние полученные данные"
            : "Получаем текущие остатки…"}
        </p>
      ) : null}
      <p>
        Прогноз остатка: {estimate.reason}.
        {estimate.available
          ? ` Примерно ${estimate.remainingDays.toFixed(1)} дн., до ${new Date(estimate.exhaustsAt).toLocaleDateString("ru-RU")}. Формула: ${estimate.formula}.`
          : ""}{" "}
        Кошелёк и аванс не складываются.
      </p>
      {data?.coverage.from && (
        <p>
          Расходы: {data.coverage.from} — {data.coverage.to}, завершённые дни по Москве.{" "}
          {data.coverage.complete ? "Период получен полностью." : "Покрытие неполное."}
        </p>
      )}
      {data?.days.length ? (
        <details>
          <summary>Расходы по дням · {data.days.length}</summary>
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Расход объявлений</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{rub(d.spendRub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Источник: статистика объявлений; это не полная выписка кошелька.</p>
        </details>
      ) : null}
      {data?.expenses?.length ? (
        <details>
          <summary>Детализация расходов профиля</summary>
          {data.expenses.map((d) => (
            <p key={d.date}>
              {d.date}:{" "}
              {d.spendings
                .map(
                  (s) =>
                    `${({ all: "Все", promotion: "Продвижение", presence: "Размещение и целевые действия", commission: "Комиссии", rest: "Прочие" } as Record<string, string>)[s.type]} ${rub(s.rub)}`,
                )
                .join(" · ")}
            </p>
          ))}
        </details>
      ) : null}
      {data?.errors?.map((e) => (
        <p key={e.part} role="status">
          {e.part === "expenseBreakdown"
            ? "Детализация расходов"
            : e.part === "advance"
              ? "Аванс"
              : e.part === "wallet"
                ? "Кошелёк"
                : "История расходов"}
          : недоступно ({e.code}, {e.origin || "источник"}).
        </p>
      ))}
    </article>
  );
}

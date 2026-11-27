export async function cabinetRequest<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok) throw new CabinetError(data.error, response.status);
  return data;
}

export class CabinetError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(messages[code] || "Не удалось выполнить действие. Попробуйте ещё раз.");
  }
}

const messages: Record<string, string> = {
  invalid_credentials: "Неверный логин или пароль.",
  unauthorized: "Сеанс завершён. Войдите снова.",
  invalid_employee: "Введите имя и логин латиницей, от 3 символов.",
  employee_exists: "Этот логин уже используется в кабинете.",
  invalid_connection: "Проверьте название кабинета, ID пользователя и данные подключения.",
  invalid_password: "Введите пароль длиной от 12 до 256 символов.",
  invalid_password_or_session: "Выберите новый пароль. Если сеанс истёк, войдите ещё раз.",
  connection_busy: "Подключение используется для загрузки. Дождитесь завершения.",
  connection_unavailable: "Сначала настройте подключение к Авито.",
  rate_limited: "Слишком много попыток. Повторите через минуту.",
  avito_account_mismatch: "Ключи Авито относятся к другому ID пользователя.",
  source_not_configured: "Источник Авито ещё не настроен.",
  cantor_rate_limit: "Ожидаем освобождения лимита запросов.",
};
export const cabinetReason = (code: string) =>
  messages[code] ||
  (/^avito_http_\d{3}$/.test(code)
    ? "Авито вернуло ошибку " + code.slice(-3) + "."
    : "Не удалось получить данные Авито.");

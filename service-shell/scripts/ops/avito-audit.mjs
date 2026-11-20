import { passwordAuthorized, sessionAuthorized } from "./demo-session.mjs";
export const ACCOUNT = "6c974a5d5326";
export const WORKSPACE = "elena-dobrynina";
const headers = {
  "cache-control": "no-store, private",
  "content-type": "application/json",
  "x-content-type-options": "nosniff",
  vary: "Cookie, x-avito-audit-password",
};
// A deliberately small read-only catalogue. No raw proxy, sync, uploads or messages.
export const sections = [
  ["identity", "Профиль", "GET", "/core/v1/accounts/self"],
  ["items", "Объявления", "GET", "/core/v1/items"],
  ["chats", "Диалоги: только метаданные", "GET", "/messenger/v2/accounts/{user}/chats"],
  ["stats", "Статистика за завершённый день", "POST", "/stats/v2/accounts/{user}/items"],
  ["spendings", "Расходы за завершённый день", "POST", "/stats/v2/accounts/{user}/spendings"],
  ["balance", "Кошелёк", "GET", "/core/v1/accounts/{user}/balance/"],
  ["autoload", "История автозагрузки v4", "GET", "/autoload/v4/uploads"],
  ["rating", "Рейтинг", "GET", "/ratings/v1/info"],
  ["reviews", "Отзывы: только метаданные", "GET", "/ratings/v1/reviews"],
].map(([id, label, method, path]) => ({ id, label, method, path }));
const paged = new Set(["items", "chats", "autoload", "reviews"]);
const json = (body, status = 200) => Response.json(body, { status, headers });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function retryDelay(value, attempt, now = Date.now()) {
  const seconds = Number(value);
  const date = Date.parse(value || "");
  return Math.min(
    2000,
    Math.max(
      100,
      Number.isFinite(seconds) && value !== null
        ? seconds * 1000
        : Number.isFinite(date)
          ? date - now
          : 250 * 2 ** attempt,
    ),
  );
}
async function deadline(work, ms = 5000) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function boundedJson(response) {
  if (Number(response.headers.get("content-length")) > 262144) throw Error("response_budget");
  const reader = response.body?.getReader();
  if (!reader) throw Error("empty_response");
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) throw Error("response_budget");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function list(data, id) {
  if (id === "items") return data.resources;
  if (id === "chats") return data.chats;
  if (id === "reviews") return data.reviews;
  if (id === "autoload") return data.uploads;
  return null;
}
// Only explicitly named numeric values survive. Names, IDs, URLs, bodies and error text never do.
export function project(data, id) {
  const values = {};
  const allowed =
    id === "balance"
      ? ["real", "bonus"]
      : id === "rating"
        ? ["score", "reviewsCount", "reviews_count"]
        : [];
  for (const key of allowed)
    if (typeof data[key] === "number" && Number.isFinite(data[key])) values[key] = data[key];
  const rows = list(data, id);
  if (Array.isArray(rows)) values.records = rows.length;
  if (id === "identity") values.identityVerified = true;
  if (id === "stats" || id === "spendings") {
    const groups = data.result?.groupings;
    values.groups = Array.isArray(groups) ? groups.length : 0;
    // Counts prove response shape, not completeness of account totals.
    values.metricValues = Array.isArray(groups)
      ? groups.reduce((n, g) => n + (Array.isArray(g.metrics) ? g.metrics.length : 0), 0)
      : 0;
    if (id === "stats" && Array.isArray(groups) && groups.length === 1) {
      for (const metric of groups[0].metrics || [])
        if (
          ["impressions", "views", "contacts", "allSpending"].includes(metric.slug) &&
          typeof metric.value === "number" &&
          Number.isFinite(metric.value)
        )
          values[metric.slug] = metric.value;
    }
  }
  return values;
}
export async function avitoAudit(request, env, options = {}) {
  const url = new URL(request.url);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const loggedIn =
    (await passwordAuthorized(request, env.DEMO_PASSWORD_SHA256)) ||
    (await sessionAuthorized(request, env.DEMO_PASSWORD_SHA256));
  if (!loggedIn) return json({ error: "unauthorized" }, 401);
  const adminRequest = new Request(request.url, {
    headers: { "x-demo-password": request.headers.get("x-avito-audit-password") || "" },
  });
  if (!(await passwordAuthorized(adminRequest, env.AVITO_AUDIT_ADMIN_SHA256)))
    return json(
      { error: "admin_required", message: "Нужен отдельный допуск администратора к отчёту." },
      403,
    );
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return json({ error: "origin_denied" }, 403);
  if (
    [...url.searchParams.keys()].some((k) => !["section", "page"].includes(k)) ||
    url.searchParams.getAll("section").length > 1 ||
    url.searchParams.getAll("page").length > 1
  )
    return json({ error: "invalid_query" }, 400);
  const pageText = url.searchParams.get("page") || "0";
  const page = Number(pageText);
  const section = sections.find((s) => s.id === url.searchParams.get("section"));
  if (
    !section ||
    !/^\d{1,2}$/.test(pageText) ||
    page > 19 ||
    (!paged.has(section.id) && page !== 0)
  )
    return json({ error: "invalid_query" }, 400);
  if (
    env.AVITO_AUDIT_ENABLED !== "dobrynina-read-v1" ||
    !env.AVITO_AUDIT_SOURCE?.fetch ||
    !/^\d{1,20}$/.test(env.AVITO_AUDIT_USER_ID || "")
  )
    return json(
      {
        error: "not_configured",
        message:
          "Отчёт заблокирован: нужен изолированный источник чтения и подтверждённая привязка кабинета Добрыниной.",
      },
      503,
    );
  if (!env.AVITO_AUDIT_LIMIT?.limit) return json({ error: "limiter_not_configured" }, 503);
  if (!(await env.AVITO_AUDIT_LIMIT.limit({ key: WORKSPACE })).success)
    return json({ error: "audit_rate_limit", retryAfterMs: 2000 }, 429);
  const yesterday = new Date(Date.now() + 3 * 3600000 - 86400000).toISOString().slice(0, 10);
  const target = new URL(
    section.path.replace("{user}", env.AVITO_AUDIT_USER_ID),
    "https://api.avito.ru",
  );
  if (section.id === "items") {
    target.searchParams.set("per_page", "50");
    target.searchParams.set("page", String(page + 1));
  }
  if (section.id === "chats") {
    target.searchParams.set("limit", "50");
    target.searchParams.set("offset", String(page * 50));
  }
  if (section.id === "reviews") {
    target.searchParams.set("limit", "50");
    target.searchParams.set("offset", String(page * 50));
  }
  if (section.id === "autoload") {
    target.searchParams.set("perPage", "50");
    target.searchParams.set("page", String(page + 1));
  }
  if (section.id === "rating") target.searchParams.set("user_id", env.AVITO_AUDIT_USER_ID);
  const body =
    section.id === "stats"
      ? {
          dateFrom: yesterday,
          dateTo: yesterday,
          metrics: ["impressions", "views", "contacts", "allSpending"],
          grouping: "totals",
          limit: 1,
          offset: 0,
        }
      : section.id === "spendings"
        ? { dateFrom: yesterday, dateTo: yesterday, grouping: "day" }
        : null;
  const started = Date.now();
  let attempts = 0;
  let last = "network";
  let status = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() - started >= 19000) {
      last = "request_time_budget";
      break;
    }
    attempts++;
    try {
      const response = await deadline(
        env.AVITO_AUDIT_SOURCE.fetch(
          new Request(target, {
            method: section.method,
            headers: {
              "content-type": "application/json",
              "x-cantor-workspace": WORKSPACE,
              "x-cantor-account": ACCOUNT,
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          }),
        ),
        Math.max(1, Math.min(5000, 20000 - (Date.now() - started))),
      );
      status = response.status;
      // Dedicated binding must attest its pinned connection; never trust caller-controlled identity.
      if (
        response.headers.get("x-cantor-account") !== ACCOUNT ||
        response.headers.get("x-cantor-workspace") !== WORKSPACE
      )
        throw Error("connection_mismatch");
      if (!response.ok) {
        await response.body?.cancel();
        last = `http_${status}`;
        if ((status === 429 || status >= 500) && attempt < 2) {
          await (options.sleep || delay)(retryDelay(response.headers.get("retry-after"), attempt));
          continue;
        }
        break;
      }
      const data = await deadline(
        boundedJson(response),
        Math.max(1, Math.min(5000, 20000 - (Date.now() - started))),
      );
      if (section.id === "identity" && String(data.id) !== env.AVITO_AUDIT_USER_ID)
        throw Error("connection_mismatch");
      if (
        (section.id === "stats" || section.id === "spendings") &&
        !Array.isArray(data.result?.groupings)
      )
        throw Error("unexpected_shape");
      const rows = list(data, section.id);
      if (paged.has(section.id) && !Array.isArray(rows)) throw Error("unexpected_shape");
      const more = paged.has(section.id) && rows.length === 50;
      return json({
        workspace: WORKSPACE,
        account: ACCOUNT,
        section: section.id,
        page,
        status: "available",
        httpStatus: status,
        attempts,
        elapsedMs: Date.now() - started,
        observedAt: new Date().toISOString(),
        period: body ? { from: yesterday, to: yesterday, timeZone: "Europe/Moscow" } : null,
        summary: project(data, section.id),
        units: { allSpending: "kopecks", real: "rubles", bonus: "rubles" },
        coverage: {
          pageSize: paged.has(section.id) ? 50 : null,
          complete: !more,
          nextPage: more && page < 19 ? page + 1 : null,
          truncated: more && page === 19,
          scope: paged.has(section.id) ? "bounded_pages" : "single_response",
        },
        redacted: [
          "access tokens",
          "credentials",
          "names",
          "contact details",
          "external IDs",
          "message/review bodies",
          "URLs",
          "raw errors",
        ],
      });
    } catch (error) {
      last = [
        "response_budget",
        "connection_mismatch",
        "unexpected_shape",
        "empty_response",
      ].includes(error.message)
        ? error.message
        : "network_or_timeout";
      if (last !== "network_or_timeout" || attempt === 2) break;
      await (options.sleep || delay)(retryDelay(null, attempt));
    }
  }
  return json(
    {
      workspace: WORKSPACE,
      account: ACCOUNT,
      section: section.id,
      page,
      status: status === 401 || status === 403 || status === 404 ? "unavailable" : "error",
      httpStatus: status,
      error: last,
      attempts,
      elapsedMs: Date.now() - started,
      coverage: { complete: false, nextPage: page },
      retryable: last === "network_or_timeout" || status === 429 || status >= 500,
    },
    200,
  );
}

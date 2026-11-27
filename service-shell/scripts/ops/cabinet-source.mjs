const origin = "https://api.avito.ru";
export const PAGE_SIZE = 25;
export const MAX_PAGES = 20;
export const MAX_JOB_STEPS = 400;
const text = (v, length) => (typeof v === "string" ? v.slice(0, length) : "");
const date = (v) => (Number(v) > 0 ? Number(v) * 1000 : 0);
const id = (v) => (/^[A-Za-z0-9_~-]{1,150}$/.test(String(v ?? "")) ? String(v) : "");
const rows = (data, key) => {
  if (!Array.isArray(data[key])) throw new SourceError("unexpected_source_response");
  return data[key].slice(0, PAGE_SIZE);
};
export class SourceError extends Error {
  constructor(code, status = 0, retryAfter = null) {
    super(code);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
async function official(env, path, options = {}) {
  if (env.CABINET_SOURCE_MODE === "synthetic") return synthetic(path, options);
  if (env.CABINET_SOURCE_MODE !== "avito") throw new SourceError("source_not_configured");
  const response = await fetch(origin + path, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceError(
      "avito_http_" + response.status,
      response.status,
      response.headers.get("retry-after"),
    );
  }
  const reader = response.body.getReader();
  const parts = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 4 * 1024 * 1024) {
      await reader.cancel();
      throw new SourceError("source_response_too_large");
    }
    parts.push(chunk.value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}
export async function getToken(env, credentials, userId) {
  if (env.CABINET_SOURCE_MODE === "synthetic")
    return { value: userId, expires: Date.now() + 3600000 };
  const result = await official(env, "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  });
  if (typeof result.access_token !== "string") throw new SourceError("source_token_invalid");
  return {
    value: result.access_token,
    expires: Date.now() + 1000 * Math.max(0, Number(result.expires_in) - 60 || 0),
  };
}
const auth = (token) => ({ headers: { authorization: "Bearer " + token.value } });
export async function checkConnection(env, token, userId) {
  const account = await official(env, "/core/v1/accounts/self", auth(token));
  if (String(account.id) !== userId) throw new SourceError("avito_account_mismatch", 403);
}
function message(m, userId) {
  return {
    id: id(m.id),
    at: date(m.created),
    author: m.type === "system" ? "system" : String(m.author_id) === userId ? "manager" : "client",
    type: text(m.type, 30) || "text",
    text: text(m.content?.text || m.content?.call?.status || "", 10000),
  };
}
function chat(c, userId) {
  const other = Array.isArray(c.users)
    ? c.users.find((entry) => String(entry.id) !== userId)
    : undefined;
  const last = message(c.last_message || {}, userId);
  return {
    id: id(c.id),
    name: text(other?.name, 120) || "Собеседник",
    itemId: id(c.context?.value?.id) || undefined,
    itemTitle: text(c.context?.value?.title, 250),
    lastAt: last.at || date(c.updated || c.created),
    lastMessageId: last.id,
    lastText: last.text.slice(0, 1500),
    lastAuthor: last.author,
  };
}
function ad(a) {
  return {
    id: id(a.id),
    title: text(a.title, 250),
    status: text(a.status, 50) || "unknown",
    price: typeof a.price === "number" ? a.price : null,
    url: /^https:\/\/(www\.)?avito\.ru\//.test(a.url || "") ? text(a.url, 1000) : "",
    city: text(a.address?.city || a.city, 120),
    description: null,
  };
}
export async function readStatistics(env, token, userId, now = Date.now()) {
  const dateTo = new Date(now + 3 * 3600000 - 86400000).toISOString().slice(0, 10);
  const dateFrom = new Date(now + 3 * 3600000 - 14 * 86400000).toISOString().slice(0, 10);
  const authorization = auth(token);
  // Avito exposes aggregate statistics through an expressly read-only POST.
  const data = await official(env, `/stats/v2/accounts/${userId}/items`, {
    method: "POST",
    headers: { ...authorization.headers, "content-type": "application/json" },
    body: JSON.stringify({
      dateFrom,
      dateTo,
      metrics: ["impressions", "views", "contacts", "allSpending"],
      grouping: "day",
      limit: 30,
      offset: 0,
    }),
  });
  if (!Array.isArray(data.result?.groupings)) throw new SourceError("unexpected_source_response");
  const accountDaily = data.result.groupings.slice(0, 14).flatMap((group) => {
    const millis = date(group.id);
    if (!millis) return [];
    const day = new Date(millis).toISOString().slice(0, 10);
    if (day < dateFrom || day > dateTo) return [];
    const fields = Object.fromEntries(
      (group.metrics || []).map(({ slug, value }) => [slug, value]),
    );
    const { impressions, views, contacts, allSpending } = fields;
    if (![impressions, views, contacts, allSpending].every(Number.isFinite)) return [];
    return [{ date: day, shows: impressions, views, contacts, spendRub: allSpending / 100 }];
  });
  return { accountDaily, defaultPeriod: { from: dateFrom, to: dateTo } };
}
export async function readBalance(env, token, userId) {
  const result = await official(env, `/core/v1/accounts/${userId}/balance/`, auth(token));
  if (![result.real, result.bonus].every(Number.isFinite))
    throw new SourceError("unexpected_source_response");
  return { real: result.real, bonus: result.bonus };
}
export async function readPage(env, token, userId, phase, page, chatId) {
  const offset = page * PAGE_SIZE;
  const options = auth(token);
  if (phase === "ads") {
    const data = await official(
      env,
      `/core/v1/items?per_page=${PAGE_SIZE}&page=${page + 1}&status=active,old,removed,blocked,rejected`,
      options,
    );
    const list = rows(data, "resources");
    return { more: list.length === PAGE_SIZE, items: list.map(ad).filter((item) => item.id) };
  }
  if (phase === "chats") {
    const data = await official(
      env,
      `/messenger/v2/accounts/${userId}/chats?limit=${PAGE_SIZE}&offset=${offset}`,
      options,
    );
    const list = rows(data, "chats");
    return {
      more: list.length === PAGE_SIZE,
      items: list.map((entry) => chat(entry, userId)).filter((entry) => entry.id && entry.lastAt),
    };
  }
  if (phase === "messages" && id(chatId)) {
    const data = await official(
      env,
      `/messenger/v3/accounts/${userId}/chats/${chatId}/messages/?limit=${PAGE_SIZE}&offset=${offset}`,
      options,
    );
    const list = rows(data, "messages");
    return {
      more: list.length === PAGE_SIZE,
      items: list.map((entry) => message(entry, userId)).filter((entry) => entry.id && entry.at),
    };
  }
  throw new SourceError("unknown_import_phase");
}
function synthetic(path, options) {
  const userId = options.headers?.authorization?.slice(7) || "101";
  const now = Math.floor(Date.now() / 1000);
  if (path === "/token") return { access_token: "synthetic", expires_in: 3600 };
  if (path === "/core/v1/accounts/self") return { id: userId };
  if (path.endsWith("/balance/")) return { real: 1200, bonus: 50 };
  if (path.startsWith("/stats/")) return { result: { groupings: [] } };
  if (path.startsWith("/core/v1/items?"))
    return {
      resources: [
        { id: userId + "01", title: "Занятия по математике", status: "active", price: 1900 },
      ],
    };
  if (path.includes("/messages/"))
    return {
      messages: [
        {
          id: "synthetic-message",
          created: now,
          author_id: "102",
          type: "text",
          content: { text: "Здравствуйте! Есть свободное время для занятия?" },
        },
      ],
    };
  return {
    chats: [
      {
        id: "synthetic-chat-" + userId,
        created: now,
        users: [{ id: "102", name: "Тестовый ученик " + userId }],
        context: { value: { id: userId + "01" } },
      },
    ],
  };
}

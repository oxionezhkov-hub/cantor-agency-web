// Internal preview service only. No public routes, KV writes, account selection or raw proxy.
const ACCOUNT = "6c974a5d5326",
  WORKSPACE = "elena-dobrynina",
  USER = "388298238";
const PROXY = "https://functions.yandexcloud.net/d4eiu56ijlg0jn5o9rch";
const fixedHeaders = {
  "cache-control": "no-store, private",
  "x-cantor-account": ACCOUNT,
  "x-cantor-workspace": WORKSPACE,
};
const deny = (error, status = 403) => Response.json({ error }, { status, headers: fixedHeaders });
function exactKeys(params, keys) {
  return (
    [...params.keys()].every((k) => keys.includes(k) && params.getAll(k).length === 1) &&
    keys.every((k) => params.has(k))
  );
}
export async function validateRead(request) {
  const url = new URL(request.url),
    p = url.pathname,
    q = url.searchParams;
  if (url.origin !== "https://api.avito.ru" || url.username || url.password || url.hash)
    return false;
  if (
    request.headers.get("x-cantor-account") !== ACCOUNT ||
    request.headers.get("x-cantor-workspace") !== WORKSPACE
  )
    return false;
  const page = (key) =>
    /^\d{1,2}$/.test(q.get(key) || "") && Number(q.get(key)) >= 1 && Number(q.get(key)) <= 20;
  const offset = () =>
    /^\d{1,3}$/.test(q.get("offset") || "") &&
    Number(q.get("offset")) <= 950 &&
    Number(q.get("offset")) % 50 === 0;
  if (request.method === "GET") {
    if (["/core/v1/accounts/self", `/core/v1/accounts/${USER}/balance/`].includes(p))
      return !url.search;
    if (p === "/ratings/v1/info") return exactKeys(q, ["user_id"]) && q.get("user_id") === USER;
    if (p === "/core/v1/items")
      return exactKeys(q, ["per_page", "page"]) && q.get("per_page") === "50" && page("page");
    if (p === `/messenger/v2/accounts/${USER}/chats` || p === "/ratings/v1/reviews")
      return exactKeys(q, ["limit", "offset"]) && q.get("limit") === "50" && offset();
    if (p === "/autoload/v4/uploads")
      return exactKeys(q, ["perPage", "page"]) && q.get("perPage") === "50" && page("page");
    return false;
  }
  if (
    request.method !== "POST" ||
    url.search ||
    !["items", "spendings"].some((s) => p === `/stats/v2/accounts/${USER}/${s}`)
  )
    return false;
  if (Number(request.headers.get("content-length")) > 1024) return false;
  const text = await request.text();
  if (text.length > 1024) return false;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return false;
  }
  const yesterday = new Date(Date.now() + 3 * 3600000 - 86400000).toISOString().slice(0, 10);
  const expected = p.endsWith("/items")
    ? {
        dateFrom: yesterday,
        dateTo: yesterday,
        metrics: ["impressions", "views", "contacts", "allSpending"],
        grouping: "totals",
        limit: 1,
        offset: 0,
      }
    : { dateFrom: yesterday, dateTo: yesterday, grouping: "day" };
  return (
    Object.keys(body).length === Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, value]) => JSON.stringify(body[key]) === JSON.stringify(value),
    )
  );
}
export default {
  async fetch(request, env) {
    const gate = request.headers.get("x-cantor-audit-gate") || "";
    if (!env.AUDIT_GATE_SHA256 || !gate || gate.length > 256) return deny("internal_only");
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(gate))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    let diff = digest.length ^ env.AUDIT_GATE_SHA256.length;
    for (let i = 0; i < digest.length; i++)
      diff |= digest.charCodeAt(i) ^ (env.AUDIT_GATE_SHA256.charCodeAt(i) || 0);
    if (diff) return deny("internal_only");
    if (!env.SOURCE_LIMIT?.limit) return deny("limiter_unavailable", 503);
    if (!(await env.SOURCE_LIMIT.limit({ key: WORKSPACE })).success)
      return deny("source_rate_limit", 429);
    if (!env.AUDIT_CONNECTION_KV?.get) return deny("connection_unavailable", 503);
    // Validate cloned request before reading the one authorized credential record.
    if (!(await validateRead(request.clone()))) return deny("read_not_allowed");
    try {
      const account = await env.AUDIT_CONNECTION_KV.get(`account:${ACCOUNT}`, "json");
      if (
        account?.id !== ACCOUNT ||
        String(account?.userId) !== USER ||
        !account.clientId ||
        !account.clientSecret
      )
        return deny("connection_mismatch", 503);
      const url = new URL(request.url),
        target = new URL(PROXY);
      target.searchParams.set("p", `/avito-call${url.pathname}${url.search}`);
      const response = await (env.testFetch || fetch)(target, {
        method: request.method,
        headers: {
          "content-type": "application/json",
          "x-avito-client-id": account.clientId,
          "x-avito-client-secret": account.clientSecret,
        },
        body: request.method === "POST" ? await request.text() : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return deny(`avito_http_${response.status}`, response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) return deny("empty_response", 502);
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 262144) return deny("response_budget", 502);
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      // Validate JSON; do not return token/auth responses or non-JSON proxy failures.
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (data.access_token || data.refresh_token || data.client_secret)
        return deny("unexpected_response", 502);
      return new Response(bytes, {
        headers: { ...fixedHeaders, "content-type": "application/json" },
      });
    } catch {
      return deny("source_unavailable", 503);
    }
  },
};

// Internal preview service only. No public routes, KV writes, account selection or raw proxy.
const ACCOUNT = "6c974a5d5326",
  WORKSPACE = "elena-dobrynina",
  USER = "388298238";
// Only the official Avito origin is used. No third-party credential transport.
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
    if (["/autoload/v4/uploads/current", "/autoload/v4/uploads/last_successful"].includes(p))
      return !url.search;
    if (/^\/autoload\/v4\/uploads\/(current|last_successful)\/items$/.test(p))
      return exactKeys(q, ["perPage", "page"]) && q.get("perPage") === "50" && page("page");
    if (
      new RegExp(`^/messenger/v3/accounts/${USER}/chats/[A-Za-z0-9_~-]{1,150}/messages/$`).test(p)
    )
      return exactKeys(q, ["limit", "offset"]) && q.get("limit") === "50" && offset();
    if (p === "/ratings/v1/info") return exactKeys(q, ["user_id"]) && q.get("user_id") === USER;
    if (p === "/core/v1/items")
      return (
        (exactKeys(q, ["per_page", "page"]) ||
          (exactKeys(q, ["per_page", "page", "status"]) &&
            q.get("status") === "active,old,removed,blocked,rejected")) &&
        q.get("per_page") === "50" &&
        page("page")
      );
    if (p === `/messenger/v2/accounts/${USER}/chats` || p === "/ratings/v1/reviews")
      return exactKeys(q, ["limit", "offset"]) && q.get("limit") === "50" && offset();
    if (p === "/autoload/v4/uploads")
      return exactKeys(q, ["perPage", "page"]) && q.get("perPage") === "50" && page("page");
    return false;
  }
  if (request.method === "POST" && p === "/cpa/v3/balanceInfo" && !url.search)
    return (await request.text()).trim() === "{}";
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
  if (p.endsWith("/spendings") && Array.isArray(body.spendingTypes)) {
    const from = new Date(Date.now() + 3 * 3600000 - 14 * 86400000).toISOString().slice(0, 10);
    const expected = { dateFrom: from, dateTo: yesterday, spendingTypes: ["all"], grouping: "day" };
    return (
      Object.keys(body).length === Object.keys(expected).length &&
      Object.entries(expected).every(([k, v]) => JSON.stringify(body[k]) === JSON.stringify(v))
    );
  }
  if (p.endsWith("/items") && body.grouping === "day") {
    const from = new Date(Date.now() + 3 * 3600000 - 14 * 86400000).toISOString().slice(0, 10);
    const expected = {
      dateFrom: from,
      dateTo: yesterday,
      metrics: ["impressions", "views", "contacts", "allSpending"],
      grouping: "day",
      limit: 30,
      offset: 0,
    };
    return (
      Object.keys(body).length === Object.keys(expected).length &&
      Object.entries(expected).every(([k, v]) => JSON.stringify(body[k]) === JSON.stringify(v))
    );
  }
  const expected = p.endsWith("/items")
    ? {
        dateFrom: yesterday,
        dateTo: yesterday,
        metrics: ["impressions", "views", "contacts", "allSpending"],
        grouping: "totals",
        limit: 1,
        offset: 0,
      }
    : { dateFrom: yesterday, dateTo: yesterday, spendingTypes: ["all"], grouping: "day" };
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
      return new Response(JSON.stringify({ error: "source_rate_limit" }), {
        status: 429,
        headers: {
          ...fixedHeaders,
          "content-type": "application/json",
          "x-cantor-error-origin": "source_limiter",
          "retry-after": "60",
        },
      });
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
      const auth = await (env.testFetch || fetch)("https://api.avito.ru/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: account.clientId,
          client_secret: account.clientSecret,
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      if (!auth.ok) {
        await auth.body?.cancel();
        return deny(`official_auth_http_${auth.status}`, 503);
      }
      const token = await auth.json();
      if (typeof token.access_token !== "string") return deny("official_auth_unavailable", 503);
      const response = await (env.testFetch || fetch)(request.url, {
        method: request.method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token.access_token}`,
          "x-source": "cantor-dashboard",
        },
        body: request.method === "POST" ? await request.text() : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return new Response(JSON.stringify({ error: `avito_http_${response.status}` }), {
          status: response.status,
          headers: {
            ...fixedHeaders,
            "content-type": "application/json",
            "x-cantor-error-origin": "avito",
            ...(response.headers.get("retry-after")
              ? { "retry-after": response.headers.get("retry-after") }
              : {}),
          },
        });
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

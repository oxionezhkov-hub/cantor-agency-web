import { passwordAuthorized, sessionAuthorized } from "./demo-session.mjs";
import { readDobrynina } from "./dobrynina-source.mjs";
const USER = "388298238",
  ACCOUNT = "6c974a5d5326",
  WORKSPACE = "elena-dobrynina";
const TTL = { ads: 120, chats: 20, autoload: 120, metrics: 300 };
const privateHeaders = {
  "cache-control": "no-store, private",
  vary: "Cookie, x-demo-password",
  "x-content-type-options": "nosniff",
};
const json = (data, status = 200) => Response.json(data, { status, headers: privateHeaders });
const text = (v, max = 10000) => (typeof v === "string" ? v.slice(0, max) : "");
const stamp = (v) => {
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : 0;
};
const numeric = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
async function read(env, path, body) {
  const response = await env.LIVE_READ_SOURCE.fetch(
    new Request("https://api.avito.ru" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-cantor-audit-gate": env.LIVE_READ_GATE,
        "x-cantor-account": ACCOUNT,
        "x-cantor-workspace": WORKSPACE,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    }),
  );
  if (
    response.headers.get("x-cantor-account") !== ACCOUNT ||
    response.headers.get("x-cantor-workspace") !== WORKSPACE
  )
    throw { code: "connection_mismatch", origin: "binding" };
  if (!response.ok) {
    await response.body?.cancel();
    throw {
      code: `http_${response.status}`,
      origin: response.headers.get("x-cantor-error-origin") || "source",
      retryAfter: response.headers.get("retry-after") || null,
    };
  }
  // Source already enforces 256 KiB; never pass through arbitrary response fields.
  return response.json();
}
async function pages(env, path, key, limit = 4) {
  const rows = [],
    seen = new Set(),
    started = Date.now();
  let complete = false,
    repeated = false;
  for (let page = 0; page < limit; page++) {
    if (Date.now() - started > 15000) break;
    const d = await read(env, path(page)),
      list = d[key] ?? d.result?.[key];
    if (!Array.isArray(list)) throw { code: "unexpected_shape", origin: "mapping" };
    const fp = JSON.stringify(
      list.map((x) => x.id ?? x.chat_id ?? x.upload_id ?? x.avito_id ?? x.avitoId ?? x.ad_id),
    );
    if (list.length && seen.has(fp)) {
      repeated = true;
      break;
    }
    seen.add(fp);
    rows.push(...list);
    if (list.length < 50) {
      complete = true;
      break;
    }
  }
  return { rows, coverage: { complete, repeated, truncated: !complete, limit } };
}
export function mapChat(c) {
  const last = c.last_message || {},
    users = c.users || [],
    other = users.find((u) => String(u.id) !== USER) || {},
    item = c.context?.value || {};
  return {
    id: String(c.id),
    name: text(other.name, 120) || "Собеседник",
    city: "",
    itemId: item.id ? String(item.id) : undefined,
    itemTitle: text(item.title, 250),
    lastMessageId: last.id ? String(last.id) : undefined,
    lastAt: stamp(last.created || c.updated || c.created),
    lastText: text(last.content?.text || last.content?.call?.status || "", 1000),
    lastAuthor:
      String(last.author_id) === USER ? "manager" : last.type === "system" ? "system" : "client",
    messages: [],
    unreadCount: typeof c.unread_count === "number" ? c.unread_count : undefined,
  };
}
export function mapMessage(m) {
  return {
    id: String(m.id),
    at: stamp(m.created),
    author: m.type === "system" ? "system" : String(m.author_id) === USER ? "manager" : "client",
    type: text(m.type, 30) || "text",
    text: text(m.content?.text || m.content?.call?.status || "", 10000),
  };
}
export async function collect(env, section, offset = 0) {
  if (section === "ads") {
    const p = await pages(
      env,
      (n) => `/core/v1/items?per_page=50&page=${n + 1}&status=active,old,removed,blocked,rejected`,
      "resources",
      6,
    );
    return {
      ads: p.rows
        .filter((a) => a.id != null)
        .map((a) => ({
          id: String(a.id),
          title: text(a.title, 250),
          status: text(a.status, 50) || "unknown",
          price: numeric(a.price),
          url: /^https:\/\/(www\.)?avito\.ru\//.test(a.url || "") ? a.url : "",
          city: text(a.address?.city || a.city, 120),
          description: null,
        })),
      coverage: p.coverage,
    };
  }
  if (section === "chats") {
    const p = await pages(
      env,
      (n) => `/messenger/v2/accounts/${USER}/chats?limit=50&offset=${offset + n * 50}`,
      "chats",
      offset ? 1 : 2,
    );
    return {
      chats: p.rows
        .filter((c) => c.id)
        .map(mapChat)
        .filter((c) => c.lastAt),
      coverage: {
        ...p.coverage,
        nextOffset:
          !p.coverage.complete && offset + p.rows.length <= 950 ? offset + p.rows.length : null,
      },
    };
  }
  if (section === "autoload") {
    const report = await read(env, "/autoload/v4/uploads/current");
    const p = await pages(
      env,
      (n) => `/autoload/v4/uploads/current/items?perPage=50&page=${n + 1}`,
      "items",
    );
    const rows = p.rows.map((a) => ({
      id: String(a.avito_id ?? a.avitoId ?? a.avitoIdStr ?? a.avito_item_id ?? ""),
      autoloadId: String(a.ad_id ?? a.adId ?? a.id ?? ""),
      status: text(a.avito_status, 100),
      section: text(a.section?.title, 120),
      errors: (Array.isArray(a.messages) ? a.messages.filter((m) => m.type === "error") : [])
        .map((e) => text(typeof e === "string" ? e : e.message || e.description, 1500))
        .filter(Boolean),
    }));
    return {
      rows,
      report: { status: text(report.status, 80), finishedAt: text(report.started_at, 100) },
      coverage: p.coverage,
    };
  }
  if (section === "metrics") {
    const errors = [];
    const result = { wallet: null, advance: null, days: [], coverage: { complete: false } };
    try {
      const w = await read(env, `/core/v1/accounts/${USER}/balance/`);
      result.wallet = {
        realRub: numeric(w.real),
        bonusRub: numeric(w.bonus),
        unit: "RUB",
        source: "core_balance",
        observedAt: new Date().toISOString(),
      };
    } catch (e) {
      errors.push({ part: "wallet", ...e });
    }
    try {
      const a = await read(env, "/cpa/v3/balanceInfo", {});
      result.advance = {
        rub: numeric(a.balance) === null ? null : a.balance / 100,
        unit: "RUB",
        rawUnit: "kopecks",
        source: "cpa_v3_balance",
        observedAt: new Date().toISOString(),
      };
    } catch (e) {
      errors.push({ part: "advance", ...e });
    }
    const to = new Date(Date.now() + 3 * 3600000 - 86400000).toISOString().slice(0, 10),
      from = new Date(Date.now() + 3 * 3600000 - 14 * 86400000).toISOString().slice(0, 10);
    try {
      const d = await read(env, `/stats/v2/accounts/${USER}/items`, {
        dateFrom: from,
        dateTo: to,
        metrics: ["impressions", "views", "contacts", "allSpending"],
        grouping: "day",
        limit: 30,
        offset: 0,
      });
      if (!Array.isArray(d.result?.groupings))
        throw { code: "unexpected_shape", origin: "mapping" };
      result.days = d.result.groupings
        .map((g) => {
          const m = Object.fromEntries((g.metrics || []).map((v) => [v.slug, numeric(v.value)]));
          return {
            date: new Date(stamp(g.id)).toISOString().slice(0, 10),
            shows: m.impressions ?? null,
            views: m.views ?? null,
            contacts: m.contacts ?? null,
            spendRub: m.allSpending == null ? null : m.allSpending / 100,
          };
        })
        .filter((r) => r.date >= from && r.date <= to);
      result.coverage = {
        complete: result.days.length === 14,
        from,
        to,
        timeZone: "Europe/Moscow",
        source: "stats_v2_allSpending",
        eligibleBalance: "unverified",
      };
    } catch (e) {
      errors.push({ part: "spend", ...e });
    }
    try {
      const d = await read(env, `/stats/v2/accounts/${USER}/spendings`, {
        dateFrom: from,
        dateTo: to,
        spendingTypes: ["all"],
        grouping: "day",
      });
      if (!Array.isArray(d.result?.groupings))
        throw { code: "unexpected_shape", origin: "mapping" };
      result.expenses = d.result.groupings.map((g) => ({
        date: text(g.date, 10),
        spendings: (g.spendings || [])
          .filter((v) => ["all", "promotion", "presence", "commission", "rest"].includes(v.slug))
          .map((v) => ({ type: v.slug, rub: numeric(v.value) })),
      }));
      result.expenseUnit = "RUB_response_schema";
    } catch (e) {
      errors.push({ part: "expenseBreakdown", ...e });
    }
    return { ...result, errors };
  }
  throw { code: "unknown_section", origin: "request" };
}
export async function liveRead(request, env) {
  if (request.method !== "GET") return json({ error: "read_only" }, 405);
  if (
    !(await passwordAuthorized(request, env.DEMO_PASSWORD_SHA256)) &&
    !(await sessionAuthorized(request, env.DEMO_PASSWORD_SHA256))
  )
    return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url),
    section = url.searchParams.get("section"),
    chatId = url.searchParams.get("id");
  if (
    [...url.searchParams.keys()].some((k) => !["section", "id", "offset"].includes(k)) ||
    [...new Set(url.searchParams.keys())].some((k) => url.searchParams.getAll(k).length > 1)
  )
    return json({ error: "invalid_query" }, 400);
  if (section === "messages")
    return messages(request, env, chatId, url.searchParams.get("offset") || "0");
  const offset = Number(url.searchParams.get("offset") || "0");
  if (
    !Object.hasOwn(TTL, section) ||
    chatId ||
    (url.searchParams.has("offset") &&
      (section !== "chats" ||
        !/^\d{1,3}$/.test(url.searchParams.get("offset")) ||
        offset > 950 ||
        offset % 50))
  )
    return json({ error: "invalid_query" }, 400);
  const key = `live:v2:${section}${offset ? `:${offset}` : ""}`,
    cached = await env.DEMO_DATA?.get(key, "json");
  if (cached && Date.now() - Date.parse(cached.observedAt) < TTL[section] * 1000)
    return json({ ...cached, cached: true });
  if (env.LIVE_READ_ENABLED !== "direct-v1" || !env.LIVE_READ_SOURCE || !env.LIVE_READ_GATE)
    return json({ error: "not_configured", lastGood: cached || null }, 503);
  if (!env.LIVE_READ_LIMIT?.limit || !(await env.LIVE_READ_LIMIT.limit({ key: WORKSPACE })).success)
    return json({ error: "rate_limit", origin: "preview_limiter", lastGood: cached || null }, 429);
  try {
    const data = await collect(env, section, offset);
    if (section === "metrics" && cached?.data) {
      for (const field of ["wallet", "advance"])
        if (data[field] === null && cached.data[field])
          data[field] = { ...cached.data[field], stale: true };
    }
    const value = { section, observedAt: new Date().toISOString(), data };
    if (JSON.stringify(value).length > 300000)
      throw { code: "projection_budget", origin: "mapping" };
    // Only the isolated preview cache is written; no production KV write occurs.
    if (section === "chats") {
      const prior = (await env.DEMO_DATA.get("live:v2:known-chats", "json")) || [];
      await env.DEMO_DATA.put(
        "live:v2:known-chats",
        JSON.stringify([...new Set([...data.chats.map((c) => c.id), ...prior])].slice(0, 1000)),
        { expirationTtl: 86400 },
      );
    }
    await env.DEMO_DATA.put(key, JSON.stringify(value), { expirationTtl: 86400 });
    return json(value);
  } catch (e) {
    return json(
      {
        error: e.code || "source_unavailable",
        origin: e.origin || "network",
        retryAfter: e.retryAfter || null,
        lastGood: cached || null,
      },
      502,
    );
  }
}
async function messages(request, env, id, offsetText) {
  if (
    !/^[A-Za-z0-9_~\-]{1,150}$/.test(id || "") ||
    !/^\d{1,3}$/.test(offsetText) ||
    Number(offsetText) > 950 ||
    Number(offsetText) % 50
  )
    return json({ error: "invalid_query" }, 400);
  if (env.LIVE_READ_ENABLED !== "direct-v1" || !env.LIVE_READ_SOURCE || !env.LIVE_READ_GATE)
    return json({ error: "live_not_enabled" }, 503);
  const cachedChats = await env.DEMO_DATA.get("live:v2:chats", "json");
  let known = cachedChats?.data?.chats.some((c) => c.id === id);
  if (!known) known = ((await env.DEMO_DATA.get("live:v2:known-chats", "json")) || []).includes(id);
  if (!known) {
    const old = await readDobrynina(env);
    known = old.chats.some((c) => c.id === id);
  }
  if (!known) return json({ error: "chat_not_in_workspace" }, 404);
  const key = `live:v2:messages:${id}:${offsetText}`,
    cached = await env.DEMO_DATA.get(key, "json");
  if (cached && Date.now() - Date.parse(cached.observedAt) < 20000) return json(cached);
  if (!env.LIVE_READ_LIMIT?.limit || !(await env.LIVE_READ_LIMIT.limit({ key: WORKSPACE })).success)
    return json({ error: "rate_limit", origin: "preview_limiter", lastGood: cached || null }, 429);
  try {
    const d = await read(
      env,
      `/messenger/v3/accounts/${USER}/chats/${id}/messages/?limit=50&offset=${offsetText}`,
    );
    const rows = Array.isArray(d) ? d : d.messages;
    if (!Array.isArray(rows)) throw { code: "unexpected_shape" };
    const value = {
      messages: rows.map(mapMessage).filter((m) => m.at),
      observedAt: new Date().toISOString(),
      coverage: {
        complete: rows.length < 50,
        nextOffset: rows.length === 50 && Number(offsetText) < 950 ? Number(offsetText) + 50 : null,
        truncated: rows.length === 50 && Number(offsetText) === 950,
      },
    };
    await env.DEMO_DATA.put(key, JSON.stringify(value), { expirationTtl: 86400 });
    return json(value);
  } catch (e) {
    let fallback = cached || null;
    if (!fallback) {
      const old = await readDobrynina(env, id).catch(() => null);
      if (old)
        fallback = {
          messages: old.messages || [],
          observedAt: new Date(old.syncedAt || 0).toISOString(),
          coverage: { complete: false, nextOffset: null, truncated: true },
          historical: true,
        };
    }
    return json(
      { error: e.code || "source_unavailable", origin: e.origin || "network", lastGood: fallback },
      502,
    );
  }
}

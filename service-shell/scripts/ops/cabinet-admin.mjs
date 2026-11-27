import { auditFilters, parseClientAudit } from "./cabinet-audit.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (value) => Uint8Array.from(value.match(/../g), (byte) => parseInt(byte, 16));
export const random = (length = 32) => hex(crypto.getRandomValues(new Uint8Array(length)));
export const digest = async (value) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
export const accountId = (value) => /^[a-f0-9]{12}$/.test(value || "");
export const employeeLogin = (value) => /^[a-z0-9][a-z0-9_.@-]{2,79}$/.test(value || "");
export const publicHeaders = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
};
export const result = (body, status = 200, extra = {}) =>
  Response.json(body, { status, headers: { ...publicHeaders, ...extra } });
export const fail = (error, status = 400, extra = {}) => result({ error }, status, extra);
export function equal(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function ownerSignature(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
const cookieValue = (request, name) =>
  request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || "";
const cabinet = (env, id) => env.CABINET_ADMIN.getByName(`cabinet:${id}`);
const directory = (env) => env.CABINET_ADMIN.getByName("directory");
const sessionParts = (request) =>
  cookieValue(request, "cantor_test_session").match(/^([a-f0-9]{12})\.([a-f0-9]{64})$/);
export function hasCabinetSession(request) {
  return Boolean(sessionParts(request));
}
async function ownerAuthorized(request, env) {
  if (!env.CABINET_OWNER_PASSWORD_SHA256 || !env.CABINET_SESSION_SECRET) return false;
  const parts = cookieValue(request, "cantor_owner_session").match(/^(\d{10})\.([a-f0-9]{64})$/);
  const now = Math.floor(Date.now() / 1000);
  return Boolean(
    parts &&
    Number(parts[1]) >= now &&
    Number(parts[1]) <= now + 43200 &&
    equal(parts[2], await ownerSignature(parts[1], env.CABINET_SESSION_SECRET)),
  );
}
async function testerIdentity(request, env) {
  const parts = sessionParts(request);
  if (!parts || !env.CABINET_ADMIN) return null;
  return cabinet(env, parts[1]).identify(await digest(parts[2]));
}
export async function cabinetIdentity(request, env) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/admin/"))
    return (await ownerAuthorized(request, env)) ? { role: "owner" } : null;
  const parts = sessionParts(request);
  if (!parts || !env.CABINET_ADMIN) return null;
  const sessionId = await digest(parts[2]);
  const identity = await cabinet(env, parts[1]).identify(sessionId);
  return identity ? { ...identity, sessionId } : null;
}
async function readBody(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let body = "";
  let size = 0;
  const stream = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        body += stream.decode();
        break;
      }
      size += chunk.value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return null;
      }
      body += stream.decode(chunk.value, { stream: true });
    }
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
}
function requestAllowed(request, url) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    (!origin || origin === url.origin) &&
    (!fetchSite || fetchSite === "same-origin" || fetchSite === "none")
  );
}
async function limited(env, scope, request) {
  if (!env.CABINET_LOGIN_LIMIT) return env.CABINET_SOURCE_MODE !== "synthetic";
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  return !(await env.CABINET_LOGIN_LIMIT.limit({ key: `${scope}:${ip}` })).success;
}
const privateAccount = (data) =>
  data && accountId(data.id) && /^\d{1,20}$/.test(String(data.userId))
    ? {
        id: data.id,
        userId: String(data.userId),
        name: String(data.name || data.id).slice(0, 120),
        source: "legacy",
        configured: Boolean(data.clientId && data.clientSecret),
      }
    : null;
async function existingAccount(env, id) {
  if (!env.CABINET_LEGACY_ACCOUNTS)
    return syntheticAccounts(env).find((account) => account.id === id) || null;
  return privateAccount(await env.CABINET_LEGACY_ACCOUNTS.get(`account:${id}`, "json"));
}
function syntheticAccounts(env) {
  if (env.CABINET_SOURCE_MODE !== "synthetic") return [];
  return [
    {
      id: "000000000101",
      userId: "101",
      name: "Тестовый кабинет Авито",
      source: "synthetic",
      configured: true,
    },
    {
      id: "000000000102",
      userId: "102",
      name: "Второй тестовый кабинет",
      source: "synthetic",
      configured: true,
    },
  ];
}
async function inventory(env, cursor) {
  const local = await directory(env).connections();
  const source =
    env.CABINET_LEGACY_ACCOUNTS &&
    (await env.CABINET_LEGACY_ACCOUNTS.list({ prefix: "account:", limit: 30, cursor }));
  const legacy = await Promise.all(
    (source?.keys || []).map(({ name }) => existingAccount(env, name.slice(8))),
  );
  const ids = new Set(local.map((account) => account.id));
  const entries = [
    ...(cursor
      ? []
      : [...local, ...syntheticAccounts(env).filter((account) => !ids.has(account.id))]),
    ...legacy.filter((account) => account && !ids.has(account.id)),
  ];
  const accounts = [];
  for (let i = 0; i < entries.length; i += 8) {
    accounts.push(
      ...(await Promise.all(
        entries.slice(i, i + 8).map(async (entry) => ({
          ...entry,
          cabinet: await cabinet(env, entry.id).summary(),
        })),
      )),
    );
  }
  return { accounts, cursor: source && !source.list_complete ? source.cursor : null };
}
function connectionDraft(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  const clientSecret = typeof body?.clientSecret === "string" ? body.clientSecret.trim() : "";
  if (
    !name ||
    name.length > 120 ||
    !/^\d{1,20}$/.test(userId) ||
    !clientId ||
    clientId.length > 512 ||
    !clientSecret ||
    clientSecret.length > 512
  )
    return null;
  return { name, userId, clientId, clientSecret };
}
export async function protectCredentials(env, value, aad, decrypt = false) {
  const secret = env.CABINET_CONNECTION_KEY;
  if (!/^[a-f0-9]{64}$/.test(secret || "")) throw new Error("connection_key_missing");
  const key = await crypto.subtle.importKey("raw", unhex(secret), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  if (decrypt) {
    const [iv, cipher] = value.split(".");
    const data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unhex(iv), additionalData: encoder.encode(aad) },
      key,
      unhex(cipher),
    );
    return JSON.parse(decoder.decode(data));
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return `${hex(iv)}.${hex(cipher)}`;
}

export function isCabinetApi(path) {
  return (
    path.startsWith("/api/cabinet/") ||
    path === "/api/admin/session" ||
    path === "/api/admin/login" ||
    path === "/api/admin/logout" ||
    path === "/api/admin/cabinets" ||
    path.startsWith("/api/admin/cabinets/")
  );
}
export async function cabinetApi(request, env) {
  const url = new URL(request.url);
  const { pathname: path } = url;
  const method = request.method;
  if (!env.CABINET_ADMIN) return fail("cabinet_unavailable", 503);
  if (!requestAllowed(request, url)) return fail("invalid_origin", 403);
  const body = method === "POST" ? await readBody(request) : null;
  if (method === "POST" && !body) return fail("invalid_request");
  if (path === "/api/admin/login" && method === "POST") {
    if (await limited(env, "owner", request))
      return fail("rate_limited", 429, { "retry-after": "60" });
    if (
      !env.CABINET_SESSION_SECRET ||
      typeof body.password !== "string" ||
      body.password.length > 1024 ||
      !equal(await digest(body.password), env.CABINET_OWNER_PASSWORD_SHA256 || "")
    ) {
      return fail("invalid_credentials", 401);
    }
    const expires = String(Math.floor(Date.now() / 1000) + 43200);
    const mac = await ownerSignature(expires, env.CABINET_SESSION_SECRET);
    return result({ role: "owner" }, 200, {
      "set-cookie": cookie("cantor_owner_session", `${expires}.${mac}`, 43200),
    });
  }
  if (path.startsWith("/api/admin/")) {
    if (!(await ownerAuthorized(request, env))) return fail("unauthorized", 401);
    if (path === "/api/admin/session" && method === "GET") return result({ role: "owner" });
    if (path === "/api/admin/logout" && method === "POST")
      return result({ ok: true }, 200, { "set-cookie": cookie("cantor_owner_session", "", 0) });
    if (path === "/api/admin/cabinets" && method === "GET")
      return result(await inventory(env, url.searchParams.get("cursor") || undefined));
    if (path === "/api/admin/cabinets" && method === "POST") {
      const draft = connectionDraft(body);
      if (!draft) return fail("invalid_connection");
      let existing = syntheticAccounts(env).find((entry) => entry.userId === draft.userId);
      if (!existing && env.CABINET_LEGACY_ACCOUNTS) {
        for (let cursor, page = 0; page < 12; page++) {
          const list = await env.CABINET_LEGACY_ACCOUNTS.list({
            prefix: "account:",
            limit: 50,
            cursor,
          });
          const accounts = await Promise.all(
            list.keys.map(({ name }) => existingAccount(env, name.slice(8))),
          );
          existing = accounts.find((entry) => entry?.userId === draft.userId);
          if (existing || list.list_complete) break;
          if (page === 11) return fail("inventory_lookup_incomplete", 503);
          cursor = list.cursor;
        }
      }
      const id =
        existing?.id || (await digest("Cantor Avito account:" + draft.userId)).slice(0, 12);
      const { clientId, clientSecret, ...info } = draft;
      const encrypted = await protectCredentials(env, { clientId, clientSecret }, id);
      const metadata = { ...info, id, source: "configured", configured: true };
      const configured = await cabinet(env, id).configure(metadata, encrypted);
      if (!configured.ok) return asResult(configured);
      const registered = await directory(env).register(metadata);
      if (!registered.ok) return asResult(registered);
      return result({ account: { ...metadata, cabinet: await cabinet(env, id).summary() } }, 201);
    }
    const match = path.match(
      /^\/api\/admin\/cabinets\/([a-f0-9]{12})(?:\/(activate|retry|employees|reset|revoke|history))?$/,
    );
    if (!match) return fail("not_found", 404);
    const [, id, action] = match;
    const stub = cabinet(env, id);
    if (method === "GET" && action === "history") {
      const filters = auditFilters(url.searchParams);
      if (!filters) return fail("invalid_audit_filter");
      if (!(await stub.connection(id)) && !(await existingAccount(env, id)))
        return fail("not_found", 404);
      return result({ workspaceId: id, ...(await stub.auditHistory(filters)) });
    }
    if (method === "GET" && !action) return result(await stub.details());
    if (method !== "POST") return fail("method_not_allowed", 405);
    if (action === "activate") {
      const metadata = (await directory(env).connection(id)) || (await existingAccount(env, id));
      if (!metadata?.configured) return fail("connection_unavailable", 404);
      const activated = await stub.activate(metadata);
      return asResult(activated);
    }
    if (action === "retry") return asResult(await stub.retry());
    if (action === "employees") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
      if (!name || name.length > 120 || !employeeLogin(login)) return fail("invalid_employee");
      return asResult(await stub.createEmployee(name, login));
    }
    if (action === "reset" || action === "revoke")
      return asResult(await stub.changeEmployee(body.employeeId, action));
    return fail("method_not_allowed", 405);
  }
  if (path === "/api/cabinet/login" && method === "POST") {
    if (await limited(env, "employee", request))
      return fail("rate_limited", 429, { "retry-after": "60" });
    const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
    if (
      !accountId(body.workspaceId) ||
      !employeeLogin(login) ||
      typeof body.password !== "string" ||
      body.password.length > 256
    ) {
      return fail("invalid_credentials", 401);
    }
    const data = await cabinet(env, body.workspaceId).login(login, body.password);
    if (!data) return fail("invalid_credentials", 401);
    return result(data.identity, 200, {
      "set-cookie": cookie("cantor_test_session", `${body.workspaceId}.${data.token}`, 43200),
    });
  }
  const parts = sessionParts(request);
  if (!parts) return fail("unauthorized", 401);
  const stub = cabinet(env, parts[1]);
  const token = await digest(parts[2]);
  if (path === "/api/cabinet/audit" && method === "POST") {
    if (request.headers.get("origin") !== url.origin) return fail("invalid_origin", 403);
    const events = parseClientAudit(body);
    if (!events) return fail("invalid_audit_events");
    return asResult(await stub.ingestAudit(token, body.workspaceId, body.employeeId, events));
  }
  if (path === "/api/cabinet/logout" && method === "POST") {
    await stub.logout(token);
    return result({ ok: true }, 200, { "set-cookie": cookie("cantor_test_session", "", 0) });
  }
  if (path === "/api/cabinet/session" && method === "GET") {
    const identity = await stub.identify(token);
    return identity ? result(identity) : fail("unauthorized", 401);
  }
  if (path === "/api/cabinet/password" && method === "POST") {
    if (
      typeof body.password !== "string" ||
      body.password.trim().length < 12 ||
      body.password.length > 256
    )
      return fail("invalid_password");
    const data = await stub.changePassword(token, body.password);
    if (!data) return fail("invalid_password_or_session", 403);
    return result(data.identity, 200, {
      "set-cookie": cookie("cantor_test_session", `${parts[1]}.${data.token}`, 43200),
    });
  }
  if (path === "/api/cabinet/bootstrap" && method === "GET")
    return asResult(await stub.bootstrap(token));
  if (path === "/api/cabinet/chat" && method === "GET")
    return asResult(await stub.chat(token, url.searchParams.get("id")));
  return fail("not_found", 404);
}
function asResult(data) {
  return data.error ? fail(data.error, data.status || 400) : result(data);
}

const SECTIONS = ["today", "stats", "ads", "chats", "learn", "acc"];
const STATES = ["new", "in_progress", "fixed"];
const DIAGNOSTICS = ["runtime_error", "request_failed", "resource_error"];
const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ANCHOR = /^[a-zA-Z0-9_-]{1,100}$/;
const PATH =
  /^[a-z][a-z0-9-]*:nth-child\([1-9][0-9]{0,5}\)(?: > [a-z][a-z0-9-]*:nth-child\([1-9][0-9]{0,5}\))*$/;
const AUDIO_LIMIT = 1024 * 1024;
const SCREENSHOT_LIMIT = 400 * 1024;
const encoder = new TextEncoder();
const headers = {
  "cache-control": "no-store, private",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
};
const projection = `id, workspace_id, section, author, created_at, target, text, diagnostics, status,
  audio IS NOT NULL AS has_audio, screenshot IS NOT NULL AS has_screenshot,
  transcript, transcription_status`;

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: { ...headers, ...extra } });
}
async function readBody(request, maximum) {
  if (Number(request.headers.get("content-length")) > maximum) {
    throw new HttpError(413, "too_large");
  }
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          throw new HttpError(413, "too_large");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader?.releaseLock();
  }
  return new Response(new Blob(chunks), {
    headers: { "content-type": request.headers.get("content-type") || "application/octet-stream" },
  });
}
async function readJson(request) {
  const body = await readBody(request, 4096);
  return body.json().catch(() => {
    throw new HttpError(400, "invalid_request");
  });
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}
const hex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function signature(secret, identity, expires) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        JSON.stringify([
          "workspace-commenter-v1",
          identity.workspaceId,
          identity.employeeId,
          identity.sessionId ?? "",
          expires,
        ]),
      ),
    ),
  );
}
function grantCookie(token, maxAge) {
  return `cantor_commenter=${token}; Path=/api/cabinet/comments; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
async function enabled(request, secret, identity) {
  const token = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)cantor_commenter=(\d{10})\.([0-9a-f]{64})(?:;|$)/);
  const now = Math.floor(Date.now() / 1000);
  return Boolean(
    token &&
    Number(token[1]) >= now &&
    Number(token[1]) <= now + 28800 &&
    constantTimeEqual(token[2], await signature(secret, identity, Number(token[1]))),
  );
}
async function unlock(request, db, identity, secret) {
  const { password } = (await readJson(request)) ?? {};
  if (typeof password !== "string" || !password || password.length > 256) {
    throw new HttpError(400, "invalid_request");
  }
  const window = Math.floor(Date.now() / (15 * 60_000));
  const result = await db
    .prepare(
      `INSERT INTO commenter_unlock_attempts (workspace_id, employee_id, time_window, attempts)
    VALUES (?, ?, ?, 1) ON CONFLICT(workspace_id, employee_id) DO UPDATE
    SET attempts = CASE WHEN time_window = excluded.time_window THEN attempts + 1 ELSE 1 END,
      time_window = excluded.time_window RETURNING attempts`,
    )
    .bind(identity.workspaceId, identity.employeeId, window)
    .first();
  if (result.attempts > 12) throw new HttpError(429, "too_many_attempts");
  if (
    !constantTimeEqual(hex(await crypto.subtle.digest("SHA-256", encoder.encode(password))), secret)
  ) {
    throw new HttpError(403, "invalid_password");
  }
  const expires = Math.floor(Date.now() / 1000) + 28800;
  return json({ ok: true, enabled: true }, 200, {
    "set-cookie": grantCookie(`${expires}.${await signature(secret, identity, expires)}`, 28800),
  });
}
function serialize(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    section: row.section,
    author: row.author,
    createdAt: row.created_at,
    target: JSON.parse(row.target),
    text: row.text,
    diagnostics: JSON.parse(row.diagnostics),
    status: row.status,
    hasAudio: Boolean(row.has_audio),
    hasScreenshot: Boolean(row.has_screenshot),
    transcript: row.transcript,
    transcriptionStatus: row.transcription_status,
  };
}
function targetFrom(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.path !== "string" ||
    raw.path.length > 360 ||
    (raw.path !== "" && !PATH.test(raw.path)) ||
    (raw.anchor != null && (typeof raw.anchor !== "string" || !ANCHOR.test(raw.anchor))) ||
    ![raw.x, raw.y].every(
      (coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1,
    )
  ) {
    throw new HttpError(400, "invalid_target");
  }
  const target = { anchor: raw.anchor || null, path: raw.path, x: raw.x, y: raw.y };
  if (typeof raw.focus === "string" && /^[a-zA-Z0-9_~-]{1,100}$/.test(raw.focus))
    target.focus = raw.focus;
  if (raw.view === "crm" || raw.view === "ai") target.view = raw.view;
  return target;
}
function diagnosticsFrom(raw, now) {
  return Array.isArray(raw)
    ? raw
        .filter(
          (item) =>
            item &&
            DIAGNOSTICS.includes(item.kind) &&
            Number.isInteger(item.at) &&
            item.at <= now + 5000 &&
            item.at >= now - 120_000,
        )
        .slice(-8)
        .map(({ kind, at }) => ({ kind, at }))
    : [];
}
async function attachment(file, max, types) {
  if (file == null) return null;
  if (!(file instanceof Blob) || !file.size || file.size > max)
    throw new HttpError(413, "attachment_size");
  const type = file.type.split(";")[0];
  if (!types.includes(type)) throw new HttpError(400, "attachment_type");
  const bytes = await file.arrayBuffer();
  if (type === "image/jpeg") {
    const prefix = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
    if (prefix.length !== 3 || prefix[0] !== 255 || prefix[1] !== 216 || prefix[2] !== 255) {
      throw new HttpError(400, "attachment_type");
    }
  }
  return { type, bytes };
}
async function create(request, db, identity, screenshotsAllowed) {
  const body = await readBody(request, AUDIO_LIMIT + SCREENSHOT_LIMIT + 32_768);
  const form = await body.formData().catch(() => {
    throw new HttpError(400, "invalid_request");
  });
  const raw = JSON.parse(String(form.get("comment") ?? "null"));
  if (
    !raw ||
    typeof raw.id !== "string" ||
    !ID.test(raw.id) ||
    !SECTIONS.includes(raw.section) ||
    typeof raw.text !== "string" ||
    raw.text.length > 4000
  )
    throw new HttpError(400, "invalid_request");
  const target = targetFrom(raw.target);
  const now = Date.now();
  const text = raw.text.trim();
  const audio = await attachment(form.get("audio"), AUDIO_LIMIT, AUDIO_TYPES);
  // Settings and conversations can contain information that belongs outside the review queue.
  const screenshot =
    !screenshotsAllowed || ["acc", "chats"].includes(raw.section)
      ? null
      : await attachment(form.get("screenshot"), SCREENSHOT_LIMIT, ["image/jpeg"]);
  if (!text && !audio) throw new HttpError(400, "empty_comment");
  await db
    .prepare(
      `INSERT INTO workspace_comments
    (id, workspace_id, section, employee_id, author, created_at, target, text, diagnostics,
     audio, audio_type, screenshot, transcription_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      raw.id,
      identity.workspaceId,
      raw.section,
      identity.employeeId,
      identity.name,
      new Date(now).toISOString(),
      JSON.stringify(target),
      text,
      JSON.stringify(diagnosticsFrom(raw.diagnostics, now)),
      audio?.bytes ?? null,
      audio?.type ?? null,
      screenshot?.bytes ?? null,
      audio ? "pending" : null,
    )
    .run();
  const saved = await db
    .prepare(
      `SELECT ${projection} FROM workspace_comments WHERE id = ? AND workspace_id = ? AND employee_id = ?`,
    )
    .bind(raw.id, identity.workspaceId, identity.employeeId)
    .first();
  if (!saved) throw new HttpError(409, "comment_conflict");
  return json({ ok: true, comment: serialize(saved) }, 201);
}
async function list(db, url, identity) {
  const filter = [];
  const args = [];
  const workspace = identity?.workspaceId ?? url.searchParams.get("workspace");
  const section = url.searchParams.get("section");
  const status = identity ? null : url.searchParams.get("status");
  const before = url.searchParams.get("before");
  if (workspace && workspace.length > 150) throw new HttpError(400, "invalid_workspace");
  if (section && !SECTIONS.includes(section)) throw new HttpError(400, "invalid_section");
  if (status && !STATES.includes(status)) throw new HttpError(400, "invalid_status");
  if (before && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.[0-9a-f-]{36}$/.test(before)) {
    throw new HttpError(400, "invalid_cursor");
  }
  if (workspace) {
    filter.push("workspace_id = ?");
    args.push(workspace);
  }
  if (section) {
    filter.push("section = ?");
    args.push(section);
  }
  if (status) {
    filter.push("status = ?");
    args.push(status);
  }
  if (before) {
    filter.push("(created_at, id) < (?, ?)");
    args.push(before.slice(0, 24), before.slice(25));
  }
  const where = filter.length ? `WHERE ${filter.join(" AND ")}` : "";
  const { results } = await db
    .prepare(
      `SELECT ${projection} FROM workspace_comments ${where} ORDER BY created_at DESC, id DESC LIMIT 101`,
    )
    .bind(...args)
    .all();
  const last = results[99];
  const next = results.length > 100 ? `${last.created_at}.${last.id}` : null;
  return json({ ok: true, comments: results.slice(0, 100).map(serialize), next });
}
async function media(db, id, type, workspace) {
  const column = type === "audio" ? "audio" : "screenshot";
  const row = await db
    .prepare(
      `SELECT ${column} AS bytes, audio_type FROM workspace_comments WHERE id = ?
    AND (? IS NULL OR workspace_id = ?)`,
    )
    .bind(id, workspace, workspace)
    .first();
  if (!row?.bytes) throw new HttpError(404, "not_found");
  return new Response(new Uint8Array(row.bytes), {
    headers: { ...headers, "content-type": type === "audio" ? row.audio_type : "image/jpeg" },
  });
}
async function transcribe(db, ai, id) {
  if (!ai) throw new HttpError(503, "transcription_unavailable");
  const attempt = crypto.randomUUID();
  const now = Date.now();
  const claimed = await db
    .prepare(
      `UPDATE workspace_comments SET transcription_status = 'processing',
    transcription_attempt = ?, transcription_started_at = ? WHERE id = ? AND audio IS NOT NULL
    AND (transcription_status IN ('pending', 'failed') OR
    (transcription_status = 'processing' AND transcription_started_at < ?))
    RETURNING audio`,
    )
    .bind(attempt, now, id, now - 300_000)
    .first();
  if (!claimed) throw new HttpError(409, "transcription_unavailable");
  let text;
  try {
    const result = await ai.run("@cf/openai/whisper", {
      audio: Array.from(new Uint8Array(claimed.audio)),
    });
    text = typeof result?.text === "string" ? result.text.trim().slice(0, 16_000) : "";
    if (!text) throw new Error("Empty transcript");
  } catch {
    await db
      .prepare(
        `UPDATE workspace_comments SET transcription_status = 'failed'
      WHERE id = ? AND transcription_attempt = ?`,
      )
      .bind(id, attempt)
      .run();
    throw new HttpError(502, "transcription_failed");
  }
  await db
    .prepare(
      `UPDATE workspace_comments SET transcription_status = 'complete', transcript = ?
    WHERE id = ? AND transcription_attempt = ?`,
    )
    .bind(text, id, attempt)
    .run();
  return json({ ok: true, transcript: text });
}
export function isCommentRoute(path) {
  return /^\/api\/(?:admin|cabinet)\/comments(?:\/|$)/.test(path);
}
export async function workspaceComments(request, env, resolveIdentity) {
  const url = new URL(request.url);
  const { pathname } = url;
  const admin = pathname.startsWith("/api/admin/");
  const root = admin ? "/api/admin/comments" : "/api/cabinet/comments";
  const route = pathname.slice(root.length);
  const method = request.method;
  const db = env.TEST_COMMENTS_DB;
  const secret = env.COMMENTER_PASSWORD_SHA256;
  const screenshotsAllowed = env.CABINET_SOURCE_MODE === "synthetic";
  try {
    const identity = await resolveIdentity(request, env);
    if (
      !identity ||
      identity.role !== (admin ? "owner" : "tester") ||
      identity.mustChangePassword
    ) {
      throw new HttpError(401, "unauthorized");
    }
    if (method !== "GET" && request.headers.get("origin") !== url.origin) {
      throw new HttpError(403, "invalid_origin");
    }
    if (!admin && route === "/mode" && method === "GET") {
      const available = Boolean(db && /^[0-9a-f]{64}$/.test(secret ?? ""));
      return json({
        ok: true,
        available,
        enabled: available && (await enabled(request, secret, identity)),
        screenshotsAllowed,
      });
    }
    if (!db || (!admin && !/^[0-9a-f]{64}$/.test(secret ?? "")))
      throw new HttpError(503, "unavailable");
    if (!admin && route === "/mode") {
      if (method === "POST") return await unlock(request, db, identity, secret);
      if (method === "DELETE")
        return json({ ok: true, enabled: false }, 200, { "set-cookie": grantCookie("", 0) });
    }
    if (!admin && !(await enabled(request, secret, identity)))
      throw new HttpError(403, "mode_disabled");
    if (!route && method === "GET") return await list(db, url, admin ? null : identity);
    if (!route && method === "POST" && !admin)
      return await create(request, db, identity, screenshotsAllowed);
    const [, id, action, extra] = route.split("/");
    if (!ID.test(id ?? "") || extra !== undefined) throw new HttpError(404, "not_found");
    if (method === "GET" && (action === "audio" || action === "screenshot")) {
      return await media(db, id, action, admin ? null : identity.workspaceId);
    }
    if (admin && method === "PATCH" && action === undefined) {
      const { status } = (await readJson(request)) ?? {};
      if (!STATES.includes(status)) throw new HttpError(400, "invalid_status");
      const updated = await db
        .prepare("UPDATE workspace_comments SET status = ? WHERE id = ? RETURNING id")
        .bind(status, id)
        .first();
      if (!updated) throw new HttpError(404, "not_found");
      return json({ ok: true });
    }
    if (admin && action === "transcribe" && method === "POST")
      return await transcribe(db, env.AI, id);
    throw new HttpError(404, "not_found");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: "invalid_request" }, 400);
    return json({ error: "unavailable" }, 503);
  }
}

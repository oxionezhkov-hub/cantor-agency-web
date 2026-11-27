export const auditSections = ["today", "stats", "ads", "chats", "learn", "acc"];
const clientActions = {
  click: [
    "mobile-menu",
    "cabinet-profile",
    "workspace-nav",
    "workspace-subnav",
    "open-ad",
    "open-dialog",
    "commenter-menu",
  ],
  navigate: ["workspace-section"],
  attempt: ["create-comment", "campaign-generate", "save-ad", "send-reply"],
};
const serverActions = [
  "configure",
  "activate",
  "retry",
  "employee-create",
  "employee-reset",
  "employee-revoke",
  "password-change",
  "logout",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const actorId = /^(?:owner|[a-f0-9]{24})$/;
const objectId = /^[a-f0-9]{12}(?:[a-f0-9]{12})?$/;
const day = 86_400_000;
const pageSize = 50;
export const auditSchema = `
  CREATE TABLE IF NOT EXISTS cabinet_audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    section TEXT NOT NULL,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,
    source TEXT NOT NULL,
    object TEXT,
    changes TEXT,
    UNIQUE(source, actor, event_id)
  );
  CREATE INDEX IF NOT EXISTS cabinet_audit_source ON cabinet_audit(source, seq);
  CREATE INDEX IF NOT EXISTS cabinet_audit_actor ON cabinet_audit(source, actor, at);
`;

export function parseClientAudit(body) {
  if (!Array.isArray(body?.events) || !body.events.length || body.events.length > 20) return null;
  const events = [];
  for (const raw of body.events) {
    if (!raw || typeof raw !== "object") return null;
    const { id, section, action, outcome, target } = raw;
    if (typeof id !== "string" || !uuid.test(id) || !auditSections.includes(section)) return null;
    if (
      typeof outcome !== "string" ||
      !Object.hasOwn(clientActions, outcome) ||
      !clientActions[outcome].includes(action)
    )
      return null;
    const navigationTarget = action === "workspace-nav" || action === "workspace-section";
    if (navigationTarget && !auditSections.includes(target)) return null;
    if (
      !navigationTarget &&
      target !== undefined &&
      (!["open-ad", "open-dialog"].includes(action) ||
        typeof target !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(target))
    )
      return null;
    events.push({ id, section, action, outcome, object: target ?? action });
  }
  return events;
}

function trim(sql, source, count, now) {
  sql.exec(
    `DELETE FROM cabinet_audit WHERE source=? AND (at<? OR seq <= COALESCE(
       (SELECT seq FROM cabinet_audit WHERE source=? ORDER BY seq DESC LIMIT 1 OFFSET ?),0))`,
    source,
    now - 90 * day,
    source,
    count,
  );
}

export function saveClientAudit(sql, actor, events, now = Date.now()) {
  const { count } = sql
    .exec(
      "SELECT COUNT(*) AS count FROM cabinet_audit WHERE source='client' AND actor=? AND at>=?",
      actor,
      now - 60_000,
    )
    .one();
  if (count + events.length > 180) return false;
  for (const { id, section, action, outcome, object } of events)
    sql.exec(
      `INSERT OR IGNORE INTO cabinet_audit(event_id,at,actor,section,action,outcome,source,object)
       VALUES (?,?,?,?,?,?,'client',?)`,
      id,
      now,
      actor,
      section,
      action,
      outcome,
      object,
    );
  trim(sql, "client", 8000, now);
  return true;
}

const changesAllowed = {
  configured: [true, false, null],
  access: ["temporary", "active", "revoked", null],
  importStatus: ["queued", "failed", null],
  signedIn: [true, false],
};
export function saveServerAudit(
  sql,
  { actor = "owner", action, outcome, object, changes },
  now = Date.now(),
) {
  if (
    !actorId.test(actor) ||
    !serverActions.includes(action) ||
    !["changed", "failed"].includes(outcome)
  )
    throw new Error("invalid_audit_record");
  const safeChanges = {};
  for (const [field, pair] of Object.entries(changes ?? {})) {
    if (
      Object.hasOwn(changesAllowed, field) &&
      Array.isArray(pair) &&
      pair.length === 2 &&
      pair.every((value) => changesAllowed[field].includes(value)) &&
      pair[0] !== pair[1]
    ) {
      safeChanges[field] = pair;
    }
  }
  sql.exec(
    `INSERT INTO cabinet_audit(event_id,at,actor,section,action,outcome,source,object,changes)
     VALUES (?,?,?,'acc',?,?,'server',?,?)`,
    crypto.randomUUID(),
    now,
    actor,
    action,
    outcome,
    typeof object === "string" && objectId.test(object) ? object : null,
    Object.keys(safeChanges).length ? JSON.stringify(safeChanges) : null,
  );
  trim(sql, "server", 4000, now);
}

function date(value) {
  if (value === "") return null;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : NaN;
}
export function auditFilters(params) {
  const get = (key) => params.get(key) ?? "";
  const actor = get("actor");
  const section = get("section");
  const action = get("action");
  const search = get("q").trim();
  const from = date(get("from"));
  const to = date(get("to"));
  const before = get("before");
  if (
    (actor && !actorId.test(actor)) ||
    (section && !auditSections.includes(section)) ||
    (action && ![...serverActions, ...Object.values(clientActions).flat()].includes(action)) ||
    search.length > 80 ||
    Number.isNaN(from) ||
    Number.isNaN(to) ||
    (from !== null && to !== null && from > to) ||
    (before && !/^[1-9][0-9]{0,14}$/.test(before))
  )
    return null;
  return {
    actor,
    section,
    action,
    search,
    from,
    until: to === null ? null : to + day,
    before: Number(before),
  };
}

export function listAudit(
  sql,
  { actor, section, action, search, from, until, before },
  now = Date.now(),
) {
  const where = ["a.at>=?"];
  const args = [now - 90 * day];
  for (const [column, value] of [
    ["actor", actor],
    ["section", section],
    ["action", action],
  ]) {
    if (!value) continue;
    where.push(`a.${column}=?`);
    args.push(value);
  }
  if (from !== null) {
    where.push("a.at>=?");
    args.push(from);
  }
  if (until !== null) {
    where.push("a.at<?");
    args.push(until);
  }
  if (before) {
    where.push("a.seq<?");
    args.push(before);
  }
  if (search) {
    // SQLite lower() is ASCII-only. Match staff names and logins with Unicode case folding here.
    const needle = search.toLocaleLowerCase("ru");
    const matching = sql
      .exec("SELECT id, name, login FROM employees")
      .toArray()
      .filter(({ name, login }) =>
        [name, login].some((value) => value.toLocaleLowerCase("ru").includes(needle)),
      )
      .map(({ id }) => id);
    where.push(`(instr(a.actor,?)>0 OR instr(COALESCE(a.object,''),?)>0 OR instr(a.action,?)>0
      OR a.actor IN (SELECT value FROM json_each(?)) OR a.object IN (SELECT value FROM json_each(?))
      OR (a.actor='owner' AND ?))`);
    args.push(
      needle,
      needle,
      needle,
      JSON.stringify(matching),
      JSON.stringify(matching),
      "владелец".includes(needle) ? 1 : 0,
    );
  }
  const rows = sql
    .exec(
      `SELECT a.*, e.name AS actor_name FROM cabinet_audit a
     LEFT JOIN employees e ON e.id=a.actor
     WHERE ${where.join(" AND ")} ORDER BY a.seq DESC LIMIT ?`,
      ...args,
      pageSize + 1,
    )
    .toArray();
  const events = rows
    .slice(0, pageSize)
    .map(({ seq, at, actor, actor_name, section, action, outcome, source, object, changes }) => ({
      id: String(seq),
      at: new Date(at).toISOString(),
      actor,
      actorName: actor_name,
      section,
      action,
      outcome,
      source,
      object,
      changes: changes ? JSON.parse(changes) : null,
    }));
  return { events, next: rows.length > pageSize ? events.at(-1).id : null };
}

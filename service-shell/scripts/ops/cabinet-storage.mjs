import { DurableObject } from "cloudflare:workers";
import { digest, equal, protectCredentials, random } from "./cabinet-admin.mjs";
import {
  checkConnection,
  getToken,
  MAX_JOB_STEPS,
  MAX_PAGES,
  readBalance,
  readPage,
  readStatistics,
} from "./cabinet-source.mjs";

const CREATE = `
  CREATE TABLE IF NOT EXISTS connection (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, encrypted TEXT);
  CREATE TABLE IF NOT EXISTS job (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS items (kind TEXT NOT NULL, parent TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind, parent, id));
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL,
    verifier TEXT NOT NULL, temporary_until INTEGER, revoked_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, employee_id TEXT NOT NULL, expiry INTEGER NOT NULL,
    FOREIGN KEY(employee_id) REFERENCES employees(id)
  );
  CREATE INDEX IF NOT EXISTS session_employee ON sessions(employee_id);
`;
const hour = 3600000;
const encode = (value) => JSON.stringify(value);
const own = (error, status) => ({ error, status });
const encoder = new TextEncoder();
const nowIso = () => new Date().toISOString();
const expose = ({ id, name, login, temporary_until, revoked_at }) => ({
  id,
  name,
  login,
  role: "tester",
  temporaryUntil: temporary_until,
  revokedAt: revoked_at,
});
async function verifier(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 600000 },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function newPassword(password = random(16)) {
  const salt = random(16);
  return { salt, password, verifier: await verifier(password, salt) };
}

export class CabinetStorage extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(CREATE);
  }
  one(query, ...args) {
    return this.sql.exec(query, ...args).toArray()[0];
  }
  rows(query, ...args) {
    return this.sql.exec(query, ...args).toArray();
  }
  connections() {
    return this.rows("SELECT metadata FROM connection ORDER BY id LIMIT 100").map(({ metadata }) =>
      JSON.parse(metadata),
    );
  }
  connection(id) {
    const row = this.one("SELECT metadata FROM connection WHERE id=?", id);
    return row ? JSON.parse(row.metadata) : null;
  }
  register(metadata) {
    const current = this.connection(metadata.id);
    if (current) return { ok: true };
    if (this.one("SELECT COUNT(*) AS count FROM connection").count >= 100)
      return own("inventory_limit", 409);
    this.sql.exec(
      "INSERT INTO connection (id, metadata) VALUES (?,?)",
      metadata.id,
      encode(metadata),
    );
    return { ok: true };
  }
  configure(metadata, encrypted) {
    if (this.job()?.status === "running" || this.job()?.status === "queued")
      return own("connection_busy", 409);
    this.sql.exec(
      "INSERT INTO connection VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata, encrypted=excluded.encrypted",
      metadata.id,
      encode(metadata),
      encrypted,
    );
    this.cachedToken = null;
    return { ok: true };
  }
  job() {
    const row = this.one("SELECT value FROM job WHERE id=1");
    return row ? JSON.parse(row.value) : null;
  }
  storeJob(value) {
    this.sql.exec(
      "INSERT INTO job VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      encode(value),
    );
  }
  summary() {
    const job = this.job();
    if (!job) return null;
    const {
      id,
      status,
      phase,
      page,
      steps,
      attempts,
      nextAt,
      updatedAt,
      startedAt,
      error,
      partial,
      unavailable,
    } = job;
    return {
      id,
      status,
      phase,
      page,
      steps,
      attempts,
      nextAt,
      updatedAt,
      startedAt,
      error,
      partial,
      unavailable,
    };
  }
  details() {
    const info = this.summary();
    const employees = this.rows(
      "SELECT id, name, login, temporary_until, revoked_at FROM employees ORDER BY name, login",
    ).map(expose);
    const imported = Object.fromEntries(
      this.rows("SELECT kind,COUNT(*) AS total FROM items GROUP BY kind").map(({ kind, total }) => [
        kind,
        total,
      ]),
    );
    return { cabinet: info, employees, imported };
  }
  async activate(metadata) {
    const previous = this.job();
    if (previous) {
      if (previous.nextAt && !(await this.ctx.storage.getAlarm()))
        await this.ctx.storage.setAlarm(previous.nextAt);
      return { cabinet: this.summary(), replayed: true };
    }
    if (
      metadata.source === "configured" &&
      !this.one(
        "SELECT encrypted FROM connection WHERE id=? AND encrypted IS NOT NULL",
        metadata.id,
      )
    ) {
      return own("connection_unavailable", 409);
    }
    const nextAt = Date.now() + 250;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT OR IGNORE INTO connection (id,metadata) VALUES (?,?)",
        metadata.id,
        encode(metadata),
      );
      this.storeJob({
        id: metadata.id,
        status: "queued",
        phase: "profile",
        page: 0,
        chatId: "",
        steps: 0,
        attempts: 0,
        partial: false,
        startedAt: nowIso(),
        updatedAt: nowIso(),
        nextAt,
        error: null,
      });
    });
    await this.ctx.storage.setAlarm(nextAt);
    return { cabinet: this.summary(), replayed: false };
  }
  async retry() {
    const job = this.job();
    if (!job) return own("cabinet_not_found", 404);
    if (job.status !== "failed") return { cabinet: this.summary(), replayed: true };
    job.attempts = 0;
    job.nextAt = Date.now() + 250;
    job.status = "queued";
    this.storeJob(job);
    await this.ctx.storage.setAlarm(job.nextAt);
    return { cabinet: this.summary(), replayed: false };
  }
  async credentials(id) {
    if (this.env.CABINET_SOURCE_MODE === "synthetic") return {};
    const row = this.one("SELECT encrypted FROM connection WHERE id=?", id);
    if (row?.encrypted) return protectCredentials(this.env, row.encrypted, id, true);
    const account = await this.env.CABINET_LEGACY_ACCOUNTS?.get(`account:${id}`, "json");
    if (
      account?.id === id &&
      String(account.userId) === this.connection(id)?.userId &&
      account.clientId &&
      account.clientSecret
    )
      return account;
    throw new Error("connection_unavailable");
  }
  async token(id) {
    if (!this.cachedToken || this.cachedToken.expires <= Date.now())
      this.cachedToken = await getToken(
        this.env,
        await this.credentials(id),
        this.connection(id).userId,
      );
    return this.cachedToken;
  }
  getNextChat(after) {
    return (
      this.one(
        "SELECT id FROM items WHERE kind='chats' AND parent='' AND id>? ORDER BY id LIMIT 1",
        after,
      )?.id || ""
    );
  }
  async alarm() {
    const job = this.job();
    if (!job || !["queued", "running"].includes(job.status)) return;
    if (job.nextAt > Date.now()) {
      await this.ctx.storage.setAlarm(job.nextAt);
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + 60000);
    job.status = "running";
    job.updatedAt = nowIso();
    this.storeJob(job);
    try {
      const limiter = this.env.CABINET_READ_LIMIT;
      if (this.env.CABINET_SOURCE_MODE !== "synthetic" && !limiter)
        throw new Error("source_limiter_missing");
      if (limiter && !(await limiter.limit({ key: "account-import" })).success) {
        job.nextAt = Date.now() + 60_000;
        job.error = "cantor_rate_limit";
        this.storeJob(job);
        await this.ctx.storage.setAlarm(job.nextAt);
        return;
      }
      const userId = this.connection(job.id).userId;
      const token = await this.token(job.id);
      if (job.phase === "profile") {
        await checkConnection(this.env, token, userId);
        job.phase = "ads";
      } else if (["stats", "balance"].includes(job.phase)) {
        const value =
          job.phase === "stats"
            ? await readStatistics(this.env, token, userId)
            : await readBalance(this.env, token, userId);
        this.sql.exec(
          "INSERT OR REPLACE INTO items VALUES ('summary','',?,?)",
          job.phase,
          encode(value),
        );
        job.phase = job.phase === "stats" ? "balance" : "done";
      } else {
        const batch = await readPage(this.env, token, userId, job.phase, job.page, job.chatId);
        this.ctx.storage.transactionSync(() => {
          const parent = job.phase === "messages" ? job.chatId : "";
          const fingerprint = batch.items.map(({ id }) => id).join(",");
          const repeated = job.page > 0 && fingerprint && fingerprint === job.fingerprint;
          if (repeated) job.partial = true;
          for (const entry of batch.items) {
            this.sql.exec(
              "INSERT INTO items VALUES (?,?,?,?) ON CONFLICT(kind,parent,id) DO UPDATE SET value=excluded.value",
              job.phase,
              parent,
              entry.id,
              encode(entry),
            );
          }
          this.advance(job, repeated ? { more: false } : batch);
          job.fingerprint = job.page > 0 ? fingerprint : null;
        });
      }
      job.steps++;
      job.attempts = 0;
      job.error = null;
      if (job.steps >= MAX_JOB_STEPS && job.phase !== "done") {
        job.partial = true;
        job.phase = "done";
      }
      job.status = job.phase === "done" ? (job.partial ? "partial" : "ready") : "running";
      job.nextAt = job.phase === "done" ? null : Date.now() + 3000;
    } catch (error) {
      if ([401, 403].includes(error.status)) this.cachedToken = null;
      job.attempts++;
      const message = String(error.message);
      job.error =
        /^avito_http_\d{3}$/.test(message) ||
        [
          "avito_account_mismatch",
          "connection_unavailable",
          "source_not_configured",
          "source_limiter_missing",
          "unexpected_source_response",
          "source_response_too_large",
          "source_token_invalid",
        ].includes(message)
          ? message
          : "source_unavailable";
      const numericDelay = Number(error.retryAfter) * 1000;
      const retryAfter = numericDelay || Date.parse(error.retryAfter) - Date.now() || 0;
      const delay = Math.min(3600000, Math.max(retryAfter, 10000 * 2 ** (job.attempts - 1)));
      const terminal = job.attempts >= 5 || job.error === "avito_account_mismatch";
      if (terminal && ["stats", "balance"].includes(job.phase)) {
        job.partial = true;
        const skipped = job.phase;
        const errors = { ...job.unavailable, [skipped]: job.error };
        job.unavailable = errors;
        job.attempts = 0;
        job.phase = skipped === "stats" ? "balance" : "done";
        job.status = job.phase === "done" ? "partial" : "running";
        job.nextAt = job.phase === "done" ? null : Date.now() + delay;
      } else {
        job.status = terminal ? "failed" : "running";
        job.nextAt = terminal ? null : Date.now() + delay;
      }
    }
    job.updatedAt = nowIso();
    this.storeJob(job);
    if (job.nextAt) await this.ctx.storage.setAlarm(job.nextAt);
    else await this.ctx.storage.deleteAlarm();
  }
  advance(job, batch) {
    if (batch.more && job.page + 1 < MAX_PAGES) {
      job.page++;
      return;
    }
    if (batch.more) job.partial = true;
    job.page = 0;
    if (job.phase === "ads") {
      job.phase = "chats";
      return;
    }
    job.chatId = this.getNextChat(job.chatId);
    job.phase = job.chatId ? "messages" : "stats";
  }
  employee(id) {
    return this.one("SELECT * FROM employees WHERE id=?", id);
  }
  async createEmployee(name, login) {
    if (!this.job()) return own("cabinet_not_found", 404);
    if (this.one("SELECT id FROM employees WHERE login=?", login))
      return own("employee_exists", 409);
    const secret = await newPassword();
    const id = random(12);
    if (this.one("SELECT id FROM employees WHERE login=?", login))
      return own("employee_exists", 409);
    this.sql.exec(
      "INSERT INTO employees VALUES (?,?,?,?,?,?,NULL)",
      id,
      login,
      name,
      secret.salt,
      secret.verifier,
      Date.now() + 24 * hour,
    );
    return { employee: expose(this.employee(id)), temporaryPassword: secret.password };
  }
  async changeEmployee(id, action) {
    if (typeof id !== "string" || !this.employee(id)) return own("employee_not_found", 404);
    const secret = action === "reset" ? await newPassword() : null;
    this.ctx.storage.transactionSync(() => {
      if (secret)
        this.sql.exec(
          "UPDATE employees SET salt=?,verifier=?,temporary_until=?,revoked_at=NULL WHERE id=?",
          secret.salt,
          secret.verifier,
          Date.now() + 24 * hour,
          id,
        );
      else this.sql.exec("UPDATE employees SET revoked_at=? WHERE id=?", Date.now(), id);
      this.sql.exec("DELETE FROM sessions WHERE employee_id=?", id);
    });
    return {
      employee: expose(this.employee(id)),
      ...(secret ? { temporaryPassword: secret.password } : {}),
    };
  }
  identity(employee) {
    if (
      !employee ||
      employee.revoked_at ||
      (employee.temporary_until && employee.temporary_until < Date.now())
    )
      return null;
    return {
      role: "tester",
      workspaceId: this.job().id,
      employeeId: employee.id,
      login: employee.login,
      name: employee.name,
      mustChangePassword: Boolean(employee.temporary_until),
    };
  }
  identify(token) {
    const employee = this.one(
      "SELECT employees.* FROM sessions JOIN employees ON employee_id=employees.id WHERE token=? AND expiry>?",
      token,
      Date.now(),
    );
    return this.identity(employee);
  }
  async login(login, password) {
    const candidate = this.one("SELECT * FROM employees WHERE login=?", login);
    const actual = await verifier(password, candidate?.salt || "unknown-employee-timing-salt");
    const token = random();
    const hash = await digest(token);
    const current = candidate && this.employee(candidate.id);
    if (!current || !equal(actual, current.verifier)) return null;
    const identity = this.identity(current);
    if (!identity) return null;
    this.sql.exec("DELETE FROM sessions WHERE expiry<=?", Date.now());
    this.sql.exec("INSERT INTO sessions VALUES (?,?,?)", hash, current.id, Date.now() + 12 * hour);
    return { token, identity };
  }
  logout(token) {
    this.sql.exec("DELETE FROM sessions WHERE token=?", token);
  }
  async changePassword(oldToken, password) {
    const identity = this.identify(oldToken);
    if (!identity?.mustChangePassword) return null;
    const employee = this.employee(identity.employeeId);
    if (equal(await verifier(password, employee.salt), employee.verifier)) return null;
    const secret = await newPassword(password);
    const token = random();
    const hash = await digest(token);
    if (!this.identify(oldToken)?.mustChangePassword) return null;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "UPDATE employees SET salt=?,verifier=?,temporary_until=NULL WHERE id=?",
        secret.salt,
        secret.verifier,
        employee.id,
      );
      this.sql.exec("DELETE FROM sessions WHERE employee_id=?", employee.id);
      this.sql.exec(
        "INSERT INTO sessions VALUES (?,?,?)",
        hash,
        employee.id,
        Date.now() + 12 * hour,
      );
    });
    return { token, identity: this.identity(this.employee(employee.id)) };
  }
  records(kind, parent = "") {
    return this.rows("SELECT value FROM items WHERE kind=? AND parent=?", kind, parent).map(
      ({ value }) => JSON.parse(value),
    );
  }
  bootstrap(token) {
    const identity = this.identify(token);
    if (!identity) return own("unauthorized", 401);
    if (identity.mustChangePassword) return own("password_change_required", 403);
    const job = this.job();
    const summary = Object.fromEntries(
      this.rows("SELECT id,value FROM items WHERE kind='summary'").map(({ id, value }) => [
        id,
        JSON.parse(value),
      ]),
    );
    return {
      ...summary.stats,
      balance: summary.balance,
      workspaceId: job.id,
      tutor: this.connection(job.id).name,
      subject: "",
      readAt: job.updatedAt,
      catalogAt: this.one("SELECT id FROM items WHERE kind='ads' LIMIT 1")
        ? Date.parse(job.updatedAt)
        : null,
      chatsAt: this.one("SELECT id FROM items WHERE kind='chats' LIMIT 1")
        ? Date.parse(job.updatedAt)
        : null,
      ads: this.records("ads"),
      chats: this.records("chats").sort((a, b) => b.lastAt - a.lastAt),
      daily: [],
      importStatus: this.summary(),
    };
  }
  chat(token, id) {
    const identity = this.identify(token);
    if (!identity) return own("unauthorized", 401);
    if (identity.mustChangePassword) return own("password_change_required", 403);
    if (
      typeof id !== "string" ||
      !this.one("SELECT id FROM items WHERE kind='chats' AND parent='' AND id=?", id)
    )
      return own("not_found", 404);
    return { messages: this.records("messages", id).sort((a, b) => a.at - b.at) };
  }
}

import { CrmError } from "../crm.ts";
import {
  applyCommand,
  commandSchema,
  mutationSchema,
  serviceId,
  type Mutation,
} from "./commands.ts";
import type { CrmRepository, Access, Receipt } from "./repository.server.ts";

export type CrmHttpDependencies = {
  authenticate: (request: Request) => Promise<{ id: string } | null>;
  repository: () => Promise<CrmRepository>;
  now?: () => string;
  reportError?: (error: unknown) => void;
};
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  vary: "Cookie, Authorization",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const fail = (error: string, status: number) => json({ error }, status);
const snapshot = (access: Access) => ({ revision: access.revision, state: access.state });
const samePayload = (receipt: Receipt, input: Mutation, userId: string) =>
  receipt.actor_id === userId &&
  JSON.stringify(commandSchema.parse(receipt.payload)) === JSON.stringify(input.command);

async function readBody(request: Request): Promise<unknown> {
  // Enforce bytes even without Content-Length. This is a per-request transport
  // limit, not a subscription quota or a limit on the number of CRM records.
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("invalid_json");
  }
}
export function createCrmHttpHandler(deps: CrmHttpDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if (!["GET", "POST"].includes(request.method)) return fail("method_not_allowed", 405);
      const url = new URL(request.url);
      const origin = request.headers.get("origin"),
        site = request.headers.get("sec-fetch-site");
      if ((origin && origin !== url.origin) || (site && !["same-origin", "none"].includes(site)))
        return fail("cross_origin", 403);
      // This resolver MUST verify a session. Never accept body/header userId or
      // the template's shared DEV_USER_ID fallback for a service workspace.
      const user = await deps.authenticate(request);
      if (!user) return fail("unauthorized", 401);
      const workspaceId = serviceId.safeParse(url.searchParams.get("workspaceId"));
      if (!workspaceId.success) return fail("invalid_workspace", 400);
      const repo = await deps.repository();
      let current = await repo.read(workspaceId.data, user.id);
      if (!current) return fail("not_found", 404); // same response for another client's or absent workspace
      if (request.method === "GET") return json(snapshot(current));
      if (current.role === "viewer") return fail("forbidden", 403);
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
        return fail("unsupported_media_type", 415);
      const parsed = mutationSchema.safeParse(await readBody(request));
      if (!parsed.success) return fail("invalid_command", 400);
      const input = parsed.data;
      const replay = async (receipt: Receipt) => {
        if (!samePayload(receipt, input, user.id)) return fail("idempotency_conflict", 409);
        // The receipt may have committed after our initial read.
        const latest = await repo.read(workspaceId.data, user.id);
        if (!latest) return fail("not_found", 404);
        if (latest.role === "viewer") return fail("forbidden", 403);
        return json({ ...snapshot(latest), replayed: true, mutationRevision: receipt.revision });
      };
      let receipt = await repo.receipt(workspaceId.data, user.id, input.requestId);
      if (receipt) return replay(receipt);
      if (input.revision !== current.revision)
        return json({ error: "revision_conflict", ...snapshot(current) }, 409);
      const now = deps.now?.() ?? new Date().toISOString();
      const next = applyCommand(current.state, input, now);
      const saved = await repo.commit(
        workspaceId.data,
        user.id,
        input.revision,
        input.requestId,
        input.command,
        next,
        now,
      );
      if (saved) return json({ ...saved, replayed: false, mutationRevision: saved.revision });
      // A concurrent command or membership revocation won. Reload, never overwrite
      // a newer snapshot and never return client data after access was revoked.
      current = await repo.read(workspaceId.data, user.id);
      if (!current) return fail("not_found", 404);
      if (current.role === "viewer") return fail("forbidden", 403);
      receipt = await repo.receipt(workspaceId.data, user.id, input.requestId);
      if (receipt) return replay(receipt);
      return json({ error: "revision_conflict", ...snapshot(current) }, 409);
    } catch (error) {
      if (error instanceof CrmError)
        return json({ error: "invalid_transition", message: error.message }, 422);
      if (
        error instanceof Error &&
        ["invalid_json", "body_too_large", "future_payment"].includes(error.message)
      )
        return fail(error.message, error.message === "body_too_large" ? 413 : 422);
      deps.reportError?.(error);
      return fail("service_unavailable", 503);
    }
  };
}

import { parseCrmState, type CrmState } from "../crm.ts";
import type { CrmCommand } from "./commands.ts";

// Use the application's existing Sql surface (Postgres / local PGLite).
// No in-memory mutex: correctness must hold across server processes.
export interface CrmSql {
  query<T>(text: string, params?: unknown[]): Promise<T[]>;
}
export type Role = "owner" | "curator" | "viewer";
export type Snapshot = { revision: number; state: CrmState };
export type Access = Snapshot & { role: Role };
export type Receipt = { actor_id: string; payload: CrmCommand; revision: number };
function storedState(raw: unknown): CrmState {
  try {
    return parseCrmState(raw);
  } catch {
    throw new Error("invalid_stored_crm_state");
  }
}
export function createCrmRepository(sql: CrmSql) {
  return {
    async read(workspaceId: string, userId: string): Promise<Access | null> {
      const [row] = await sql.query<{ revision: number; state: unknown; role: Role }>(
        `SELECT w.revision,w.state,m.role FROM service_crm_workspaces w
         JOIN service_crm_memberships m ON m.workspace_id=w.id
         WHERE w.id=$1 AND m.user_id=$2 AND m.active`,
        [workspaceId, userId],
      );
      return row ? { revision: row.revision, state: storedState(row.state), role: row.role } : null;
    },
    async receipt(workspaceId: string, userId: string, requestId: string): Promise<Receipt | null> {
      const [row] = await sql.query<Receipt>(
        `SELECT c.actor_id,c.payload,c.revision FROM service_crm_commands c
         JOIN service_crm_memberships m ON m.workspace_id=c.workspace_id
         WHERE c.workspace_id=$1 AND c.request_id=$3 AND m.user_id=$2 AND m.active
         AND m.role IN ('owner','curator')`,
        [workspaceId, userId, requestId],
      );
      return row ?? null;
    },
    async commit(
      workspaceId: string,
      userId: string,
      revision: number,
      requestId: string,
      command: CrmCommand,
      state: CrmState,
      now: string,
    ): Promise<Snapshot | null> {
      const [row] = await sql.query<{ revision: number; state: unknown }>(
        `WITH authorized AS MATERIALIZED (
           SELECT user_id FROM service_crm_memberships
           WHERE workspace_id=$1 AND user_id=$2 AND active AND role IN ('owner','curator')
           FOR SHARE
         ), changed AS (
           UPDATE service_crm_workspaces SET state=$6::jsonb,revision=revision+1
           WHERE id=$1 AND revision=$3 AND EXISTS(SELECT 1 FROM authorized)
           RETURNING revision,state
         ), receipt AS (
           INSERT INTO service_crm_commands(workspace_id,request_id,actor_id,payload,revision,recorded_at)
           SELECT $1,$4,$2,$5::jsonb,revision,$7::timestamptz FROM changed RETURNING revision
         ) SELECT changed.revision,changed.state FROM changed JOIN receipt USING(revision)`,
        [
          workspaceId,
          userId,
          revision,
          requestId,
          JSON.stringify(command),
          JSON.stringify(state),
          now,
        ],
      );
      return row ? { revision: row.revision, state: storedState(row.state) } : null;
    },
  };
}
export type CrmRepository = ReturnType<typeof createCrmRepository>;

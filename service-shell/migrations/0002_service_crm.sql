-- Additive only. No import of production Avito data or demo seed.
CREATE TABLE service_crm_workspaces (
  id text PRIMARY KEY,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state jsonb NOT NULL,
  CHECK (state->>'workspaceId' = id AND state->>'version' = '1')
);
CREATE TABLE service_crm_memberships (
  workspace_id text NOT NULL REFERENCES service_crm_workspaces(id),
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'curator', 'viewer')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX service_crm_member_user ON service_crm_memberships(user_id) WHERE active;
-- Receipt and audit are written in the SAME SQL statement as the state.
-- Requests are workspace-scoped, not globally shared across clients.
CREATE TABLE service_crm_commands (
  workspace_id text NOT NULL REFERENCES service_crm_workspaces(id),
  request_id text NOT NULL,
  actor_id text NOT NULL,
  payload jsonb NOT NULL,
  revision integer NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, request_id),
  UNIQUE (workspace_id, revision)
);

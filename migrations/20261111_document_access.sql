-- Run this once against the Book Viewer PostgreSQL database before enabling document ACLs.
-- New documents are private by default for non-admin users.
CREATE TABLE IF NOT EXISTS document_access_groups (
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  group_path TEXT NOT NULL,
  PRIMARY KEY (document_id, group_path),
  CONSTRAINT document_access_groups_nonempty CHECK (length(btrim(group_path)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_document_access_groups_group ON document_access_groups(group_path);

CREATE TABLE IF NOT EXISTS document_access_users (
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  keycloak_user_id TEXT NOT NULL,
  PRIMARY KEY (document_id, keycloak_user_id),
  CONSTRAINT document_access_users_nonempty CHECK (length(btrim(keycloak_user_id)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_document_access_users_user ON document_access_users(keycloak_user_id);

CREATE TABLE IF NOT EXISTS document_access_audit (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_policy JSONB NOT NULL,
  new_policy JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

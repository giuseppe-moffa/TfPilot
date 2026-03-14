-- Rename Environment → Workspace across all tables.
-- Clean refactor: no live production data to preserve.
-- See: docs/plans-and-deltas/ARCHITECTURE_DELTA_PROJECT_TO_WORKSPACE.md

-- 1. Rename environments table → workspaces
ALTER TABLE environments RENAME TO workspaces;

-- 2. Rename columns in workspaces
ALTER TABLE workspaces RENAME COLUMN environment_id TO workspace_id;
ALTER TABLE workspaces RENAME COLUMN environment_key TO workspace_key;
ALTER TABLE workspaces RENAME COLUMN environment_slug TO workspace_slug;

-- 3. Rename indexes and PK constraint on workspaces (Postgres keeps old names after table rename)
ALTER INDEX environments_pkey RENAME TO workspaces_pkey;
ALTER INDEX idx_environments_repo_key_slug RENAME TO idx_workspaces_repo_key_slug;
ALTER INDEX idx_environments_project_key RENAME TO idx_workspaces_project_key;
ALTER INDEX idx_environments_archived_at RENAME TO idx_workspaces_archived_at;

-- 4. Rename columns in requests_index
ALTER TABLE requests_index RENAME COLUMN environment_key TO workspace_key;
ALTER TABLE requests_index RENAME COLUMN environment_slug TO workspace_slug;

-- 5. Rename column in audit_events
ALTER TABLE audit_events RENAME COLUMN environment_id TO workspace_id;

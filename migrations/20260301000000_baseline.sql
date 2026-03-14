-- Baseline schema (post Template-Only Workspaces).
-- Replaces the incremental migration chain 20260301–20260324.
-- For fresh DB: run this only. For existing DB: drop schema or use a separate DB.
-- See docs/plans-and-deltas/CLEANUP_AUDIT_POST_TEMPLATE_ONLY.md.

-- Drop in reverse dependency order
DROP TABLE IF EXISTS audit_events CASCADE;
DROP TABLE IF EXISTS requests_index CASCADE;
DROP TABLE IF EXISTS project_user_roles CASCADE;
DROP TABLE IF EXISTS project_team_roles CASCADE;
DROP TABLE IF EXISTS project_team_access CASCADE;
DROP TABLE IF EXISTS team_memberships CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS org_memberships CASCADE;
DROP TABLE IF EXISTS platform_admins CASCADE;
DROP TABLE IF EXISTS orgs CASCADE;
DROP TYPE IF EXISTS project_role CASCADE;

-- Orgs
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NULL
);

CREATE TABLE org_memberships (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  login TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  PRIMARY KEY (org_id, login)
);

-- Projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  project_key TEXT NOT NULL,
  name TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (org_id, project_key)
);

-- Teams
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE TABLE team_memberships (
  team_id TEXT NOT NULL REFERENCES teams(id),
  login TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (team_id, login)
);

CREATE TABLE project_team_access (
  project_id TEXT NOT NULL REFERENCES projects(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, team_id)
);

-- Project roles (RBAC)
CREATE TYPE project_role AS ENUM (
  'viewer',
  'planner',
  'operator',
  'deployer',
  'admin'
);

CREATE TABLE project_user_roles (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_login TEXT NOT NULL,
  role project_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_login)
);
CREATE INDEX idx_project_user_roles_project ON project_user_roles(project_id);

CREATE TABLE project_team_roles (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role project_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, team_id)
);
CREATE INDEX idx_project_team_roles_project ON project_team_roles(project_id);
CREATE INDEX idx_project_team_roles_team ON project_team_roles(team_id);

-- Workspaces (canonical infra root; template-only)
CREATE TABLE workspaces (
  workspace_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_key TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  workspace_slug TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  template_inputs JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX idx_workspaces_repo_key_slug ON workspaces (repo_full_name, workspace_key, workspace_slug);
CREATE INDEX idx_workspaces_project_key ON workspaces (project_key);
CREATE INDEX idx_workspaces_archived_at ON workspaces (archived_at);

-- Request index (projection only; S3 authoritative)
CREATE TABLE requests_index (
  request_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  repo_full_name TEXT,
  workspace_key TEXT,
  workspace_slug TEXT,
  module_key TEXT,
  actor TEXT,
  pr_number INTEGER,
  merged_sha TEXT,
  last_activity_at TIMESTAMPTZ,
  doc_hash TEXT
);
CREATE INDEX requests_index_updated_at_request_id_idx ON requests_index (updated_at DESC, request_id DESC);
CREATE INDEX requests_index_last_activity_sort_idx ON requests_index ((COALESCE(last_activity_at, updated_at)) DESC, request_id DESC);

-- Audit events (append-only; workspace_id canonical)
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  actor_login TEXT,
  source TEXT NOT NULL CHECK (source IN ('user', 'system', 'github_webhook')),
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  request_id TEXT,
  workspace_id TEXT,
  project_key TEXT
);
CREATE INDEX audit_events_org_created_idx ON audit_events (org_id, created_at DESC, id DESC);
CREATE INDEX audit_events_org_event_idx ON audit_events (org_id, event_type);
CREATE INDEX audit_events_request_idx ON audit_events (request_id);

-- Platform admins
CREATE TABLE platform_admins (
  login TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_platform_admins_login ON platform_admins(login);

-- projects: Org-scoped project registry (Step 2.1).
-- Replaces global infra repo registry later. No seed logic, no runtime changes yet.

CREATE TABLE IF NOT EXISTS projects (
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

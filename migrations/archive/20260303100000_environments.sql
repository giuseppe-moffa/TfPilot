-- environments: Model 2 first-class Environment entity.
-- Phase 0 scaffolding. No request flows read this yet.

CREATE TABLE IF NOT EXISTS environments (
  environment_id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  environment_key TEXT NOT NULL,
  environment_slug TEXT NOT NULL,
  template_id TEXT,
  template_version TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ
);

-- Unique constraint per ARCHITECTURE_DELTA_ENVIRONMENTS §3.1
CREATE UNIQUE INDEX IF NOT EXISTS idx_environments_repo_key_slug
  ON environments (repo_full_name, environment_key, environment_slug);

-- List/filter by project_key
CREATE INDEX IF NOT EXISTS idx_environments_project_key
  ON environments (project_key);

-- Filter non-archived for request creation
CREATE INDEX IF NOT EXISTS idx_environments_archived_at
  ON environments (archived_at);

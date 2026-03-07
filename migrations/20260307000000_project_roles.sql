-- project_roles: RBAC foundation for env0-style project role assignments.
-- Creates project_role enum, project_user_roles, project_team_roles.
-- Does NOT modify project_team_access, org_memberships, or any existing RBAC.
-- Reference: docs/plans-and-deltas/RBAC_OVERHAUL_ARCHITECTURE_DELTA.md
--
-- Note: Migration timestamp 20260307 runs before projects/teams (20260320*) in sort order.
-- For fresh DB installs, rename to 20260323000000_project_roles.sql so it runs after teams.

-- 1. Enum for project roles
DO $$ BEGIN
  CREATE TYPE project_role AS ENUM (
    'viewer',
    'planner',
    'operator',
    'deployer',
    'admin'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL; -- already exists
END $$;

-- 2. Direct user role assignment on a project
CREATE TABLE IF NOT EXISTS project_user_roles (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_login TEXT NOT NULL,
  role project_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_login)
);

CREATE INDEX IF NOT EXISTS idx_project_user_roles_project
  ON project_user_roles(project_id);

-- 3. Team role assignment on a project
CREATE TABLE IF NOT EXISTS project_team_roles (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role project_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_project_team_roles_project
  ON project_team_roles(project_id);

CREATE INDEX IF NOT EXISTS idx_project_team_roles_team
  ON project_team_roles(team_id);

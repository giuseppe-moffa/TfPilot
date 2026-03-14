-- teams: Database foundation for teams and team-based project access (Step 1).
-- Tables: teams, team_memberships, project_team_access. No seed logic, no runtime changes yet.

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS team_memberships (
  team_id TEXT NOT NULL REFERENCES teams(id),
  login TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (team_id, login)
);

CREATE TABLE IF NOT EXISTS project_team_access (
  project_id TEXT NOT NULL REFERENCES projects(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, team_id)
);

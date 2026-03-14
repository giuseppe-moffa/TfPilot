-- platform_admins: Authoritative table for platform-wide admin authority.
-- Replaces legacy TFPILOT_ADMINS env-based allowlist.
-- Reference: docs/plans-and-deltas/RBAC_OVERHAUL_ARCHITECTURE_DELTA.md
--
-- Bootstrap: Run `npm run db:seed-platform-admins` after migration to seed from
-- TFPILOT_ADMINS (transitional; remove env var after rollout).

CREATE TABLE IF NOT EXISTS platform_admins (
  login TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_login ON platform_admins(login);

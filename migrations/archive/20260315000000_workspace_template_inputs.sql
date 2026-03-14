-- Phase 3 — Workspace template inputs (pinned create-time values).
-- See: docs/plans-and-deltas/IMPLEMENTATION_PLAN_TEMPLATE_ONLY_WORKSPACES.md

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS template_inputs JSONB NOT NULL DEFAULT '{}';

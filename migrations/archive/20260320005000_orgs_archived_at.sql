-- orgs: Add soft-archive column. NULL = active, non-NULL = archived.
-- No backfill, no default, no extra indexes.

ALTER TABLE orgs ADD COLUMN archived_at TIMESTAMPTZ NULL;

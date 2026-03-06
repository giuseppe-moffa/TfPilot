-- requests_index: Add org ownership (Step 2.5).
-- No default, no extra index. Backfill via db:rebuild-index after migrating.
-- NOTE: ADD COLUMN ... NOT NULL fails on non-empty tables. If rows exist, add nullable first,
-- backfill org_id, then ALTER COLUMN SET NOT NULL.

ALTER TABLE requests_index
ADD COLUMN org_id TEXT NOT NULL;

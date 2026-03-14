-- environments: Add org ownership (Step 2.3).
-- No default, no seed, no index.
-- NOTE: ADD COLUMN ... NOT NULL fails on non-empty tables. If rows exist, add nullable first,
-- backfill org_id, then ALTER COLUMN SET NOT NULL.

ALTER TABLE environments
ADD COLUMN org_id TEXT NOT NULL;

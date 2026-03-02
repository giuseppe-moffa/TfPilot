-- requests_index: minimal table for future list/index. No lifecycle status column.
CREATE TABLE IF NOT EXISTS requests_index (
  request_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  repo_full_name TEXT,
  environment_key TEXT,
  module_key TEXT,
  actor TEXT,
  pr_number INTEGER,
  merged_sha TEXT,
  last_activity_at TIMESTAMPTZ,
  doc_hash TEXT
);

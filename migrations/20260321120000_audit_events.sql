-- audit_events: Append-only audit log for platform mutations.
-- Records who did what and when. No updates or deletes.

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  actor_login TEXT,
  source TEXT NOT NULL CHECK (source IN ('user', 'system', 'github_webhook')),
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  request_id TEXT,
  environment_id TEXT,
  project_key TEXT
);

CREATE INDEX audit_events_org_created_idx
ON audit_events (org_id, created_at DESC, id DESC);

CREATE INDEX audit_events_org_event_idx
ON audit_events (org_id, event_type);

CREATE INDEX audit_events_request_idx
ON audit_events (request_id);

-- Optional future: (org_id, entity_type) if entity_type filtering grows.

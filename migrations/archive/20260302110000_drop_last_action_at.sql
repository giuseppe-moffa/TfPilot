-- Drop last_action_at; we reuse last_activity_at for "last user action" display instead.
ALTER TABLE requests_index DROP COLUMN IF EXISTS last_action_at;

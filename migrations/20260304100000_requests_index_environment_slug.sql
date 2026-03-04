-- Add environment_slug to requests_index for precise environment activity filtering.
-- Environments are unique by (repo_full_name, environment_key, environment_slug).
ALTER TABLE requests_index ADD COLUMN IF NOT EXISTS environment_slug TEXT;

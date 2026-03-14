-- Add display_name and avatar_url to org_memberships for GitHub profile enrichment.
-- Purely for display; login remains the canonical identity.

ALTER TABLE org_memberships
ADD COLUMN display_name TEXT;

ALTER TABLE org_memberships
ADD COLUMN avatar_url TEXT;

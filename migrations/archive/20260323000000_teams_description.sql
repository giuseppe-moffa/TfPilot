-- Add optional description column to teams table.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS description TEXT;

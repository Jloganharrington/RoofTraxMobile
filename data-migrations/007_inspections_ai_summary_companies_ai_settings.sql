-- Adds the AI summary column to inspections and the AI settings column to
-- companies for the Summary protocol step (Task #41 / Claude Sonnet summary).
-- Idempotent: safe to run more than once or against a DB that already has
-- the columns (ADD COLUMN IF NOT EXISTS is a no-op when the column exists).

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS ai_summary jsonb DEFAULT NULL;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ai_settings jsonb DEFAULT NULL;

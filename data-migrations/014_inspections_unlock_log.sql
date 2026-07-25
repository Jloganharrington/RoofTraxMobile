-- 014: Append-only audit log of manager-authorized unlocks of submitted
-- inspections. Idempotent.
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS unlock_log jsonb NOT NULL DEFAULT '[]'::jsonb;

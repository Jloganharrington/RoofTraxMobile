-- The app no longer delivers submitted packages to the Brain; the courier,
-- its endpoints, and its delivery-state columns are removed.
-- Idempotent: IF EXISTS guards make this safe to re-run.

ALTER TABLE inspections
  DROP COLUMN IF EXISTS brain_delivery_status,
  DROP COLUMN IF EXISTS brain_submission_id,
  DROP COLUMN IF EXISTS brain_last_error,
  DROP COLUMN IF EXISTS brain_delivery_attempts,
  DROP COLUMN IF EXISTS brain_last_attempt_at,
  DROP COLUMN IF EXISTS brain_delivered_at;

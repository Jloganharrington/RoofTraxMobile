-- Task #42: Gemini report compilation
-- Add compiled report storage columns to the inspections table.
-- Idempotent: IF NOT EXISTS guards make this safe to re-run.

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS compiled_report_path text,
  ADD COLUMN IF NOT EXISTS compiled_report_ready_at timestamptz;

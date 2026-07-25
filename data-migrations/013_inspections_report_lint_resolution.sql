-- 013: Reviewer resolution of blocked content-lint results on compiled
-- forensic reports. Keyed by compiled blob path; null until a manager/admin
-- explicitly resolves. Idempotent.
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS report_lint_resolution jsonb DEFAULT NULL;

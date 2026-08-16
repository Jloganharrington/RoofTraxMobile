-- Migration 066: add 'insurance' to the workflow_assignment check constraint.
--
-- Background: user_profiles.workflow_assignment previously accepted only
-- 'retail' and 'insurance_retail'. The 'insurance' value is being added
-- to support a Canvasser – Insurance persona (insurance-only canvassers).
-- Existing rows are untouched; the default remains 'insurance_retail'.
--
-- Drizzle uses a named check constraint for varchar({enum}) columns.
-- Drop the old constraint and recreate it with the extended value set.

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_workflow_assignment_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_workflow_assignment_check
    CHECK (workflow_assignment IN ('retail', 'insurance', 'insurance_retail'));

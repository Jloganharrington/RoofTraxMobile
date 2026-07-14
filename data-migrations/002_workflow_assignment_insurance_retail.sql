-- FIX-2 (HIGH): collapse retired workflow-assignment values.
--
-- The workflow_assignment enum dropped the separate 'both' and 'insurance'
-- values in favor of a single 'insurance_retail'. Existing rows still holding
-- the old values silently lose the workflow picker. Idempotent: once migrated,
-- the WHERE clause matches nothing.

UPDATE user_profiles
SET workflow_assignment = 'insurance_retail',
    updated_at = now()
WHERE workflow_assignment IN ('both', 'insurance');

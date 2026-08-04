-- FIX (MEDIUM): remap project-pipeline pins stuck in the old stage key vocabulary.
--
-- The project pipeline was rebuilt from scratch with 8 new stage keys.  Any
-- pins previously advanced into the old project stage vocabulary will have a
-- pipelineStage value that is not present in the new key set, so they never
-- appear on the Project Pipeline board.
--
-- Mapping (old → new):
--   work_scheduled          → pm_handoff
--   work_started            → in_production
--   replacement_complete    → complete
--   certificate_of_completion → complete
--   final_payment_pending   → final_invoiced
--   final_payment_received  → final_invoiced
--   archived_complete       → closed_warranty
--
-- Note: 'materials_ordered' is unchanged — the key survived the rename.
--
-- The update is scoped to pins whose sourcePipeline = 'project' OR whose
-- pipelineStage is one of the old keys (some old rows may not yet carry
-- sourcePipeline, so we match purely on the key).
--
-- Idempotent: re-running after all rows have been migrated matches nothing
-- (the WHERE clause requires an old key, which no longer exists after the
-- first run).

UPDATE pins
SET pipeline_stage = 'pm_handoff',
    updated_at     = now()
WHERE pipeline_stage = 'work_scheduled';

UPDATE pins
SET pipeline_stage = 'in_production',
    updated_at     = now()
WHERE pipeline_stage = 'work_started';

UPDATE pins
SET pipeline_stage = 'complete',
    updated_at     = now()
WHERE pipeline_stage IN ('replacement_complete', 'certificate_of_completion');

UPDATE pins
SET pipeline_stage = 'final_invoiced',
    updated_at     = now()
WHERE pipeline_stage IN ('final_payment_pending', 'final_payment_received');

UPDATE pins
SET pipeline_stage = 'closed_warranty',
    updated_at     = now()
WHERE pipeline_stage = 'archived_complete';

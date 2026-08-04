-- FIX (MEDIUM): remap retail-pipeline pins stuck in the old stage key vocabulary.
--
-- The retail pipeline was rebuilt with 10 spec-exact stage keys.  Any pins
-- previously advanced into the old retail stage vocabulary will have a
-- pipelineStage value not present in the new key set, so they are dropped
-- silently from the Retail Pipeline board.
--
-- Mapping (old → new):
--   contact_made        → appt_needed       (rep made contact; needs to book appt)
--   appt_confirmed      → appt_complete      (appointment was confirmed and held)
--   estimate_provided   → proposal_provided  (direct rename)
--   followup_required   → follow_up          (direct rename)
--   contract_sent       → contract_pending   (contract is pending signature)
--
-- Note: pin_dropped, appt_scheduled, contract_signed, deposit_received, and
-- archived_lost are unchanged — those keys survived the rename.
--
-- Idempotent: re-running after all rows have been migrated matches nothing
-- (the WHERE clause requires an old key, which no longer exists after the
-- first run).

UPDATE pins
SET pipeline_stage = 'appt_needed',
    updated_at     = now()
WHERE pipeline_stage = 'contact_made';

UPDATE pins
SET pipeline_stage = 'appt_complete',
    updated_at     = now()
WHERE pipeline_stage = 'appt_confirmed';

UPDATE pins
SET pipeline_stage = 'proposal_provided',
    updated_at     = now()
WHERE pipeline_stage = 'estimate_provided';

UPDATE pins
SET pipeline_stage = 'follow_up',
    updated_at     = now()
WHERE pipeline_stage = 'followup_required';

UPDATE pins
SET pipeline_stage = 'contract_pending',
    updated_at     = now()
WHERE pipeline_stage = 'contract_sent';

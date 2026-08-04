-- Pipeline Stage Remap Migration
-- Maps legacy pipelineStage values (stored as labels or old keys) to new
-- standardised stage keys. Pins whose value is not in the mapping table have
-- their profileStatus set to 'Needs Stage Review' so a manager can manually
-- assign the correct new stage.
--
-- Safe to run multiple times (idempotent WHERE clauses).

-- ── Add new pins columns (idempotent) ─────────────────────────────────────────
ALTER TABLE pins ADD COLUMN IF NOT EXISTS stage_entered_at     TIMESTAMPTZ;
ALTER TABLE pins ADD COLUMN IF NOT EXISTS loop_next_action_at  TIMESTAMPTZ;
ALTER TABLE pins ADD COLUMN IF NOT EXISTS loss_reason          VARCHAR;
ALTER TABLE pins ADD COLUMN IF NOT EXISTS source_pipeline      VARCHAR;

-- ── Create stage_transitions table (idempotent) ───────────────────────────────
CREATE TABLE IF NOT EXISTS stage_transitions (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     VARCHAR NOT NULL,
  from_stage  VARCHAR,
  to_stage    VARCHAR NOT NULL,
  trigger     VARCHAR NOT NULL,
  task_payload JSONB,
  user_id     VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Remap known Insurance stage labels/old-keys → new keys ───────────────────
UPDATE pins SET pipeline_stage = 'phase1_scheduled'
  WHERE pipeline_stage IN ('Inspection Scheduled', 'inspection_scheduled')
    AND (workflow = 'insurance' OR workflow IS NULL);

UPDATE pins SET pipeline_stage = 'phase1_complete'
  WHERE pipeline_stage IN ('Damage Documented', 'damage_documented')
    AND (workflow = 'insurance' OR workflow IS NULL);

UPDATE pins SET pipeline_stage = 'proof_package'
  WHERE pipeline_stage IN (
    'Generate Claim Proof Package',
    'Create Claim Proof Package',
    'create_claim_proof_package'
  )
    AND (workflow = 'insurance' OR workflow IS NULL);

UPDATE pins SET pipeline_stage = 'contract_generated'
  WHERE pipeline_stage IN ('Generate Contract', 'generate_contract')
    AND (workflow = 'insurance' OR workflow IS NULL);

UPDATE pins SET pipeline_stage = 'claim_approved'
  WHERE pipeline_stage IN ('Claim Approved', 'claim_approved');

UPDATE pins SET pipeline_stage = 'claim_filed'
  WHERE pipeline_stage IN ('Claim Filed', 'claim_filed');

UPDATE pins SET pipeline_stage = 'adjuster_review'
  WHERE pipeline_stage IN ('Adjuster Review', 'adjuster_review');

UPDATE pins SET pipeline_stage = 'selections'
  WHERE pipeline_stage IN ('Selections', 'selections');

UPDATE pins SET pipeline_stage = 'claim_denied'
  WHERE pipeline_stage IN ('Claim Denied', 'claim_denied');

UPDATE pins SET pipeline_stage = 'public_adjuster'
  WHERE pipeline_stage IN ('Public Adjuster', 'public_adjuster');

UPDATE pins SET pipeline_stage = 'appraisal'
  WHERE pipeline_stage IN ('Appraisal', 'appraisal');

-- ── Remap known Insurance contract/deposit stages ─────────────────────────────
UPDATE pins SET pipeline_stage = 'ins_contract_signed'
  WHERE pipeline_stage IN ('Contract Signed', 'contract_signed')
    AND workflow = 'insurance';

UPDATE pins SET pipeline_stage = 'ins_deposit_received'
  WHERE pipeline_stage IN ('Deposit Received', 'deposit_received')
    AND workflow = 'insurance';

-- ── Remap known Retail stage labels → new keys ────────────────────────────────
UPDATE pins SET pipeline_stage = 'pin_dropped'
  WHERE pipeline_stage IN ('Pin Dropped', 'pin_dropped')
    AND workflow = 'retail';

UPDATE pins SET pipeline_stage = 'appt_scheduled'
  WHERE pipeline_stage IN ('Appt. Scheduled', 'Appointment Scheduled', 'appt_scheduled')
    AND workflow = 'retail';

UPDATE pins SET pipeline_stage = 'appt_confirmed'
  WHERE pipeline_stage IN ('Appt. Confirmed', 'Appointment Confirmed', 'appt_confirmed')
    AND workflow = 'retail';

UPDATE pins SET pipeline_stage = 'estimate_provided'
  WHERE pipeline_stage IN ('Estimate Provided', 'estimate_provided')
    AND workflow = 'retail';

UPDATE pins SET pipeline_stage = 'followup_required'
  WHERE pipeline_stage IN ('Follow-Up Required', 'followup_required')
    AND workflow = 'retail';

UPDATE pins SET pipeline_stage = 'contract_signed'
  WHERE pipeline_stage IN ('Contract Signed', 'contract_signed')
    AND workflow = 'retail';

UPDATE pins SET pipeline_stage = 'deposit_received'
  WHERE pipeline_stage IN ('Deposit Received', 'deposit_received')
    AND workflow = 'retail';

UPDATE pins SET pipeline_stage = 'archived_lost'
  WHERE pipeline_stage IN ('Archived – Lost', 'Archived - Lost', 'archived_lost');

-- ── Mark unrecognised values for manual review ────────────────────────────────
-- Any pin with a non-null pipelineStage that isn't one of the canonical new keys
-- gets flagged for a manager to review.
UPDATE pins
SET profile_status = 'Needs Stage Review'
WHERE pipeline_stage IS NOT NULL
  AND pipeline_stage NOT IN (
    -- Retail
    'pin_dropped', 'contact_made', 'appt_scheduled', 'appt_confirmed',
    'estimate_provided', 'followup_required', 'contract_sent', 'contract_signed',
    'deposit_received', 'archived_lost',
    -- Insurance
    'phase1_scheduled', 'phase1_complete', 'proof_package', 'contract_generated',
    'contract_sent_ins', 'ins_contract_signed', 'ins_deposit_received',
    'claim_filed', 'adjuster_meeting', 'adjuster_review', 'claim_approved',
    'selections', 'claim_denied', 'public_adjuster', 'appraisal',
    -- Project
    'work_scheduled', 'materials_ordered', 'work_started', 'replacement_complete',
    'certificate_of_completion', 'final_payment_pending', 'final_payment_received',
    'archived_complete'
  )
  AND (profile_status IS NULL OR profile_status != 'Needs Stage Review');

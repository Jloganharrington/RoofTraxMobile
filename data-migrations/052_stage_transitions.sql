-- Migration 052: Pipeline stage transitions table and pins staging columns
--
-- Added by the pipeline rebuild that introduced pipelineStage tracking.
-- These objects were defined in the Drizzle schema (lib/db/src/schema/) but
-- never applied to the live database, causing runtime 500s in any route that
-- calls advancePinStage() or emitPipelineEvent(), and breaking all
-- pipeline-auto-advance.test.ts tests with "relation does not exist".
--
-- Safe to re-run: every statement is idempotent.

-- ── Pins staging columns ────────────────────────────────────────────────────
ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS stage_entered_at      timestamptz,
  ADD COLUMN IF NOT EXISTS loop_next_action_at   timestamptz,
  ADD COLUMN IF NOT EXISTS loss_reason           varchar,
  ADD COLUMN IF NOT EXISTS source_pipeline       varchar;

-- ── Stage transitions audit table ──────────────────────────────────────────
-- Every pipeline stage advance (manual or auto-event) is recorded here.
-- Referenced by advancePinStage() in artifacts/api-server/src/routes/pipelineEvents.ts.
CREATE TABLE IF NOT EXISTS stage_transitions (
  id           varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      varchar       NOT NULL,
  from_stage   varchar,
  to_stage     varchar       NOT NULL,
  trigger      varchar       NOT NULL,
  task_payload jsonb,
  user_id      varchar       REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_transitions_lead_id
  ON stage_transitions (lead_id, created_at DESC);

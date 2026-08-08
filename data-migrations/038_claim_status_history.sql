-- Claim-status change history — migration 038.
-- Applied 2026-08-08.
--
-- pins.claim_status is a mutable varchar with no prior history log.
-- stage_transitions records pipelineStage moves, which is a different
-- vocabulary. There is no retroactive source for claim-status changes,
-- so this table logs going-forward only. The application layer writes a
-- row in the SAME transaction as every pins.claim_status update, with a
-- no-op guard so setting the SAME status again produces no row.
--
-- Intentionally NO BACKFILL — fabricated historical timestamps would be
-- misleading. The feed UI explains this in its empty-state copy.

CREATE TABLE IF NOT EXISTS claim_status_history (
  id                  VARCHAR         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          VARCHAR         NOT NULL REFERENCES companies(id),
  pin_id              VARCHAR         NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  from_status         VARCHAR,        -- null on first-ever set
  to_status           VARCHAR         NOT NULL,
  changed_by_user_id  VARCHAR         NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_status_history_company_created_at
  ON claim_status_history (company_id, created_at);

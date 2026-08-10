-- Migration 042: completion certificates + change order carrier-reimbursable flag
--
-- 1. change_orders.carrier_reimbursable — controls whether an approved,
--    non-voided CO appears on the COC as its own section.
--
-- 2. completion_certificates — one per claim_approved pin per compile cycle.
--    status: draft → signed → voided (never hard-deleted).
--    line_items jsonb snapshot: { baseContract, pwi, dropped }.
--    Once signed the snapshot is immutable; corrections void + reissue.

ALTER TABLE change_orders
  ADD COLUMN IF NOT EXISTS carrier_reimbursable BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS completion_certificates (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           VARCHAR NOT NULL REFERENCES companies(id),
  pin_id               VARCHAR NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  contract_id          VARCHAR REFERENCES contracts(id),
  status               VARCHAR NOT NULL DEFAULT 'draft',
  document_object_path TEXT,
  document_sha256      TEXT,
  signed_by_user_id    VARCHAR REFERENCES users(id),
  signed_at            TIMESTAMPTZ,
  signer_title         TEXT,
  line_items           JSONB,
  created_by_user_id   VARCHAR NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS completion_certificates_pin_id_idx
  ON completion_certificates(pin_id);
CREATE INDEX IF NOT EXISTS completion_certificates_company_id_idx
  ON completion_certificates(company_id);

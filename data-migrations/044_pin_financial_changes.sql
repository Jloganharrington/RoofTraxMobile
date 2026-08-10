-- Migration 044: pin_financial_changes
-- Purpose-built audit log for financial field edits on pins.
-- Matches the existing pattern: stage_transitions (pipeline), report_attestations (report sign-off).
-- Company-scoped directly — no join needed for tenancy.
-- Consumer: Financials surface ("contract value changed from X to Y by Z on <date>").

CREATE TABLE IF NOT EXISTS pin_financial_changes (
  id                  VARCHAR     PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id          VARCHAR     NOT NULL REFERENCES companies(id),
  pin_id              VARCHAR     NOT NULL REFERENCES pins(id),
  field               TEXT        NOT NULL CHECK (field IN ('contract_amount', 'deductible_amount', 'rcv_amount')),
  old_value           TEXT,
  new_value           TEXT,
  changed_by_user_id  VARCHAR     NOT NULL REFERENCES users(id),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason              TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS pin_financial_changes_pin_id_idx     ON pin_financial_changes(pin_id);
CREATE INDEX IF NOT EXISTS pin_financial_changes_company_id_idx ON pin_financial_changes(company_id);

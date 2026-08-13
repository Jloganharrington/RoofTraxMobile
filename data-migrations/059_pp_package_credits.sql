-- Migration 059: PP per-package payment credits
--
-- Tracks which inspections a PP-only subscriber has paid for.
-- A row here = payment confirmed; the compile route gates on this for pp_only companies.
-- Recompilation is free once the credit row exists (UPSERT is idempotent).

CREATE TABLE IF NOT EXISTS pp_package_credits (
  id                      TEXT        PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  company_id              TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inspection_id           TEXT        NOT NULL,
  stripe_payment_intent_id TEXT       NOT NULL,
  paid_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pp_package_credits_company_inspection_idx
  ON pp_package_credits(company_id, inspection_id);

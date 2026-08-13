-- Migration 060: pp_pending_checkouts
-- Tracks in-flight Stripe Checkout Sessions per (company_id, inspection_id)
-- so repeat calls reuse the same session instead of creating a new charge.
CREATE TABLE IF NOT EXISTS pp_pending_checkouts (
  id                TEXT        PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  company_id        TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inspection_id     TEXT        NOT NULL,
  stripe_session_id TEXT        NOT NULL,
  session_url       TEXT        NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pp_pending_checkouts_company_inspection_idx
  ON pp_pending_checkouts(company_id, inspection_id);

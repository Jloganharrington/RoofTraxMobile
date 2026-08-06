-- 023_payments_ledger.sql
-- Step 1: Payments ledger for per-lead financial tracking.
-- Creates the `payments` table and backfills four legacy varchar money columns
-- from `pins`. Backfill is idempotent: deterministic IDs prevent re-runs from
-- creating duplicate rows.
--
-- Idempotency guarantee: each backfill row gets a deterministic id derived from
--   md5(pin_id || ':' || type || ':backfill_v1')
-- ON CONFLICT (id) DO NOTHING means re-running this script inserts zero rows.

-- ─── TABLE ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id                   varchar          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           varchar          NOT NULL REFERENCES companies(id),
  pin_id               varchar          NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  type                 varchar          NOT NULL,
  amount_cents         integer          NOT NULL,
  method               varchar,
  payment_date         timestamptz      NOT NULL,
  notes                text,
  customer_invoice_id  varchar,          -- FK added in migration 024
  created_by_user_id   varchar          NOT NULL REFERENCES users(id),
  created_at           timestamptz      NOT NULL DEFAULT now(),
  updated_at           timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_company_date_idx
  ON payments (company_id, payment_date);

-- ─── PARSING HELPER ──────────────────────────────────────────────────────────
-- Parses a dirty legacy money string to integer cents.
-- Strips $, commas, and interior whitespace; multiplies by 100 and ROUNDS
-- (never truncates). Returns NULL for nulls, blank strings, non-numeric
-- values, and zero amounts.

CREATE OR REPLACE FUNCTION _parse_legacy_money_cents(raw text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN raw IS NULL OR TRIM(raw) = '' THEN NULL
      WHEN stripped ~ '^[0-9]+(\.[0-9]+)?$' AND ROUND(stripped::numeric * 100) > 0
      THEN ROUND(stripped::numeric * 100)::integer
      ELSE NULL
    END
  FROM (
    SELECT REGEXP_REPLACE(TRIM(raw), '[$,\s]', '', 'g') AS stripped
  ) t
$$;

-- ─── BACKFILL ────────────────────────────────────────────────────────────────
-- Column mapping:
--   deposit_amount       → type 'deposit',    date = deposit_date ?? created_at
--   acv_amount           → type 'acv',        date = created_at
--   supplement_amount    → type 'supplement', date = created_at
--   final_payment_amount → type 'final',      date = created_at
--
-- Legacy pins columns are left untouched — they stay as read-only backfill
-- sources; retiring them is a later decision.

INSERT INTO payments
  (id, company_id, pin_id, type, amount_cents, payment_date, notes, created_by_user_id)
SELECT
  md5(p.id || ':deposit:backfill_v1'),
  p.company_id,
  p.id,
  'deposit',
  c.cents,
  COALESCE(p.deposit_date, p.created_at),
  'backfill:legacy_deposit_amount',
  p.user_id
FROM pins p,
  LATERAL (SELECT _parse_legacy_money_cents(p.deposit_amount) AS cents) c
WHERE c.cents IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments
  (id, company_id, pin_id, type, amount_cents, payment_date, notes, created_by_user_id)
SELECT
  md5(p.id || ':acv:backfill_v1'),
  p.company_id,
  p.id,
  'acv',
  c.cents,
  p.created_at,
  'backfill:legacy_acv_amount',
  p.user_id
FROM pins p,
  LATERAL (SELECT _parse_legacy_money_cents(p.acv_amount) AS cents) c
WHERE c.cents IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments
  (id, company_id, pin_id, type, amount_cents, payment_date, notes, created_by_user_id)
SELECT
  md5(p.id || ':supplement:backfill_v1'),
  p.company_id,
  p.id,
  'supplement',
  c.cents,
  p.created_at,
  'backfill:legacy_supplement_amount',
  p.user_id
FROM pins p,
  LATERAL (SELECT _parse_legacy_money_cents(p.supplement_amount) AS cents) c
WHERE c.cents IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments
  (id, company_id, pin_id, type, amount_cents, payment_date, notes, created_by_user_id)
SELECT
  md5(p.id || ':final:backfill_v1'),
  p.company_id,
  p.id,
  'final',
  c.cents,
  p.created_at,
  'backfill:legacy_final_payment_amount',
  p.user_id
FROM pins p,
  LATERAL (SELECT _parse_legacy_money_cents(p.final_payment_amount) AS cents) c
WHERE c.cents IS NOT NULL
ON CONFLICT (id) DO NOTHING;

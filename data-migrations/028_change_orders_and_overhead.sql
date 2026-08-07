-- =============================================================================
-- Migration 028 — Change Orders + Overhead Paid-Date Columns (Step 5)
-- =============================================================================
-- 1. New `change_orders` table (amount_cents may be negative for deductive COs)
-- 2. New per-lead overhead tracking columns on pins:
--    canvassing_commission_cents / _paid_date (new overhead line)
--    referral_fee_paid_date                   (referral had amount but no paid date)
--    lead_acquisition_paid_date               (lead-acq had amount but no paid date)
-- Every overhead line now has the shape: amount_cents + paid_date.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. change_orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_orders (
  id                  varchar        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          varchar        NOT NULL REFERENCES companies(id),
  pin_id              varchar        NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  description         text           NOT NULL,
  -- amount_cents MAY BE NEGATIVE: deductive change orders (scope reductions)
  -- are real and common. No positive-only constraint.
  amount_cents        integer        NOT NULL,
  -- pending | approved | rejected
  status              varchar        NOT NULL DEFAULT 'pending',
  -- Set server-side to NOW() when status transitions to 'approved'.
  -- Cleared (NULL) when status transitions away from 'approved'.
  approved_at         timestamptz,
  created_by_user_id  varchar        NOT NULL REFERENCES users(id),
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_orders_company_pin
  ON change_orders(company_id, pin_id);

-- ---------------------------------------------------------------------------
-- 2. New overhead columns on pins
-- ---------------------------------------------------------------------------
ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS canvassing_commission_cents      integer,
  ADD COLUMN IF NOT EXISTS canvassing_commission_paid_date  timestamptz,
  ADD COLUMN IF NOT EXISTS referral_fee_paid_date           timestamptz,
  ADD COLUMN IF NOT EXISTS lead_acquisition_paid_date       timestamptz;

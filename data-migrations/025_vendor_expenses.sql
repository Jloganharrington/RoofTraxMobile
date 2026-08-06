-- Migration 025 — Vendor Expenses + Commission Columns
--
-- Creates vendor_expenses table for cost tracking.
-- Adds per-lead commission + acquisition cost columns to pins (integer cents).
-- Commission columns are manager-only — NOT writable via the generic pin PATCH.
--
-- Idempotent: all DDL guarded with IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS vendor_expenses (
  id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       varchar NOT NULL REFERENCES companies(id),
  pin_id           varchar NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  vendor_name      varchar NOT NULL,
  invoice_number   varchar,
  invoice_date     timestamptz,
  amount_cents     integer NOT NULL,
  category         varchar NOT NULL,   -- materials|labor|subcontractor|equipment|other
  description      text,
  document_url     text,
  is_paid          boolean NOT NULL DEFAULT false,
  paid_date        timestamptz,        -- set server-side by mark-paid endpoint
  due_date         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_expenses_company_pin_idx
  ON vendor_expenses (company_id, pin_id);

-- Commission + acquisition cost columns on pins (all integer cents, nullable).
-- These are per-lead single values — NOT a ledger table.
-- They must only be written via PATCH /pins/:pinId/commissions (manager+).
ALTER TABLE pins ADD COLUMN IF NOT EXISTS lead_acquisition_cost_cents integer;
ALTER TABLE pins ADD COLUMN IF NOT EXISTS referral_fee_cents           integer;
ALTER TABLE pins ADD COLUMN IF NOT EXISTS sales_commission_cents       integer;
ALTER TABLE pins ADD COLUMN IF NOT EXISTS sales_commission_paid_date   timestamptz;
ALTER TABLE pins ADD COLUMN IF NOT EXISTS pm_commission_cents          integer;
ALTER TABLE pins ADD COLUMN IF NOT EXISTS pm_commission_paid_date      timestamptz;

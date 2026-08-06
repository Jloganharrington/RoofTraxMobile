-- Migration 026 — Profitability View
--
-- Creates a non-materialized view `pin_profitability` that aggregates every
-- financial dimension of a lead into a single queryable row.  All money is
-- integer cents.
--
-- Revenue:
--   total_payments_cents       — sum of all ledger payments (payments table)
--   invoice_total_cents        — sum of all non-void invoice amounts
--   invoice_paid_cents         — sum of paid invoice amounts
--
-- Vendor Expenses:
--   total_expense_cents        — sum of all vendor_expenses rows
--   paid_expense_cents         — sum of paid vendor_expenses
--   outstanding_expense_cents  — sum of unpaid vendor_expenses
--
-- Commissions / Acquisition:
--   lead_acquisition_cost_cents
--   referral_fee_cents
--   sales_commission_cents
--   pm_commission_cents
--   total_commission_cents     — sum of the four above
--
-- Derived:
--   total_cost_cents           — total_expense_cents + total_commission_cents
--   net_profit_cents           — total_payments_cents - total_cost_cents
--
-- The view is a pure SELECT — idempotent on re-run (CREATE OR REPLACE).

CREATE OR REPLACE VIEW pin_profitability AS
SELECT
  p.id                                                          AS pin_id,
  p.company_id,

  -- ── Revenue ──────────────────────────────────────────────────────────────
  COALESCE(pay_agg.total_payments_cents,      0)                AS total_payments_cents,
  COALESCE(inv_agg.invoice_total_cents,       0)                AS invoice_total_cents,
  COALESCE(inv_agg.invoice_paid_cents,        0)                AS invoice_paid_cents,

  -- ── Vendor Expenses ───────────────────────────────────────────────────────
  COALESCE(exp_agg.total_expense_cents,       0)                AS total_expense_cents,
  COALESCE(exp_agg.paid_expense_cents,        0)                AS paid_expense_cents,
  COALESCE(exp_agg.outstanding_expense_cents, 0)                AS outstanding_expense_cents,

  -- ── Commissions (per-lead single-value columns) ───────────────────────────
  COALESCE(p.lead_acquisition_cost_cents,     0)                AS lead_acquisition_cost_cents,
  COALESCE(p.referral_fee_cents,              0)                AS referral_fee_cents,
  COALESCE(p.sales_commission_cents,          0)                AS sales_commission_cents,
  COALESCE(p.pm_commission_cents,             0)                AS pm_commission_cents,

  -- ── Derived totals ────────────────────────────────────────────────────────
  COALESCE(p.lead_acquisition_cost_cents, 0)
    + COALESCE(p.referral_fee_cents,       0)
    + COALESCE(p.sales_commission_cents,   0)
    + COALESCE(p.pm_commission_cents,      0)                   AS total_commission_cents,

  COALESCE(exp_agg.total_expense_cents, 0)
    + COALESCE(p.lead_acquisition_cost_cents, 0)
    + COALESCE(p.referral_fee_cents,           0)
    + COALESCE(p.sales_commission_cents,       0)
    + COALESCE(p.pm_commission_cents,          0)               AS total_cost_cents,

  COALESCE(pay_agg.total_payments_cents, 0) - (
    COALESCE(exp_agg.total_expense_cents,     0)
    + COALESCE(p.lead_acquisition_cost_cents, 0)
    + COALESCE(p.referral_fee_cents,           0)
    + COALESCE(p.sales_commission_cents,       0)
    + COALESCE(p.pm_commission_cents,          0)
  )                                                             AS net_profit_cents

FROM pins p

-- Payments ledger aggregate
LEFT JOIN (
  SELECT pin_id,
         SUM(amount_cents) AS total_payments_cents
  FROM   payments
  GROUP  BY pin_id
) pay_agg ON pay_agg.pin_id = p.id

-- Customer invoice aggregate (exclude void)
LEFT JOIN (
  SELECT pin_id,
         SUM(amount_cents)                              AS invoice_total_cents,
         SUM(amount_cents) FILTER (WHERE status='paid') AS invoice_paid_cents
  FROM   customer_invoices
  WHERE  status <> 'void'
  GROUP  BY pin_id
) inv_agg ON inv_agg.pin_id = p.id

-- Vendor expense aggregate
LEFT JOIN (
  SELECT pin_id,
         SUM(amount_cents)                                  AS total_expense_cents,
         SUM(amount_cents) FILTER (WHERE is_paid = true)    AS paid_expense_cents,
         SUM(amount_cents) FILTER (WHERE is_paid = false)   AS outstanding_expense_cents
  FROM   vendor_expenses
  GROUP  BY pin_id
) exp_agg ON exp_agg.pin_id = p.id;

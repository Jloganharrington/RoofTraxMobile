-- Migration 027 — Profitability View: expected_total_cents + both margin pcts
--
-- Adds three columns to the pin_profitability view (CREATE OR REPLACE):
--
--   expected_total_cents:
--     insurance leads → GREATEST(contract_amount_cents, approved_rcv_cents)
--       so that an insurance job with approvedRcv > contract uses the higher
--       figure as the projected revenue baseline (the correct denominator for
--       projected margin).
--     retail leads → contract_amount_cents
--     Both varchar columns are parsed via _parse_legacy_money_cents (migration 023).
--
--   cash_margin_pct:
--     (total_payments_cents − total_cost_cents) / total_payments_cents × 100
--     Returns 0 when total_payments_cents = 0 (never NaN / Infinity / null).
--
--   projected_margin_pct:
--     (expected_total_cents − total_cost_cents) / expected_total_cents × 100
--     Returns 0 when expected_total_cents = 0 (never NaN / Infinity / null).
--
-- The two margin pairs exist to fix a specific defect: a job that is 60%
-- collected but fully expensed reads as unprofitable on cash alone.
-- Projected margin against expected_total_cents shows the true picture.
--
-- The view is restructured as a CTE + outer SELECT so that the derived
-- `total_cost_cents` and `expected_total_cents` can be referenced in the
-- margin expressions without repeating the full subexpressions.
-- All existing columns are preserved in the same order.

CREATE OR REPLACE VIEW pin_profitability AS
WITH raw AS (
  SELECT
    p.id                                                            AS pin_id,
    p.company_id,

    -- ── Revenue ────────────────────────────────────────────────────────────
    COALESCE(pay_agg.total_payments_cents,      0)                  AS total_payments_cents,
    COALESCE(inv_agg.invoice_total_cents,       0)                  AS invoice_total_cents,
    COALESCE(inv_agg.invoice_paid_cents,        0)                  AS invoice_paid_cents,

    -- ── Vendor Expenses ────────────────────────────────────────────────────
    COALESCE(exp_agg.total_expense_cents,       0)                  AS total_expense_cents,
    COALESCE(exp_agg.paid_expense_cents,        0)                  AS paid_expense_cents,
    COALESCE(exp_agg.outstanding_expense_cents, 0)                  AS outstanding_expense_cents,

    -- ── Commissions (per-lead single-value columns) ────────────────────────
    COALESCE(p.lead_acquisition_cost_cents,     0)                  AS lead_acquisition_cost_cents,
    COALESCE(p.referral_fee_cents,              0)                  AS referral_fee_cents,
    COALESCE(p.sales_commission_cents,          0)                  AS sales_commission_cents,
    COALESCE(p.pm_commission_cents,             0)                  AS pm_commission_cents,

    -- ── Total commission (sum of four) ────────────────────────────────────
    COALESCE(p.lead_acquisition_cost_cents, 0)
      + COALESCE(p.referral_fee_cents,       0)
      + COALESCE(p.sales_commission_cents,   0)
      + COALESCE(p.pm_commission_cents,      0)                     AS total_commission_cents,

    -- ── Total cost = expenses + commissions ───────────────────────────────
    COALESCE(exp_agg.total_expense_cents, 0)
      + COALESCE(p.lead_acquisition_cost_cents, 0)
      + COALESCE(p.referral_fee_cents,           0)
      + COALESCE(p.sales_commission_cents,       0)
      + COALESCE(p.pm_commission_cents,          0)                 AS total_cost_cents,

    -- ── Expected total revenue (insurance uses GREATEST of contract/RCV) ──
    CASE
      WHEN p.workflow = 'insurance'
      THEN GREATEST(
        COALESCE(_parse_legacy_money_cents(p.contract_amount),      0),
        COALESCE(_parse_legacy_money_cents(p.approved_rcv_amount),  0)
      )
      ELSE COALESCE(_parse_legacy_money_cents(p.contract_amount),   0)
    END                                                             AS expected_total_cents

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
           SUM(amount_cents)                               AS invoice_total_cents,
           SUM(amount_cents) FILTER (WHERE status='paid')  AS invoice_paid_cents
    FROM   customer_invoices
    WHERE  status <> 'void'
    GROUP  BY pin_id
  ) inv_agg ON inv_agg.pin_id = p.id

  -- Vendor expense aggregate
  LEFT JOIN (
    SELECT pin_id,
           SUM(amount_cents)                                   AS total_expense_cents,
           SUM(amount_cents) FILTER (WHERE is_paid = true)     AS paid_expense_cents,
           SUM(amount_cents) FILTER (WHERE is_paid = false)    AS outstanding_expense_cents
    FROM   vendor_expenses
    GROUP  BY pin_id
  ) exp_agg ON exp_agg.pin_id = p.id
)
SELECT
  pin_id,
  company_id,

  -- Revenue
  total_payments_cents,
  invoice_total_cents,
  invoice_paid_cents,

  -- Vendor Expenses
  total_expense_cents,
  paid_expense_cents,
  outstanding_expense_cents,

  -- Commissions
  lead_acquisition_cost_cents,
  referral_fee_cents,
  sales_commission_cents,
  pm_commission_cents,
  total_commission_cents,

  -- Derived totals
  total_cost_cents,
  total_payments_cents - total_cost_cents                           AS net_profit_cents,

  -- ── NEW: Expected revenue baseline ────────────────────────────────────
  expected_total_cents,

  -- ── NEW: Cash margin (payments already received vs costs) ─────────────
  -- Guard: returns 0 (not NaN/null) when no payments yet.
  CASE
    WHEN total_payments_cents > 0
    THEN (total_payments_cents - total_cost_cents)::numeric
           / total_payments_cents * 100
    ELSE 0::numeric
  END                                                               AS cash_margin_pct,

  -- ── NEW: Projected margin (expected total revenue vs costs) ───────────
  -- Guard: returns 0 (not NaN/null) when expected_total_cents = 0.
  CASE
    WHEN expected_total_cents > 0
    THEN (expected_total_cents - total_cost_cents)::numeric
           / expected_total_cents * 100
    ELSE 0::numeric
  END                                                               AS projected_margin_pct

FROM raw;

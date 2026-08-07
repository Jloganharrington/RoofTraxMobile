-- =============================================================================
-- Migration 029 — Project Financials Restructure: Profitability View Rewrite
--                 (FINANCIALS STEP 5, Step 2 of 3)
-- =============================================================================
--
-- Converts the P&L from CASH basis (collected − costs) to ACCRUAL basis
-- (revised contract − COGS − overhead).
--
-- Changes vs the migration-030 view:
--   2a. revised_contract_cents = _parse_legacy_money_cents(contract_amount)
--                                + approved_co_cents
--       Previously used expected_total + approved_co_cents, which was wrong
--       for insurance leads where expected_total = GREATEST(contract, rcv).
--
--   2b. total_cost_cents includes canvassing_commission_cents.
--       (Also fixed in migration 030 — preserved and correct here.)
--
--   2c. expected_total_cents now uses revised_contract_cents as the baseline:
--         insurance → GREATEST(revised_contract_cents, approved_rcv_cents)
--         retail    → revised_contract_cents
--       A CO that raises the contract must raise the projected revenue baseline.
--
--   2d. net_project_margin_pct added (NEW — appended at position 23).
--       projected_margin_pct (position 18) is KEPT for column-order compat
--       but removed from the API response per Step 2d of the work order.
--
-- Type note: PostgreSQL SUM(integer) returns bigint, so approved_co_cents is
-- bigint, and revised_contract_cents (base_contract + approved_co) is bigint.
-- expected_total_cents (position 16) was integer in migrations 026-030 and
-- must stay integer → cast to ::int in the final projection.
-- revised_contract_cents (position 21) and net_project_margin_cents (22) were
-- bigint in migration 030 and remain bigint here.
--
-- Column order (existing positions must be preserved):
--   1  pin_id                       (026)
--   2  company_id                   (026)
--   3  total_payments_cents         (026)
--   4  invoice_total_cents          (026)
--   5  invoice_paid_cents           (026)
--   6  total_expense_cents          (026)
--   7  paid_expense_cents           (026)
--   8  outstanding_expense_cents    (026)
--   9  lead_acquisition_cost_cents  (026)
--   10 referral_fee_cents           (026)
--   11 sales_commission_cents       (026)
--   12 pm_commission_cents          (026)
--   13 total_commission_cents       (026)
--   14 total_cost_cents             (026)
--   15 net_profit_cents             (026)
--   16 expected_total_cents         (027) integer ← formula changed (2c)
--   17 cash_margin_pct              (027) numeric
--   18 projected_margin_pct         (027) numeric ← formula updated; not in API
--   19 canvassing_commission_cents  (030) integer
--   20 approved_co_cents            (030) bigint
--   21 revised_contract_cents       (030) bigint ← formula corrected (2a)
--   22 net_project_margin_cents     (030) bigint ← now uses corrected revised
--   23 net_project_margin_pct       (029) numeric ← NEW
-- =============================================================================

CREATE OR REPLACE VIEW pin_profitability AS

-- Step 1 — raw aggregates from all joined tables.
WITH agg AS (
  SELECT
    p.id                                                              AS pin_id,
    p.company_id,
    p.workflow,

    -- ── Revenue ──────────────────────────────────────────────────────────
    COALESCE(pay_agg.total_payments_cents,      0)                    AS total_payments_cents,
    COALESCE(inv_agg.invoice_total_cents,       0)                    AS invoice_total_cents,
    COALESCE(inv_agg.invoice_paid_cents,        0)                    AS invoice_paid_cents,

    -- ── Vendor Expenses (COGS) ────────────────────────────────────────────
    COALESCE(exp_agg.total_expense_cents,       0)                    AS total_expense_cents,
    COALESCE(exp_agg.paid_expense_cents,        0)                    AS paid_expense_cents,
    COALESCE(exp_agg.outstanding_expense_cents, 0)                    AS outstanding_expense_cents,

    -- ── Job Overhead (five per-lead lines on pins) ────────────────────────
    COALESCE(p.lead_acquisition_cost_cents,     0)                    AS lead_acquisition_cost_cents,
    COALESCE(p.referral_fee_cents,              0)                    AS referral_fee_cents,
    COALESCE(p.sales_commission_cents,          0)                    AS sales_commission_cents,
    COALESCE(p.pm_commission_cents,             0)                    AS pm_commission_cents,
    COALESCE(p.canvassing_commission_cents,     0)                    AS canvassing_commission_cents,

    -- ── Approved change orders (approved + non-voided only) ──────────────
    -- SUM(integer) → bigint in PostgreSQL; preserved as bigint (see type note)
    COALESCE(co_agg.approved_co_cents,          0)                    AS approved_co_cents,

    -- ── Parsed contract values ────────────────────────────────────────────
    COALESCE(_parse_legacy_money_cents(p.contract_amount),     0)     AS base_contract_cents,
    COALESCE(_parse_legacy_money_cents(p.approved_rcv_amount), 0)     AS approved_rcv_cents

  FROM pins p

  LEFT JOIN (
    SELECT pin_id, SUM(amount_cents) AS total_payments_cents
    FROM   payments
    GROUP  BY pin_id
  ) pay_agg ON pay_agg.pin_id = p.id

  LEFT JOIN (
    SELECT pin_id,
           SUM(amount_cents)                               AS invoice_total_cents,
           SUM(amount_cents) FILTER (WHERE status='paid')  AS invoice_paid_cents
    FROM   customer_invoices
    WHERE  status <> 'void'
    GROUP  BY pin_id
  ) inv_agg ON inv_agg.pin_id = p.id

  LEFT JOIN (
    SELECT pin_id,
           SUM(amount_cents)                                 AS total_expense_cents,
           SUM(amount_cents) FILTER (WHERE is_paid = true)   AS paid_expense_cents,
           SUM(amount_cents) FILTER (WHERE is_paid = false)  AS outstanding_expense_cents
    FROM   vendor_expenses
    GROUP  BY pin_id
  ) exp_agg ON exp_agg.pin_id = p.id

  LEFT JOIN (
    SELECT pin_id, SUM(amount_cents) AS approved_co_cents
    FROM   change_orders
    WHERE  status    = 'approved'
      AND  voided_at IS NULL
    GROUP  BY pin_id
  ) co_agg ON co_agg.pin_id = p.id
),

-- Step 2 — totals and revised_contract.
calc AS (
  SELECT
    *,

    -- Total overhead (all five lines; canvassing included since migration 028)
    lead_acquisition_cost_cents
      + referral_fee_cents
      + sales_commission_cents
      + pm_commission_cents
      + canvassing_commission_cents                                    AS total_commission_cents,

    -- Total cost = COGS + all five overhead lines.
    -- MUST equal the Expense Tracker total for the same pin.
    total_expense_cents
      + lead_acquisition_cost_cents
      + referral_fee_cents
      + sales_commission_cents
      + pm_commission_cents
      + canvassing_commission_cents                                    AS total_cost_cents,

    -- ★ REVISED CONTRACT (accrual basis) = base contract + approved COs only.
    -- Pending and rejected COs are excluded. Result is bigint (int + bigint).
    base_contract_cents + approved_co_cents                            AS revised_contract_cents

  FROM agg
),

-- Step 3 — expected_total using revised_contract as the baseline.
-- Cast to ::int to preserve the integer type that position 16 has had since
-- migration 027 (PostgreSQL CREATE OR REPLACE VIEW prohibits type widening).
final AS (
  SELECT
    *,
    (CASE
      WHEN workflow = 'insurance'
      THEN GREATEST(revised_contract_cents, approved_rcv_cents)
      ELSE revised_contract_cents
    END)::int                                                          AS expected_total_cents
  FROM calc
)

-- Final projection — all columns in exact historical position order.
SELECT
  -- ── 1-2: identifiers ──────────────────────────────────────────────────
  pin_id,
  company_id,

  -- ── 3-5: revenue ──────────────────────────────────────────────────────
  total_payments_cents,
  invoice_total_cents,
  invoice_paid_cents,

  -- ── 6-8: vendor expenses (COGS) ───────────────────────────────────────
  total_expense_cents,
  paid_expense_cents,
  outstanding_expense_cents,

  -- ── 9-12: individual overhead lines ──────────────────────────────────
  lead_acquisition_cost_cents,
  referral_fee_cents,
  sales_commission_cents,
  pm_commission_cents,

  -- ── 13: total overhead (five lines) ──────────────────────────────────
  total_commission_cents,

  -- ── 14: total cost = COGS + overhead ──────────────────────────────────
  total_cost_cents,

  -- ── 15: cash net profit (total collected − costs; unchanged) ──────────
  total_payments_cents - total_cost_cents                             AS net_profit_cents,

  -- ── 16: expected total — integer (★ now uses revised_contract as base) ─
  -- ::int cast preserves the column type from migration 027/030.
  expected_total_cents,

  -- ── 17: cash margin % (payments-vs-costs; unchanged) ──────────────────
  CASE
    WHEN total_payments_cents > 0
    THEN (total_payments_cents - total_cost_cents)::numeric
           / total_payments_cents * 100
    ELSE 0::numeric
  END                                                                 AS cash_margin_pct,

  -- ── 18: projected margin % (expected-vs-costs; kept for col-position
  --    compat; removed from API response per Step 2d of the work order) ──
  CASE
    WHEN expected_total_cents > 0
    THEN (expected_total_cents - total_cost_cents)::numeric
           / expected_total_cents * 100
    ELSE 0::numeric
  END                                                                 AS projected_margin_pct,

  -- ── 19-20: columns appended in migration 030 ──────────────────────────
  canvassing_commission_cents,
  approved_co_cents,

  -- ── 21: revised contract bigint (★ formula corrected per 2a) ──────────
  revised_contract_cents,

  -- ── 22: net project margin $ bigint (★ uses corrected revised_contract) ─
  revised_contract_cents - total_cost_cents                           AS net_project_margin_cents,

  -- ── 23: net project margin % — NEW in this migration ─────────────────
  -- Guard: returns 0, never NaN/Infinity/null when revised_contract = 0.
  CASE
    WHEN revised_contract_cents > 0
    THEN (revised_contract_cents - total_cost_cents)::numeric
           / revised_contract_cents * 100
    ELSE 0::numeric
  END                                                                 AS net_project_margin_pct

FROM final;

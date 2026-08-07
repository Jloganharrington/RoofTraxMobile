-- =============================================================================
-- Migration 032 — Insurance analytics: new pin columns + extended profitability view
-- =============================================================================
--
-- Part 1: Four new columns on pins table
--   claim_status             varchar NULL — validated server-side against allowed list
--   adjuster_last_contact    timestamptz NULL — when carrier/adjuster last made contact
--   betterments_amount_cents integer NULL — carrier-asserted betterments deduction (cents)
--   supplement_notes         text NULL — free-form notes for the supplement conversation
--
-- Part 2: Extend pin_profitability view (CREATE OR REPLACE)
--   Column positions 1–23 are PRESERVED EXACTLY from migration 029.
--   Appends columns 24–30 for insurance/claim analytics.
--
--   24  deductible_collected_cents  SUM(payments.amount_cents) WHERE type='deductible'
--   25  policy_deductible_cents     _parse_legacy_money_cents(deductible_amount)
--   26  approved_acv_cents          _parse_legacy_money_cents(approved_acv_amount)
--   27  supplement_candidate_cents  SUM approved+non-voided COs WHERE required_to_complete_scope
--   28  depreciation_cents          approved_rcv_cents − approved_acv_cents
--   29  claim_variance_cents        approved_rcv_cents − revised_contract_cents
--                                   (negative = SHORT, supplement may be needed)
--   30  base_scope_cents            revised_contract_cents − betterments_amount_cents
--
-- Type note: SUM(integer) → bigint in Postgres; claim_variance_cents and
--   base_scope_cents are bigint (mix of bigint revised_contract + integer operands).
--   The n() coercion helper in profitability.ts covers bigint → JS number.
--   All division is guarded against zero — percentages return 0, never NaN.
-- =============================================================================

-- Part 1: New columns
ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS claim_status            varchar,
  ADD COLUMN IF NOT EXISTS adjuster_last_contact   timestamptz,
  ADD COLUMN IF NOT EXISTS betterments_amount_cents integer,
  ADD COLUMN IF NOT EXISTS supplement_notes        text;

-- Part 2: Extended view (full CREATE OR REPLACE — preserves positions 1-23)
CREATE OR REPLACE VIEW pin_profitability AS

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
    -- SUM(integer) → bigint in PostgreSQL; preserved as bigint.
    COALESCE(co_agg.approved_co_cents,          0)                    AS approved_co_cents,

    -- ── Parsed contract / RCV values (legacy varchar → cents) ────────────
    COALESCE(_parse_legacy_money_cents(p.contract_amount),      0)    AS base_contract_cents,
    COALESCE(_parse_legacy_money_cents(p.approved_rcv_amount),  0)    AS approved_rcv_cents,

    -- ── Insurance analytics (NEW in migration 032) ────────────────────────
    -- ACV and deductible are legacy varchar columns parsed the same way as RCV.
    COALESCE(_parse_legacy_money_cents(p.approved_acv_amount),  0)    AS approved_acv_cents,
    COALESCE(_parse_legacy_money_cents(p.deductible_amount),    0)    AS policy_deductible_cents,
    -- betterments_amount_cents is a proper integer column (not legacy varchar).
    COALESCE(p.betterments_amount_cents,                        0)    AS betterments_amount_cents,
    -- Deductible payments only (type = 'deductible').
    COALESCE(deduct_agg.deductible_collected_cents,             0)    AS deductible_collected_cents,
    -- Approved + non-voided COs flagged as required to complete original scope.
    COALESCE(supp_agg.supplement_candidate_cents,               0)    AS supplement_candidate_cents

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

  -- NEW in 032: deductible payment type only
  LEFT JOIN (
    SELECT pin_id, SUM(amount_cents) AS deductible_collected_cents
    FROM   payments
    WHERE  type = 'deductible'
    GROUP  BY pin_id
  ) deduct_agg ON deduct_agg.pin_id = p.id

  -- NEW in 032: supplement-candidate COs (approved, non-voided, scope-required)
  LEFT JOIN (
    SELECT pin_id, SUM(amount_cents) AS supplement_candidate_cents
    FROM   change_orders
    WHERE  status                    = 'approved'
      AND  voided_at                 IS NULL
      AND  required_to_complete_scope = true
    GROUP  BY pin_id
  ) supp_agg ON supp_agg.pin_id = p.id
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
    total_expense_cents
      + lead_acquisition_cost_cents
      + referral_fee_cents
      + sales_commission_cents
      + pm_commission_cents
      + canvassing_commission_cents                                    AS total_cost_cents,

    -- Revised contract (accrual basis) = base contract + approved COs only.
    base_contract_cents + approved_co_cents                            AS revised_contract_cents

  FROM agg
),

-- Step 3 — expected_total using revised_contract as the baseline.
-- Cast to ::int to preserve the integer type (migration 027 column type).
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

-- Final projection — positions 1-23 are UNCHANGED from migration 029.
-- Positions 24-30 are appended (CREATE OR REPLACE permits appending).
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

  -- ── 13: total overhead ────────────────────────────────────────────────
  total_commission_cents,

  -- ── 14: total cost = COGS + overhead ──────────────────────────────────
  total_cost_cents,

  -- ── 15: cash net profit ───────────────────────────────────────────────
  total_payments_cents - total_cost_cents                             AS net_profit_cents,

  -- ── 16: expected total (integer — type preserved from migration 027) ──
  expected_total_cents,

  -- ── 17: cash margin % ────────────────────────────────────────────────
  CASE
    WHEN total_payments_cents > 0
    THEN (total_payments_cents - total_cost_cents)::numeric
           / total_payments_cents * 100
    ELSE 0::numeric
  END                                                                 AS cash_margin_pct,

  -- ── 18: projected margin % (kept for column-position compat; not in API)
  CASE
    WHEN expected_total_cents > 0
    THEN (expected_total_cents - total_cost_cents)::numeric
           / expected_total_cents * 100
    ELSE 0::numeric
  END                                                                 AS projected_margin_pct,

  -- ── 19-20: appended in migration 030 ─────────────────────────────────
  canvassing_commission_cents,
  approved_co_cents,

  -- ── 21: revised contract (bigint) ────────────────────────────────────
  revised_contract_cents,

  -- ── 22: net project margin $ ─────────────────────────────────────────
  revised_contract_cents - total_cost_cents                           AS net_project_margin_cents,

  -- ── 23: net project margin % (NEW in migration 029) ──────────────────
  CASE
    WHEN revised_contract_cents > 0
    THEN (revised_contract_cents - total_cost_cents)::numeric
           / revised_contract_cents * 100
    ELSE 0::numeric
  END                                                                 AS net_project_margin_pct,

  -- ── 24-27: insurance payment / policy analytics (NEW in migration 032) ─
  deductible_collected_cents,
  policy_deductible_cents,
  approved_acv_cents,
  supplement_candidate_cents,

  -- ── 28: depreciation = approved RCV − approved ACV ───────────────────
  approved_rcv_cents - approved_acv_cents                             AS depreciation_cents,

  -- ── 29: claim variance = approved RCV − revised contract ─────────────
  --   Negative = SHORT (carrier approved less than contracted; supplement
  --   may be needed to bridge the gap).
  approved_rcv_cents - revised_contract_cents                         AS claim_variance_cents,

  -- ── 30: base scope = revised contract − betterments ──────────────────
  revised_contract_cents - betterments_amount_cents                   AS base_scope_cents

FROM final;

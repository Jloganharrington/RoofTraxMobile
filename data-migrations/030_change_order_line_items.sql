-- =============================================================================
-- Migration 030 — Change Order Line Items + Extended Change Order Fields
-- =============================================================================
-- 1. Extend change_orders: required_to_complete_scope, document/signature
--    fields, void fields.  amount_cents remains a stored integer but is now
--    DERIVED — always recomputed from the sum of change_order_line_items.total_cents
--    on every line-item write.  It is no longer client-settable.
--
-- 2. New child table `change_order_line_items`.
--    total_cents is stored (not computed at read time) so signed documents
--    remain reproducible even if a price-book item later changes.
--
-- 3. Rewrite `pin_profitability` view (CREATE OR REPLACE):
--    - Update total_commission_cents and total_cost_cents to include
--      canvassing_commission_cents (was in pins since migration 028 but missing
--      from the view).
--    - Add approved_co_cents aggregate (approved, non-voided COs only).
--    - Append NEW columns at the end (PostgreSQL's CREATE OR REPLACE VIEW
--      requires existing column names to stay in their original positions):
--        canvassing_commission_cents
--        approved_co_cents
--        revised_contract_cents  = expected_total_cents + approved_co_cents
--        net_project_margin_cents = revised_contract_cents − total_cost_cents
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend change_orders
-- ---------------------------------------------------------------------------
ALTER TABLE change_orders
  ADD COLUMN IF NOT EXISTS required_to_complete_scope  boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS document_object_path        text,
  ADD COLUMN IF NOT EXISTS document_sha256             text,
  ADD COLUMN IF NOT EXISTS homeowner_signature_path    text,
  ADD COLUMN IF NOT EXISTS homeowner_signed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS rep_signature_path          text,
  ADD COLUMN IF NOT EXISTS rep_signed_at               timestamptz,
  ADD COLUMN IF NOT EXISTS voided_at                   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by_user_id           varchar      REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason                 text,
  ADD COLUMN IF NOT EXISTS emailed_at                  timestamptz;

-- ---------------------------------------------------------------------------
-- 2. change_order_line_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_order_line_items (
  id                  varchar        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          varchar        NOT NULL REFERENCES companies(id),
  change_order_id     varchar        NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  description         text           NOT NULL,
  -- numeric(10,4) allows fractional quantities (0.5 squares, 2.5 hours)
  quantity            numeric(10,4)  NOT NULL DEFAULT 1,
  unit_price_cents    integer        NOT NULL,                    -- may be negative (credits)
  -- Stored total: round(quantity × unit_price_cents). Never computed at read
  -- time — signed PDF reproducibility depends on the stored value.
  total_cents         integer        NOT NULL,
  price_book_item_id  varchar        REFERENCES price_book_items(id),
  sort_order          integer        NOT NULL DEFAULT 0,
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coli_change_order
  ON change_order_line_items(change_order_id);

CREATE INDEX IF NOT EXISTS idx_coli_company
  ON change_order_line_items(company_id);

-- ---------------------------------------------------------------------------
-- 3. Rewrite pin_profitability view
--
-- IMPORTANT: PostgreSQL CREATE OR REPLACE VIEW requires all existing columns
-- to remain in the same position with the same name.  New columns are appended
-- at the end.  The four new columns added here are:
--   canvassing_commission_cents, approved_co_cents,
--   revised_contract_cents, net_project_margin_cents
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW pin_profitability AS
WITH raw AS (
  SELECT
    p.id                                                              AS pin_id,
    p.company_id,

    -- ── Revenue ──────────────────────────────────────────────────────────
    COALESCE(pay_agg.total_payments_cents,      0)                    AS total_payments_cents,
    COALESCE(inv_agg.invoice_total_cents,       0)                    AS invoice_total_cents,
    COALESCE(inv_agg.invoice_paid_cents,        0)                    AS invoice_paid_cents,

    -- ── Vendor Expenses ───────────────────────────────────────────────────
    COALESCE(exp_agg.total_expense_cents,       0)                    AS total_expense_cents,
    COALESCE(exp_agg.paid_expense_cents,        0)                    AS paid_expense_cents,
    COALESCE(exp_agg.outstanding_expense_cents, 0)                    AS outstanding_expense_cents,

    -- ── Commissions (per-lead single-value columns on pins) ───────────────
    COALESCE(p.lead_acquisition_cost_cents,     0)                    AS lead_acquisition_cost_cents,
    COALESCE(p.referral_fee_cents,              0)                    AS referral_fee_cents,
    COALESCE(p.sales_commission_cents,          0)                    AS sales_commission_cents,
    COALESCE(p.pm_commission_cents,             0)                    AS pm_commission_cents,
    -- NEW: canvassing was added to pins in migration 028 but was missing here
    COALESCE(p.canvassing_commission_cents,     0)                    AS canvassing_commission_cents,

    -- ── Total commission (NOW five lines — canvassing included) ──────────
    COALESCE(p.lead_acquisition_cost_cents, 0)
      + COALESCE(p.referral_fee_cents,       0)
      + COALESCE(p.sales_commission_cents,   0)
      + COALESCE(p.pm_commission_cents,      0)
      + COALESCE(p.canvassing_commission_cents, 0)                    AS total_commission_cents,

    -- ── Total cost = expenses + all five commissions ──────────────────────
    COALESCE(exp_agg.total_expense_cents, 0)
      + COALESCE(p.lead_acquisition_cost_cents, 0)
      + COALESCE(p.referral_fee_cents,           0)
      + COALESCE(p.sales_commission_cents,       0)
      + COALESCE(p.pm_commission_cents,          0)
      + COALESCE(p.canvassing_commission_cents,  0)                   AS total_cost_cents,

    -- ── Expected total revenue (insurance uses GREATEST(contract, RCV)) ──
    CASE
      WHEN p.workflow = 'insurance'
      THEN GREATEST(
        COALESCE(_parse_legacy_money_cents(p.contract_amount),        0),
        COALESCE(_parse_legacy_money_cents(p.approved_rcv_amount),    0)
      )
      ELSE COALESCE(_parse_legacy_money_cents(p.contract_amount),     0)
    END                                                               AS expected_total_cents,

    -- ── Approved change orders (approved, non-voided only) ───────────────
    COALESCE(co_agg.approved_co_cents, 0)                             AS approved_co_cents

  FROM pins p

  -- Payments ledger aggregate
  LEFT JOIN (
    SELECT pin_id, SUM(amount_cents) AS total_payments_cents
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

  -- Approved, non-voided change orders aggregate
  LEFT JOIN (
    SELECT pin_id, SUM(amount_cents) AS approved_co_cents
    FROM   change_orders
    WHERE  status    = 'approved'
      AND  voided_at IS NULL
    GROUP  BY pin_id
  ) co_agg ON co_agg.pin_id = p.id
)
SELECT
  -- ── Existing columns — ORDER PRESERVED from migration 027 ────────────────
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

  -- Commissions (four original columns — canvassing appended at end below)
  lead_acquisition_cost_cents,
  referral_fee_cents,
  sales_commission_cents,
  pm_commission_cents,

  -- total_commission_cents now includes canvassing (value changes, name/pos same — OK)
  total_commission_cents,

  -- total_cost_cents now includes canvassing (value changes, name/pos same — OK)
  total_cost_cents,

  total_payments_cents - total_cost_cents                             AS net_profit_cents,

  expected_total_cents,

  CASE
    WHEN total_payments_cents > 0
    THEN (total_payments_cents - total_cost_cents)::numeric
           / total_payments_cents * 100
    ELSE 0::numeric
  END                                                                 AS cash_margin_pct,

  CASE
    WHEN expected_total_cents > 0
    THEN (expected_total_cents - total_cost_cents)::numeric
           / expected_total_cents * 100
    ELSE 0::numeric
  END                                                                 AS projected_margin_pct,

  -- ── NEW columns appended at end (required by CREATE OR REPLACE VIEW) ────
  canvassing_commission_cents,
  approved_co_cents,
  expected_total_cents + approved_co_cents                            AS revised_contract_cents,
  expected_total_cents + approved_co_cents - total_cost_cents         AS net_project_margin_cents

FROM raw;

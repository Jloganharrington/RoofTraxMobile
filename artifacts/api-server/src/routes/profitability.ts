/**
 * Profitability Summary endpoint (Step 4 — migrations 026 + 027 + 030).
 *
 *   GET /pins/:pinId/profitability
 *     — Pin owner (field_rep) or manager+ (Section 8 ruling — FINDING 3-C reversed).
 *     — Returns a computed summary of every financial dimension for the lead.
 *     — All money values are integer cents; margin pcts are numeric (view-computed).
 *     — Reads from the `pin_profitability` view (migration 030 is latest rewrite).
 *
 * Migration 030 additions to the view:
 *   - canvassing_commission_cents (was in pins since 028, missing from 027 view)
 *   - approved_co_cents           (sum of approved, non-voided change orders)
 *   - revised_contract_cents      (expected_total + approved COs)
 *   - net_project_margin_cents    (revised_contract − total_cost)
 */

import { and, eq, sql } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { db, pinsTable } from '@workspace/db';
import { loadActorCtx, resolveWithOverrides, sendOwnerAwareDenial } from '../middlewares/requirePermission';

const router = Router();

// ---------------------------------------------------------------------------
// GET /pins/:pinId/profitability
// ---------------------------------------------------------------------------

// profitability.view — ownerOrRole: manager (Section 8 ruling — FINDING 3-C reversed).
// Field-rep pin owners may view their own lead's financial summary.
// Inline resolve() is required (not requirePermission middleware) because
// ownerId is only available after the pin fetch.
router.get('/pins/:pinId/profitability', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const pinId = req.params.pinId as string;

  // Confirm the pin belongs to this company before querying the view.
  // Also fetch userId so we can pass ownerId to resolve().
  const [pin] = await db
    .select({ id: pinsTable.id, userId: pinsTable.userId })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, actorCtx.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  // ownerOrRole gate: field_rep pin owners are permitted; manager+ always permitted.
  const { allowed, reason } = await resolveWithOverrides(req, 'profitability.view', actorCtx, pin.userId);
  if (!allowed) { sendOwnerAwareDenial(res, { allowed, reason }, 'Forbidden'); return; }

  // Query the view directly with a raw SQL query (the view is not in the
  // Drizzle schema — it is a read-only aggregation layer, not a table).
  // Migration 029: net_project_margin_pct added; projected_margin_pct kept in
  // the view for column-position compatibility but not exposed in this response.
  const result = await db.execute(
    sql`SELECT
          pin_id,
          company_id,
          total_payments_cents,
          invoice_total_cents,
          invoice_paid_cents,
          total_expense_cents,
          paid_expense_cents,
          outstanding_expense_cents,
          lead_acquisition_cost_cents,
          referral_fee_cents,
          sales_commission_cents,
          pm_commission_cents,
          canvassing_commission_cents,
          total_commission_cents,
          total_cost_cents,
          net_profit_cents,
          expected_total_cents,
          cash_margin_pct,
          approved_co_cents,
          revised_contract_cents,
          net_project_margin_cents,
          net_project_margin_pct,
          -- insurance analytics (migration 032)
          deductible_collected_cents,
          policy_deductible_cents,
          approved_acv_cents,
          supplement_candidate_cents,
          depreciation_cents,
          claim_variance_cents,
          base_scope_cents
        FROM pin_profitability
        WHERE pin_id   = ${pinId}
          AND company_id = ${actorCtx.companyId}`,
  );

  const row = result.rows[0];
  if (!row) {
    // Pin exists (confirmed above) but has no view row — shouldn't happen,
    // but return safe zeroes rather than 404.
    res.json({
      profitability: {
        pinId,
        totalPaymentsCents:         0,
        invoiceTotalCents:          0,
        invoicePaidCents:           0,
        totalExpenseCents:          0,
        paidExpenseCents:           0,
        outstandingExpenseCents:    0,
        leadAcquisitionCostCents:   0,
        referralFeeCents:           0,
        salesCommissionCents:       0,
        pmCommissionCents:          0,
        canvassingCommissionCents:  0,
        totalCommissionCents:       0,
        totalCostCents:             0,
        netProfitCents:             0,
        expectedTotalCents:         0,
        cashMarginPct:              0,
        approvedCoCents:            0,
        revisedContractCents:       0,
        netProjectMarginCents:      0,
        netProjectMarginPct:        0,
        // Migration 032 — insurance analytics
        deductibleCollectedCents:   0,
        policyDeductibleCents:      0,
        approvedAcvCents:           0,
        supplementCandidateCents:   0,
        depreciationCents:          0,
        claimVarianceCents:         0,
        baseScopeCents:             0,
      },
    });
    return;
  }

  // Helper: pg returns numeric aggregates and computed pcts as strings; coerce.
  const n   = (v: unknown): number => (typeof v === 'string' ? parseInt(v, 10) : Number(v ?? 0)) || 0;
  const pct = (v: unknown): number => (typeof v === 'string' ? parseFloat(v)   : Number(v ?? 0)) || 0;

  res.json({
    profitability: {
      pinId,
      totalPaymentsCents:         n(row.total_payments_cents),
      invoiceTotalCents:          n(row.invoice_total_cents),
      invoicePaidCents:           n(row.invoice_paid_cents),
      totalExpenseCents:          n(row.total_expense_cents),
      paidExpenseCents:           n(row.paid_expense_cents),
      outstandingExpenseCents:    n(row.outstanding_expense_cents),
      leadAcquisitionCostCents:   n(row.lead_acquisition_cost_cents),
      referralFeeCents:           n(row.referral_fee_cents),
      salesCommissionCents:       n(row.sales_commission_cents),
      pmCommissionCents:          n(row.pm_commission_cents),
      canvassingCommissionCents:  n(row.canvassing_commission_cents),
      totalCommissionCents:       n(row.total_commission_cents),
      totalCostCents:             n(row.total_cost_cents),
      netProfitCents:             n(row.net_profit_cents),
      // Migration 027 — view-computed margins
      expectedTotalCents:         n(row.expected_total_cents),
      cashMarginPct:              pct(row.cash_margin_pct),
      // projectedMarginPct removed per Step 2d — replaced by netProjectMarginPct
      // Migration 030 — approved change orders + revised contract
      approvedCoCents:            n(row.approved_co_cents),
      revisedContractCents:       n(row.revised_contract_cents),
      netProjectMarginCents:      n(row.net_project_margin_cents),
      // Migration 029 — accrual-basis margin percentage
      netProjectMarginPct:        pct(row.net_project_margin_pct),
      // Migration 032 — insurance analytics
      deductibleCollectedCents:   n(row.deductible_collected_cents),
      policyDeductibleCents:      n(row.policy_deductible_cents),
      approvedAcvCents:           n(row.approved_acv_cents),
      supplementCandidateCents:   n(row.supplement_candidate_cents),
      depreciationCents:          n(row.depreciation_cents),
      claimVarianceCents:         n(row.claim_variance_cents),
      baseScopeCents:             n(row.base_scope_cents),
    },
  });
});

export default router;

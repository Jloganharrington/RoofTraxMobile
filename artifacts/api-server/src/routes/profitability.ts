/**
 * Profitability Summary endpoint (Step 4 — migration 026).
 *
 *   GET /pins/:pinId/profitability
 *     — Any authenticated company member.
 *     — Returns a computed summary of every financial dimension for the lead.
 *     — All money values are integer cents.
 *     — Reads from the `pin_profitability` view (migration 026).
 */

import { and, eq, sql } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { db, pinsTable } from '@workspace/db';

const router = Router();

// ---------------------------------------------------------------------------
// GET /pins/:pinId/profitability
// ---------------------------------------------------------------------------

router.get('/pins/:pinId/profitability', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const pinId = req.params.pinId as string;

  // Confirm the pin belongs to this company before querying the view.
  const [pin] = await db
    .select({ id: pinsTable.id })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.user.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  // Query the view directly with a raw SQL query (the view is not in the
  // Drizzle schema — it is a read-only aggregation layer, not a table).
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
          total_commission_cents,
          total_cost_cents,
          net_profit_cents,
          expected_total_cents,
          cash_margin_pct,
          projected_margin_pct
        FROM pin_profitability
        WHERE pin_id   = ${pinId}
          AND company_id = ${req.user.companyId}`,
  );

  const row = result.rows[0];
  if (!row) {
    // Pin exists (confirmed above) but has no view row — shouldn't happen,
    // but return safe zeroes rather than 404.
    res.json({
      profitability: {
        pinId,
        totalPaymentsCents:       0,
        invoiceTotalCents:        0,
        invoicePaidCents:         0,
        totalExpenseCents:        0,
        paidExpenseCents:         0,
        outstandingExpenseCents:  0,
        leadAcquisitionCostCents: 0,
        referralFeeCents:         0,
        salesCommissionCents:     0,
        pmCommissionCents:        0,
        totalCommissionCents:     0,
        totalCostCents:           0,
        netProfitCents:           0,
        marginPct:                null,
        expectedTotalCents:       0,
        cashMarginPct:            0,
        projectedMarginPct:       0,
      },
    });
    return;
  }

  // Helper: pg returns numeric aggregates and computed pcts as strings; coerce.
  const n  = (v: unknown): number => (typeof v === 'string' ? parseInt(v, 10)    : Number(v ?? 0)) || 0;
  const pct = (v: unknown): number => (typeof v === 'string' ? parseFloat(v)      : Number(v ?? 0)) || 0;

  const totalPayments = n(row.total_payments_cents);
  const totalCost     = n(row.total_cost_cents);
  const netProfit     = n(row.net_profit_cents);

  // Legacy marginPct kept for backward compatibility (cash-only, null when no revenue).
  const marginPct =
    totalPayments > 0 ? Math.round((netProfit / totalPayments) * 10000) / 100 : null;

  res.json({
    profitability: {
      pinId,
      totalPaymentsCents:       n(row.total_payments_cents),
      invoiceTotalCents:        n(row.invoice_total_cents),
      invoicePaidCents:         n(row.invoice_paid_cents),
      totalExpenseCents:        n(row.total_expense_cents),
      paidExpenseCents:         n(row.paid_expense_cents),
      outstandingExpenseCents:  n(row.outstanding_expense_cents),
      leadAcquisitionCostCents: n(row.lead_acquisition_cost_cents),
      referralFeeCents:         n(row.referral_fee_cents),
      salesCommissionCents:     n(row.sales_commission_cents),
      pmCommissionCents:        n(row.pm_commission_cents),
      totalCommissionCents:     n(row.total_commission_cents),
      totalCostCents:           totalCost,
      netProfitCents:           netProfit,
      marginPct,
      // Migration 027 — view-computed margins
      expectedTotalCents:  n(row.expected_total_cents),
      cashMarginPct:       pct(row.cash_margin_pct),
      projectedMarginPct:  pct(row.projected_margin_pct),
    },
  });
});

export default router;

/**
 * Vendor Expenses + Commissions endpoints (Step 3 — migration 025).
 *
 * Vendor Expenses:
 *   GET    /pins/:pinId/expenses            — any authenticated company member
 *   POST   /pins/:pinId/expenses            — manager+
 *   PATCH  /expenses/:expenseId             — manager+
 *   DELETE /expenses/:expenseId             — manager+
 *   POST   /expenses/:expenseId/mark-paid   — manager+ (paid_date set server-side)
 *
 * Commissions (per-lead single-value columns on pins):
 *   PATCH  /pins/:pinId/commissions                  — manager+ (amounts only)
 *   POST   /pins/:pinId/commissions/sales/mark-paid  — manager+ (server-side date)
 *   POST   /pins/:pinId/commissions/pm/mark-paid     — manager+ (server-side date)
 *
 * Bug-fix (iii): commission fields (leadAcquisitionCostCents, referralFeeCents,
 * salesCommissionCents, salesCommissionPaidDate, pmCommissionCents,
 * pmCommissionPaidDate) are NOT accepted by the generic PATCH /pins/:pinId.
 * They are ONLY writable through this file's endpoints (manager+).
 *
 * §Mark-paid (expenses): paid_date is always set to NOW() server-side.
 *   The request body does NOT accept a paid_date. This prevents clients
 *   from backdating payments.
 *
 * §Mark-paid (commissions): same principle — salesCommissionPaidDate and
 *   pmCommissionPaidDate are only set via the dedicated mark-paid endpoints.
 */

import { and, eq } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  db,
  EXPENSE_CATEGORIES,
  pinsTable,
  vendorExpensesTable,
} from '@workspace/db';
import { loadActorCtx, requirePermission, resolveOwnerAware, sendOwnerAwareDenial } from '../middlewares/requirePermission';

// TypeScript struggles to narrow string | null | undefined through a ternary
// when it comes from a Zod-nullable field. Use an explicit helper instead.
function isoToDate(val: string | null | undefined): Date | null {
  if (val == null) return null;
  return new Date(val);
}


const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve pin, confirming company scope. Returns userId for ownerOrRole checks. */
async function resolvePin(pinId: string, companyId: string) {
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, companyId)));
  return pin ?? null;
}

async function resolveExpense(expenseId: string, companyId: string) {
  const [exp] = await db
    .select()
    .from(vendorExpensesTable)
    .where(
      and(
        eq(vendorExpensesTable.id, expenseId),
        eq(vendorExpensesTable.companyId, companyId),
      ),
    );
  return exp ?? null;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateVendorExpenseBody = z.object({
  vendorName:    z.string().min(1),
  amountCents:   z.number().int().min(1),
  category:      z.enum(EXPENSE_CATEGORIES),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate:   z.string().datetime().nullable().optional(),
  description:   z.string().nullable().optional(),
  documentUrl:   z.string().nullable().optional(),
  dueDate:       z.string().datetime().nullable().optional(),
});

const UpdateVendorExpenseBody = z.object({
  vendorName:    z.string().min(1).optional(),
  amountCents:   z.number().int().min(1).optional(),
  category:      z.enum(EXPENSE_CATEGORIES).optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate:   z.string().datetime().nullable().optional(),
  description:   z.string().nullable().optional(),
  documentUrl:   z.string().nullable().optional(),
  dueDate:       z.string().datetime().nullable().optional(),
});

// Commission amounts only — paid dates are NOT accepted; use mark-paid endpoints.
const UpdateCommissionsBody = z.object({
  leadAcquisitionCostCents: z.number().int().min(0).nullable().optional(),
  referralFeeCents:         z.number().int().min(0).nullable().optional(),
  salesCommissionCents:     z.number().int().min(0).nullable().optional(),
  pmCommissionCents:        z.number().int().min(0).nullable().optional(),
});

// ---------------------------------------------------------------------------
// GET /pins/:pinId/expenses
// ---------------------------------------------------------------------------

// expense.view (ownerOrRole:manager+) — VERDICT CHANGE: field_rep pin owners now permitted.
router.get('/pins/:pinId/expenses', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const pin = await resolvePin(req.params.pinId as string, actorCtx.companyId);
  if (!pin) { res.status(404).json({ error: 'Pin not found' }); return; }

  const result = resolveOwnerAware('expense.view', actorCtx, pin.userId);
  if (!result.allowed) { sendOwnerAwareDenial(res, result, 'Forbidden'); return; }

  const expenses = await db
    .select()
    .from(vendorExpensesTable)
    .where(
      and(
        eq(vendorExpensesTable.pinId, pin.id),
        eq(vendorExpensesTable.companyId, actorCtx.companyId),
      ),
    )
    .orderBy(vendorExpensesTable.createdAt);
  res.json({ expenses });
});

// ---------------------------------------------------------------------------
// POST /pins/:pinId/expenses
// ---------------------------------------------------------------------------

// expense.create (ownerOrRole:manager+) — VERDICT CHANGE: field_rep pin owners now permitted.
router.post('/pins/:pinId/expenses', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const pin = await resolvePin(req.params.pinId as string, actorCtx.companyId);
  if (!pin) { res.status(404).json({ error: 'Pin not found' }); return; }

  const result = resolveOwnerAware('expense.create', actorCtx, pin.userId);
  if (!result.allowed) { sendOwnerAwareDenial(res, result, 'Forbidden'); return; }
  const parsed = CreateVendorExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', detail: parsed.error.issues });
    return;
  }
  const { vendorName, amountCents, category, invoiceNumber, invoiceDate, description, documentUrl, dueDate } = parsed.data;
  const [expense] = await db
    .insert(vendorExpensesTable)
    .values({
      companyId:     actorCtx.companyId,
      pinId:         pin.id,
      vendorName,
      amountCents,
      category,
      invoiceNumber: invoiceNumber ?? null,
      invoiceDate:   isoToDate(invoiceDate),
      description:   description ?? null,
      documentUrl:   documentUrl ?? null,
      dueDate:       isoToDate(dueDate),
    })
    .returning();
  res.status(201).json({ expense });
});

// ---------------------------------------------------------------------------
// PATCH /expenses/:expenseId
// ---------------------------------------------------------------------------

// expense.update (ownerOrRole:manager+) — VERDICT CHANGE: field_rep pin owners now permitted.
router.patch('/expenses/:expenseId', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const expense = await resolveExpense(req.params.expenseId as string, actorCtx.companyId);
  if (!expense) { res.status(404).json({ error: 'Expense not found' }); return; }

  // ownerOrRole gate: load pin to get pin owner.
  const pin = await resolvePin(expense.pinId, actorCtx.companyId);
  const result = resolveOwnerAware('expense.update', actorCtx, pin?.userId);
  if (!result.allowed) { sendOwnerAwareDenial(res, result, 'Forbidden'); return; }
  const parsed = UpdateVendorExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', detail: parsed.error.issues });
    return;
  }
  const { vendorName, amountCents, category, invoiceNumber, invoiceDate, description, documentUrl, dueDate } = parsed.data;
  const [updated] = await db
    .update(vendorExpensesTable)
    .set({
      ...(vendorName    !== undefined && { vendorName }),
      ...(amountCents   !== undefined && { amountCents }),
      ...(category      !== undefined && { category }),
      ...(invoiceNumber !== undefined && { invoiceNumber }),
      ...(invoiceDate   !== undefined && { invoiceDate: isoToDate(invoiceDate) }),
      ...(description   !== undefined && { description }),
      ...(documentUrl   !== undefined && { documentUrl }),
      ...(dueDate       !== undefined && { dueDate: isoToDate(dueDate) }),
    })
    .where(eq(vendorExpensesTable.id, expense.id))
    .returning();
  res.json({ expense: updated });
});

// ---------------------------------------------------------------------------
// DELETE /expenses/:expenseId
// ---------------------------------------------------------------------------

// expense.delete (ownerOrRole:manager+) — VERDICT CHANGE: field_rep pin owners now permitted.
router.delete('/expenses/:expenseId', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const expense = await resolveExpense(req.params.expenseId as string, actorCtx.companyId);
  if (!expense) { res.status(404).json({ error: 'Expense not found' }); return; }

  // ownerOrRole gate: load pin to get pin owner.
  const pin = await resolvePin(expense.pinId, actorCtx.companyId);
  const result = resolveOwnerAware('expense.delete', actorCtx, pin?.userId);
  if (!result.allowed) { sendOwnerAwareDenial(res, result, 'Forbidden'); return; }

  await db.delete(vendorExpensesTable).where(eq(vendorExpensesTable.id, expense.id));
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /expenses/:expenseId/mark-paid
// paid_date is ALWAYS set server-side — clients cannot backdate it.
// ---------------------------------------------------------------------------

router.post('/expenses/:expenseId/mark-paid', requirePermission('expense.manage'), async (req: Request, res: Response) => {
  const expense = await resolveExpense(req.params.expenseId as string, req.actorCtx!.companyId);
  if (!expense) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  if (expense.isPaid) {
    res.status(400).json({ error: 'Expense is already marked as paid' });
    return;
  }
  // paid_date is set to NOW() by the server — never from the request body.
  const [updated] = await db
    .update(vendorExpensesTable)
    .set({ isPaid: true, paidDate: new Date() })
    .where(eq(vendorExpensesTable.id, expense.id))
    .returning();
  res.json({ expense: updated });
});

// ---------------------------------------------------------------------------
// PATCH /pins/:pinId/commissions
// Accepts amounts only — paid dates are controlled by mark-paid endpoints.
// ---------------------------------------------------------------------------

router.patch('/pins/:pinId/commissions', requirePermission('expense.manage'), async (req: Request, res: Response) => {
  const pin = await resolvePin(req.params.pinId as string, req.actorCtx!.companyId);
  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }
  const parsed = UpdateCommissionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', detail: parsed.error.issues });
    return;
  }
  const { leadAcquisitionCostCents, referralFeeCents, salesCommissionCents, pmCommissionCents } = parsed.data;
  const [updated] = await db
    .update(pinsTable)
    .set({
      ...(leadAcquisitionCostCents !== undefined && { leadAcquisitionCostCents }),
      ...(referralFeeCents         !== undefined && { referralFeeCents }),
      ...(salesCommissionCents     !== undefined && { salesCommissionCents }),
      ...(pmCommissionCents        !== undefined && { pmCommissionCents }),
    })
    .where(eq(pinsTable.id, pin.id))
    .returning();
  res.json({
    commissions: {
      leadAcquisitionCostCents: updated.leadAcquisitionCostCents,
      referralFeeCents:         updated.referralFeeCents,
      salesCommissionCents:     updated.salesCommissionCents,
      salesCommissionPaidDate:  updated.salesCommissionPaidDate,
      pmCommissionCents:        updated.pmCommissionCents,
      pmCommissionPaidDate:     updated.pmCommissionPaidDate,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /pins/:pinId/commissions/sales/mark-paid
// salesCommissionPaidDate set server-side (NOW()).
// ---------------------------------------------------------------------------

router.post('/pins/:pinId/commissions/sales/mark-paid', requirePermission('expense.manage'), async (req: Request, res: Response) => {
  const pin = await resolvePin(req.params.pinId as string, req.actorCtx!.companyId);
  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }
  if (!pin.salesCommissionCents) {
    res.status(400).json({ error: 'No sales commission amount is set — set it before marking paid' });
    return;
  }
  const [updated] = await db
    .update(pinsTable)
    .set({ salesCommissionPaidDate: new Date() })
    .where(eq(pinsTable.id, pin.id))
    .returning();
  res.json({
    commissions: {
      leadAcquisitionCostCents: updated.leadAcquisitionCostCents,
      referralFeeCents:         updated.referralFeeCents,
      salesCommissionCents:     updated.salesCommissionCents,
      salesCommissionPaidDate:  updated.salesCommissionPaidDate,
      pmCommissionCents:        updated.pmCommissionCents,
      pmCommissionPaidDate:     updated.pmCommissionPaidDate,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /pins/:pinId/commissions/pm/mark-paid
// pmCommissionPaidDate set server-side (NOW()).
// ---------------------------------------------------------------------------

router.post('/pins/:pinId/commissions/pm/mark-paid', requirePermission('expense.manage'), async (req: Request, res: Response) => {
  const pin = await resolvePin(req.params.pinId as string, req.actorCtx!.companyId);
  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }
  if (!pin.pmCommissionCents) {
    res.status(400).json({ error: 'No PM commission amount is set — set it before marking paid' });
    return;
  }
  const [updated] = await db
    .update(pinsTable)
    .set({ pmCommissionPaidDate: new Date() })
    .where(eq(pinsTable.id, pin.id))
    .returning();
  res.json({
    commissions: {
      leadAcquisitionCostCents: updated.leadAcquisitionCostCents,
      referralFeeCents:         updated.referralFeeCents,
      salesCommissionCents:     updated.salesCommissionCents,
      salesCommissionPaidDate:  updated.salesCommissionPaidDate,
      pmCommissionCents:        updated.pmCommissionCents,
      pmCommissionPaidDate:     updated.pmCommissionPaidDate,
    },
  });
});

export default router;

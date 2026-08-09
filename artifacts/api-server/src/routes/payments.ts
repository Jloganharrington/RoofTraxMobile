/**
 * Payments ledger endpoints (Step 1 — migration 023).
 *
 * Authorization:
 *   GET  /pins/:pinId/payments          — any authenticated company member
 *   POST /pins/:pinId/payments          — manager+ only
 *   PATCH  /payments/:paymentId         — manager+ only
 *   DELETE /payments/:paymentId         — manager+ only
 *
 * Bug-fix (i) — IDOR: company_id and pin_id are NEVER accepted from the
 * request body on PATCH or DELETE. The server re-verifies the stored row's
 * company against req.user.companyId before every write.
 *
 * Bug-fix (ii) — Idempotency: the UI disables submit while the mutation is
 * in flight (discrete button → no double-POSTs from double-clicks). The
 * critical machine-generated path (mark-invoice-paid → ledger row) will use
 * a DB-level upsert / conflict guard in Step 2.
 *
 * Bug-fix (iii) — No bypass route: the legacy LeadProfileBody no longer
 * accepts depositAmount / acvAmount / supplementAmount / finalPaymentAmount.
 * See pins.ts for the removal.
 *
 * Bug-fix (v) — Stale write on context switch: the new payments UI uses
 * discrete mutations (not debounced autosave), so there is no pending write
 * to cancel when the user navigates away.
 */

import { and, eq } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  db,
  PAYMENT_TYPES,
  paymentsTable,
  pinsTable,
  userProfilesTable,
} from '@workspace/db';
import { isManagerOrAdmin, type Role } from '@workspace/authz';
import { notify } from '../lib/notify';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getRole(userId: string): Promise<Role> {
  const [row] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  return (row?.role ?? 'field_rep') as Role;
}

/** Resolve the pin, confirming it belongs to the caller's company. */
async function resolvePin(
  pinId: string,
  companyId: string,
): Promise<{ id: string } | null> {
  const [pin] = await db
    .select({ id: pinsTable.id })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, companyId)));
  return pin ?? null;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const paymentTypeEnum = z.enum(PAYMENT_TYPES);

const CreatePaymentBody = z.object({
  type: paymentTypeEnum,
  amountCents: z.number().int().min(1, 'amountCents must be at least 1'),
  method: z.string().nullable().optional(),
  paymentDate: z.string().datetime({ message: 'paymentDate must be ISO 8601' }),
  notes: z.string().nullable().optional(),
});

const UpdatePaymentBody = z
  .object({
    type: paymentTypeEnum.optional(),
    amountCents: z.number().int().min(1).optional(),
    method: z.string().nullable().optional(),
    paymentDate: z.string().datetime().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field is required',
  });

// ---------------------------------------------------------------------------
// GET /api/pins/:pinId/payments
// ---------------------------------------------------------------------------

router.get('/pins/:pinId/payments', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { pinId } = req.params as { pinId: string };
  const pin = await resolvePin(pinId, req.user.companyId);
  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  const payments = await db
    .select()
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.pinId, pinId),
        eq(paymentsTable.companyId, req.user.companyId),
      ),
    )
    .orderBy(paymentsTable.paymentDate);

  res.json({ payments });
});

// ---------------------------------------------------------------------------
// POST /api/pins/:pinId/payments
// ---------------------------------------------------------------------------

router.post('/pins/:pinId/payments', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const role = await getRole(req.user.id);
  if (!isManagerOrAdmin(role)) {
    res.status(403).json({ error: 'Manager or above required' });
    return;
  }

  const { pinId } = req.params as { pinId: string };
  const pin = await resolvePin(pinId, req.user.companyId);
  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
    return;
  }

  const d = parsed.data;

  // Bug fix (ii): the UI disables submit while the mutation is in flight
  // (discrete button — no double-POSTs from double-clicks). The critical
  // machine-generated path (mark-invoice-paid → ledger row) will use a
  // DB-level upsert / conflict guard in Step 2.
  const [payment] = await db
    .insert(paymentsTable)
    .values({
      companyId: req.user.companyId,
      pinId,
      type: d.type,
      amountCents: d.amountCents,
      method: d.method ?? null,
      paymentDate: new Date(d.paymentDate),
      notes: d.notes ?? null,
      createdByUserId: req.user.id,
    })
    .returning();

  res.status(201).json({ payment });

  // Fire-and-forget — managers notified; actor excluded; response already sent.
  void notify({
    type:        'payment_recorded',
    companyId:   req.user.companyId,
    pinId,
    actorUserId: req.user.id,
    payload:     { amountCents: payment.amountCents, paymentType: payment.type },
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/payments/:paymentId
// ---------------------------------------------------------------------------

router.patch('/payments/:paymentId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const role = await getRole(req.user.id);
  if (!isManagerOrAdmin(role)) {
    res.status(403).json({ error: 'Manager or above required' });
    return;
  }

  const { paymentId } = req.params as { paymentId: string };

  // Bug fix (i): fetch the stored row FIRST, verify company scope from the DB —
  // never trust company_id or pin_id from the request body.
  const [existing] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, paymentId));

  if (!existing || existing.companyId !== req.user.companyId) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }

  const parsed = UpdatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
    return;
  }

  const d = parsed.data;

  const [payment] = await db
    .update(paymentsTable)
    .set({
      ...(d.type !== undefined && { type: d.type }),
      ...(d.amountCents !== undefined && { amountCents: d.amountCents }),
      ...(d.method !== undefined && { method: d.method }),
      ...(d.paymentDate !== undefined && { paymentDate: new Date(d.paymentDate) }),
      ...(d.notes !== undefined && { notes: d.notes }),
      updatedAt: new Date(),
    })
    .where(eq(paymentsTable.id, paymentId))
    .returning();

  res.json({ payment });
});

// ---------------------------------------------------------------------------
// DELETE /api/payments/:paymentId
// ---------------------------------------------------------------------------

router.delete('/payments/:paymentId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const role = await getRole(req.user.id);
  if (!isManagerOrAdmin(role)) {
    res.status(403).json({ error: 'Manager or above required' });
    return;
  }

  const { paymentId } = req.params as { paymentId: string };

  // Bug fix (i): verify company scope from DB before deleting.
  const [existing] = await db
    .select({ id: paymentsTable.id, companyId: paymentsTable.companyId })
    .from(paymentsTable)
    .where(eq(paymentsTable.id, paymentId));

  if (!existing || existing.companyId !== req.user.companyId) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }

  await db.delete(paymentsTable).where(eq(paymentsTable.id, paymentId));
  res.status(204).send();
});

export default router;

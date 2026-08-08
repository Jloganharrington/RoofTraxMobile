/**
 * Insurance data endpoint — claim fields, policy info, adjuster details.
 *
 *   GET  /pins/:pinId/insurance — any authenticated company member
 *   PATCH /pins/:pinId/insurance — manager+ only
 *
 * These fields are NOT writable via PATCH /pins/:pinId (generic — basic
 * workflow/contact fields only) or PATCH /pins/:pinId/profile (which uses
 * canEditPin() and allows field reps for their own pins).
 *
 * The PATCH /pins/:pinId/profile route currently accepts a subset of
 * insurance fields (insuranceCarrier, policyNumber, claimNumber, dateOfLoss,
 * adjusterName/Phone/Email, adjusterMeetingDate, deductibleAmount, rcvAmount)
 * as a legacy write path from before this dedicated endpoint existed. New
 * insurance writes should come here. Step 5B will update the frontend.
 *
 * Claim-status history (migration 038):
 *   Every change to claim_status is logged to claim_status_history in the SAME
 *   transaction as the pin update. Setting the SAME status twice is a no-op —
 *   no history row is written. This is the ONLY code path that writes
 *   claim_status; PATCH /pins/:pinId and PATCH /pins/:pinId/profile do NOT
 *   include it (confirmed: profile.ts:267-273 explicitly excludes insurance fields).
 */

import { z } from 'zod';
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db, pinsTable, userProfilesTable, claimStatusHistoryTable } from '@workspace/db';
import { isManagerOrAdmin } from '@workspace/authz';

const router = Router();

// ---------------------------------------------------------------------------
// Claim-status vocabulary — validated server-side; stored as varchar so new
// statuses can be added without a Postgres enum migration.
// ---------------------------------------------------------------------------
export const CLAIM_STATUSES = [
  'not_filed',
  'filed',
  'under_review',
  'adjuster_scheduled',
  'approved',
  'partially_approved',
  'denied',
  'supplement_pending',
  'closed',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// ---------------------------------------------------------------------------
// Request body schema
// ---------------------------------------------------------------------------
const InsurancePatchBody = z.object({
  insuranceCarrier:      z.string().max(255).nullish(),
  policyNumber:          z.string().max(255).nullish(),
  policyHolder:          z.string().max(255).nullish(),
  coverageType:          z.string().max(255).nullish(),
  deductibleAmount:      z.string().max(50).nullish(),
  claimNumber:           z.string().max(255).nullish(),
  claimFiledDate:        z.string().nullish(),
  dateOfLoss:            z.string().nullish(),
  inspectionDate:        z.string().nullish(),
  claimStatus:           z.enum(CLAIM_STATUSES).nullish(),
  adjusterName:          z.string().max(255).nullish(),
  adjusterPhone:         z.string().max(50).nullish(),
  adjusterEmail:         z.string().email().or(z.literal('')).nullish(),
  adjusterMeetingDate:   z.string().nullish(),
  adjusterLastContact:   z.string().nullish(),
  approvedRcvAmount:     z.string().max(50).nullish(),
  approvedAcvAmount:     z.string().max(50).nullish(),
  bettermentsAmountCents: z.number().int().min(0).nullish(),
  supplementNotes:       z.string().nullish(),
});

function toDateOrNull(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// GET /pins/:pinId/insurance
// ---------------------------------------------------------------------------
router.get('/pins/:pinId/insurance', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const pinId = req.params.pinId as string;
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.user.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  res.json({
    insurance: {
      insuranceCarrier:       pin.insuranceCarrier       ?? null,
      policyNumber:           pin.policyNumber           ?? null,
      policyHolder:           pin.policyHolder           ?? null,
      coverageType:           pin.coverageType           ?? null,
      deductibleAmount:       pin.deductibleAmount       ?? null,
      claimNumber:            pin.claimNumber            ?? null,
      claimFiledDate:         pin.claimFiledDate?.toISOString()       ?? null,
      dateOfLoss:             pin.dateOfLoss?.toISOString()           ?? null,
      inspectionDate:         pin.inspectionDate?.toISOString()       ?? null,
      claimStatus:            pin.claimStatus            ?? null,
      adjusterName:           pin.adjusterName           ?? null,
      adjusterPhone:          pin.adjusterPhone          ?? null,
      adjusterEmail:          pin.adjusterEmail          ?? null,
      adjusterMeetingDate:    pin.adjusterMeetingDate?.toISOString()  ?? null,
      adjusterLastContact:    pin.adjusterLastContact?.toISOString()  ?? null,
      approvedRcvAmount:      pin.approvedRcvAmount      ?? null,
      approvedAcvAmount:      pin.approvedAcvAmount      ?? null,
      bettermentsAmountCents: pin.bettermentsAmountCents ?? null,
      supplementNotes:        pin.supplementNotes        ?? null,
    },
  });
});

// ---------------------------------------------------------------------------
// PATCH /pins/:pinId/insurance — manager+ only
// ---------------------------------------------------------------------------
router.patch('/pins/:pinId/insurance', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const pinId = req.params.pinId as string;

  // Load pin — include claimStatus so we can detect changes for the history log.
  const [pin] = await db
    .select({ id: pinsTable.id, companyId: pinsTable.companyId, claimStatus: pinsTable.claimStatus })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.user.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  // Manager+ only — field reps see the insurance tab read-only.
  const [profile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = profile?.role ?? 'field_rep';
  if (!isManagerOrAdmin(role)) {
    res.status(403).json({ error: 'Manager or above required to edit insurance data' });
    return;
  }

  const parsed = InsurancePatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
    return;
  }

  const d = parsed.data;

  // Determine whether claim_status is actually changing.
  // Conditions for writing a history row:
  //   1. claimStatus was present in the request body (d.claimStatus !== undefined)
  //   2. The incoming value (normalised to null) differs from the current value
  //   3. The incoming value is non-null  (to_status is NOT NULL; clearing the
  //      status is allowed but not journaled — "null" is not a meaningful enum)
  // Setting the SAME status again (including null → null) is a no-op.
  const incomingStatus = d.claimStatus !== undefined ? (d.claimStatus ?? null) : undefined;
  const statusChanging  =
    incomingStatus !== undefined &&
    incomingStatus !== null &&
    incomingStatus !== (pin.claimStatus ?? null);

  const updateSet = {
    ...(d.insuranceCarrier       !== undefined && { insuranceCarrier:       d.insuranceCarrier ?? null }),
    ...(d.policyNumber           !== undefined && { policyNumber:           d.policyNumber ?? null }),
    ...(d.policyHolder           !== undefined && { policyHolder:           d.policyHolder ?? null }),
    ...(d.coverageType           !== undefined && { coverageType:           d.coverageType ?? null }),
    ...(d.deductibleAmount       !== undefined && { deductibleAmount:       d.deductibleAmount ?? null }),
    ...(d.claimNumber            !== undefined && { claimNumber:            d.claimNumber ?? null }),
    ...(d.claimFiledDate         !== undefined && { claimFiledDate:         toDateOrNull(d.claimFiledDate) }),
    ...(d.dateOfLoss             !== undefined && { dateOfLoss:             toDateOrNull(d.dateOfLoss) }),
    ...(d.inspectionDate         !== undefined && { inspectionDate:         toDateOrNull(d.inspectionDate) }),
    ...(d.claimStatus            !== undefined && { claimStatus:            d.claimStatus ?? null }),
    ...(d.adjusterName           !== undefined && { adjusterName:           d.adjusterName ?? null }),
    ...(d.adjusterPhone          !== undefined && { adjusterPhone:          d.adjusterPhone ?? null }),
    ...(d.adjusterEmail          !== undefined && { adjusterEmail:          d.adjusterEmail ?? null }),
    ...(d.adjusterMeetingDate    !== undefined && { adjusterMeetingDate:    toDateOrNull(d.adjusterMeetingDate) }),
    ...(d.adjusterLastContact    !== undefined && { adjusterLastContact:    toDateOrNull(d.adjusterLastContact) }),
    ...(d.approvedRcvAmount      !== undefined && { approvedRcvAmount:      d.approvedRcvAmount ?? null }),
    ...(d.approvedAcvAmount      !== undefined && { approvedAcvAmount:      d.approvedAcvAmount ?? null }),
    ...(d.bettermentsAmountCents !== undefined && { bettermentsAmountCents: d.bettermentsAmountCents ?? null }),
    ...(d.supplementNotes        !== undefined && { supplementNotes:        d.supplementNotes ?? null }),
    updatedAt: new Date(),
  };

  // Always run inside a transaction so the pin update and the optional history
  // row are atomic — if either fails, neither lands.
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(pinsTable)
      .set(updateSet)
      .where(eq(pinsTable.id, pinId))
      .returning();

    if (statusChanging) {
      await tx.insert(claimStatusHistoryTable).values({
        companyId:        req.user!.companyId,
        pinId,
        fromStatus:       pin.claimStatus ?? null,
        toStatus:         incomingStatus!,
        changedByUserId:  req.user!.id,
      });
    }

    return rows;
  });

  res.json({ insurance: updated });
});

export default router;

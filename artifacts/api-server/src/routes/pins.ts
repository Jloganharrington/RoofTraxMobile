import {
  BulkCreatePinsBody,
  CreatePinBody,
  ListPinsResponse,
  CreatePinResponse,
  BulkCreatePinsResponse,
  DeletePinResponse,
  UpdatePinBody,
  UpdatePinResponse,
} from '@workspace/api-zod';
import {
  db,
  pinFinancialChangesTable,
  type PinFinancialChangeField,
  pinsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Router, type IRouter, type Request, type Response } from 'express';

import { reverseGeocode } from '../lib/geocode';
import { isManagerOrAdmin, resolve } from '@workspace/authz';
import { loadActorCtx, requirePermission } from '../middlewares/requirePermission';

/**
 * getRole — retained for calendar.ts, completionCertificates.ts, inspections.ts which
 * have not yet been migrated to requirePermission. Remove once those files are migrated.
 * @deprecated Use req.actorCtx!.role (from requirePermission middleware) instead.
 */
export async function getRole(userId: string) {
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  return profile?.role ?? 'field_rep';
}
import { notify } from '../lib/notify';

const router: IRouter = Router();

// lead.read (field_rep+): any authenticated company member may list/view leads.
router.get('/pins', requirePermission('lead.read'), async (req: Request, res: Response) => {
  const role = req.actorCtx!.role;
  const filterUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const companyId = req.actorCtx!.companyId;

  // Every role can see every pin in their own company now (field reps see
  // other reps' pins as read-only context, rendered grey client-side).
  // Only managers/admins may narrow the list to a single rep via ?userId=.
  const rows =
    filterUserId && isManagerOrAdmin(role)
      ? await db
          .select()
          .from(pinsTable)
          .where(
            and(eq(pinsTable.companyId, companyId), eq(pinsTable.userId, filterUserId)),
          )
          .orderBy(desc(pinsTable.createdAt))
      : await db
          .select()
          .from(pinsTable)
          .where(eq(pinsTable.companyId, companyId))
          .orderBy(desc(pinsTable.createdAt));

  res.json(ListPinsResponse.parse({ pins: rows }));
});

// lead.create (field_rep+): any authenticated company member may create a lead.
router.post('/pins', requirePermission('lead.create'), async (req: Request, res: Response) => {
  const parsed = CreatePinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid pin payload' });
    return;
  }

  const {
    latitude,
    longitude,
    workflow,
    damageType,
    photoUrl,
    doorKnockResult,
    retailData,
    contactOutcome,
    customerName,
    customerPhone,
    externalLeadSource,
  } = parsed.data;

  if (contactOutcome === 'call_to_schedule' && (!customerName || !customerPhone)) {
    res
      .status(400)
      .json({ error: 'Customer name and phone number are required to schedule a call' });
    return;
  }

  if (contactOutcome === 'no_soliciting' && !photoUrl) {
    res.status(400).json({
      error: 'A photo of the front of the home is required for Mailer Only outcomes',
    });
    return;
  }

  const address = await reverseGeocode(latitude, longitude);

  const [pin] = await db
    .insert(pinsTable)
    .values({
      userId: req.actorCtx!.actorId,
      companyId: req.actorCtx!.companyId,
      latitude,
      longitude,
      address,
      workflow,
      damageType,
      photoUrl,
      doorKnockResult,
      retailData,
      contactOutcome,
      customerName,
      customerPhone,
      externalLeadSource: externalLeadSource ?? null,
      // Initialise every new pin to 'pin_dropped' so it immediately appears in
      // the correct pipeline column without relying on the legacy status fallback.
      pipelineStage: 'pin_dropped',
    })
    .returning();

  res.status(201).json(CreatePinResponse.parse({ pin }));
});

// lead.bulk_create (field_rep+) — VERDICT CHANGE: was manager+, now any authenticated member.
// Registry intent: field reps may bulk-import from canvassing data.
router.post('/pins/bulk', requirePermission('lead.bulk_create'), async (req: Request, res: Response) => {
  const parsed = BulkCreatePinsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const created = [];
  for (const input of parsed.data.pins) {
    const address = await reverseGeocode(input.latitude, input.longitude);
    const [pin] = await db
      .insert(pinsTable)
      .values({
        userId: req.actorCtx!.actorId,
        companyId: req.actorCtx!.companyId,
        latitude: input.latitude,
        longitude: input.longitude,
        address,
        workflow: 'insurance',
        photoUrl: input.photoUrl,
      })
      .returning();
    created.push(pin);
  }

  res.status(201).json(BulkCreatePinsResponse.parse({ pins: created }));
});

// lead.update (ownerOrRole:manager+) — same behavior as canEditPin (pin owner or manager+).
router.patch('/pins/:pinId', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const pinId = req.params.pinId as string;
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, actorCtx.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  const result = resolve('lead.update', { ...actorCtx, ownerId: pin.userId });
  if (!result.allowed) {
    res.status(403).json({ error: 'Not permitted to edit this pin' });
    return;
  }

  const parsed = UpdatePinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid pin payload' });
    return;
  }

  const nextContactOutcome = parsed.data.contactOutcome ?? pin.contactOutcome;
  const nextCustomerName = parsed.data.customerName ?? pin.customerName;
  const nextCustomerPhone = parsed.data.customerPhone ?? pin.customerPhone;
  if (nextContactOutcome === 'call_to_schedule' && (!nextCustomerName || !nextCustomerPhone)) {
    res
      .status(400)
      .json({ error: 'Customer name and phone number are required to schedule a call' });
    return;
  }

  const nextPhotoUrl = parsed.data.photoUrl ?? pin.photoUrl;
  if (nextContactOutcome === 'no_soliciting' && !nextPhotoUrl) {
    res.status(400).json({
      error: 'A photo of the front of the home is required for Mailer Only outcomes',
    });
    return;
  }

  const [updated] = await db
    .update(pinsTable)
    .set({
      // updatedAt is always present so the set is never empty (Drizzle throws
      // on .set({})). Commission fields are NOT accepted here — see
      // PATCH /pins/:pinId/commissions in expenses.ts (bug-fix iii).
      updatedAt: new Date(),
      ...(parsed.data.workflow !== undefined && { workflow: parsed.data.workflow }),
      ...(parsed.data.damageType !== undefined && { damageType: parsed.data.damageType }),
      ...(parsed.data.photoUrl !== undefined && { photoUrl: parsed.data.photoUrl }),
      ...(parsed.data.doorKnockResult !== undefined && {
        doorKnockResult: parsed.data.doorKnockResult,
      }),
      ...(parsed.data.retailData !== undefined && { retailData: parsed.data.retailData }),
      ...(parsed.data.contactOutcome !== undefined && {
        contactOutcome: parsed.data.contactOutcome,
      }),
      ...(parsed.data.customerName !== undefined && { customerName: parsed.data.customerName }),
      ...(parsed.data.customerPhone !== undefined && {
        customerPhone: parsed.data.customerPhone,
      }),
    })
    .where(eq(pinsTable.id, pinId))
    .returning();

  res.json(UpdatePinResponse.parse({ pin: updated }));
});

// ---------------------------------------------------------------------------
// Lead Profile — zod schema for the full profile PATCH
// ---------------------------------------------------------------------------

export const LeadProfileBody = z.object({
  externalLeadSource:   z.string().nullable().optional(),
  projectManagerName:   z.string().nullable().optional(),
  ownerFirstName:       z.string().nullable().optional(),
  ownerLastName:        z.string().nullable().optional(),
  ownerEmail:           z.string().nullable().optional(),
  owner2FirstName:      z.string().nullable().optional(),
  owner2LastName:       z.string().nullable().optional(),
  customerName:         z.string().nullable().optional(),
  customerPhone:        z.string().nullable().optional(),
  notes:                z.string().nullable().optional(),
  // pipelineStage intentionally omitted — stage transitions must go through
  // PATCH /leads/:id/advance-stage. Accepting it here via canEditPin() would
  // let field reps bypass the advance-stage auth gate and skip gate logic.
  profileStatus:        z.string().nullable().optional(),
  statusNotes:          z.string().nullable().optional(),
  statusLastUpdated:    z.string().nullable().optional(),
  contractAmount:       z.string().nullable().optional(),
  // reason is required when any financial field (contractAmount | deductibleAmount |
  // rcvAmount) is present; enforced conditionally in the handler, not by Zod here.
  reason:               z.string().min(1).optional(),
  // depositAmount, depositDate, depositPaymentMethod, acvAmount,
  // supplementAmount, finalPaymentAmount removed — these are now managed
  // exclusively via the payments ledger (POST /pins/:pinId/payments).
  // Bug fix (iii): they must not remain as a second write path here.
  //
  // Insurance-specific fields (insuranceCarrier, policyNumber, claimNumber,
  // dateOfLoss, inspectionDate, adjusterName, adjusterPhone, adjusterEmail,
  // adjusterMeetingDate, claimFiledDate, policyHolder, coverageType,
  // approvedRcvAmount, approvedAcvAmount, depreciationAmount) removed from
  // this schema — they are now manager-only and written exclusively via
  // PATCH /pins/:pinId/insurance.  Accepting them here via canEditPin()
  // would let field reps bypass the insurance endpoint's auth gate.
  deductibleAmount:     z.string().nullable().optional(),
  rcvAmount:            z.string().nullable().optional(),
  contractScope:        z.string().nullable().optional(),
  squareFootage:        z.string().nullable().optional(),
  roofPitch:            z.string().nullable().optional(),
  measurementVendor:    z.string().nullable().optional(),
  measurementReportUrl: z.string().nullable().optional(),
  materialBrand:        z.string().nullable().optional(),
  materialColor:        z.string().nullable().optional(),
  materialStyle:        z.string().nullable().optional(),
  // Lead Dashboard fields
  nonOwnerOccupied:    z.boolean().nullable().optional(),
  mailingAddress:      z.string().nullable().optional(),
  mailingCity:         z.string().nullable().optional(),
  mailingState:        z.string().nullable().optional(),
  mailingZip:          z.string().nullable().optional(),
  mailerSentDate:      z.string().nullable().optional(),
  inspectionNotes:     z.string().nullable().optional(),
});

export function toDateOrNull(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// GET /pins/:pinId — full lead record with rep name — lead.read (field_rep+).
router.get('/pins/:pinId', requirePermission('lead.read'), async (req: Request, res: Response) => {
  const pinId = req.params.pinId as string;
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.actorCtx!.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  const [user] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, pin.userId));

  const repName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null
    : null;

  res.json({ lead: { ...pin, repName } });
});

// PATCH /pins/:pinId/profile — lead.update (ownerOrRole:manager+). Financial fields inside
// the handler still require manager+ explicitly (secondary inline check, not ownerOrRole).
router.patch('/pins/:pinId/profile', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const pinId = req.params.pinId as string;
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, actorCtx.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  const result = resolve('lead.update', { ...actorCtx, ownerId: pin.userId });
  if (!result.allowed) {
    res.status(403).json({ error: 'Not permitted to edit this pin' });
    return;
  }

  const parsed = LeadProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
    return;
  }

  const d = parsed.data;

  // Reject non-positive money amounts. Null means "clear the field" — allowed.
  // Prevents accidentally zeroing contract values via a stray PATCH.
  for (const [field, val] of [
    ['contractAmount',   d.contractAmount],
    ['deductibleAmount', d.deductibleAmount],
    ['rcvAmount',        d.rcvAmount],
  ] as [string, string | null | undefined][]) {
    if (val !== null && val !== undefined) {
      const n = parseFloat(val);
      if (isNaN(n) || n <= 0) {
        res.status(400).json({ error: `${field} must be a positive dollar amount (got: ${val})` });
        return;
      }
    }
  }

  // All three financial fields are manager-and-above; they flow into the
  // profitability view and are audited in pin_financial_changes.
  const financialPresent =
    d.contractAmount !== undefined ||
    d.deductibleAmount !== undefined ||
    d.rcvAmount !== undefined;

  if (financialPresent) {
    if (!isManagerOrAdmin(actorCtx.role)) {
      res.status(403).json({
        error: 'Only managers and above may change financial amounts (contractAmount, deductibleAmount, rcvAmount)',
      });
      return;
    }
    if (!d.reason?.trim()) {
      res.status(400).json({ error: 'reason is required when changing financial amounts' });
      return;
    }
  }

  const [updated] = await db
    .update(pinsTable)
    .set({
      ...(d.ownerFirstName       !== undefined && { ownerFirstName:       d.ownerFirstName }),
      ...(d.ownerLastName        !== undefined && { ownerLastName:        d.ownerLastName }),
      ...(d.ownerEmail           !== undefined && { ownerEmail:           d.ownerEmail }),
      ...(d.owner2FirstName      !== undefined && { owner2FirstName:      d.owner2FirstName }),
      ...(d.owner2LastName       !== undefined && { owner2LastName:       d.owner2LastName }),
      ...(d.customerName         !== undefined && { customerName:         d.customerName }),
      ...(d.customerPhone        !== undefined && { customerPhone:        d.customerPhone }),
      ...(d.notes                !== undefined && { notes:                d.notes }),
      ...(d.contractAmount       !== undefined && { contractAmount:       d.contractAmount }),
      ...(d.deductibleAmount     !== undefined && { deductibleAmount:     d.deductibleAmount }),
      ...(d.rcvAmount            !== undefined && { rcvAmount:            d.rcvAmount }),
      ...(d.contractScope        !== undefined && { contractScope:        d.contractScope }),
      ...(d.squareFootage        !== undefined && { squareFootage:        d.squareFootage }),
      ...(d.roofPitch            !== undefined && { roofPitch:            d.roofPitch }),
      ...(d.measurementVendor    !== undefined && { measurementVendor:    d.measurementVendor }),
      ...(d.measurementReportUrl !== undefined && { measurementReportUrl: d.measurementReportUrl }),
      ...(d.materialBrand        !== undefined && { materialBrand:        d.materialBrand }),
      ...(d.materialColor        !== undefined && { materialColor:        d.materialColor }),
      ...(d.materialStyle        !== undefined && { materialStyle:        d.materialStyle }),
      ...(d.profileStatus        !== undefined && { profileStatus:        d.profileStatus }),
      ...(d.statusNotes          !== undefined && { statusNotes:          d.statusNotes }),
      ...(d.statusLastUpdated    !== undefined && { statusLastUpdated:    d.statusLastUpdated ? new Date(d.statusLastUpdated) : null }),
      ...(d.externalLeadSource   !== undefined && { externalLeadSource:   d.externalLeadSource }),
      ...(d.projectManagerName   !== undefined && { projectManagerName:   d.projectManagerName }),
      updatedAt: new Date(),
    })
    .where(eq(pinsTable.id, pinId))
    .returning();

  // Audit: insert a row for each financial field that actually changed.
  if (financialPresent) {
    const auditFields: { key: 'contractAmount' | 'deductibleAmount' | 'rcvAmount'; col: PinFinancialChangeField }[] = [
      { key: 'contractAmount',   col: 'contract_amount'   },
      { key: 'deductibleAmount', col: 'deductible_amount' },
      { key: 'rcvAmount',        col: 'rcv_amount'        },
    ];
    const rows = auditFields
      .filter(({ key }) => d[key] !== undefined && d[key] !== pin[key])
      .map(({ key, col }) => ({
        companyId:         req.actorCtx!.companyId,
        pinId,
        field:             col,
        oldValue:          pin[key] ?? null,
        newValue:          d[key] ?? null,
        changedByUserId:   req.actorCtx!.actorId,
        reason:            d.reason as string,
      }));
    if (rows.length > 0) {
      await db.insert(pinFinancialChangesTable).values(rows);
    }
  }

  const [user] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, pin.userId));

  const repName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null
    : null;

  res.json({ lead: { ...updated, repName } });
});

// GET /pins/:pinId/financial-changes — audit log (manager+ only)
// profitability.view (manager+): only managers can view financial change history.
router.get('/pins/:pinId/financial-changes', requirePermission('profitability.view'), async (req: Request, res: Response) => {
  const pinId = req.params.pinId as string;
  const [pin] = await db
    .select({ id: pinsTable.id })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.actorCtx!.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  const changes = await db
    .select()
    .from(pinFinancialChangesTable)
    .where(eq(pinFinancialChangesTable.pinId, pinId))
    .orderBy(desc(pinFinancialChangesTable.changedAt));

  res.json({ changes });
});

// ── Retail appointment booking ─────────────────────────────────────────────
// PATCH /pins/:pinId/appointment
// Sets, reassigns, reschedules, or marks a retail appointment. At least one
// field must be supplied. Completing an appointment is server-controlled:
// the endpoint sets appointment_status='completed'; the client never supplies
// a completion timestamp.

const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'canceled', 'no_show'] as const;
type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

const SetAppointmentBody = z
  .object({
    appointmentAt:         z.coerce.date().nullable().optional(),
    appointmentAssignedTo: z.string().min(1).nullable().optional(),
    appointmentStatus:     z.enum(APPOINTMENT_STATUSES).nullable().optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.appointmentAt !== undefined ||
      d.appointmentAssignedTo !== undefined ||
      d.appointmentStatus !== undefined,
    { message: 'At least one of appointmentAt, appointmentAssignedTo, or appointmentStatus is required' },
  );

// lead.set_appointment (ownerOrRole:manager+) — same behavior as canEditPin.
router.patch('/pins/:pinId/appointment', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const pinId = req.params.pinId as string;
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, actorCtx.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  const result = resolve('lead.set_appointment', { ...actorCtx, ownerId: pin.userId });
  if (!result.allowed) {
    res.status(403).json({ error: 'Not permitted to edit this pin' });
    return;
  }

  const parsed = SetAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid payload' });
    return;
  }

  const d = parsed.data;

  // Build the update set — only include supplied fields.
  // appointmentAt and appointmentAssignedTo accept null (to clear them).
  // appointmentStatus also accepts null (to clear it).
  // Completing an appointment is server-controlled: we set the status but do
  // NOT accept a client-supplied completion timestamp.
  const updateSet: Partial<typeof pinsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (d.appointmentAt !== undefined)         updateSet.appointmentAt         = d.appointmentAt;
  if (d.appointmentAssignedTo !== undefined) updateSet.appointmentAssignedTo = d.appointmentAssignedTo;
  if (d.appointmentStatus !== undefined)     updateSet.appointmentStatus     = d.appointmentStatus as AppointmentStatus | null;

  const [updated] = await db
    .update(pinsTable)
    .set(updateSet)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.actorCtx!.companyId)))
    .returning();

  res.json({
    pinId:                  updated.id,
    appointmentAt:          updated.appointmentAt?.toISOString() ?? null,
    appointmentAssignedTo:  updated.appointmentAssignedTo ?? null,
    appointmentStatus:      updated.appointmentStatus ?? null,
  });

  // Notify the assignee when a retail appointment is assigned (or reassigned)
  // to them. Only fires when appointmentAssignedTo is being set (non-null) and
  // it is actually changing — prevents self-notification noise on other field updates.
  if (
    d.appointmentAssignedTo &&
    d.appointmentAssignedTo !== pin.appointmentAssignedTo
  ) {
    void notify({
      type:        'appointment_assigned',
      companyId:   req.actorCtx!.companyId,
      pinId:       pinId,
      actorUserId: req.actorCtx!.actorId,
    });
  }
});

// lead.delete (manager+): only managers can delete a lead.
router.delete('/pins/:pinId', requirePermission('lead.delete'), async (req: Request, res: Response) => {
  const pinId = req.params.pinId as string;
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.actorCtx!.companyId)));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  await db.delete(pinsTable).where(eq(pinsTable.id, pinId));
  res.json(DeletePinResponse.parse({ success: true }));
});

export default router;

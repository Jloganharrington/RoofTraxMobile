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
import { db, pinsTable, userProfilesTable, usersTable } from '@workspace/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Router, type IRouter, type Request, type Response } from 'express';

import { reverseGeocode } from '../lib/geocode';
import { canDeletePin, canEditPin, isManagerOrAdmin } from '../lib/permissions';

const router: IRouter = Router();

export async function getRole(userId: string) {
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  return profile?.role ?? 'field_rep';
}

router.get('/pins', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const role = await getRole(req.user.id);
  const filterUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const companyId = req.user.companyId;

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

router.post('/pins', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

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
      userId: req.user.id,
      companyId: req.user.companyId,
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

router.post('/pins/bulk', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const role = await getRole(req.user.id);
  if (!isManagerOrAdmin(role)) {
    res.status(403).json({ error: 'Only managers/admins can bulk-upload pins' });
    return;
  }

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
        userId: req.user.id,
        companyId: req.user.companyId,
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

router.patch('/pins/:pinId', async (req: Request, res: Response) => {
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

  const role = await getRole(req.user.id);
  if (!canEditPin(role, req.user.id, pin.userId)) {
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
  pipelineStage:        z.string().nullable().optional(),
  profileStatus:        z.string().nullable().optional(),
  statusNotes:          z.string().nullable().optional(),
  statusLastUpdated:    z.string().nullable().optional(),
  insuranceCarrier:     z.string().nullable().optional(),
  policyNumber:         z.string().nullable().optional(),
  claimNumber:          z.string().nullable().optional(),
  dateOfLoss:           z.string().nullable().optional(),
  inspectionDate:       z.string().nullable().optional(),
  adjusterName:         z.string().nullable().optional(),
  adjusterPhone:        z.string().nullable().optional(),
  adjusterEmail:        z.string().nullable().optional(),
  adjusterMeetingDate:  z.string().nullable().optional(),
  contractAmount:       z.string().nullable().optional(),
  depositAmount:        z.string().nullable().optional(),
  depositDate:          z.string().nullable().optional(),
  depositPaymentMethod: z.string().nullable().optional(),
  deductibleAmount:     z.string().nullable().optional(),
  rcvAmount:            z.string().nullable().optional(),
  acvAmount:            z.string().nullable().optional(),
  supplementAmount:     z.string().nullable().optional(),
  finalPaymentAmount:   z.string().nullable().optional(),
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
  claimFiledDate:      z.string().nullable().optional(),
  policyHolder:        z.string().nullable().optional(),
  coverageType:        z.string().nullable().optional(),
  approvedRcvAmount:   z.string().nullable().optional(),
  approvedAcvAmount:   z.string().nullable().optional(),
  depreciationAmount:  z.string().nullable().optional(),
  inspectionNotes:     z.string().nullable().optional(),
});

export function toDateOrNull(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// GET /pins/:pinId — full lead record with rep name
router.get('/pins/:pinId', async (req: Request, res: Response) => {
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

  const [user] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, pin.userId));

  const repName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null
    : null;

  res.json({ lead: { ...pin, repName } });
});

// PATCH /pins/:pinId/profile — update lead profile fields
router.patch('/pins/:pinId/profile', async (req: Request, res: Response) => {
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

  const role = await getRole(req.user.id);
  if (!canEditPin(role, req.user.id, pin.userId)) {
    res.status(403).json({ error: 'Not permitted to edit this pin' });
    return;
  }

  const parsed = LeadProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
    return;
  }

  const d = parsed.data;
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
      ...(d.pipelineStage        !== undefined && { pipelineStage:        d.pipelineStage }),
      ...(d.insuranceCarrier     !== undefined && { insuranceCarrier:     d.insuranceCarrier }),
      ...(d.policyNumber         !== undefined && { policyNumber:         d.policyNumber }),
      ...(d.claimNumber          !== undefined && { claimNumber:          d.claimNumber }),
      ...(d.dateOfLoss           !== undefined && { dateOfLoss:           toDateOrNull(d.dateOfLoss) }),
      ...(d.inspectionDate       !== undefined && { inspectionDate:       toDateOrNull(d.inspectionDate) }),
      ...(d.adjusterName         !== undefined && { adjusterName:         d.adjusterName }),
      ...(d.adjusterPhone        !== undefined && { adjusterPhone:        d.adjusterPhone }),
      ...(d.adjusterEmail        !== undefined && { adjusterEmail:        d.adjusterEmail }),
      ...(d.adjusterMeetingDate  !== undefined && { adjusterMeetingDate:  toDateOrNull(d.adjusterMeetingDate) }),
      ...(d.contractAmount       !== undefined && { contractAmount:       d.contractAmount }),
      ...(d.depositAmount        !== undefined && { depositAmount:        d.depositAmount }),
      ...(d.depositDate          !== undefined && { depositDate:          toDateOrNull(d.depositDate) }),
      ...(d.depositPaymentMethod !== undefined && { depositPaymentMethod: d.depositPaymentMethod }),
      ...(d.deductibleAmount     !== undefined && { deductibleAmount:     d.deductibleAmount }),
      ...(d.rcvAmount            !== undefined && { rcvAmount:            d.rcvAmount }),
      ...(d.acvAmount            !== undefined && { acvAmount:            d.acvAmount }),
      ...(d.supplementAmount     !== undefined && { supplementAmount:     d.supplementAmount }),
      ...(d.finalPaymentAmount   !== undefined && { finalPaymentAmount:   d.finalPaymentAmount }),
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
    })
    .where(eq(pinsTable.id, pinId))
    .returning();

  const [user] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, pin.userId));

  const repName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null
    : null;

  res.json({ lead: { ...updated, repName } });
});

router.delete('/pins/:pinId', async (req: Request, res: Response) => {
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

  const role = await getRole(req.user.id);
  if (!canDeletePin(role)) {
    res.status(403).json({ error: 'Not permitted to delete this pin' });
    return;
  }

  await db.delete(pinsTable).where(eq(pinsTable.id, pinId));
  res.json(DeletePinResponse.parse({ success: true }));
});

export default router;

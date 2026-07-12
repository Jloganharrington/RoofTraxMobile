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
import { db, pinsTable, userProfilesTable } from '@workspace/db';
import { and, desc, eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { reverseGeocode } from '../lib/geocode';
import { canEditPin, isManagerOrAdmin } from '../lib/permissions';

const router: IRouter = Router();

async function getRole(userId: string) {
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
  if (!canEditPin(role, req.user.id, pin.userId)) {
    res.status(403).json({ error: 'Not permitted to delete this pin' });
    return;
  }

  await db.delete(pinsTable).where(eq(pinsTable.id, pinId));
  res.json(DeletePinResponse.parse({ success: true }));
});

export default router;

import {
  BulkCreatePinsBody,
  CreatePinBody,
  ListPinsResponse,
  CreatePinResponse,
  BulkCreatePinsResponse,
  DeletePinResponse,
} from '@workspace/api-zod';
import { db, pinsTable, userProfilesTable } from '@workspace/db';
import { desc, eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { reverseGeocode } from '../lib/geocode';
import { isManagerOrAdmin } from '../lib/permissions';

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
  const rows = isManagerOrAdmin(role)
    ? await db.select().from(pinsTable).orderBy(desc(pinsTable.createdAt))
    : await db
        .select()
        .from(pinsTable)
        .where(eq(pinsTable.userId, req.user.id))
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

  const { latitude, longitude, workflow, damageType, photoUrl, doorKnockResult, retailData } =
    parsed.data;

  if (workflow === 'insurance' && !photoUrl) {
    res.status(400).json({ error: 'A photo of the front of the home is required' });
    return;
  }

  const address = await reverseGeocode(latitude, longitude);

  const [pin] = await db
    .insert(pinsTable)
    .values({
      userId: req.user.id,
      latitude,
      longitude,
      address,
      workflow,
      damageType,
      photoUrl,
      doorKnockResult,
      retailData,
    })
    .returning();

  res.status(201).json(CreatePinResponse.parse({ pin }));
});

router.post('/pins/bulk', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
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

router.delete('/pins/:pinId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const pinId = req.params.pinId as string;
  const [pin] = await db.select().from(pinsTable).where(eq(pinsTable.id, pinId));

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  const role = await getRole(req.user.id);
  if (pin.userId !== req.user.id && !isManagerOrAdmin(role)) {
    res.status(403).json({ error: 'Not permitted to delete this pin' });
    return;
  }

  await db.delete(pinsTable).where(eq(pinsTable.id, pinId));
  res.json(DeletePinResponse.parse({ success: true }));
});

export default router;

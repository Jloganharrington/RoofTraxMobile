import {
  PingLocationBody,
  PingLocationResponse,
  ListTeamLocationsResponse,
} from '@workspace/api-zod';
import { db, userLocationsTable, userProfilesTable, usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { isManagerOrAdmin } from '../lib/permissions';

const router: IRouter = Router();

router.post('/location/ping', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = PingLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const { latitude, longitude } = parsed.data;

  await db
    .insert(userLocationsTable)
    .values({ userId: req.user.id, latitude, longitude })
    .onConflictDoUpdate({
      target: userLocationsTable.userId,
      set: { latitude, longitude, updatedAt: new Date() },
    });

  res.json(PingLocationResponse.parse({ success: true }));
});

router.get('/location/team', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = profile?.role ?? 'field_rep';
  if (!isManagerOrAdmin(role)) {
    res.status(403).json({ error: 'Manager/admin role required' });
    return;
  }

  const rows = await db
    .select({
      userId: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      latitude: userLocationsTable.latitude,
      longitude: userLocationsTable.longitude,
      updatedAt: userLocationsTable.updatedAt,
    })
    .from(userLocationsTable)
    .innerJoin(usersTable, eq(usersTable.id, userLocationsTable.userId));

  res.json(ListTeamLocationsResponse.parse({ locations: rows }));
});

export default router;

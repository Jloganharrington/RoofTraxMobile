/**
 * Location routes.
 *
 * Permission keys (from lib/authz registry):
 *   (none) — POST /location/ping    auth-only; any authenticated member
 *   team.view — manager+            GET /location/team
 */
import {
  PingLocationBody,
  PingLocationResponse,
  ListTeamLocationsResponse,
} from '@workspace/api-zod';
import { db, userLocationsTable, usersTable, canvassingSessionsTable } from '@workspace/db';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { requirePermission } from '../middlewares/requirePermission';

const router: IRouter = Router();

// ── POST /location/ping — auth-only ───────────────────────────────────────────

// location.ping
router.post('/location/ping', requirePermission('location.ping'), async (req: Request, res: Response) => {

  const parsed = PingLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const { latitude, longitude } = parsed.data;

  await db
    .insert(userLocationsTable)
    .values({ userId: req.actorCtx!.actorId, companyId: req.actorCtx!.companyId, latitude, longitude })
    .onConflictDoUpdate({
      target: userLocationsTable.userId,
      set: { latitude, longitude, updatedAt: new Date() },
    });

  res.json(PingLocationResponse.parse({ success: true }));
});

// ── GET /location/team — team.view (manager+) ─────────────────────────────────

router.get('/location/team', requirePermission('team.view'), async (req: Request, res: Response) => {
  const { companyId } = req.actorCtx!;

  const rows = await db
    .select({
      userId:     usersTable.id,
      firstName:  usersTable.firstName,
      lastName:   usersTable.lastName,
      latitude:   userLocationsTable.latitude,
      longitude:  userLocationsTable.longitude,
      updatedAt:  userLocationsTable.updatedAt,
      isClockedIn: isNotNull(canvassingSessionsTable.id),
    })
    .from(userLocationsTable)
    .innerJoin(usersTable, eq(usersTable.id, userLocationsTable.userId))
    .leftJoin(
      canvassingSessionsTable,
      and(
        eq(canvassingSessionsTable.userId, userLocationsTable.userId),
        isNull(canvassingSessionsTable.endedAt),
      ),
    )
    .where(eq(usersTable.companyId, companyId));

  res.json(ListTeamLocationsResponse.parse({ locations: rows }));
});

export default router;

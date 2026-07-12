import {
  GetAdminStatsResponse,
  ListTeamUsersResponse,
  UpdateTeamUserBody,
  UpdateTeamUserResponse,
  RemoveTeamUserResponse,
} from '@workspace/api-zod';
import { db, pinsTable, userProfilesTable, usersTable } from '@workspace/db';
import { eq, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { canManageUser, isManagerOrAdmin } from '../lib/permissions';

const router: IRouter = Router();

async function requireManagerOrAdmin(req: Request, res: Response) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = profile?.role ?? 'field_rep';
  if (!isManagerOrAdmin(role)) {
    res.status(403).json({ error: 'Manager/admin role required' });
    return null;
  }

  return role;
}

router.get('/admin/stats', async (req: Request, res: Response) => {
  const role = await requireManagerOrAdmin(req, res);
  if (!role) return;

  const [totals] = await db
    .select({
      totalPins: sql<number>`count(*)`,
      insurancePins: sql<number>`count(*) filter (where ${pinsTable.workflow} = 'insurance')`,
      retailPins: sql<number>`count(*) filter (where ${pinsTable.workflow} = 'retail')`,
      appointments: sql<number>`count(*) filter (where ${pinsTable.doorKnockResult} = 'appointment')`,
    })
    .from(pinsTable);

  const [{ fieldRepCount }] = await db
    .select({ fieldRepCount: sql<number>`count(*)` })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.role, 'field_rep'));

  res.json(
    GetAdminStatsResponse.parse({
      stats: {
        totalPins: Number(totals?.totalPins ?? 0),
        insurancePins: Number(totals?.insurancePins ?? 0),
        retailPins: Number(totals?.retailPins ?? 0),
        appointments: Number(totals?.appointments ?? 0),
        fieldRepCount: Number(fieldRepCount ?? 0),
      },
    }),
  );
});

router.get('/admin/users', async (req: Request, res: Response) => {
  const role = await requireManagerOrAdmin(req, res);
  if (!role) return;

  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
      createdAt: usersTable.createdAt,
      role: userProfilesTable.role,
      workflowAssignment: userProfilesTable.workflowAssignment,
      pinCount: sql<number>`(select count(*) from ${pinsTable} where ${pinsTable.userId} = ${usersTable.id})`,
    })
    .from(usersTable)
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id));

  res.json(
    ListTeamUsersResponse.parse({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        profileImageUrl: row.profileImageUrl,
        role: row.role ?? 'field_rep',
        workflowAssignment: row.workflowAssignment ?? 'insurance',
        pinCount: Number(row.pinCount ?? 0),
        joinedAt: row.createdAt,
      })),
    }),
  );
});

router.patch('/admin/users/:userId', async (req: Request, res: Response) => {
  const actorRole = await requireManagerOrAdmin(req, res);
  if (!actorRole) return;

  const userId = req.params.userId as string;
  const parsed = UpdateTeamUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const [targetUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const [targetProfile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  const targetRole = targetProfile?.role ?? 'field_rep';

  if (
    !canManageUser(
      actorRole,
      req.user!.id,
      userId,
      targetRole,
      parsed.data.role,
    )
  ) {
    res.status(403).json({ error: 'Not permitted to perform this update' });
    return;
  }

  const [updated] = await db
    .insert(userProfilesTable)
    .values({
      userId,
      role: parsed.data.role ?? targetRole,
      workflowAssignment:
        parsed.data.workflowAssignment ??
        targetProfile?.workflowAssignment ??
        'insurance',
    })
    .onConflictDoUpdate({
      target: userProfilesTable.userId,
      set: {
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(parsed.data.workflowAssignment
          ? { workflowAssignment: parsed.data.workflowAssignment }
          : {}),
        updatedAt: new Date(),
      },
    })
    .returning();

  const [{ pinCount }] = await db
    .select({ pinCount: sql<number>`count(*)` })
    .from(pinsTable)
    .where(eq(pinsTable.userId, userId));

  res.json(
    UpdateTeamUserResponse.parse({
      user: {
        id: targetUser.id,
        email: targetUser.email,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        profileImageUrl: targetUser.profileImageUrl,
        role: updated.role,
        workflowAssignment: updated.workflowAssignment,
        pinCount: Number(pinCount ?? 0),
        joinedAt: targetUser.createdAt,
      },
    }),
  );
});

router.delete('/admin/users/:userId', async (req: Request, res: Response) => {
  const actorRole = await requireManagerOrAdmin(req, res);
  if (!actorRole) return;

  const userId = req.params.userId as string;
  const [targetUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const [targetProfile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  const targetRole = targetProfile?.role ?? 'field_rep';

  if (!canManageUser(actorRole, req.user!.id, userId, targetRole)) {
    res.status(403).json({ error: 'Not permitted to remove this user' });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, userId));
  res.json(RemoveTeamUserResponse.parse({ success: true }));
});

export default router;

/**
 * Team roster and org-stats routes.
 *
 * Permission keys (from lib/authz registry):
 *   team.view_stats — admin+    — GET /admin/stats           (PD-1)
 *   team.view       — manager+  — GET /team/users
 *   team.edit       — manager+  — PATCH /team/users/:userId  (+ actorOutranks via canSetRoleDeptSpec)
 *   team.delete     — manager+  — DELETE /team/users/:userId (+ actorOutranks via canSetRoleDeptSpec)
 */
import {
  GetAdminStatsResponse,
  ListTeamUsersResponse,
  UpdateTeamUserBody,
  UpdateTeamUserResponse,
  RemoveTeamUserResponse,
} from '@workspace/api-zod';
import { db, pinsTable, userProfilesTable, usersTable } from '@workspace/db';
import { and, eq, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { canSetRoleDeptSpec, canSetWorkflow } from '@workspace/authz';
import { requirePermission } from '../middlewares/requirePermission';

const router: IRouter = Router();

// ── GET /admin/stats — team.view_stats (admin+) ───────────────────────────────

router.get('/admin/stats', requirePermission('team.view_stats'), async (req: Request, res: Response) => {
  const { companyId } = req.actorCtx!;

  const [totals] = await db
    .select({
      totalPins:     sql<number>`count(*)`,
      insurancePins: sql<number>`count(*) filter (where ${pinsTable.workflow} = 'insurance')`,
      retailPins:    sql<number>`count(*) filter (where ${pinsTable.workflow} = 'retail')`,
      appointments:  sql<number>`count(*) filter (where ${pinsTable.doorKnockResult} = 'appointment')`,
    })
    .from(pinsTable)
    .where(eq(pinsTable.companyId, companyId));

  const [{ fieldRepCount }] = await db
    .select({ fieldRepCount: sql<number>`count(*)` })
    .from(userProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, userProfilesTable.userId))
    .where(
      and(
        eq(userProfilesTable.role, 'field_rep'),
        eq(usersTable.companyId, companyId),
      ),
    );

  res.json(
    GetAdminStatsResponse.parse({
      stats: {
        totalPins:     Number(totals?.totalPins ?? 0),
        insurancePins: Number(totals?.insurancePins ?? 0),
        retailPins:    Number(totals?.retailPins ?? 0),
        appointments:  Number(totals?.appointments ?? 0),
        fieldRepCount: Number(fieldRepCount ?? 0),
      },
    }),
  );
});

// ── GET /team/users — team.view (manager+) ────────────────────────────────────

router.get('/team/users', requirePermission('team.view'), async (req: Request, res: Response) => {
  const { companyId } = req.actorCtx!;

  const rows = await db
    .select({
      id:                 usersTable.id,
      email:              usersTable.email,
      firstName:          usersTable.firstName,
      lastName:           usersTable.lastName,
      profileImageUrl:    usersTable.profileImageUrl,
      createdAt:          usersTable.createdAt,
      role:               userProfilesTable.role,
      workflowAssignment: userProfilesTable.workflowAssignment,
      department:         userProfilesTable.department,
      pinCount:           sql<number>`(select count(*) from ${pinsTable} where ${pinsTable.userId} = ${usersTable.id})`,
    })
    .from(usersTable)
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
    .where(eq(usersTable.companyId, companyId));

  res.json(
    ListTeamUsersResponse.parse({
      users: rows.map((row) => ({
        id:                 row.id,
        email:              row.email,
        firstName:          row.firstName,
        lastName:           row.lastName,
        profileImageUrl:    row.profileImageUrl,
        role:               row.role ?? 'field_rep',
        workflowAssignment: row.workflowAssignment ?? 'insurance_retail',
        department:         row.department ?? 'canvasser',
        pinCount:           Number(row.pinCount ?? 0),
        joinedAt:           row.createdAt,
      })),
    }),
  );
});

// ── PATCH /team/users/:userId — team.edit (manager+, + actorOutranks) ─────────

router.patch('/team/users/:userId', requirePermission('team.edit'), async (req: Request, res: Response) => {
  const { companyId, role: actorRole } = req.actorCtx!;
  const userId = req.params.userId as string;

  const parsed = UpdateTeamUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  // Cross-company targets are treated as not found — never leak their
  // existence, and never let a role-hierarchy check even run against them.
  const [targetUser] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
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
    (parsed.data.role !== undefined || parsed.data.department !== undefined) &&
    !canSetRoleDeptSpec(actorRole, req.user!.id, userId, targetRole, {
      role: parsed.data.role,
    })
  ) {
    res.status(403).json({ error: 'Not permitted to change this role or department' });
    return;
  }

  if (
    parsed.data.workflowAssignment !== undefined &&
    !canSetWorkflow(actorRole, req.user!.id, userId, targetRole)
  ) {
    res.status(403).json({ error: 'Not permitted to change this workflow assignment' });
    return;
  }

  const [updated] = await db
    .insert(userProfilesTable)
    .values({
      userId,
      role:               parsed.data.role ?? targetRole,
      workflowAssignment: parsed.data.workflowAssignment ?? targetProfile?.workflowAssignment ?? 'insurance_retail',
      department:         parsed.data.department ?? targetProfile?.department ?? 'canvasser',
    })
    .onConflictDoUpdate({
      target: userProfilesTable.userId,
      set: {
        ...(parsed.data.role               ? { role:               parsed.data.role               } : {}),
        ...(parsed.data.workflowAssignment ? { workflowAssignment: parsed.data.workflowAssignment } : {}),
        ...(parsed.data.department         ? { department:         parsed.data.department         } : {}),
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
        id:                 targetUser.id,
        email:              targetUser.email,
        firstName:          targetUser.firstName,
        lastName:           targetUser.lastName,
        profileImageUrl:    targetUser.profileImageUrl,
        role:               updated.role,
        workflowAssignment: updated.workflowAssignment,
        department:         updated.department,
        pinCount:           Number(pinCount ?? 0),
        joinedAt:           targetUser.createdAt,
      },
    }),
  );
});

// ── DELETE /team/users/:userId — team.delete (manager+, + actorOutranks) ──────

router.delete('/team/users/:userId', requirePermission('team.delete'), async (req: Request, res: Response) => {
  const { companyId, role: actorRole } = req.actorCtx!;
  const userId = req.params.userId as string;

  const [targetUser] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const [targetProfile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  const targetRole = targetProfile?.role ?? 'field_rep';

  if (!canSetRoleDeptSpec(actorRole, req.user!.id, userId, targetRole)) {
    res.status(403).json({ error: 'Not permitted to remove this user' });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, userId));
  res.json(RemoveTeamUserResponse.parse({ success: true }));
});

export default router;

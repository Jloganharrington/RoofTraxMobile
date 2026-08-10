/**
 * Team roster, org-stats, manager assignment, and per-user permission override routes.
 *
 * Permission keys (from lib/authz registry):
 *   team.view_stats         — admin+    — GET /admin/stats           (PD-1)
 *   team.view               — manager+  — GET /team/users
 *   team.edit               — manager+  — PATCH /team/users/:userId  (+ actorOutranks via canSetRoleDeptSpec)
 *   team.delete             — manager+  — DELETE /team/users/:userId (+ actorOutranks via canSetRoleDeptSpec)
 *   team.assign_manager     — admin+    — PATCH /team/users/:userId/manager    (Step 4)
 *   team.view               — manager+  — GET /team/users/:userId/permissions  (Step 5)
 *   team.override_permissions — admin+  — POST /team/users/:userId/permissions (Step 5)
 *   team.override_permissions — admin+  — DELETE /team/users/:userId/permissions/:permissionKey (Step 5)
 */
import {
  GetAdminStatsResponse,
  ListTeamUsersResponse,
  UpdateTeamUserBody,
  UpdateTeamUserResponse,
  RemoveTeamUserResponse,
} from '@workspace/api-zod';
import {
  db,
  pinsTable,
  userPermissionOverridesTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { and, eq, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { PERMISSION_KEYS, PERMISSION_REGISTRY, canSetRoleDeptSpec, canSetWorkflow, resolve } from '@workspace/authz';
import {
  loadPermissionOverrides,
  requirePermission,
} from '../middlewares/requirePermission';

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
    !canSetRoleDeptSpec(actorRole, req.actorCtx!.actorId, userId, targetRole, {
      role: parsed.data.role,
    })
  ) {
    res.status(403).json({ error: 'Not permitted to change this role or department' });
    return;
  }

  if (
    parsed.data.workflowAssignment !== undefined &&
    !canSetWorkflow(actorRole, req.actorCtx!.actorId, userId, targetRole)
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

  if (!canSetRoleDeptSpec(actorRole, req.actorCtx!.actorId, userId, targetRole)) {
    res.status(403).json({ error: 'Not permitted to remove this user' });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, userId));
  res.json(RemoveTeamUserResponse.parse({ success: true }));
});

// ── PATCH /team/users/:userId/manager — team.assign_manager (admin+) ─────────
// Step 4: set or clear a user's direct reporting manager.
// Body: { managerUserId: string | null }

router.patch('/team/users/:userId/manager', requirePermission('team.assign_manager'), async (req: Request, res: Response) => {
  const { companyId } = req.actorCtx!;
  const userId = req.params.userId as string;

  const newManagerId: string | null = req.body?.managerUserId ?? null;

  // Verify target user is in the same company.
  const [targetUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Prevent self-assignment.
  if (newManagerId !== null && newManagerId === userId) {
    res.status(400).json({ error: 'A user cannot be their own manager.' });
    return;
  }

  if (newManagerId !== null) {
    // Verify manager exists in same company and is manager+.
    const [managerRow] = await db
      .select({ id: usersTable.id, role: userProfilesTable.role })
      .from(usersTable)
      .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
      .where(and(eq(usersTable.id, newManagerId), eq(usersTable.companyId, companyId)));
    if (!managerRow) {
      res.status(404).json({ error: 'Manager user not found in this company.' });
      return;
    }
    const managerRole = managerRow.role ?? 'field_rep';
    if (!['manager', 'admin', 'super_admin'].includes(managerRole)) {
      res.status(400).json({ error: 'The assigned manager must have at least a manager role.' });
      return;
    }
  }

  // Upsert the manager assignment.
  await db
    .insert(userProfilesTable)
    .values({ userId, managerUserId: newManagerId })
    .onConflictDoUpdate({
      target: userProfilesTable.userId,
      set: { managerUserId: newManagerId, updatedAt: new Date() },
    });

  res.json({ success: true, managerUserId: newManagerId });
});

// ── GET /team/users/:userId/permissions — team.view (manager+) ────────────────
// Step 5: view the effective permission set for a team member, including
// any per-user overrides and the computed effective access decision.

router.get('/team/users/:userId/permissions', requirePermission('team.view'), async (req: Request, res: Response) => {
  const { companyId } = req.actorCtx!;
  const userId = req.params.userId as string;

  // Verify target user is in same company.
  const [targetUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Load target user's profile for role/department (needed for resolve()).
  const [profile] = await db
    .select({ role: userProfilesTable.role, department: userProfilesTable.department, workflowAssignment: userProfilesTable.workflowAssignment })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  const targetCtx = {
    actorId:            userId,
    role:               (profile?.role ?? 'field_rep') as Parameters<typeof resolve>[1]['role'],
    department:         profile?.department ?? null,
    workflowAssignment: profile?.workflowAssignment ?? null,
  };

  // Load overrides for the target user (not the requesting actor).
  const overrideRows = await db
    .select({
      permission:      userPermissionOverridesTable.permission,
      granted:         userPermissionOverridesTable.granted,
      note:            userPermissionOverridesTable.note,
      grantedByUserId: userPermissionOverridesTable.grantedByUserId,
      createdAt:       userPermissionOverridesTable.createdAt,
    })
    .from(userPermissionOverridesTable)
    .where(
      and(
        eq(userPermissionOverridesTable.companyId, companyId),
        eq(userPermissionOverridesTable.userId, userId),
      ),
    );

  const overrideMap = new Map(overrideRows.map(r => [r.permission, r]));

  const permissions = PERMISSION_REGISTRY.map(entry => {
    const override = overrideMap.get(entry.key);
    let effective: boolean;
    let reason: string;
    if (override !== undefined) {
      effective = override.granted;
      reason = override.granted
        ? `explicit grant by ${override.grantedByUserId}`
        : `explicit revoke by ${override.grantedByUserId}`;
    } else {
      const result = resolve(entry.key, targetCtx);
      effective = result.allowed;
      reason = result.reason;
    }
    return {
      key:      entry.key,
      domain:   entry.domain,
      label:    entry.label,
      default:  entry.default,
      note:     entry.note ?? null,
      override: override
        ? {
            granted:         override.granted,
            note:            override.note ?? null,
            grantedByUserId: override.grantedByUserId,
            createdAt:       override.createdAt,
          }
        : null,
      effective,
      reason,
    };
  });

  res.json({ userId, permissions });
});

// ── POST /team/users/:userId/permissions — team.override_permissions (admin+) ─
// Step 5: add or replace a per-user permission override.
// Body: { permission: string, granted: boolean, note?: string }
// Invariant: cannot grant a permission the actor does not hold.

router.post('/team/users/:userId/permissions', requirePermission('team.override_permissions'), async (req: Request, res: Response) => {
  const { companyId, actorId: grantedByUserId } = req.actorCtx!;
  const userId = req.params.userId as string;

  // Validate body.
  const { permission, granted, note } = req.body ?? {};
  if (typeof permission !== 'string' || !(PERMISSION_KEYS as readonly string[]).includes(permission)) {
    res.status(400).json({ error: `'permission' must be a valid permission key.` });
    return;
  }
  if (typeof granted !== 'boolean') {
    res.status(400).json({ error: `'granted' must be a boolean.` });
    return;
  }

  // Verify target user is in same company.
  const [targetUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // "Cannot grant what you do not hold" — only applies when granting.
  if (granted) {
    // loadPermissionOverrides uses req.permissionOverrides cache (actor's own overrides).
    const actorOverrides = await loadPermissionOverrides(req, grantedByUserId, companyId);
    const actorOverride = actorOverrides.get(permission);
    let actorHolds: boolean;
    if (actorOverride !== undefined) {
      actorHolds = actorOverride;
    } else {
      const [actorProfile] = await db
        .select({ role: userProfilesTable.role, department: userProfilesTable.department, workflowAssignment: userProfilesTable.workflowAssignment })
        .from(userProfilesTable)
        .where(eq(userProfilesTable.userId, grantedByUserId));
      actorHolds = resolve(permission as Parameters<typeof resolve>[0], {
        actorId:            grantedByUserId,
        role:               (actorProfile?.role ?? 'field_rep') as Parameters<typeof resolve>[1]['role'],
        department:         actorProfile?.department ?? null,
        workflowAssignment: actorProfile?.workflowAssignment ?? null,
      }).allowed;
    }
    if (!actorHolds) {
      res.status(403).json({ error: `Cannot grant '${permission}' — you do not hold this permission yourself.` });
      return;
    }
  }

  // Upsert the override.
  const [row] = await db
    .insert(userPermissionOverridesTable)
    .values({
      companyId,
      userId,
      permission,
      granted,
      grantedByUserId,
      note: typeof note === 'string' ? note : null,
    })
    .onConflictDoUpdate({
      target: [
        userPermissionOverridesTable.companyId,
        userPermissionOverridesTable.userId,
        userPermissionOverridesTable.permission,
      ],
      set: {
        granted,
        grantedByUserId,
        note:      typeof note === 'string' ? note : null,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.status(201).json({ override: row });
});

// ── DELETE /team/users/:userId/permissions/:permissionKey — team.override_permissions ──
// Step 5: remove a per-user permission override, restoring the registry default.

router.delete('/team/users/:userId/permissions/:permissionKey', requirePermission('team.override_permissions'), async (req: Request, res: Response) => {
  const { companyId } = req.actorCtx!;
  const userId = req.params.userId as string;
  const permissionKey = req.params.permissionKey as string;

  // Verify target user is in same company.
  const [targetUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  await db
    .delete(userPermissionOverridesTable)
    .where(
      and(
        eq(userPermissionOverridesTable.companyId, companyId),
        eq(userPermissionOverridesTable.userId, userId),
        eq(userPermissionOverridesTable.permission, permissionKey),
      ),
    );

  res.json({ success: true });
});

export default router;

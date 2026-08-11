/**
 * Team roster, org-stats, manager assignment, and per-user permission override routes.
 *
 * Permission keys (from lib/authz registry):
 *   team.view_stats           — admin+    — GET /admin/stats                                   (PD-1)
 *   team.view_stats           — admin+    — GET /team/users/blocked-purge-report
 *   team.view                 — manager+  — GET /team/users
 *   team.edit                 — manager+  — PATCH /team/users/:userId  (+ actorOutranks via canSetRoleDeptSpec)
 *   team.delete               — super_admin — DELETE /team/users/:userId (+ actorOutranks via canSetRoleDeptSpec)
 *   team.terminate            — manager+  — POST /team/users/:userId/terminate (+ actorOutranks)
 *   team.terminate            — manager+  — POST /team/users/:userId/reassign  (+ actorOutranks)
 *   team.assign_manager       — admin+    — PATCH /team/users/:userId/manager    (Step 4)
 *   team.view                 — manager+  — GET /team/users/:userId/permissions  (Step 5)
 *   team.override_permissions — admin+    — POST /team/users/:userId/permissions (Step 5)
 *   team.override_permissions — admin+    — DELETE /team/users/:userId/permissions/:permissionKey (Step 5)
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
  changeOrdersTable,
  completionCertificatesTable,
  deactivationSweepLogTable,
  inspectionsTable,
  pinsTable,
  sessionsTable,
  userPermissionOverridesTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { notify } from '../lib/notify';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
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

// ── GET /team/users — team.view (manager+) ────────────────────────────────────
// ?showDeactivated=true includes soft-deleted users (greyed in UI).
// Default excludes them: deactivated users don't appear in assignment pickers.

router.get('/team/users', requirePermission('team.view'), async (req: Request, res: Response) => {
  const { companyId } = req.actorCtx!;
  const showDeactivated = req.query.showDeactivated === 'true';

  const rows = await db
    .select({
      id:                 usersTable.id,
      email:              usersTable.email,
      firstName:          usersTable.firstName,
      lastName:           usersTable.lastName,
      profileImageUrl:    usersTable.profileImageUrl,
      createdAt:          usersTable.createdAt,
      deactivatedAt:      usersTable.deactivatedAt,
      role:               userProfilesTable.role,
      workflowAssignment: userProfilesTable.workflowAssignment,
      department:         userProfilesTable.department,
      pinCount:           sql<number>`(select count(*) from ${pinsTable} where ${pinsTable.userId} = ${usersTable.id})`,
    })
    .from(usersTable)
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
    .where(
      and(
        eq(usersTable.companyId, companyId),
        showDeactivated ? undefined : isNull(usersTable.deactivatedAt),
      ),
    );

  // ListTeamUsersResponse.parse() strips unknown fields, so deactivatedAt
  // must be included after the schema-validated core — return raw JSON.
  res.json({
    users: rows.map((row) => ({
      id:                 row.id,
      email:              row.email ?? null,
      firstName:          row.firstName ?? null,
      lastName:           row.lastName ?? null,
      profileImageUrl:    row.profileImageUrl ?? null,
      role:               row.role ?? 'field_rep',
      workflowAssignment: row.workflowAssignment ?? 'insurance_retail',
      department:         row.department ?? 'canvasser',
      pinCount:           Number(row.pinCount ?? 0),
      joinedAt:           row.createdAt,
      deactivatedAt:      row.deactivatedAt ?? null,
    })),
  });
});

// ── GET /team/users/blocked-purge-report — team.view_stats (admin+) ─────────
// Returns users whose 30-day PII purge is blocked (latest sweep log entry is
// 'blocked' and no subsequent 'purge_30d' entry exists).
// IMPORTANT: registered before the /:userId wildcard routes so Express does not
// treat "blocked-purge-report" as a userId parameter.

router.get('/team/users/blocked-purge-report', requirePermission('team.view_stats'), async (req: Request, res: Response) => {
  const { companyId } = req.actorCtx!;

  // Get all user IDs for this company that have been successfully purged.
  const purgedRows = await db
    .select({ userId: deactivationSweepLogTable.userId })
    .from(deactivationSweepLogTable)
    .where(
      and(
        eq(deactivationSweepLogTable.companyId, companyId),
        eq(deactivationSweepLogTable.actionTaken, 'purge_30d'),
      ),
    );
  const purgedSet = new Set(purgedRows.map((r) => r.userId));

  // All blocked entries for this company, most-recent first.
  const blockedRows = await db
    .select({
      userId:        deactivationSweepLogTable.userId,
      daysSince:     deactivationSweepLogTable.daysSince,
      blockedReason: deactivationSweepLogTable.blockedReason,
      lastAttemptAt: deactivationSweepLogTable.processedAt,
      email:         usersTable.email,
      firstName:     usersTable.firstName,
      lastName:      usersTable.lastName,
      deactivatedAt: usersTable.deactivatedAt,
    })
    .from(deactivationSweepLogTable)
    .innerJoin(usersTable, eq(usersTable.id, deactivationSweepLogTable.userId))
    .where(
      and(
        eq(deactivationSweepLogTable.companyId, companyId),
        eq(deactivationSweepLogTable.actionTaken, 'blocked'),
      ),
    )
    .orderBy(sql`${deactivationSweepLogTable.processedAt} DESC`);

  // Deduplicate to latest entry per user; exclude already-purged users.
  const seen = new Set<string>();
  const report = [];
  for (const row of blockedRows) {
    if (purgedSet.has(row.userId)) continue;
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    report.push({
      userId:        row.userId,
      email:         row.email          ?? null,
      firstName:     row.firstName      ?? null,
      lastName:      row.lastName       ?? null,
      deactivatedAt: row.deactivatedAt  ?? null,
      daysSince:     row.daysSince,
      blockedReason: row.blockedReason  ?? null,
      lastAttemptAt: row.lastAttemptAt,
    });
  }

  res.json({ report });
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

// ── DELETE /team/users/:userId — team.delete (super_admin only) ────────────────
// Hard delete. Only reachable when the ownership inventory is fully empty —
// all leads reassigned, no inspections, no appointments, no signed documents.
// Normal termination path is POST /team/users/:userId/terminate (team.edit).

router.delete('/team/users/:userId', requirePermission('team.delete'), async (req: Request, res: Response) => {
  const { companyId, actorId } = req.actorCtx!;
  const userId = req.params.userId as string;

  if (userId === actorId) {
    res.status(400).json({ error: 'Cannot delete your own account.' });
    return;
  }

  const [targetUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // All inventory categories must be zero before hard delete is allowed.
  const [leadCount, drCount, inspCount, apptCount, cocCount] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(pinsTable)
      .where(and(eq(pinsTable.userId, userId), eq(pinsTable.companyId, companyId))),
    db.select({ n: sql<number>`count(*)` }).from(userProfilesTable)
      .where(eq(userProfilesTable.managerUserId, userId)),
    db.select({ n: sql<number>`count(*)` }).from(inspectionsTable)
      .where(and(eq(inspectionsTable.inspectorUserId, userId), eq(inspectionsTable.companyId, companyId))),
    db.select({ n: sql<number>`count(*)` }).from(pinsTable)
      .where(and(eq(pinsTable.appointmentAssignedTo, userId), eq(pinsTable.companyId, companyId))),
    db.select({ n: sql<number>`count(*)` }).from(completionCertificatesTable)
      .where(eq(completionCertificatesTable.signedByUserId, userId)),
  ]);

  const inventory = {
    leads:           Number(leadCount[0]?.n   ?? 0),
    directReports:   Number(drCount[0]?.n     ?? 0),
    inspections:     Number(inspCount[0]?.n   ?? 0),
    appointments:    Number(apptCount[0]?.n   ?? 0),
    signedDocuments: Number(cocCount[0]?.n    ?? 0),
  };
  const totalHeld = Object.values(inventory).reduce((a, b) => a + b, 0);
  if (totalHeld > 0) {
    res.status(409).json({
      error: 'User still holds records. Use POST /team/users/:id/terminate to reassign first.',
      inventory,
    });
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

// ── GET /team/users/:userId/inventory — team.view (manager+) ─────────────────
// Returns what a user holds: leads, direct reports, active inspections,
// scheduled appointments, open change orders, and signed documents.
// The manager reviews this before calling POST …/terminate.

router.get('/team/users/:userId/inventory', requirePermission('team.view'), async (req: Request, res: Response) => {
  const { companyId } = req.actorCtx!;
  const userId = req.params.userId as string;

  const [targetUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }

  const ACTIVE_STATUSES = ['scheduled', 'capturing', 'validating'] as const;

  const [leads, directReports, inspections, appointments, openCOs, cocsRows, cosRows] =
    await Promise.all([
      db.select({ id: pinsTable.id, address: pinsTable.address, pipelineStage: pinsTable.pipelineStage, createdAt: pinsTable.createdAt })
        .from(pinsTable)
        .where(and(eq(pinsTable.userId, userId), eq(pinsTable.companyId, companyId))),

      db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, role: userProfilesTable.role })
        .from(userProfilesTable)
        .innerJoin(usersTable, eq(usersTable.id, userProfilesTable.userId))
        .where(eq(userProfilesTable.managerUserId, userId)),

      db.select({ id: inspectionsTable.id, address: inspectionsTable.address, status: inspectionsTable.status, createdAt: inspectionsTable.createdAt })
        .from(inspectionsTable)
        .where(and(
          eq(inspectionsTable.inspectorUserId, userId),
          eq(inspectionsTable.companyId, companyId),
          inArray(inspectionsTable.status, [...ACTIVE_STATUSES]),
        )),

      db.select({ id: pinsTable.id, address: pinsTable.address, appointmentAt: pinsTable.appointmentAt, appointmentStatus: pinsTable.appointmentStatus })
        .from(pinsTable)
        .where(and(
          eq(pinsTable.appointmentAssignedTo, userId),
          eq(pinsTable.companyId, companyId),
          eq(pinsTable.appointmentStatus, 'scheduled'),
        )),

      db.select({ id: changeOrdersTable.id, pinId: changeOrdersTable.pinId, amountCents: changeOrdersTable.amountCents, status: changeOrdersTable.status, createdAt: changeOrdersTable.createdAt })
        .from(changeOrdersTable)
        .where(and(
          eq(changeOrdersTable.createdByUserId, userId),
          eq(changeOrdersTable.status, 'pending'),
          isNull(changeOrdersTable.voidedAt),
          eq(changeOrdersTable.companyId, companyId),
        )),

      db.select({ id: completionCertificatesTable.id, pinId: completionCertificatesTable.pinId, signedAt: completionCertificatesTable.signedAt })
        .from(completionCertificatesTable)
        .where(and(
          eq(completionCertificatesTable.signedByUserId, userId),
          eq(completionCertificatesTable.companyId, companyId),
          isNotNull(completionCertificatesTable.signedAt),
        )),

      db.select({ id: changeOrdersTable.id, pinId: changeOrdersTable.pinId, signedAt: changeOrdersTable.repSignedAt })
        .from(changeOrdersTable)
        .where(and(
          eq(changeOrdersTable.createdByUserId, userId),
          isNotNull(changeOrdersTable.repSignedAt),
          isNull(changeOrdersTable.voidedAt),
          eq(changeOrdersTable.companyId, companyId),
        )),
    ]);

  const signedDocuments = [
    ...cocsRows.map(r => ({ type: 'coc'          as const, id: r.id, pinId: r.pinId,    signedAt: r.signedAt })),
    ...cosRows .map(r => ({ type: 'change_order'  as const, id: r.id, pinId: r.pinId,    signedAt: r.signedAt })),
  ];

  res.json({
    userId,
    leads:            { count: leads.length,           items: leads },
    directReports:    { count: directReports.length,   items: directReports },
    inspections:      { count: inspections.length,     items: inspections },
    appointments:     { count: appointments.length,    items: appointments },
    openChangeOrders: { count: openCOs.length,         items: openCOs },
    signedDocuments:  { count: signedDocuments.length, items: signedDocuments },
  });
});

// ── POST /team/users/:userId/terminate — team.terminate (manager+, actorOutranks) ──
// Deactivates immediately. Reassignment targets in the body are applied
// optimistically (if count > 0 for that category and a target is given,
// reassign; otherwise leave unassigned). Sessions are purged after commit.
// If inventory remains after deactivation, the terminated user's direct
// manager (or all admins as fallback) receives a staff_deactivated email.
//
// Body (all optional):
//   leadOwnerId?:           string — new owner for leads
//   reportManagerUserId?:   string — new manager for direct reports
//   inspectionAssigneeId?:  string — new assignee for active inspections
//   appointmentAssigneeId?: string — new assignee for scheduled appointments

router.post('/team/users/:userId/terminate', requirePermission('team.terminate'), async (req: Request, res: Response) => {
  const { companyId, role: actorRole, actorId } = req.actorCtx!;
  const userId = req.params.userId as string;

  if (userId === actorId) {
    res.status(400).json({ error: 'Cannot terminate your own account.' });
    return;
  }

  const [targetUser] = await db
    .select({ id: usersTable.id, deactivatedAt: usersTable.deactivatedAt })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }
  if (targetUser.deactivatedAt !== null) {
    res.status(409).json({ error: 'User is already deactivated.' });
    return;
  }

  const [targetProfile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  const targetRole = (targetProfile?.role ?? 'field_rep') as Parameters<typeof canSetRoleDeptSpec>[0];
  if (!canSetRoleDeptSpec(actorRole, actorId, userId, targetRole)) {
    res.status(403).json({ error: 'Not permitted to terminate this user.' });
    return;
  }

  // Parse reassignment targets from body (all optional).
  const body                  = (req.body ?? {}) as Record<string, string | null>;
  const leadOwnerId           = body.leadOwnerId           ?? null;
  const reportManagerUserId   = body.reportManagerUserId   ?? null;
  const inspectionAssigneeId  = body.inspectionAssigneeId  ?? null;
  const appointmentAssigneeId = body.appointmentAssigneeId ?? null;

  const ACTIVE_STATUSES = ['scheduled', 'capturing', 'validating'] as const;

  // Load current inventory counts.
  const [lc, drc, ic, ac] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(pinsTable)
      .where(and(eq(pinsTable.userId, userId), eq(pinsTable.companyId, companyId))),
    db.select({ n: sql<number>`count(*)` }).from(userProfilesTable)
      .where(eq(userProfilesTable.managerUserId, userId)),
    db.select({ n: sql<number>`count(*)` }).from(inspectionsTable)
      .where(and(eq(inspectionsTable.inspectorUserId, userId), eq(inspectionsTable.companyId, companyId), inArray(inspectionsTable.status, [...ACTIVE_STATUSES]))),
    db.select({ n: sql<number>`count(*)` }).from(pinsTable)
      .where(and(eq(pinsTable.appointmentAssignedTo, userId), eq(pinsTable.companyId, companyId), eq(pinsTable.appointmentStatus, 'scheduled'))),
  ]);
  const counts = {
    leads:         Number(lc[0]?.n  ?? 0),
    directReports: Number(drc[0]?.n ?? 0),
    inspections:   Number(ic[0]?.n  ?? 0),
    appointments:  Number(ac[0]?.n  ?? 0),
  };

  // Validate provided assignees: same company, not deactivated, not the terminated user.
  const uniqueAssigneeIds = [...new Set(
    [leadOwnerId, reportManagerUserId, inspectionAssigneeId, appointmentAssigneeId]
      .filter((id): id is string => !!id && id !== userId),
  )];
  if (uniqueAssigneeIds.length > 0) {
    const valid = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.id, uniqueAssigneeIds), eq(usersTable.companyId, companyId), isNull(usersTable.deactivatedAt)));
    const validSet = new Set(valid.map((r) => r.id));
    const allProvided = [leadOwnerId, reportManagerUserId, inspectionAssigneeId, appointmentAssigneeId].filter(Boolean) as string[];
    for (const id of allProvided) {
      if (id === userId) { res.status(400).json({ error: 'Cannot reassign to the user being terminated.' }); return; }
      if (!validSet.has(id)) { res.status(400).json({ error: `Assignee ${id} not found or is deactivated.` }); return; }
    }
  }

  // Atomic: apply optional partial reassignment + deactivate.
  await db.transaction(async (tx) => {
    if (leadOwnerId && counts.leads > 0) {
      await tx.update(pinsTable)
        .set({ userId: leadOwnerId, updatedAt: new Date() })
        .where(and(eq(pinsTable.userId, userId), eq(pinsTable.companyId, companyId)));
    }
    if (reportManagerUserId && counts.directReports > 0) {
      await tx.update(userProfilesTable)
        .set({ managerUserId: reportManagerUserId, updatedAt: new Date() })
        .where(eq(userProfilesTable.managerUserId, userId));
    }
    if (inspectionAssigneeId && counts.inspections > 0) {
      await tx.update(inspectionsTable)
        .set({ inspectorUserId: inspectionAssigneeId })
        .where(and(eq(inspectionsTable.inspectorUserId, userId), eq(inspectionsTable.companyId, companyId), inArray(inspectionsTable.status, [...ACTIVE_STATUSES])));
    }
    if (appointmentAssigneeId && counts.appointments > 0) {
      await tx.update(pinsTable)
        .set({ appointmentAssignedTo: appointmentAssigneeId, updatedAt: new Date() })
        .where(and(eq(pinsTable.appointmentAssignedTo, userId), eq(pinsTable.companyId, companyId), eq(pinsTable.appointmentStatus, 'scheduled')));
    }
    await tx.update(usersTable)
      .set({ deactivatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  });

  // Revoke sessions. Best-effort: deactivated_at is the authoritative gate so
  // any surviving session token gets 401 on the next request.
  try {
    await db.execute(sql`DELETE FROM sessions WHERE sess->'user'->>'id' = ${userId}`);
  } catch {
    // Non-fatal.
  }

  // Compute remaining inventory after optional partial reassignment.
  const remainingLeads         = leadOwnerId          ? 0 : counts.leads;
  const remainingDirectReports = reportManagerUserId  ? 0 : counts.directReports;
  const remainingInspections   = inspectionAssigneeId ? 0 : counts.inspections;
  const remainingAppointments  = appointmentAssigneeId ? 0 : counts.appointments;
  const inventoryRemaining =
    remainingLeads + remainingDirectReports + remainingInspections + remainingAppointments > 0;

  if (inventoryRemaining) {
    void notify({
      type:         'staff_deactivated',
      companyId,
      targetUserId: userId,
      actorUserId:  actorId,
      payload: {
        remainingLeads,
        remainingDirectReports,
        remainingInspections,
        remainingAppointments,
      },
    });
  }

  res.json({ success: true, deactivatedAt: new Date().toISOString(), counts, inventoryRemaining });
});

// ── POST /team/users/:userId/reassign — team.terminate (manager+, actorOutranks) ──
// Reassigns inventory from an already-deactivated user. Works regardless of
// whether the user was just deactivated or has been deactivated for weeks.
// All reassignment targets are optional — only provided categories are moved.
//
// Body (all optional):
//   leadOwnerId?:           string — new owner for leads
//   reportManagerUserId?:   string — new manager for direct reports
//   inspectionAssigneeId?:  string — new assignee for active inspections
//   appointmentAssigneeId?: string — new assignee for scheduled appointments

router.post('/team/users/:userId/reassign', requirePermission('team.terminate'), async (req: Request, res: Response) => {
  const { companyId, role: actorRole, actorId } = req.actorCtx!;
  const userId = req.params.userId as string;

  if (userId === actorId) {
    res.status(400).json({ error: 'Cannot reassign yourself.' });
    return;
  }

  const [targetUser] = await db
    .select({ id: usersTable.id, deactivatedAt: usersTable.deactivatedAt })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }
  if (targetUser.deactivatedAt === null) {
    res.status(409).json({ error: 'User is not deactivated. Use POST /team/users/:userId/terminate to deactivate first.' });
    return;
  }

  const [targetProfile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  const targetRole = (targetProfile?.role ?? 'field_rep') as Parameters<typeof canSetRoleDeptSpec>[0];
  if (!canSetRoleDeptSpec(actorRole, actorId, userId, targetRole)) {
    res.status(403).json({ error: 'Not permitted to reassign this user\'s inventory.' });
    return;
  }

  // Parse reassignment targets from body (all optional).
  const body                  = (req.body ?? {}) as Record<string, string | null>;
  const leadOwnerId           = body.leadOwnerId           ?? null;
  const reportManagerUserId   = body.reportManagerUserId   ?? null;
  const inspectionAssigneeId  = body.inspectionAssigneeId  ?? null;
  const appointmentAssigneeId = body.appointmentAssigneeId ?? null;

  const ACTIVE_STATUSES = ['scheduled', 'capturing', 'validating'] as const;

  // Validate provided assignees: same company, not deactivated, not the target user.
  const uniqueAssigneeIds = [...new Set(
    [leadOwnerId, reportManagerUserId, inspectionAssigneeId, appointmentAssigneeId]
      .filter((id): id is string => !!id && id !== userId),
  )];
  if (uniqueAssigneeIds.length > 0) {
    const valid = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.id, uniqueAssigneeIds), eq(usersTable.companyId, companyId), isNull(usersTable.deactivatedAt)));
    const validSet = new Set(valid.map((r) => r.id));
    const allProvided = [leadOwnerId, reportManagerUserId, inspectionAssigneeId, appointmentAssigneeId].filter(Boolean) as string[];
    for (const id of allProvided) {
      if (id === userId) { res.status(400).json({ error: 'Cannot reassign to the user being reassigned.' }); return; }
      if (!validSet.has(id)) { res.status(400).json({ error: `Assignee ${id} not found or is deactivated.` }); return; }
    }
  }

  // Load current inventory counts.
  const [lc, drc, ic, ac] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(pinsTable)
      .where(and(eq(pinsTable.userId, userId), eq(pinsTable.companyId, companyId))),
    db.select({ n: sql<number>`count(*)` }).from(userProfilesTable)
      .where(eq(userProfilesTable.managerUserId, userId)),
    db.select({ n: sql<number>`count(*)` }).from(inspectionsTable)
      .where(and(eq(inspectionsTable.inspectorUserId, userId), eq(inspectionsTable.companyId, companyId), inArray(inspectionsTable.status, [...ACTIVE_STATUSES]))),
    db.select({ n: sql<number>`count(*)` }).from(pinsTable)
      .where(and(eq(pinsTable.appointmentAssignedTo, userId), eq(pinsTable.companyId, companyId), eq(pinsTable.appointmentStatus, 'scheduled'))),
  ]);
  const countsBefore = {
    leads:         Number(lc[0]?.n  ?? 0),
    directReports: Number(drc[0]?.n ?? 0),
    inspections:   Number(ic[0]?.n  ?? 0),
    appointments:  Number(ac[0]?.n  ?? 0),
  };

  // Apply partial reassignments atomically.
  await db.transaction(async (tx) => {
    if (leadOwnerId && countsBefore.leads > 0) {
      await tx.update(pinsTable)
        .set({ userId: leadOwnerId, updatedAt: new Date() })
        .where(and(eq(pinsTable.userId, userId), eq(pinsTable.companyId, companyId)));
    }
    if (reportManagerUserId && countsBefore.directReports > 0) {
      await tx.update(userProfilesTable)
        .set({ managerUserId: reportManagerUserId, updatedAt: new Date() })
        .where(eq(userProfilesTable.managerUserId, userId));
    }
    if (inspectionAssigneeId && countsBefore.inspections > 0) {
      await tx.update(inspectionsTable)
        .set({ inspectorUserId: inspectionAssigneeId })
        .where(and(eq(inspectionsTable.inspectorUserId, userId), eq(inspectionsTable.companyId, companyId), inArray(inspectionsTable.status, [...ACTIVE_STATUSES])));
    }
    if (appointmentAssigneeId && countsBefore.appointments > 0) {
      await tx.update(pinsTable)
        .set({ appointmentAssignedTo: appointmentAssigneeId, updatedAt: new Date() })
        .where(and(eq(pinsTable.appointmentAssignedTo, userId), eq(pinsTable.companyId, companyId), eq(pinsTable.appointmentStatus, 'scheduled')));
    }
  });

  // Return updated inventory counts.
  const [lc2, drc2, ic2, ac2] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(pinsTable)
      .where(and(eq(pinsTable.userId, userId), eq(pinsTable.companyId, companyId))),
    db.select({ n: sql<number>`count(*)` }).from(userProfilesTable)
      .where(eq(userProfilesTable.managerUserId, userId)),
    db.select({ n: sql<number>`count(*)` }).from(inspectionsTable)
      .where(and(eq(inspectionsTable.inspectorUserId, userId), eq(inspectionsTable.companyId, companyId), inArray(inspectionsTable.status, [...ACTIVE_STATUSES]))),
    db.select({ n: sql<number>`count(*)` }).from(pinsTable)
      .where(and(eq(pinsTable.appointmentAssignedTo, userId), eq(pinsTable.companyId, companyId), eq(pinsTable.appointmentStatus, 'scheduled'))),
  ]);
  const countsAfter = {
    leads:         Number(lc2[0]?.n  ?? 0),
    directReports: Number(drc2[0]?.n ?? 0),
    inspections:   Number(ic2[0]?.n  ?? 0),
    appointments:  Number(ac2[0]?.n  ?? 0),
  };

  res.json({ success: true, counts: countsAfter });
});

export default router;

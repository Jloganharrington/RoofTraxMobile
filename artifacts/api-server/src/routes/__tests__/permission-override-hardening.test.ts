/**
 * permission-override-hardening.test.ts
 *
 * Tests for the hardened POST /team/users/:userId/permissions and
 * DELETE /team/users/:userId/permissions/:permissionKey routes, plus
 * the new GET /team/users/:userId/permissions/history endpoint.
 *
 * 13 cases asserting HTTP status + DB side-effect verification.
 * The 130-test negative suite must not change verdicts.
 *
 * Authority rules under test:
 *   – floor/selfOnly permissions → 422
 *   – note required → 400
 *   – self-action → 403
 *   – rank gate (canSetRoleDeptSpec) → 403 for equal/higher targets
 *   – manager-assignment gate → 403 for unassigned targets
 *   – must-hold (both grant AND revoke) → 403 when actor lacks the permission
 *   – DELETE clearing-a-revoke that restores default-allow → 403 when actor lacks
 *   – full lifecycle writes 3 audit rows with correct from/to states
 */

import {
  companiesTable,
  db,
  permissionOverrideChangesTable,
  userPermissionOverridesTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `perm-hard-${Date.now().toString(36)}`;

interface Actor { id: string; sid: string; }

interface Fixture {
  companyId:       string;
  superAdmin:      Actor;
  admin:           Actor;
  manager:         Actor;
  assignedRep:     Actor;   // field_rep with managerUserId = manager.id
  unassignedRep:   Actor;   // field_rep with no manager
  adminLacksLead:  Actor;   // admin who has lead.read explicitly revoked
  company2:        string;
  rep2:            Actor;   // field_rep in company2 (for cross-tenant)
}

let fix: Fixture;
const createdUserIds: string[]    = [];
const createdCompanyIds: string[] = [];

async function seedUser(
  companyId: string,
  role: string,
  tag: string,
  managerUserId?: string,
): Promise<Actor> {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `poh-${tag}-${RUN_ID}@example.test` })
    .returning();
  await db.insert(userProfilesTable).values({
    userId: user.id,
    role:   role as never,
    ...(managerUserId ? { managerUserId } : {}),
  });
  const sid = await createSession({
    user: {
      id:              user.id,
      email:           user.email,
      firstName:       user.firstName,
      lastName:        user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
    access_token: 'test-token',
  });
  createdUserIds.push(user.id);
  return { id: user.id, sid };
}

beforeAll(async () => {
  const companyId  = `POH-${RUN_ID}`.toUpperCase().slice(0, 40);
  const company2Id = `POH2-${RUN_ID}`.toUpperCase().slice(0, 40);
  createdCompanyIds.push(companyId, company2Id);

  await db.insert(companiesTable).values([
    { id: companyId,  name: `POH Test ${RUN_ID}` },
    { id: company2Id, name: `POH Test2 ${RUN_ID}` },
  ]);

  const [superAdmin, admin, manager] = await Promise.all([
    seedUser(companyId, 'super_admin', 'sa'),
    seedUser(companyId, 'admin',       'adm'),
    seedUser(companyId, 'manager',     'mgr'),
  ]);

  const [assignedRep, unassignedRep, adminLacksLead, rep2] = await Promise.all([
    seedUser(companyId, 'field_rep', 'arep', manager.id),
    seedUser(companyId, 'field_rep', 'urep'),
    seedUser(companyId, 'admin',     'adm2'), // will have lead.read revoked
    seedUser(company2Id,'field_rep', 'rep2'),
  ]);

  // Directly insert a revoke override for adminLacksLead on lead.read
  // to simulate "actor doesn't hold lead.read".
  await db.insert(userPermissionOverridesTable).values({
    companyId,
    userId:          adminLacksLead.id,
    permission:      'lead.read',
    granted:         false,
    grantedByUserId: superAdmin.id,
    note:            'test-setup: revoke lead.read for adminLacksLead',
  });

  fix = {
    companyId,
    superAdmin,
    admin,
    manager,
    assignedRep,
    unassignedRep,
    adminLacksLead,
    company2: company2Id,
    rep2,
  };
});

afterAll(async () => {
  // Delete overrides and history rows first (FK), then users, then companies.
  await db.delete(userPermissionOverridesTable).where(
    inArray(userPermissionOverridesTable.userId, createdUserIds),
  );
  await db.delete(permissionOverrideChangesTable).where(
    inArray(permissionOverrideChangesTable.targetUserId, createdUserIds),
  );
  await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  await db.delete(companiesTable).where(inArray(companiesTable.id, createdCompanyIds));
});

function auth(sid: string) { return { Authorization: `Bearer ${sid}` }; }

// ── Helper: count override rows for a target user + permission ─────────────────
async function overrideCount(targetId: string, permission: string) {
  const rows = await db
    .select({ id: userPermissionOverridesTable.id })
    .from(userPermissionOverridesTable)
    .where(and(
      eq(userPermissionOverridesTable.userId, targetId),
      eq(userPermissionOverridesTable.permission, permission),
    ));
  return rows.length;
}

// ── Helper: count audit rows for a target user + permission ───────────────────
async function auditCount(targetId: string, permission: string) {
  const rows = await db
    .select({ id: permissionOverrideChangesTable.id })
    .from(permissionOverrideChangesTable)
    .where(and(
      eq(permissionOverrideChangesTable.targetUserId, targetId),
      eq(permissionOverrideChangesTable.permission, permission),
    ));
  return rows.length;
}

// ── Helper: get the latest audit entry for a target user + permission ─────────
async function latestAudit(targetId: string, permission: string) {
  const rows = await db
    .select()
    .from(permissionOverrideChangesTable)
    .where(and(
      eq(permissionOverrideChangesTable.targetUserId, targetId),
      eq(permissionOverrideChangesTable.permission, permission),
    ));
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows[0] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 1 — note validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C1] POST: missing / empty / whitespace note → 400, no override row', () => {
  it('missing note → 400', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.unassignedRep.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'lead.read', granted: true });
    expect(res.status).toBe(400);
  });

  it('empty string note → 400', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.unassignedRep.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'lead.read', granted: true, note: '' });
    expect(res.status).toBe(400);
  });

  it('whitespace-only note → 400', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.unassignedRep.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'lead.read', granted: true, note: '   ' });
    expect(res.status).toBe(400);
  });

  it('no override row written for any 400 case', async () => {
    expect(await overrideCount(fix.unassignedRep.id, 'lead.read')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 2 — floor permission rejection
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C2] POST: floor permission (profile.read) → 422, no row', () => {
  it('grant floor permission → 422', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.unassignedRep.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'profile.read', granted: true, note: 'test' });
    expect(res.status).toBe(422);
  });

  it('revoke floor permission → 422', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.unassignedRep.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'profile.read', granted: false, note: 'test' });
    expect(res.status).toBe(422);
  });

  it('no override row written', async () => {
    expect(await overrideCount(fix.unassignedRep.id, 'profile.read')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 3 — selfOnly permission rejection
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C3] POST: selfOnly permission (profile.update) → 422, no row', () => {
  it('grant selfOnly permission → 422', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.unassignedRep.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'profile.update', granted: true, note: 'test' });
    expect(res.status).toBe(422);
  });

  it('revoke selfOnly permission → 422', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.unassignedRep.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'profile.update', granted: false, note: 'test' });
    expect(res.status).toBe(422);
  });

  it('no override row written', async () => {
    expect(await overrideCount(fix.unassignedRep.id, 'profile.update')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 4 — self-action guard
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C4] POST: actor overrides their own account → 403, no row', () => {
  it('admin tries to override own lead.read → 403', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.admin.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'lead.read', granted: true, note: 'test' });
    expect(res.status).toBe(403);
  });

  it('no override row written', async () => {
    expect(await overrideCount(fix.admin.id, 'lead.read')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 5 — rank gate
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C5] POST: actor cannot override a user who outranks or equals them → 403, no row', () => {
  it('admin tries to override super_admin → 403', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.superAdmin.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'lead.read', granted: true, note: 'test' });
    expect(res.status).toBe(403);
  });

  it('admin tries to override another admin → 403', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.adminLacksLead.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'lead.read', granted: true, note: 'test' });
    expect(res.status).toBe(403);
  });

  it('no override row written', async () => {
    // adminLacksLead should still have only 1 row (the setup revoke from beforeAll)
    expect(await overrideCount(fix.adminLacksLead.id, 'lead.read')).toBe(1);
    expect(await overrideCount(fix.superAdmin.id, 'lead.read')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 6 — manager-assignment gate
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C6] POST: manager overrides for an unassigned field rep → 403, no row', () => {
  it('manager overrides unassigned rep → 403', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.unassignedRep.id}/permissions`)
      .set(auth(fix.manager.sid))
      .send({ permission: 'lead.read', granted: true, note: 'test' });
    expect(res.status).toBe(403);
  });

  it('no override row written', async () => {
    expect(await overrideCount(fix.unassignedRep.id, 'lead.read')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 7 — must-hold: manager grants a permission they don't hold
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C7] POST: manager grants a permission they do not hold → 403, no row', () => {
  // team.view_stats has minRole: admin — managers don't hold it.
  it('manager grants team.view_stats → 403', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.assignedRep.id}/permissions`)
      .set(auth(fix.manager.sid))
      .send({ permission: 'team.view_stats', granted: true, note: 'test' });
    expect(res.status).toBe(403);
  });

  it('manager revokes team.view_stats → 403', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.assignedRep.id}/permissions`)
      .set(auth(fix.manager.sid))
      .send({ permission: 'team.view_stats', granted: false, note: 'test' });
    expect(res.status).toBe(403);
  });

  it('no override row written', async () => {
    expect(await overrideCount(fix.assignedRep.id, 'team.view_stats')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 8 — manager overrides their own direct report (happy path)
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C8] POST: manager overrides their own assigned report → 201, row + audit', () => {
  const PERM = 'lead.create'; // minRole: field_rep — manager holds it

  afterAll(async () => {
    // Clean up so this case doesn't pollute others
    await db.delete(userPermissionOverridesTable).where(and(
      eq(userPermissionOverridesTable.userId, fix.assignedRep.id),
      eq(userPermissionOverridesTable.permission, PERM),
    ));
    await db.delete(permissionOverrideChangesTable).where(and(
      eq(permissionOverrideChangesTable.targetUserId, fix.assignedRep.id),
      eq(permissionOverrideChangesTable.permission, PERM),
    ));
  });

  it('manager grants lead.create for direct report → 201', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.assignedRep.id}/permissions`)
      .set(auth(fix.manager.sid))
      .send({ permission: PERM, granted: true, note: 'test-c8: promoting rep' });
    expect(res.status).toBe(201);
    expect(res.body.override).toBeDefined();
    expect(res.body.override.granted).toBe(true);
  });

  it('override row exists in DB', async () => {
    expect(await overrideCount(fix.assignedRep.id, PERM)).toBe(1);
  });

  it('audit row written with correct state', async () => {
    const audit = await latestAudit(fix.assignedRep.id, PERM);
    expect(audit).not.toBeNull();
    expect(audit!.previousState).toBeNull();
    expect(audit!.newState).toBe('granted');
    expect(audit!.note).toBe('test-c8: promoting rep');
    expect(audit!.actorUserId).toBe(fix.manager.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 9 — admin overrides for any lower-ranked user
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C9] POST: admin overrides for any user they outrank → 201, row + audit', () => {
  const PERM = 'lead.assign'; // minRole: manager — admin holds it

  afterAll(async () => {
    await db.delete(userPermissionOverridesTable).where(and(
      eq(userPermissionOverridesTable.userId, fix.unassignedRep.id),
      eq(userPermissionOverridesTable.permission, PERM),
    ));
    await db.delete(permissionOverrideChangesTable).where(and(
      eq(permissionOverrideChangesTable.targetUserId, fix.unassignedRep.id),
      eq(permissionOverrideChangesTable.permission, PERM),
    ));
  });

  it('admin grants lead.assign for unassigned rep → 201', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.unassignedRep.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: PERM, granted: true, note: 'test-c9: granting assign power' });
    expect(res.status).toBe(201);
    expect(res.body.override.granted).toBe(true);
  });

  it('override row exists in DB', async () => {
    expect(await overrideCount(fix.unassignedRep.id, PERM)).toBe(1);
  });

  it('audit row written with previousState null → granted', async () => {
    const audit = await latestAudit(fix.unassignedRep.id, PERM);
    expect(audit!.previousState).toBeNull();
    expect(audit!.newState).toBe('granted');
    expect(audit!.actorUserId).toBe(fix.admin.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 10 — DELETE note required
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C10] DELETE: missing / empty note → 400', () => {
  it('DELETE with no body → 400', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${fix.assignedRep.id}/permissions/lead.read`)
      .set(auth(fix.admin.sid));
    expect(res.status).toBe(400);
  });

  it('DELETE with empty note → 400', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${fix.assignedRep.id}/permissions/lead.read`)
      .set(auth(fix.admin.sid))
      .send({ note: '' });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 11 — DELETE clearing a revoke that would restore default-allow,
//            actor lacks the permission → 403, override unchanged
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C11] DELETE: clear revoke that restores default-allow, actor lacks → 403', () => {
  // Setup: assignedRep has lead.read revoked (inserted in beforeAll for adminLacksLead;
  // we need a separate revoke for assignedRep).
  beforeAll(async () => {
    // Insert revoke for assignedRep on lead.read
    await db.insert(userPermissionOverridesTable).values({
      companyId:       fix.companyId,
      userId:          fix.assignedRep.id,
      permission:      'lead.read',
      granted:         false,
      grantedByUserId: fix.superAdmin.id,
      note:            'test-c11 setup revoke',
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(userPermissionOverridesTable).where(and(
      eq(userPermissionOverridesTable.userId, fix.assignedRep.id),
      eq(userPermissionOverridesTable.permission, 'lead.read'),
    ));
    await db.delete(permissionOverrideChangesTable).where(and(
      eq(permissionOverrideChangesTable.targetUserId, fix.assignedRep.id),
      eq(permissionOverrideChangesTable.permission, 'lead.read'),
    ));
  });

  it('adminLacksLead clears lead.read revoke for assignedRep → 403', async () => {
    // adminLacksLead has lead.read revoked → doesn't hold lead.read
    // clearing the revoke on assignedRep would restore lead.read (minRole: field_rep = allow)
    const res = await request(app)
      .delete(`/api/team/users/${fix.assignedRep.id}/permissions/lead.read`)
      .set(auth(fix.adminLacksLead.sid))
      .send({ note: 'should fail' });
    expect(res.status).toBe(403);
  });

  it('revoke override still present in DB after 403', async () => {
    const rows = await db
      .select({ granted: userPermissionOverridesTable.granted })
      .from(userPermissionOverridesTable)
      .where(and(
        eq(userPermissionOverridesTable.userId, fix.assignedRep.id),
        eq(userPermissionOverridesTable.permission, 'lead.read'),
      ));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.granted).toBe(false);
  });

  it('no audit row written for failed clear', async () => {
    // Only audit rows from after this test starts; the revoke itself wasn't written
    // via the audit path (direct DB insert in setup) so count should be 0.
    expect(await auditCount(fix.assignedRep.id, 'lead.read')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 12 — DELETE clearing a grant → 200, removed: true, audit row
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C12] DELETE: clear a grant → 200, removed: true, audit row', () => {
  const PERM = 'lead.bulk_create'; // minRole: field_rep (admin holds it)
  const TARGET = () => fix.unassignedRep;

  beforeAll(async () => {
    // Set a grant override first
    await db.insert(userPermissionOverridesTable).values({
      companyId:       fix.companyId,
      userId:          TARGET().id,
      permission:      PERM,
      granted:         true,
      grantedByUserId: fix.superAdmin.id,
      note:            'test-c12 setup grant',
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(userPermissionOverridesTable).where(and(
      eq(userPermissionOverridesTable.userId, TARGET().id),
      eq(userPermissionOverridesTable.permission, PERM),
    ));
    await db.delete(permissionOverrideChangesTable).where(and(
      eq(permissionOverrideChangesTable.targetUserId, TARGET().id),
      eq(permissionOverrideChangesTable.permission, PERM),
    ));
  });

  it('superAdmin clears grant override → 200, removed: true', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${TARGET().id}/permissions/${PERM}`)
      .set(auth(fix.superAdmin.sid))
      .send({ note: 'test-c12: clearing grant' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.removed).toBe(true);
  });

  it('override row removed from DB', async () => {
    expect(await overrideCount(TARGET().id, PERM)).toBe(0);
  });

  it('audit row written with granted → null', async () => {
    const audit = await latestAudit(TARGET().id, PERM);
    expect(audit).not.toBeNull();
    expect(audit!.previousState).toBe('granted');
    expect(audit!.newState).toBeNull();
    expect(audit!.note).toBe('test-c12: clearing grant');
    expect(audit!.actorUserId).toBe(fix.superAdmin.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 13 — full lifecycle: grant → revoke → clear → 3 audit rows
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C13] Full lifecycle: grant → revoke → clear → 3 audit rows', () => {
  const PERM   = 'lead.advance_stage'; // ownerOrRole: manager — superAdmin holds it
  const TARGET = () => fix.assignedRep;

  afterAll(async () => {
    await db.delete(userPermissionOverridesTable).where(and(
      eq(userPermissionOverridesTable.userId, TARGET().id),
      eq(userPermissionOverridesTable.permission, PERM),
    ));
    await db.delete(permissionOverrideChangesTable).where(and(
      eq(permissionOverrideChangesTable.targetUserId, TARGET().id),
      eq(permissionOverrideChangesTable.permission, PERM),
    ));
  });

  it('step 1: grant override → 201, previousState null, newState granted', async () => {
    const res = await request(app)
      .post(`/api/team/users/${TARGET().id}/permissions`)
      .set(auth(fix.superAdmin.sid))
      .send({ permission: PERM, granted: true, note: 'lifecycle: grant' });
    expect(res.status).toBe(201);
    const audit = await latestAudit(TARGET().id, PERM);
    expect(audit!.previousState).toBeNull();
    expect(audit!.newState).toBe('granted');
  });

  it('step 2: revoke override → 201, previousState granted, newState revoked', async () => {
    const res = await request(app)
      .post(`/api/team/users/${TARGET().id}/permissions`)
      .set(auth(fix.superAdmin.sid))
      .send({ permission: PERM, granted: false, note: 'lifecycle: revoke' });
    expect(res.status).toBe(201);
    const audit = await latestAudit(TARGET().id, PERM);
    expect(audit!.previousState).toBe('granted');
    expect(audit!.newState).toBe('revoked');
  });

  it('step 3: clear override → 200, previousState revoked, newState null', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${TARGET().id}/permissions/${PERM}`)
      .set(auth(fix.superAdmin.sid))
      .send({ note: 'lifecycle: clear' });
    expect(res.status).toBe(200);
    const audit = await latestAudit(TARGET().id, PERM);
    expect(audit!.previousState).toBe('revoked');
    expect(audit!.newState).toBeNull();
  });

  it('exactly 3 audit rows with correct ordering (newest-first via GET history)', async () => {
    expect(await auditCount(TARGET().id, PERM)).toBe(3);

    const histRes = await request(app)
      .get(`/api/team/users/${TARGET().id}/permissions/history`)
      .set(auth(fix.admin.sid));
    expect(histRes.status).toBe(200);

    const hist: Array<{ permission: string; previousState: string | null; newState: string | null }> =
      histRes.body.history.filter((r: { permission: string }) => r.permission === PERM);
    expect(hist).toHaveLength(3);

    // Newest-first: clear → revoke → grant
    expect(hist[0]!.previousState).toBe('revoked');
    expect(hist[0]!.newState).toBeNull();

    expect(hist[1]!.previousState).toBe('granted');
    expect(hist[1]!.newState).toBe('revoked');

    expect(hist[2]!.previousState).toBeNull();
    expect(hist[2]!.newState).toBe('granted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 14 — cross-tenant: target in different company → 404, no row
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C14] POST/DELETE: cross-tenant target → 404, no row written', () => {
  it('admin overrides user in a different company → 404', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.rep2.id}/permissions`)
      .set(auth(fix.admin.sid))
      .send({ permission: 'lead.read', granted: true, note: 'cross-tenant test' });
    expect(res.status).toBe(404);
  });

  it('no override row written in either company', async () => {
    expect(await overrideCount(fix.rep2.id, 'lead.read')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 15 — DELETE with selfOnly and floor permissions → 422
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C15] DELETE: floor / selfOnly permission keys → 422', () => {
  it('DELETE floor permission (profile.read) → 422', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${fix.unassignedRep.id}/permissions/profile.read`)
      .set(auth(fix.admin.sid))
      .send({ note: 'test' });
    expect(res.status).toBe(422);
  });

  it('DELETE selfOnly permission (notification.manage) → 422', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${fix.unassignedRep.id}/permissions/notification.manage`)
      .set(auth(fix.admin.sid))
      .send({ note: 'test' });
    expect(res.status).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 16 — GET history gate checks
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C16] GET /team/users/:userId/permissions/history gate checks', () => {
  it('no auth → 401', async () => {
    const res = await request(app)
      .get(`/api/team/users/${fix.assignedRep.id}/permissions/history`);
    expect(res.status).toBe(401);
  });

  it('field_rep → 403', async () => {
    const res = await request(app)
      .get(`/api/team/users/${fix.assignedRep.id}/permissions/history`)
      .set(auth(fix.assignedRep.sid));
    expect(res.status).toBe(403);
  });

  it('manager → 200 with userId and history array', async () => {
    const res = await request(app)
      .get(`/api/team/users/${fix.assignedRep.id}/permissions/history`)
      .set(auth(fix.manager.sid));
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(fix.assignedRep.id);
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it('manager reads history for user in different company → 404', async () => {
    const res = await request(app)
      .get(`/api/team/users/${fix.rep2.id}/permissions/history`)
      .set(auth(fix.manager.sid));
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 17 — POST/DELETE gate checks: unauthenticated and field_rep → 401/403
// ═══════════════════════════════════════════════════════════════════════════════
describe('[C17] POST/DELETE gate: no auth → 401, field_rep → 403', () => {
  it('POST no auth → 401', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.assignedRep.id}/permissions`)
      .send({ permission: 'lead.read', granted: true, note: 'test' });
    expect(res.status).toBe(401);
  });

  it('POST field_rep → 403', async () => {
    const res = await request(app)
      .post(`/api/team/users/${fix.assignedRep.id}/permissions`)
      .set(auth(fix.assignedRep.sid))
      .send({ permission: 'lead.read', granted: true, note: 'test' });
    expect(res.status).toBe(403);
  });

  it('DELETE no auth → 401', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${fix.assignedRep.id}/permissions/lead.read`)
      .send({ note: 'test' });
    expect(res.status).toBe(401);
  });

  it('DELETE field_rep → 403', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${fix.assignedRep.id}/permissions/lead.read`)
      .set(auth(fix.assignedRep.sid))
      .send({ note: 'test' });
    expect(res.status).toBe(403);
  });
});

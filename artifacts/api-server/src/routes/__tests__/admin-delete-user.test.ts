/**
 * Tests for the team-roster and admin-stats role gates (Phase 3 — FINDING 4-B).
 *
 * Routing after refactor:
 *   GET    /team/users                    — requireManagerOrAdmin  (roster is manager-accessible)
 *   PATCH  /team/users/:userId            — requireManagerOrAdmin  (manager+ may update outranked users)
 *   DELETE /team/users/:userId            — team.delete (super_admin ONLY)
 *                                           Hard delete requires empty inventory; normal termination
 *                                           path is POST /team/users/:id/terminate (team.edit gate).
 *   POST   /team/users/:userId/terminate  — team.edit (manager+) + actorOutranks
 *   GET    /admin/stats                   — requireAdmin           (admin-tier only, per PD-1)
 */
import {
  companiesTable,
  db,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `team-del-${Date.now().toString(36)}`;

interface Actor {
  id: string;
  sid: string;
}

interface Fixture {
  companyId: string;
  superAdmin: Actor;
  admin: Actor;
  manager: Actor;
  manager2: Actor; // same-rank peer for rank-enforcement test
  rep: Actor;
}

async function seedUser(companyId: string, role: string, tag: string) {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `${tag}-${RUN_ID}@example.test` })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role: role as never });
  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
    access_token: 'test-token',
  });
  return { id: user.id, sid };
}

describe('DELETE /team/users/:userId — role gate', () => {
  let fix: Fixture;
  const createdUserIds: string[] = [];

  async function seedTarget(role = 'field_rep') {
    const [user] = await db
      .insert(usersTable)
      .values({ companyId: fix.companyId, email: `target-${Date.now()}-${RUN_ID}@example.test` })
      .returning();
    await db.insert(userProfilesTable).values({ userId: user.id, role: role as never });
    createdUserIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    const companyId = `TEAMDEL-${RUN_ID}`.toUpperCase();
    await db.insert(companiesTable).values({ id: companyId, name: `Team Delete Test ${RUN_ID}` });

    const [superAdmin, admin, manager, manager2, rep] = await Promise.all([
      seedUser(companyId, 'super_admin', 'superadmin'),
      seedUser(companyId, 'admin', 'admin'),
      seedUser(companyId, 'manager', 'manager'),
      seedUser(companyId, 'manager', 'manager2'),
      seedUser(companyId, 'field_rep', 'rep'),
    ]);

    fix = { companyId, superAdmin, admin, manager, manager2, rep };
    createdUserIds.push(superAdmin.id, admin.id, manager.id, manager2.id, rep.id);
  });

  afterAll(async () => {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    await db.delete(companiesTable).where(inArray(companiesTable.id, [fix.companyId]));
  });

  // ── Delete gate ─────────────────────────────────────────────────────────────

  it('manager CANNOT hard-delete any user → 403 (team.delete is super_admin only)', async () => {
    const targetId = await seedTarget('field_rep');
    const res = await request(app)
      .delete(`/api/team/users/${targetId}`)
      .set('Authorization', `Bearer ${fix.manager.sid}`);
    expect(res.status).toBe(403);
    // Target must still exist — permission gate fires before any deletion.
    const [still] = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, [targetId]));
    expect(still).toBeDefined();
  });

  it('manager CANNOT delete another manager (same rank) → 403', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${fix.manager2.id}`)
      .set('Authorization', `Bearer ${fix.manager.sid}`);
    expect(res.status).toBe(403);
    // User must still exist — no ghost deletion.
    const [still] = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, [fix.manager2.id]));
    expect(still).toBeDefined();
  });

  it('admin CANNOT hard-delete any user → 403 (team.delete is super_admin only)', async () => {
    const targetId = await seedTarget('manager');
    const res = await request(app)
      .delete(`/api/team/users/${targetId}`)
      .set('Authorization', `Bearer ${fix.admin.sid}`);
    expect(res.status).toBe(403);
    // Target must still exist — permission gate fires before any deletion.
    const [still] = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, [targetId]));
    expect(still).toBeDefined();
  });

  it('super_admin DELETES an admin → 200', async () => {
    const targetId = await seedTarget('admin');
    const res = await request(app)
      .delete(`/api/team/users/${targetId}`)
      .set('Authorization', `Bearer ${fix.superAdmin.sid}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('field_rep receives 403 on DELETE', async () => {
    const targetId = await seedTarget('field_rep');
    const res = await request(app)
      .delete(`/api/team/users/${targetId}`)
      .set('Authorization', `Bearer ${fix.rep.sid}`);
    expect(res.status).toBe(403);
  });

  // ── Roster list gate ────────────────────────────────────────────────────────

  it('manager may GET /team/users (roster is manager-accessible)', async () => {
    const res = await request(app)
      .get('/api/team/users')
      .set('Authorization', `Bearer ${fix.manager.sid}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it('field_rep receives 403 on GET /team/users', async () => {
    const res = await request(app)
      .get('/api/team/users')
      .set('Authorization', `Bearer ${fix.rep.sid}`);
    expect(res.status).toBe(403);
  });

  // ── Admin stats gate (PD-1: admin-tier only) ────────────────────────────────

  it('manager receives 403 on GET /admin/stats (admin-tier only per PD-1)', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${fix.manager.sid}`);
    expect(res.status).toBe(403);
  });

  it('admin receives 200 on GET /admin/stats', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${fix.admin.sid}`);
    expect(res.status).toBe(200);
  });
});

/**
 * Tests that DELETE /admin/users/:userId is restricted to admin-tier roles
 * (admin, super_admin) and that managers are explicitly denied.
 *
 * Policy ruling: managers may read /admin/* and PATCH team members they
 * outrank, but DELETE is a destructive action requiring admin-or-above.
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

const RUN_ID = `admin-del-${Date.now().toString(36)}`;

interface Actor {
  id: string;
  sid: string;
}

interface Fixture {
  companyId: string;
  superAdmin: Actor;
  admin: Actor;
  manager: Actor;
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

describe('DELETE /admin/users/:userId — role gate', () => {
  let fix: Fixture;
  const createdUserIds: string[] = [];

  async function seedTarget() {
    const [user] = await db
      .insert(usersTable)
      .values({ companyId: fix.companyId, email: `target-${Date.now()}-${RUN_ID}@example.test` })
      .returning();
    await db.insert(userProfilesTable).values({ userId: user.id, role: 'field_rep' });
    createdUserIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    const companyId = `ADMINDEL-${RUN_ID}`.toUpperCase();
    await db.insert(companiesTable).values({ id: companyId, name: `Admin Delete Test ${RUN_ID}` });

    const [superAdmin, admin, manager, rep] = await Promise.all([
      seedUser(companyId, 'super_admin', 'superadmin'),
      seedUser(companyId, 'admin', 'admin'),
      seedUser(companyId, 'manager', 'manager'),
      seedUser(companyId, 'field_rep', 'rep'),
    ]);

    fix = { companyId, superAdmin, admin, manager, rep };
    createdUserIds.push(superAdmin.id, admin.id, manager.id, rep.id);
  });

  afterAll(async () => {
    // Cascade deletes profiles, pins, etc.
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    await db.delete(companiesTable).where(inArray(companiesTable.id, [fix.companyId]));
  });

  it('manager receives 403 when trying to delete a field rep', async () => {
    const targetId = await seedTarget();
    const res = await request(app)
      .delete(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${fix.manager.sid}`);
    expect(res.status).toBe(403);

    // Confirm the user was NOT deleted.
    const [still] = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, [targetId]));
    expect(still).toBeDefined();
  });

  it('admin receives 200 and the user is removed', async () => {
    const targetId = await seedTarget();
    const res = await request(app)
      .delete(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${fix.admin.sid}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('super_admin receives 200 and the user is removed', async () => {
    const targetId = await seedTarget();
    const res = await request(app)
      .delete(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${fix.superAdmin.sid}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('field_rep receives 403', async () => {
    const targetId = await seedTarget();
    const res = await request(app)
      .delete(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${fix.rep.sid}`);
    expect(res.status).toBe(403);
  });

  it('manager may still GET /admin/users (list access is unchanged)', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${fix.manager.sid}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it('manager may still GET /admin/stats (stats access is unchanged)', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${fix.manager.sid}`);
    expect(res.status).toBe(200);
  });
});

import {
  companiesTable,
  db,
  pinsTable,
  userLocationsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// End-to-end proof that multi-tenancy holds across pins, team locations, and
// the admin dashboard: two fully independent companies are seeded, and every
// company-A request is asserted to be blind to company B's rows (and vice
// versa where relevant).

const RUN_ID = Date.now().toString(36);

interface SeededCompany {
  companyId: string;
  adminId: string;
  adminSid: string;
  repId: string;
  repSid: string;
  pinId: string;
}

async function seedCompany(label: 'a' | 'b'): Promise<SeededCompany> {
  const companyId = `TEST-${RUN_ID}-${label}`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyId, name: `Test Co ${label.toUpperCase()}` });

  const [admin] = await db
    .insert(usersTable)
    .values({ companyId, email: `admin-${label}-${RUN_ID}@example.test` })
    .returning();
  const [rep] = await db
    .insert(usersTable)
    .values({ companyId, email: `rep-${label}-${RUN_ID}@example.test` })
    .returning();

  await db.insert(userProfilesTable).values({ userId: admin.id, role: 'admin' });
  await db.insert(userProfilesTable).values({ userId: rep.id, role: 'field_rep' });

  const [pin] = await db
    .insert(pinsTable)
    .values({
      userId: rep.id,
      companyId,
      latitude: 40.0,
      longitude: -75.0,
      workflow: 'retail',
    })
    .returning();

  await db.insert(userLocationsTable).values({
    userId: rep.id,
    companyId,
    latitude: 40.0,
    longitude: -75.0,
  });

  const adminSid = await createSession({
    user: {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      profileImageUrl: admin.profileImageUrl,
      companyId,
    },
    access_token: 'test-access-token',
  });
  const repSid = await createSession({
    user: {
      id: rep.id,
      email: rep.email,
      firstName: rep.firstName,
      lastName: rep.lastName,
      profileImageUrl: rep.profileImageUrl,
      companyId,
    },
    access_token: 'test-access-token',
  });

  return { companyId, adminId: admin.id, adminSid, repId: rep.id, repSid, pinId: pin.id };
}

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

describe('multi-tenant data isolation', () => {
  let companyA: SeededCompany;
  let companyB: SeededCompany;

  beforeAll(async () => {
    companyA = await seedCompany('a');
    companyB = await seedCompany('b');
  });

  afterAll(async () => {
    const userIds = [companyA.adminId, companyA.repId, companyB.adminId, companyB.repId];
    // Deleting users cascades to profiles/pins/locations (onDelete: cascade).
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await db
      .delete(companiesTable)
      .where(inArray(companiesTable.id, [companyA.companyId, companyB.companyId]));
  });

  it('GET /pins never returns another company\'s pins', async () => {
    const res = await request(app).get('/api/pins').set(auth(companyA.adminSid));
    expect(res.status).toBe(200);
    const ids: string[] = res.body.pins.map((p: { id: string }) => p.id);
    expect(ids).toContain(companyA.pinId);
    expect(ids).not.toContain(companyB.pinId);
    expect(res.body.pins.every((p: { companyId?: string }) => p.companyId !== companyB.companyId)).toBe(
      true,
    );
  });

  it('GET /location/team never returns another company\'s reps', async () => {
    const res = await request(app).get('/api/location/team').set(auth(companyA.adminSid));
    expect(res.status).toBe(200);
    const userIds: string[] = res.body.locations.map((l: { userId: string }) => l.userId);
    expect(userIds).toContain(companyA.repId);
    expect(userIds).not.toContain(companyB.repId);
  });

  it('GET /admin/stats only counts the acting admin\'s company', async () => {
    const [resA, resB] = await Promise.all([
      request(app).get('/api/admin/stats').set(auth(companyA.adminSid)),
      request(app).get('/api/admin/stats').set(auth(companyB.adminSid)),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    // Each company seeded exactly one pin and one field rep; if stats leaked
    // across tenants either count would be inflated to 2.
    expect(resA.body.stats.totalPins).toBe(1);
    expect(resA.body.stats.fieldRepCount).toBe(1);
    expect(resB.body.stats.totalPins).toBe(1);
    expect(resB.body.stats.fieldRepCount).toBe(1);
  });

  it('GET /team/users never returns another company\'s users', async () => {
    const res = await request(app).get('/api/team/users').set(auth(companyA.adminSid));
    expect(res.status).toBe(200);
    const ids: string[] = res.body.users.map((u: { id: string }) => u.id);
    expect(ids).toEqual(expect.arrayContaining([companyA.adminId, companyA.repId]));
    expect(ids).not.toContain(companyB.adminId);
    expect(ids).not.toContain(companyB.repId);
  });

  it('PATCH /team/users/:userId against a cross-company user returns 404, not 403', async () => {
    const res = await request(app)
      .patch(`/api/team/users/${companyB.repId}`)
      .set(auth(companyA.adminSid))
      .send({ role: 'manager' });
    expect(res.status).toBe(404);

    // Confirm the cross-company user was untouched.
    const [stillRep] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, companyB.repId));
    expect(stillRep.role).toBe('field_rep');
  });

  it('DELETE /team/users/:userId against a cross-company user returns 404, not 403 or success', async () => {
    const res = await request(app)
      .delete(`/api/team/users/${companyB.repId}`)
      .set(auth(companyA.adminSid));
    expect(res.status).toBe(404);

    const [stillThere] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, companyB.repId));
    expect(stillThere).toBeDefined();
  });

  it('POST /pins always stamps the acting user\'s own companyId, ignoring any client-supplied value', async () => {
    const res = await request(app)
      .post('/api/pins')
      .set(auth(companyA.repSid))
      .send({
        latitude: 41.1,
        longitude: -76.2,
        workflow: 'retail',
        // Not part of the schema, but prove the server can't be tricked even
        // if a client tries to smuggle a different tenant in.
        companyId: companyB.companyId,
      });
    expect(res.status).toBe(201);

    // The API response doesn't even expose companyId; the DB row is the
    // source of truth for what tenant the pin actually landed in.
    const [stored] = await db.select().from(pinsTable).where(eq(pinsTable.id, res.body.pin.id));
    expect(stored.companyId).toBe(companyA.companyId);
    expect(stored.companyId).not.toBe(companyB.companyId);
  });

  it('POST /location/ping always stamps the acting user\'s own companyId', async () => {
    const res = await request(app)
      .post('/api/location/ping')
      .set(auth(companyA.repSid))
      .send({ latitude: 42.5, longitude: -77.3, companyId: companyB.companyId });
    expect(res.status).toBe(200);

    const [stored] = await db
      .select()
      .from(userLocationsTable)
      .where(eq(userLocationsTable.userId, companyA.repId));
    expect(stored.companyId).toBe(companyA.companyId);
  });

  it('rejects unauthenticated requests to every scoped route', async () => {
    const [pins, team, stats, users] = await Promise.all([
      request(app).get('/api/pins'),
      request(app).get('/api/location/team'),
      request(app).get('/api/admin/stats'),
      request(app).get('/api/team/users'),
    ]);
    expect(pins.status).toBe(401);
    expect(team.status).toBe(401);
    expect(stats.status).toBe(401);
    expect(users.status).toBe(401);
  });
});

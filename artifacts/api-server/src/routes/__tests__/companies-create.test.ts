/**
 * POST /companies — tenant creation gate.
 *
 * Security: this route was previously unauthenticated. It is now gated to
 * super_admin only. These tests verify the gate holds and that a valid
 * super_admin call still succeeds.
 */
import { companiesTable, db, userProfilesTable, usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `cc-${Date.now().toString(36)}`;

interface Seeded {
  companyId: string;
  superSid: string;
  adminSid: string;
  repSid:   string;
}

async function seed(): Promise<Seeded> {
  const companyId = `CCTEST-${RUN_ID}`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyId, name: `CreateCo ${RUN_ID}` });

  const mkUser = async (tag: string, role: string) => {
    const [u] = await db
      .insert(usersTable)
      .values({ companyId, email: `cc-${tag}-${RUN_ID}@example.test` })
      .returning();
    await db.insert(userProfilesTable).values({ userId: u.id, role: role as never });
    return createSession({
      user: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        profileImageUrl: u.profileImageUrl,
        companyId,
      },
      access_token: 'test-access-token',
    });
  };

  return {
    companyId,
    superSid: await mkUser('super', 'super_admin'),
    adminSid: await mkUser('admin', 'admin'),
    repSid:   await mkUser('rep',   'field_rep'),
  };
}

const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

let s: Seeded;
const createdIds: string[] = [];

beforeAll(async () => { s = await seed(); });

afterAll(async () => {
  // Remove any companies created during tests
  for (const id of createdIds) {
    await db.delete(companiesTable).where(eq(companiesTable.id, id));
  }
  // Remove seeded users + company
  await db.delete(userProfilesTable).where(
    eq(userProfilesTable.userId,
      (await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.email, `cc-super-${RUN_ID}@example.test`)))[0]?.id ?? '',
    ),
  );
  await db.delete(usersTable).where(eq(usersTable.companyId, s.companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, s.companyId));
});

describe('POST /companies — auth gate', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/companies')
      .send({ name: 'Should Not Exist' });
    expect(res.status).toBe(401);
  });

  it('rejects field_rep with 403', async () => {
    const res = await request(app)
      .post('/api/companies')
      .set(auth(s.repSid))
      .send({ name: 'Should Not Exist' });
    expect(res.status).toBe(403);
  });

  it('rejects admin (below super_admin) with 403', async () => {
    const res = await request(app)
      .post('/api/companies')
      .set(auth(s.adminSid))
      .send({ name: 'Should Not Exist' });
    expect(res.status).toBe(403);
  });

  it('allows super_admin to create a company', async () => {
    const name = `NewTenant-${RUN_ID}`;
    const res = await request(app)
      .post('/api/companies')
      .set(auth(s.superSid))
      .send({ name });
    expect(res.status).toBe(201);
    expect(res.body.company).toMatchObject({ name });
    expect(typeof res.body.company.id).toBe('string');
    createdIds.push(res.body.company.id as string);
  });

  it('super_admin: rejects a missing name with 400', async () => {
    const res = await request(app)
      .post('/api/companies')
      .set(auth(s.superSid))
      .send({});
    expect(res.status).toBe(400);
  });
});

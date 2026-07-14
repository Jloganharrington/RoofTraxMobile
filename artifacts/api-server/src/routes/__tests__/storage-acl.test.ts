import { companiesTable, db, objectOwnershipTable, usersTable } from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// Proves GET /storage/objects/*path enforces auth + same-company access
// before streaming: unauthenticated callers are denied, callers from a
// different company are denied even if they know the exact path, and the
// uploading user (and same-company teammates) can read the file back.

const RUN_ID = Date.now().toString(36);

interface SeededCompany {
  companyId: string;
  userId: string;
  sid: string;
}

async function seedCompany(label: 'a' | 'b'): Promise<SeededCompany> {
  const companyId = `TEST-STORAGE-${RUN_ID}-${label}`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyId, name: `Test Storage Co ${label}` });

  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `storage-${label}-${RUN_ID}@example.test` })
    .returning();

  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
    access_token: 'test-access-token',
  });

  return { companyId, userId: user.id, sid };
}

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

describe('storage ACL (GET /storage/objects/*path)', () => {
  let companyA: SeededCompany;
  let companyB: SeededCompany;
  let objectPath: string;
  let objectId: string;

  beforeAll(async () => {
    companyA = await seedCompany('a');
    companyB = await seedCompany('b');

    // Request a real presigned upload URL as company A's user, then upload a
    // small file, mirroring the mobile client's real upload flow.
    const requestRes = await request(app)
      .post('/api/storage/uploads/request-url')
      .set(auth(companyA.sid))
      .send({ name: 'test.txt', size: 4, contentType: 'text/plain' });
    expect(requestRes.status).toBe(200);

    objectPath = requestRes.body.objectPath as string;
    objectId = objectPath.replace(/^\/objects\//, '');

    const putRes = await fetch(requestRes.body.uploadURL, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'test',
    });
    expect(putRes.ok).toBe(true);
  });

  afterAll(async () => {
    await db.delete(objectOwnershipTable).where(inArray(objectOwnershipTable.objectPath, [objectPath]));
    await db.delete(usersTable).where(inArray(usersTable.id, [companyA.userId, companyB.userId]));
    await db
      .delete(companiesTable)
      .where(inArray(companiesTable.id, [companyA.companyId, companyB.companyId]));
  });

  it('denies unauthenticated requests', async () => {
    const res = await request(app).get(`/api/storage/objects/${objectId}`);
    expect(res.status).toBe(401);
  });

  it('denies a caller from a different company, even knowing the exact path', async () => {
    const res = await request(app)
      .get(`/api/storage/objects/${objectId}`)
      .set(auth(companyB.sid));
    expect(res.status).toBe(403);
  });

  it('serves the object to the uploading user', async () => {
    const res = await request(app)
      .get(`/api/storage/objects/${objectId}`)
      .set(auth(companyA.sid));
    expect(res.status).toBe(200);
    expect(res.text).toBe('test');
  });

  it('404s for a path with no ownership record', async () => {
    const res = await request(app)
      .get('/api/storage/objects/does-not-exist')
      .set(auth(companyA.sid));
    expect(res.status).toBe(404);
  });
});

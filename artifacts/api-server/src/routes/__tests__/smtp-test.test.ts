import { companiesTable, db, userProfilesTable, usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// POST /profile/smtp/test — validates auth and the "not configured" guard.
// Actual SMTP delivery is not exercised here (no live mail server in tests);
// the delivery path is shared with the already-shipped email-report route.

const RUN_ID = `smtptest-${Date.now().toString(36)}`;

let companyId: string;
let userId: string;
let sid: string;

beforeAll(async () => {
  companyId = `TEST-${RUN_ID}`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyId, name: `SmtpTestCo ${RUN_ID}` });
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `${RUN_ID}@example.test` })
    .returning();
  userId = user.id;
  await db.insert(userProfilesTable).values({ userId, role: 'field_rep' });
  sid = await createSession({
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
});

afterAll(async () => {
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe('POST /api/profile/smtp/test', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/profile/smtp/test');
    expect(res.status).toBe(401);
  });

  it('returns 400 when SMTP is not configured', async () => {
    const res = await request(app)
      .post('/api/profile/smtp/test')
      .set('Authorization', `Bearer ${sid}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

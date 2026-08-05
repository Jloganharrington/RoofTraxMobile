import { companiesTable, db, userProfilesTable, usersTable } from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// Proves the requireWidgetCapability guard pattern via the action_required
// widget data endpoint (manager+ only). The guard must return:
//   401  — not authenticated
//   403  — authenticated but capability not granted (e.g. field_rep)
//   200  — authenticated and capability confirmed (e.g. manager)
//
// The payload may be empty/placeholder; this suite is about the guard, not
// the data.

const RUN_ID = Date.now().toString(36);
const COMPANY = `TEST-WDGT-${RUN_ID}`.toUpperCase();

interface SeededUser {
  userId: string;
  sid: string;
}

async function seedUser(
  label: string,
  role: 'field_rep' | 'manager',
  department: 'canvasser',
  workflow: 'retail',
): Promise<SeededUser> {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId: COMPANY, email: `wdgt-${label}-${RUN_ID}@example.test` })
    .returning();
  await db.insert(userProfilesTable).values({
    userId: user.id,
    role,
    department,
    workflowAssignment: workflow,
  });
  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId: COMPANY,
    },
    access_token: 'test-access-token',
  });
  return { userId: user.id, sid };
}

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

describe('GET /dashboard/widgets/action_required — requireWidgetCapability guard', () => {
  let fieldRep: SeededUser;
  let manager: SeededUser;
  const userIds: string[] = [];

  beforeAll(async () => {
    await db.insert(companiesTable).values({ id: COMPANY, name: 'Widget Guard Test Co' });
    fieldRep = await seedUser('rep', 'field_rep', 'canvasser', 'retail');
    manager  = await seedUser('mgr', 'manager',   'canvasser', 'retail');
    userIds.push(fieldRep.userId, manager.userId);
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
    await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY));
  });

  it('unauthenticated request → 401', async () => {
    const res = await request(app).get('/api/dashboard/widgets/action_required');
    expect(res.status).toBe(401);
  });

  it('manager session → 200', async () => {
    const res = await request(app)
      .get('/api/dashboard/widgets/action_required')
      .set(auth(manager.sid));
    expect(res.status).toBe(200);
  });

  it('field_rep session → 403 (not 200-empty, not 404)', async () => {
    const res = await request(app)
      .get('/api/dashboard/widgets/action_required')
      .set(auth(fieldRep.sid));
    // The field_rep case MUST return 403.
    expect(res.status).toBe(403);
  });
});

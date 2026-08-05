import { companiesTable, db, userProfilesTable, usersTable } from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// Proves the dashboard manifest route:
//   - requires authentication (401 otherwise)
//   - resolves capabilities server-side from the profile row
//   - never admits client-supplied role/dept/workflow values
//   - returns manifest metadata only (key + title + size, no payload fields)

const RUN_ID = Date.now().toString(36);
const COMPANY = `TEST-DASH-${RUN_ID}`.toUpperCase();

interface SeededUser {
  userId: string;
  sid: string;
}

async function seedUser(
  label: string,
  role: 'field_rep' | 'manager' | 'admin',
  department: 'canvasser' | 'inspector_canvasser' | 'office',
  workflow: 'retail' | 'insurance_retail',
): Promise<SeededUser> {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId: COMPANY, email: `dash-${label}-${RUN_ID}@example.test` })
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

// Manager-only widget keys that must never appear in a field_rep manifest
const MANAGER_ONLY = [
  'action_required',
  'sales_funnel',
  'canvassing_heatmap',
  'knock_to_lead',
  'production_pipeline',
  'live_team',
  'insurance_claims',
];

describe('GET /dashboard/manifest', () => {
  let fieldRep: SeededUser;
  let manager: SeededUser;
  const userIds: string[] = [];

  beforeAll(async () => {
    await db.insert(companiesTable).values({ id: COMPANY, name: 'Dashboard Test Co' });
    // field_rep: canvasser + retail — minimal manifest (no inspection or insurance widgets)
    fieldRep = await seedUser('rep', 'field_rep', 'canvasser', 'retail');
    // manager: canvasser + retail — gets manager widgets but not insurance/inspection ones
    manager = await seedUser('mgr', 'manager', 'canvasser', 'retail');
    userIds.push(fieldRep.userId, manager.userId);
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
    await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY));
  });

  // ── 1. Auth gate ────────────────────────────────────────────────────────
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/dashboard/manifest');
    expect(res.status).toBe(401);
  });

  // ── 2. field_rep manifest ───────────────────────────────────────────────
  describe('field_rep (canvasser + retail)', () => {
    it('returns 200', async () => {
      const res = await request(app)
        .get('/api/dashboard/manifest')
        .set(auth(fieldRep.sid));
      expect(res.status).toBe(200);
    });

    it('contains none of the seven manager-gated widget keys', async () => {
      const res = await request(app)
        .get('/api/dashboard/manifest')
        .set(auth(fieldRep.sid));
      expect(res.status).toBe(200);
      const keys = (res.body.widgets as Array<{ key: string }>).map((w) => w.key);
      for (const k of MANAGER_ONLY) {
        expect(keys, `field_rep must not see "${k}"`).not.toContain(k);
      }
    });
  });

  // ── 3. manager manifest ─────────────────────────────────────────────────
  it('manager manifest contains action_required', async () => {
    const res = await request(app)
      .get('/api/dashboard/manifest')
      .set(auth(manager.sid));
    expect(res.status).toBe(200);
    const keys = (res.body.widgets as Array<{ key: string }>).map((w) => w.key);
    expect(keys).toContain('action_required');
  });

  // ── 4. Role spoofing — client-supplied values are ignored ───────────────
  describe('role spoofing does not escalate', () => {
    it('?role=admin query param does not change the field_rep manifest', async () => {
      const [normal, spoofed] = await Promise.all([
        request(app).get('/api/dashboard/manifest').set(auth(fieldRep.sid)),
        request(app).get('/api/dashboard/manifest?role=admin').set(auth(fieldRep.sid)),
      ]);
      expect(spoofed.status).toBe(200);
      expect(spoofed.body).toEqual(normal.body);
    });

    it('{ role: "admin" } in request body does not change the field_rep manifest', async () => {
      const [normal, spoofed] = await Promise.all([
        request(app).get('/api/dashboard/manifest').set(auth(fieldRep.sid)),
        request(app)
          .get('/api/dashboard/manifest')
          .set(auth(fieldRep.sid))
          .send({ role: 'admin' }),
      ]);
      expect(spoofed.status).toBe(200);
      expect(spoofed.body).toEqual(normal.body);
    });
  });

  // ── 5. No widget entry carries payload data fields ──────────────────────
  it('no manifest entry contains data, rows, or values fields', async () => {
    const res = await request(app)
      .get('/api/dashboard/manifest')
      .set(auth(manager.sid));
    expect(res.status).toBe(200);
    for (const widget of res.body.widgets as object[]) {
      expect(widget).not.toHaveProperty('data');
      expect(widget).not.toHaveProperty('rows');
      expect(widget).not.toHaveProperty('values');
    }
  });
});

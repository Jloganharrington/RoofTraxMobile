import {
  bugReportsTable,
  companiesTable,
  db,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// Beta bug reporting — verifies the security boundaries the work order calls
// out: admin-only reads, company scoping (cross-tenant blindness), idempotent
// replay by client id (outbox retries must not duplicate or rate-limit), and
// the per-user rate limit.

const RUN_ID = `br-${Date.now().toString(36)}`;

interface Seeded {
  companyId: string;
  adminSid: string;
  repSid: string;
  repId: string;
  adminId: string;
}

async function seedCompany(label: string): Promise<Seeded> {
  const companyId = `TEST-${RUN_ID}-${label}`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyId, name: `BugRepCo ${label}` });

  const [admin] = await db
    .insert(usersTable)
    .values({ companyId, email: `br-admin-${label}-${RUN_ID}@example.test` })
    .returning();
  const [rep] = await db
    .insert(usersTable)
    .values({ companyId, email: `br-rep-${label}-${RUN_ID}@example.test` })
    .returning();
  await db.insert(userProfilesTable).values({ userId: admin.id, role: 'admin' });
  await db.insert(userProfilesTable).values({ userId: rep.id, role: 'field_rep' });

  const mkSid = (u: typeof admin) =>
    createSession({
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

  return {
    companyId,
    adminId: admin.id,
    repId: rep.id,
    adminSid: await mkSid(admin),
    repSid: await mkSid(rep),
  };
}

const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

function reportBody(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    route: '/inspection-roof',
    routeParams: { id: 'insp-1' },
    severity: 'annoying',
    description: 'photos broke',
    context: { isOnline: false, pendingOutboxCount: 3 },
    ...overrides,
  };
}

let a: Seeded;
let b: Seeded;

beforeAll(async () => {
  a = await seedCompany('a');
  b = await seedCompany('b');
});

afterAll(async () => {
  await db.delete(bugReportsTable).where(inArray(bugReportsTable.companyId, [a.companyId, b.companyId]));
  for (const s of [a, b]) {
    await db.delete(userProfilesTable).where(inArray(userProfilesTable.userId, [s.adminId, s.repId]));
    await db.delete(usersTable).where(inArray(usersTable.id, [s.adminId, s.repId]));
    await db.delete(companiesTable).where(eq(companiesTable.id, s.companyId));
  }
});

describe('POST /bug-reports', () => {
  it('stores a report with context and returns it', async () => {
    const res = await request(app)
      .post('/api/bug-reports')
      .set(auth(a.repSid))
      .send(reportBody(`${RUN_ID}-r1`));
    expect(res.status).toBe(201);
    expect(res.body.bugReport.severity).toBe('annoying');
    expect(res.body.bugReport.context.pendingOutboxCount).toBe(3);
    expect(res.body.bugReport.status).toBe('new');
    expect(res.body.bugReport.companyId).toBe(a.companyId);
  });

  it('is idempotent on client-id replay (no duplicate row)', async () => {
    const id = `${RUN_ID}-replay`;
    const first = await request(app).post('/api/bug-reports').set(auth(a.repSid)).send(reportBody(id));
    expect(first.status).toBe(201);
    const replay = await request(app)
      .post('/api/bug-reports')
      .set(auth(a.repSid))
      .send(reportBody(id, { description: 'changed on retry' }));
    expect(replay.status).toBe(201);
    // Original row preserved, not duplicated or overwritten.
    expect(replay.body.bugReport.description).toBe('photos broke');
    const rows = await db.select().from(bugReportsTable).where(eq(bugReportsTable.id, id));
    expect(rows.length).toBe(1);
  });

  it('rejects a client id owned by another user', async () => {
    const id = `${RUN_ID}-owned`;
    await request(app).post('/api/bug-reports').set(auth(a.repSid)).send(reportBody(id));
    const res = await request(app).post('/api/bug-reports').set(auth(b.repSid)).send(reportBody(id));
    expect(res.status).toBe(400);
  });

  it('rate limits after 10 fresh reports in an hour', async () => {
    // b.adminSid has filed no reports yet (limit is per user).
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post('/api/bug-reports')
        .set(auth(b.adminSid))
        .send(reportBody(`${RUN_ID}-rl-${i}`));
      if (res.status === 429) limited++;
      else expect(res.status).toBe(201);
    }
    expect(limited).toBeGreaterThanOrEqual(2);
  });

  it('requires auth', async () => {
    const res = await request(app).post('/api/bug-reports').send(reportBody(`${RUN_ID}-noauth`));
    expect(res.status).toBe(401);
  });
});

describe('GET /bug-reports + triage', () => {
  it('rejects non-admin readers', async () => {
    const res = await request(app).get('/api/bug-reports').set(auth(a.repSid));
    expect(res.status).toBe(403);
  });

  it('lists only own-company reports, newest first', async () => {
    const res = await request(app).get('/api/bug-reports').set(auth(a.adminSid));
    expect(res.status).toBe(200);
    const reports = res.body.bugReports as Array<{ companyId: string; createdAt: string }>;
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((r) => r.companyId === a.companyId)).toBe(true);
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i - 1].createdAt >= reports[i].createdAt).toBe(true);
    }
  });

  it('CSV export is admin-only and scoped', async () => {
    const forbidden = await request(app).get('/api/bug-reports/export.csv').set(auth(a.repSid));
    expect(forbidden.status).toBe(403);
    const res = await request(app).get('/api/bug-reports/export.csv').set(auth(a.adminSid));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('photos broke');
    expect(res.text).not.toContain(b.companyId);
  });

  it('PATCH updates status (admin, own company only)', async () => {
    const id = `${RUN_ID}-r1`;
    const fixed = await request(app)
      .patch(`/api/bug-reports/${id}`)
      .set(auth(a.adminSid))
      .send({ status: 'fixed' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.bugReport.status).toBe('fixed');
    expect(fixed.body.bugReport.resolvedAt).toBeTruthy();

    // Cross-company admin cannot touch it.
    const cross = await request(app)
      .patch(`/api/bug-reports/${id}`)
      .set(auth(b.adminSid))
      .send({ status: 'triaged' });
    expect(cross.status).toBe(404);

    // Non-admin cannot triage.
    const rep = await request(app)
      .patch(`/api/bug-reports/${id}`)
      .set(auth(a.repSid))
      .send({ status: 'triaged' });
    expect(rep.status).toBe(403);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  attestationsTable,
  canvassingSessionsTable,
  companiesTable,
  db,
  inspectionsTable,
  pinsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// End-to-end coverage for Phase M-B routes: canvassing time tracking (B2),
// activity stats/rank/leaderboard scoping (B1), the scheduled seam +
// idempotent start (B3), typed equipment attestation (B4), and the weather
// permission gate + no-LLM guarantee (B5).

const RUN_ID = Date.now().toString(36);

type Role = 'field_rep' | 'manager' | 'super_admin';
type Department = 'canvasser' | 'inspector_canvasser';

interface SeededUser {
  userId: string;
  sid: string;
}

async function seedUser(
  label: string,
  role: Role,
  department: Department,
  companyId: string,
): Promise<SeededUser> {
  const [user] = await db
    .insert(usersTable)
    .values({
      companyId,
      email: `mb-${label}-${RUN_ID}@example.test`,
      firstName: label,
      lastName: 'Test',
    })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role, department });

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

  return { userId: user.id, sid };
}

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

async function addPin(
  userId: string,
  companyId: string,
  appointment: boolean,
): Promise<void> {
  await db.insert(pinsTable).values({
    userId,
    companyId,
    latitude: 39.7,
    longitude: -104.9,
    workflow: 'insurance',
    doorKnockResult: appointment ? 'appointment' : 'no_answer',
  });
}

describe('M-B routes', () => {
  const companyA = `TEST-MB-${RUN_ID}-A`.toUpperCase();
  const companyB = `TEST-MB-${RUN_ID}-B`.toUpperCase();
  let managerA: SeededUser;
  let repA1: SeededUser;
  let repA2: SeededUser;
  let inspectorA: SeededUser;
  let repB: SeededUser;
  const userIds: string[] = [];

  beforeAll(async () => {
    await db
      .insert(companiesTable)
      .values([
        { id: companyA, name: companyA },
        { id: companyB, name: companyB },
      ]);

    managerA = await seedUser('mgr', 'manager', 'canvasser', companyA);
    repA1 = await seedUser('rep1', 'field_rep', 'canvasser', companyA);
    repA2 = await seedUser('rep2', 'field_rep', 'canvasser', companyA);
    inspectorA = await seedUser('insp', 'field_rep', 'inspector_canvasser', companyA);
    repB = await seedUser('repb', 'field_rep', 'canvasser', companyB);
    userIds.push(managerA.userId, repA1.userId, repA2.userId, inspectorA.userId, repB.userId);

    // rep1: 3 pins, 2 appointments. rep2: 1 pin, 0 appointments.
    await addPin(repA1.userId, companyA, true);
    await addPin(repA1.userId, companyA, true);
    await addPin(repA1.userId, companyA, false);
    await addPin(repA2.userId, companyA, false);
    // company B pin must never leak into company A stats.
    await addPin(repB.userId, companyB, true);
  });

  afterAll(async () => {
    await db.delete(canvassingSessionsTable).where(inArray(canvassingSessionsTable.userId, userIds));
    await db.delete(attestationsTable).where(inArray(attestationsTable.userId, userIds));
    await db.delete(inspectionsTable).where(inArray(inspectionsTable.inspectorUserId, userIds));
    await db.delete(pinsTable).where(inArray(pinsTable.userId, userIds));
    await db.delete(userProfilesTable).where(inArray(userProfilesTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await db.delete(companiesTable).where(inArray(companiesTable.id, [companyA, companyB]));
  });

  describe('B2 canvassing time tracking', () => {
    it('clocks in, blocks a double clock-in, reports current, then clocks out', async () => {
      const inRes = await request(app).post('/api/canvassing/clock-in').set(auth(repA1.sid));
      expect(inRes.status).toBe(201);
      expect(inRes.body.session.endedAt).toBeNull();

      const dupe = await request(app).post('/api/canvassing/clock-in').set(auth(repA1.sid));
      expect(dupe.status).toBe(409);

      const current = await request(app).get('/api/canvassing/current').set(auth(repA1.sid));
      expect(current.status).toBe(200);
      expect(current.body.session).not.toBeNull();

      const outRes = await request(app).post('/api/canvassing/clock-out').set(auth(repA1.sid));
      expect(outRes.status).toBe(200);
      expect(outRes.body.session.endedAt).not.toBeNull();

      const outAgain = await request(app).post('/api/canvassing/clock-out').set(auth(repA1.sid));
      expect(outAgain.status).toBe(404);

      const cleared = await request(app).get('/api/canvassing/current').set(auth(repA1.sid));
      expect(cleared.body.session).toBeNull();
    });

    it('requires auth', async () => {
      const res = await request(app).post('/api/canvassing/clock-in');
      expect(res.status).toBe(401);
    });
  });

  describe('B1 activity stats', () => {
    it('field rep sees own numbers + rank, no leaderboard', async () => {
      const res = await request(app).get('/api/activity-stats').set(auth(repA1.sid));
      expect(res.status).toBe(200);
      const { stats } = res.body;
      expect(stats.canViewLeaderboard).toBe(false);
      expect(stats.scope).toBe('own');
      expect(stats.leaderboard).toEqual([]);
      expect(stats.period.pinsDropped).toBe(3);
      expect(stats.period.appointmentsSet).toBe(2);
      expect(stats.period.appointmentsCompleted).toBeNull();
      expect(stats.myRank).toBe(1); // most appointments in cohort
      expect(stats.competitive.cohortSize).toBe(4); // 4 users in company A
    });

    it('field rep cannot escalate scope via query', async () => {
      const res = await request(app)
        .get('/api/activity-stats?scope=total')
        .set(auth(repA2.sid));
      expect(res.status).toBe(200);
      expect(res.body.stats.scope).toBe('own'); // clamped
      expect(res.body.stats.period.pinsDropped).toBe(1);
    });

    it('manager sees company total and a named leaderboard', async () => {
      const res = await request(app)
        .get('/api/activity-stats?scope=total')
        .set(auth(managerA.sid));
      expect(res.status).toBe(200);
      const { stats } = res.body;
      expect(stats.canViewLeaderboard).toBe(true);
      expect(stats.scope).toBe('total');
      // total pins across company A today = 3 + 1 = 4 (company B excluded)
      expect(stats.period.pinsDropped).toBe(4);
      expect(stats.period.appointmentsSet).toBe(2);
      expect(stats.leaderboard.length).toBe(4);
      expect(stats.leaderboard[0].appointmentsSet).toBe(2);
      expect(stats.leaderboard[0].name).toContain('rep1');
      expect(stats.leaderboard[0].appointmentsCompleted).toBeNull();
    });

    it('manager individual scope targets one rep', async () => {
      const res = await request(app)
        .get(`/api/activity-stats?scope=individual&userId=${repA2.userId}`)
        .set(auth(managerA.sid));
      expect(res.status).toBe(200);
      expect(res.body.stats.period.pinsDropped).toBe(1);
    });

    it('competitive team total excludes other companies', async () => {
      const res = await request(app).get('/api/activity-stats').set(auth(managerA.sid));
      // trailing-30d team appointments in company A = 2 (company B's is excluded)
      expect(res.body.stats.competitive.teamTotal.appointmentsSet).toBe(2);
    });
  });

  describe('B3 scheduled seam + idempotent start', () => {
    it('scheduled feed is empty but well-formed for inspectors', async () => {
      const res = await request(app).get('/api/inspections/scheduled').set(auth(inspectorA.sid));
      expect(res.status).toBe(200);
      expect(res.body.scheduled).toEqual([]);
    });

    it('scheduled feed is gated to the inspection module', async () => {
      const res = await request(app).get('/api/inspections/scheduled').set(auth(repA2.sid));
      expect(res.status).toBe(403);
    });

    it('client-id create is idempotent (safe offline retry)', async () => {
      const id = `mb-insp-${RUN_ID}`;
      const first = await request(app)
        .post('/api/inspections')
        .set(auth(inspectorA.sid))
        .send({ id, status: 'capturing', insuredName: 'Jane Doe' });
      expect(first.status).toBe(201);
      expect(first.body.inspection.id).toBe(id);
      expect(first.body.inspection.status).toBe('capturing');

      const retry = await request(app)
        .post('/api/inspections')
        .set(auth(inspectorA.sid))
        .send({ id, status: 'capturing', insuredName: 'Jane Doe' });
      expect(retry.status).toBe(200); // returns existing, no duplicate
      expect(retry.body.inspection.id).toBe(id);
    });
  });

  describe('B4 typed equipment attestation + intake', () => {
    it('stores an equipment attestation with structured details', async () => {
      const created = await request(app)
        .post('/api/inspections')
        .set(auth(inspectorA.sid))
        .send({ status: 'capturing', dateOfLoss: '2025-06-01' });
      const inspectionId = created.body.inspection.id;
      expect(created.body.inspection.dateOfLoss).toBe('2025-06-01');

      const att = await request(app)
        .post(`/api/inspections/${inspectionId}/attestations`)
        .set(auth(inspectorA.sid))
        .send({
          stage: 'arrival',
          attestationType: 'equipment',
          details: { ladder: true, chalk: true, camera: true },
          signatureData: 'Inspector Test',
        });
      expect(att.status).toBe(201);
      expect(att.body.attestation.attestationType).toBe('equipment');
      expect(att.body.attestation.details).toEqual({ ladder: true, chalk: true, camera: true });
    });
  });

  describe('B5 weather gate + no-LLM guarantee', () => {
    it('blocks non-inspectors', async () => {
      const res = await request(app)
        .get('/api/weather/events?location=Denver,CO')
        .set(auth(repA2.sid));
      expect(res.status).toBe(403);
    });

    it('requires a location for inspectors', async () => {
      const res = await request(app).get('/api/weather/events').set(auth(inspectorA.sid));
      expect(res.status).toBe(400);
    });

    it('ships no AI/LLM code path', () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const route = readFileSync(path.resolve(here, '../weather.ts'), 'utf8');
      const engine = readFileSync(path.resolve(here, '../../lib/weatherEngine.ts'), 'utf8');
      // Strip comments so the prose ("...the Anthropic seam is cut...") in
      // these files doesn't trip the guard — we care about executable code.
      const stripComments = (s: string) =>
        s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const code = stripComments(route + '\n' + engine).toLowerCase();
      expect(code).not.toContain('anthropic');
      expect(code).not.toContain('claude');
      expect(code).not.toContain('messages.create');
      expect(code).not.toContain('buildprompt');
    });
  });
});

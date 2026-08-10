/**
 * route-auth-negative.test.ts
 *
 * Data-driven negative gate tests. Every role-gated route should:
 *   • Return 401 when called with no authentication.
 *   • Return 403 when called by an under-privileged actor (field_rep for
 *     manager+ routes; manager for admin+ routes).
 *
 * Run this suite after each domain migration. New domains are added at the
 * bottom under their own describe block; do not reorder existing blocks.
 *
 * ── Verdict-change manifest ──────────────────────────────────────────────────
 * The following routes produce 200 (not 403) for a field_rep who OWNS the
 * resource after the registry migration (Section 5–9 rulings). These are
 * NOT tested here (negative suite only tests non-owners / wrong-role actors):
 *   payment.view/create/update/delete — field_rep who owns the pin
 *   expense.view/create/update/delete — same
 *   overhead.view/update              — same
 *   change_order.create/read/update/sign/delete — same
 *   commission.view                   — same
 *   coc.create/deliver/read/sign      — same
 *   (All ownerOrRole: manager — field_rep NON-owner still gets 403)
 *
 * Migration domains covered so far:
 *   [D1] admin      — team.view_stats, team.view, team.edit, team.delete
 *   [D2] location   — team.view (GET /location/team)
 *   [D3] pipeline   — lead.advance_stage (POST /events/pipeline)
 *   [D4] financials — profitability.export_csv (GET /pins/:id/financials/export)
 *   [D5] profitability — profitability.view (GET /pins/:id/profitability)
 */

import { companiesTable, db, userProfilesTable, usersTable } from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `neg-${Date.now().toString(36)}`;

interface Actor { id: string; sid: string; }

interface NegFixture {
  companyId: string;
  superAdmin: Actor;
  admin: Actor;
  manager: Actor;
  rep: Actor;
  /**
   * Stub ID used for :param segments in paths that have not yet been seeded.
   * Because requirePermission middleware rejects before any DB lookup, the
   * resource does not need to exist for 401 / 403 tests.
   */
  stubId: string;
}

async function seedActor(companyId: string, role: string, tag: string): Promise<Actor> {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `neg-${tag}-${RUN_ID}@example.test` })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role: role as never });
  const sid = await createSession({
    user: {
      id:              user.id,
      email:           user.email,
      firstName:       user.firstName,
      lastName:        user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
    access_token: 'test-token',
  });
  return { id: user.id, sid };
}

describe('route auth — negative gate suite', () => {
  let fix: NegFixture;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const companyId = `NEG-${RUN_ID}`.toUpperCase().slice(0, 40);
    await db.insert(companiesTable).values({ id: companyId, name: `Neg Auth Test ${RUN_ID}` });

    const [superAdmin, admin, manager, rep] = await Promise.all([
      seedActor(companyId, 'super_admin', 'sa'),
      seedActor(companyId, 'admin',       'adm'),
      seedActor(companyId, 'manager',     'mgr'),
      seedActor(companyId, 'field_rep',   'rep'),
    ]);

    createdIds.push(superAdmin.id, admin.id, manager.id, rep.id);
    fix = { companyId, superAdmin, admin, manager, rep, stubId: 'non-existent-stub-00001' };
  });

  afterAll(async () => {
    await db.delete(usersTable).where(inArray(usersTable.id, createdIds));
    await db.delete(companiesTable).where(inArray(companiesTable.id, [fix.companyId]));
  });

  function auth(sid: string) { return { Authorization: `Bearer ${sid}` }; }

  // ── [D1] DOMAIN: admin / team ─────────────────────────────────────────────
  // Verdict changes: none (all gates tightened or unchanged by migration)

  describe('[D1] GET /admin/stats [team.view_stats — admin+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/admin/stats')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).get('/api/admin/stats').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('manager → 403 (admin-tier only per team.view_stats / PD-1)', async () => {
      expect((await request(app).get('/api/admin/stats').set(auth(fix.manager.sid))).status).toBe(403);
    });
    it('admin → 200', async () => {
      expect((await request(app).get('/api/admin/stats').set(auth(fix.admin.sid))).status).toBe(200);
    });
  });

  describe('[D1] GET /team/users [team.view — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/team/users')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).get('/api/team/users').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('manager → 200', async () => {
      expect((await request(app).get('/api/team/users').set(auth(fix.manager.sid))).status).toBe(200);
    });
  });

  describe('[D1] PATCH /team/users/:userId [team.edit — manager+]', () => {
    it('no auth → 401', async () => {
      const res = await request(app).patch(`/api/team/users/${fix.stubId}`).send({ role: 'field_rep' });
      expect(res.status).toBe(401);
    });
    it('field_rep → 403', async () => {
      const res = await request(app)
        .patch(`/api/team/users/${fix.stubId}`)
        .set(auth(fix.rep.sid))
        .send({ role: 'field_rep' });
      expect(res.status).toBe(403);
    });
  });

  describe('[D1] DELETE /team/users/:userId [team.delete — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).delete(`/api/team/users/${fix.stubId}`)).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).delete(`/api/team/users/${fix.stubId}`).set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  // ── [D2] DOMAIN: location ─────────────────────────────────────────────────
  // Verdict changes: none

  describe('[D2] GET /location/team [team.view — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/location/team')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).get('/api/location/team').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('manager → 200', async () => {
      expect((await request(app).get('/api/location/team').set(auth(fix.manager.sid))).status).toBe(200);
    });
  });

  // ── [D3] DOMAIN: pipeline events ─────────────────────────────────────────
  // lead.advance_stage is ownerOrRole: manager. At this collection endpoint there
  // is no resource ownerId, so the ownerOrRole check collapses to manager+.
  // Verdict changes: none (was isManagerOrAdmin — identical effective gate)

  describe('[D3] POST /events/pipeline [lead.advance_stage — manager+]', () => {
    it('no auth → 401', async () => {
      const res = await request(app).post('/api/events/pipeline').send({ eventType: 'test' });
      expect(res.status).toBe(401);
    });
    it('field_rep → 403', async () => {
      const res = await request(app)
        .post('/api/events/pipeline')
        .set(auth(fix.rep.sid))
        .send({ eventType: 'test' });
      expect(res.status).toBe(403);
    });
  });

  // ── [D4] DOMAIN: financials export ───────────────────────────────────────
  // Verdict changes: none (was isManagerOrAdmin — same as profitability.export_csv manager+)

  describe('[D4] GET /pins/:pinId/financials/export [profitability.export_csv — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get(`/api/pins/${fix.stubId}/financials/export`)).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).get(`/api/pins/${fix.stubId}/financials/export`).set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  // ── [D5] DOMAIN: profitability ────────────────────────────────────────────
  // Verdict changes: none (was canViewProfitability — same as profitability.view manager+)

  describe('[D5] GET /pins/:pinId/profitability [profitability.view — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get(`/api/pins/${fix.stubId}/profitability`)).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).get(`/api/pins/${fix.stubId}/profitability`).set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  // ── Additional domains are appended below as migration proceeds ───────────
  // Template:
  //
  // describe('[D6] VERB /path [permission.key — minRole+]', () => {
  //   it('no auth → 401', async () => { ... });
  //   it('field_rep → 403', async () => { ... });
  //   // If there is a verdict change: document it as a comment, not a failing test.
  // });
});

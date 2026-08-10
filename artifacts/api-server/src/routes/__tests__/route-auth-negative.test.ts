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
 *   [D6] price-book   — catalog.price_book_{view,add,edit,delete}
 *   [D7] templates    — company.edit_settings (CRUD /companies/:id/templates)
 *   [D8] discontinued — catalog.price_book_{view,edit,delete}
 *   [D9] selections   — catalog.price_book_view (GETs), catalog.selections_manage (writes)
 *   [D10] library     — report.settings_view (GETs), report.settings_edit (writes) — super_admin+
 *   [D11] ahjWizard   — catalog.ahj_wizard (all 10 routes) — super_admin+
 *   [D12] insurance   — lead.read (GET, field_rep+), lead.update (PATCH, ownerOrRole:manager+)
 *   [D13] payments    — payment.* (ownerOrRole:manager+) — VERDICT CHANGE: field_rep pin owners
 *   [D14] expenses    — expense.view/create/update/delete (ownerOrRole), expense.manage (manager+)
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

  // ── [D6] DOMAIN: price-book ───────────────────────────────────────────────
  // catalog.price_book_view (GETs) = field_rep+ → 401 only (field_rep passes).
  // catalog.price_book_add/edit/delete (writes) = admin+ → 401 + 403 field_rep.
  // Verdict changes: none.

  describe('[D6] price-book reads [catalog.price_book_view — field_rep+]', () => {
    for (const path of ['/api/price-book/items', '/api/price-book/packages']) {
      it(`GET ${path} → 401 without auth`, async () => {
        expect((await request(app).get(path)).status).toBe(401);
      });
    }
  });

  describe('[D6] price-book writes [catalog.price_book_add/edit/delete — admin+]', () => {
    const routes: Array<[string, string]> = [
      ['post',   '/api/price-book/generate-description'],
      ['post',   '/api/price-book/items'],
      ['patch',  '/api/price-book/items/stub-id'],
      ['delete', '/api/price-book/items/stub-id'],
      ['post',   '/api/price-book/packages'],
      ['patch',  '/api/price-book/packages/stub-id'],
      ['delete', '/api/price-book/packages/stub-id'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
      it(`${method.toUpperCase()} ${path} → 403 field_rep`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.rep.sid))).status).toBe(403);
      });
    }
  });

  // ── [D7] DOMAIN: company templates ────────────────────────────────────────
  // company.edit_settings (admin+). Old requireCompanyAdmin also checked admin+.
  // The inline same-company path guard is NOT tested here (needs a real company).
  // Verdict changes: none.

  describe('[D7] company templates [company.edit_settings — admin+]', () => {
    const routes: Array<[string, string]> = [
      ['get',    '/api/companies/STUB-CO/templates'],
      ['post',   '/api/companies/STUB-CO/templates'],
      ['patch',  '/api/companies/STUB-CO/templates/stub-id'],
      ['delete', '/api/companies/STUB-CO/templates/stub-id'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
      it(`${method.toUpperCase()} ${path} → 403 field_rep`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.rep.sid))).status).toBe(403);
      });
    }
  });

  // ── [D8] DOMAIN: discontinued-products ───────────────────────────────────
  // GET catalog.price_book_view (field_rep+) — 401 only.
  // Writes catalog.price_book_edit/delete (admin+) — 401 + 403 field_rep.
  // Verdict changes: none.

  describe('[D8] discontinued-products GET [catalog.price_book_view — field_rep+]', () => {
    it('GET /api/discontinued-products → 401 without auth', async () => {
      expect((await request(app).get('/api/discontinued-products')).status).toBe(401);
    });
  });

  describe('[D8] discontinued-products writes [catalog.price_book_edit — admin+]', () => {
    const routes: Array<[string, string]> = [
      ['post',   '/api/discontinued-products'],
      ['patch',  '/api/discontinued-products/stub-id'],
      ['delete', '/api/discontinued-products/stub-id'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
      it(`${method.toUpperCase()} ${path} → 403 field_rep`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.rep.sid))).status).toBe(403);
      });
    }
  });

  // ── [D9] DOMAIN: selections ────────────────────────────────────────────────
  // GETs catalog.price_book_view (field_rep+) — 401 only (field_rep passes).
  // Writes catalog.selections_manage (admin+) — 401 + 403 field_rep.
  // Verdict changes: none.

  describe('[D9] selections GET routes [catalog.price_book_view — field_rep+]', () => {
    for (const path of [
      '/api/selections/categories',
      '/api/selections/brands',
      '/api/selections/products',
      '/api/selections/options',
      '/api/selections/product-options',
    ]) {
      it(`GET ${path} → 401 without auth`, async () => {
        expect((await request(app).get(path)).status).toBe(401);
      });
    }
  });

  describe('[D9] selections write routes [catalog.selections_manage — admin+]', () => {
    const routes: Array<[string, string]> = [
      ['post',   '/api/selections/categories'],
      ['patch',  '/api/selections/categories/stub-id'],
      ['delete', '/api/selections/categories/stub-id'],
      ['post',   '/api/selections/brands'],
      ['patch',  '/api/selections/brands/stub-id'],
      ['delete', '/api/selections/brands/stub-id'],
      ['post',   '/api/selections/products'],
      ['patch',  '/api/selections/products/stub-id'],
      ['delete', '/api/selections/products/stub-id'],
      ['post',   '/api/selections/options'],
      ['patch',  '/api/selections/options/stub-id'],
      ['delete', '/api/selections/options/stub-id'],
      ['post',   '/api/selections/product-options/bulk'],
      ['post',   '/api/selections/product-options'],
      ['delete', '/api/selections/product-options/stub-id'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
      it(`${method.toUpperCase()} ${path} → 403 field_rep`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.rep.sid))).status).toBe(403);
      });
    }
  });

  // ── [D10] DOMAIN: BP/standards/detriment library ─────────────────────────
  // report.settings_view (GETs) / report.settings_edit (writes) — both super_admin+.
  // Verdict changes: none. Admin (< super_admin) tested explicitly.

  describe('[D10] library GET routes [report.settings_view — super_admin+]', () => {
    const routes: Array<[string, string]> = [
      ['get', '/api/report-settings/bp-library'],
      ['get', '/api/report-settings/bp-library/stub-key'],
      ['get', '/api/report-settings/standards-entries'],
      ['get', '/api/report-settings/detriment-entries'],
      ['get', '/api/report-settings/ahj-packs'],
      ['get', '/api/report-settings/agent-prompts'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
      it(`${method.toUpperCase()} ${path} → 403 field_rep`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.rep.sid))).status).toBe(403);
      });
      it(`${method.toUpperCase()} ${path} → 403 admin (super_admin gate)`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.admin.sid))).status).toBe(403);
      });
    }
  });

  describe('[D10] library write routes [report.settings_edit — super_admin+]', () => {
    const routes: Array<[string, string]> = [
      ['put',    '/api/report-settings/bp-library/stub-key'],
      ['put',    '/api/report-settings/standards-entries/stub-key'],
      ['delete', '/api/report-settings/standards-entries/stub-key'],
      ['put',    '/api/report-settings/detriment-entries/stub-key'],
      ['delete', '/api/report-settings/detriment-entries/stub-key'],
      ['post',   '/api/report-settings/ahj-packs'],
      ['patch',  '/api/report-settings/ahj-packs/stub-id'],
      ['put',    '/api/report-settings/agent-prompts/stub-key'],
      ['delete', '/api/report-settings/agent-prompts/stub-key'],
      ['post',   '/api/report-settings/pp-wizard/analyze'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
      it(`${method.toUpperCase()} ${path} → 403 field_rep`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.rep.sid))).status).toBe(403);
      });
      it(`${method.toUpperCase()} ${path} → 403 admin (super_admin gate)`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.admin.sid))).status).toBe(403);
      });
    }
  });

  // ── [D11] DOMAIN: AHJ wizard ──────────────────────────────────────────────
  // catalog.ahj_wizard (super_admin+) for all 10 wizard admin routes.
  // Field-rep catalog.ahj_add/edit (field_rep+) are a DIFFERENT surface.
  // Verdict changes: none. Admin tested explicitly (< super_admin).

  describe('[D11] AHJ wizard [catalog.ahj_wizard — super_admin+]', () => {
    const routes: Array<[string, string]> = [
      ['post',   '/api/ahj-wizard/sources'],
      ['get',    '/api/ahj-wizard/sources'],
      ['post',   '/api/ahj-wizard/runs'],
      ['get',    '/api/ahj-wizard/runs'],
      ['delete', '/api/ahj-wizard/runs/stub-id'],
      ['get',    '/api/ahj-wizard/runs/stub-id/items'],
      ['patch',  '/api/ahj-wizard/items/stub-id'],
      ['post',   '/api/ahj-wizard/items/bulk-reject'],
      ['post',   '/api/ahj-wizard/assemble'],
      ['post',   '/api/ahj-wizard/seed-virginia'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
      it(`${method.toUpperCase()} ${path} → 403 field_rep`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.rep.sid))).status).toBe(403);
      });
      it(`${method.toUpperCase()} ${path} → 403 admin (super_admin gate)`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.admin.sid))).status).toBe(403);
      });
    }
  });

  // ── [D12] DOMAIN: insurance ────────────────────────────────────────────────
  // GET  /pins/:pinId/insurance — lead.read (field_rep+): auth-only gate, no role change.
  // PATCH /pins/:pinId/insurance — lead.update (ownerOrRole:manager+).
  //   VERDICT CHANGE: field_rep who OWN the pin may now edit insurance data (previously manager+).
  //   Non-owner field_rep → 404 when pin stub-id doesn't exist (ownerOrRole flows: 404 before 403).
  //   403 for non-owner requires a real pin setup; covered by integration tests not here.

  describe('[D12] GET /pins/:pinId/insurance [lead.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/pins/stub-id/insurance')).status).toBe(401);
    });
    // field_rep+ is minimum role — all authenticated users pass the gate.
  });

  describe('[D12] PATCH /pins/:pinId/insurance [lead.update — ownerOrRole:manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/pins/stub-id/insurance')).status).toBe(401);
    });
    // VERDICT CHANGE: non-owner field_rep → 404 for stub-id (ownerOrRole runs after pin load).
    // field_rep who IS the pin owner → 200 (new permission; previously 403).
  });

  // ── [D13] DOMAIN: payments ─────────────────────────────────────────────────
  // All 4 routes: payment.* (ownerOrRole:manager+).
  // VERDICT CHANGE: field_rep pin owners may now view and record payments.
  // Negative tests cover unauthenticated only; non-owner 403 requires DB setup.

  describe('[D13] payments [payment.* — ownerOrRole:manager+]', () => {
    const routes: Array<[string, string]> = [
      ['get',    '/api/pins/stub-id/payments'],
      ['post',   '/api/pins/stub-id/payments'],
      ['patch',  '/api/payments/stub-id'],
      ['delete', '/api/payments/stub-id'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
    }
    // VERDICT CHANGE: field_rep who OWNS the pin now passes payment.view/create/update/delete.
    // Non-owner field_rep hits 404 on stub resource before reaching the ownerOrRole gate.
  });

  // ── [D14] DOMAIN: expenses ─────────────────────────────────────────────────
  // expense.view/create/update/delete (ownerOrRole:manager+) — VERDICT CHANGE for pin owners.
  // expense.manage (minRole:manager) — commission routes and mark-paid; no verdict change.

  describe('[D14] expenses ownerOrRole routes [expense.* — ownerOrRole:manager+]', () => {
    const routes: Array<[string, string]> = [
      ['get',    '/api/pins/stub-id/expenses'],
      ['post',   '/api/pins/stub-id/expenses'],
      ['patch',  '/api/expenses/stub-id'],
      ['delete', '/api/expenses/stub-id'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
    }
    // VERDICT CHANGE: field_rep who OWNS the pin now passes expense.view/create/update/delete.
  });

  describe('[D14] expenses minRole:manager routes [expense.manage — manager+]', () => {
    const routes: Array<[string, string]> = [
      ['post',  '/api/expenses/stub-id/mark-paid'],
      ['patch', '/api/pins/stub-id/commissions'],
      ['post',  '/api/pins/stub-id/commissions/sales/mark-paid'],
      ['post',  '/api/pins/stub-id/commissions/pm/mark-paid'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
      it(`${method.toUpperCase()} ${path} → 403 field_rep (manager+)`, async () => {
        expect((await (request(app) as any)[method](path).set(auth(fix.rep.sid))).status).toBe(403);
      });
    }
  });

  // ── [D15] DOMAIN: pins ─────────────────────────────────────────────────────
  // lead.read (field_rep+): no role verdict changes for GET routes.
  // lead.create (field_rep+): same.
  // lead.bulk_create (field_rep+): VERDICT CHANGE — was manager+, registry allows field_rep.
  // lead.update (ownerOrRole:manager+): non-owner field_rep → 404 on stub-id (pin lookup first).
  // lead.set_appointment (ownerOrRole:manager+): same.
  // lead.delete (manager+): field_rep → 403.
  // profitability.view (manager+): field_rep → 403.

  describe('[D15] GET /pins [lead.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/pins')).status).toBe(401);
    });
  });

  describe('[D15] POST /pins [lead.create — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/pins')).status).toBe(401);
    });
  });

  describe('[D15] POST /pins/bulk [lead.bulk_create — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/pins/bulk')).status).toBe(401);
    });
    // VERDICT CHANGE: was manager+, now field_rep+ per registry intent (canvassing bulk-import).
  });

  describe('[D15] GET /pins/:pinId [lead.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/pins/stub-id')).status).toBe(401);
    });
  });

  describe('[D15] PATCH /pins/:pinId [lead.update — ownerOrRole:manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/pins/stub-id')).status).toBe(401);
    });
    // Non-owner field_rep → 404 (pin not found for stub-id before ownerOrRole check).
  });

  describe('[D15] PATCH /pins/:pinId/profile [lead.update — ownerOrRole:manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/pins/stub-id/profile')).status).toBe(401);
    });
    // Non-owner field_rep → 404 for stub-id. Financial fields still require manager+ inline.
  });

  describe('[D15] GET /pins/:pinId/financial-changes [profitability.view — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/pins/stub-id/financial-changes')).status).toBe(401);
    });
    it('field_rep → 403 (manager+)', async () => {
      expect((await request(app).get('/api/pins/stub-id/financial-changes').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D15] PATCH /pins/:pinId/appointment [lead.set_appointment — ownerOrRole:manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/pins/stub-id/appointment')).status).toBe(401);
    });
    // Non-owner field_rep → 404 for stub-id.
  });

  describe('[D15] DELETE /pins/:pinId [lead.delete — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).delete('/api/pins/stub-id')).status).toBe(401);
    });
    it('field_rep → 403 (manager+)', async () => {
      expect((await request(app).delete('/api/pins/stub-id').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  // ── [D16] DOMAIN: companies ─────────────────────────────────────────────────
  // Most routes: admin+ required (same-company check is inline after middleware).
  // Exceptions noted below.

  describe('[D16] POST /companies [super_admin+ via loadActorCtx]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/companies')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/companies').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('manager → 403 (below super_admin)', async () => {
      expect((await request(app).post('/api/companies').set(auth(fix.manager.sid))).status).toBe(403);
    });
  });

  describe('[D16] PATCH /companies/:companyId/logo [company.edit_logo — admin+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/companies/STUB00/logo')).status).toBe(401);
    });
    it('field_rep → 403 (below admin)', async () => {
      expect((await request(app).patch('/api/companies/STUB00/logo').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D16] GET+PATCH /companies/:companyId/report-branding [company.edit_report_colors — super_admin+]', () => {
    it('GET no auth → 401', async () => {
      expect((await request(app).get('/api/companies/STUB00/report-branding')).status).toBe(401);
    });
    it('GET field_rep → 403 (below super_admin)', async () => {
      expect((await request(app).get('/api/companies/STUB00/report-branding').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('PATCH no auth → 401', async () => {
      expect((await request(app).patch('/api/companies/STUB00/report-branding')).status).toBe(401);
    });
    it('PATCH field_rep → 403', async () => {
      expect((await request(app).patch('/api/companies/STUB00/report-branding').set(auth(fix.rep.sid))).status).toBe(403);
    });
    // VERDICT CHANGE: tightened from admin+ to super_admin+.
    // Admin users (below super_admin) now get 403 on these routes.
  });

  describe('[D16] GET /companies/:companyId/lead-sources [company.view_settings — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/companies/STUB00/lead-sources')).status).toBe(401);
    });
    // VERDICT CHANGE: was admin+ (requireSameCompanyAdmin), now field_rep+ (company.view_settings).
    // All authenticated same-company members may now list lead sources.
  });

  describe('[D16] PATCH /companies/:companyId/lead-sources [company.edit_lead_sources — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/companies/STUB00/lead-sources')).status).toBe(401);
    });
    it('field_rep → 403 (manager+)', async () => {
      expect((await request(app).patch('/api/companies/STUB00/lead-sources').set(auth(fix.rep.sid))).status).toBe(403);
    });
    // VERDICT CHANGE: was admin+ (requireSameCompanyAdmin), now manager+ (company.edit_lead_sources).
  });

  describe('[D16] sample-package routes [company.view_settings — field_rep+]', () => {
    const routes: Array<[string, string]> = [
      ['get',  '/api/sample-package/info'],
      ['post', '/api/sample-package/provision'],
      ['get',  '/api/sample-package'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
    }
  });

  // ── [D17] DOMAIN: changeOrders ───────────────────────────────────────────────

  describe('[D17] GET /pins/:pinId/change-orders [change_order.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/pins/STUB00/change-orders')).status).toBe(401);
    });
    // field_rep+ → field_rep allowed; 401 is the only negative gate.
  });

  describe('[D17] POST /pins/:pinId/change-orders [change_order.create — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/pins/STUB00/change-orders')).status).toBe(401);
    });
  });

  describe('[D17] DELETE /change-orders/:id [change_order.delete — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).delete('/api/change-orders/STUB00')).status).toBe(401);
    });
    // VERDICT CHANGE: was manager+; now field_rep+ per change_order.delete registry key.
  });

  describe('[D17] POST /change-orders/:id/approve [change_order.approve — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/change-orders/STUB00/approve')).status).toBe(401);
    });
    it('field_rep → 403 (below manager)', async () => {
      expect((await request(app).post('/api/change-orders/STUB00/approve').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D17] POST /change-orders/:id/void [change_order.void — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/change-orders/STUB00/void')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/change-orders/STUB00/void').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D17] PATCH /pins/:pinId/overhead [expense.manage — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/pins/STUB00/overhead')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).patch('/api/pins/STUB00/overhead').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D17] POST overhead mark-paid routes [expense.manage — manager+]', () => {
    const paths = [
      '/api/pins/STUB00/overhead/lead-acquisition/mark-paid',
      '/api/pins/STUB00/overhead/referral/mark-paid',
      '/api/pins/STUB00/overhead/sales/mark-paid',
      '/api/pins/STUB00/overhead/canvassing/mark-paid',
      '/api/pins/STUB00/overhead/pm/mark-paid',
    ];
    for (const path of paths) {
      it(`${path.split('/').pop()} → 401 without auth`, async () => {
        expect((await request(app).post(path)).status).toBe(401);
      });
      it(`${path.split('/').pop()} field_rep → 403`, async () => {
        expect((await request(app).post(path).set(auth(fix.rep.sid))).status).toBe(403);
      });
    }
  });

  // ── [D18] DOMAIN: completionCertificates (all coc.* — ownerOrRole manager+) ─

  describe('[D18] POST /leads/:leadId/completion-certificate/extract [coc.create — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/leads/STUB00/completion-certificate/extract')).status).toBe(401);
    });
    it('field_rep → 403 (below manager)', async () => {
      expect((await request(app).post('/api/leads/STUB00/completion-certificate/extract').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D18] GET /leads/:leadId/completion-certificate [coc.read — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/leads/STUB00/completion-certificate')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).get('/api/leads/STUB00/completion-certificate').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D18] PATCH /leads/:leadId/completion-certificate/:certId [coc.create — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/leads/STUB00/completion-certificate/CERT00')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).patch('/api/leads/STUB00/completion-certificate/CERT00').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D18] POST /leads/:leadId/completion-certificate/:certId/sign [coc.sign — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/leads/STUB00/completion-certificate/CERT00/sign')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/leads/STUB00/completion-certificate/CERT00/sign').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D18] POST /leads/:leadId/completion-certificate/:certId/void [coc.create — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/leads/STUB00/completion-certificate/CERT00/void')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/leads/STUB00/completion-certificate/CERT00/void').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  // ── [D19] DOMAIN: contracts ──────────────────────────────────────────────────

  describe('[D19] GET /pins/:pinId/contracts [contract.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/pins/STUB00/contracts')).status).toBe(401);
    });
    // field_rep+ → only 401 gate needed.
  });

  describe('[D19] POST /pins/:pinId/contracts [contract.create — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/pins/STUB00/contracts')).status).toBe(401);
    });
  });

  describe('[D19] GET /contracts/:contractId [contract.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/contracts/STUB00')).status).toBe(401);
    });
  });

  describe('[D19] POST /contracts/:contractId/void [contract.void — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/contracts/STUB00/void')).status).toBe(401);
    });
    it('field_rep → 403 (below manager)', async () => {
      expect((await request(app).post('/api/contracts/STUB00/void').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  // ── [D20] DOMAIN: invoices ───────────────────────────────────────────────────

  describe('[D20] GET /pins/:pinId/invoices [invoice.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/pins/STUB00/invoices')).status).toBe(401);
    });
  });

  describe('[D20] POST /pins/:pinId/invoices [invoice.create — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/pins/STUB00/invoices')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/pins/STUB00/invoices').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D20] DELETE /invoices/:invoiceId [invoice.delete — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).delete('/api/invoices/STUB00')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).delete('/api/invoices/STUB00').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D20] POST /invoices/:invoiceId/void [invoice.void — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/invoices/STUB00/void')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/invoices/STUB00/void').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  // ── [D21] DOMAIN: profile (all self-scoped, field_rep+) ──────────────────────

  describe('[D21] GET /profile/me [profile.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/profile/me')).status).toBe(401);
    });
  });

  describe('[D21] PATCH /profile/me [profile.update — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/profile/me')).status).toBe(401);
    });
  });

  // ── [D22] DOMAIN: notifications ──────────────────────────────────────────────

  describe('[D22] GET /notifications/preferences [notification.manage — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/notifications/preferences')).status).toBe(401);
    });
  });

  describe('[D22] POST /notifications/push-receipts [notification.push_receipts — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/notifications/push-receipts')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/notifications/push-receipts').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  // ── [D23–D28] Small utility domains (all field_rep+) ──────────────────────────

  describe('[D23-D28] small utility route auth gates (field_rep+)', () => {
    const routes: [string, string][] = [
      ['get',  '/api/canvassing/current'],
      ['post', '/api/canvassing/clock-in'],
      ['post', '/api/canvassing/clock-out'],
      ['get',  '/api/activity-stats'],
      ['get',  '/api/calendar'],
      ['get',  '/api/geocode/reverse'],
      ['get',  '/api/geocode/search'],
      ['get',  '/api/crm/status'],
      ['get',  '/api/weather/events'],
    ];
    for (const [method, path] of routes) {
      it(`${method.toUpperCase()} ${path} → 401 without auth`, async () => {
        expect((await (request(app) as any)[method](path)).status).toBe(401);
      });
    }
  });

  // ── [D29] DOMAIN: dashboard (layout routes — field_rep+) ─────────────────────

  describe('[D29] dashboard layout routes [dashboard.view / manage_layout — field_rep+]', () => {
    it('GET /dashboard/manifest → 401 without auth', async () => {
      expect((await request(app).get('/api/dashboard/manifest')).status).toBe(401);
    });
    it('GET /dashboard/layout → 401 without auth', async () => {
      expect((await request(app).get('/api/dashboard/layout')).status).toBe(401);
    });
    it('PATCH /dashboard/layout → 401 without auth', async () => {
      expect((await request(app).patch('/api/dashboard/layout')).status).toBe(401);
    });
    it('DELETE /dashboard/layout → 401 without auth', async () => {
      expect((await request(app).delete('/api/dashboard/layout')).status).toBe(401);
    });
  });

  // ── [D30] DOMAIN: agreement ──────────────────────────────────────────────────

  describe('[D30] POST /inspections/:id/agreement/sign [inspection.update — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/inspections/STUB00/agreement/sign')).status).toBe(401);
    });
    it('field_rep → 403 (below manager)', async () => {
      expect((await request(app).post('/api/inspections/STUB00/agreement/sign').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D30] DELETE /inspections/:id/agreement [inspection.delete_agreement — super_admin+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).delete('/api/inspections/STUB00/agreement')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).delete('/api/inspections/STUB00/agreement').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('manager → 403 (below super_admin)', async () => {
      expect((await request(app).delete('/api/inspections/STUB00/agreement').set(auth(fix.manager.sid))).status).toBe(403);
    });
    it('admin → 403 (below super_admin)', async () => {
      expect((await request(app).delete('/api/inspections/STUB00/agreement').set(auth(fix.admin.sid))).status).toBe(403);
    });
  });

  describe('[D30] GET /documents [inspection.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/documents')).status).toBe(401);
    });
  });

  // ── [D31] DOMAIN: inspections ─────────────────────────────────────────────

  describe('[D31] GET /inspections [inspection.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/inspections')).status).toBe(401);
    });
  });

  describe('[D31] POST /inspections [inspection.create — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/inspections')).status).toBe(401);
    });
  });

  describe('[D31] DELETE /inspections/:id [inspection.delete — super_admin+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).delete('/api/inspections/STUB00')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).delete('/api/inspections/STUB00').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('manager → 403 (below super_admin)', async () => {
      expect((await request(app).delete('/api/inspections/STUB00').set(auth(fix.manager.sid))).status).toBe(403);
    });
    it('admin → 403 (below super_admin)', async () => {
      expect((await request(app).delete('/api/inspections/STUB00').set(auth(fix.admin.sid))).status).toBe(403);
    });
  });

  describe('[D31] POST /inspections/:id/unlock [inspection.manage — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/inspections/STUB00/unlock')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/inspections/STUB00/unlock').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D31] POST /inspections/:id/sections/:type/lock [inspection.manage — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/inspections/STUB00/sections/scope_of_loss/lock')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/inspections/STUB00/sections/scope_of_loss/lock').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D31] POST /inspections/:id/sections/captions/generate [inspection.manage — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/inspections/STUB00/sections/captions/generate')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/inspections/STUB00/sections/captions/generate').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D31] GET /retail-pipeline [lead.read — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/retail-pipeline')).status).toBe(401);
    });
  });

  describe('[D31] PATCH /leads/:id/advance-stage [lead.advance_stage — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/leads/STUB00/advance-stage')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).patch('/api/leads/STUB00/advance-stage').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  describe('[D31] POST /inspections/:id/ahj-check [catalog.ahj_wizard — manager+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/inspections/STUB00/ahj-check')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).post('/api/inspections/STUB00/ahj-check').set(auth(fix.rep.sid))).status).toBe(403);
    });
  });

  // ── Migration complete — all 99 inspection routes + leads routes covered ──

  // ── D32: bug_report, storage, location domains ───────────────────────────

  // bug_report.manage (admin+)
  describe('[D32] GET /bug-reports [bug_report.manage — admin+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/bug-reports')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).get('/api/bug-reports').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('manager → 403', async () => {
      expect((await request(app).get('/api/bug-reports').set(auth(fix.manager.sid))).status).toBe(403);
    });
  });

  describe('[D32] GET /bug-reports/export.csv [bug_report.manage — admin+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/bug-reports/export.csv')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).get('/api/bug-reports/export.csv').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('manager → 403', async () => {
      expect((await request(app).get('/api/bug-reports/export.csv').set(auth(fix.manager.sid))).status).toBe(403);
    });
  });

  describe('[D32] PATCH /bug-reports/:id [bug_report.manage — admin+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).patch('/api/bug-reports/STUB00')).status).toBe(401);
    });
    it('field_rep → 403', async () => {
      expect((await request(app).patch('/api/bug-reports/STUB00').set(auth(fix.rep.sid))).status).toBe(403);
    });
    it('manager → 403', async () => {
      expect((await request(app).patch('/api/bug-reports/STUB00').set(auth(fix.manager.sid))).status).toBe(403);
    });
  });

  // bug_report.submit (field_rep+) — only unauthenticated test
  describe('[D32] POST /bug-reports [bug_report.submit — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/bug-reports')).status).toBe(401);
    });
  });

  // storage.upload (field_rep+) — only unauthenticated test
  describe('[D32] POST /storage/uploads/request-url [storage.upload — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/storage/uploads/request-url')).status).toBe(401);
    });
  });

  // storage.read_private (field_rep+) — only unauthenticated test
  describe('[D32] GET /storage/objects/* [storage.read_private — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).get('/api/storage/objects/test/path')).status).toBe(401);
    });
  });

  // location.ping (field_rep+) — only unauthenticated test
  describe('[D32] POST /location/ping [location.ping — field_rep+]', () => {
    it('no auth → 401', async () => {
      expect((await request(app).post('/api/location/ping')).status).toBe(401);
    });
  });
});

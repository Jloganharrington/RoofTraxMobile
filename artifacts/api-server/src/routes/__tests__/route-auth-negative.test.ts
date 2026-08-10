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

  // ── Additional domains are appended below as migration proceeds ───────────
  // Template:
  //
  // describe('[D12] VERB /path [permission.key — minRole+]', () => {
  //   it('no auth → 401', async () => { ... });
  //   it('field_rep → 403', async () => { ... });
  //   // If there is a verdict change: document it as a comment, not a failing test.
  // });
});

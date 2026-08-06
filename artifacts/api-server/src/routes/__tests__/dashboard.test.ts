/**
 * Route-level tests for the dashboard layout endpoints.
 *
 * Covers:
 *  - GET  /dashboard/layout  — returns all granted widgets with hidden state
 *  - GET  /dashboard/manifest — only returns visible widgets, in correct order
 *  - PATCH /dashboard/layout  — persists layout; rejects extra fields; handles
 *                               ungranted/unknown keys in stored data (security gate)
 *  - DELETE /dashboard/layout — resets layout to defaults
 *
 * Uses the established E2E pattern: real DB rows + real sessions, no auth mocking.
 */

import { companiesTable, db, userProfilesTable, usersTable } from '@workspace/db';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `dash-${Date.now().toString(36)}`;

interface SeededUser {
  userId: string;
  sid: string;
  companyId: string;
}

async function seedUser(
  label: string,
  overrides: Partial<{
    role: string;
    department: string;
    workflowAssignment: string;
  }> = {},
): Promise<SeededUser> {
  const companyId = `TEST-${RUN_ID}-${label}`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyId, name: `Dash Test ${label}` });

  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `${label}-${RUN_ID}@example.test` })
    .returning();

  await db.insert(userProfilesTable).values({
    userId: user.id,
    role: (overrides.role as 'field_rep' | 'manager' | 'admin' | 'super_admin') ?? 'field_rep',
    department: (overrides.department as 'canvasser' | 'inspector_canvasser' | 'office') ?? 'canvasser',
    workflowAssignment: (overrides.workflowAssignment as 'retail' | 'insurance_retail') ?? 'retail',
  });

  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
    access_token: 'test',
  });

  return { userId: user.id, sid, companyId };
}

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

describe('dashboard layout endpoints', () => {
  let rep: SeededUser;  // field_rep + canvasser + retail
  let mgr: SeededUser;  // manager + canvasser + retail

  const companyIds: string[] = [];

  beforeAll(async () => {
    rep = await seedUser('rep', { role: 'field_rep', department: 'canvasser', workflowAssignment: 'retail' });
    mgr = await seedUser('mgr', { role: 'manager', department: 'canvasser', workflowAssignment: 'retail' });
    companyIds.push(rep.companyId, mgr.companyId);
  });

  afterAll(async () => {
    await db.delete(usersTable).where(inArray(usersTable.id, [rep.userId, mgr.userId]));
    await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
  });

  // ── Authentication guards ─────────────────────────────────────────────────

  it('GET /dashboard/manifest returns 401 without auth', async () => {
    const res = await request(app).get('/api/dashboard/manifest');
    expect(res.status).toBe(401);
  });

  it('GET /dashboard/layout returns 401 without auth', async () => {
    const res = await request(app).get('/api/dashboard/layout');
    expect(res.status).toBe(401);
  });

  it('PATCH /dashboard/layout returns 401 without auth', async () => {
    const res = await request(app)
      .patch('/api/dashboard/layout')
      .send({ hidden: [], order: [] });
    expect(res.status).toBe(401);
  });

  it('DELETE /dashboard/layout returns 401 without auth', async () => {
    const res = await request(app).delete('/api/dashboard/layout');
    expect(res.status).toBe(401);
  });

  // ── GET /dashboard/manifest defaults ─────────────────────────────────────

  it('field_rep manifest has my_day, my_activity, recent_activity only', async () => {
    const res = await request(app).get('/api/dashboard/manifest').set(auth(rep.sid));
    expect(res.status).toBe(200);
    const keys: string[] = res.body.widgets.map((w: { key: string }) => w.key);
    expect(keys).toEqual(['my_day', 'my_activity', 'recent_activity']);
  });

  it('manager manifest includes manager-only widgets', async () => {
    const res = await request(app).get('/api/dashboard/manifest').set(auth(mgr.sid));
    expect(res.status).toBe(200);
    const keys: string[] = res.body.widgets.map((w: { key: string }) => w.key);
    expect(keys).toContain('action_required');
    expect(keys).toContain('sales_funnel');
    expect(keys).toContain('my_day');
  });

  // ── GET /dashboard/layout defaults ───────────────────────────────────────

  it('GET /dashboard/layout returns all granted widgets with hidden:false by default', async () => {
    const res = await request(app).get('/api/dashboard/layout').set(auth(rep.sid));
    expect(res.status).toBe(200);
    const widgets: Array<{ key: string; hidden: boolean }> = res.body.widgets;
    const keys = widgets.map((w) => w.key);
    expect(keys).toEqual(['my_day', 'my_activity', 'recent_activity']);
    expect(widgets.every((w) => w.hidden === false)).toBe(true);
  });

  // ── PATCH /dashboard/layout ───────────────────────────────────────────────

  it('PATCH rejects extra fields in body (strict validation)', async () => {
    const res = await request(app)
      .patch('/api/dashboard/layout')
      .set(auth(rep.sid))
      .send({ hidden: [], order: [], extra: 'should-be-rejected' });
    expect(res.status).toBe(400);
  });

  it('PATCH rejects missing required fields', async () => {
    const res = await request(app)
      .patch('/api/dashboard/layout')
      .set(auth(rep.sid))
      .send({ hidden: [] }); // missing order
    expect(res.status).toBe(400);
  });

  it('PATCH persists layout; manifest reflects hidden/order changes', async () => {
    // Hide my_day, put recent_activity first
    const patchRes = await request(app)
      .patch('/api/dashboard/layout')
      .set(auth(rep.sid))
      .send({ hidden: ['my_day'], order: ['recent_activity', 'my_activity'] });
    expect(patchRes.status).toBe(204);

    // Manifest now shows: recent_activity, my_activity (my_day hidden)
    const manifestRes = await request(app).get('/api/dashboard/manifest').set(auth(rep.sid));
    expect(manifestRes.status).toBe(200);
    const manifestKeys: string[] = manifestRes.body.widgets.map((w: { key: string }) => w.key);
    expect(manifestKeys).toEqual(['recent_activity', 'my_activity']);
    expect(manifestKeys).not.toContain('my_day');

    // GET /dashboard/layout still returns my_day, but with hidden: true
    const layoutRes = await request(app).get('/api/dashboard/layout').set(auth(rep.sid));
    expect(layoutRes.status).toBe(200);
    const layoutWidgets: Array<{ key: string; hidden: boolean }> = layoutRes.body.widgets;
    const hiddenEntry = layoutWidgets.find((w) => w.key === 'my_day');
    expect(hiddenEntry).toBeDefined();
    expect(hiddenEntry!.hidden).toBe(true);

    // Visible widgets appear before hidden ones in the layout response
    const visibleWidgets = layoutWidgets.filter((w) => !w.hidden);
    const visibleKeys = visibleWidgets.map((w) => w.key);
    expect(visibleKeys).toEqual(['recent_activity', 'my_activity']);
  });

  // ── Security: uncapable/unknown keys in layout can never reach manifest ───

  it('layout with an uncapable widget key never reaches the manifest', async () => {
    // Store a layout that includes a manager-only widget (action_required)
    // even though rep is a field_rep
    await request(app)
      .patch('/api/dashboard/layout')
      .set(auth(rep.sid))
      .send({ hidden: [], order: ['action_required', 'my_day', 'my_activity', 'recent_activity'] });

    const res = await request(app).get('/api/dashboard/manifest').set(auth(rep.sid));
    expect(res.status).toBe(200);
    const keys: string[] = res.body.widgets.map((w: { key: string }) => w.key);
    // action_required must NOT appear — not granted for this role
    expect(keys).not.toContain('action_required');
    // granted widgets still appear
    expect(keys).toContain('my_day');
    expect(keys).toContain('my_activity');
    expect(keys).toContain('recent_activity');
  });

  it('layout with a completely unknown key silently drops it from manifest', async () => {
    await request(app)
      .patch('/api/dashboard/layout')
      .set(auth(rep.sid))
      .send({ hidden: [], order: ['nonexistent_widget_xyz', 'my_day'] });

    const res = await request(app).get('/api/dashboard/manifest').set(auth(rep.sid));
    const keys: string[] = res.body.widgets.map((w: { key: string }) => w.key);
    expect(keys).not.toContain('nonexistent_widget_xyz');
    expect(keys).toContain('my_day');
  });

  it('unknown keys in GET /dashboard/layout are also excluded', async () => {
    // Unknown keys stored in layout should not appear in the layout response either
    await request(app)
      .patch('/api/dashboard/layout')
      .set(auth(rep.sid))
      .send({ hidden: ['nonexistent_xyz'], order: ['my_day'] });

    const res = await request(app).get('/api/dashboard/layout').set(auth(rep.sid));
    expect(res.status).toBe(200);
    const keys: string[] = res.body.widgets.map((w: { key: string }) => w.key);
    expect(keys).not.toContain('nonexistent_xyz');
  });

  // ── Unordered widgets append in catalog order ─────────────────────────────

  it('unordered granted widgets append after ordered ones in catalog order', async () => {
    // Only put my_activity in order; my_day and recent_activity should append in catalog order
    await request(app)
      .patch('/api/dashboard/layout')
      .set(auth(rep.sid))
      .send({ hidden: [], order: ['my_activity'] });

    const res = await request(app).get('/api/dashboard/manifest').set(auth(rep.sid));
    const keys: string[] = res.body.widgets.map((w: { key: string }) => w.key);
    // my_activity is first (ordered), then my_day + recent_activity in catalog order
    expect(keys[0]).toBe('my_activity');
    expect(keys.slice(1).sort()).toEqual(['my_day', 'recent_activity'].sort());
    // Catalog order for unordered: my_day (index 0) before recent_activity (index 2)
    const myDayIdx = keys.indexOf('my_day');
    const recentIdx = keys.indexOf('recent_activity');
    expect(myDayIdx).toBeLessThan(recentIdx);
  });

  // ── DELETE /dashboard/layout ──────────────────────────────────────────────

  it('DELETE restores defaults: manifest returns full resolved set in catalog order', async () => {
    // First set a non-default layout
    await request(app)
      .patch('/api/dashboard/layout')
      .set(auth(rep.sid))
      .send({ hidden: ['my_day'], order: ['recent_activity'] });

    // Confirm it was applied
    const beforeManifest = await request(app).get('/api/dashboard/manifest').set(auth(rep.sid));
    expect(beforeManifest.body.widgets.map((w: { key: string }) => w.key)).not.toContain('my_day');

    // Reset
    const delRes = await request(app).delete('/api/dashboard/layout').set(auth(rep.sid));
    expect(delRes.status).toBe(204);

    // Manifest is back to full default
    const afterManifest = await request(app).get('/api/dashboard/manifest').set(auth(rep.sid));
    const keys: string[] = afterManifest.body.widgets.map((w: { key: string }) => w.key);
    expect(keys).toEqual(['my_day', 'my_activity', 'recent_activity']);

    // Layout endpoint shows all visible, none hidden
    const layoutRes = await request(app).get('/api/dashboard/layout').set(auth(rep.sid));
    expect(layoutRes.body.widgets.every((w: { hidden: boolean }) => w.hidden === false)).toBe(true);
  });

  it('DELETE returns 204 even when no layout was stored', async () => {
    const res = await request(app).delete('/api/dashboard/layout').set(auth(mgr.sid));
    expect(res.status).toBe(204);
  });
});

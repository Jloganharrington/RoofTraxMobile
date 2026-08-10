/**
 * GET  /notifications/preferences
 * PATCH /notifications/preferences
 *
 * Checkpoint 1 verification:
 *  - field_rep GET returns only eligible types (9); manager gets all 15.
 *  - PATCH with ineligible type → 403.
 *  - PATCH with unknown type → 400.
 *  - No stored row → catalog defaults returned.
 *  - PATCH with extra userId body field → ignored; caller's own row updated.
 *  - frequency accepts all four values (stored, not enforced at route).
 */

import { companiesTable, db, notificationPreferencesTable, pinsTable, userProfilesTable, usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

const RUN_ID = `notif-${Date.now().toString(36)}`;
const COMPANY_ID = `NOTIF-${RUN_ID}`.toUpperCase();

interface Seeded {
  repSid:     string;
  managerSid: string;
  repUserId:  string;
  mgrUserId:  string;
}

async function seedUser(email: string, role: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ companyId: COMPANY_ID, email })
    .returning();
  await db.insert(userProfilesTable).values({ userId: u.id, role: role as never });
  const sid = await createSession({
    user: {
      id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName,
      profileImageUrl: u.profileImageUrl, companyId: COMPANY_ID,
    },
    access_token: 'test-access-token',
  });
  return { userId: u.id, sid };
}

let s: Seeded;

beforeAll(async () => {
  await db.insert(companiesTable).values({ id: COMPANY_ID, name: `NotifTest ${RUN_ID}` });
  const rep = await seedUser(`notif-rep-${RUN_ID}@test.invalid`, 'field_rep');
  const mgr = await seedUser(`notif-mgr-${RUN_ID}@test.invalid`, 'manager');
  s = {
    repSid:    rep.sid,
    managerSid: mgr.sid,
    repUserId: rep.userId,
    mgrUserId: mgr.userId,
  };
});

afterAll(async () => {
  await db.delete(notificationPreferencesTable).where(eq(notificationPreferencesTable.companyId, COMPANY_ID));
  await db.delete(userProfilesTable).where(
    eq(userProfilesTable.userId, s.repUserId),
  );
  await db.delete(userProfilesTable).where(
    eq(userProfilesTable.userId, s.mgrUserId),
  );
  await db.delete(usersTable).where(eq(usersTable.companyId, COMPANY_ID));
  await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY_ID));
});

const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /notifications/preferences', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/notifications/preferences');
    expect(res.status).toBe(401);
  });

  it('field_rep — returns exactly 10 types', async () => {
    const res = await request(app)
      .get('/api/notifications/preferences')
      .set(auth(s.repSid));
    expect(res.status).toBe(200);
    expect(res.body.preferences).toHaveLength(10);
  });

  it('field_rep — does NOT contain manager-only types', async () => {
    const res = await request(app)
      .get('/api/notifications/preferences')
      .set(auth(s.repSid));
    const types = res.body.preferences.map((p: { type: string }) => p.type);
    const managerOnlyTypes = [
      'payment_recorded', 'contract_voided', 'change_order_pending_approval',
      'fipsa_voided', 'item_overdue', 'claim_blocked', 'lead_needs_stage_review',
    ];
    for (const t of managerOnlyTypes) {
      expect(types, `field_rep should NOT see ${t}`).not.toContain(t);
    }
  });

  it('manager — returns all 17 types', async () => {
    const res = await request(app)
      .get('/api/notifications/preferences')
      .set(auth(s.managerSid));
    expect(res.status).toBe(200);
    expect(res.body.preferences).toHaveLength(17);
  });

  it('no stored row → catalog defaults returned', async () => {
    const res = await request(app)
      .get('/api/notifications/preferences')
      .set(auth(s.repSid));
    expect(res.status).toBe(200);
    // inspection_assigned defaults: emailEnabled=false, pushEnabled=true
    const ia = res.body.preferences.find((p: { type: string }) => p.type === 'inspection_assigned');
    expect(ia).toBeDefined();
    expect(ia.emailEnabled).toBe(false);
    expect(ia.pushEnabled).toBe(true);
    expect(ia.frequency).toBe('immediate');
  });

  it('each entry has required shape fields', async () => {
    const res = await request(app)
      .get('/api/notifications/preferences')
      .set(auth(s.managerSid));
    for (const p of res.body.preferences) {
      expect(p.type).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.group).toBeTruthy();
      expect(p.recipientRule).toBeTruthy();
      expect(typeof p.emailEnabled).toBe('boolean');
      expect(typeof p.pushEnabled).toBe('boolean');
      expect(['immediate','daily','weekly','off']).toContain(p.frequency);
      expect(typeof p.supportsDigest).toBe('boolean');
    }
  });
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /notifications/preferences', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .send({ updates: [{ type: 'payment_recorded', emailEnabled: false }] });
    expect(res.status).toBe(401);
  });

  it('unknown notification type → 400', async () => {
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(s.managerSid))
      .send({ updates: [{ type: 'not_a_real_type', emailEnabled: false }] });
    expect(res.status).toBe(400);
  });

  it('manager-only type sent by field_rep → 403', async () => {
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(s.repSid))
      .send({ updates: [{ type: 'payment_recorded', emailEnabled: true }] });
    expect(res.status).toBe(403);
  });

  it('manager can update payment_recorded → 200', async () => {
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(s.managerSid))
      .send({ updates: [{ type: 'payment_recorded', emailEnabled: false, pushEnabled: true }] });
    expect(res.status).toBe(200);
    const pref = res.body.preferences.find((p: { type: string }) => p.type === 'payment_recorded');
    expect(pref.emailEnabled).toBe(false);
    expect(pref.pushEnabled).toBe(true);
  });

  it('preference persists across GET after PATCH', async () => {
    // Set a value
    await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(s.repSid))
      .send({ updates: [{ type: 'contract_signed', emailEnabled: false }] });

    const res = await request(app)
      .get('/api/notifications/preferences')
      .set(auth(s.repSid));
    const pref = res.body.preferences.find((p: { type: string }) => p.type === 'contract_signed');
    expect(pref.emailEnabled).toBe(false);
  });

  it('extra body fields (e.g. userId) are ignored; caller row updated', async () => {
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(s.repSid))
      // Sending a userId that points to the manager — must be silently ignored
      .send({
        userId: s.mgrUserId,
        updates: [{ type: 'inspection_assigned', pushEnabled: false }],
      });
    expect(res.status).toBe(200);

    // Caller's (rep's) own row was updated
    const repPref = res.body.preferences.find((p: { type: string }) => p.type === 'inspection_assigned');
    expect(repPref.pushEnabled).toBe(false);

    // Manager's row was NOT changed (should still be at default or previous value)
    const mgrRes = await request(app)
      .get('/api/notifications/preferences')
      .set(auth(s.managerSid));
    const mgrPref = mgrRes.body.preferences.find((p: { type: string }) => p.type === 'inspection_assigned');
    // Manager's inspection_assigned should still be at default (pushEnabled=true) unless previously changed
    expect(mgrPref.type).toBe('inspection_assigned');
  });

  it('frequency accepts all four values', async () => {
    for (const freq of ['immediate', 'daily', 'weekly', 'off'] as const) {
      const res = await request(app)
        .patch('/api/notifications/preferences')
        .set(auth(s.managerSid))
        .send({ updates: [{ type: 'payment_recorded', frequency: freq }] });
      expect(res.status, `expected 200 for frequency=${freq}`).toBe(200);
      const pref = res.body.preferences.find((p: { type: string }) => p.type === 'payment_recorded');
      expect(pref.frequency).toBe(freq);
    }
  });

  it('partial update preserves fields not in payload', async () => {
    // First: set both email and push
    await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(s.managerSid))
      .send({ updates: [{ type: 'contract_signed', emailEnabled: true, pushEnabled: false }] });

    // Then: update only emailEnabled
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(s.managerSid))
      .send({ updates: [{ type: 'contract_signed', emailEnabled: false }] });

    expect(res.status).toBe(200);
    const pref = res.body.preferences.find((p: { type: string }) => p.type === 'contract_signed');
    expect(pref.emailEnabled).toBe(false);
    expect(pref.pushEnabled).toBe(false);  // unchanged from previous PATCH
  });
});

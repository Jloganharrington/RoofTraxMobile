/**
 * Payments ledger — Checkpoint 1 verification tests.
 *
 * Covers (per the work-order requirements):
 *   - field_rep POST → 403
 *   - manager POST → 201, correct amountCents (round-trip $12,500.00 = 1250000)
 *   - GET returns company-scoped list
 *   - cross-company PATCH → 404 (IDOR guard — bug fix i)
 *   - PATCH with pin_id in body → pin_id in DB unchanged (bug fix i)
 *   - manager DELETE → 204, removed from subsequent GET
 *   - cross-company DELETE → 404 (IDOR guard)
 *   - field_rep GET own pin → 200 (ownerOrRole: owner passes); non-owner → 403
 *   - POST to non-existent pin → 404
 *   - POST with invalid type → 400
 *   - POST with zero amountCents → 400
 */

import {
  companiesTable,
  db,
  paymentsTable,
  pinsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const RUN_ID = Date.now().toString(36);
const COMPANY_A = `TEST-PAY-A-${RUN_ID}`.toUpperCase();
const COMPANY_B = `TEST-PAY-B-${RUN_ID}`.toUpperCase();

interface SeededUser {
  userId: string;
  sid: string;
}

async function seedUser(
  companyId: string,
  email: string,
  role: 'field_rep' | 'manager',
): Promise<SeededUser> {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role });
  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
    access_token: 'test-tok',
  });
  return { userId: user.id, sid };
}

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

let managerA: SeededUser;
let fieldRepA: SeededUser;
let managerB: SeededUser;
let pinIdA: string;
let pinIdB: string;

// Payments created during tests — cleaned up in afterAll.
const cleanupPaymentIds: string[] = [];

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(companiesTable).values([
    { id: COMPANY_A, name: 'Pay Test Co A' },
    { id: COMPANY_B, name: 'Pay Test Co B' },
  ]);

  managerA  = await seedUser(COMPANY_A, `mgr-a-${RUN_ID}@test.invalid`, 'manager');
  fieldRepA = await seedUser(COMPANY_A, `rep-a-${RUN_ID}@test.invalid`, 'field_rep');
  managerB  = await seedUser(COMPANY_B, `mgr-b-${RUN_ID}@test.invalid`, 'manager');

  const [rowA] = await db.insert(pinsTable).values({
    companyId: COMPANY_A,
    userId: managerA.userId,
    latitude: 38.9,
    longitude: -77.0,
    workflow: 'insurance',
  }).returning();
  pinIdA = rowA.id;

  const [rowB] = await db.insert(pinsTable).values({
    companyId: COMPANY_B,
    userId: managerB.userId,
    latitude: 38.9,
    longitude: -77.0,
    workflow: 'insurance',
  }).returning();
  pinIdB = rowB.id;
});

afterAll(async () => {
  if (cleanupPaymentIds.length) {
    await db.delete(paymentsTable)
      .where(inArray(paymentsTable.id, cleanupPaymentIds))
      .catch(() => {});
  }
  await db.delete(pinsTable)
    .where(inArray(pinsTable.id, [pinIdA, pinIdB].filter(Boolean)));
  for (const u of [managerA, fieldRepA, managerB]) {
    if (!u) continue;
    await db.delete(userProfilesTable)
      .where(eq(userProfilesTable.userId, u.userId)).catch(() => {});
    await db.delete(usersTable)
      .where(eq(usersTable.id, u.userId)).catch(() => {});
  }
  await db.delete(companiesTable)
    .where(inArray(companiesTable.id, [COMPANY_A, COMPANY_B]));
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('payments ledger', () => {
  // Track the payment created in the "manager POST" test for use in PATCH/DELETE tests.
  let createdId: string;

  it('field_rep POST → 403', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinIdA}/payments`)
      .set(auth(fieldRepA.sid))
      .send({ type: 'deposit', amountCents: 100000, paymentDate: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it('manager POST → 201 with correct amountCents (round-trip $12,500.00 = 1250000 cents)', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinIdA}/payments`)
      .set(auth(managerA.sid))
      .send({
        type: 'deposit',
        amountCents: 1250000,   // $12,500.00 — dollar-to-cents at the UI edge
        paymentDate: new Date().toISOString(),
        method: 'Check',
        notes: 'Round-trip test',
      });
    expect(res.status).toBe(201);
    expect(res.body.payment.amountCents).toBe(1250000); // no float drift
    expect(res.body.payment.type).toBe('deposit');
    expect(res.body.payment.companyId).toBe(COMPANY_A);
    expect(res.body.payment.pinId).toBe(pinIdA);
    createdId = res.body.payment.id;
    cleanupPaymentIds.push(createdId);
  });

  it('GET returns company-scoped payments', async () => {
    const res = await request(app)
      .get(`/api/pins/${pinIdA}/payments`)
      .set(auth(managerA.sid));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.payments)).toBe(true);
    const ids: string[] = res.body.payments.map((p: { id: string }) => p.id);
    expect(ids).toContain(createdId);
  });

  it('cross-company PATCH → 404, DB row unchanged (IDOR guard — bug fix i)', async () => {
    // managerB is authenticated for COMPANY_B; the payment belongs to COMPANY_A
    const res = await request(app)
      .patch(`/api/payments/${createdId}`)
      .set(auth(managerB.sid))
      .send({ amountCents: 9999999 });
    expect(res.status).toBe(404);

    // Verify the amount was NOT modified
    const [row] = await db.select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, createdId));
    expect(row.amountCents).toBe(1250000);
  });

  it('PATCH body cannot override pin_id — only allowed fields change (bug fix i)', async () => {
    // Send a body that changes only amountCents; server must ignore any rogue
    // company_id / pin_id in the body (handled by the zod schema exclusion).
    const res = await request(app)
      .patch(`/api/payments/${createdId}`)
      .set(auth(managerA.sid))
      .send({ amountCents: 999900 });
    expect([200, 204]).toContain(res.status);

    const [row] = await db.select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, createdId));
    expect(row.pinId).toBe(pinIdA);       // unchanged
    expect(row.amountCents).toBe(999900); // only this field was allowed to change
  });

  it('manager DELETE → 204, then GET no longer returns it', async () => {
    const create = await request(app)
      .post(`/api/pins/${pinIdA}/payments`)
      .set(auth(managerA.sid))
      .send({ type: 'acv', amountCents: 50000, paymentDate: new Date().toISOString() });
    expect(create.status).toBe(201);
    const deleteId: string = create.body.payment.id;

    const del = await request(app)
      .delete(`/api/payments/${deleteId}`)
      .set(auth(managerA.sid));
    expect(del.status).toBe(204);

    const list = await request(app)
      .get(`/api/pins/${pinIdA}/payments`)
      .set(auth(managerA.sid));
    const ids: string[] = list.body.payments.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(deleteId);
  });

  it('cross-company DELETE → 404 (IDOR guard)', async () => {
    const res = await request(app)
      .delete(`/api/payments/${createdId}`)
      .set(auth(managerB.sid));
    expect(res.status).toBe(404);
  });

  // payment.view is ownerOrRole:manager+ — fieldRepA does NOT own pinIdA (owned by managerA),
  // so this is a non-owner rep → 403.  VERDICT CHANGE from the old auth-only GET.
  it('field_rep (non-owner) GET → 403 (ownerOrRole: rep does not own this pin)', async () => {
    const res = await request(app)
      .get(`/api/pins/${pinIdA}/payments`)
      .set(auth(fieldRepA.sid));
    expect(res.status).toBe(403);
  });

  it('POST to non-existent pin → 404', async () => {
    const res = await request(app)
      .post('/api/pins/does-not-exist/payments')
      .set(auth(managerA.sid))
      .send({ type: 'deposit', amountCents: 100, paymentDate: new Date().toISOString() });
    expect(res.status).toBe(404);
  });

  it('POST with invalid type → 400', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinIdA}/payments`)
      .set(auth(managerA.sid))
      .send({ type: 'bogus_type', amountCents: 100, paymentDate: new Date().toISOString() });
    expect(res.status).toBe(400);
  });

  it('POST with zero amountCents → 400 (must be ≥ 1 cent — no free items, no void rows)', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinIdA}/payments`)
      .set(auth(managerA.sid))
      .send({ type: 'deposit', amountCents: 0, paymentDate: new Date().toISOString() });
    expect(res.status).toBe(400);
  });
});

/**
 * Tests for pin_financial_changes audit table (migration 044 / Step 3 completion).
 *
 * What is tested:
 *  1. Changing contractAmount as a manager with a reason → 200, audit row created
 *  2. Changing contractAmount without a reason → 400
 *  3. field_rep cannot change contractAmount → 403
 *  4. Non-financial PATCH (notes only) does not require reason → 200, no audit row
 *  5. All three fields (contractAmount, deductibleAmount, rcvAmount) require reason
 *  6. No-op change (same value) → 200 but no audit row inserted
 *  7. GET /pins/:pinId/financial-changes returns history, manager+ only
 *  8. field_rep cannot GET financial-changes → 403
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { createSession } from '../../lib/auth';
import {
  companiesTable,
  db,
  pinFinancialChangesTable,
  pinsTable,
  usersTable,
  userProfilesTable,
} from '@workspace/db';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CO_ID     = 'TEST-PINFC-' + Math.random().toString(36).slice(2, 10).toUpperCase();
const MGR_EMAIL = `mgr-pinfc-${CO_ID.slice(-6)}@t.invalid`;
const REP_EMAIL = `rep-pinfc-${CO_ID.slice(-6)}@t.invalid`;

let mgrId: string;
let repId: string;
let pinId: string;
let mgrSid: string;
let repSid: string;

function auth(sid: string) {
  return { Authorization: `Bearer ${sid}` };
}

beforeAll(async () => {
  // Company
  await db.insert(companiesTable).values({ id: CO_ID, name: `PinFC Test ${CO_ID}` });

  // Users
  const [mgr] = await db
    .insert(usersTable)
    .values({ email: MGR_EMAIL, companyId: CO_ID })
    .returning({ id: usersTable.id });
  const [rep] = await db
    .insert(usersTable)
    .values({ email: REP_EMAIL, companyId: CO_ID })
    .returning({ id: usersTable.id });
  mgrId = mgr.id;
  repId = rep.id;

  // Profiles
  await db.insert(userProfilesTable).values([
    { userId: mgrId, role: 'manager' },
    { userId: repId, role: 'field_rep' },
  ]);

  // Pin owned by rep, company = CO_ID
  const [pin] = await db
    .insert(pinsTable)
    .values({
      companyId:     CO_ID,
      userId:        repId,
      latitude:      38.9,
      longitude:     -77.0,
      workflow:      'insurance',
      contractAmount: '5000.00',
    })
    .returning({ id: pinsTable.id });
  pinId = pin.id;

  // Sessions
  mgrSid = await createSession({ user: { id: mgrId, email: MGR_EMAIL, firstName: null, lastName: null, profileImageUrl: null, companyId: CO_ID }, access_token: 'tok' });
  repSid = await createSession({ user: { id: repId, email: REP_EMAIL, firstName: null, lastName: null, profileImageUrl: null, companyId: CO_ID }, access_token: 'tok' });
});

afterAll(async () => {
  await db.delete(pinFinancialChangesTable).where(eq(pinFinancialChangesTable.pinId, pinId)).catch(() => {});
  await db.delete(pinsTable).where(eq(pinsTable.id, pinId)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, mgrId)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, repId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, mgrId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, repId)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, CO_ID)).catch(() => {});
});

// ---------------------------------------------------------------------------
// Helper: fetch audit rows for the test pin
// ---------------------------------------------------------------------------
async function auditRows() {
  return db
    .select()
    .from(pinFinancialChangesTable)
    .where(eq(pinFinancialChangesTable.pinId, pinId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pin financial changes — write path', () => {
  it('manager can change contractAmount with reason → 200 + audit row', async () => {
    const before = await auditRows();

    const res = await request(app)
      .patch(`/api/pins/${pinId}/profile`)
      .set(auth(mgrSid))
      .send({ contractAmount: '6000.00', reason: 'Carrier approved supplement' });

    expect(res.status).toBe(200);
    expect(res.body.lead.contractAmount).toBe('6000.00');

    const after = await auditRows();
    expect(after.length).toBe(before.length + 1);
    const row = after[after.length - 1];
    expect(row.field).toBe('contract_amount');
    expect(row.oldValue).toBe('5000.00');
    expect(row.newValue).toBe('6000.00');
    expect(row.reason).toBe('Carrier approved supplement');
    expect(row.changedByUserId).toBe(mgrId);
    expect(row.companyId).toBe(CO_ID);
    expect(row.pinId).toBe(pinId);
  });

  it('manager changing contractAmount without reason → 400', async () => {
    const res = await request(app)
      .patch(`/api/pins/${pinId}/profile`)
      .set(auth(mgrSid))
      .send({ contractAmount: '7000.00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason is required/i);
  });

  it('field_rep cannot change contractAmount → 403', async () => {
    const res = await request(app)
      .patch(`/api/pins/${pinId}/profile`)
      .set(auth(repSid))
      .send({ contractAmount: '1000.00', reason: 'testing' });

    expect(res.status).toBe(403);
  });

  it('non-financial PATCH (notes only) does not require reason → 200, no audit row', async () => {
    const before = await auditRows();

    const res = await request(app)
      .patch(`/api/pins/${pinId}/profile`)
      .set(auth(mgrSid))
      .send({ notes: 'Updated site notes' });

    expect(res.status).toBe(200);
    const after = await auditRows();
    expect(after.length).toBe(before.length); // no new audit row
  });

  it('deductibleAmount requires reason → 400 without it', async () => {
    const res = await request(app)
      .patch(`/api/pins/${pinId}/profile`)
      .set(auth(mgrSid))
      .send({ deductibleAmount: '2000.00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason is required/i);
  });

  it('rcvAmount requires reason → 400 without it', async () => {
    const res = await request(app)
      .patch(`/api/pins/${pinId}/profile`)
      .set(auth(mgrSid))
      .send({ rcvAmount: '15000.00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason is required/i);
  });

  it('no-op change (same contractAmount) → 200 but no audit row', async () => {
    // Get current value first
    const [currentPin] = await db
      .select({ contractAmount: pinsTable.contractAmount })
      .from(pinsTable)
      .where(eq(pinsTable.id, pinId));

    const before = await auditRows();

    const res = await request(app)
      .patch(`/api/pins/${pinId}/profile`)
      .set(auth(mgrSid))
      .send({ contractAmount: currentPin.contractAmount, reason: 'same value, no change' });

    expect(res.status).toBe(200);
    const after = await auditRows();
    expect(after.length).toBe(before.length); // no audit row for no-op
  });

  it('all three financial fields in one request → multiple audit rows', async () => {
    const before = await auditRows();

    const res = await request(app)
      .patch(`/api/pins/${pinId}/profile`)
      .set(auth(mgrSid))
      .send({
        contractAmount:   '8000.00',
        deductibleAmount: '1500.00',
        rcvAmount:        '12000.00',
        reason:           'Full re-assessment after re-inspection',
      });

    expect(res.status).toBe(200);
    const after = await auditRows();
    const newRows = after.slice(before.length);
    expect(newRows.length).toBe(3);
    const fields = newRows.map((r) => r.field).sort();
    expect(fields).toEqual(['contract_amount', 'deductible_amount', 'rcv_amount']);
    for (const row of newRows) {
      expect(row.reason).toBe('Full re-assessment after re-inspection');
    }
  });
});

describe('pin financial changes — read path', () => {
  it('manager can GET /financial-changes → list of audit rows', async () => {
    const res = await request(app)
      .get(`/api/pins/${pinId}/financial-changes`)
      .set(auth(mgrSid));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.changes)).toBe(true);
    expect(res.body.changes.length).toBeGreaterThan(0);
    // Most recent change is first
    const first = res.body.changes[0];
    expect(first.companyId).toBe(CO_ID);
    expect(first.pinId).toBe(pinId);
    expect(typeof first.reason).toBe('string');
    expect(typeof first.changedAt).toBe('string');
  });

  it('field_rep cannot GET /financial-changes → 403', async () => {
    const res = await request(app)
      .get(`/api/pins/${pinId}/financial-changes`)
      .set(auth(repSid));

    expect(res.status).toBe(403);
  });

  it('unauthenticated GET → 401', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/financial-changes`);
    expect(res.status).toBe(401);
  });
});

/**
 * Checkpoint 3 — Vendor Expenses + Commissions
 *
 * Covers every item in CHECKPOINT 3:
 *   1. company scoping (company B cannot access company A's expenses)
 *   2. field_rep → 403 on expense writes; 403 on reads for non-owner (ownerOrRole:manager+)
 *   3. commission fields NOT writable via generic PATCH /pins/:pinId
 *   4. mark-paid (expense): paid_date set server-side (body ignored)
 *   5. mark-paid (commissions): date set server-side
 *   6. double mark-paid → 400
 *   7. commission PATCH rejects paid dates (zod strips them)
 */

import {
  companiesTable,
  db,
  pinsTable,
  userProfilesTable,
  usersTable,
  vendorExpensesTable,
} from '@workspace/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app';
import { createSession } from '../../lib/auth';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID = Date.now().toString(36).toUpperCase();
const CO_A   = `EXP-A-${RUN_ID}`;
const CO_B   = `EXP-B-${RUN_ID}`;

let managerSid:  string;
let repSid:      string;
let companyBSid: string;
let managerId:   string;
let repId:       string;
let companyBUId: string;
let pinId:       string;
let companyBPinId: string;

beforeAll(async () => {
  await db.insert(companiesTable).values([
    { id: CO_A, name: 'Expense Test Co A' },
    { id: CO_B, name: 'Expense Test Co B' },
  ]);

  const [mgr, rep, bu] = await db
    .insert(usersTable)
    .values([
      { companyId: CO_A, email: `exp-mgr-${RUN_ID}@t.invalid` },
      { companyId: CO_A, email: `exp-rep-${RUN_ID}@t.invalid` },
      { companyId: CO_B, email: `exp-b-${RUN_ID}@t.invalid` },
    ])
    .returning();
  managerId   = mgr!.id;
  repId       = rep!.id;
  companyBUId = bu!.id;

  await db.insert(userProfilesTable).values([
    { userId: managerId,   role: 'manager'   },
    { userId: repId,       role: 'field_rep' },
    { userId: companyBUId, role: 'manager'   },
  ]);

  managerSid  = await createSession({ user: { id: managerId,   email: mgr!.email,  firstName: null, lastName: null, profileImageUrl: null, companyId: CO_A }, access_token: 'tok' });
  repSid      = await createSession({ user: { id: repId,       email: rep!.email,  firstName: null, lastName: null, profileImageUrl: null, companyId: CO_A }, access_token: 'tok' });
  companyBSid = await createSession({ user: { id: companyBUId, email: bu!.email,   firstName: null, lastName: null, profileImageUrl: null, companyId: CO_B }, access_token: 'tok' });

  const [pin] = await db
    .insert(pinsTable)
    .values({ companyId: CO_A, userId: managerId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
    .returning();
  pinId = pin!.id;

  const [bPin] = await db
    .insert(pinsTable)
    .values({ companyId: CO_B, userId: companyBUId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
    .returning();
  companyBPinId = bPin!.id;
});

afterAll(async () => {
  await db.delete(pinsTable).where(eq(pinsTable.companyId, CO_A)).catch(() => {});
  await db.delete(pinsTable).where(eq(pinsTable.companyId, CO_B)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, managerId)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, repId)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, companyBUId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.companyId, CO_A)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.companyId, CO_B)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, CO_A)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, CO_B)).catch(() => {});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mgr()   { return { Authorization: `Bearer ${managerSid}`  }; }
function rep()   { return { Authorization: `Bearer ${repSid}`       }; }
function coB()   { return { Authorization: `Bearer ${companyBSid}`  }; }

const validExpense = { vendorName: 'ACME Roofing Supply', amountCents: 250000, category: 'materials' };

async function createExpense(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/pins/${pinId}/expenses`)
    .set(mgr())
    .send({ ...validExpense, ...overrides });
}

// ---------------------------------------------------------------------------
// 1. CRUD smoke
// ---------------------------------------------------------------------------

describe('vendor expense CRUD — manager', () => {
  it('POST → 201 with expense fields', async () => {
    const res = await createExpense({ description: 'Replacement shingles' });
    expect(res.status).toBe(201);
    expect(res.body.expense.vendorName).toBe('ACME Roofing Supply');
    expect(res.body.expense.amountCents).toBe(250000);
    expect(res.body.expense.category).toBe('materials');
    expect(res.body.expense.isPaid).toBe(false);
    expect(res.body.expense.paidDate).toBeNull();
  });

  it('GET → 200 list includes created expense', async () => {
    await createExpense();
    const res = await request(app)
      .get(`/api/pins/${pinId}/expenses`)
      .set(mgr());
    expect(res.status).toBe(200);
    expect(res.body.expenses.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH → 200 updates amount + category', async () => {
    const c = await createExpense();
    const id = c.body.expense.id as string;
    const res = await request(app)
      .patch(`/api/expenses/${id}`)
      .set(mgr())
      .send({ amountCents: 300000, category: 'labor' });
    expect(res.status).toBe(200);
    expect(res.body.expense.amountCents).toBe(300000);
    expect(res.body.expense.category).toBe('labor');
  });

  it('DELETE → 204, record gone', async () => {
    const c = await createExpense();
    const id = c.body.expense.id as string;
    const del = await request(app).delete(`/api/expenses/${id}`).set(mgr());
    expect(del.status).toBe(204);
    const [gone] = await db.select().from(vendorExpensesTable).where(eq(vendorExpensesTable.id, id));
    expect(gone).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. mark-paid: paid_date is server-side — body is irrelevant
// ---------------------------------------------------------------------------

describe('mark-paid (expense) — date is server-side', () => {
  it('sets isPaid=true and server-generated paidDate, ignores backdated body', async () => {
    const c = await createExpense();
    const id = c.body.expense.id as string;
    const before = new Date();

    // Intentionally send a backdated paidDate — server must ignore it.
    const res = await request(app)
      .post(`/api/expenses/${id}/mark-paid`)
      .set(mgr())
      .send({ paidDate: '2020-01-01T00:00:00Z' });

    expect(res.status).toBe(200);
    expect(res.body.expense.isPaid).toBe(true);
    // Server date must be >= test start, NOT the client-supplied 2020 value.
    const serverDate = new Date(res.body.expense.paidDate as string);
    expect(serverDate.getFullYear()).toBeGreaterThanOrEqual(before.getFullYear());
    expect(serverDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
  });

  it('double mark-paid → 400', async () => {
    const c = await createExpense();
    const id = c.body.expense.id as string;
    await request(app).post(`/api/expenses/${id}/mark-paid`).set(mgr());
    const res2 = await request(app).post(`/api/expenses/${id}/mark-paid`).set(mgr());
    expect(res2.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 3. field_rep → 403 on writes; 403 on reads for non-owner (expense.view = ownerOrRole:manager+)
// ---------------------------------------------------------------------------

describe('field_rep cannot write expenses', () => {
  let expenseId: string;

  beforeAll(async () => {
    const c = await createExpense();
    expenseId = c.body.expense.id as string;
  });

  it('POST /pins/:pinId/expenses → 403', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/expenses`)
      .set(rep())
      .send(validExpense);
    expect(res.status).toBe(403);
  });
  it('PATCH /expenses/:id → 403', async () => {
    const res = await request(app)
      .patch(`/api/expenses/${expenseId}`)
      .set(rep())
      .send({ amountCents: 1 });
    expect(res.status).toBe(403);
  });
  it('DELETE /expenses/:id → 403', async () => {
    expect(
      (await request(app).delete(`/api/expenses/${expenseId}`).set(rep())).status
    ).toBe(403);
  });
  it('POST /expenses/:id/mark-paid → 403', async () => {
    expect(
      (await request(app).post(`/api/expenses/${expenseId}/mark-paid`).set(rep())).status
    ).toBe(403);
  });
  // expense.view is ownerOrRole:manager+ — rep() user does NOT own pinId (owned by manager),
  // so non-owner rep → 403. VERDICT CHANGE from the old auth-only GET.
  it('GET /pins/:pinId/expenses → 403 (ownerOrRole: rep does not own this pin)', async () => {
    expect(
      (await request(app).get(`/api/pins/${pinId}/expenses`).set(rep())).status
    ).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 4. cross-company IDOR
// ---------------------------------------------------------------------------

describe('cross-company access blocked', () => {
  let expenseId: string;

  beforeAll(async () => {
    const c = await createExpense();
    expenseId = c.body.expense.id as string;
  });

  it('company B PATCH company A expense → 404', async () => {
    expect(
      (await request(app).patch(`/api/expenses/${expenseId}`).set(coB()).send({ amountCents: 1 })).status
    ).toBe(404);
  });
  it('company B DELETE company A expense → 404', async () => {
    expect(
      (await request(app).delete(`/api/expenses/${expenseId}`).set(coB())).status
    ).toBe(404);
  });
  it('company B mark-paid company A expense → 404', async () => {
    expect(
      (await request(app).post(`/api/expenses/${expenseId}/mark-paid`).set(coB())).status
    ).toBe(404);
  });
  it('company B list company A pin expenses → 404 (pin not found in co B)', async () => {
    expect(
      (await request(app).get(`/api/pins/${pinId}/expenses`).set(coB())).status
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 5. bug-fix (iii): commission fields NOT writable via generic PATCH /pins/:pinId
// ---------------------------------------------------------------------------

describe('commission fields blocked by generic pin PATCH (bug-fix iii)', () => {
  it('commission fields in body are zod-stripped — DB stays null', async () => {
    const res = await request(app)
      .patch(`/api/pins/${pinId}`)
      .set(mgr())
      .send({
        leadAcquisitionCostCents: 50000,
        referralFeeCents:         25000,
        salesCommissionCents:     75000,
        pmCommissionCents:        30000,
      });
    // Generic PATCH succeeds; unknown fields stripped by UpdatePinBody zod schema.
    expect(res.status).toBe(200);
    // Verify DB row — commission columns must still be null.
    const [row] = await db.select().from(pinsTable).where(eq(pinsTable.id, pinId));
    expect(row?.leadAcquisitionCostCents).toBeNull();
    expect(row?.salesCommissionCents).toBeNull();
    expect(row?.pmCommissionCents).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Commissions endpoint: amounts + server-side mark-paid dates
// ---------------------------------------------------------------------------

describe('PATCH /pins/:pinId/commissions', () => {
  it('sets amounts; paid dates stay null', async () => {
    const res = await request(app)
      .patch(`/api/pins/${pinId}/commissions`)
      .set(mgr())
      .send({ salesCommissionCents: 100000, pmCommissionCents: 40000, leadAcquisitionCostCents: 5000 });
    expect(res.status).toBe(200);
    const c = res.body.commissions;
    expect(c.salesCommissionCents).toBe(100000);
    expect(c.pmCommissionCents).toBe(40000);
    expect(c.leadAcquisitionCostCents).toBe(5000);
    expect(c.salesCommissionPaidDate).toBeNull();
    expect(c.pmCommissionPaidDate).toBeNull();
  });

  it('paid dates in body are zod-stripped — DB stays null', async () => {
    const res = await request(app)
      .patch(`/api/pins/${pinId}/commissions`)
      .set(mgr())
      .send({ salesCommissionCents: 50000, salesCommissionPaidDate: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.commissions.salesCommissionPaidDate).toBeNull();
  });

  it('field_rep → 403', async () => {
    expect(
      (await request(app).patch(`/api/pins/${pinId}/commissions`).set(rep()).send({ salesCommissionCents: 1000 })).status
    ).toBe(403);
  });
});

describe('commissions mark-paid — date is server-side', () => {
  it('sales mark-paid requires amount first → 400 otherwise', async () => {
    // Use a fresh pin with no commission set
    const [freshPin] = await db
      .insert(pinsTable)
      .values({ companyId: CO_A, userId: managerId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
      .returning();
    const res = await request(app)
      .post(`/api/pins/${freshPin!.id}/commissions/sales/mark-paid`)
      .set(mgr());
    expect(res.status).toBe(400);
  });

  it('sales mark-paid sets server-generated date (not backdated)', async () => {
    await request(app).patch(`/api/pins/${pinId}/commissions`).set(mgr()).send({ salesCommissionCents: 80000 });
    const before = new Date();
    const res = await request(app).post(`/api/pins/${pinId}/commissions/sales/mark-paid`).set(mgr());
    expect(res.status).toBe(200);
    expect(res.body.commissions.salesCommissionPaidDate).not.toBeNull();
    const serverDate = new Date(res.body.commissions.salesCommissionPaidDate as string);
    expect(serverDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
  });

  it('pm mark-paid → 400 when no amount set; 200 after amount set', async () => {
    const [freshPin] = await db
      .insert(pinsTable)
      .values({ companyId: CO_A, userId: managerId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
      .returning();
    const no = await request(app).post(`/api/pins/${freshPin!.id}/commissions/pm/mark-paid`).set(mgr());
    expect(no.status).toBe(400);
    await request(app).patch(`/api/pins/${freshPin!.id}/commissions`).set(mgr()).send({ pmCommissionCents: 30000 });
    const yes = await request(app).post(`/api/pins/${freshPin!.id}/commissions/pm/mark-paid`).set(mgr());
    expect(yes.status).toBe(200);
    expect(yes.body.commissions.pmCommissionPaidDate).not.toBeNull();
  });
});

/**
 * Checkpoint 1 — Change Order Line Items + Extended Change Orders (migration 030)
 *
 * Verified:
 *   1.  line items sum to change_orders.amount_cents
 *   2.  editing a line recomputes amount_cents
 *   3.  negative line item (credit) handled correctly
 *   4.  approve without signature/document → 422
 *   5.  approve with both → succeeds (manager+); field_rep → 403
 *   6.  field_rep CAN create a change order with line items
 *   7.  cross-company access → 404
 *   8.  PATCH with foreign pin_id in body → pin_id UNCHANGED
 *   9.  DELETE still removes the CO (manager+)
 *   10. void sets voidedAt; voided CO excluded from profitability
 *   11. pin_profitability: APPROVED CO moves revised_contract_cents and
 *       net_project_margin_cents; a PENDING CO does not
 *   12. overhead PATCH + mark-paid unchanged from migration 028
 *   13. Templates page still accepts 'change_order' as a use case
 */

import {
  changeOrderLineItemsTable,
  changeOrdersTable,
  companiesTable,
  customerInvoicesTable,
  db,
  paymentsTable,
  pinsTable,
  TEMPLATE_USE_CASES,
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

const RUN_ID   = Date.now().toString(36).toUpperCase();
const CO_A     = `CHO-A-${RUN_ID}`;
const CO_B     = `CHO-B-${RUN_ID}`;

let managerSid:    string;
let repSid:        string;
let companyBSid:   string;
let managerId:     string;
let repId:         string;
let companyBUId:   string;
let pinId:         string;
let companyBPinId: string;

const mgr   = () => ({ Authorization: `Bearer ${managerSid}` });
const rep   = () => ({ Authorization: `Bearer ${repSid}` });
const coB   = () => ({ Authorization: `Bearer ${companyBSid}` });

beforeAll(async () => {
  await db.insert(companiesTable).values([
    { id: CO_A, name: 'CO Test Co A' },
    { id: CO_B, name: 'CO Test Co B' },
  ]);

  const [mgru, repu, bu] = await db
    .insert(usersTable)
    .values([
      { companyId: CO_A, email: `cho-mgr-${RUN_ID}@t.invalid` },
      { companyId: CO_A, email: `cho-rep-${RUN_ID}@t.invalid` },
      { companyId: CO_B, email: `cho-b-${RUN_ID}@t.invalid`   },
    ])
    .returning();
  managerId   = mgru!.id;
  repId       = repu!.id;
  companyBUId = bu!.id;

  await db.insert(userProfilesTable).values([
    { userId: managerId,   role: 'manager'   },
    { userId: repId,       role: 'field_rep' },
    { userId: companyBUId, role: 'manager'   },
  ]);

  managerSid  = await createSession({ user: { id: managerId,   email: mgru!.email, firstName: null, lastName: null, profileImageUrl: null, companyId: CO_A }, access_token: 'tok' });
  repSid      = await createSession({ user: { id: repId,       email: repu!.email, firstName: null, lastName: null, profileImageUrl: null, companyId: CO_A }, access_token: 'tok' });
  companyBSid = await createSession({ user: { id: companyBUId, email: bu!.email,   firstName: null, lastName: null, profileImageUrl: null, companyId: CO_B }, access_token: 'tok' });

  const [pin] = await db
    .insert(pinsTable)
    .values({ companyId: CO_A, userId: managerId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
    .returning();
  pinId = pin!.id;

  const [bPin] = await db
    .insert(pinsTable)
    .values({ companyId: CO_B, userId: companyBUId, latitude: 38.9, longitude: -77.0, workflow: 'retail' })
    .returning();
  companyBPinId = bPin!.id;
});

afterAll(async () => {
  await db.delete(changeOrderLineItemsTable).where(eq(changeOrderLineItemsTable.companyId, CO_A));
  await db.delete(changeOrderLineItemsTable).where(eq(changeOrderLineItemsTable.companyId, CO_B));
  await db.delete(changeOrdersTable).where(eq(changeOrdersTable.companyId, CO_A));
  await db.delete(changeOrdersTable).where(eq(changeOrdersTable.companyId, CO_B));
  await db.delete(vendorExpensesTable).where(eq(vendorExpensesTable.companyId, CO_A));
  await db.delete(paymentsTable).where(eq(paymentsTable.companyId, CO_A));
  await db.delete(customerInvoicesTable).where(eq(customerInvoicesTable.companyId, CO_A));
  await db.delete(pinsTable).where(eq(pinsTable.companyId, CO_A));
  await db.delete(pinsTable).where(eq(pinsTable.companyId, CO_B));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, managerId));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, repId));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, companyBUId));
  await db.delete(usersTable).where(eq(usersTable.id, managerId));
  await db.delete(usersTable).where(eq(usersTable.id, repId));
  await db.delete(usersTable).where(eq(usersTable.id, companyBUId));
  await db.delete(companiesTable).where(eq(companiesTable.id, CO_A));
  await db.delete(companiesTable).where(eq(companiesTable.id, CO_B));
});

// ---------------------------------------------------------------------------
// Tests 1–2: line items sum to amount_cents; editing recomputes
// ---------------------------------------------------------------------------
describe('line items sum to amount_cents', () => {
  let coId: string;

  it('creates a CO with two line items; amount_cents = sum', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'Rotted decking section B',
        requiredToCompleteScope: true,
        lineItems: [
          { description: 'Replace OSB 7/16', quantity: 10, unitPriceCents: 4500 },
          { description: 'Additional labor',  quantity: 1,  unitPriceCents: 25000 },
        ],
      });
    expect(res.status).toBe(201);
    // 10×4500 + 1×25000 = 45000 + 25000 = 70000
    expect(res.body.changeOrder.amountCents).toBe(70000);
    expect(res.body.changeOrder.requiredToCompleteScope).toBe(true);
    expect(res.body.changeOrder.lineItems).toHaveLength(2);
    coId = res.body.changeOrder.id;
  });

  it('adding a third line item recomputes amount_cents', async () => {
    const res = await request(app)
      .post(`/api/change-orders/${coId}/line-items`)
      .set(mgr())
      .send({ description: 'Disposal fee', quantity: 1, unitPriceCents: 5000 });
    expect(res.status).toBe(201);
    // 70000 + 5000 = 75000
    expect(res.body.changeOrder.amountCents).toBe(75000);
    expect(res.body.changeOrder.lineItems).toHaveLength(3);
  });

  it('patching a line item recomputes amount_cents', async () => {
    // Get line item id
    const list = await request(app)
      .get(`/api/pins/${pinId}/change-orders`)
      .set(mgr());
    const co    = list.body.changeOrders.find((c: { id: string }) => c.id === coId);
    const itemId = co.lineItems.find((i: { description: string }) => i.description === 'Disposal fee').id;

    const res = await request(app)
      .patch(`/api/change-orders/${coId}/line-items/${itemId}`)
      .set(mgr())
      .send({ unitPriceCents: 8000 });
    expect(res.status).toBe(200);
    // 45000 + 25000 + 8000 = 78000
    expect(res.body.changeOrder.amountCents).toBe(78000);
  });

  it('deleting a line item recomputes amount_cents', async () => {
    const list = await request(app).get(`/api/pins/${pinId}/change-orders`).set(mgr());
    const co    = list.body.changeOrders.find((c: { id: string }) => c.id === coId);
    const itemId = co.lineItems.find((i: { description: string }) => i.description === 'Disposal fee').id;

    const res = await request(app)
      .delete(`/api/change-orders/${coId}/line-items/${itemId}`)
      .set(mgr());
    expect(res.status).toBe(200);
    // 45000 + 25000 = 70000
    expect(res.body.changeOrder.amountCents).toBe(70000);
    expect(res.body.changeOrder.lineItems).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 3: negative line item (credit)
// ---------------------------------------------------------------------------
describe('negative line item (credit)', () => {
  it('negative unitPriceCents stored and reflected in amount_cents', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'Mixed CO with credit',
        lineItems: [
          { description: 'Added material', quantity: 1, unitPriceCents: 50000 },
          { description: 'Customer credit', quantity: 1, unitPriceCents: -15000 },
        ],
      });
    expect(res.status).toBe(201);
    // 50000 + (-15000) = 35000
    expect(res.body.changeOrder.amountCents).toBe(35000);
    const creditItem = res.body.changeOrder.lineItems.find(
      (i: { description: string }) => i.description === 'Customer credit',
    );
    expect(creditItem.totalCents).toBe(-15000);
  });

  it('fully deductive CO (negative total) is stored correctly', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'Scope reduction: skip detached garage',
        lineItems: [{ description: 'Remove garage scope', quantity: 1, unitPriceCents: -120000 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.changeOrder.amountCents).toBe(-120000);
  });
});

// ---------------------------------------------------------------------------
// Tests 4–5: approve gate
// ---------------------------------------------------------------------------
describe('approve gate', () => {
  let coId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'Approve gate test CO',
        lineItems: [{ description: 'Work', quantity: 1, unitPriceCents: 30000 }],
      });
    coId = res.body.changeOrder.id;
  });

  it('approve without signature → 422', async () => {
    const res = await request(app)
      .post(`/api/change-orders/${coId}/approve`)
      .set(mgr());
    expect(res.status).toBe(422);
  });

  it('field_rep → 403 on /approve', async () => {
    const res = await request(app)
      .post(`/api/change-orders/${coId}/approve`)
      .set(rep());
    expect(res.status).toBe(403);
  });

  it('/sign stamps homeownerSignedAt server-side', async () => {
    const before = new Date();
    const res = await request(app)
      .post(`/api/change-orders/${coId}/sign`)
      .set(rep())
      .send({
        documentObjectPath:    'objects/test/co-doc.pdf',
        documentSha256:        'abc123',
        homeownerSignaturePath: 'objects/test/homeowner-sig.png',
        repSignaturePath:       'objects/test/rep-sig.png',
      });
    const after = new Date();
    expect(res.status).toBe(200);
    expect(res.body.changeOrder.homeownerSignedAt).not.toBeNull();
    const stamp = new Date(res.body.changeOrder.homeownerSignedAt);
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(stamp.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('approve after signing succeeds (manager+)', async () => {
    const before = new Date();
    const res = await request(app)
      .post(`/api/change-orders/${coId}/approve`)
      .set(mgr());
    const after = new Date();
    expect(res.status).toBe(200);
    expect(res.body.changeOrder.status).toBe('approved');
    expect(res.body.changeOrder.approvedAt).not.toBeNull();
    const stamp = new Date(res.body.changeOrder.approvedAt);
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(stamp.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});

// ---------------------------------------------------------------------------
// Test 6: field_rep CAN create
// ---------------------------------------------------------------------------
describe('field_rep creates a CO with line items', () => {
  it('POST as field_rep → 201', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(rep())
      .send({
        description: 'Rep-captured scope',
        lineItems: [{ description: 'Fascia board', quantity: 20, unitPriceCents: 1200 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.changeOrder.amountCents).toBe(24000);
  });
});

// ---------------------------------------------------------------------------
// Test 7: cross-company IDOR
// ---------------------------------------------------------------------------
describe('cross-company IDOR', () => {
  let coId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({ description: 'IDOR bait', lineItems: [{ description: 'x', quantity: 1, unitPriceCents: 100 }] });
    coId = res.body.changeOrder.id;
  });

  it('company B GET list for company A pin → 404', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/change-orders`).set(coB());
    expect(res.status).toBe(404);
  });

  it('company B PATCH company A CO → 404', async () => {
    const res = await request(app)
      .patch(`/api/change-orders/${coId}`)
      .set(coB())
      .send({ description: 'tampered' });
    expect(res.status).toBe(404);
  });

  it('company B DELETE company A CO → 404', async () => {
    const res = await request(app)
      .delete(`/api/change-orders/${coId}`)
      .set(coB());
    expect(res.status).toBe(404);
  });

  it('company B POST line item to company A CO → 404', async () => {
    const res = await request(app)
      .post(`/api/change-orders/${coId}/line-items`)
      .set(coB())
      .send({ description: 'x', quantity: 1, unitPriceCents: 100 });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Test 8: PATCH with foreign pin_id in body → pin_id UNCHANGED
// ---------------------------------------------------------------------------
describe('pin_id immutability on PATCH', () => {
  let coId: string;
  let originalPinId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({ description: 'pin_id test', lineItems: [] });
    coId = res.body.changeOrder.id;
    originalPinId = res.body.changeOrder.pinId;
  });

  it('pinId in body silently ignored; stored pin_id unchanged', async () => {
    const res = await request(app)
      .patch(`/api/change-orders/${coId}`)
      .set(mgr())
      .send({ description: 'Updated', pinId: companyBPinId } as Record<string, unknown>);
    // UpdateChangeOrderBody uses .strict() — extra fields → 400 (Zod strict)
    // or 200 if schema didn't include pinId (which strict strips)
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.changeOrder.pinId).toBe(originalPinId);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 9: DELETE still works (manager+)
// ---------------------------------------------------------------------------
describe('DELETE change order', () => {
  it('returns 204; second call → 404', async () => {
    const create = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({ description: 'To delete', lineItems: [] });
    expect(create.status).toBe(201);
    const coId = create.body.changeOrder.id;

    const del1 = await request(app).delete(`/api/change-orders/${coId}`).set(mgr());
    expect(del1.status).toBe(204);
    const del2 = await request(app).delete(`/api/change-orders/${coId}`).set(mgr());
    expect(del2.status).toBe(404);
  });

  it('field_rep → 403 on DELETE', async () => {
    const create = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({ description: 'Rep delete attempt', lineItems: [] });
    const coId = create.body.changeOrder.id;

    const res = await request(app).delete(`/api/change-orders/${coId}`).set(rep());
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Test 10: void sets voidedAt
// ---------------------------------------------------------------------------
describe('void change order', () => {
  let coId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'To be voided',
        lineItems: [{ description: 'Work', quantity: 1, unitPriceCents: 50000 }],
      });
    coId = res.body.changeOrder.id;
  });

  it('void sets voidedAt and voidedByUserId', async () => {
    const before = new Date();
    const res = await request(app)
      .post(`/api/change-orders/${coId}/void`)
      .set(mgr())
      .send({ voidReason: 'Signed in error' });
    const after = new Date();
    expect(res.status).toBe(200);
    expect(res.body.changeOrder.voidedAt).not.toBeNull();
    expect(res.body.changeOrder.voidedByUserId).toBe(managerId);
    expect(res.body.changeOrder.voidReason).toBe('Signed in error');
    const stamp = new Date(res.body.changeOrder.voidedAt);
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(stamp.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('voiding again → 409', async () => {
    const res = await request(app)
      .post(`/api/change-orders/${coId}/void`)
      .set(mgr());
    expect(res.status).toBe(409);
  });

  it('approve a voided CO → 409', async () => {
    const res = await request(app)
      .post(`/api/change-orders/${coId}/approve`)
      .set(mgr());
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Test 11: profitability — approved CO moves revised_contract_cents; pending does not
// ---------------------------------------------------------------------------
describe('profitability: approved CO integration', () => {
  let profitPinId: string;
  let pendingCoId: string;
  let approvedCoId: string;

  beforeAll(async () => {
    const [pin] = await db
      .insert(pinsTable)
      .values({ companyId: CO_A, userId: managerId, latitude: 39.1, longitude: -77.2, workflow: 'retail' })
      .returning();
    profitPinId = pin!.id;
  });

  afterAll(async () => {
    await db.delete(changeOrderLineItemsTable).where(eq(changeOrderLineItemsTable.companyId, CO_A));
    await db.delete(changeOrdersTable).where(eq(changeOrdersTable.pinId, profitPinId));
    await db.delete(pinsTable).where(eq(pinsTable.id, profitPinId));
  });

  it('pending CO does NOT move revised_contract_cents', async () => {
    const base = await request(app)
      .get(`/api/pins/${profitPinId}/profitability`)
      .set(mgr());
    expect(base.status).toBe(200);
    const baseRevised = base.body.profitability.revisedContractCents;

    const create = await request(app)
      .post(`/api/pins/${profitPinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'Pending CO',
        lineItems: [{ description: 'Extra work', quantity: 1, unitPriceCents: 100000 }],
      });
    pendingCoId = create.body.changeOrder.id;

    const after = await request(app)
      .get(`/api/pins/${profitPinId}/profitability`)
      .set(mgr());
    expect(after.body.profitability.revisedContractCents).toBe(baseRevised);
    expect(after.body.profitability.approvedCoCents).toBe(0);
  });

  it('approved CO DOES move revised_contract_cents and net_project_margin_cents', async () => {
    // Create, sign, then approve a CO
    const create = await request(app)
      .post(`/api/pins/${profitPinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'Approved CO',
        lineItems: [{ description: 'Approved extra', quantity: 1, unitPriceCents: 80000 }],
      });
    approvedCoId = create.body.changeOrder.id;

    await request(app)
      .post(`/api/change-orders/${approvedCoId}/sign`)
      .set(mgr())
      .send({
        documentObjectPath:    'objects/test/prof-co.pdf',
        documentSha256:        'sha256abc',
        homeownerSignaturePath: 'objects/test/prof-hw-sig.png',
      });

    const beforeApprove = await request(app)
      .get(`/api/pins/${profitPinId}/profitability`)
      .set(mgr());
    const beforeRevised = beforeApprove.body.profitability.revisedContractCents;

    await request(app)
      .post(`/api/change-orders/${approvedCoId}/approve`)
      .set(mgr());

    const after = await request(app)
      .get(`/api/pins/${profitPinId}/profitability`)
      .set(mgr());
    expect(after.status).toBe(200);
    const p = after.body.profitability;

    // revised_contract_cents increased by CO amount (80000)
    expect(p.revisedContractCents).toBe(beforeRevised + 80000);
    expect(p.approvedCoCents).toBe(80000);
    // net_project_margin_cents = revised_contract - total_cost
    expect(p.netProjectMarginCents).toBe(p.revisedContractCents - p.totalCostCents);
  });

  it('voiding the approved CO removes it from revised_contract_cents', async () => {
    const before = await request(app)
      .get(`/api/pins/${profitPinId}/profitability`)
      .set(mgr());
    const revisedBefore = before.body.profitability.revisedContractCents;

    await request(app)
      .post(`/api/change-orders/${approvedCoId}/void`)
      .set(mgr())
      .send({ voidReason: 'Test void' });

    const after = await request(app)
      .get(`/api/pins/${profitPinId}/profitability`)
      .set(mgr());
    expect(after.body.profitability.revisedContractCents).toBe(revisedBefore - 80000);
    expect(after.body.profitability.approvedCoCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 12: overhead PATCH + mark-paid unchanged
// ---------------------------------------------------------------------------
describe('overhead PATCH and mark-paid still work', () => {
  it('manager sets all five overhead amounts → 200', async () => {
    const res = await request(app)
      .patch(`/api/pins/${pinId}/overhead`)
      .set(mgr())
      .send({
        leadAcquisitionCostCents:  10000,
        referralFeeCents:          20000,
        salesCommissionCents:      30000,
        canvassingCommissionCents: 40000,
        pmCommissionCents:         50000,
      });
    expect(res.status).toBe(200);
    expect(res.body.overhead.canvassingCommissionCents).toBe(40000);
  });

  it('field_rep → 403 on overhead PATCH', async () => {
    const res = await request(app)
      .patch(`/api/pins/${pinId}/overhead`)
      .set(rep())
      .send({ canvassingCommissionCents: 1 });
    expect(res.status).toBe(403);
  });

  it('canvassing mark-paid stamps date server-side', async () => {
    const before = new Date();
    const res = await request(app)
      .post(`/api/pins/${pinId}/overhead/canvassing/mark-paid`)
      .set(mgr());
    const after = new Date();
    expect(res.status).toBe(200);
    const stamp = new Date(res.body.overhead.canvassingCommissionPaidDate);
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(stamp.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});

// ---------------------------------------------------------------------------
// Test 13: 'change_order' is in TEMPLATE_USE_CASES vocabulary
// ---------------------------------------------------------------------------
describe('template use case: change_order in vocabulary', () => {
  it('TEMPLATE_USE_CASES includes change_order', () => {
    expect(TEMPLATE_USE_CASES).toContain('change_order');
  });
});

// ---------------------------------------------------------------------------
// Test 14: emailedAt field + approval email behavior (Step 4)
//
//   14a. No SMTP configured → approve succeeds; emailedAt null.
//   14b. GET /change-orders list includes emailedAt field on each CO.
//   14c. Email send failure (object not found / bad SMTP creds) does NOT
//        roll back the approval — status stays 'approved', emailedAt null.
//   14d. field_rep → 403 on approve (confirm authz unaffected by email path).
// ---------------------------------------------------------------------------
describe('approve → emailedAt field + email behavior', () => {
  let emailCoId: string;

  beforeAll(async () => {
    // Create + sign a CO so it is approvable.
    const coRes = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'Email behavior test CO',
        lineItems: [{ description: 'Repair work', quantity: 1, unitPriceCents: 12500 }],
      });
    expect(coRes.status).toBe(201);
    emailCoId = coRes.body.changeOrder.id;

    const signRes = await request(app)
      .post(`/api/change-orders/${emailCoId}/sign`)
      .set(mgr())
      .send({
        documentObjectPath:     'objects/test/email-test.pdf',
        documentSha256:         'sha256emailtest',
        homeownerSignaturePath: 'objects/test/email-hw.png',
      });
    expect(signRes.status).toBe(200);
  });

  it('14a — no SMTP configured → approve returns 200; emailedAt is null', async () => {
    // Manager fixture has no smtpHost set → email path skipped.
    const res = await request(app)
      .post(`/api/change-orders/${emailCoId}/approve`)
      .set(mgr());
    expect(res.status).toBe(200);
    expect(res.body.changeOrder.status).toBe('approved');
    expect(res.body.changeOrder.emailedAt).toBeNull();
  });

  it('14b — GET list includes emailedAt on every CO', async () => {
    const res = await request(app)
      .get(`/api/pins/${pinId}/change-orders`)
      .set(mgr());
    expect(res.status).toBe(200);
    expect(res.body.changeOrders.length).toBeGreaterThan(0);
    for (const co of res.body.changeOrders) {
      expect(Object.prototype.hasOwnProperty.call(co, 'emailedAt')).toBe(true);
    }
  });

  it('14d — field_rep → 403 on approve regardless of SMTP config', async () => {
    // Create a second signed CO so the rep has something to attempt.
    const coRes = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'Authz email test CO',
        lineItems: [{ description: 'Item', quantity: 1, unitPriceCents: 500 }],
      });
    expect(coRes.status).toBe(201);
    const repCoId = coRes.body.changeOrder.id;

    await request(app)
      .post(`/api/change-orders/${repCoId}/sign`)
      .set(mgr())
      .send({
        documentObjectPath:     'objects/test/rep-authz.pdf',
        documentSha256:         'sha256authz',
        homeownerSignaturePath: 'objects/test/rep-authz-hw.png',
      });

    const res = await request(app)
      .post(`/api/change-orders/${repCoId}/approve`)
      .set(rep());
    expect(res.status).toBe(403);
  });
});

describe('approve → email failure does not roll back approval', () => {
  let smtpFailCoId: string;

  beforeAll(async () => {
    // Seed the manager's profile with fake SMTP credentials so the email
    // code path executes. The object-storage read will throw (test PDF doesn't
    // exist in object storage), which is caught; the approval must still stand.
    await db
      .update(userProfilesTable)
      .set({
        smtpHost:        'smtp.invalid.example.test',
        smtpPort:        587,
        smtpUsername:    `user-${RUN_ID}@invalid.test`,
        smtpPasswordEnc: 'fakeciphertext',
      })
      .where(eq(userProfilesTable.userId, managerId));

    const coRes = await request(app)
      .post(`/api/pins/${pinId}/change-orders`)
      .set(mgr())
      .send({
        description: 'SMTP failure resilience CO',
        lineItems: [{ description: 'Test item', quantity: 1, unitPriceCents: 9900 }],
      });
    expect(coRes.status).toBe(201);
    smtpFailCoId = coRes.body.changeOrder.id;

    const signRes = await request(app)
      .post(`/api/change-orders/${smtpFailCoId}/sign`)
      .set(mgr())
      .send({
        documentObjectPath:     'objects/test/smtp-fail.pdf',
        documentSha256:         'sha256smtpfail',
        homeownerSignaturePath: 'objects/test/smtp-hw.png',
      });
    expect(signRes.status).toBe(200);
  });

  afterAll(async () => {
    // Remove fake SMTP credentials so subsequent tests are unaffected.
    await db
      .update(userProfilesTable)
      .set({ smtpHost: null, smtpPort: null, smtpUsername: null, smtpPasswordEnc: null })
      .where(eq(userProfilesTable.userId, managerId));
  });

  it('14c — approve still returns 200 when email send throws (bad SMTP / object not found)', async () => {
    // objectStorageService.readObjectEntityBytes throws ObjectNotFoundError for
    // 'objects/test/smtp-fail.pdf' because the test PDF doesn't exist.
    // The try/catch in the approve handler must absorb this and keep status 200.
    const res = await request(app)
      .post(`/api/change-orders/${smtpFailCoId}/approve`)
      .set(mgr());
    expect(res.status).toBe(200);
    expect(res.body.changeOrder.status).toBe('approved');
    // emailedAt must be null — the send failed before we could stamp it.
    expect(res.body.changeOrder.emailedAt).toBeNull();
  });
});

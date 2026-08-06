/**
 * Step 2 — Customer Invoices checkpoint tests.
 *
 * Covers every item in CHECKPOINT 2:
 *   1. Create two invoices concurrently → distinct numbers, no collision
 *   2. mark-paid → exactly ONE ledger row, correct type + cents
 *   3. mark-paid AGAIN → still one ledger row (idempotency)
 *   4. Void a paid invoice → ledger unlinked (customer_invoice_id = NULL), invoice = 'void'
 *   5. field_rep create/modify/send/mark-paid/void → 403
 *   6. Cross-company invoice access → 404
 */
import { companiesTable, customerInvoicesTable, db, paymentsTable, pinsTable, pool, userProfilesTable, usersTable } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app';
import { createSession } from '../../lib/auth';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID = Date.now().toString(36).toUpperCase();
const CO_A = `INV-A-${RUN_ID}`;
const CO_B = `INV-B-${RUN_ID}`;

let managerSid: string;
let repSid: string;
let companyBSid: string;
let managerId: string;
let repId: string;
let companyBUserId: string;
let pinId: string;
let companyBPinId: string;

beforeAll(async () => {
  // Company A — manager + field_rep
  await db.insert(companiesTable).values([
    { id: CO_A, name: 'Invoice Test Company A' },
    { id: CO_B, name: 'Invoice Test Company B' },
  ]);
  const [mgr, rep, bu] = await db
    .insert(usersTable)
    .values([
      { companyId: CO_A, email: `inv-mgr-${RUN_ID}@t.invalid` },
      { companyId: CO_A, email: `inv-rep-${RUN_ID}@t.invalid` },
      { companyId: CO_B, email: `inv-b-${RUN_ID}@t.invalid` },
    ])
    .returning();
  managerId = mgr.id;
  repId = rep.id;
  companyBUserId = bu.id;

  await db.insert(userProfilesTable).values([
    { userId: managerId, role: 'manager' },
    { userId: repId, role: 'field_rep' },
    { userId: companyBUserId, role: 'manager' },
  ]);

  managerSid = await createSession({ user: { id: managerId, email: mgr.email, firstName: null, lastName: null, profileImageUrl: null, companyId: CO_A }, access_token: 'tok' });
  repSid = await createSession({ user: { id: repId, email: rep.email, firstName: null, lastName: null, profileImageUrl: null, companyId: CO_A }, access_token: 'tok' });
  companyBSid = await createSession({ user: { id: companyBUserId, email: bu.email, firstName: null, lastName: null, profileImageUrl: null, companyId: CO_B }, access_token: 'tok' });

  const [pin] = await db
    .insert(pinsTable)
    .values({ companyId: CO_A, userId: managerId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
    .returning();
  pinId = pin.id;

  const [bPin] = await db
    .insert(pinsTable)
    .values({ companyId: CO_B, userId: companyBUserId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
    .returning();
  companyBPinId = bPin.id;
});

afterAll(async () => {
  // Cascade deletes handle invoices and payments.
  await db.delete(pinsTable).where(eq(pinsTable.companyId, CO_A)).catch(() => {});
  await db.delete(pinsTable).where(eq(pinsTable.companyId, CO_B)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, managerId)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, repId)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, companyBUserId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.companyId, CO_A)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.companyId, CO_B)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, CO_A)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, CO_B)).catch(() => {});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validInvoiceBody = {
  customerName: 'Jane Smith',
  customerAddress: '123 Main St, Springfield, VA 22150',
  invoiceType: 'acv_payment',
  amountCents: 850000, // $8,500.00
};

async function createInvoice(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/pins/${pinId}/invoices`)
    .set({ Authorization: `Bearer ${managerSid}` })
    .send({ ...validInvoiceBody, ...overrides });
}

// ---------------------------------------------------------------------------
// 1. Concurrent invoice creation — distinct numbers, no collision
// ---------------------------------------------------------------------------

describe('invoice number uniqueness under concurrency', () => {
  it('two simultaneous creates for the same company produce distinct invoice numbers', async () => {
    const [r1, r2] = await Promise.all([createInvoice(), createInvoice()]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const n1 = r1.body.invoice.invoiceNumber as string;
    const n2 = r2.body.invoice.invoiceNumber as string;
    expect(n1).toMatch(/^INV-\d{6}-\d{5}$/);
    expect(n2).toMatch(/^INV-\d{6}-\d{5}$/);
    expect(n1).not.toBe(n2);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. mark-paid idempotency
// ---------------------------------------------------------------------------

describe('mark-paid idempotency', () => {
  let invoiceId: string;
  let invoiceAmountCents: number;
  let invoiceType: string;

  it('creates an invoice (acv_payment, $8 500)', async () => {
    const res = await createInvoice({ amountCents: 850000 });
    expect(res.status).toBe(201);
    invoiceId = res.body.invoice.id;
    invoiceAmountCents = res.body.invoice.amountCents;
    invoiceType = res.body.invoice.invoiceType;
    expect(invoiceType).toBe('acv_payment');
  });

  it('mark-paid → status = paid, exactly ONE payments ledger row', async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceId}/mark-paid`)
      .set({ Authorization: `Bearer ${managerSid}` })
      .send({ paymentMethod: 'Check' });
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('paid');

    const rows = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.customerInvoiceId, invoiceId));
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('acv'); // acv_payment → acv
    expect(rows[0].amountCents).toBe(850000);
  });

  it('mark-paid AGAIN → still exactly ONE ledger row (idempotent)', async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceId}/mark-paid`)
      .set({ Authorization: `Bearer ${managerSid}` })
      .send({ paymentMethod: 'Check' });
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('paid');

    const rows = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.customerInvoiceId, invoiceId));
    expect(rows).toHaveLength(1); // must not have grown to 2
  });
});

// ---------------------------------------------------------------------------
// 4. Void a paid invoice — ledger state stays consistent
// ---------------------------------------------------------------------------

describe('void a paid invoice', () => {
  let invoiceId: string;

  it('creates and marks an invoice paid', async () => {
    const r1 = await createInvoice({ invoiceType: 'final_payment', amountCents: 120000 });
    expect(r1.status).toBe(201);
    invoiceId = r1.body.invoice.id;
    const r2 = await request(app)
      .post(`/api/invoices/${invoiceId}/mark-paid`)
      .set({ Authorization: `Bearer ${managerSid}` });
    expect(r2.status).toBe(200);
    expect(r2.body.invoice.status).toBe('paid');
  });

  it('voiding the paid invoice sets status=void and unlinks (not deletes) the payment', async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceId}/void`)
      .set({ Authorization: `Bearer ${managerSid}` });
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('void');

    // Payment ledger row still exists (money stays in the ledger).
    const rows = await db
      .select()
      .from(paymentsTable)
      .where(and(eq(paymentsTable.pinId, pinId), eq(paymentsTable.amountCents, 120000)));
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // But the link is severed — customer_invoice_id is now NULL.
    const linkedRows = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.customerInvoiceId, invoiceId));
    expect(linkedRows).toHaveLength(0);
  });

  it('void is idempotent — voiding an already-void invoice returns 200', async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceId}/void`)
      .set({ Authorization: `Bearer ${managerSid}` });
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('void');
  });
});

// ---------------------------------------------------------------------------
// 5. field_rep authorization — 403 on all write endpoints
// ---------------------------------------------------------------------------

describe('field_rep cannot write invoices', () => {
  let invoiceId: string;

  beforeAll(async () => {
    const res = await createInvoice({ amountCents: 50000 });
    invoiceId = res.body.invoice.id;
  });

  it('POST /pins/:pinId/invoices → 403', async () => {
    const res = await request(app)
      .post(`/api/pins/${pinId}/invoices`)
      .set({ Authorization: `Bearer ${repSid}` })
      .send(validInvoiceBody);
    expect(res.status).toBe(403);
  });

  it('PATCH /invoices/:invoiceId → 403', async () => {
    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}`)
      .set({ Authorization: `Bearer ${repSid}` })
      .send({ customerName: 'Hacker' });
    expect(res.status).toBe(403);
  });

  it('POST /invoices/:invoiceId/send → 403', async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceId}/send`)
      .set({ Authorization: `Bearer ${repSid}` });
    expect(res.status).toBe(403);
  });

  it('POST /invoices/:invoiceId/mark-paid → 403', async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceId}/mark-paid`)
      .set({ Authorization: `Bearer ${repSid}` });
    expect(res.status).toBe(403);
  });

  it('POST /invoices/:invoiceId/void → 403', async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceId}/void`)
      .set({ Authorization: `Bearer ${repSid}` });
    expect(res.status).toBe(403);
  });

  it('DELETE /invoices/:invoiceId → 403', async () => {
    const res = await request(app)
      .delete(`/api/invoices/${invoiceId}`)
      .set({ Authorization: `Bearer ${repSid}` });
    expect(res.status).toBe(403);
  });

  it('GET /pins/:pinId/invoices → 200 (reads are not manager-gated)', async () => {
    const res = await request(app)
      .get(`/api/pins/${pinId}/invoices`)
      .set({ Authorization: `Bearer ${repSid}` });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 6. Cross-company IDOR guard
// ---------------------------------------------------------------------------

describe('cross-company access is blocked', () => {
  let invoiceId: string;

  beforeAll(async () => {
    const res = await createInvoice({ amountCents: 75000 });
    invoiceId = res.body.invoice.id;
  });

  it('company B cannot GET company A invoice → 404', async () => {
    const res = await request(app)
      .get(`/api/invoices/${invoiceId}`)
      .set({ Authorization: `Bearer ${companyBSid}` });
    expect(res.status).toBe(404);
  });

  it('company B cannot PATCH company A invoice → 404', async () => {
    const res = await request(app)
      .patch(`/api/invoices/${invoiceId}`)
      .set({ Authorization: `Bearer ${companyBSid}` })
      .send({ customerName: 'Cross-company attack' });
    expect(res.status).toBe(404);
  });

  it('company B cannot mark-paid company A invoice → 404', async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceId}/mark-paid`)
      .set({ Authorization: `Bearer ${companyBSid}` });
    expect(res.status).toBe(404);
  });

  it('company B cannot void company A invoice → 404', async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceId}/void`)
      .set({ Authorization: `Bearer ${companyBSid}` });
    expect(res.status).toBe(404);
  });

  it('company B cannot DELETE company A invoice → 404', async () => {
    const res = await request(app)
      .delete(`/api/invoices/${invoiceId}`)
      .set({ Authorization: `Bearer ${companyBSid}` });
    expect(res.status).toBe(404);
  });

  it('company B cannot list company A pin invoices → 404 (pin not found)', async () => {
    const res = await request(app)
      .get(`/api/pins/${pinId}/invoices`)
      .set({ Authorization: `Bearer ${companyBSid}` });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: create → list → lifecycle smoke test
// ---------------------------------------------------------------------------

describe('lifecycle smoke test', () => {
  it('open → sent → paid lifecycle', async () => {
    const r1 = await createInvoice({ invoiceType: 'initial_deposit', amountCents: 250000 });
    expect(r1.status).toBe(201);
    const id = r1.body.invoice.id as string;
    expect(r1.body.invoice.status).toBe('open');

    // Send
    const r2 = await request(app)
      .post(`/api/invoices/${id}/send`)
      .set({ Authorization: `Bearer ${managerSid}` });
    expect(r2.status).toBe(200);
    expect(r2.body.invoice.status).toBe('sent');
    expect(r2.body.invoice.sentDate).not.toBeNull();

    // Mark paid — should map initial_deposit → deposit payment type
    const r3 = await request(app)
      .post(`/api/invoices/${id}/mark-paid`)
      .set({ Authorization: `Bearer ${managerSid}` })
      .send({ paymentMethod: 'ACH' });
    expect(r3.status).toBe(200);
    expect(r3.body.invoice.status).toBe('paid');
    expect(r3.body.invoice.paidDate).not.toBeNull();

    const rows = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.customerInvoiceId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('deposit'); // initial_deposit → deposit
    expect(rows[0].amountCents).toBe(250000);
    expect(rows[0].method).toBe('ACH');
  });

  it('invoice appears in list', async () => {
    const res = await request(app)
      .get(`/api/pins/${pinId}/invoices`)
      .set({ Authorization: `Bearer ${managerSid}` });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.invoices)).toBe(true);
    expect(res.body.invoices.length).toBeGreaterThan(0);
  });
});

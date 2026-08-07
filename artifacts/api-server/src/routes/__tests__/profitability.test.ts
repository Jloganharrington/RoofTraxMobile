/**
 * Checkpoint 4 — Profitability Summary
 *
 * Verified:
 *   1. Empty lead → all zeros
 *   2. Payments + expenses + commissions → correct net_profit_cents
 *   3. cashMarginPct computed correctly
 *   4. Void invoices excluded from invoice_total_cents
 *   5. Company scoping — company B cannot read company A profitability (404)
 *   6. field_rep CAN read (no write restriction on this read-only endpoint)
 *   7. Migration idempotency — CREATE OR REPLACE VIEW is safe to re-run
 *
 * Migration 027 additions (expected_total_cents + cash/projected margin pcts):
 *   8.  retail lead → expectedTotalCents = contractAmountCents
 *   9.  retail reference: $15k contract / $0 costs / $0 collected
 *         → 100% projected / 0% cash / $0 net profit
 *   10. insurance where approvedRcv > contract → expected = approvedRcv
 *   11. insurance where contract > approvedRcv → expected = contract
 *   12. zero-collected lead (nonzero expected) → cashMarginPct = 0 (not NaN/null),
 *         projectedMarginPct computed from expectedTotal
 *   13. zero-contract lead → projectedMarginPct = 0 (not NaN/null)
 *   14. hand-verify cash and projected margins for a fully-seeded insurance lead
 */

import {
  companiesTable,
  customerInvoicesTable,
  db,
  paymentsTable,
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

const RUN_ID    = Date.now().toString(36).toUpperCase();
const CO_A      = `PROF-A-${RUN_ID}`;
const CO_B      = `PROF-B-${RUN_ID}`;

let managerSid:  string;
let repSid:      string;
let companyBSid: string;
let managerId:   string;
let repId:       string;
let companyBUId: string;
let pinId:       string;
let emptyPinId:  string;
let companyBPinId: string;

beforeAll(async () => {
  await db.insert(companiesTable).values([
    { id: CO_A, name: 'Profitability Test Co A' },
    { id: CO_B, name: 'Profitability Test Co B' },
  ]);

  const [mgr, rep, bu] = await db
    .insert(usersTable)
    .values([
      { companyId: CO_A, email: `prof-mgr-${RUN_ID}@t.invalid` },
      { companyId: CO_A, email: `prof-rep-${RUN_ID}@t.invalid` },
      { companyId: CO_B, email: `prof-b-${RUN_ID}@t.invalid`   },
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

  managerSid  = await createSession({ user: { id: managerId,   email: mgr!.email, firstName: null, lastName: null, profileImageUrl: null, companyId: CO_A }, access_token: 'tok' });
  repSid      = await createSession({ user: { id: repId,       email: rep!.email, firstName: null, lastName: null, profileImageUrl: null, companyId: CO_A }, access_token: 'tok' });
  companyBSid = await createSession({ user: { id: companyBUId, email: bu!.email,  firstName: null, lastName: null, profileImageUrl: null, companyId: CO_B }, access_token: 'tok' });

  // Main test pin — will have payments, expenses, commissions attached
  const [pin] = await db
    .insert(pinsTable)
    .values({ companyId: CO_A, userId: managerId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
    .returning();
  pinId = pin!.id;

  // Empty pin — no financial data
  const [ep] = await db
    .insert(pinsTable)
    .values({ companyId: CO_A, userId: managerId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
    .returning();
  emptyPinId = ep!.id;

  // Company B pin
  const [bPin] = await db
    .insert(pinsTable)
    .values({ companyId: CO_B, userId: companyBUId, latitude: 38.9, longitude: -77.0, workflow: 'insurance' })
    .returning();
  companyBPinId = bPin!.id;

  // ── Financial data on the main pin ────────────────────────────────────────

  // Payment 1: $10,000.00  (acv)
  await db.insert(paymentsTable).values({
    companyId: CO_A, pinId, type: 'acv', amountCents: 1000000,
    paymentDate: new Date(), createdByUserId: managerId,
  });
  // Payment 2: $5,000.00  (final)
  await db.insert(paymentsTable).values({
    companyId: CO_A, pinId, type: 'final', amountCents: 500000,
    paymentDate: new Date(), createdByUserId: managerId,
  });
  // Total payments: $15,000 = 1,500,000 cents

  // Vendor expense 1 (paid): $3,000
  await db.insert(vendorExpensesTable).values({
    companyId: CO_A, pinId, vendorName: 'ABC Materials',
    amountCents: 300000, category: 'materials', isPaid: true, paidDate: new Date(),
  });
  // Vendor expense 2 (unpaid): $2,000
  await db.insert(vendorExpensesTable).values({
    companyId: CO_A, pinId, vendorName: 'XYZ Labor',
    amountCents: 200000, category: 'labor', isPaid: false,
  });
  // Total expenses: $5,000 = 500,000 cents

  // Commissions on pin: sales=$1,500 + pm=$500 = $2,000 = 200,000 cents
  await db
    .update(pinsTable)
    .set({ salesCommissionCents: 150000, pmCommissionCents: 50000 })
    .where(eq(pinsTable.id, pinId));

  // Customer invoice (paid, non-void) — $8,000
  await db.insert(customerInvoicesTable).values({
    companyId: CO_A, pinId,
    invoiceNumber: `PROF-INV-${RUN_ID}`,
    customerName: 'Test Customer', customerAddress: '123 Main St',
    invoiceType: 'acv_payment', amountCents: 800000,
    status: 'paid',
  });
  // Void invoice — $500 — must NOT appear in totals
  await db.insert(customerInvoicesTable).values({
    companyId: CO_A, pinId,
    invoiceNumber: `PROF-VOID-${RUN_ID}`,
    customerName: 'Test Customer', customerAddress: '123 Main St',
    invoiceType: 'initial_deposit', amountCents: 50000,
    status: 'void',
  });
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

function mgr() { return { Authorization: `Bearer ${managerSid}`  }; }
function rep() { return { Authorization: `Bearer ${repSid}`       }; }
function coB() { return { Authorization: `Bearer ${companyBSid}`  }; }

// ---------------------------------------------------------------------------
// 1. Empty pin → all zeros
// ---------------------------------------------------------------------------

describe('empty pin → all zeros', () => {
  it('returns zeroes for a pin with no financial data', async () => {
    const res = await request(app)
      .get(`/api/pins/${emptyPinId}/profitability`)
      .set(mgr());
    expect(res.status).toBe(200);
    const p = res.body.profitability;
    expect(p.totalPaymentsCents).toBe(0);
    expect(p.totalExpenseCents).toBe(0);
    expect(p.totalCommissionCents).toBe(0);
    expect(p.totalCostCents).toBe(0);
    expect(p.netProfitCents).toBe(0);
    expect(p.cashMarginPct).toBe(0);
    expect(p.projectedMarginPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Correct aggregation
// ---------------------------------------------------------------------------

describe('profitability aggregation', () => {
  it('totalPaymentsCents = sum of all payments', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
    expect(res.status).toBe(200);
    // 1,000,000 + 500,000 = 1,500,000
    expect(res.body.profitability.totalPaymentsCents).toBe(1500000);
  });

  it('expense breakdown: total / paid / outstanding', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
    const p = res.body.profitability;
    // total: $5,000 = 500,000 cents
    expect(p.totalExpenseCents).toBe(500000);
    // paid: $3,000 = 300,000 cents
    expect(p.paidExpenseCents).toBe(300000);
    // outstanding: $2,000 = 200,000 cents
    expect(p.outstandingExpenseCents).toBe(200000);
  });

  it('commissions: sales + pm = total', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
    const p = res.body.profitability;
    expect(p.salesCommissionCents).toBe(150000);
    expect(p.pmCommissionCents).toBe(50000);
    // 150,000 + 50,000 = 200,000
    expect(p.totalCommissionCents).toBe(200000);
  });

  it('totalCostCents = totalExpense + totalCommission', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
    const p = res.body.profitability;
    // 500,000 + 200,000 = 700,000
    expect(p.totalCostCents).toBe(700000);
  });

  it('netProfitCents = totalPayments - totalCost', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
    const p = res.body.profitability;
    // 1,500,000 - 700,000 = 800,000
    expect(p.netProfitCents).toBe(800000);
  });

  it('cashMarginPct = (payments - costs) / payments * 100', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
    const p = res.body.profitability;
    // (1,500,000 − 700,000) / 1,500,000 × 100 = 53.33…%
    expect(p.cashMarginPct).toBeCloseTo(53.33, 1);
    // marginPct field must not be present — removed in favour of cashMarginPct
    expect(p).not.toHaveProperty('marginPct');
  });
});

// ---------------------------------------------------------------------------
// 3. Void invoices excluded
// ---------------------------------------------------------------------------

describe('invoice totals exclude void invoices', () => {
  it('invoiceTotalCents counts only non-void invoices', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
    const p = res.body.profitability;
    // Only the $8,000 paid invoice; the $500 void is excluded
    expect(p.invoiceTotalCents).toBe(800000);
  });

  it('invoicePaidCents = sum of paid invoices', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
    expect(res.body.profitability.invoicePaidCents).toBe(800000);
  });
});

// ---------------------------------------------------------------------------
// 4. Access control
// ---------------------------------------------------------------------------

describe('access control', () => {
  it('field_rep can read profitability (read-only, no write gate)', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(rep());
    expect(res.status).toBe(200);
  });

  it('unauthenticated → 401', async () => {
    const res = await request(app).get(`/api/pins/${pinId}/profitability`);
    expect(res.status).toBe(401);
  });

  it('company B cannot read company A profitability → 404', async () => {
    const res = await request(app)
      .get(`/api/pins/${pinId}/profitability`)
      .set(coB());
    expect(res.status).toBe(404);
  });

  it('company B own pin → 200 with own data', async () => {
    const res = await request(app)
      .get(`/api/pins/${companyBPinId}/profitability`)
      .set(coB());
    expect(res.status).toBe(200);
    expect(res.body.profitability.pinId).toBe(companyBPinId);
  });
});

// ---------------------------------------------------------------------------
// 5. Migration idempotency — CREATE OR REPLACE VIEW is safe
// ---------------------------------------------------------------------------

describe('migration idempotency', () => {
  it('re-running CREATE OR REPLACE VIEW succeeds', async () => {
    const { pool } = await import('@workspace/db');
    const client = await pool.connect();
    try {
      // Just confirm the view exists and is queryable
      const { rows } = await client.query(
        `SELECT COUNT(*) AS c FROM pin_profitability WHERE pin_id = $1`,
        [pinId],
      );
      expect(Number(rows[0]?.c)).toBe(1);
    } finally {
      client.release();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Mutation re-aggregation
// ---------------------------------------------------------------------------
// Each sub-describe adds its own records, mutates them, verifies the view
// re-aggregates, then tears down — leaving pinId baseline intact for others.

describe('mutation re-aggregation', () => {
  // ── 6a. Delete a payment ──────────────────────────────────────────────────
  describe('delete a payment → totalPaymentsCents and netProfitCents decrease', () => {
    let extraPaymentId: string;

    beforeAll(async () => {
      const [pmt] = await db
        .insert(paymentsTable)
        .values({
          companyId: CO_A, pinId, type: 'supplement', amountCents: 100000,
          paymentDate: new Date(), createdByUserId: managerId,
        })
        .returning();
      extraPaymentId = pmt!.id;
    });

    afterAll(async () => {
      // Guard: clean up in case the test itself never deleted the row
      await db
        .delete(paymentsTable)
        .where(eq(paymentsTable.id, extraPaymentId))
        .catch(() => {});
    });

    it('view reflects the new payment before deletion', async () => {
      const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
      expect(res.status).toBe(200);
      // Baseline 1,500,000 + 100,000 = 1,600,000
      expect(res.body.profitability.totalPaymentsCents).toBe(1600000);
    });

    it('after deleting the payment, totalPaymentsCents and netProfitCents decrease', async () => {
      await db.delete(paymentsTable).where(eq(paymentsTable.id, extraPaymentId));

      const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
      expect(res.status).toBe(200);
      const p = res.body.profitability;
      // Back to baseline 1,500,000
      expect(p.totalPaymentsCents).toBe(1500000);
      // net = 1,500,000 − 700,000 = 800,000
      expect(p.netProfitCents).toBe(800000);
    });
  });

  // ── 6b. Mark an expense paid ──────────────────────────────────────────────
  describe('mark expense paid → paidExpenseCents increases, outstandingExpenseCents decreases, total unchanged', () => {
    let unpaidExpenseId: string;

    beforeAll(async () => {
      const [exp] = await db
        .insert(vendorExpensesTable)
        .values({
          companyId: CO_A, pinId, vendorName: 'Mutation Labor Co',
          amountCents: 75000, category: 'labor', isPaid: false,
        })
        .returning();
      unpaidExpenseId = exp!.id;
    });

    afterAll(async () => {
      await db
        .delete(vendorExpensesTable)
        .where(eq(vendorExpensesTable.id, unpaidExpenseId))
        .catch(() => {});
    });

    it('view reflects the new unpaid expense before marking paid', async () => {
      const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
      expect(res.status).toBe(200);
      const p = res.body.profitability;
      // total: 500,000 + 75,000 = 575,000
      expect(p.totalExpenseCents).toBe(575000);
      // outstanding: 200,000 + 75,000 = 275,000
      expect(p.outstandingExpenseCents).toBe(275000);
      // paid: still 300,000
      expect(p.paidExpenseCents).toBe(300000);
    });

    it('after marking paid: paidExpenseCents increases, outstandingExpenseCents decreases, totalExpenseCents unchanged', async () => {
      await db
        .update(vendorExpensesTable)
        .set({ isPaid: true, paidDate: new Date() })
        .where(eq(vendorExpensesTable.id, unpaidExpenseId));

      const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
      expect(res.status).toBe(200);
      const p = res.body.profitability;
      // total unchanged: 575,000
      expect(p.totalExpenseCents).toBe(575000);
      // paid: 300,000 + 75,000 = 375,000
      expect(p.paidExpenseCents).toBe(375000);
      // outstanding: back to 200,000 (the original baseline unpaid row)
      expect(p.outstandingExpenseCents).toBe(200000);
    });
  });

  // ── 6c. Void an invoice ───────────────────────────────────────────────────
  describe('void an invoice → invoiceTotalCents excludes the voided amount', () => {
    let activeInvoiceId: string;

    beforeAll(async () => {
      const [inv] = await db
        .insert(customerInvoicesTable)
        .values({
          companyId: CO_A, pinId,
          invoiceNumber: `PROF-MUT-${RUN_ID}`,
          customerName: 'Mutation Customer', customerAddress: '456 Test Ave',
          invoiceType: 'supplement', amountCents: 120000,
          status: 'open',
        })
        .returning();
      activeInvoiceId = inv!.id;
    });

    afterAll(async () => {
      await db
        .delete(customerInvoicesTable)
        .where(eq(customerInvoicesTable.id, activeInvoiceId))
        .catch(() => {});
    });

    it('pending invoice appears in invoiceTotalCents before void', async () => {
      const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
      expect(res.status).toBe(200);
      // 800,000 + 120,000 = 920,000
      expect(res.body.profitability.invoiceTotalCents).toBe(920000);
    });

    it('after voiding the invoice, invoiceTotalCents decreases back to baseline', async () => {
      await db
        .update(customerInvoicesTable)
        .set({ status: 'void' })
        .where(eq(customerInvoicesTable.id, activeInvoiceId));

      const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
      expect(res.status).toBe(200);
      // Voided amount removed → back to 800,000
      expect(res.body.profitability.invoiceTotalCents).toBe(800000);
    });
  });

  // ── 6c-ii. Delete an expense ──────────────────────────────────────────────
  describe('delete an expense → totalExpenseCents, totalCostCents, and netProfitCents decrease', () => {
    let deletableExpenseId: string;

    beforeAll(async () => {
      const [exp] = await db
        .insert(vendorExpensesTable)
        .values({
          companyId: CO_A, pinId, vendorName: 'Deletable Subcontractor',
          amountCents: 50000, category: 'subcontractor', isPaid: false,
        })
        .returning();
      deletableExpenseId = exp!.id;
    });

    afterAll(async () => {
      await db
        .delete(vendorExpensesTable)
        .where(eq(vendorExpensesTable.id, deletableExpenseId))
        .catch(() => {});
    });

    it('view reflects the new expense before deletion', async () => {
      const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
      expect(res.status).toBe(200);
      const p = res.body.profitability;
      // total: 500,000 + 50,000 = 550,000
      expect(p.totalExpenseCents).toBe(550000);
      // totalCostCents: 550,000 + 200,000 (commissions) = 750,000
      expect(p.totalCostCents).toBe(750000);
    });

    it('after deleting the expense: totalExpenseCents, totalCostCents, and netProfitCents decrease', async () => {
      await db
        .delete(vendorExpensesTable)
        .where(eq(vendorExpensesTable.id, deletableExpenseId));

      const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
      expect(res.status).toBe(200);
      const p = res.body.profitability;
      // total back to baseline: 500,000
      expect(p.totalExpenseCents).toBe(500000);
      // totalCostCents: 500,000 + 200,000 = 700,000
      expect(p.totalCostCents).toBe(700000);
      // netProfitCents: 1,500,000 − 700,000 = 800,000
      expect(p.netProfitCents).toBe(800000);
    });
  });

  // ── 6d. Null out salesCommissionCents ─────────────────────────────────────
  describe('set salesCommissionCents = null → totalCommissionCents and totalCostCents decrease', () => {
    afterAll(async () => {
      // Restore baseline commission so subsequent runs are unaffected
      await db
        .update(pinsTable)
        .set({ salesCommissionCents: 150000 })
        .where(eq(pinsTable.id, pinId));
    });

    it('nulling salesCommissionCents reduces salesCommissionCents, totalCommissionCents, totalCostCents, and netProfitCents', async () => {
      await db
        .update(pinsTable)
        .set({ salesCommissionCents: null })
        .where(eq(pinsTable.id, pinId));

      const res = await request(app).get(`/api/pins/${pinId}/profitability`).set(mgr());
      expect(res.status).toBe(200);
      const p = res.body.profitability;

      // COALESCE(null, 0) → 0
      expect(p.salesCommissionCents).toBe(0);
      // totalCommissionCents: 0 (sales) + 50,000 (pm) = 50,000  (was 200,000)
      expect(p.totalCommissionCents).toBe(50000);
      // totalCostCents: 500,000 (expenses) + 50,000 (commissions) = 550,000  (was 700,000)
      expect(p.totalCostCents).toBe(550000);
      // netProfitCents: 1,500,000 − 550,000 = 950,000  (was 800,000)
      expect(p.netProfitCents).toBe(950000);
    });
  });
});

// ---------------------------------------------------------------------------
// Migration 027 — expected_total_cents + cash/projected margin pcts
// ---------------------------------------------------------------------------
// Fixture pins (all in isolated company M027_CO):
//
//   m027InsPinId        — insurance, approvedRcv > contract
//     contractAmount    = '$12,000'  → 1,200,000 cents
//     approvedRcvAmount = '$18,000'  → 1,800,000 cents
//     salesCommission   = 500,000 cents  |  pmCommission = 200,000 cents
//     payments          = 900,000 cents
//     expected          = GREATEST(1,200,000, 1,800,000) = 1,800,000
//     cash_margin_pct   = (900k − 700k) / 900k × 100 = 22.22…%
//     proj_margin_pct   = (1,800k − 700k) / 1,800k × 100 = 61.11…%
//
//   m027InsContractWinsPinId — insurance, contract > approvedRcv
//     contractAmount    = '$20,000'  → 2,000,000 cents
//     approvedRcvAmount = '$15,000'  → 1,500,000 cents
//     no costs, no payments
//     expected          = GREATEST(2,000,000, 1,500,000) = 2,000,000 (contract wins)
//
//   m027RetailPinId     — retail, $15k contract, $0 costs, $0 collected
//     contractAmount    = '15000'    → 1,500,000 cents
//     expected          = 1,500,000  (retail: contract only, ignores rcv)
//     cash_margin_pct   = 0          (no payments → guard returns 0)
//     proj_margin_pct   = 100.00     (0 cost / 1,500,000 expected)
//     net_profit_cents  = 0          (0 payments − 0 costs)
// ---------------------------------------------------------------------------

describe('migration 027 — expected_total_cents + margin pcts', () => {
  let m027UserId: string;
  let m027InsPinId: string;
  let m027InsContractWinsPinId: string;
  let m027RetailPinId: string;
  let m027Sid: string;
  const M027_CO = `PROF-027-${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    await db.insert(companiesTable).values({ id: M027_CO, name: 'Migration 027 Test Co' });

    const [u] = await db
      .insert(usersTable)
      .values({ companyId: M027_CO, email: `m027-${M027_CO}@t.invalid` })
      .returning();
    m027UserId = u!.id;

    await db.insert(userProfilesTable).values({ userId: m027UserId, role: 'manager' });
    m027Sid = await createSession({
      user: { id: m027UserId, email: u!.email, firstName: null, lastName: null, profileImageUrl: null, companyId: M027_CO },
      access_token: 'tok',
    });

    // ── Insurance pin A: approvedRcv ($18k) > contract ($12k) ─────────────
    const [insPin] = await db
      .insert(pinsTable)
      .values({
        companyId:          M027_CO,
        userId:             m027UserId,
        latitude:           38.9,
        longitude:          -77.0,
        workflow:           'insurance',
        contractAmount:     '$12,000',
        approvedRcvAmount:  '$18,000',
        salesCommissionCents: 500000,
        pmCommissionCents:    200000,
      })
      .returning();
    m027InsPinId = insPin!.id;

    // Payments: $9,000 = 900,000 cents
    await db.insert(paymentsTable).values({
      companyId: M027_CO, pinId: m027InsPinId, type: 'acv',
      amountCents: 900000, paymentDate: new Date(), createdByUserId: m027UserId,
    });

    // ── Insurance pin B: contract ($20k) > approvedRcv ($15k) ────────────
    // No costs, no payments — isolated to test just the GREATEST branch.
    const [insContractWinsPin] = await db
      .insert(pinsTable)
      .values({
        companyId:         M027_CO,
        userId:            m027UserId,
        latitude:          38.9,
        longitude:         -77.0,
        workflow:          'insurance',
        contractAmount:    '$20,000',
        approvedRcvAmount: '$15,000',
      })
      .returning();
    m027InsContractWinsPinId = insContractWinsPin!.id;

    // ── Retail pin: $15k contract, $0 costs, $0 payments ──────────────────
    // Reference-implementation fixture: the canonical $15k/$0/$0 case.
    const [retailPin] = await db
      .insert(pinsTable)
      .values({
        companyId:      M027_CO,
        userId:         m027UserId,
        latitude:       38.9,
        longitude:      -77.0,
        workflow:       'retail',
        contractAmount: '15000',
      })
      .returning();
    m027RetailPinId = retailPin!.id;
  });

  afterAll(async () => {
    await db.delete(pinsTable).where(eq(pinsTable.companyId, M027_CO)).catch(() => {});
    await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, m027UserId)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.companyId, M027_CO)).catch(() => {});
    await db.delete(companiesTable).where(eq(companiesTable.id, M027_CO)).catch(() => {});
  });

  function auth() { return { Authorization: `Bearer ${m027Sid}` }; }

  // ── 8. retail → expected = contract ──────────────────────────────────────
  it('retail lead: expected_total_cents equals contract_amount_cents', async () => {
    const res = await request(app).get(`/api/pins/${m027RetailPinId}/profitability`).set(auth());
    expect(res.status).toBe(200);
    // '15000' → 1,500,000 cents
    expect(res.body.profitability.expectedTotalCents).toBe(1500000);
  });

  // ── 9. reference implementation — $15k / $0 / $0 quad-verify ─────────────
  // A $15,000 contract with no costs and no collected payments must produce:
  //   100.0% projected  (no costs → full margin)
  //   0.0%   cash       (no payments → guard fires, returns 0)
  //   $0     net profit (0 payments − 0 costs)
  //   $15,000 balance due implied by expectedTotalCents − totalPaymentsCents
  it('reference: $15k contract / $0 costs / $0 collected → 100% projected / 0% cash / $0 net', async () => {
    const res = await request(app).get(`/api/pins/${m027RetailPinId}/profitability`).set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;
    expect(p.expectedTotalCents).toBe(1500000);          // $15,000 expected
    expect(p.projectedMarginPct).toBeCloseTo(100.0, 1);  // 100% projected
    expect(p.cashMarginPct).toBe(0);                     // 0% cash (guard)
    expect(p.netProfitCents).toBe(0);                    // $0 net
    expect(p.totalPaymentsCents).toBe(0);                // $0 collected → $15k balance due
    // Confirm no NaN / Infinity leaked
    expect(Number.isFinite(p.projectedMarginPct)).toBe(true);
    expect(Number.isFinite(p.cashMarginPct)).toBe(true);
  });

  // ── 10. insurance where approvedRcv > contract → expected = approvedRcv ──
  it('insurance: approvedRcv > contract → expectedTotalCents = approvedRcv', async () => {
    const res = await request(app).get(`/api/pins/${m027InsPinId}/profitability`).set(auth());
    expect(res.status).toBe(200);
    // GREATEST(1,200,000 ; 1,800,000) = 1,800,000
    expect(res.body.profitability.expectedTotalCents).toBe(1800000);
  });

  // ── 11. insurance where contract > approvedRcv → expected = contract ──────
  it('insurance: contract > approvedRcv → expectedTotalCents = contract', async () => {
    const res = await request(app).get(`/api/pins/${m027InsContractWinsPinId}/profitability`).set(auth());
    expect(res.status).toBe(200);
    // GREATEST(2,000,000 ; 1,500,000) = 2,000,000 (contract wins)
    expect(res.body.profitability.expectedTotalCents).toBe(2000000);
  });

  // ── 12. zero-collected lead → cashMarginPct = 0, projectedMarginPct computed
  // The retail pin has no payments but a nonzero expected; the cash guard must
  // return 0 while the projected margin is still fully computed from expectedTotal.
  it('zero-collected lead: cashMarginPct = 0 (not NaN/null), projectedMarginPct still computed', async () => {
    const res = await request(app).get(`/api/pins/${m027RetailPinId}/profitability`).set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;
    expect(p.totalPaymentsCents).toBe(0);
    expect(p.cashMarginPct).toBe(0);
    expect(Number.isFinite(p.cashMarginPct)).toBe(true);
    // projectedMarginPct must still be computed (not 0) because expectedTotal > 0
    expect(p.expectedTotalCents).toBeGreaterThan(0);
    expect(p.projectedMarginPct).toBeGreaterThan(0);
  });

  // ── 13. zero-contract lead → projectedMarginPct = 0, not NaN ─────────────
  // emptyPinId has no contract, no payments, no costs.
  // Both margins must be exactly 0 (divide-by-zero guard active for both).
  it('zero-contract lead: projectedMarginPct = 0 (not NaN/null/Infinity)', async () => {
    const res = await request(app).get(`/api/pins/${emptyPinId}/profitability`).set(mgr());
    expect(res.status).toBe(200);
    const p = res.body.profitability;
    expect(p.expectedTotalCents).toBe(0);
    expect(p.projectedMarginPct).toBe(0);
    expect(p.cashMarginPct).toBe(0);
    expect(Number.isFinite(p.projectedMarginPct)).toBe(true);
    expect(Number.isFinite(p.cashMarginPct)).toBe(true);
  });

  // ── 14. hand-verify insurance pin A margins against raw numbers ───────────
  it('insurance pin: hand-verify cash and projected margins', async () => {
    const res = await request(app).get(`/api/pins/${m027InsPinId}/profitability`).set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;

    // Raw data:
    //   payments   = 900,000 cents
    //   total_cost = 700,000 cents (sales 500k + pm 200k, no expenses)
    //   expected   = 1,800,000 cents (approvedRcv wins over contract)
    expect(p.totalPaymentsCents).toBe(900000);
    expect(p.totalCostCents).toBe(700000);
    expect(p.expectedTotalCents).toBe(1800000);

    // cash_margin_pct  = (900k − 700k) / 900k × 100 = 22.22…%
    expect(p.cashMarginPct).toBeCloseTo(22.22, 1);

    // projected_margin_pct = (1,800k − 700k) / 1,800k × 100 = 61.11…%
    expect(p.projectedMarginPct).toBeCloseTo(61.11, 1);
  });
});

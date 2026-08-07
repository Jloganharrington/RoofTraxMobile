/**
 * Migration 029 — FINANCIALS STEP 5, Step 2
 * Verifies: revisedContractCents, netProjectMarginCents, netProjectMarginPct
 *
 *   15. Worked-example checkpoint:
 *         $15k contract + $3.5k approved CO − $10.5k costs = 43.24% margin
 *   16. Pending CO does NOT move revisedContractCents
 *   17. Voided CO does NOT move revisedContractCents
 *   18. Deductive (negative) CO lowers revisedContractCents
 *   19. Zero revised contract → netProjectMarginPct = 0 (not NaN/Infinity)
 *   20. Insurance: revised > approvedRcv → expectedTotal = revised
 *   21. Insurance: approvedRcv > revised  → expectedTotal = approvedRcv
 */

import {
  changeOrdersTable,
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

const RUN_ID  = Date.now().toString(36).toUpperCase();
const M029_CO = `PROF-029-${RUN_ID}`;

let m029UserId: string;
let m029PinId:  string;
let m029Sid:    string;

beforeAll(async () => {
  await db.insert(companiesTable).values({ id: M029_CO, name: 'Migration 029 Test Co' });

  const [u] = await db
    .insert(usersTable)
    .values({ companyId: M029_CO, email: `m029-${M029_CO}@t.invalid` })
    .returning();
  m029UserId = u!.id;

  await db.insert(userProfilesTable).values({ userId: m029UserId, role: 'manager' });
  m029Sid = await createSession({
    user: {
      id: m029UserId, email: u!.email,
      firstName: null, lastName: null, profileImageUrl: null,
      companyId: M029_CO,
    },
    access_token: 'tok',
  });

  // Base pin: $15k contract, $8k vendor expense, $2.5k sales commission
  const [pin] = await db
    .insert(pinsTable)
    .values({
      companyId:            M029_CO,
      userId:               m029UserId,
      latitude:             38.9,
      longitude:            -77.0,
      workflow:             'retail',
      contractAmount:       '15000',    // _parse_legacy_money_cents → 1,500,000
      salesCommissionCents: 250000,      // $2,500
    })
    .returning();
  m029PinId = pin!.id;

  await db.insert(vendorExpensesTable).values({
    companyId:  M029_CO,
    pinId:      m029PinId,
    vendorName: 'Spec Roofer',
    amountCents: 800000,   // $8,000
    category:   'labor',
    isPaid:     false,
  });

  // Approved CO: $3,500 = 350,000 cents
  await db.insert(changeOrdersTable).values({
    companyId:       M029_CO,
    pinId:           m029PinId,
    status:          'approved',
    voidedAt:        null,
    amountCents:     350000,
    description:     'Spec CO',
    createdByUserId: m029UserId,
  });
});

afterAll(async () => {
  await db.delete(pinsTable).where(eq(pinsTable.companyId, M029_CO)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, m029UserId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.companyId, M029_CO)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, M029_CO)).catch(() => {});
});

function auth() { return { Authorization: `Bearer ${m029Sid}` }; }

// ---------------------------------------------------------------------------
// 15. Worked-example checkpoint
// ---------------------------------------------------------------------------
// $15k base + $3.5k approved CO = $18.5k revised
// $8k expenses + $2.5k commission = $10.5k total cost
// net_margin_cents = 18,500 − 10,500 = $8,000
// net_margin_pct   = 8,000 / 18,500 × 100 = 43.24…%
// ---------------------------------------------------------------------------

describe('step-2 worked-example checkpoint', () => {
  it('$15k + $3.5k CO − $10.5k costs → $8k margin (43.24%)', async () => {
    const res = await request(app)
      .get(`/api/pins/${m029PinId}/profitability`)
      .set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;

    // Revised contract = base + approved CO
    expect(p.approvedCoCents).toBe(350000);
    expect(p.revisedContractCents).toBe(1850000);   // 1,500,000 + 350,000

    // Costs
    expect(p.totalExpenseCents).toBe(800000);
    expect(p.salesCommissionCents).toBe(250000);
    expect(p.totalCostCents).toBe(1050000);          // 800,000 + 250,000

    // Net project margin
    expect(p.netProjectMarginCents).toBe(800000);    // 1,850,000 − 1,050,000
    expect(p.netProjectMarginPct).toBeCloseTo(43.24, 1);

    // projectedMarginPct must be absent from the response (Step 2d)
    expect(p).not.toHaveProperty('projectedMarginPct');

    // All percentage fields must be finite numbers
    expect(Number.isFinite(p.netProjectMarginPct)).toBe(true);
    expect(Number.isFinite(p.cashMarginPct)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16. Pending CO does NOT move revisedContractCents
// ---------------------------------------------------------------------------

describe('pending CO does not affect revisedContractCents', () => {
  it('inserting a pending CO leaves revisedContractCents unchanged', async () => {
    const [pendingCo] = await db
      .insert(changeOrdersTable)
      .values({
        companyId: M029_CO, pinId: m029PinId,
        status: 'pending', voidedAt: null,
        amountCents: 999999,
        description: 'Pending CO — must not count',
        createdByUserId: m029UserId,
      })
      .returning();

    const res = await request(app)
      .get(`/api/pins/${m029PinId}/profitability`)
      .set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;

    // Only the approved CO ($3.5k) should be counted
    expect(p.revisedContractCents).toBe(1850000);
    expect(p.approvedCoCents).toBe(350000);

    await db.delete(changeOrdersTable).where(eq(changeOrdersTable.id, pendingCo!.id));
  });
});

// ---------------------------------------------------------------------------
// 17. Voided (approved + voidedAt) CO does NOT move revisedContractCents
// ---------------------------------------------------------------------------

describe('voided CO does not affect revisedContractCents', () => {
  it('a voided approved CO is excluded from approvedCoCents', async () => {
    const [voidedCo] = await db
      .insert(changeOrdersTable)
      .values({
        companyId: M029_CO, pinId: m029PinId,
        status: 'approved', voidedAt: new Date(),
        amountCents: 999999,
        description: 'Voided CO — must not count',
        createdByUserId: m029UserId,
      })
      .returning();

    const res = await request(app)
      .get(`/api/pins/${m029PinId}/profitability`)
      .set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;

    // Still only the original non-voided approved CO
    expect(p.revisedContractCents).toBe(1850000);
    expect(p.approvedCoCents).toBe(350000);

    await db.delete(changeOrdersTable).where(eq(changeOrdersTable.id, voidedCo!.id));
  });
});

// ---------------------------------------------------------------------------
// 18. Deductive (negative) CO lowers revisedContractCents
// ---------------------------------------------------------------------------

describe('deductive CO lowers revisedContractCents', () => {
  it('−$1k deductive CO: two COs net to +$2.5k, revised = $17.5k', async () => {
    const [negCo] = await db
      .insert(changeOrdersTable)
      .values({
        companyId: M029_CO, pinId: m029PinId,
        status: 'approved', voidedAt: null,
        amountCents: -100000,    // −$1,000
        description: 'Deductive CO',
        createdByUserId: m029UserId,
      })
      .returning();

    const res = await request(app)
      .get(`/api/pins/${m029PinId}/profitability`)
      .set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;

    // Two approved COs: +350,000 + (−100,000) = net +250,000
    expect(p.approvedCoCents).toBe(250000);
    expect(p.revisedContractCents).toBe(1750000);   // 1,500,000 + 250,000
    expect(p.netProjectMarginCents).toBe(700000);   // 1,750,000 − 1,050,000
    expect(p.netProjectMarginPct).toBeCloseTo(40.0, 1);

    await db.delete(changeOrdersTable).where(eq(changeOrdersTable.id, negCo!.id));
  });
});

// ---------------------------------------------------------------------------
// 19. Zero revised contract → netProjectMarginPct = 0 (not NaN/Infinity)
// ---------------------------------------------------------------------------

describe('zero revised contract', () => {
  it('no contract, no COs → netProjectMarginPct = 0 (guard fires)', async () => {
    const [emptyPin] = await db
      .insert(pinsTable)
      .values({
        companyId: M029_CO, userId: m029UserId,
        latitude: 1, longitude: 1, workflow: 'retail',
        // contractAmount deliberately omitted
      })
      .returning();

    const res = await request(app)
      .get(`/api/pins/${emptyPin!.id}/profitability`)
      .set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;

    expect(p.revisedContractCents).toBe(0);
    expect(p.approvedCoCents).toBe(0);
    expect(p.netProjectMarginPct).toBe(0);
    expect(Number.isFinite(p.netProjectMarginPct)).toBe(true);

    await db.delete(pinsTable).where(eq(pinsTable.id, emptyPin!.id));
  });
});

// ---------------------------------------------------------------------------
// 20 & 21. Insurance: expectedTotal uses GREATEST(revised, approvedRcv)
// ---------------------------------------------------------------------------

describe('insurance expectedTotalCents after CO', () => {
  // 20. revised > approvedRcv → expectedTotal = revised
  it('revised_contract > approvedRcv → expectedTotal = revised', async () => {
    // $20k contract + $5k CO = $25k revised; $18k rcv → revised wins
    const [insPin] = await db
      .insert(pinsTable)
      .values({
        companyId: M029_CO, userId: m029UserId,
        latitude: 38.9, longitude: -77.0,
        workflow: 'insurance',
        contractAmount:    '$20,000',
        approvedRcvAmount: '$18,000',
      })
      .returning();

    await db.insert(changeOrdersTable).values({
      companyId: M029_CO, pinId: insPin!.id,
      status: 'approved', voidedAt: null,
      amountCents: 500000,    // +$5,000
      description: 'Big CO',
      createdByUserId: m029UserId,
    });

    const res = await request(app)
      .get(`/api/pins/${insPin!.id}/profitability`)
      .set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;

    // revised = 2,000,000 + 500,000 = 2,500,000 > approvedRcv 1,800,000
    expect(p.revisedContractCents).toBe(2500000);
    expect(p.expectedTotalCents).toBe(2500000);   // revised wins

    await db.delete(pinsTable).where(eq(pinsTable.id, insPin!.id));
  });

  // 21. approvedRcv > revised → expectedTotal = approvedRcv
  it('approvedRcv > revised_contract → expectedTotal = approvedRcv', async () => {
    // $12k contract + $2k CO = $14k revised; $18k rcv → rcv wins
    const [insPin] = await db
      .insert(pinsTable)
      .values({
        companyId: M029_CO, userId: m029UserId,
        latitude: 38.9, longitude: -77.0,
        workflow: 'insurance',
        contractAmount:    '$12,000',
        approvedRcvAmount: '$18,000',
      })
      .returning();

    await db.insert(changeOrdersTable).values({
      companyId: M029_CO, pinId: insPin!.id,
      status: 'approved', voidedAt: null,
      amountCents: 200000,    // +$2,000
      description: 'Small CO',
      createdByUserId: m029UserId,
    });

    const res = await request(app)
      .get(`/api/pins/${insPin!.id}/profitability`)
      .set(auth());
    expect(res.status).toBe(200);
    const p = res.body.profitability;

    // revised = 1,200,000 + 200,000 = 1,400,000 < approvedRcv 1,800,000
    expect(p.revisedContractCents).toBe(1400000);
    expect(p.expectedTotalCents).toBe(1800000);   // approvedRcv wins

    await db.delete(pinsTable).where(eq(pinsTable.id, insPin!.id));
  });
});

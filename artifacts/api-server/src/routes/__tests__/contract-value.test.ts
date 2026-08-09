/**
 * Step 3 — Contract value: dual source of truth
 *
 * pins.contract_amount is a varchar write-back from the signing flow.
 * It is the primary source for legacy display and profitability views; the
 * authoritative cents value lives in contracts.total_contract_cents.
 *
 * Verified:
 *   T1. Signing a contract via the portal writes the formatted amount
 *       ($10,500.00) to pins.contract_amount.
 *   T2. Approving a change order while the contract is signed does NOT alter
 *       pins.contract_amount — COs accumulate separately in
 *       change_orders.amount_cents.
 *   T3. Voiding a signed contract clears pins.contract_amount to '' and
 *       resets betterments_amount_cents to 0.
 *
 * ── Reader inventory (documented here; not tested here) ──────────────────────
 *   • artifacts/api-server/src/routes/financialsExport.ts:92
 *       DB direct — display only ($-prefix); no arithmetic.
 *   • data-migrations/027_profitability_view_margins.sql:69,72
 *       DB direct — _parse_legacy_money_cents → insurance/retail arithmetic.
 *   • data-migrations/029_profitability_view_step5.sql:91
 *       DB direct — base_contract_cents for revised-contract derivation.
 *   • data-migrations/032_insurance_columns.sql:68
 *       DB direct — participates in insurance margin calculations.
 *   • data-migrations/030_change_order_line_items.sql:120,123
 *       DB direct — adds approved CO cents to legacy base.
 *   • artifacts/rooftrax-web/src/pages/leads/LeadProfile.tsx:269,326,355,
 *       2540-2558,2571-2572,2612-2615,3052
 *       API response — display, state sync, string→cents parsing, arithmetic.
 *   • artifacts/api-server/src/routes/inspections.ts:9966,10111
 *       API response builder — contractAmount: null placeholder.
 *
 * ── Write paths (4 total) ────────────────────────────────────────────────────
 *   1. contractPortal.ts sign route (POST /portal/contract/:code/sign)
 *        ← tested T1
 *   2. contracts.ts void route (POST /contracts/:contractId/void)
 *        ← tested T3
 *   3. pins.ts PATCH /pins/:pinId/profile — manual override, not tested here.
 *   4. inspections.ts pin-proxy PATCH — manual override, not tested here.
 */

import {
  changeOrdersTable,
  changeOrderLineItemsTable,
  companiesTable,
  contractsTable,
  contractScopePackagesTable,
  contractSelectionsTable,
  db,
  pinsTable,
  selectionBrandsTable,
  selectionCategoriesTable,
  selectionProductsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app';
import { createSession } from '../../lib/auth';
import { generatePortalAccessCode } from '../../lib/portalAccess';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUN_ID        = Date.now().toString(36).toUpperCase();
const COMPANY_ID    = `CVT-${RUN_ID}`;
const CONTRACT_CENTS = 1_050_000;   // $10,500.00 → '$10,500.00'
const CO_CENTS       =    50_000;   // $500.00

// Deterministic SHA-256 seeded directly on the contract row.
const KNOWN_SHA256 = 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678';

// ---------------------------------------------------------------------------
// Fixtures (populated in beforeAll)
// ---------------------------------------------------------------------------

let managerSid:  string;
let managerId:   string;
let pinId:       string;
let contractId:  string;
let accessCode:  string;
let coId:        string;

const mgr = () => ({ Authorization: `Bearer ${managerSid}` });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Company + manager --------------------------------------------------------
  await db.insert(companiesTable).values({ id: COMPANY_ID, name: 'Contract Value Test Co' });

  const [mgrU] = await db
    .insert(usersTable)
    .values({ companyId: COMPANY_ID, email: `cvt-mgr-${RUN_ID}@t.invalid` })
    .returning();
  managerId = mgrU!.id;

  await db.insert(userProfilesTable).values({ userId: managerId, role: 'manager' });

  managerSid = await createSession({
    user: {
      id: managerId, email: mgrU!.email,
      firstName: null, lastName: null, profileImageUrl: null,
      companyId: COMPANY_ID,
    },
    access_token: 'tok',
  });

  // Pin ---------------------------------------------------------------------
  const [pin] = await db
    .insert(pinsTable)
    .values({ companyId: COMPANY_ID, userId: managerId, latitude: 38.9, longitude: -77.0, workflow: 'retail' })
    .returning();
  pinId = pin!.id;

  // Selection library (FK chain: category → brand → product) ----------------
  const [cat] = await db
    .insert(selectionCategoriesTable)
    .values({ companyId: COMPANY_ID, name: 'Roofing', slug: `roofing-${RUN_ID}` })
    .returning();

  const [brand] = await db
    .insert(selectionBrandsTable)
    .values({ companyId: COMPANY_ID, categoryId: cat!.id, name: 'TestBrand' })
    .returning();

  const [product] = await db
    .insert(selectionProductsTable)
    .values({
      companyId:  COMPANY_ID,
      categoryId: cat!.id,
      brandId:    brand!.id,
      name:       'TestShingle',
      unit:       'sq',
    })
    .returning();

  // Contract in 'sent' status with known SHA-256 and totalContractCents ------
  accessCode = generatePortalAccessCode();
  const [contract] = await db
    .insert(contractsTable)
    .values({
      companyId:          COMPANY_ID,
      pinId:              pin!.id,
      accessCode,
      status:             'sent',
      coveredScopeCents:  CONTRACT_CENTS,
      bettermentsCents:   0,
      deductibleCents:    0,
      totalContractCents: CONTRACT_CENTS,
      documentSha256:     KNOWN_SHA256,
      createdByUserId:    managerId,
    })
    .returning();
  contractId = contract!.id;

  // Scope package + customer selection (required by the signing gate) --------
  const [pkg] = await db
    .insert(contractScopePackagesTable)
    .values({
      companyId:          COMPANY_ID,
      contractId:         contract!.id,
      categoryId:         cat!.id,
      quantity:           '1',
      unit:               'sq',
      coveredAmountCents: CONTRACT_CENTS,
    })
    .returning();

  await db.insert(contractSelectionsTable).values({
    companyId:          COMPANY_ID,
    contractId:         contract!.id,
    scopePackageId:     pkg!.id,
    productId:          product!.id,
    productName:        'TestShingle',
    brandName:          'TestBrand',
    unitDeltaCents:     0,
    quantity:           '1',
    extendedDeltaCents: 0,
    selectedBy:         'customer',
  });

  // Change order seeded as already signed (ready for manager approval) -------
  const [co] = await db
    .insert(changeOrdersTable)
    .values({
      companyId:          COMPANY_ID,
      pinId:              pin!.id,
      createdByUserId:    managerId,
      description:        'Additional skylight',
      amountCents:        CO_CENTS,
      documentObjectPath: 'test/co-stub.pdf',
      homeownerSignedAt:  new Date(),
    })
    .returning();
  coId = co!.id;
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterAll(async () => {
  await db.delete(changeOrderLineItemsTable).where(eq(changeOrderLineItemsTable.companyId, COMPANY_ID));
  await db.delete(changeOrdersTable).where(eq(changeOrdersTable.companyId, COMPANY_ID));
  await db.delete(contractSelectionsTable).where(eq(contractSelectionsTable.companyId, COMPANY_ID));
  await db.delete(contractScopePackagesTable).where(eq(contractScopePackagesTable.companyId, COMPANY_ID));
  await db.delete(contractsTable).where(eq(contractsTable.companyId, COMPANY_ID));
  await db.delete(selectionProductsTable).where(eq(selectionProductsTable.companyId, COMPANY_ID));
  await db.delete(selectionBrandsTable).where(eq(selectionBrandsTable.companyId, COMPANY_ID));
  await db.delete(selectionCategoriesTable).where(eq(selectionCategoriesTable.companyId, COMPANY_ID));
  await db.delete(pinsTable).where(eq(pinsTable.companyId, COMPANY_ID));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, managerId));
  await db.delete(usersTable).where(eq(usersTable.id, managerId));
  await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY_ID));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pins.contract_amount write-back accuracy', () => {
  it('T1 — signing a contract writes the formatted amount to pins.contract_amount', async () => {
    const res = await request(app)
      .post(`/api/portal/contract/${accessCode}/sign`)
      .send({
        documentSha256:        KNOWN_SHA256,
        customerPrintName:     'Jane Homeowner',
        // Provide a pre-stored path so no object-storage upload is attempted.
        customerSignaturePath: 'test/stub-sig.png',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('signed');

    const [pin] = await db
      .select({ contractAmount: pinsTable.contractAmount })
      .from(pinsTable)
      .where(eq(pinsTable.id, pinId));

    // $10,500.00 — confirm the formatted write-back is exact.
    expect(pin!.contractAmount).toBe('$10,500.00');
  });

  it('T2 — approving a CO does not alter pins.contract_amount (COs track separately)', async () => {
    // Approve the change order.
    const res = await request(app)
      .post(`/api/change-orders/${coId}/approve`)
      .set(mgr());

    expect(res.status).toBe(200);
    expect(res.body.changeOrder.status).toBe('approved');

    // CO's own amount_cents must be unchanged.
    const [co] = await db
      .select({ amountCents: changeOrdersTable.amountCents })
      .from(changeOrdersTable)
      .where(eq(changeOrdersTable.id, coId));

    expect(co!.amountCents).toBe(CO_CENTS);

    // pins.contract_amount must be unaffected — CO approval only writes
    // change_orders.status; it never touches pins.contract_amount.
    const [pin] = await db
      .select({ contractAmount: pinsTable.contractAmount })
      .from(pinsTable)
      .where(eq(pinsTable.id, pinId));

    expect(pin!.contractAmount).toBe('$10,500.00');
  });

  it('T3 — voiding a signed contract clears pins.contract_amount to empty string', async () => {
    const res = await request(app)
      .post(`/api/contracts/${contractId}/void`)
      .set(mgr())
      .send({ voidReason: 'Testing write-back clear on void — minimum five chars' });

    expect(res.status).toBe(200);

    const [pin] = await db
      .select({
        contractAmount:         pinsTable.contractAmount,
        bettermentsAmountCents: pinsTable.bettermentsAmountCents,
      })
      .from(pinsTable)
      .where(eq(pinsTable.id, pinId));

    expect(pin!.contractAmount).toBe('');
    expect(pin!.bettermentsAmountCents).toBe(0);
  });
});

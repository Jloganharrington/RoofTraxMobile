import {
  companiesTable,
  db,
  inspectionSlopesTable,
  inspectionsTable,
  priceBookItemsTable,
  priceBookPackageItemsTable,
  priceBookPackagesTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../app';
import { createSession } from '../../lib/auth';
import { buildSubmittedInspection } from '../../lib/brainCourier';
import {
  computeLines,
  computeMeasuredBasis,
  contractorEstimateForPayload,
  formatCents,
  priceBookSnapshotForPayload,
} from '../../lib/estimate';

// Estimate step — waste/total math, route authz (module access, peer-rep
// denial, cross-tenant price-book refs, lock immutability), and the Brain
// payload mapping (§12 contractorEstimate / §13 priceBook shapes).

const RUN_ID = `est-${Date.now().toString(36)}`;
const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

interface SeededUser {
  userId: string;
  sid: string;
}

async function seedUser(
  label: string,
  role: 'field_rep' | 'manager' | 'admin' | 'super_admin',
  department: 'canvasser' | 'inspector_canvasser',
  companyId: string,
): Promise<SeededUser> {
  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `est-${label}-${RUN_ID}@example.test` })
    .returning();
  await db.insert(userProfilesTable).values({ userId: user.id, role, department });
  const sid = await createSession({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      companyId,
    },
    access_token: 'test-access-token',
  });
  return { userId: user.id, sid };
}

const companyA = `TEST-EST-${RUN_ID}-A`.toUpperCase();
const companyB = `TEST-EST-${RUN_ID}-B`.toUpperCase();
let inspectorA: SeededUser;
let peerRepA: SeededUser;
let inspectorB: SeededUser;
let itemA: { id: string };

beforeAll(async () => {
  await db.insert(companiesTable).values([
    { id: companyA, name: `EstCo A ${RUN_ID}` },
    { id: companyB, name: `EstCo B ${RUN_ID}` },
  ]);
  inspectorA = await seedUser('insp-a', 'field_rep', 'inspector_canvasser', companyA);
  peerRepA = await seedUser('peer-a', 'field_rep', 'inspector_canvasser', companyA);
  inspectorB = await seedUser('insp-b', 'field_rep', 'inspector_canvasser', companyB);
  [itemA] = await db
    .insert(priceBookItemsTable)
    .values({
      companyId: companyA,
      name: 'Architectural Shingles',
      description: 'GAF HDZ',
      unit: 'per square',
      unitPrice: 42500,
    })
    .returning();
});

afterAll(async () => {
  await db.delete(inspectionsTable).where(inArray(inspectionsTable.companyId, [companyA, companyB]));
  await db.delete(priceBookItemsTable).where(inArray(priceBookItemsTable.companyId, [companyA, companyB]));
  await db.delete(priceBookPackagesTable).where(inArray(priceBookPackagesTable.companyId, [companyA, companyB]));
  const users = await db.select().from(usersTable).where(inArray(usersTable.companyId, [companyA, companyB]));
  const userIds = users.map((u) => u.id);
  if (userIds.length) {
    await db.delete(userProfilesTable).where(inArray(userProfilesTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyA, companyB]));
});

async function createInspection(sid: string): Promise<string> {
  const res = await request(app).post('/api/inspections').set(auth(sid)).send({});
  expect(res.status).toBe(201);
  return res.body.inspection.id as string;
}

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

describe('estimate math', () => {
  it('computes squares and waste-adjusted squares from slope areas', () => {
    const basis = computeMeasuredBasis({
      slopeAreasSqft: [1200, 800, null, undefined],
      damagedSidingFacetCount: 2,
      wastePercent: 10,
    });
    expect(basis.roofAreaSqft).toBe(2000);
    expect(basis.roofSquares).toBe(20);
    expect(basis.wasteAdjustedSquares).toBe(22);
    expect(basis.damagedSidingFacetCount).toBe(2);
  });

  it('returns null basis when no slope has a measured area', () => {
    const basis = computeMeasuredBasis({
      slopeAreasSqft: [null, undefined],
      damagedSidingFacetCount: 0,
      wastePercent: 10,
    });
    expect(basis.roofAreaSqft).toBeNull();
    expect(basis.roofSquares).toBeNull();
    expect(basis.wasteAdjustedSquares).toBeNull();
  });

  it('rounds fractional waste math to 2 decimals', () => {
    const basis = computeMeasuredBasis({
      slopeAreasSqft: [1234.567],
      damagedSidingFacetCount: 0,
      wastePercent: 15,
    });
    expect(basis.roofAreaSqft).toBe(1234.57);
    expect(basis.roofSquares).toBe(12.35);
    expect(basis.wasteAdjustedSquares).toBe(14.2);
  });

  it('recomputes line totals and subtotal in integer cents', () => {
    const { lines, subtotalCents } = computeLines([
      { priceBookItemId: null, description: 'Shingles', unit: 'per square', quantity: 22, unitPriceCents: 42500, isAdder: false },
      { priceBookItemId: null, description: 'Steep charge', unit: null, quantity: 1.5, unitPriceCents: 9999, isAdder: true },
    ]);
    expect(lines[0].totalCents).toBe(935000);
    expect(lines[1].totalCents).toBe(14999); // round(1.5 * 9999) — never fractional cents
    expect(subtotalCents).toBe(949999);
  });

  it('formats cents as US currency strings', () => {
    expect(formatCents(949999)).toBe('$9,499.99');
    expect(formatCents(0)).toBe('$0.00');
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe('estimate routes', () => {
  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/inspections/whatever/estimate');
    expect(res.status).toBe(401);
  });

  it('returns null before an estimate is saved, then round-trips a save', async () => {
    const inspectionId = await createInspection(inspectorA.sid);
    await db
      .insert(inspectionSlopesTable)
      .values({ inspectionId, companyId: companyA, label: 'F1', areaSqft: 1500 });

    const empty = await request(app)
      .get(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(inspectorA.sid));
    expect(empty.status).toBe(200);
    expect(empty.body.estimate).toBeNull();

    const put = await request(app)
      .put(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(inspectorA.sid))
      .send({
        wastePercent: 10,
        note: 'Steep roof',
        lines: [
          {
            priceBookItemId: itemA.id,
            description: 'Architectural Shingles',
            unit: 'per square',
            quantity: 17,
            unitPriceCents: 42500,
            isAdder: false,
          },
        ],
      });
    expect(put.status).toBe(200);
    // Server-computed money + measured basis (client totals never trusted).
    expect(put.body.estimate.subtotalCents).toBe(722500);
    expect(put.body.estimate.lines[0].totalCents).toBe(722500);
    expect(put.body.estimate.measuredBasis.roofAreaSqft).toBe(1500);
    expect(put.body.estimate.measuredBasis.roofSquares).toBe(15);
    expect(put.body.estimate.measuredBasis.wasteAdjustedSquares).toBe(16.5);
    expect(put.body.estimate.note).toBe('Steep roof');

    const get = await request(app)
      .get(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(inspectorA.sid));
    expect(get.body.estimate.subtotalCents).toBe(722500);
  });

  it('denies a same-company peer rep and a cross-company user', async () => {
    const inspectionId = await createInspection(inspectorA.sid);
    const peer = await request(app)
      .put(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(peerRepA.sid))
      .send({ wastePercent: 10, lines: [] });
    expect(peer.status).toBe(403);

    const cross = await request(app)
      .put(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(inspectorB.sid))
      .send({ wastePercent: 10, lines: [] });
    expect(cross.status).toBe(404); // company-scoped lookup — not even existence leaks
  });

  it('server-snapshots referenced price-book lines — tampered values are overwritten', async () => {
    const inspectionId = await createInspection(inspectorA.sid);
    const res = await request(app)
      .put(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(inspectorA.sid))
      .send({
        wastePercent: 0,
        lines: [
          {
            priceBookItemId: itemA.id,
            description: 'Totally Different Item', // tampered
            unit: 'per lie', // tampered
            quantity: 2,
            unitPriceCents: 1, // tampered — real price is 42500
            isAdder: false,
          },
          {
            priceBookItemId: null, // manual line — client values kept
            description: 'Custom labor',
            unit: null,
            quantity: 1,
            unitPriceCents: 5000,
            isAdder: true,
          },
        ],
      });
    expect(res.status).toBe(200);
    const [ref, manual] = res.body.estimate.lines;
    expect(ref.description).toBe('Architectural Shingles');
    expect(ref.unit).toBe('per square');
    expect(ref.unitPriceCents).toBe(42500);
    expect(ref.totalCents).toBe(85000);
    expect(manual.description).toBe('Custom labor');
    expect(manual.unitPriceCents).toBe(5000);
    expect(res.body.estimate.subtotalCents).toBe(90000);
  });

  it('rejects a cross-tenant price-book item reference', async () => {
    const inspectionId = await createInspection(inspectorB.sid);
    const res = await request(app)
      .put(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(inspectorB.sid))
      .send({
        wastePercent: 0,
        lines: [
          {
            priceBookItemId: itemA.id, // company A's item
            description: 'Laundered',
            unit: null,
            quantity: 1,
            unitPriceCents: 100,
            isAdder: false,
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('rejects writes to a locked inspection with 409', async () => {
    const inspectionId = await createInspection(inspectorA.sid);
    await db
      .update(inspectionsTable)
      .set({ lockedAt: new Date() })
      .where(eq(inspectionsTable.id, inspectionId));
    const res = await request(app)
      .put(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(inspectorA.sid))
      .send({ wastePercent: 10, lines: [] });
    expect(res.status).toBe(409);
  });

  it('rejects invalid payloads', async () => {
    const inspectionId = await createInspection(inspectorA.sid);
    for (const body of [
      { wastePercent: -1, lines: [] },
      { wastePercent: 101, lines: [] },
      { wastePercent: 10, lines: [{ priceBookItemId: null, description: '', unit: null, quantity: 1, unitPriceCents: 0, isAdder: false }] },
      { wastePercent: 10, lines: [{ priceBookItemId: null, description: 'x', unit: null, quantity: 0, unitPriceCents: 0, isAdder: false }] },
      { wastePercent: 10, lines: [{ priceBookItemId: null, description: 'x', unit: null, quantity: 1, unitPriceCents: 10.5, isAdder: false }] },
    ]) {
      const res = await request(app)
        .put(`/api/inspections/${inspectionId}/estimate`)
        .set(auth(inspectorA.sid))
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// Price book read access (field reps price estimates from the book)
// ---------------------------------------------------------------------------

describe('price book read access', () => {
  it('lets a field rep list items and packages, but not write', async () => {
    const items = await request(app).get('/api/price-book/items').set(auth(inspectorA.sid));
    expect(items.status).toBe(200);
    expect(items.body.items.some((i: { id: string }) => i.id === itemA.id)).toBe(true);
    expect(items.body.items.find((i: { id: string }) => i.id === itemA.id).unit).toBe('per square');

    const pkgs = await request(app).get('/api/price-book/packages').set(auth(inspectorA.sid));
    expect(pkgs.status).toBe(200);

    const write = await request(app)
      .post('/api/price-book/items')
      .set(auth(inspectorA.sid))
      .send({ name: 'Nope', unitPrice: 1 });
    expect(write.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Brain payload mapping
// ---------------------------------------------------------------------------

describe('brain payload mapping', () => {
  it('maps an estimate to pre-formatted contractorEstimate strings', () => {
    const payload = contractorEstimateForPayload({
      wastePercent: 10,
      measuredBasis: {
        roofAreaSqft: 2000,
        roofSquares: 20,
        wasteAdjustedSquares: 22,
        damagedSidingFacetCount: 0,
      },
      lines: [
        { priceBookItemId: 'x', description: 'Shingles', unit: 'per square', quantity: 22, unitPriceCents: 42500, totalCents: 935000, isAdder: false },
        { priceBookItemId: null, description: 'Steep charge', unit: null, quantity: 1, unitPriceCents: 15000, totalCents: 15000, isAdder: true },
      ],
      subtotalCents: 950000,
      note: 'Two-story access.',
      updatedAt: new Date().toISOString(),
    });
    expect(payload).toEqual({
      lines: [
        { description: 'Shingles (per square)', quantity: '22', unitPrice: '$425.00', total: '$9,350.00', isAdder: false },
        { description: 'Steep charge', quantity: '1', unitPrice: '$150.00', total: '$150.00', isAdder: true },
      ],
      subtotal: '$9,500.00',
      note: 'Measured roof area 2000 sq ft (20 squares); 10% waste factor applied for 22 billable squares. Two-story access.',
    });
  });

  it('returns null for a missing or empty estimate (back-compat)', () => {
    expect(contractorEstimateForPayload(null)).toBeNull();
    expect(contractorEstimateForPayload(undefined)).toBeNull();
    expect(
      contractorEstimateForPayload({
        wastePercent: 10,
        measuredBasis: { roofAreaSqft: null, roofSquares: null, wasteAdjustedSquares: null, damagedSidingFacetCount: 0 },
        lines: [],
        subtotalCents: 0,
        note: null,
        updatedAt: new Date().toISOString(),
      }),
    ).toBeNull();
  });

  it('maps the price book to package groups plus a standalone catch-all', () => {
    const now = new Date('2026-07-20T00:00:00Z');
    const later = new Date('2026-07-22T00:00:00Z');
    const snapshot = priceBookSnapshotForPayload({
      items: [
        { id: 'i1', name: 'Shingles', description: 'HDZ', unit: 'per square', unitPrice: 42500, updatedAt: now },
        { id: 'i2', name: 'Drip edge', description: null, unit: 'per LF', unitPrice: 350, updatedAt: later },
      ],
      packages: [{ name: 'Roofing Package', itemIds: ['i1'] }],
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.publishedAt).toBe('2026-07-22');
    expect(snapshot!.packages).toEqual([
      { name: 'Roofing Package', items: [{ name: 'Shingles', description: 'HDZ', unit: 'per square', unitPrice: '$425.00' }] },
      { name: 'Additional Line Items', items: [{ name: 'Drip edge', description: null, unit: 'per LF', unitPrice: '$3.50' }] },
    ]);
  });

  it('returns null when the company has no price book', () => {
    expect(priceBookSnapshotForPayload({ items: [], packages: [] })).toBeNull();
  });

  it('includes contractorEstimate and priceBook in the submitted payload end-to-end', async () => {
    const inspectionId = await createInspection(inspectorA.sid);
    await request(app)
      .put(`/api/inspections/${inspectionId}/estimate`)
      .set(auth(inspectorA.sid))
      .send({
        wastePercent: 10,
        lines: [
          { priceBookItemId: itemA.id, description: 'Architectural Shingles', unit: 'per square', quantity: 10, unitPriceCents: 42500, isAdder: false },
        ],
      })
      .expect(200);

    // Package grouping goes through the junction table.
    const [pkg] = await db
      .insert(priceBookPackagesTable)
      .values({ companyId: companyA, name: 'Roofing Package' })
      .returning();
    await db.insert(priceBookPackageItemsTable).values({ packageId: pkg.id, itemId: itemA.id, quantity: 1 });

    const [row] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));
    const payload = await buildSubmittedInspection(row);
    expect(payload.contractorEstimate).not.toBeNull();
    expect(payload.contractorEstimate!.subtotal).toBe('$4,250.00');
    expect(payload.contractorEstimate!.lines[0].description).toBe('Architectural Shingles (per square)');
    expect(payload.priceBook).not.toBeNull();
    expect(payload.priceBook!.packages[0].name).toBe('Roofing Package');
    expect(payload.priceBook!.packages[0].items[0].unitPrice).toBe('$425.00');
  });

  it('omits both (null) for an inspection without an estimate in a company without a price book', async () => {
    const inspectionId = await createInspection(inspectorB.sid);
    const [row] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));
    const payload = await buildSubmittedInspection(row);
    expect(payload.contractorEstimate).toBeNull();
    expect(payload.priceBook).toBeNull();
  });
});

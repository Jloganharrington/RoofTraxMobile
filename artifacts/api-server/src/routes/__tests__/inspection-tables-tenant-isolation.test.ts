import {
  attestationsTable,
  companiesTable,
  damageInstancesTable,
  db,
  inspectionComponentsTable,
  inspectionElevationsTable,
  inspectionInteriorObservationsTable,
  inspectionPenetrationsTable,
  inspectionPhotosTable,
  inspectionProductsTable,
  inspectionSlopesTable,
  inspectionsTable,
  measurementsTable,
  testSquareHitsTable,
  testSquaresTable,
  usersTable,
} from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A3's inspection data model has no routes yet (those ship in A5) — this
// proves the tenant-scoping columns on every new table actually isolate
// data at the DB level, ahead of any route existing to leak them.

const RUN_ID = Date.now().toString(36);

interface SeededCompany {
  companyId: string;
  userId: string;
  inspectionId: string;
  slopeId: string;
  elevationId: string;
  damageId: string;
  testSquareId: string;
  testSquareHitId: string;
  photoId: string;
  measurementId: string;
  attestationId: string;
  componentId: string;
  penetrationId: string;
  productId: string;
  interiorObservationId: string;
}

async function seed(label: 'a' | 'b'): Promise<SeededCompany> {
  const companyId = `TEST-INSP-${RUN_ID}-${label}`.toUpperCase();
  await db.insert(companiesTable).values({ id: companyId, name: `Inspection Co ${label}` });

  const [user] = await db
    .insert(usersTable)
    .values({ companyId, email: `inspector-${label}-${RUN_ID}@example.test` })
    .returning();

  const [inspection] = await db
    .insert(inspectionsTable)
    .values({ companyId, inspectorUserId: user.id })
    .returning();

  const [slope] = await db
    .insert(inspectionSlopesTable)
    .values({ companyId, inspectionId: inspection.id, label: 'Front slope' })
    .returning();

  const [elevation] = await db
    .insert(inspectionElevationsTable)
    .values({ companyId, inspectionId: inspection.id, direction: 'front' })
    .returning();

  const [damage] = await db
    .insert(damageInstancesTable)
    .values({
      companyId,
      inspectionId: inspection.id,
      slopeId: slope.id,
      damageType: 'hail',
    })
    .returning();

  const [testSquare] = await db
    .insert(testSquaresTable)
    .values({ companyId, inspectionId: inspection.id, slopeId: slope.id, label: 'TS-1' })
    .returning();

  const [testSquareHit] = await db
    .insert(testSquareHitsTable)
    .values({ companyId, testSquareId: testSquare.id, hitType: 'hail_strike' })
    .returning();

  const [photo] = await db
    .insert(inspectionPhotosTable)
    .values({
      companyId,
      inspectionId: inspection.id,
      subjectType: 'slope',
      subjectId: slope.id,
      url: `https://example.test/${label}.jpg`,
      sha256: `hash-${label}`,
    })
    .returning();

  const [measurement] = await db
    .insert(measurementsTable)
    .values({
      companyId,
      inspectionId: inspection.id,
      subjectType: 'slope',
      subjectId: slope.id,
      measurementType: 'length',
      value: 12.5,
      unit: 'ft',
    })
    .returning();

  const [attestation] = await db
    .insert(attestationsTable)
    .values({ companyId, inspectionId: inspection.id, userId: user.id, stage: 'S1' })
    .returning();

  const [component] = await db
    .insert(inspectionComponentsTable)
    .values({
      companyId,
      inspectionId: inspection.id,
      slopeId: slope.id,
      componentType: 'drip_edge',
      status: 'present',
    })
    .returning();

  const [penetration] = await db
    .insert(inspectionPenetrationsTable)
    .values({
      companyId,
      inspectionId: inspection.id,
      slopeId: slope.id,
      penetrationType: 'plumbing_vent',
    })
    .returning();

  const [product] = await db
    .insert(inspectionProductsTable)
    .values({
      companyId,
      inspectionId: inspection.id,
      slopeId: slope.id,
      identificationMethod: 'field_identified',
      brand: 'GAF',
    })
    .returning();

  const [interiorObservation] = await db
    .insert(inspectionInteriorObservationsTable)
    .values({
      companyId,
      inspectionId: inspection.id,
      location: 'Kitchen ceiling',
      observationType: 'ceiling_stain',
    })
    .returning();

  return {
    companyId,
    userId: user.id,
    inspectionId: inspection.id,
    slopeId: slope.id,
    elevationId: elevation.id,
    damageId: damage.id,
    testSquareId: testSquare.id,
    testSquareHitId: testSquareHit.id,
    photoId: photo.id,
    measurementId: measurement.id,
    attestationId: attestation.id,
    componentId: component.id,
    penetrationId: penetration.id,
    productId: product.id,
    interiorObservationId: interiorObservation.id,
  };
}

describe('inspection data model tenant isolation', () => {
  let companyA: SeededCompany;
  let companyB: SeededCompany;

  beforeAll(async () => {
    companyA = await seed('a');
    companyB = await seed('b');
  });

  afterAll(async () => {
    // Deleting the inspection cascades to every child table (slopes,
    // elevations, damage instances, test squares/hits, photos,
    // measurements). Attestations reference the user directly (not
    // cascaded), so inspections must go before users.
    await db
      .delete(inspectionsTable)
      .where(inArray(inspectionsTable.id, [companyA.inspectionId, companyB.inspectionId]));
    await db.delete(usersTable).where(inArray(usersTable.id, [companyA.userId, companyB.userId]));
    await db
      .delete(companiesTable)
      .where(inArray(companiesTable.id, [companyA.companyId, companyB.companyId]));
  });

  it('inspections are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.inspectionId);
    expect(ids).not.toContain(companyB.inspectionId);
  });

  it('inspection_slopes are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(inspectionSlopesTable)
      .where(eq(inspectionSlopesTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.slopeId);
    expect(ids).not.toContain(companyB.slopeId);
  });

  it('inspection_elevations are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(inspectionElevationsTable)
      .where(eq(inspectionElevationsTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.elevationId);
    expect(ids).not.toContain(companyB.elevationId);
  });

  it('damage_instances are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(damageInstancesTable)
      .where(eq(damageInstancesTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.damageId);
    expect(ids).not.toContain(companyB.damageId);
  });

  it('test_squares are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(testSquaresTable)
      .where(eq(testSquaresTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.testSquareId);
    expect(ids).not.toContain(companyB.testSquareId);
  });

  it('test_square_hits are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(testSquareHitsTable)
      .where(eq(testSquareHitsTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.testSquareHitId);
    expect(ids).not.toContain(companyB.testSquareHitId);
  });

  it('inspection_photos are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(inspectionPhotosTable)
      .where(eq(inspectionPhotosTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.photoId);
    expect(ids).not.toContain(companyB.photoId);
  });

  it('measurements are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(measurementsTable)
      .where(eq(measurementsTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.measurementId);
    expect(ids).not.toContain(companyB.measurementId);
  });

  it('attestations are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(attestationsTable)
      .where(eq(attestationsTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.attestationId);
    expect(ids).not.toContain(companyB.attestationId);
  });

  it('inspection_components are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(inspectionComponentsTable)
      .where(eq(inspectionComponentsTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.componentId);
    expect(ids).not.toContain(companyB.componentId);
  });

  it('inspection_penetrations are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(inspectionPenetrationsTable)
      .where(eq(inspectionPenetrationsTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.penetrationId);
    expect(ids).not.toContain(companyB.penetrationId);
  });

  it('inspection_products are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(inspectionProductsTable)
      .where(eq(inspectionProductsTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.productId);
    expect(ids).not.toContain(companyB.productId);
  });

  it('inspection_interior_observations are scoped by companyId', async () => {
    const rows = await db
      .select()
      .from(inspectionInteriorObservationsTable)
      .where(eq(inspectionInteriorObservationsTable.companyId, companyA.companyId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(companyA.interiorObservationId);
    expect(ids).not.toContain(companyB.interiorObservationId);
  });
});

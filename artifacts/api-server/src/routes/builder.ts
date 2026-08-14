/**
 * GET /builder/inspections?readiness=true
 *
 * CRM-Bearer-authenticated builder list endpoint.  Returns the same shape as
 * the extended GET /pp/inspections so ProofPackageBuilderPage can use one
 * component for both PP and CRM audiences.
 *
 * Optional ?readiness=true triggers a batch readiness computation (10 queries
 * regardless of N inspections) and inlines the summary fields per row.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  ahjPacksTable,
  attestationsTable,
  claimSectionsTable,
  claimSupplementsTable,
  companiesTable,
  companyJurisdictionPacksTable,
  damageInstancesTable,
  db,
  inspectionPhotosTable,
  inspectionProductsTable,
  inspectionSlopesTable,
  inspectionsTable,
  standardsEntriesTable,
  testSquaresTable,
  usersTable,
} from '@workspace/db';
import { computeReadiness } from '../lib/readiness';
import type { EvaluationResult } from '@workspace/protocol';
import { Router, type Request, type Response } from 'express';

const router = Router();

router.get('/builder/inspections', async (req: Request, res: Response) => {
  const ctx = req.actorCtx;
  if (!ctx) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const companyId = ctx.companyId;
  const wantReadiness = req.query.readiness === 'true';

  const inspections = await db
    .select({
      id: inspectionsTable.id,
      address: inspectionsTable.address,
      insuredName: inspectionsTable.insuredName,
      status: inspectionsTable.status,
      createdAt: inspectionsTable.createdAt,
      lockedAt: inspectionsTable.lockedAt,
      updatedAt: inspectionsTable.updatedAt,
      aiSummary: inspectionsTable.aiSummary,
      compiledReportVersions: inspectionsTable.compiledReportVersions,
      carrierName: inspectionsTable.carrierName,
      claimNumber: inspectionsTable.claimNumber,
      dateOfLoss: inspectionsTable.dateOfLoss,
      pinId: inspectionsTable.pinId,
      // readiness-needed fields
      roofDamageFound: inspectionsTable.roofDamageFound,
      sidingDamageFound: inspectionsTable.sidingDamageFound,
      interiorDamageFound: inspectionsTable.interiorDamageFound,
      estimate: inspectionsTable.estimate,
      rapGateReason: inspectionsTable.rapGateReason,
      temporaryRepairs: inspectionsTable.temporaryRepairs,
      propertyProfile: inspectionsTable.propertyProfile,
      repairabilityAssessment: inspectionsTable.repairabilityAssessment,
      inspectorFirstName: usersTable.firstName,
      inspectorLastName: usersTable.lastName,
      inspectorEmail: usersTable.email,
    })
    .from(inspectionsTable)
    .leftJoin(usersTable, eq(inspectionsTable.inspectorUserId, usersTable.id))
    .where(eq(inspectionsTable.companyId, companyId))
    .orderBy(desc(inspectionsTable.createdAt));

  if (inspections.length === 0) {
    res.json({ inspections: [] });
    return;
  }

  const ids = inspections.map((i) => i.id);

  // Parallel: photo counts + supplement counts
  const [photoCounts, supplementCounts] = await Promise.all([
    db
      .select({
        inspectionId: inspectionPhotosTable.inspectionId,
        count: sql<number>`count(*)::int`,
      })
      .from(inspectionPhotosTable)
      .where(eq(inspectionPhotosTable.companyId, companyId))
      .groupBy(inspectionPhotosTable.inspectionId),
    db
      .select({
        inspectionId: claimSupplementsTable.inspectionId,
        count: sql<number>`count(*)::int`,
      })
      .from(claimSupplementsTable)
      .where(inArray(claimSupplementsTable.inspectionId, ids))
      .groupBy(claimSupplementsTable.inspectionId),
  ]);

  const photoCountMap = new Map(photoCounts.map((p) => [p.inspectionId, p.count]));
  const supplementCountMap = new Map(supplementCounts.map((s) => [s.inspectionId, s.count]));

  // ── Batch readiness (only when ?readiness=true) ────────────────────────────
  type ReadinessSummary = {
    overallPass: boolean;
    can_generate: boolean;
    variant: 'upload_path' | 'field_inspection';
    deficiencyCount: number;
  };
  const readinessMap = new Map<string, ReadinessSummary>();

  if (wantReadiness) {
    const [
      allProducts,
      allAttestations,
      allTestSquares,
      allDamageInstances,
      allSlopes,
      [companyRow],
      ahjPacks,
      legacyPacks,
      allClaimSections,
      standardsEntries,
    ] = await Promise.all([
      db
        .select({
          inspectionId: inspectionProductsTable.inspectionId,
          identificationMethod: inspectionProductsTable.identificationMethod,
          discontinued: inspectionProductsTable.discontinued,
          ordinaryAvailability: inspectionProductsTable.ordinaryAvailability,
        })
        .from(inspectionProductsTable)
        .where(inArray(inspectionProductsTable.inspectionId, ids)),
      db
        .select({ inspectionId: attestationsTable.inspectionId, attestationType: attestationsTable.attestationType })
        .from(attestationsTable)
        .where(inArray(attestationsTable.inspectionId, ids)),
      db
        .select({ inspectionId: testSquaresTable.inspectionId })
        .from(testSquaresTable)
        .where(inArray(testSquaresTable.inspectionId, ids)),
      db
        .select({ inspectionId: damageInstancesTable.inspectionId })
        .from(damageInstancesTable)
        .where(
          and(
            inArray(damageInstancesTable.inspectionId, ids),
            eq(damageInstancesTable.companyId, companyId),
          ),
        ),
      db
        .select({ inspectionId: inspectionSlopesTable.inspectionId, materialType: inspectionSlopesTable.materialType })
        .from(inspectionSlopesTable)
        .where(inArray(inspectionSlopesTable.inspectionId, ids)),
      db
        .select({ contractorLicenses: companiesTable.contractorLicenses, qualificationsText: companiesTable.qualificationsText })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId))
        .limit(1),
      db
        .select({ packType: ahjPacksTable.packType, jurisdiction: ahjPacksTable.jurisdiction, state: ahjPacksTable.state })
        .from(ahjPacksTable)
        .where(eq(ahjPacksTable.companyId, companyId)),
      db
        .select({ state: companyJurisdictionPacksTable.state })
        .from(companyJurisdictionPacksTable)
        .where(eq(companyJurisdictionPacksTable.companyId, companyId)),
      db
        .select({
          inspectionId: claimSectionsTable.inspectionId,
          sectionType: claimSectionsTable.sectionType,
          libraryVersionSnapshot: claimSectionsTable.libraryVersionSnapshot,
        })
        .from(claimSectionsTable)
        .where(
          and(
            inArray(claimSectionsTable.inspectionId, ids),
            isNull(claimSectionsTable.supplementId),
          ),
        ),
      db
        .select({ entryKey: standardsEntriesTable.entryKey, verificationStatus: standardsEntriesTable.verificationStatus })
        .from(standardsEntriesTable)
        .where(eq(standardsEntriesTable.companyId, companyId)),
    ]);

    // Group per-inspection data
    const productsByInspection = new Map<string, typeof allProducts>();
    const attestationsByInspection = new Map<string, typeof allAttestations>();
    const testSquaresByInspection = new Map<string, typeof allTestSquares>();
    const damageCountByInspection = new Map<string, number>();
    const slopesByInspection = new Map<string, typeof allSlopes>();
    const sectionsByInspection = new Map<string, typeof allClaimSections>();

    for (const p of allProducts) { const a = productsByInspection.get(p.inspectionId) ?? []; a.push(p); productsByInspection.set(p.inspectionId, a); }
    for (const a of allAttestations) { const arr = attestationsByInspection.get(a.inspectionId) ?? []; arr.push(a); attestationsByInspection.set(a.inspectionId, arr); }
    for (const t of allTestSquares) { const arr = testSquaresByInspection.get(t.inspectionId) ?? []; arr.push(t); testSquaresByInspection.set(t.inspectionId, arr); }
    for (const d of allDamageInstances) { damageCountByInspection.set(d.inspectionId, (damageCountByInspection.get(d.inspectionId) ?? 0) + 1); }
    for (const s of allSlopes) { const arr = slopesByInspection.get(s.inspectionId) ?? []; arr.push(s); slopesByInspection.set(s.inspectionId, arr); }
    for (const cs of allClaimSections) { const arr = sectionsByInspection.get(cs.inspectionId) ?? []; arr.push(cs); sectionsByInspection.set(cs.inspectionId, arr); }

    for (const insp of inspections) {
      const products = productsByInspection.get(insp.id) ?? [];
      const testSquares = testSquaresByInspection.get(insp.id) ?? [];
      const attestations = attestationsByInspection.get(insp.id) ?? [];
      const slopes = slopesByInspection.get(insp.id) ?? [];
      const claimSections = sectionsByInspection.get(insp.id) ?? [];
      const damageInstancesCount = damageCountByInspection.get(insp.id) ?? 0;

      const evalResult: EvaluationResult = {
        deficiencies: [
          ...(products.length === 0 ? [{
            stage: 'product' as const,
            code: 'NO_PRODUCT_RECORD',
            message: 'No roofing-product identification recorded.',
            resolution: 'capture_in_app' as const,
          }] : []),
          ...(testSquares.length === 0 && insp.roofDamageFound ? [{
            stage: 'test_squares' as const,
            code: 'MISSING_TEST_SQUARE_pp',
            message: 'No test squares found.',
            resolution: 'capture_in_app' as const,
          }] : []),
        ],
        softFlags: [],
      };

      const result = computeReadiness({
        inspectionId: insp.id,
        inspection: {
          ...insp,
          rapGateReason: (insp.rapGateReason as string | null | undefined) ?? null,
          estimate: (insp.estimate as { lines?: Array<{ description?: string; categoryCode?: string }> } | null),
          temporaryRepairs: (insp.temporaryRepairs as { performed?: boolean; openings?: boolean } | null),
          propertyProfile: (insp.propertyProfile as { structureType?: string; garageAttached?: boolean } | null),
          interiorDamageFound: insp.interiorDamageFound,
        },
        products: products.map((p) => ({
          identificationMethod: p.identificationMethod,
          discontinued: p.discontinued ?? null,
          ordinaryAvailability: p.ordinaryAvailability ?? null,
        })),
        slopes,
        attestations: attestations.map((a) => ({ attestationType: a.attestationType ?? null })),
        evaluationResult: evalResult,
        damageInstancesCount,
        company: {
          contractorLicenses: companyRow?.contractorLicenses ?? null,
          qualificationsText: companyRow?.qualificationsText ?? null,
        },
        ahjPacks,
        legacyJurisdictionStates: legacyPacks.map((p) => p.state),
        claimSections: claimSections.map((s) => ({
          sectionType: s.sectionType,
          libraryVersionSnapshot:
            (s.libraryVersionSnapshot as { standardsEntryKeys?: string[] } | null) ?? null,
        })),
        standardsEntries: standardsEntries.map((e) => ({
          entryKey: e.entryKey,
          verificationStatus: e.verificationStatus,
        })),
      });

      const failedItems = result.items.filter((item) => item.state !== 'pass');
      // Inspections with pinId were created via the mobile app (field inspection).
      // Inspections without pinId were created via the upload-path PP flow.
      const variant: 'upload_path' | 'field_inspection' =
        insp.pinId ? 'field_inspection' : 'upload_path';

      readinessMap.set(insp.id, {
        overallPass: result.overallPass,
        can_generate: result.overallPass,
        variant,
        deficiencyCount: failedItems.length,
      });
    }
  }

  const rows = inspections.map((insp) => {
    const versions = Array.isArray(insp.compiledReportVersions) ? insp.compiledReportVersions : [];
    const inspectorName =
      [insp.inspectorFirstName, insp.inspectorLastName].filter(Boolean).join(' ') ||
      insp.inspectorEmail ||
      null;
    const base = {
      id: insp.id,
      address: insp.address,
      insuredName: insp.insuredName,
      carrierName: insp.carrierName,
      claimNumber: insp.claimNumber,
      dateOfLoss: insp.dateOfLoss,
      status: insp.status,
      lastTouchedAt: (insp.updatedAt ?? insp.lockedAt ?? insp.createdAt).toISOString(),
      inspectorName,
      photoCount: photoCountMap.get(insp.id) ?? 0,
      supplementCount: supplementCountMap.get(insp.id) ?? 0,
      ready: insp.lockedAt !== null && insp.aiSummary !== null,
      compiledVersionCount: versions.length,
      /** Lead ID — present for mobile-created inspections so the frontend can link to the lead profile. */
      leadId: insp.pinId ?? null,
    };
    if (wantReadiness) {
      const rs = readinessMap.get(insp.id);
      return {
        ...base,
        overallPass: rs?.overallPass ?? false,
        can_generate: rs?.can_generate ?? false,
        variant: rs?.variant ?? ('field_inspection' as const),
        deficiencyCount: rs?.deficiencyCount ?? 0,
      };
    }
    return base;
  });

  res.json({ inspections: rows });
});

export default router;

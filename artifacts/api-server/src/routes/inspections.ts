import {
  CreateAttestationBody,
  CreateAttestationResponse,
  CreateDamageInstanceBody,
  CreateDamageInstanceResponse,
  CreateInspectionBody,
  CreateInspectionElevationBody,
  CreateInspectionElevationResponse,
  CreateInspectionPhotoBody,
  CreateInspectionPhotoResponse,
  CreateInspectionResponse,
  CreateInspectionSlopeBody,
  CreateInspectionSlopeResponse,
  CreateMeasurementBody,
  CreateMeasurementResponse,
  CreateTestSquareBody,
  CreateTestSquareHitBody,
  CreateTestSquareHitResponse,
  CreateTestSquareResponse,
  GetInspectionResponse,
  ListInspectionsResponse,
  UpdateInspectionBody,
  UpdateInspectionResponse,
} from '@workspace/api-zod';
import {
  attestationsTable,
  damageInstancesTable,
  db,
  inspectionElevationsTable,
  inspectionPhotosTable,
  inspectionSlopesTable,
  inspectionsTable,
  testSquareHitsTable,
  testSquaresTable,
  measurementsTable,
  userProfilesTable,
} from '@workspace/db';
import { and, desc, eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { canAccessInspectionModule } from '../lib/permissions';

const router: IRouter = Router();

// This entire module is thin CRUD by design (per Phase M-A's isolation
// boundary): validate the payload, stamp the tenant, store it. No
// squares/waste/pricing/scoring/derived logic lives here — that belongs to
// lib/protocol and later phases.

async function requireInspectionModuleAccess(req: Request, res: Response) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = profile?.role ?? 'field_rep';
  const department = profile?.department ?? 'canvasser';
  if (!canAccessInspectionModule(role, department)) {
    res.status(403).json({ error: 'Inspection module not enabled for this user' });
    return null;
  }

  return { role, department, companyId: req.user.companyId, userId: req.user.id };
}

async function loadInspectionInCompany(inspectionId: string, companyId: string) {
  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)));
  return inspection;
}

router.get('/inspections', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const rows = await db
    .select()
    .from(inspectionsTable)
    .where(eq(inspectionsTable.companyId, actor.companyId))
    .orderBy(desc(inspectionsTable.createdAt));

  res.json(ListInspectionsResponse.parse({ inspections: rows }));
});

router.post('/inspections', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const parsed = CreateInspectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid inspection payload' });
    return;
  }

  const [inspection] = await db
    .insert(inspectionsTable)
    .values({
      companyId: actor.companyId,
      inspectorUserId: parsed.data.inspectorUserId ?? actor.userId,
      pinId: parsed.data.pinId ?? undefined,
      claimNumber: parsed.data.claimNumber ?? undefined,
      policyNumber: parsed.data.policyNumber ?? undefined,
      carrierName: parsed.data.carrierName ?? undefined,
      insuredName: parsed.data.insuredName ?? undefined,
      address: parsed.data.address ?? undefined,
      latitude: parsed.data.latitude ?? undefined,
      longitude: parsed.data.longitude ?? undefined,
      notes: parsed.data.notes ?? undefined,
    })
    .returning();

  res.status(201).json(CreateInspectionResponse.parse({ inspection }));
});

router.get('/inspections/:inspectionId', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  res.json(GetInspectionResponse.parse({ inspection }));
});

router.patch('/inspections/:inspectionId', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const parsed = UpdateInspectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid inspection payload' });
    return;
  }

  const [updated] = await db
    .update(inspectionsTable)
    .set({
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.claimNumber !== undefined && { claimNumber: parsed.data.claimNumber }),
      ...(parsed.data.policyNumber !== undefined && { policyNumber: parsed.data.policyNumber }),
      ...(parsed.data.carrierName !== undefined && { carrierName: parsed.data.carrierName }),
      ...(parsed.data.insuredName !== undefined && { insuredName: parsed.data.insuredName }),
      ...(parsed.data.address !== undefined && { address: parsed.data.address }),
      ...(parsed.data.latitude !== undefined && { latitude: parsed.data.latitude }),
      ...(parsed.data.longitude !== undefined && { longitude: parsed.data.longitude }),
      ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
    })
    .where(eq(inspectionsTable.id, inspectionId))
    .returning();

  res.json(UpdateInspectionResponse.parse({ inspection: updated }));
});

router.post('/inspections/:inspectionId/slopes', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const parsed = CreateInspectionSlopeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid slope payload' });
    return;
  }

  const [slope] = await db
    .insert(inspectionSlopesTable)
    .values({
      companyId: actor.companyId,
      inspectionId,
      label: parsed.data.label,
      pitchRise: parsed.data.pitchRise ?? undefined,
      pitchRun: parsed.data.pitchRun ?? undefined,
      materialType: parsed.data.materialType ?? undefined,
      notes: parsed.data.notes ?? undefined,
    })
    .returning();

  res.status(201).json(CreateInspectionSlopeResponse.parse({ slope }));
});

router.post('/inspections/:inspectionId/elevations', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const parsed = CreateInspectionElevationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid elevation payload' });
    return;
  }

  const [elevation] = await db
    .insert(inspectionElevationsTable)
    .values({
      companyId: actor.companyId,
      inspectionId,
      direction: parsed.data.direction,
      notes: parsed.data.notes ?? undefined,
    })
    .returning();

  res.status(201).json(CreateInspectionElevationResponse.parse({ elevation }));
});

router.post('/inspections/:inspectionId/damage-instances', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const parsed = CreateDamageInstanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid damage instance payload' });
    return;
  }

  const [damageInstance] = await db
    .insert(damageInstancesTable)
    .values({
      companyId: actor.companyId,
      inspectionId,
      slopeId: parsed.data.slopeId ?? undefined,
      elevationId: parsed.data.elevationId ?? undefined,
      damageType: parsed.data.damageType,
      severity: parsed.data.severity ?? undefined,
      causationNote: parsed.data.causationNote ?? undefined,
      notes: parsed.data.notes ?? undefined,
    })
    .returning();

  res.status(201).json(CreateDamageInstanceResponse.parse({ damageInstance }));
});

router.post('/inspections/:inspectionId/test-squares', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const parsed = CreateTestSquareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid test square payload' });
    return;
  }

  const [testSquare] = await db
    .insert(testSquaresTable)
    .values({
      companyId: actor.companyId,
      inspectionId,
      slopeId: parsed.data.slopeId ?? undefined,
      label: parsed.data.label,
      sizeSqFt: parsed.data.sizeSqFt ?? undefined,
      notes: parsed.data.notes ?? undefined,
    })
    .returning();

  res.status(201).json(CreateTestSquareResponse.parse({ testSquare }));
});

router.post(
  '/inspections/:inspectionId/test-squares/:testSquareId/hits',
  async (req: Request, res: Response) => {
    const actor = await requireInspectionModuleAccess(req, res);
    if (!actor) return;

    const inspectionId = req.params.inspectionId as string;
    const testSquareId = req.params.testSquareId as string;
    const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
    if (!inspection) {
      res.status(404).json({ error: 'Inspection not found' });
      return;
    }

    const [testSquare] = await db
      .select()
      .from(testSquaresTable)
      .where(
        and(
          eq(testSquaresTable.id, testSquareId),
          eq(testSquaresTable.inspectionId, inspectionId),
          eq(testSquaresTable.companyId, actor.companyId),
        ),
      );
    if (!testSquare) {
      res.status(404).json({ error: 'Test square not found' });
      return;
    }

    const parsed = CreateTestSquareHitBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid hit payload' });
      return;
    }

    const [hit] = await db
      .insert(testSquareHitsTable)
      .values({
        companyId: actor.companyId,
        testSquareId,
        hitType: parsed.data.hitType ?? undefined,
        notes: parsed.data.notes ?? undefined,
      })
      .returning();

    res.status(201).json(CreateTestSquareHitResponse.parse({ hit }));
  },
);

router.post('/inspections/:inspectionId/photos', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const parsed = CreateInspectionPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid photo payload' });
    return;
  }

  const [photo] = await db
    .insert(inspectionPhotosTable)
    .values({
      companyId: actor.companyId,
      inspectionId,
      stage: parsed.data.stage ?? undefined,
      subjectType: parsed.data.subjectType,
      subjectId: parsed.data.subjectId ?? undefined,
      triadRole: parsed.data.triadRole ?? undefined,
      url: parsed.data.url,
      sha256: parsed.data.sha256,
      exifJson: parsed.data.exifJson ?? undefined,
      overlayJson: parsed.data.overlayJson ?? undefined,
      capturedAtUtc: parsed.data.capturedAtUtc ?? undefined,
      latitude: parsed.data.latitude ?? undefined,
      longitude: parsed.data.longitude ?? undefined,
    })
    .returning();

  res.status(201).json(CreateInspectionPhotoResponse.parse({ photo }));
});

router.post('/inspections/:inspectionId/measurements', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const parsed = CreateMeasurementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid measurement payload' });
    return;
  }

  const [measurement] = await db
    .insert(measurementsTable)
    .values({
      companyId: actor.companyId,
      inspectionId,
      subjectType: parsed.data.subjectType,
      subjectId: parsed.data.subjectId ?? undefined,
      measurementType: parsed.data.measurementType,
      value: parsed.data.value,
      unit: parsed.data.unit ?? undefined,
    })
    .returning();

  res.status(201).json(CreateMeasurementResponse.parse({ measurement }));
});

router.post('/inspections/:inspectionId/attestations', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const parsed = CreateAttestationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid attestation payload' });
    return;
  }

  const [attestation] = await db
    .insert(attestationsTable)
    .values({
      companyId: actor.companyId,
      inspectionId,
      userId: actor.userId,
      stage: parsed.data.stage ?? undefined,
      signatureData: parsed.data.signatureData ?? undefined,
    })
    .returning();

  res.status(201).json(CreateAttestationResponse.parse({ attestation }));
});

export default router;

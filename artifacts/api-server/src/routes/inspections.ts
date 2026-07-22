import {
  CreateAttestationBody,
  CreateAttestationResponse,
  CreateDamageInstanceBody,
  CreateDamageInstanceResponse,
  CreateInspectionBody,
  CreateInspectionComponentBody,
  CreateInspectionComponentResponse,
  CreateInspectionElevationBody,
  CreateInspectionElevationResponse,
  CreateInspectionPenetrationBody,
  CreateInspectionPenetrationResponse,
  CreateInspectionPhotoBody,
  CreateInspectionPhotoResponse,
  CreateInspectionProductBody,
  CreateInspectionProductResponse,
  CreateInspectionResponse,
  CreateInspectionSidingFacetBody,
  CreateInspectionSidingFacetResponse,
  CreateInspectionSlopeBody,
  CreateInspectionSlopeResponse,
  UpdateInspectionSidingFacetBody,
  UpdateInspectionSidingFacetResponse,
  UpdateInspectionComponentBody,
  UpdateInspectionComponentResponse,
  UpdateInspectionSlopeBody,
  UpdateInspectionSlopeResponse,
  CreateInteriorObservationBody,
  CreateInteriorObservationResponse,
  CreateMeasurementBody,
  CreateMeasurementResponse,
  SubmitInspectionBody,
  SubmitInspectionResponse,
  CreateTestSquareBody,
  CreateTestSquareHitBody,
  CreateTestSquareHitResponse,
  CreateTestSquareResponse,
  GetInspectionResponse,
  GetInspectionStatusResponse,
  ListInspectionsResponse,
  ListScheduledInspectionsResponse,
  PreflightInspectionResponse,
  CreateInspectionAddendumBody,
  CreateInspectionAddendumResponse,
  UpdateInspectionBody,
  UpdateInspectionResponse,
  EmailInspectionReportBody,
} from '@workspace/api-zod';
import nodemailer from 'nodemailer';
import {
  attestationsTable,
  damageInstancesTable,
  db,
  inspectionAddendaTable,
  inspectionComponentsTable,
  inspectionElevationsTable,
  inspectionInteriorObservationsTable,
  inspectionPenetrationsTable,
  inspectionPhotosTable,
  inspectionProductsTable,
  inspectionSidingFacetsTable,
  inspectionSlopesTable,
  inspectionsTable,
  pinsTable,
  signedAgreementsTable,
  testSquareHitsTable,
  testSquaresTable,
  measurementsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import type { Role, RepairabilityAssessment } from '@workspace/db';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { canAccessInspectionModule, canWriteInspection, isManagerOrAdmin } from '../lib/permissions';
import { ObjectNotFoundError, ObjectStorageService } from '../lib/objectStorage';

const objectStorageService = new ObjectStorageService();
import {
  buildServerProtocolState,
  evaluateServerInspection,
  type HydratedInspectionChildren,
} from '../lib/inspectionProtocolState';
import { getCompanyCrmConfig } from '../lib/crm';
import {
  deliverInspectionToBrain,
  getBrainConfig,
  machineTokenForCompany,
} from '../lib/brainCourier';
import { decryptSmtpPassword } from '../lib/smtpCrypto';
import { resolvePublicSmtpAddress } from '../lib/smtpGuard';

const router: IRouter = Router();

// Order-independent JSON comparison. A zod-parsed request body and a jsonb
// value read back from Postgres can serialize their keys in different orders,
// so a raw JSON.stringify comparison of two structurally-equal objects can
// wrongly differ. Recursively sorting object keys makes equality stable.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

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

// Loads an inspection scoped to the actor's company, then enforces the C0
// write gate: only the assigned inspector, or a manager and above, may mutate
// it. A same-company peer field rep is denied even though they can reach the
// module. Sends the 404/403 response and returns null when the caller should
// stop; otherwise returns the inspection.
async function loadWritableInspection(
  inspectionId: string,
  actor: { role: Role; userId: string; companyId: string },
  res: Response,
  opts: { allowLocked?: boolean } = {},
) {
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return null;
  }
  if (!canWriteInspection(actor.role, actor.userId, inspection.inspectorUserId)) {
    res.status(403).json({ error: 'Not authorized to modify this inspection' });
    return null;
  }
  // M-F (F2) — Immutability. Once an inspection is locked at submission, its
  // captured records are frozen; every child-write route refuses further
  // edits. A correction must be filed as an addendum instead (the addenda route
  // opts into allowLocked). The submission route also opts in so it can replay
  // idempotently against an already-locked record.
  if (inspection.lockedAt && !opts.allowLocked) {
    res.status(409).json({
      error: 'Inspection is locked; corrections must be filed as an addendum',
    });
    return null;
  }
  return inspection;
}

// Loads every child collection for an inspection, scoped to the company. Shared
// by the detail GET, the pre-flight gate re-run (F1), the submission hardening
// (F2), and the status receipt (F3) so they all see an identical hydration.
// REPORT_DATA v2 — photos[].captureContext, derived (never stored) from the
// role tags the app already records. Forensic path: triadRole
// wide→overview, mid→mid-range, close→close-up, measurement/collateral pass
// through. Phase 1 path: preliminaryRole front_of_home/roof_overview are
// overviews, every damage close-up variant is close-up.
function photoCaptureContext(photo: {
  triadRole: string | null;
  preliminaryRole: string | null;
}): 'overview' | 'mid-range' | 'close-up' | 'measurement' | 'collateral' | null {
  switch (photo.triadRole) {
    case 'wide':
      return 'overview';
    case 'mid':
      return 'mid-range';
    case 'close':
      return 'close-up';
    case 'measurement':
      return 'measurement';
    case 'collateral':
      return 'collateral';
  }
  switch (photo.preliminaryRole) {
    case 'front_of_home':
    case 'roof_overview':
      return 'overview';
    case 'damage_closeup':
    case 'damage_closeup_roof':
    case 'damage_closeup_siding':
    case 'damage_closeup_collateral':
    case 'damage_closeup_interior':
      return 'close-up';
  }
  return null;
}

async function hydrateInspectionChildren(
  inspectionId: string,
  companyId: string,
): Promise<
  Omit<
    HydratedInspectionChildren,
    'arrivalConditions' | 'damageFlags' | 'sidingMeasurementReportRef'
  > & { testSquareHits: typeof testSquareHitsTable.$inferSelect[] }
> {
  const [
    slopes,
    sidingFacets,
    elevations,
    damageInstances,
    photos,
    components,
    penetrations,
    products,
    testSquares,
    attestations,
    interiorObservations,
    measurements,
  ] = await Promise.all([
    db
      .select()
      .from(inspectionSlopesTable)
      .where(
        and(
          eq(inspectionSlopesTable.inspectionId, inspectionId),
          eq(inspectionSlopesTable.companyId, companyId),
        ),
      )
      .orderBy(inspectionSlopesTable.createdAt),
    db
      .select()
      .from(inspectionSidingFacetsTable)
      .where(
        and(
          eq(inspectionSidingFacetsTable.inspectionId, inspectionId),
          eq(inspectionSidingFacetsTable.companyId, companyId),
        ),
      )
      .orderBy(inspectionSidingFacetsTable.createdAt),
    db
      .select()
      .from(inspectionElevationsTable)
      .where(
        and(
          eq(inspectionElevationsTable.inspectionId, inspectionId),
          eq(inspectionElevationsTable.companyId, companyId),
        ),
      )
      .orderBy(inspectionElevationsTable.createdAt),
    db
      .select()
      .from(damageInstancesTable)
      .where(
        and(
          eq(damageInstancesTable.inspectionId, inspectionId),
          eq(damageInstancesTable.companyId, companyId),
        ),
      )
      .orderBy(damageInstancesTable.createdAt),
    db
      .select()
      .from(inspectionPhotosTable)
      .where(
        and(
          eq(inspectionPhotosTable.inspectionId, inspectionId),
          eq(inspectionPhotosTable.companyId, companyId),
        ),
      )
      .orderBy(inspectionPhotosTable.createdAt),
    db
      .select()
      .from(inspectionComponentsTable)
      .where(
        and(
          eq(inspectionComponentsTable.inspectionId, inspectionId),
          eq(inspectionComponentsTable.companyId, companyId),
        ),
      )
      .orderBy(inspectionComponentsTable.createdAt),
    db
      .select()
      .from(inspectionPenetrationsTable)
      .where(
        and(
          eq(inspectionPenetrationsTable.inspectionId, inspectionId),
          eq(inspectionPenetrationsTable.companyId, companyId),
        ),
      )
      .orderBy(inspectionPenetrationsTable.createdAt),
    db
      .select()
      .from(inspectionProductsTable)
      .where(
        and(
          eq(inspectionProductsTable.inspectionId, inspectionId),
          eq(inspectionProductsTable.companyId, companyId),
        ),
      )
      .orderBy(inspectionProductsTable.createdAt),
    db
      .select()
      .from(testSquaresTable)
      .where(
        and(
          eq(testSquaresTable.inspectionId, inspectionId),
          eq(testSquaresTable.companyId, companyId),
        ),
      )
      .orderBy(testSquaresTable.createdAt),
    db
      .select()
      .from(attestationsTable)
      .where(
        and(
          eq(attestationsTable.inspectionId, inspectionId),
          eq(attestationsTable.companyId, companyId),
        ),
      )
      .orderBy(attestationsTable.attestedAt),
    db
      .select()
      .from(inspectionInteriorObservationsTable)
      .where(
        and(
          eq(inspectionInteriorObservationsTable.inspectionId, inspectionId),
          eq(inspectionInteriorObservationsTable.companyId, companyId),
        ),
      )
      .orderBy(inspectionInteriorObservationsTable.createdAt),
    db
      .select()
      .from(measurementsTable)
      .where(
        and(
          eq(measurementsTable.inspectionId, inspectionId),
          eq(measurementsTable.companyId, companyId),
        ),
      )
      .orderBy(measurementsTable.createdAt),
  ]);

  // Test-square hits hang off the square, not the inspection. Fetch them scoped
  // to this inspection's squares (and company) so the client can group by
  // testSquareId for the live hit counter.
  const squareIds = testSquares.map((square) => square.id);
  const testSquareHits = squareIds.length
    ? await db
        .select()
        .from(testSquareHitsTable)
        .where(
          and(
            inArray(testSquareHitsTable.testSquareId, squareIds),
            eq(testSquareHitsTable.companyId, companyId),
          ),
        )
        .orderBy(testSquareHitsTable.createdAt)
    : [];

  return {
    slopes,
    sidingFacets,
    elevations,
    damageInstances,
    photos: photos.map((photo) => ({ ...photo, captureContext: photoCaptureContext(photo) })),
    components,
    penetrations,
    products,
    testSquares,
    testSquareHits,
    attestations,
    interiorObservations,
    measurements,
  };
}

router.get('/inspections', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  // "My inspections": scoped to the acting inspector (within their company),
  // matching the mobile list's semantics. Team-wide visibility is surfaced
  // through the role-scoped dashboard stats, not this raw list.
  const rows = await db
    .select()
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, actor.companyId),
        eq(inspectionsTable.inspectorUserId, actor.userId),
      ),
    )
    .orderBy(desc(inspectionsTable.createdAt));

  // One row with legacy-shaped jsonb (e.g. an arrivalConditions written by an
  // older client) must not 500 the entire list — the list only needs identity
  // and status fields, so blank out any nested jsonb blob that no longer
  // matches its current schema instead of failing the response.
  const safeRows = rows.map((row) => {
    const parsed = ListInspectionsResponse.shape.inspections.element.safeParse(row);
    if (parsed.success) return row;
    return {
      ...row,
      arrivalConditions: null,
      homeownerFacts: null,
      stormConfirmedRef: null,
      submissionManifest: null,
    };
  });

  res.json(ListInspectionsResponse.parse({ inspections: safeRows }));
});

// When an inspection is started without a canvassing pin, drop one so the
// property shows on the team map. If a company pin already exists at that spot
// (same non-empty address, case-insensitive, or within ~10m), link to it
// instead of duplicating. Runs only for a genuinely NEW inspection row —
// idempotent offline replays hit the conflict path and never get here, so a
// replay can't double-drop. Returns the pin id to store on the inspection, or
// null when there are no coordinates to pin.
async function ensurePinForInspection(inspection: {
  companyId: string;
  inspectorUserId: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}): Promise<string | null> {
  const { latitude, longitude } = inspection;
  if (latitude == null || longitude == null) return null;

  const address = inspection.address?.trim();
  const nearby = sql`abs(${pinsTable.latitude} - ${latitude}) < 0.0001 and abs(${pinsTable.longitude} - ${longitude}) < 0.0001`;
  const [existing] = await db
    .select({ id: pinsTable.id })
    .from(pinsTable)
    .where(
      and(
        eq(pinsTable.companyId, inspection.companyId),
        address ? sql`(lower(${pinsTable.address}) = lower(${address}) or (${nearby}))` : nearby,
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  // Note: the pin's damageType vocabulary (roof/siding) differs from the
  // inspection's Phase 1 vocabulary (hail/wind), so it is left unset here.
  const [pin] = await db
    .insert(pinsTable)
    .values({
      userId: inspection.inspectorUserId,
      companyId: inspection.companyId,
      latitude,
      longitude,
      address: address || null,
      workflow: 'insurance',
    })
    .returning({ id: pinsTable.id });
  return pin?.id ?? null;
}

// Applies ensurePinForInspection to a freshly-inserted inspection row and
// stores the link. Best-effort: a pin failure must never fail the inspection
// create itself (the pin is map convenience, not part of the record's truth).
type InspectionRow = typeof inspectionsTable.$inferSelect;
async function attachAutoPin(inspection: InspectionRow): Promise<InspectionRow> {
  if (inspection.pinId) return inspection;
  try {
    const pinId = await ensurePinForInspection(inspection);
    if (!pinId) return inspection;
    const [updated] = await db
      .update(inspectionsTable)
      .set({ pinId })
      .where(eq(inspectionsTable.id, inspection.id))
      .returning();
    return updated ?? inspection;
  } catch (err) {
    console.warn('[inspections] auto-pin failed', err);
    return inspection;
  }
}

router.post('/inspections', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const parsed = CreateInspectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid inspection payload' });
    return;
  }

  // Ownership-assignment policy (C0): a field rep may only create an
  // inspection owned by themselves. Assigning ownership to someone else is a
  // managerial action, and the assignee must be a user in the actor's company
  // — this prevents ownership spoofing and cross-tenant/orphaned assignment.
  const requestedOwnerId = parsed.data.inspectorUserId ?? actor.userId;
  if (requestedOwnerId !== actor.userId) {
    if (!isManagerOrAdmin(actor.role)) {
      res
        .status(403)
        .json({ error: 'Only a manager or above can assign an inspection to another user' });
      return;
    }
    const [assignee] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, requestedOwnerId), eq(usersTable.companyId, actor.companyId)));
    if (!assignee) {
      res.status(400).json({ error: 'Assigned inspector must be a user in your company' });
      return;
    }
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectorUserId: requestedOwnerId,
    status: parsed.data.status ?? undefined,
    // P0/P2 — a new record may open as a light `preliminary` (Phase 1) or, by
    // default, straight into the unchanged `forensic` model. `damageType` is
    // the Phase 1 light damage classification.
    phase: parsed.data.phase ?? undefined,
    damageType: parsed.data.damageType ?? undefined,
    pinId: parsed.data.pinId ?? undefined,
    claimNumber: parsed.data.claimNumber ?? undefined,
    policyNumber: parsed.data.policyNumber ?? undefined,
    carrierName: parsed.data.carrierName ?? undefined,
    insuredName: parsed.data.insuredName ?? undefined,
    address: parsed.data.address ?? undefined,
    latitude: parsed.data.latitude ?? undefined,
    longitude: parsed.data.longitude ?? undefined,
    notes: parsed.data.notes ?? undefined,
    dateOfLoss: parsed.data.dateOfLoss ?? undefined,
    // Phase 1 damage surfaces — determined at preliminary intake so they can
    // drive measurement-report ordering before Phase 2 begins.
    roofDamageFound: parsed.data.roofDamageFound ?? undefined,
    sidingDamageFound: parsed.data.sidingDamageFound ?? undefined,
    collateralDamageFound: parsed.data.collateralDamageFound ?? undefined,
    interiorDamageFound: parsed.data.interiorDamageFound ?? undefined,
  };

  // Offline-first: when the client supplies its own id, creation is
  // idempotent so a queued offline "start" can be retried safely. A retry
  // never clobbers edits made after the first successful create — it simply
  // returns the existing row.
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(inspectionsTable)
      .values(values)
      .onConflictDoNothing({ target: inspectionsTable.id })
      .returning();

    if (inserted) {
      const finished = await attachAutoPin(inserted);
      res.status(201).json(CreateInspectionResponse.parse({ inspection: finished }));
      return;
    }

    // Conflict: id already exists. Only return it if it's in this company.
    const existing = await loadInspectionInCompany(parsed.data.id, actor.companyId);
    if (!existing) {
      res.status(409).json({ error: 'Inspection id already exists' });
      return;
    }
    res.status(200).json(CreateInspectionResponse.parse({ inspection: existing }));
    return;
  }

  const [inspection] = await db.insert(inspectionsTable).values(values).returning();

  const finished = await attachAutoPin(inspection);
  res.status(201).json(CreateInspectionResponse.parse({ inspection: finished }));
});

// CRM seam (B3 / M-F F4): scheduled inspections come from the external CRM,
// keyed by the tenant's CRM field key. Until a real key is provisioned the seam
// is "pending" (see lib/crm), so this returns an empty list rather than
// fabricating scheduled work — the shape is fixed so the mobile prefill path can
// be built ahead of the data. When the seam goes active, the upstream fetch
// drops in here behind the same config gate. Declared before the
// "/inspections/:inspectionId" route so "scheduled" isn't captured as an id.
router.get('/inspections/scheduled', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const crmConfig = await getCompanyCrmConfig(actor.companyId);
  if (!crmConfig.enabled || !crmConfig.fieldKey) {
    // Pending seam — no upstream to read, so no data. Never fabricate.
    res.json(ListScheduledInspectionsResponse.parse({ scheduled: [] }));
    return;
  }

  // Seam active: a real CRM integration would fetch the tenant's scheduled
  // queue here. No external CRM is connected yet, so this still yields an empty
  // list rather than inventing appointments.
  res.json(ListScheduledInspectionsResponse.parse({ scheduled: [] }));
});

router.get('/inspections/:inspectionId', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  // Detail view: hydrate the child collections the mobile capture flow
  // (elevations / slopes / damage / evidence photos) reads to render
  // progress and drive the lib/protocol gate. The list feed omits these;
  // only this by-id read pays for the extra queries. Ordered by createdAt
  // so the client can rely on capture order (e.g. the elevation walk).
  const [children, latestAgreementRow] = await Promise.all([
    hydrateInspectionChildren(inspectionId, actor.companyId),
    db
      .select({
        id: signedAgreementsTable.id,
        signedAt: signedAgreementsTable.signedAt,
        signerName: signedAgreementsTable.signerName,
      })
      .from(signedAgreementsTable)
      .where(
        and(
          eq(signedAgreementsTable.inspectionId, inspectionId),
          eq(signedAgreementsTable.companyId, actor.companyId),
          sql`${signedAgreementsTable.voidedAt} IS NULL`,
        ),
      )
      .orderBy(desc(signedAgreementsTable.signedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  res.json(
    GetInspectionResponse.parse({
      inspection: {
        ...inspection,
        ...children,
        latestAgreement: latestAgreementRow,
      },
    }),
  );
});

router.delete('/inspections/:inspectionId', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  if (actor.role !== 'super_admin') {
    res.status(403).json({ error: 'Only super admins may delete inspections' });
    return;
  }

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  // Hard delete — all child records (slopes, photos, attestations, etc.) are
  // removed by the FK cascade defined on each child table.
  await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));

  res.status(204).end();
});

router.patch('/inspections/:inspectionId', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = UpdateInspectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid inspection payload' });
    return;
  }

  // P0/P4 — phase transitions are forward-only. A record may advance from
  // `preliminary` to `forensic` (in place, carrying its Phase 1 data), but it
  // can never regress: forensic is terminal and a no-op re-set of the current
  // phase is fine. Any other transition is rejected so the funnel can't run
  // backwards or skip the checkpoint.
  if (parsed.data.phase !== undefined && parsed.data.phase !== inspection.phase) {
    const isForwardAdvance =
      inspection.phase === 'preliminary' && parsed.data.phase === 'forensic';
    if (!isForwardAdvance) {
      res.status(400).json({ error: 'Invalid phase transition' });
      return;
    }
  }

  // P1/P5 — once a storm of record is established it is read-only in the
  // forensic phase: a storm confirmed in Phase 1 (preliminary) is inherited
  // here without a re-pull and can never be re-written downstream. But a
  // forensic-first record (created directly as forensic, never through Phase 1,
  // storm still unset) must still be able to confirm its storm once. So: allow
  // the first confirmation when none exists, tolerate an idempotent offline
  // replay of the exact same value, and reject any genuine change once set.
  if (
    parsed.data.stormConfirmedRef !== undefined &&
    inspection.phase === 'forensic' &&
    inspection.stormConfirmedRef !== null
  ) {
    const incoming = stableStringify(parsed.data.stormConfirmedRef ?? null);
    const existing = stableStringify(inspection.stormConfirmedRef);
    if (incoming !== existing) {
      res
        .status(400)
        .json({ error: 'Storm of record is read-only once confirmed in the forensic phase' });
      return;
    }
  }

  // Phase 1 completion gate: the damage surfaces drive which measurement
  // report gets ordered between phases, so a preliminary can't be marked
  // complete with zero surfaces selected. Evaluate against the merged state
  // (incoming patch values win over the stored row).
  if (parsed.data.preliminaryCompletedAt) {
    const roof = parsed.data.roofDamageFound ?? inspection.roofDamageFound;
    const siding = parsed.data.sidingDamageFound ?? inspection.sidingDamageFound;
    const collateral = parsed.data.collateralDamageFound ?? inspection.collateralDamageFound;
    const interior = parsed.data.interiorDamageFound ?? inspection.interiorDamageFound;
    if (!roof && !siding && !collateral && !interior) {
      res.status(400).json({
        error: 'Select at least one damage surface before completing the preliminary phase',
      });
      return;
    }
  }

  // Phase 2 may ADD a damage surface freely (the elevation walk can catch
  // what the Phase 1 ground look missed), but REMOVING one after Phase 1 is
  // auditable — a measurement report may already have been ordered on that
  // basis. Same spirit as the storm-confirmation rule, except we record the
  // change (who/when/prior value) instead of rejecting it.
  const surfaceRemovals: Array<{
    surface: 'roof' | 'siding' | 'collateral' | 'interior';
    prior: boolean;
    next: boolean;
    changedByUserId: string;
    changedAt: string;
  }> = [];
  if (inspection.phase === 'forensic') {
    const flagPairs = [
      ['roof', 'roofDamageFound'],
      ['siding', 'sidingDamageFound'],
      ['collateral', 'collateralDamageFound'],
      ['interior', 'interiorDamageFound'],
    ] as const;
    for (const [surface, field] of flagPairs) {
      if (parsed.data[field] === false && inspection[field] === true) {
        surfaceRemovals.push({
          surface,
          prior: true,
          next: false,
          changedByUserId: actor.userId,
          changedAt: new Date().toISOString(),
        });
      }
    }
  }

  // REPORT_DATA v2 — property-protection plan: the reason is REQUIRED when
  // the specialized flag is affirmatively set (the flag is never inferred).
  if (
    parsed.data.propertyProtectionPlan &&
    parsed.data.propertyProtectionPlan.specializedRequired &&
    !parsed.data.propertyProtectionPlan.whyOrdinaryTarpingInsufficient?.trim()
  ) {
    res.status(400).json({
      error:
        'whyOrdinaryTarpingInsufficient is required when specialized protection is flagged',
    });
    return;
  }

  // REPORT_DATA v2 — property profile: a roof age without a basis is
  // attackable; reject the pair-less value outright.
  if (
    parsed.data.propertyProfile &&
    parsed.data.propertyProfile.roofAgeYears != null &&
    !parsed.data.propertyProfile.roofAgeBasis
  ) {
    res.status(400).json({ error: 'roofAgeBasis is required when roofAgeYears is set' });
    return;
  }

  // REPORT_DATA v2 — repairability assessment: assessor identity comes from
  // the inspector's profile, never from the client payload.
  let repairabilityToStore: RepairabilityAssessment | null | undefined =
    parsed.data.repairabilityAssessment;
  if (parsed.data.repairabilityAssessment) {
    const [assessor] = await db
      .select({
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        certifications: userProfilesTable.certifications,
        yearsExperience: userProfilesTable.yearsExperience,
      })
      .from(usersTable)
      .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
      .where(eq(usersTable.id, inspection.inspectorUserId));
    const certs = (assessor?.certifications ?? []) as Array<{
      name: string;
      issuingBody?: string | null;
    }>;
    const credentialParts = certs.map((c) =>
      c.issuingBody ? `${c.name} (${c.issuingBody})` : c.name,
    );
    if (assessor?.yearsExperience != null) {
      credentialParts.push(`${assessor.yearsExperience} years experience`);
    }
    repairabilityToStore = {
      ...parsed.data.repairabilityAssessment,
      assessorName:
        [assessor?.firstName, assessor?.lastName].filter(Boolean).join(' ') || null,
      assessorCredentials: credentialParts.length > 0 ? credentialParts.join('; ') : null,
    };
  }

  const [updated] = await db
    .update(inspectionsTable)
    .set({
      // Append-only, atomically against the CURRENT stored value (not the
      // in-memory snapshot) so concurrent PATCHes can't drop each other's
      // audit entries.
      ...(surfaceRemovals.length > 0 && {
        damageSurfaceChangeLog: sql`coalesce(${inspectionsTable.damageSurfaceChangeLog}, '[]'::jsonb) || ${JSON.stringify(surfaceRemovals)}::jsonb`,
      }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.phase !== undefined && { phase: parsed.data.phase }),
      ...(parsed.data.damageType !== undefined && { damageType: parsed.data.damageType }),
      ...(parsed.data.preliminaryCompletedAt !== undefined && {
        preliminaryCompletedAt: parsed.data.preliminaryCompletedAt,
      }),
      ...(parsed.data.pinId !== undefined && { pinId: parsed.data.pinId }),
      ...(parsed.data.claimNumber !== undefined && { claimNumber: parsed.data.claimNumber }),
      ...(parsed.data.policyNumber !== undefined && { policyNumber: parsed.data.policyNumber }),
      ...(parsed.data.carrierName !== undefined && { carrierName: parsed.data.carrierName }),
      ...(parsed.data.insuredName !== undefined && { insuredName: parsed.data.insuredName }),
      ...(parsed.data.address !== undefined && { address: parsed.data.address }),
      ...(parsed.data.latitude !== undefined && { latitude: parsed.data.latitude }),
      ...(parsed.data.longitude !== undefined && { longitude: parsed.data.longitude }),
      ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
      ...(parsed.data.dateOfLoss !== undefined && { dateOfLoss: parsed.data.dateOfLoss }),
      ...(parsed.data.stormConfirmedRef !== undefined && {
        stormConfirmedRef: parsed.data.stormConfirmedRef,
      }),
      ...(parsed.data.arrivalConditions !== undefined && {
        arrivalConditions: parsed.data.arrivalConditions,
      }),
      ...(parsed.data.homeownerFacts !== undefined && {
        homeownerFacts: parsed.data.homeownerFacts,
      }),
      // v2.1 — Elevation Walk damage flags + the optional siding measurement
      // report reference.
      ...(parsed.data.roofDamageFound !== undefined && {
        roofDamageFound: parsed.data.roofDamageFound,
      }),
      ...(parsed.data.sidingDamageFound !== undefined && {
        sidingDamageFound: parsed.data.sidingDamageFound,
      }),
      ...(parsed.data.collateralDamageFound !== undefined && {
        collateralDamageFound: parsed.data.collateralDamageFound,
      }),
      ...(parsed.data.interiorDamageFound !== undefined && {
        interiorDamageFound: parsed.data.interiorDamageFound,
      }),
      // v2.2 — inspection-level WRB answer (asked on the Siding Inspection
      // step when at least one facet is damaged).
      ...(parsed.data.sidingWrbPresent !== undefined && {
        sidingWrbPresent: parsed.data.sidingWrbPresent,
      }),
      ...(parsed.data.sidingMeasurementReportRef !== undefined && {
        sidingMeasurementReportRef: parsed.data.sidingMeasurementReportRef,
      }),
      // REPORT_DATA v2 capture blocks. Whole-object replace (no partial
      // merge) — the client always sends the full block.
      ...(parsed.data.propertyProfile !== undefined && {
        propertyProfile: parsed.data.propertyProfile,
      }),
      ...(repairabilityToStore !== undefined && {
        repairabilityAssessment: repairabilityToStore,
      }),
      ...(parsed.data.existingOrUnrelatedConditions !== undefined && {
        existingOrUnrelatedConditions: parsed.data.existingOrUnrelatedConditions,
      }),
      ...(parsed.data.temporaryRepairs !== undefined && {
        temporaryRepairs: parsed.data.temporaryRepairs,
      }),
      ...(parsed.data.propertyProtectionPlan !== undefined && {
        propertyProtectionPlan: parsed.data.propertyProtectionPlan,
      }),
    })
    .where(eq(inspectionsTable.id, inspectionId))
    .returning();

  res.json(UpdateInspectionResponse.parse({ inspection: updated }));
});

router.post('/inspections/:inspectionId/slopes', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateInspectionSlopeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid slope payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    label: parsed.data.label,
    pitchRise: parsed.data.pitchRise ?? undefined,
    pitchRun: parsed.data.pitchRun ?? undefined,
    materialType: parsed.data.materialType ?? undefined,
    areaSqft: parsed.data.areaSqft ?? undefined,
    damageType: parsed.data.damageType ?? undefined,
    damagePresent: parsed.data.damagePresent ?? undefined,
    tieInValley: parsed.data.tieInValley ?? undefined,
    tieInHipRidge: parsed.data.tieInHipRidge ?? undefined,
    notes: parsed.data.notes ?? undefined,
  };

  // Offline-first: a client-supplied id makes the create idempotent so a
  // retried offline capture returns the existing row instead of a
  // duplicate — and child photos can reference the slope id before it syncs.
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(inspectionSlopesTable)
      .values(values)
      .onConflictDoNothing({ target: inspectionSlopesTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateInspectionSlopeResponse.parse({ slope: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(inspectionSlopesTable)
      .where(
        and(
          eq(inspectionSlopesTable.id, parsed.data.id),
          eq(inspectionSlopesTable.companyId, actor.companyId),
          eq(inspectionSlopesTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Slope id already exists' });
      return;
    }
    res.status(200).json(CreateInspectionSlopeResponse.parse({ slope: existing }));
    return;
  }

  const [slope] = await db.insert(inspectionSlopesTable).values(values).returning();

  res.status(201).json(CreateInspectionSlopeResponse.parse({ slope }));
});

// Protocol v2 — facet detail editing (area/material/pitch/damage fields).
router.patch(
  '/inspections/:inspectionId/slopes/:slopeId',
  async (req: Request, res: Response) => {
    const actor = await requireInspectionModuleAccess(req, res);
    if (!actor) return;

    const inspectionId = req.params.inspectionId as string;
    const inspection = await loadWritableInspection(inspectionId, actor, res);
    if (!inspection) return;

    const parsed = UpdateInspectionSlopeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid facet payload' });
      return;
    }

    const setValues = {
      ...(parsed.data.label !== undefined && { label: parsed.data.label }),
        ...(parsed.data.pitchRise !== undefined && { pitchRise: parsed.data.pitchRise }),
        ...(parsed.data.pitchRun !== undefined && { pitchRun: parsed.data.pitchRun }),
        ...(parsed.data.materialType !== undefined && { materialType: parsed.data.materialType }),
        ...(parsed.data.areaSqft !== undefined && { areaSqft: parsed.data.areaSqft }),
        ...(parsed.data.damageType !== undefined && { damageType: parsed.data.damageType }),
        ...(parsed.data.damagePresent !== undefined && {
          damagePresent: parsed.data.damagePresent,
        }),
        ...(parsed.data.tieInValley !== undefined && { tieInValley: parsed.data.tieInValley }),
        ...(parsed.data.tieInHipRidge !== undefined && {
          tieInHipRidge: parsed.data.tieInHipRidge,
        }),
        ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
    };
    const slopeWhere = and(
      eq(inspectionSlopesTable.id, req.params.slopeId as string),
      eq(inspectionSlopesTable.inspectionId, inspectionId),
      eq(inspectionSlopesTable.companyId, actor.companyId),
    );

    // Replay tolerance: a patch whose recognized fields are all absent (e.g.
    // a stale offline-queued patch written under an older contract) is a
    // no-op, not a 500 — return the current row so the client can settle.
    if (Object.keys(setValues).length === 0) {
      const [current] = await db.select().from(inspectionSlopesTable).where(slopeWhere);
      if (!current) {
        res.status(404).json({ error: 'Facet not found' });
        return;
      }
      res.json(UpdateInspectionSlopeResponse.parse({ slope: current }));
      return;
    }

    const [updated] = await db
      .update(inspectionSlopesTable)
      .set(setValues)
      .where(slopeWhere)
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Facet not found' });
      return;
    }
    res.json(UpdateInspectionSlopeResponse.parse({ slope: updated }));
  },
);

// Protocol v2 — facet removal (the facet list is editable, never fixed).
router.delete(
  '/inspections/:inspectionId/slopes/:slopeId',
  async (req: Request, res: Response) => {
    const actor = await requireInspectionModuleAccess(req, res);
    if (!actor) return;

    const inspectionId = req.params.inspectionId as string;
    const inspection = await loadWritableInspection(inspectionId, actor, res);
    if (!inspection) return;

    const [deleted] = await db
      .delete(inspectionSlopesTable)
      .where(
        and(
          eq(inspectionSlopesTable.id, req.params.slopeId as string),
          eq(inspectionSlopesTable.inspectionId, inspectionId),
          eq(inspectionSlopesTable.companyId, actor.companyId),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'Facet not found' });
      return;
    }
    res.status(204).end();
  },
);

// v2.1 — Siding facets (S1, S2, …), captured when the Elevation Walk flags
// siding damage. Same offline-first idempotent-create / parent-scoped
// conflict pattern as slopes.
router.post('/inspections/:inspectionId/siding-facets', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateInspectionSidingFacetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid siding facet payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    label: parsed.data.label,
    damaged: parsed.data.damaged ?? undefined,
    damageType: parsed.data.damageType ?? undefined,
    wrbPresent: parsed.data.wrbPresent ?? undefined,
    isolated: parsed.data.isolated ?? undefined,
    components: parsed.data.components ?? undefined,
    notes: parsed.data.notes ?? undefined,
  };

  if (parsed.data.id) {
    const [inserted] = await db
      .insert(inspectionSidingFacetsTable)
      .values(values)
      .onConflictDoNothing({ target: inspectionSidingFacetsTable.id })
      .returning();
    if (inserted) {
      res
        .status(201)
        .json(CreateInspectionSidingFacetResponse.parse({ sidingFacet: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(inspectionSidingFacetsTable)
      .where(
        and(
          eq(inspectionSidingFacetsTable.id, parsed.data.id),
          eq(inspectionSidingFacetsTable.companyId, actor.companyId),
          eq(inspectionSidingFacetsTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Siding facet id already exists' });
      return;
    }
    res.status(200).json(CreateInspectionSidingFacetResponse.parse({ sidingFacet: existing }));
    return;
  }

  const [sidingFacet] = await db
    .insert(inspectionSidingFacetsTable)
    .values(values)
    .returning();

  res.status(201).json(CreateInspectionSidingFacetResponse.parse({ sidingFacet }));
});

router.patch(
  '/inspections/:inspectionId/siding-facets/:sidingFacetId',
  async (req: Request, res: Response) => {
    const actor = await requireInspectionModuleAccess(req, res);
    if (!actor) return;

    const inspectionId = req.params.inspectionId as string;
    const inspection = await loadWritableInspection(inspectionId, actor, res);
    if (!inspection) return;

    const parsed = UpdateInspectionSidingFacetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid siding facet payload' });
      return;
    }

    const setValues = {
      ...(parsed.data.label !== undefined && { label: parsed.data.label }),
      ...(parsed.data.damaged !== undefined && { damaged: parsed.data.damaged }),
      ...(parsed.data.damageType !== undefined && { damageType: parsed.data.damageType }),
      ...(parsed.data.wrbPresent !== undefined && { wrbPresent: parsed.data.wrbPresent }),
      ...(parsed.data.isolated !== undefined && { isolated: parsed.data.isolated }),
      ...(parsed.data.components !== undefined && { components: parsed.data.components }),
      ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
    };
    const facetWhere = and(
      eq(inspectionSidingFacetsTable.id, req.params.sidingFacetId as string),
      eq(inspectionSidingFacetsTable.inspectionId, inspectionId),
      eq(inspectionSidingFacetsTable.companyId, actor.companyId),
    );

    // Replay tolerance: an all-absent patch is a no-op, not a 500.
    if (Object.keys(setValues).length === 0) {
      const [current] = await db.select().from(inspectionSidingFacetsTable).where(facetWhere);
      if (!current) {
        res.status(404).json({ error: 'Siding facet not found' });
        return;
      }
      res.json(UpdateInspectionSidingFacetResponse.parse({ sidingFacet: current }));
      return;
    }

    const [updated] = await db
      .update(inspectionSidingFacetsTable)
      .set(setValues)
      .where(facetWhere)
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Siding facet not found' });
      return;
    }

    // When the component list shrinks, unbind component-role photos whose
    // slot no longer exists (index > new length). The photo row stays on
    // file as evidence, but it must never silently satisfy a component the
    // inspector re-adds later — that would bypass the per-component photo
    // gate. Idempotent, so outbox replays are safe.
    if (parsed.data.components !== undefined) {
      await db
        .update(inspectionPhotosTable)
        .set({ sidingRole: null, sidingComponentIndex: null })
        .where(
          and(
            eq(inspectionPhotosTable.inspectionId, inspectionId),
            eq(inspectionPhotosTable.companyId, actor.companyId),
            eq(inspectionPhotosTable.subjectId, updated.id),
            eq(inspectionPhotosTable.sidingRole, 'component'),
            gt(inspectionPhotosTable.sidingComponentIndex, parsed.data.components.length),
          ),
        );
    }
    res.json(UpdateInspectionSidingFacetResponse.parse({ sidingFacet: updated }));
  },
);

router.delete(
  '/inspections/:inspectionId/siding-facets/:sidingFacetId',
  async (req: Request, res: Response) => {
    const actor = await requireInspectionModuleAccess(req, res);
    if (!actor) return;

    const inspectionId = req.params.inspectionId as string;
    const inspection = await loadWritableInspection(inspectionId, actor, res);
    if (!inspection) return;

    const [deleted] = await db
      .delete(inspectionSidingFacetsTable)
      .where(
        and(
          eq(inspectionSidingFacetsTable.id, req.params.sidingFacetId as string),
          eq(inspectionSidingFacetsTable.inspectionId, inspectionId),
          eq(inspectionSidingFacetsTable.companyId, actor.companyId),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'Siding facet not found' });
      return;
    }
    res.status(204).end();
  },
);

router.post('/inspections/:inspectionId/elevations', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateInspectionElevationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid elevation payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    direction: parsed.data.direction,
    notes: parsed.data.notes ?? undefined,
  };

  // Offline-first idempotent create (see the slopes handler for rationale).
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(inspectionElevationsTable)
      .values(values)
      .onConflictDoNothing({ target: inspectionElevationsTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateInspectionElevationResponse.parse({ elevation: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(inspectionElevationsTable)
      .where(
        and(
          eq(inspectionElevationsTable.id, parsed.data.id),
          eq(inspectionElevationsTable.companyId, actor.companyId),
          eq(inspectionElevationsTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Elevation id already exists' });
      return;
    }
    res.status(200).json(CreateInspectionElevationResponse.parse({ elevation: existing }));
    return;
  }

  const [elevation] = await db.insert(inspectionElevationsTable).values(values).returning();

  res.status(201).json(CreateInspectionElevationResponse.parse({ elevation }));
});

router.post('/inspections/:inspectionId/damage-instances', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateDamageInstanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid damage instance payload' });
    return;
  }

  // E0 — functional damage (slope-tagged) requires a causation note: the
  // "if-not-for" thread (why this mark compromises the roof's water-shedding
  // function) that the Brain later consumes. Collateral (elevation-tagged)
  // instances leave it optional. Enforced server-side so the invariant holds
  // regardless of client, mirroring the mobile Save guard.
  if (parsed.data.slopeId && !parsed.data.causationNote?.trim()) {
    res.status(400).json({ error: 'Functional damage requires a causation note' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    slopeId: parsed.data.slopeId ?? undefined,
    elevationId: parsed.data.elevationId ?? undefined,
    damageType: parsed.data.damageType,
    severity: parsed.data.severity ?? undefined,
    causationNote: parsed.data.causationNote ?? undefined,
    notes: parsed.data.notes ?? undefined,
  };

  // Offline-first idempotent create (see the slopes handler for rationale).
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(damageInstancesTable)
      .values(values)
      .onConflictDoNothing({ target: damageInstancesTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateDamageInstanceResponse.parse({ damageInstance: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(damageInstancesTable)
      .where(
        and(
          eq(damageInstancesTable.id, parsed.data.id),
          eq(damageInstancesTable.companyId, actor.companyId),
          eq(damageInstancesTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Damage instance id already exists' });
      return;
    }
    res.status(200).json(CreateDamageInstanceResponse.parse({ damageInstance: existing }));
    return;
  }

  const [damageInstance] = await db.insert(damageInstancesTable).values(values).returning();

  res.status(201).json(CreateDamageInstanceResponse.parse({ damageInstance }));
});

router.post('/inspections/:inspectionId/components', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateInspectionComponentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid component payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    slopeId: parsed.data.slopeId ?? undefined,
    componentType: parsed.data.componentType,
    status: parsed.data.status ?? undefined,
    layerCount: parsed.data.layerCount ?? undefined,
    notes: parsed.data.notes ?? undefined,
  };

  // Offline-first idempotent create (see the slopes handler for rationale).
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(inspectionComponentsTable)
      .values(values)
      .onConflictDoNothing({ target: inspectionComponentsTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateInspectionComponentResponse.parse({ component: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(inspectionComponentsTable)
      .where(
        and(
          eq(inspectionComponentsTable.id, parsed.data.id),
          eq(inspectionComponentsTable.companyId, actor.companyId),
          eq(inspectionComponentsTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Component id already exists' });
      return;
    }
    res.status(200).json(CreateInspectionComponentResponse.parse({ component: existing }));
    return;
  }

  const [component] = await db.insert(inspectionComponentsTable).values(values).returning();

  res.status(201).json(CreateInspectionComponentResponse.parse({ component }));
});

// C4 — existing-component observations are editable: the inspector can change
// a status/detail selection or clear it entirely.
router.patch(
  '/inspections/:inspectionId/components/:componentId',
  async (req: Request, res: Response) => {
    const actor = await requireInspectionModuleAccess(req, res);
    if (!actor) return;

    const inspectionId = req.params.inspectionId as string;
    const inspection = await loadWritableInspection(inspectionId, actor, res);
    if (!inspection) return;

    const parsed = UpdateInspectionComponentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid component payload' });
      return;
    }

    const setValues = {
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.layerCount !== undefined && { layerCount: parsed.data.layerCount }),
      ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
    };
    const componentWhere = and(
      eq(inspectionComponentsTable.id, req.params.componentId as string),
      eq(inspectionComponentsTable.inspectionId, inspectionId),
      eq(inspectionComponentsTable.companyId, actor.companyId),
    );

    // Replay tolerance: a patch with no recognized fields is a no-op, not a
    // 500 — return the current row so the client can settle.
    if (Object.keys(setValues).length === 0) {
      const [current] = await db.select().from(inspectionComponentsTable).where(componentWhere);
      if (!current) {
        res.status(404).json({ error: 'Component not found' });
        return;
      }
      res.json(UpdateInspectionComponentResponse.parse({ component: current }));
      return;
    }

    const [updated] = await db
      .update(inspectionComponentsTable)
      .set(setValues)
      .where(componentWhere)
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Component not found' });
      return;
    }
    res.json(UpdateInspectionComponentResponse.parse({ component: updated }));
  },
);

router.delete(
  '/inspections/:inspectionId/components/:componentId',
  async (req: Request, res: Response) => {
    const actor = await requireInspectionModuleAccess(req, res);
    if (!actor) return;

    const inspectionId = req.params.inspectionId as string;
    const inspection = await loadWritableInspection(inspectionId, actor, res);
    if (!inspection) return;

    const [deleted] = await db
      .delete(inspectionComponentsTable)
      .where(
        and(
          eq(inspectionComponentsTable.id, req.params.componentId as string),
          eq(inspectionComponentsTable.inspectionId, inspectionId),
          eq(inspectionComponentsTable.companyId, actor.companyId),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'Component not found' });
      return;
    }
    res.status(204).end();
  },
);

router.post('/inspections/:inspectionId/penetrations', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateInspectionPenetrationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid penetration payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    slopeId: parsed.data.slopeId ?? undefined,
    penetrationType: parsed.data.penetrationType,
    flashingCondition: parsed.data.flashingCondition ?? undefined,
    notes: parsed.data.notes ?? undefined,
  };

  // Offline-first idempotent create (see the slopes handler for rationale).
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(inspectionPenetrationsTable)
      .values(values)
      .onConflictDoNothing({ target: inspectionPenetrationsTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateInspectionPenetrationResponse.parse({ penetration: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(inspectionPenetrationsTable)
      .where(
        and(
          eq(inspectionPenetrationsTable.id, parsed.data.id),
          eq(inspectionPenetrationsTable.companyId, actor.companyId),
          eq(inspectionPenetrationsTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Penetration id already exists' });
      return;
    }
    res.status(200).json(CreateInspectionPenetrationResponse.parse({ penetration: existing }));
    return;
  }

  const [penetration] = await db.insert(inspectionPenetrationsTable).values(values).returning();

  res.status(201).json(CreateInspectionPenetrationResponse.parse({ penetration }));
});

router.post('/inspections/:inspectionId/products', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateInspectionProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid product payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    slopeId: parsed.data.slopeId ?? undefined,
    category: parsed.data.category ?? undefined,
    brand: parsed.data.brand ?? undefined,
    productLine: parsed.data.productLine ?? undefined,
    identificationMethod: parsed.data.identificationMethod,
    itelSampleRef: parsed.data.itelSampleRef ?? undefined,
    unidentifiableReason: parsed.data.unidentifiableReason ?? undefined,
    notes: parsed.data.notes ?? undefined,
  };

  // Offline-first idempotent create (see the slopes handler for rationale).
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(inspectionProductsTable)
      .values(values)
      .onConflictDoNothing({ target: inspectionProductsTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateInspectionProductResponse.parse({ product: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(inspectionProductsTable)
      .where(
        and(
          eq(inspectionProductsTable.id, parsed.data.id),
          eq(inspectionProductsTable.companyId, actor.companyId),
          eq(inspectionProductsTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Product id already exists' });
      return;
    }
    res.status(200).json(CreateInspectionProductResponse.parse({ product: existing }));
    return;
  }

  const [product] = await db.insert(inspectionProductsTable).values(values).returning();

  res.status(201).json(CreateInspectionProductResponse.parse({ product }));
});

router.post('/inspections/:inspectionId/test-squares', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateTestSquareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid test square payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    slopeId: parsed.data.slopeId ?? undefined,
    label: parsed.data.label,
    sizeSqFt: parsed.data.sizeSqFt ?? undefined,
    notes: parsed.data.notes ?? undefined,
  };

  // Offline-first idempotent create (see the slopes/damage handlers). A test
  // square marked offline is queued and drained on reconnect; a replayed item
  // with the same client id returns the existing row instead of duplicating
  // the square (which would double the S4 gate rows for that slope).
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(testSquaresTable)
      .values(values)
      .onConflictDoNothing({ target: testSquaresTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateTestSquareResponse.parse({ testSquare: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(testSquaresTable)
      .where(
        and(
          eq(testSquaresTable.id, parsed.data.id),
          eq(testSquaresTable.companyId, actor.companyId),
          eq(testSquaresTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Test square id already exists' });
      return;
    }
    res.status(200).json(CreateTestSquareResponse.parse({ testSquare: existing }));
    return;
  }

  const [testSquare] = await db.insert(testSquaresTable).values(values).returning();

  res.status(201).json(CreateTestSquareResponse.parse({ testSquare }));
});

router.post(
  '/inspections/:inspectionId/test-squares/:testSquareId/hits',
  async (req: Request, res: Response) => {
    const actor = await requireInspectionModuleAccess(req, res);
    if (!actor) return;

    const inspectionId = req.params.inspectionId as string;
    const testSquareId = req.params.testSquareId as string;
    const inspection = await loadWritableInspection(inspectionId, actor, res);
    if (!inspection) return;

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

    const values = {
      ...(parsed.data.id ? { id: parsed.data.id } : {}),
      companyId: actor.companyId,
      testSquareId,
      hitType: parsed.data.hitType,
      notes: parsed.data.notes ?? undefined,
    };

    // Offline-first idempotent create. The conflict re-select is parent-scoped
    // by testSquareId (the hit's parent) plus companyId, so a replayed offline
    // hit never inflates the live hit counter and can't collide across tenants.
    if (parsed.data.id) {
      const [inserted] = await db
        .insert(testSquareHitsTable)
        .values(values)
        .onConflictDoNothing({ target: testSquareHitsTable.id })
        .returning();
      if (inserted) {
        res.status(201).json(CreateTestSquareHitResponse.parse({ hit: inserted }));
        return;
      }
      const [existing] = await db
        .select()
        .from(testSquareHitsTable)
        .where(
          and(
            eq(testSquareHitsTable.id, parsed.data.id),
            eq(testSquareHitsTable.companyId, actor.companyId),
            eq(testSquareHitsTable.testSquareId, testSquareId),
          ),
        );
      if (!existing) {
        res.status(409).json({ error: 'Hit id already exists' });
        return;
      }
      res.status(200).json(CreateTestSquareHitResponse.parse({ hit: existing }));
      return;
    }

    const [hit] = await db.insert(testSquareHitsTable).values(values).returning();

    res.status(201).json(CreateTestSquareHitResponse.parse({ hit }));
  },
);

router.post('/inspections/:inspectionId/photos', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateInspectionPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid photo payload' });
    return;
  }

  // D4 — Orphan-photo prevention. Every subject-attached photo (test square,
  // hit, damage instance, slope, elevation, penetration, product) must
  // reference the record it documents. Exceptions: whole-inspection photos
  // (S0 overview, S2 roof access) and shared component ZONE photos
  // (subjectType 'component' + zone tag — one photo evidences every
  // component documented in that zone) legitimately have no subjectId.
  const isZonePhoto = parsed.data.subjectType === 'component' && Boolean(parsed.data.zone);
  // Zone-photo invariants: `zone` is meaningful only on shared component
  // zone photos, and a zone photo documents the zone — never a specific
  // record. Rejecting ambiguous combinations keeps the gate unambiguous.
  if (parsed.data.zone && parsed.data.subjectType !== 'component') {
    res.status(400).json({ error: 'zone is only valid on component zone photos' });
    return;
  }
  if (isZonePhoto && parsed.data.subjectId) {
    res.status(400).json({ error: 'A zone photo must not reference a subjectId' });
    return;
  }
  if (parsed.data.subjectType !== 'inspection' && !isZonePhoto && !parsed.data.subjectId) {
    res.status(400).json({ error: 'A subjectId is required for subject-attached photos' });
    return;
  }
  // v2.1 — sidingRole invariants: the role tag is meaningful only on siding
  // facet photos, and every siding-facet photo must declare its role so the
  // gate can discriminate damage/facet/component shots deterministically.
  if (parsed.data.sidingRole && parsed.data.subjectType !== 'siding_facet') {
    res.status(400).json({ error: 'sidingRole is only valid on siding facet photos' });
    return;
  }
  if (parsed.data.subjectType === 'siding_facet' && !parsed.data.sidingRole) {
    res.status(400).json({ error: 'A sidingRole is required for siding facet photos' });
    return;
  }
  // sidingComponentIndex binds a 'component'-role photo to its S{n}C{k} slot;
  // it is meaningless on any other photo, and every component photo needs one
  // or the per-component gate could never be satisfied.
  if (parsed.data.sidingComponentIndex != null && parsed.data.sidingRole !== 'component') {
    res.status(400).json({ error: 'sidingComponentIndex is only valid on component-role siding photos' });
    return;
  }
  if (parsed.data.sidingRole === 'component' && parsed.data.sidingComponentIndex == null) {
    res.status(400).json({ error: 'A sidingComponentIndex is required for component-role siding photos' });
    return;
  }

  // Reject the row if the bytes are not actually in storage. Only applies to
  // /objects/... paths (canonical format from the fixed mobile client). Legacy
  // full-URL rows and test-fixture URLs are left through so existing tests and
  // backward-compat replays are not disrupted.
  if (parsed.data.url.startsWith('/objects/')) {
    try {
      await objectStorageService.getObjectEntityFile(parsed.data.url);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(409).json({
          error: 'photo_bytes_missing',
          detail: 'Upload the photo bytes to object storage before registering the row.',
        });
        return;
      }
      throw err;
    }
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    stage: parsed.data.stage ?? undefined,
    subjectType: parsed.data.subjectType,
    subjectId: parsed.data.subjectId ?? undefined,
    triadRole: parsed.data.triadRole ?? undefined,
    preliminaryRole: parsed.data.preliminaryRole ?? undefined,
    url: parsed.data.url,
    sha256: parsed.data.sha256,
    exifJson: parsed.data.exifJson ?? undefined,
    overlayJson: parsed.data.overlayJson ?? undefined,
    capturedAtUtc: parsed.data.capturedAtUtc ?? undefined,
    latitude: parsed.data.latitude ?? undefined,
    longitude: parsed.data.longitude ?? undefined,
    zone: parsed.data.zone ?? undefined,
    sidingRole: parsed.data.sidingRole ?? undefined,
    sidingComponentIndex: parsed.data.sidingComponentIndex ?? undefined,
  };

  // Offline-first idempotent create. Evidence photos are queued in the mobile
  // outbox and drained on reconnect; if the server commits but the response is
  // lost, the item replays with the same client id. Without this guard that
  // replay would duplicate the evidence row (corrupting the audit trail and
  // inflating triad/gate counts), so a repeat id returns the existing row.
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(inspectionPhotosTable)
      .values(values)
      .onConflictDoNothing({ target: inspectionPhotosTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateInspectionPhotoResponse.parse({ photo: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(inspectionPhotosTable)
      .where(
        and(
          eq(inspectionPhotosTable.id, parsed.data.id),
          eq(inspectionPhotosTable.companyId, actor.companyId),
          eq(inspectionPhotosTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Photo id already exists' });
      return;
    }
    res.status(200).json(CreateInspectionPhotoResponse.parse({ photo: existing }));
    return;
  }

  const [photo] = await db.insert(inspectionPhotosTable).values(values).returning();
  res.status(201).json(CreateInspectionPhotoResponse.parse({ photo }));
});

router.post('/inspections/:inspectionId/measurements', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateMeasurementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid measurement payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    subjectType: parsed.data.subjectType,
    subjectId: parsed.data.subjectId ?? undefined,
    measurementType: parsed.data.measurementType,
    value: parsed.data.value,
    unit: parsed.data.unit ?? undefined,
  };

  // Offline-first idempotent create (see the slopes handler for rationale) —
  // a queued offline measurement can be retried without duplicating the row.
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(measurementsTable)
      .values(values)
      .onConflictDoNothing({ target: measurementsTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateMeasurementResponse.parse({ measurement: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(measurementsTable)
      .where(
        and(
          eq(measurementsTable.id, parsed.data.id),
          eq(measurementsTable.companyId, actor.companyId),
          eq(measurementsTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Measurement id already exists' });
      return;
    }
    res.status(200).json(CreateMeasurementResponse.parse({ measurement: existing }));
    return;
  }

  const [measurement] = await db.insert(measurementsTable).values(values).returning();

  res.status(201).json(CreateMeasurementResponse.parse({ measurement }));
});

router.post('/inspections/:inspectionId/attestations', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CreateAttestationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid attestation payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    userId: actor.userId,
    stage: parsed.data.stage ?? undefined,
    attestationType: parsed.data.attestationType ?? undefined,
    details: parsed.data.details ?? undefined,
    signatureData: parsed.data.signatureData ?? undefined,
  };

  // Offline-first: a client-supplied id makes the write idempotent so a
  // retried offline attestation (server committed, ack lost) returns the
  // existing row instead of duplicating the audit record.
  if (parsed.data.id) {
    const [inserted] = await db
      .insert(attestationsTable)
      .values(values)
      .onConflictDoNothing({ target: attestationsTable.id })
      .returning();

    if (inserted) {
      res.status(201).json(CreateAttestationResponse.parse({ attestation: inserted }));
      return;
    }

    const [existing] = await db
      .select()
      .from(attestationsTable)
      .where(
        and(
          eq(attestationsTable.id, parsed.data.id),
          eq(attestationsTable.companyId, actor.companyId),
          eq(attestationsTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Attestation id already exists' });
      return;
    }
    res.status(200).json(CreateAttestationResponse.parse({ attestation: existing }));
    return;
  }

  const [attestation] = await db.insert(attestationsTable).values(values).returning();

  res.status(201).json(CreateAttestationResponse.parse({ attestation }));
});

router.post(
  '/inspections/:inspectionId/interior-observations',
  async (req: Request, res: Response) => {
    const actor = await requireInspectionModuleAccess(req, res);
    if (!actor) return;

    const inspectionId = req.params.inspectionId as string;
    const inspection = await loadWritableInspection(inspectionId, actor, res);
    if (!inspection) return;

    const parsed = CreateInteriorObservationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid interior observation payload' });
      return;
    }

    const values = {
      ...(parsed.data.id ? { id: parsed.data.id } : {}),
      companyId: actor.companyId,
      inspectionId,
      location: parsed.data.location,
      observationType: parsed.data.observationType,
      moistureReading: parsed.data.moistureReading ?? undefined,
      notes: parsed.data.notes ?? undefined,
    };

    // Offline-first idempotent create (see the slopes handler for rationale).
    if (parsed.data.id) {
      const [inserted] = await db
        .insert(inspectionInteriorObservationsTable)
        .values(values)
        .onConflictDoNothing({ target: inspectionInteriorObservationsTable.id })
        .returning();
      if (inserted) {
        res
          .status(201)
          .json(CreateInteriorObservationResponse.parse({ interiorObservation: inserted }));
        return;
      }
      const [existing] = await db
        .select()
        .from(inspectionInteriorObservationsTable)
        .where(
          and(
            eq(inspectionInteriorObservationsTable.id, parsed.data.id),
            eq(inspectionInteriorObservationsTable.companyId, actor.companyId),
            eq(inspectionInteriorObservationsTable.inspectionId, inspectionId),
          ),
        );
      if (!existing) {
        res.status(409).json({ error: 'Interior observation id already exists' });
        return;
      }
      res
        .status(200)
        .json(CreateInteriorObservationResponse.parse({ interiorObservation: existing }));
      return;
    }

    const [interiorObservation] = await db
      .insert(inspectionInteriorObservationsTable)
      .values(values)
      .returning();

    res
      .status(201)
      .json(CreateInteriorObservationResponse.parse({ interiorObservation }));
  },
);

// M-F (F2) — Intake hardening ("Brain v0"). The server is now the
// authoritative gatekeeper, not a thin accept. On submit it: (a) requires the
// inspector to have a signature on file (F0); (b) re-hashes every manifest photo
// against the stored row and rejects on any mismatch/missing photo; (c) re-runs
// the SAME shared gate the client ran and rejects if any hard deficiency
// remains (no client-side bypass); then (d) records the manifest verbatim,
// stamps lockedAt, and transitions to `submitted`. Once locked the record is
// immutable — corrections become addenda.
router.post('/inspections/:inspectionId/submission', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  // allowLocked: an offline outbox may replay this after the record is already
  // locked. Rather than 409, we treat a locked record as an idempotent success.
  const inspection = await loadWritableInspection(inspectionId, actor, res, { allowLocked: true });
  if (!inspection) return;

  // Idempotent replay: already locked/submitted → return the existing record.
  if (inspection.lockedAt) {
    res.json(SubmitInspectionResponse.parse({ inspection }));
    return;
  }

  const parsed = SubmitInspectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid submission payload' });
    return;
  }

  // (F0) Signature-on-file gate. The inspector who owns this record must have a
  // signature on file; the declaration (S8) references it and the package
  // carries it. Missing signature blocks submission — the client surfaces a
  // capture prompt.
  const [inspectorProfile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, inspection.inspectorUserId));
  if (!inspectorProfile?.signatureUrl || !inspectorProfile.signatureSha256) {
    res.status(422).json({
      error: 'No signature on file for the assigned inspector; capture one before submitting',
      code: 'signature_required',
    });
    return;
  }

  const children = await hydrateInspectionChildren(inspectionId, actor.companyId);

  // (F2) Photo-hash verification. Every hash the manifest claims must match a
  // stored photo in this inspection. A missing photo or a hash mismatch means
  // the evidence the package attests to is not the evidence on file — reject.
  const photoById = new Map(children.photos.map((photo) => [photo.id, photo]));
  const mismatches: { photoId: string; reason: string }[] = [];
  for (const claim of parsed.data.manifest.photoHashes) {
    const stored = photoById.get(claim.photoId);
    if (!stored) {
      mismatches.push({ photoId: claim.photoId, reason: 'not_found' });
    } else if (stored.sha256 !== claim.sha256) {
      mismatches.push({ photoId: claim.photoId, reason: 'hash_mismatch' });
    }
  }
  if (mismatches.length > 0) {
    res.status(422).json({
      error: 'Submission manifest photo hashes do not match stored evidence',
      code: 'photo_hash_mismatch',
      mismatches,
    });
    return;
  }

  // (F2) Server-side gate re-run. The client blocks submit on a clean gate, but
  // the server must not trust that — re-derive the protocol state from stored
  // rows and re-run the shared engine. Any hard deficiency rejects.
  const evaluation = evaluateServerInspection({
    ...children,
    arrivalConditions: inspection.arrivalConditions ?? null,
    damageFlags: {
      roofDamageFound: inspection.roofDamageFound,
      sidingDamageFound: inspection.sidingDamageFound,
      collateralDamageFound: inspection.collateralDamageFound,
      interiorDamageFound: inspection.interiorDamageFound,
    },
    sidingMeasurementReportRef: inspection.sidingMeasurementReportRef ?? null,
  });
  if (evaluation.deficiencies.length > 0) {
    res.status(422).json({
      error: 'Inspection has unresolved deficiencies and cannot be submitted',
      code: 'gate_deficiencies',
      deficiencies: evaluation.deficiencies,
    });
    return;
  }

  // Record the on-file signature reference into the stored manifest so the
  // package is self-contained (the client also sends it, but the server is the
  // source of truth for what's actually on file).
  // REPORT_DATA v2 — the individual credential layer rides along with every
  // submission (the company pack lives Brain-side). Server-sourced, never
  // client-sent.
  const [inspectorUser] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, inspection.inspectorUserId));

  const manifestToStore = {
    ...parsed.data.manifest,
    inspector: {
      name:
        [inspectorUser?.firstName, inspectorUser?.lastName].filter(Boolean).join(' ') || null,
      certifications: inspectorProfile.certifications ?? [],
      yearsExperience: inspectorProfile.yearsExperience ?? null,
    },
    signatureOnFile: {
      url: inspectorProfile.signatureUrl,
      sha256: inspectorProfile.signatureSha256,
      signedAt: inspectorProfile.signatureSignedAt
        ? inspectorProfile.signatureSignedAt.toISOString()
        : null,
    },
  };

  // Queue Brain delivery atomically with the lock when the courier is
  // enabled; a background attempt fires after the response and a worker
  // retries failures. Courier failure never fails the rep's submit.
  const courierEnabled = !!getBrainConfig();
  const [updated] = await db
    .update(inspectionsTable)
    .set({
      status: 'submitted',
      submissionManifest: manifestToStore,
      lockedAt: new Date(),
      ...(courierEnabled ? { brainDeliveryStatus: 'pending' as const } : {}),
    })
    .where(eq(inspectionsTable.id, inspectionId))
    .returning();

  res.json(SubmitInspectionResponse.parse({ inspection: updated }));

  if (courierEnabled) {
    void deliverInspectionToBrain(inspectionId).catch((err) =>
      req.log.error({ err, inspectionId }, 'Brain delivery kickoff failed'),
    );
  }
});

// Manual redeliver — lets a super admin immediately re-trigger Brain delivery
// for a submitted inspection without waiting for the backoff worker. Safe to
// call on an already-delivered inspection (no-ops). Resets failed/stuck
// deliveries to 'pending' and fires an async attempt.
router.post('/inspections/:inspectionId/redeliver', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  if (actor.role !== 'super_admin') {
    res.status(403).json({ error: 'Only super admins may manually trigger redelivery' });
    return;
  }

  if (!getBrainConfig()) {
    res.status(403).json({ error: 'Brain courier is not configured on this server' });
    return;
  }

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection || !inspection.lockedAt) {
    res.status(404).json({ error: 'Inspection not found or not yet submitted' });
    return;
  }

  // Reset to pending so the row is eligible for the worker and the immediate
  // attempt below. Clear the last error so stale messages don't linger.
  await db
    .update(inspectionsTable)
    .set({ brainDeliveryStatus: 'pending', brainLastError: null })
    .where(eq(inspectionsTable.id, inspectionId));

  res.status(204).end();

  // Fire an immediate attempt in the background — same function the worker
  // calls, so backoff / idempotency guarantees all apply.
  void deliverInspectionToBrain(inspectionId).catch((err) =>
    req.log.error({ err, inspectionId }, 'Manual redeliver attempt failed'),
  );
});

// M-F (F1) — Pre-flight. Re-runs the shared gate server-side so the inspector
// can resolve deficiencies while still on-site, before leaving. Authoritative:
// hydrates stored rows and runs the SAME evaluate() the client runs. Scoped to
// the record's writers (owning inspector or a manager+) — a same-company peer
// gets 403, matching every other write-adjacent inspection path. C0-guarded.
// allowLocked so a submitted record can still be re-checked.
router.post('/inspections/:inspectionId/preflight', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res, { allowLocked: true });
  if (!inspection) return;

  const children = await hydrateInspectionChildren(inspectionId, actor.companyId);
  const evaluation = evaluateServerInspection({
    ...children,
    arrivalConditions: inspection.arrivalConditions ?? null,
    damageFlags: {
      roofDamageFound: inspection.roofDamageFound,
      sidingDamageFound: inspection.sidingDamageFound,
      collateralDamageFound: inspection.collateralDamageFound,
      interiorDamageFound: inspection.interiorDamageFound,
    },
    sidingMeasurementReportRef: inspection.sidingMeasurementReportRef ?? null,
  });

  res.json(
    PreflightInspectionResponse.parse({
      preflight: {
        deficiencies: evaluation.deficiencies,
        softFlags: evaluation.softFlags,
      },
    }),
  );
});

// M-F (F3) — Status & package receipt. Poll an inspection's submission status
// and a clearly-labeled STUB receipt. The standalone Brain that renders the
// real package does not exist yet; this receipt only reports what the intake
// verified (record + verified-photo counts), never a fabricated deliverable.
router.get('/inspections/:inspectionId/status', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  // The db types submissionManifest loosely (jsonb Record<string, unknown>);
  // narrow to the fields the receipt counts. The stored value was validated
  // against SubmissionManifestV1 at submit time.
  const manifest = (inspection.submissionManifest ?? null) as
    | { records?: Record<string, unknown>; photoHashes?: unknown[] }
    | null;
  const isSubmitted = !!inspection.lockedAt && !!manifest;
  const recordCount = manifest?.records
    ? Object.values(manifest.records).reduce<number>(
        (sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0),
        0,
      )
    : 0;
  const verifiedPhotoCount = manifest?.photoHashes?.length ?? 0;

  // Return path (§6): when the courier is enabled and this submission was
  // delivered, ask the Brain for the real package status. If the Brain is
  // unreachable, return the app's own local state with the Brain portion
  // marked unavailable — NEVER fail this call, it is the rep's only
  // visibility.
  const config = getBrainConfig();
  const machineToken = config ? machineTokenForCompany(config, inspection.companyId) : null;
  let brainAvailable = false;
  let brainStatus:
    | 'received'
    | 'validating'
    | 'generating'
    | 'package_ready'
    | 'rejected'
    | 'generation_failed'
    | null = null;
  const KNOWN_BRAIN_STATUSES = [
    'received',
    'validating',
    'generating',
    'package_ready',
    'rejected',
    'generation_failed',
  ] as const;
  if (config && machineToken && inspection.brainSubmissionId) {
    try {
      const response = await fetch(
        `${config.baseUrl}/submissions/${encodeURIComponent(inspection.brainSubmissionId)}/status`,
        {
          headers: { Authorization: `Bearer ${machineToken}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (response.ok) {
        const body = (await response.json()) as { status?: string };
        // Only accept statuses this contract knows; an unknown value from a
        // newer Brain degrades to "unavailable" rather than a 500 at parse.
        const known = KNOWN_BRAIN_STATUSES.find((s) => s === body.status);
        if (known) {
          brainAvailable = true;
          brainStatus = known;
        }
      }
    } catch (error) {
      req.log.warn(
        { err: error instanceof Error ? error.message : String(error), inspectionId },
        'Brain status fetch failed; returning local state',
      );
    }
  }

  const receipt = isSubmitted
    ? brainStatus
      ? {
          stage: 'validated' as const,
          label: 'Package status',
          message: `Brain package status: ${brainStatus}`,
          isStub: false,
          verifiedPhotoCount,
          recordCount,
          generatedAtUtc: new Date().toISOString(),
        }
      : {
          stage: 'validated' as const,
          label: 'Received & validated',
          message:
            'The inspection package was received and its evidence verified at intake. Package rendering status from the Brain is not available yet.',
          isStub: true,
          verifiedPhotoCount,
          recordCount,
          generatedAtUtc: new Date().toISOString(),
        }
    : null;

  res.json(
    GetInspectionStatusResponse.parse({
      status: inspection.status,
      lockedAt: inspection.lockedAt ? inspection.lockedAt.toISOString() : null,
      submissionManifest: manifest,
      receipt,
      brain: {
        available: brainAvailable,
        deliveryStatus: inspection.brainDeliveryStatus ?? null,
        brainSubmissionId: inspection.brainSubmissionId ?? null,
        lastError: inspection.brainLastError ?? null,
        status: brainStatus,
      },
    }),
  );
});

// M-F (F2) — Addenda. The only write allowed on a locked inspection. A
// post-lock correction is appended, never an edit, preserving the original
// evidentiary record. Requires the same write authority as any other
// inspection write, but opts into allowLocked. Idempotent by client-supplied id.
router.post('/inspections/:inspectionId/addenda', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res, { allowLocked: true });
  if (!inspection) return;

  // An addendum is a POST-lock correction — it exists precisely because the
  // record is immutable. Before lock, the inspector edits the record directly,
  // so an addendum on an unlocked inspection is out-of-policy; reject it.
  if (!inspection.lockedAt) {
    res.status(409).json({
      error: 'Addenda can only be filed on a submitted (locked) inspection',
      code: 'inspection_not_locked',
    });
    return;
  }

  const parsed = CreateInspectionAddendumBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid addendum payload' });
    return;
  }

  const values = {
    ...(parsed.data.id ? { id: parsed.data.id } : {}),
    companyId: actor.companyId,
    inspectionId,
    userId: actor.userId,
    body: parsed.data.body,
  };

  if (parsed.data.id) {
    const [inserted] = await db
      .insert(inspectionAddendaTable)
      .values(values)
      .onConflictDoNothing({ target: inspectionAddendaTable.id })
      .returning();
    if (inserted) {
      res.status(201).json(CreateInspectionAddendumResponse.parse({ addendum: inserted }));
      return;
    }
    const [existing] = await db
      .select()
      .from(inspectionAddendaTable)
      .where(
        and(
          eq(inspectionAddendaTable.id, parsed.data.id),
          eq(inspectionAddendaTable.companyId, actor.companyId),
          eq(inspectionAddendaTable.inspectionId, inspectionId),
        ),
      );
    if (!existing) {
      res.status(409).json({ error: 'Addendum id already exists' });
      return;
    }
    res.status(200).json(CreateInspectionAddendumResponse.parse({ addendum: existing }));
    return;
  }

  const [addendum] = await db.insert(inspectionAddendaTable).values(values).returning();
  res.status(201).json(CreateInspectionAddendumResponse.parse({ addendum }));
});

// Emails a generated report PDF to a homeowner via the *user's own* SMTP
// settings (configured on their profile). The client generates the PDF
// locally and posts it as base64; the server never re-renders it. Read-level
// access is enough — sharing a report is not a mutation, so the C0
// owner-or-manager write gate does not apply, but company scoping does.
router.post('/inspections/:inspectionId/email-report', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const parsed = EmailInspectionReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid email payload' });
    return;
  }
  const { recipient, pdfBase64, filename, subject, body } = parsed.data;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    res.status(400).json({ error: 'Invalid recipient email address' });
    return;
  }

  const inspection = await loadInspectionInCompany(
    String(req.params.inspectionId),
    actor.companyId,
  );
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, actor.userId));
  if (!profile?.smtpHost || !profile.smtpPort || !profile.smtpUsername || !profile.smtpPasswordEnc) {
    res.status(400).json({ error: 'SMTP is not configured on your profile' });
    return;
  }

  let password: string;
  try {
    password = decryptSmtpPassword(profile.smtpPasswordEnc);
  } catch {
    res.status(400).json({ error: 'Stored SMTP password could not be read; please re-enter it' });
    return;
  }

  // SSRF guard: resolve the user-supplied host ourselves, reject private /
  // internal addresses, and connect to the vetted IP (servername keeps TLS
  // certificate validation against the original hostname).
  let smtpAddress: string;
  try {
    smtpAddress = await resolvePublicSmtpAddress(profile.smtpHost);
  } catch {
    res.status(400).json({ error: 'SMTP host is not a valid public mail server' });
    return;
  }

  const transport = nodemailer.createTransport({
    host: smtpAddress,
    port: profile.smtpPort,
    secure: profile.smtpSecure ?? profile.smtpPort === 465,
    name: undefined,
    auth: { user: profile.smtpUsername, pass: password },
    tls: { servername: profile.smtpHost },
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });

  try {
    await transport.sendMail({
      from: profile.smtpFromEmail || profile.smtpUsername,
      to: recipient,
      subject: subject || `Preliminary roof report — ${inspection.address ?? 'your property'}`,
      text: body || 'Attached is the preliminary storm-damage summary for your property.',
      attachments: [
        {
          filename,
          content: pdfBase64,
          encoding: 'base64',
          contentType: 'application/pdf',
        },
      ],
    });
  } catch (err) {
    req.log.warn({ err }, 'SMTP report delivery failed');
    res.status(502).json({
      error:
        'Email could not be sent. Check your SMTP settings (host, port, username, password) and try again.',
    });
    return;
  }

  res.json({ sent: true });
});

export default router;

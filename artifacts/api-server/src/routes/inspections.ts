import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { z } from 'zod';
import {
  CreateAttestationBody,
  CreateAttestationResponse,
  CurateInspectionPhotosBody,
  CurateInspectionPhotosResponse,
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
  CompileInspectionReportBody,
  ListInspectionReportCodeCitationsResponse,
} from '@workspace/api-zod';
import nodemailer from 'nodemailer';
import { anthropic } from '@workspace/integrations-anthropic-ai';
import { ai as geminiAi } from '@workspace/integrations-gemini-ai';
import sanitizeHtml from 'sanitize-html';
import {
  attestationsTable,
  companiesTable,
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
  discontinuedProductsTable,
  priceBookItemsTable,
  inspectionsTable,
  pinsTable,
  signedAgreementsTable,
  testSquareHitsTable,
  testSquaresTable,
  measurementsTable,
  companyJurisdictionPacksTable,
  type CodeCitation as CodeCitationRow,
  userProfilesTable,
  usersTable,
  exhibitSelectionsTable,
  comparisonPairsTable,
  claimEventsTable,
  exhibitCaptionsTable,
  type ExhibitClass,
  claimSectionsTable,
  standardsEntriesTable,
  ahjPacksTable,
  boilerplateSectionsTable,
  detrimentEntriesTable,
  reportAttestationsTable,
  roofFacetsTable,
  leadFilesTable,
  objectOwnershipTable,
} from '@workspace/db';
import type {
  Role,
  RepairabilityAssessment,
  RepairabilityAssessmentV3,
  StoredRepairabilityAssessment,
  EvidenceLink,
  InspectionEstimate,
} from '@workspace/db';
import { and, desc, eq, gt, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { canAccessInspectionModule, canWriteInspection, isManagerOrAdmin, canEditPin } from '../lib/permissions';
import { runAhjCheck } from '../lib/ahjLookup';
import { getRole, LeadProfileBody, toDateOrNull } from './pins';
import { buildReportHtml, escHtml, resolveReportTheme } from '../lib/reportTemplate';
import { buildProofPackageHtml, type ProofPackageData } from '../lib/proofPackageTemplate';

// The reportData snapshot baked into schemaVersion-6 blobs. It reuses the
// template's input shapes, minus the render-time-only fields (signed URLs,
// theme, extras) that are resolved fresh on every render.
type ProofPackageReportData = Pick<
  ProofPackageData,
  | 'company'
  | 'storm'
  | 'methodology'
  | 'areasImpacted'
  | 'components'
  | 'measurement'
  | 'scope'
  | 'product'
> & {
  statePack: ProofPackageData['statePack'] & { state: string };
  phase1Date: string;
  phase2Date: string;
  photoMeta: Array<{
    id: string;
    area: 'roof' | 'siding' | 'interior' | 'collateral' | 'general';
    caption: string;
    sha256: string | null;
  }>;
  coverPhotoId: string | null;
  signaturePath: string | null;
};
import { buildPortalAccessFromRequest, generatePortalAccessCode } from '../lib/portalAccess';
import { computeReadiness } from '../lib/readiness';
import {
  generateSectionContent,
  assembleSectionHtml,
  filterDetrimentEntries,
  buildFieldConditionSet,
  DAG_LAST_SECTION_TYPES,
  DAG_UPSTREAM_SECTION_TYPES,
  GENERATABLE_SECTION_TYPES,
  type GeneratableSectionType,
  type LockedSectionRow,
} from '../lib/sectionGeneration';
import { composeAiSystemPrompt, parseAiSummaryResponse } from '../lib/aiSummaryPrompt';
import {
  DETERMINATION_LABELS,
  RAP_WARRANTED_LABELS,
  validateRepairabilityAssessment,
  validateRepairabilityAssessmentV3,
} from '../lib/repairabilityRules';
import {
  buildRapReportSection,
  computeRapScorecard,
  extractRap,
  rapScorecardBriefLines,
  type RapReportSection,
} from '../lib/rapScorecard';
import {
  buildVapReportSection,
  computeVapScorecard,
  extractVap,
  isVapArchiveOnlyPhoto,
  vapScorecardBriefLines,
  type VapReportSection,
} from '../lib/vapScorecard';
import { ObjectNotFoundError, ObjectStorageService } from '../lib/objectStorage';

const objectStorageService = new ObjectStorageService();
import {
  buildServerProtocolState,
  evaluateServerInspection,
  type HydratedInspectionChildren,
} from '../lib/inspectionProtocolState';
import { getCompanyCrmConfig } from '../lib/crm';
import { computeLines, computeMeasuredBasis } from '../lib/estimate';
import {
  buildEvidenceScopeIndexHtml,
  buildLinkedFindingSummary,
  collectApprovedScopeLinks,
  normalizeEvidenceLinks,
  type ApprovedScopeLink,
  type LinkedFindingSummary,
} from '../lib/evidenceChain';
import {
  CARRIER_FACING_CONTENT_CLASSES,
  CONTRACTOR_LANE_POLICY,
  lintReportFragments,
  type ContentClass,
  type LintFragmentInput,
} from '../lib/contentPolicy';
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
    'arrivalConditions' | 'damageFlags' | 'sidingMeasurementReportRef' | 'measurementsReportUrl' | 'propertyType'
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

// Stored repairabilityAssessment jsonb may predate the v2/v3 schemas. API
// response schemas accept v2 and v3 only, so surface legacy rows as null
// rather than failing the whole response parse; report compiles read the
// raw DB row and keep their own legacy fallback rendering.
function apiSafeRepairability(ra: unknown): unknown {
  if (!ra || typeof ra !== 'object') return null;
  const version = (ra as { version?: number }).version;
  return version === 2 || version === 3 ? ra : null;
}

// Assessor identity comes from the inspector's profile at save time — never
// from the client payload. Shared by the v2 and v3 repairability save paths.
async function buildAssessorStamp(
  inspectorUserId: string,
): Promise<{ assessorName: string | null; assessorCredentials: string | null }> {
  const [assessor] = await db
    .select({
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      certifications: userProfilesTable.certifications,
      yearsExperience: userProfilesTable.yearsExperience,
    })
    .from(usersTable)
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
    .where(eq(usersTable.id, inspectorUserId));
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
  return {
    assessorName: [assessor?.firstName, assessor?.lastName].filter(Boolean).join(' ') || null,
    assessorCredentials: credentialParts.length > 0 ? credentialParts.join('; ') : null,
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
      repairabilityAssessment: apiSafeRepairability(row.repairabilityAssessment),
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

// Scheduled inspections feed (B3 / M-F F4). Returns inspections the rep has
// booked a Phase 2 date for via notify-schedule (status='scheduled'). These are
// local-DB appointments. The CRM seam below is the future pathway for externally
// assigned jobs; once that seam is wired both feeds will be merged.
// Declared before "/inspections/:inspectionId" so "scheduled" isn't captured as an id.
router.get('/inspections/scheduled', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  // Local Phase 2 appointments — inspections whose status was set to 'scheduled'
  // by notify-schedule. Field reps see their own; managers and above see all in
  // the company (matching the agreement tracker's visibility model).
  const isManager = (['manager', 'admin', 'super_admin'] as string[]).includes(actor.role);
  const rows = await db
    .select()
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, actor.companyId),
        isManager ? undefined : eq(inspectionsTable.inspectorUserId, actor.userId),
        eq(inspectionsTable.status, 'scheduled'),
        isNotNull(inspectionsTable.scheduledFor),
      ),
    )
    .orderBy(inspectionsTable.scheduledFor);

  const localScheduled = rows.map((row) => ({
    id: row.id,
    scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
    insuredName: row.insuredName ?? null,
    propertyAddress: row.address ?? null,
    carrier: row.carrierName ?? null,
    policyNumber: row.policyNumber ?? null,
    claimNumber: row.claimNumber ?? null,
    dateOfLoss: row.dateOfLoss ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
  }));

  // TODO: push to CRM — merge upstream CRM scheduled queue here when the seam
  // is active (crmConfig.enabled && crmConfig.fieldKey). CRM-sourced items use
  // the same ScheduledInspection shape so the mobile prefill path is unchanged.

  res.json(ListScheduledInspectionsResponse.parse({ scheduled: localScheduled }));
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
        repairabilityAssessment: apiSafeRepairability(inspection.repairabilityAssessment),
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

  // signed_agreements uses onDelete:'restrict' (intentional — voiding an
  // agreement is a business action, not a cascade). Delete it explicitly first
  // so the subsequent inspection delete doesn't hit the FK constraint.
  await db
    .delete(signedAgreementsTable)
    .where(eq(signedAgreementsTable.inspectionId, inspectionId));

  // Hard delete — all other child records (slopes, photos, attestations, etc.)
  // are removed by the FK cascade defined on each child table.
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
  let repairabilityToStore: StoredRepairabilityAssessment | null | undefined =
    parsed.data.repairabilityAssessment as StoredRepairabilityAssessment | null | undefined;
  const incomingVersion = parsed.data.repairabilityAssessment
    ? (parsed.data.repairabilityAssessment as { version?: number }).version
    : undefined;
  if (parsed.data.repairabilityAssessment && incomingVersion === 3) {
    // v3 — Repair Attempt Protocol flow. Internal-consistency validation
    // (partial runs are savable), plus: every referenced photo id must be a
    // real inspection_photos row of THIS inspection, so the record can't
    // point at another tenant's (or a nonexistent) photo. The mobile outbox
    // enqueues photo creates before the assessment update and drains FIFO,
    // so by the time this replays the rows exist.
    const incomingV3 = parsed.data.repairabilityAssessment as unknown as RepairabilityAssessmentV3;
    const violations = validateRepairabilityAssessmentV3(incomingV3);
    if (violations.length > 0) {
      res.status(400).json({
        error: 'Repairability assessment failed validation',
        details: violations,
      });
      return;
    }
    const photoIds = new Set<string>();
    if (incomingV3.rap?.rap1PhotoId) photoIds.add(incomingV3.rap.rap1PhotoId);
    for (const finding of Object.values(incomingV3.rap?.damage ?? {})) {
      if (finding?.photoId) photoIds.add(finding.photoId);
    }
    if (incomingV3.vap?.vap1PhotoId) photoIds.add(incomingV3.vap.vap1PhotoId);
    if (incomingV3.vap?.finalPhotoId) photoIds.add(incomingV3.vap.finalPhotoId);
    for (const finding of Object.values(incomingV3.vap?.damage ?? {})) {
      if (finding?.photoId) photoIds.add(finding.photoId);
    }
    if (photoIds.size > 0) {
      const rows = await db
        .select({ id: inspectionPhotosTable.id })
        .from(inspectionPhotosTable)
        .where(
          and(
            inArray(inspectionPhotosTable.id, [...photoIds]),
            eq(inspectionPhotosTable.inspectionId, inspectionId),
            eq(inspectionPhotosTable.companyId, actor.companyId),
          ),
        );
      const found = new Set(rows.map((r) => r.id));
      const missing = [...photoIds].filter((id) => !found.has(id));
      if (missing.length > 0) {
        res.status(400).json({
          error: 'Repairability assessment failed validation',
          details: [
            `Repair Attempt Protocol photo(s) not found on this inspection: ${missing.join(', ')}`,
          ],
        });
        return;
      }
    }
    repairabilityToStore = {
      ...incomingV3,
      ...(await buildAssessorStamp(inspection.inspectorUserId)),
    };
  } else if (parsed.data.repairabilityAssessment) {
    // Known Product Catalog match (RR-010A): the client sends only the
    // productId — name/photo/width/exposure are snapshotted here from the
    // company's catalog so the stored record can't carry spoofed attributes
    // and survives later catalog edits/deletes.
    const incomingAssessment = parsed.data.repairabilityAssessment as unknown as RepairabilityAssessment;
    const roofFlowIn = incomingAssessment.roof;
    if (roofFlowIn?.productMatch) {
      const [product] = await db
        .select()
        .from(discontinuedProductsTable)
        .where(
          and(
            eq(discontinuedProductsTable.id, roofFlowIn.productMatch.productId),
            eq(discontinuedProductsTable.companyId, actor.companyId),
          ),
        );
      if (!product) {
        res.status(400).json({
          error: 'Repairability assessment failed validation',
          details: ['Asphalt Shingle: the selected catalog product match no longer exists.'],
        });
        return;
      }
      roofFlowIn.productMatch = {
        productId: product.id,
        name: product.name,
        photoPath: product.photoPath,
        widthInches: product.widthInches,
        exposureInches: product.exposureInches,
      };
    }
    // v2 question flow: the determination is gated by documented basis
    // factors + universal evidence rules; the server is the authority so a
    // raw API call can't bypass the mobile flow's gating.
    const violations = validateRepairabilityAssessment(incomingAssessment);
    if (violations.length > 0) {
      res.status(400).json({
        error: 'Repairability assessment failed validation',
        details: violations,
      });
      return;
    }
    repairabilityToStore = {
      ...(parsed.data.repairabilityAssessment as unknown as RepairabilityAssessment),
      ...(await buildAssessorStamp(inspection.inspectorUserId)),
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
      ...(parsed.data.ownerEmail !== undefined && { ownerEmail: parsed.data.ownerEmail }),
      ...(parsed.data.scheduledFor !== undefined && { scheduledFor: parsed.data.scheduledFor }),
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
      ...(parsed.data.measurementsReportUrl !== undefined && {
        measurementsReportUrl: parsed.data.measurementsReportUrl,
        // When the measurements PDF is replaced (URL changes), immediately clear
        // stale facet inventory so the confirm screen falls back to the manual
        // slope-ordering path rather than showing outdated counts/areas/pitches.
        ...(parsed.data.measurementsReportUrl !== inspection.measurementsReportUrl && {
          facetInventory: null,
          facetCount: null,
          facetInventoryStatus: null,
        }),
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

  // When the measurements PDF was replaced, purge the per-facet rows and
  // measurement-report-page photos that belong to the old analysis so a
  // future re-analyze always starts clean.
  if (
    parsed.data.measurementsReportUrl !== undefined &&
    parsed.data.measurementsReportUrl !== inspection.measurementsReportUrl
  ) {
    await db.delete(roofFacetsTable).where(eq(roofFacetsTable.inspectionId, inspectionId));
    await db.delete(inspectionPhotosTable).where(
      and(
        eq(inspectionPhotosTable.inspectionId, inspectionId),
        eq(inspectionPhotosTable.subjectType, 'measurement_report_page'),
      ),
    );
  }

  res.json(
    UpdateInspectionResponse.parse({
      inspection: {
        ...updated,
        repairabilityAssessment: apiSafeRepairability(
          (updated as { repairabilityAssessment?: unknown }).repairabilityAssessment,
        ),
      },
    }),
  );
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
        ...(parsed.data.compassBearing !== undefined && { compassBearing: parsed.data.compassBearing }),
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
    preExistingConditions: parsed.data.preExistingConditions ?? undefined,
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
      ...(parsed.data.preExistingConditions !== undefined && { preExistingConditions: parsed.data.preExistingConditions }),
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

// Caption edits annotate existing evidence without altering forensic records,
// so they are permitted on locked inspections (allowLocked behaviour).
router.patch('/inspections/:inspectionId/photos/:photoId', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const photoId = req.params.photoId as string;

  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }
  if (!canWriteInspection(actor.role, actor.userId, inspection.inspectorUserId)) {
    res.status(403).json({ error: 'Not authorized to modify this inspection' });
    return;
  }

  const parsed = z.object({ caption: z.string().max(200).nullable() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid caption payload' });
    return;
  }

  const [photo] = await db
    .select()
    .from(inspectionPhotosTable)
    .where(
      and(
        eq(inspectionPhotosTable.id, photoId),
        eq(inspectionPhotosTable.inspectionId, inspectionId),
        eq(inspectionPhotosTable.companyId, actor.companyId),
      ),
    );

  if (!photo) {
    res.status(404).json({ error: 'Photo not found' });
    return;
  }

  const currentOverlay = (photo.overlayJson as Record<string, unknown> | null) ?? {};
  const newOverlay =
    parsed.data.caption !== null
      ? { ...currentOverlay, caption: parsed.data.caption }
      : Object.fromEntries(Object.entries(currentOverlay).filter(([k]) => k !== 'caption'));

  const [updated] = await db
    .update(inspectionPhotosTable)
    .set({ overlayJson: Object.keys(newOverlay).length > 0 ? newOverlay : null })
    .where(
      and(
        eq(inspectionPhotosTable.id, photoId),
        eq(inspectionPhotosTable.inspectionId, inspectionId),
        eq(inspectionPhotosTable.companyId, actor.companyId),
      ),
    )
    .returning();

  res.json(CreateInspectionPhotoResponse.parse({ photo: updated }));
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

// Pre-submission Proof Package curation. Bulk-sets includeInProofPackage on
// the listed photos. Photos not listed are untouched. No minimum/maximum —
// the curation dashboard alone decides what ships in the package; the photos
// themselves remain stored evidence either way.
router.post('/inspections/:inspectionId/photo-curation', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  const parsed = CurateInspectionPhotosBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid curation payload' });
    return;
  }

  // Last-write-wins per photo id within one request.
  const flagById = new Map<string, boolean>();
  for (const item of parsed.data.curation) flagById.set(item.photoId, item.include);
  const includeIds = [...flagById.entries()].filter(([, v]) => v).map(([k]) => k);
  const excludeIds = [...flagById.entries()].filter(([, v]) => !v).map(([k]) => k);

  const scope = (ids: string[]) =>
    and(
      inArray(inspectionPhotosTable.id, ids),
      eq(inspectionPhotosTable.inspectionId, inspectionId),
      eq(inspectionPhotosTable.companyId, actor.companyId),
    );

  let updated = 0;
  if (includeIds.length > 0) {
    const rows = await db
      .update(inspectionPhotosTable)
      .set({ includeInProofPackage: true })
      .where(scope(includeIds))
      .returning({ id: inspectionPhotosTable.id });
    updated += rows.length;
  }
  if (excludeIds.length > 0) {
    const rows = await db
      .update(inspectionPhotosTable)
      .set({ includeInProofPackage: false })
      .where(scope(excludeIds))
      .returning({ id: inspectionPhotosTable.id });
    updated += rows.length;
  }

  const [{ count: includedCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inspectionPhotosTable)
    .where(
      and(
        eq(inspectionPhotosTable.inspectionId, inspectionId),
        eq(inspectionPhotosTable.companyId, actor.companyId),
        eq(inspectionPhotosTable.includeInProofPackage, true),
      ),
    );

  res.status(200).json(CurateInspectionPhotosResponse.parse({ updated, includedCount }));
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
    measurementsReportUrl: inspection.measurementsReportUrl ?? null,
    propertyType: inspection.propertyProfile?.propertyType ?? null,
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

  const [updated] = await db
    .update(inspectionsTable)
    .set({
      status: 'submitted',
      submissionManifest: manifestToStore,
      lockedAt: new Date(),
    })
    .where(eq(inspectionsTable.id, inspectionId))
    .returning();

  // Record package_delivered claim event.
  await db.insert(claimEventsTable).values({
    inspectionId,
    companyId: actor.companyId,
    eventType: 'package_delivered',
    payload: {},
    actorId: actor.userId,
  });

  res.json(SubmitInspectionResponse.parse({ inspection: updated }));
});

// POST /inspections/:inspectionId/unlock — { reason }
// Manager/admin-only reopen of a submitted (locked) inspection so its data
// can be edited again. Locking stays one-way for reps; every unlock appends
// an audit entry to the append-only unlock_log (SQL `||`, never
// read-modify-write) so a re-submitted package clearly shows it was reopened,
// by whom, when, and why. The prior submission manifest is left in place —
// re-submission rebuilds and replaces it.
router.post('/inspections/:inspectionId/unlock', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  if (!isManagerOrAdmin(actor.role)) {
    res.status(403).json({ error: 'Only a manager or admin can unlock a submitted inspection' });
    return;
  }

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }
  if (!inspection.lockedAt) {
    res.status(400).json({ error: 'Inspection is not locked' });
    return;
  }

  const reason =
    typeof (req.body as { reason?: unknown })?.reason === 'string'
      ? (req.body as { reason: string }).reason.trim().slice(0, 2000)
      : '';
  if (!reason) {
    res.status(400).json({ error: 'A reason is required to unlock a submitted inspection' });
    return;
  }

  const [actorUser] = await db.select().from(usersTable).where(eq(usersTable.id, actor.userId));
  const unlockEvent = {
    unlockedBy: actor.userId,
    unlockedByName:
      [actorUser?.firstName, actorUser?.lastName].filter(Boolean).join(' ') ||
      actorUser?.email ||
      null,
    unlockedAt: new Date().toISOString(),
    reason,
    previousLockedAt: inspection.lockedAt.toISOString(),
    previousStatus: inspection.status,
  };

  // Atomic: the lock predicate lives in the UPDATE itself, so concurrent
  // unlock requests can't both append audit entries — only the request that
  // actually flips locked_at → NULL writes to the log.
  const [updated] = await db
    .update(inspectionsTable)
    .set({
      lockedAt: null,
      status: 'capturing',
      unlockLog: sql`${inspectionsTable.unlockLog} || ${JSON.stringify(unlockEvent)}::jsonb`,
    })
    .where(and(eq(inspectionsTable.id, inspectionId), isNotNull(inspectionsTable.lockedAt)))
    .returning();
  if (!updated) {
    res.status(400).json({ error: 'Inspection is not locked' });
    return;
  }

  res.json({ inspection: { id: updated.id, status: updated.status, lockedAt: null }, unlockEvent });
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
    measurementsReportUrl: inspection.measurementsReportUrl ?? null,
    propertyType: inspection.propertyProfile?.propertyType ?? null,
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

  const receipt = isSubmitted
    ? {
        stage: 'validated' as const,
        label: 'Received & validated',
        message:
          'The inspection package was received and its evidence verified at intake.',
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

// ---------------------------------------------------------------------------
// Shared helper — build the canonical attestation statement text shown to the
// preparer and stored (with its SHA-256) in the report_attestations row.
// Both GET (preview) and POST (commit) must produce identical text from the
// same inputs so the hash verifies.
// ---------------------------------------------------------------------------
function buildReportAttestationStatement(opts: {
  preparerFirstName: string | null;
  preparerLastName: string | null;
  address: string | null;
  claimNumber: string | null;
  compiledAt: string;
  isSameIdentity: boolean;
  inspectorFirstName?: string | null;
  inspectorLastName?: string | null;
}): string {
  const preparerName =
    [opts.preparerFirstName, opts.preparerLastName].filter(Boolean).join(' ') ||
    'Preparer';
  const property = [
    opts.address,
    opts.claimNumber ? `(Claim No. ${opts.claimNumber})` : null,
  ]
    .filter(Boolean)
    .join(' ') || 'this inspection';
  const compiledDate = opts.compiledAt
    ? new Date(opts.compiledAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'an unknown date';

  const inspectorLine =
    !opts.isSameIdentity && (opts.inspectorFirstName || opts.inspectorLastName)
      ? ` The field inspection was conducted by ${[opts.inspectorFirstName, opts.inspectorLastName].filter(Boolean).join(' ')}.`
      : '';

  return (
    `I, ${preparerName}, certify that I have personally reviewed the compiled ` +
    `proof package for ${property}, compiled on ${compiledDate}, and that the ` +
    `contents of this package accurately represent the findings documented and ` +
    `attested in the field record for this inspection.${inspectorLine} By ` +
    `submitting this attestation I authorize this package for delivery.`
  );
}

// ---------------------------------------------------------------------------
// GET /inspections/:inspectionId/report-attestation
// Returns the Variant B attestation for the current (latest) compiled blob
// version, or a preview of the statement text if not yet attested.
// ---------------------------------------------------------------------------
router.get('/inspections/:inspectionId/report-attestation', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) return void res.status(404).json({ error: 'Inspection not found' });

  const versions = (inspection.compiledReportVersions ?? []) as Array<{
    path: string;
    generatedAt: string;
    schemaVersion?: number;
    lintStatus?: string;
  }>;

  if (versions.length === 0) {
    return void res.json({ attested: false, reason: 'No compiled version exists yet' });
  }

  const currentIndex = versions.length - 1;
  const currentVersion = versions[currentIndex]!;

  const [existingAttestation] = await db
    .select()
    .from(reportAttestationsTable)
    .where(
      and(
        eq(reportAttestationsTable.inspectionId, inspectionId),
        eq(reportAttestationsTable.blobVersionIndex, currentIndex),
      ),
    )
    .limit(1);

  if (existingAttestation) {
    return void res.json({
      attested: true,
      attestation: {
        id: existingAttestation.id,
        preparerId: existingAttestation.preparerId,
        preparedAt: existingAttestation.preparedAt,
        blobVersionIndex: existingAttestation.blobVersionIndex,
        attestationBlockKey: existingAttestation.attestationBlockKey,
        statementHash: existingAttestation.statementHash,
        statementText: existingAttestation.statementText,
      },
    });
  }

  // Build the preview statement so the UI can show exactly what the preparer
  // will be signing before they submit.
  const [preparer, inspector] = await Promise.all([
    db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, actor.userId))
      .limit(1),
    db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, inspection.inspectorUserId))
      .limit(1),
  ]);

  const preparerRow = preparer[0] ?? { firstName: null, lastName: null };
  const inspectorRow = inspector[0] ?? { firstName: null, lastName: null };
  const isSameIdentity = actor.userId === inspection.inspectorUserId;

  const statementText = buildReportAttestationStatement({
    preparerFirstName: preparerRow.firstName,
    preparerLastName: preparerRow.lastName,
    address: inspection.address ?? null,
    claimNumber: inspection.claimNumber ?? null,
    compiledAt: currentVersion.generatedAt,
    isSameIdentity,
    inspectorFirstName: inspectorRow.firstName,
    inspectorLastName: inspectorRow.lastName,
  });

  res.json({
    attested: false,
    blobVersionIndex: currentIndex,
    statementText,
    preparerName:
      [preparerRow.firstName, preparerRow.lastName].filter(Boolean).join(' ') || null,
    isSameIdentity,
  });
});

// ---------------------------------------------------------------------------
// POST /inspections/:inspectionId/report-attestation
// Variant B: preparer explicitly acknowledges the compiled package and
// authorizes delivery. Creates a report_attestations row and a claim_event.
// Body: { acknowledged: true }
//
// Gating: compiled report must exist; the current version must not already be
// attested. Double-attestation is blocked by a DB unique constraint on
// (inspection_id, blob_version_index).
// ---------------------------------------------------------------------------
router.post('/inspections/:inspectionId/report-attestation', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  // Attestation is a legally meaningful mutation — use the full write gate so
  // only the assigned inspector, a manager, or an admin can sign off on a claim.
  // allowLocked: true because compiled packages are in a locked state but still
  // need to accept attestation before delivery.
  const inspection = await loadWritableInspection(inspectionId, actor, res, { allowLocked: true });
  if (!inspection) return;

  const versions = (inspection.compiledReportVersions ?? []) as Array<{
    path: string;
    generatedAt: string;
    schemaVersion?: number;
    lintStatus?: string;
  }>;

  if (versions.length === 0) {
    return void res.status(422).json({
      error: 'No compiled report exists. Compile the report before attesting.',
    });
  }

  const body = req.body as { acknowledged?: boolean } | null;
  if (body?.acknowledged !== true) {
    return void res.status(422).json({
      error: 'acknowledged: true is required. The preparer must explicitly confirm the attestation statement.',
    });
  }

  const currentIndex = versions.length - 1;
  const currentVersion = versions[currentIndex]!;

  // Check for existing attestation — unique constraint is the DB-level guard,
  // but we give a friendly 409 rather than letting a constraint exception propagate.
  const [existingAttestation] = await db
    .select({ id: reportAttestationsTable.id })
    .from(reportAttestationsTable)
    .where(
      and(
        eq(reportAttestationsTable.inspectionId, inspectionId),
        eq(reportAttestationsTable.blobVersionIndex, currentIndex),
      ),
    )
    .limit(1);

  if (existingAttestation) {
    return void res.status(409).json({
      error: 'This compiled version has already been attested.',
      attestationId: existingAttestation.id,
    });
  }

  const [preparer, inspector] = await Promise.all([
    db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, actor.userId))
      .limit(1),
    db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, inspection.inspectorUserId))
      .limit(1),
  ]);

  const preparerRow = preparer[0] ?? { firstName: null, lastName: null };
  const inspectorRow = inspector[0] ?? { firstName: null, lastName: null };
  const isSameIdentity = actor.userId === inspection.inspectorUserId;

  const statementText = buildReportAttestationStatement({
    preparerFirstName: preparerRow.firstName,
    preparerLastName: preparerRow.lastName,
    address: inspection.address ?? null,
    claimNumber: inspection.claimNumber ?? null,
    compiledAt: currentVersion.generatedAt,
    isSameIdentity,
    inspectorFirstName: inspectorRow.firstName,
    inspectorLastName: inspectorRow.lastName,
  });

  // SHA-256 of the exact statement text — binds the attestation to the content.
  const { createHash } = await import('node:crypto');
  const statementHash = createHash('sha256').update(statementText, 'utf8').digest('hex');

  // Block 'a' = same person signs both; Block 'b' = split preparer/inspector.
  const attestationBlockKey = isSameIdentity ? 'attestation_block_a' : 'attestation_block_b';

  const now = new Date();
  const [attestation] = await db
    .insert(reportAttestationsTable)
    .values({
      inspectionId,
      companyId: actor.companyId,
      preparerId: actor.userId,
      preparedAt: now,
      blobVersionIndex: currentIndex,
      statementText,
      statementHash,
      attestationBlockKey,
    })
    .returning();

  // Append a claim event for the audit trail.
  await db.insert(claimEventsTable).values({
    inspectionId,
    companyId: actor.companyId,
    eventType: 'report_attested',
    actorId: actor.userId,
    payload: {
      attestationId: attestation!.id,
      blobVersionIndex: currentIndex,
      attestationBlockKey,
      statementHash,
    },
  });

  res.status(201).json({
    attested: true,
    attestation: {
      id: attestation!.id,
      preparerId: attestation!.preparerId,
      preparedAt: attestation!.preparedAt,
      blobVersionIndex: attestation!.blobVersionIndex,
      attestationBlockKey: attestation!.attestationBlockKey,
      statementHash: attestation!.statementHash,
      statementText: attestation!.statementText,
    },
  });
});

// Emails a generated report PDF to a homeowner via the *user's own* SMTP
// settings (configured on their profile). The client generates the PDF
// locally and posts it as base64; the server never re-renders it. Read-level
// access is enough — sharing a report is not a mutation, so the C0
// owner-or-manager write gate does not apply, but company scoping does.
//
// Deliver gate: a report_attestations row must exist for the current compiled
// blob version before delivery is permitted (Variant B — Task #126).
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

  // Variant B attestation gate — the package must be signed before delivery.
  const versions = (inspection.compiledReportVersions ?? []) as Array<{ path: string }>;
  if (versions.length === 0) {
    res.status(422).json({ error: 'No compiled report exists. Compile and attest the report before delivering.' });
    return;
  }
  const currentVersionIndex = versions.length - 1;
  const [attestation] = await db
    .select({ id: reportAttestationsTable.id })
    .from(reportAttestationsTable)
    .where(
      and(
        eq(reportAttestationsTable.inspectionId, String(req.params.inspectionId)),
        eq(reportAttestationsTable.blobVersionIndex, currentVersionIndex),
      ),
    )
    .limit(1);
  if (!attestation) {
    res.status(422).json({
      error: 'Report attestation required. Attest the compiled report (Variant B) before delivering.',
      code: 'ATTESTATION_REQUIRED',
    });
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

// Reschedules a Phase 2 inspection: updates scheduledFor and re-sends the
// appointment notification to the homeowner using the previously-saved ownerEmail.
// Returns { scheduled: true, emailSent: boolean }. Status stays 'scheduled'.
router.patch('/inspections/:inspectionId/schedule', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const parsed = z.object({ scheduledFor: z.coerce.date() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'scheduledFor (ISO date) is required' });
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
  if (!canWriteInspection(actor.role, actor.userId, inspection.inspectorUserId)) {
    res.status(403).json({ error: 'Not authorized to modify this inspection' });
    return;
  }

  const { scheduledFor } = parsed.data;
  const ownerEmail = inspection.ownerEmail;

  await db
    .update(inspectionsTable)
    .set({ scheduledFor, status: 'scheduled' })
    .where(
      and(
        eq(inspectionsTable.id, inspection.id),
        eq(inspectionsTable.companyId, actor.companyId),
      ),
    );

  // If there's no stored ownerEmail we can still return success — the date is saved.
  if (!ownerEmail) {
    res.json({ scheduled: true, emailSent: false, noSmtp: true });
    return;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, actor.userId));

  if (!profile?.smtpHost || !profile.smtpPort || !profile.smtpUsername || !profile.smtpPasswordEnc) {
    res.json({ scheduled: true, emailSent: false, noSmtp: true });
    return;
  }

  let password: string;
  try {
    password = decryptSmtpPassword(profile.smtpPasswordEnc);
  } catch {
    res.json({ scheduled: true, emailSent: false, noSmtp: true });
    return;
  }

  let smtpAddress: string;
  try {
    smtpAddress = await resolvePublicSmtpAddress(profile.smtpHost);
  } catch {
    res.json({ scheduled: true, emailSent: false, noSmtp: true });
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

  const dateLabel = scheduledFor.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const propertyLabel = inspection.address ?? 'your property';

  try {
    await transport.sendMail({
      from: profile.smtpFromEmail || profile.smtpUsername,
      to: ownerEmail,
      subject: `Phase 2 Forensic Inspection Rescheduled — ${propertyLabel}`,
      text: [
        `Your Phase 2 forensic roof inspection has been rescheduled.`,
        '',
        `Property: ${propertyLabel}`,
        `New Date: ${dateLabel}`,
        '',
        'Your inspector will contact you with arrival details closer to the date.',
        'If you need to reschedule again, please reach out to your representative directly.',
      ].join('\n'),
    });
  } catch (err) {
    req.log.warn({ err }, 'SMTP reschedule notification failed');
    res.json({ scheduled: true, emailSent: false });
    return;
  }

  req.log.info(
    { inspectionId: inspection.id, ownerEmail, scheduledFor },
    'Reschedule notification sent to homeowner',
  );

  res.json({ scheduled: true, emailSent: true });
});

// Cancels a Phase 2 scheduled appointment: clears scheduledFor and resets
// status back to 'capturing' so the inspection drops off the Scheduled list
// and returns to the rep's active work queue.
router.delete('/inspections/:inspectionId/schedule', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspection = await loadInspectionInCompany(
    String(req.params.inspectionId),
    actor.companyId,
  );
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }
  if (!canWriteInspection(actor.role, actor.userId, inspection.inspectorUserId)) {
    res.status(403).json({ error: 'Not authorized to modify this inspection' });
    return;
  }

  await db
    .update(inspectionsTable)
    .set({ scheduledFor: null, status: 'capturing' })
    .where(
      and(
        eq(inspectionsTable.id, inspection.id),
        eq(inspectionsTable.companyId, actor.companyId),
      ),
    );

  req.log.info({ inspectionId: inspection.id }, 'Phase 2 appointment cancelled');
  res.json({ cancelled: true });
});

// Schedules a Phase 2 inspection and sends an appointment notification to
// the homeowner via the rep's SMTP. Saves scheduledFor + ownerEmail to the
// inspection row atomically. Returns { scheduled: true, emailSent: boolean }.
// When SMTP is not configured the schedule still saves; emailSent is false.
router.post('/inspections/:inspectionId/notify-schedule', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const parsed = z.object({
    scheduledFor: z.coerce.date(),
    ownerEmail: z.string().email(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'scheduledFor (ISO date) and a valid ownerEmail are required' });
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

  const { scheduledFor, ownerEmail } = parsed.data;

  // Persist the appointment and advance the status to 'scheduled' so the
  // inspection surfaces in the Scheduled section of the Inspections tab.
  // TODO: push to CRM — trigger a CRM appointment write here once the seam is active.
  await db
    .update(inspectionsTable)
    .set({ scheduledFor, ownerEmail, status: 'scheduled' })
    .where(
      and(
        eq(inspectionsTable.id, inspection.id),
        eq(inspectionsTable.companyId, actor.companyId),
      ),
    );

  // Send the appointment email only when the rep has SMTP configured.
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, actor.userId));

  if (!profile?.smtpHost || !profile.smtpPort || !profile.smtpUsername || !profile.smtpPasswordEnc) {
    res.json({ scheduled: true, emailSent: false, noSmtp: true });
    return;
  }

  let password: string;
  try {
    password = decryptSmtpPassword(profile.smtpPasswordEnc);
  } catch {
    res.json({ scheduled: true, emailSent: false, noSmtp: true });
    return;
  }

  let smtpAddress: string;
  try {
    smtpAddress = await resolvePublicSmtpAddress(profile.smtpHost);
  } catch {
    res.json({ scheduled: true, emailSent: false, noSmtp: true });
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

  const dateLabel = scheduledFor.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const propertyLabel = inspection.address ?? 'your property';

  try {
    await transport.sendMail({
      from: profile.smtpFromEmail || profile.smtpUsername,
      to: ownerEmail,
      subject: `Phase 2 Forensic Inspection Scheduled — ${propertyLabel}`,
      text: [
        `Your Phase 2 forensic roof inspection has been scheduled.`,
        '',
        `Property: ${propertyLabel}`,
        `Date:     ${dateLabel}`,
        '',
        'Your inspector will contact you with arrival details closer to the date.',
        'If you need to reschedule, please reach out to your representative directly.',
      ].join('\n'),
    });
  } catch (err) {
    req.log.warn({ err }, 'SMTP appointment notification failed');
    // The schedule was already saved — return success with emailSent: false
    // so the client can surface an appropriate message without retrying the DB write.
    res.json({ scheduled: true, emailSent: false });
    return;
  }

  req.log.info(
    { inspectionId: inspection.id, ownerEmail, scheduledFor },
    'Appointment notification sent to homeowner',
  );

  // Best-effort copy to the rep's own account email.
  const repEmail = req.user?.email;
  if (repEmail && repEmail !== ownerEmail) {
    const dateLabel = scheduledFor.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const propertyLabel = inspection.address ?? 'your property';
    transport.sendMail({
      from: profile.smtpFromEmail || profile.smtpUsername,
      to: repEmail,
      subject: `Phase 2 Scheduled — ${propertyLabel}`,
      text: [
        `Phase 2 forensic inspection scheduled.`,
        '',
        `Property: ${propertyLabel}`,
        `Date:     ${dateLabel}`,
        `Owner:    ${ownerEmail}`,
      ].join('\n'),
    }).catch((err) => req.log.warn({ err }, 'Failed to send rep copy of schedule notification'));
  }

  res.json({ scheduled: true, emailSent: true });
});

// ── AI Summary (Claude Sonnet) ─────────────────────────────────────────────

// The baseline system prompt lives in lib/aiSummaryPrompt.ts; company custom
// prompts are appended to it (never substituted) via composeAiSystemPrompt.

/** Build a plain-text inspection brief for the Claude prompt. */
function buildInspectionBrief(
  inspection: Awaited<ReturnType<typeof loadInspectionInCompany>>,
  children: Awaited<ReturnType<typeof hydrateInspectionChildren>>,
): string {
  if (!inspection) return '';
  const lines: string[] = [];

  lines.push(`PROPERTY: ${inspection.insuredName ?? 'Unknown'}`);
  if (inspection.address) lines.push(`ADDRESS: ${inspection.address}`);
  if (inspection.claimNumber) lines.push(`CLAIM #: ${inspection.claimNumber}`);
  if (inspection.dateOfLoss) lines.push(`DATE OF LOSS: ${inspection.dateOfLoss}`);

  const pp = inspection.propertyProfile as
    | {
        propertyType?: string | null;
        stories?: number | null;
        roofAge?: number | null;
        roofAgeBasis?: string | null;
        deckType?: string | null;
      }
    | null
    | undefined;
  if (pp) {
    lines.push('');
    lines.push('PROPERTY PROFILE:');
    if (pp.propertyType) lines.push(`  Type: ${pp.propertyType}`);
    if (pp.stories) lines.push(`  Stories: ${pp.stories}`);
    if (pp.roofAge != null) lines.push(`  Roof age: ${pp.roofAge} years (basis: ${pp.roofAgeBasis ?? 'unknown'})`);
    if (pp.deckType) lines.push(`  Deck: ${pp.deckType}`);
  }

  const arr = inspection.arrivalConditions as
    | { sky?: string; windCondition?: string; tempF?: number; personnel?: string[] }
    | null
    | undefined;
  if (arr) {
    lines.push('');
    lines.push('ARRIVAL CONDITIONS:');
    if (arr.sky) lines.push(`  Sky: ${arr.sky}`);
    if (arr.windCondition) lines.push(`  Wind: ${arr.windCondition}`);
    if (arr.tempF != null) lines.push(`  Temp: ${arr.tempF}°F`);
    if (arr.personnel?.length) lines.push(`  Personnel: ${arr.personnel.join(', ')}`);
  }

  lines.push('');
  lines.push('DAMAGE FLAGS:');
  lines.push(`  Roof: ${inspection.roofDamageFound ? 'YES' : 'no'}`);
  lines.push(`  Siding: ${inspection.sidingDamageFound ? 'YES' : 'no'}`);
  lines.push(`  Collateral: ${inspection.collateralDamageFound ? 'YES' : 'no'}`);
  lines.push(`  Interior: ${inspection.interiorDamageFound ? 'YES' : 'no'}`);

  const slopes = children.slopes ?? [];
  if (slopes.length > 0) {
    lines.push('');
    lines.push('ROOF FACETS:');
    for (const s of slopes) {
      const parts: string[] = [`  ${s.label}`];
      if (s.areaSqft != null) parts.push(`${s.areaSqft.toFixed(1)} sqft`);
      if (s.materialType) parts.push(s.materialType);
      if (s.pitchRise != null && s.pitchRun != null)
        parts.push(`${s.pitchRise}/${s.pitchRun} pitch`);
      if (s.damageType) parts.push(`damage: ${s.damageType}`);
      lines.push(parts.join(' | '));
    }
  }

  const sidingFacets = children.sidingFacets ?? [];
  if (sidingFacets.length > 0) {
    lines.push('');
    lines.push('SIDING FACETS:');
    for (const sf of sidingFacets) {
      lines.push(`  ${sf.label} — damage: ${sf.damageType ?? 'none'}`);
    }
  }

  const products = children.products ?? [];
  if (products.length > 0) {
    // Index slopes by id so each product can name the facet it was found on.
    const slopeById = new Map((children.slopes ?? []).map((s) => [s.id, s.label]));
    lines.push('');
    lines.push('ROOFING PRODUCT IDENTIFICATION:');
    for (const p of products) {
      const parts: string[] = [];
      if (p.category) parts.push(`category: ${p.category}`);
      parts.push(
        p.brand || p.productLine
          ? [p.brand, p.productLine].filter(Boolean).join(' ')
          : 'Unidentified product',
      );
      parts.push(`identification method: ${p.identificationMethod}`);
      if (p.slopeId && slopeById.has(p.slopeId)) parts.push(`slope: ${slopeById.get(p.slopeId)}`);
      if (p.itelSampleRef) parts.push(`ITEL sample ref: ${p.itelSampleRef}`);
      if (p.unidentifiableReason) parts.push(`unidentifiable reason: ${p.unidentifiableReason}`);
      lines.push(`  - ${parts.join(' | ')}`);
      if (p.notes) lines.push(`    Notes: ${p.notes}`);
    }
  }

  const ra = inspection.repairabilityAssessment as StoredRepairabilityAssessment | null | undefined;
  if (ra) {
    lines.push('');
    lines.push('REPAIRABILITY ASSESSMENT:');
    if (ra.version === 2) {
      for (const system of ['roof', 'siding'] as const) {
        const flow = ra[system];
        if (!flow) continue;
        lines.push(`  ${system === 'roof' ? 'Roofing' : 'Siding'}:`);
        lines.push(
          `    Determination: ${DETERMINATION_LABELS[flow.determination] ?? flow.determination}`,
        );
        if (flow.basisFactors?.length) {
          lines.push(`    Documented basis factors: ${flow.basisFactors.join(', ')}`);
        }
        if (flow.nextStep) lines.push(`    Next step: ${flow.nextStep}`);
        if (flow.notes) lines.push(`    Notes: ${flow.notes}`);
        // Repair Attempt Protocol scorecard (asphalt-shingle roof flows).
        const rap = system === 'roof' ? extractRap(ra) : null;
        if (rap) {
          for (const line of rapScorecardBriefLines(computeRapScorecard(rap), rap.selection)) {
            lines.push(`    ${line}`);
          }
        }
      }
    } else if (ra.version === 3) {
      // v3 — Repair Attempt Protocol flow.
      const v3 = ra as RepairabilityAssessmentV3;
      lines.push(`  Warranted/authorized: ${RAP_WARRANTED_LABELS[v3.warranted] ?? v3.warranted}`);
      if (v3.systems.length > 0) lines.push(`  Assessed on: ${v3.systems.join(', ')}`);
      if (v3.roofType) lines.push(`  Roof type: ${v3.roofType.replace(/_/g, ' ')}`);
      if (v3.sidingType) {
        lines.push(`  Siding type: ${v3.sidingType}`);
        if (v3.sidingType === 'aluminum') {
          lines.push(
            '  Aluminum siding: routed to the Product ID-supported non-repairability determination — no simulated repair performed.',
          );
        }
      }
      const rap = extractRap(ra);
      if (rap) {
        for (const line of rapScorecardBriefLines(computeRapScorecard(rap), rap.selection)) {
          lines.push(`  ${line}`);
        }
      }
      const vap = extractVap(ra);
      if (vap) {
        for (const line of vapScorecardBriefLines(computeVapScorecard(vap))) {
          lines.push(`  ${line}`);
        }
      }
    } else {
      // Legacy v1 record.
      const legacy = ra as unknown as { determination?: string; recommendation?: string | null };
      lines.push(`  Determination: ${legacy.determination ?? 'not set'}`);
      if (legacy.recommendation) lines.push(`  Recommendation: ${legacy.recommendation}`);
    }
  }

  const interiorObs = children.interiorObservations ?? [];
  if (interiorObs.length > 0) {
    lines.push('');
    lines.push('INTERIOR / ATTIC OBSERVATIONS:');
    for (const obs of interiorObs) {
      const o = obs as { location?: string; description?: string };
      if (o.location || o.description) {
        lines.push(`  ${o.location ?? ''}: ${o.description ?? ''}`);
      }
    }
  }

  const ec = inspection.existingOrUnrelatedConditions as
    | Array<{ condition?: string; notes?: string }>
    | null
    | undefined;
  if (ec?.length) {
    lines.push('');
    lines.push('EXISTING / UNRELATED CONDITIONS:');
    for (const c of ec) {
      lines.push(`  - ${c.condition ?? ''}: ${c.notes ?? ''}`);
    }
  }

  const hof = inspection.homeownerFacts as
    | { priorRepairs?: string | null; priorClaims?: string | null }
    | null
    | undefined;
  if (hof) {
    lines.push('');
    lines.push('HOMEOWNER FACTS:');
    if (hof.priorRepairs) lines.push(`  Prior repairs: ${hof.priorRepairs}`);
    if (hof.priorClaims) lines.push(`  Prior claims: ${hof.priorClaims}`);
  }

  const testSquares = children.testSquares ?? [];
  if (testSquares.length > 0) {
    lines.push('');
    lines.push(`TEST SQUARES: ${testSquares.length} square(s) documented`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Estimate step (advisory) — GET/PUT /inspections/:id/estimate.
// Full-replace PUT keyed on the inspection id, so offline outbox replays are
// naturally idempotent (last write wins with identical content). The server
// recomputes the measured basis and all money math; client totals are never
// trusted. Locked inspections reject with 409 like every other capture write.
// ---------------------------------------------------------------------------

const EvidenceLinkBody = z.object({
  targetType: z.enum(['photo', 'damage_instance']),
  targetId: z.string().min(1).max(100),
  linkSource: z.enum(['inspector', 'user', 'ai_suggested', 'imported']),
  reviewStatus: z.enum(['unreviewed', 'approved', 'rejected']),
  // reviewedBy / reviewedAt are intentionally NOT accepted from the client —
  // the server stamps them (normalizeEvidenceLinks) from the acting user.
});

const EstimateLineBody = z.object({
  priceBookItemId: z.string().max(100).nullable(),
  description: z.string().min(1).max(300),
  unit: z.string().max(60).nullable(),
  quantity: z.number().positive().finite().max(1_000_000),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
  isAdder: z.boolean(),
  evidenceLinks: z.array(EvidenceLinkBody).max(100).optional(),
});

const PutEstimateBody = z.object({
  wastePercent: z.number().min(0).max(100),
  lines: z.array(EstimateLineBody).max(200),
  note: z.string().max(2000).nullable().optional(),
});

// GET /inspections/:inspectionId/estimate — the stored estimate or null.
// The measuredBasis in the response always reflects current field measurements
// (LF values are re-fetched on every GET so they stay fresh even if measurements
// were updated after the estimate was last saved).
router.get('/inspections/:inspectionId/estimate', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const [inspection, measurements] = await Promise.all([
    loadInspectionInCompany(inspectionId, actor.companyId),
    db
      .select({ measurementType: measurementsTable.measurementType, value: measurementsTable.value })
      .from(measurementsTable)
      .where(
        and(
          eq(measurementsTable.inspectionId, inspectionId),
          eq(measurementsTable.companyId, actor.companyId),
          eq(measurementsTable.subjectType, 'inspection'),
        ),
      ),
  ]);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  const stored = inspection.estimate ?? null;
  if (!stored) {
    res.json({ estimate: null });
    return;
  }

  // Augment stored measuredBasis with fresh LF data.
  const linearFeetByType: Record<string, number> = {};
  for (const m of measurements) {
    const cur = linearFeetByType[m.measurementType] ?? 0;
    linearFeetByType[m.measurementType] = Math.round((cur + m.value) * 100) / 100;
  }
  const totalLinearFeet =
    Math.round(Object.values(linearFeetByType).reduce((s, v) => s + v, 0) * 100) / 100;

  res.json({
    estimate: {
      ...stored,
      measuredBasis: { ...stored.measuredBasis, linearFeetByType, totalLinearFeet },
    },
  });
});

// PUT /inspections/:inspectionId/estimate — save (full replace) the estimate.
router.put('/inspections/:inspectionId/estimate', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const parsed = PutEstimateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  // Snapshot line items referencing the price book must belong to this
  // company — a cross-tenant id would silently launder another company's
  // catalog into the report.
  const refIds = [
    ...new Set(
      parsed.data.lines.map((l) => l.priceBookItemId).filter((id): id is string => id != null),
    ),
  ];
  const refItemById = new Map<
    string,
    { id: string; name: string; unit: string | null; unitPrice: number }
  >();
  if (refIds.length > 0) {
    const owned = await db
      .select({
        id: priceBookItemsTable.id,
        name: priceBookItemsTable.name,
        unit: priceBookItemsTable.unit,
        unitPrice: priceBookItemsTable.unitPrice,
      })
      .from(priceBookItemsTable)
      .where(
        and(
          eq(priceBookItemsTable.companyId, actor.companyId),
          inArray(priceBookItemsTable.id, refIds),
        ),
      );
    if (owned.length !== refIds.length) {
      res.status(400).json({ error: 'Unknown price book item referenced' });
      return;
    }
    for (const item of owned) refItemById.set(item.id, item);
  }

  // Referenced lines snapshot the price book AS STORED — description, unit
  // and unit price come from the DB, never the client, so a tampered body
  // can't launder a fake price behind a legitimate item id. Manual lines
  // (priceBookItemId = null) keep the client values.
  const lineInputs = parsed.data.lines.map((line) => {
    const ref = line.priceBookItemId ? refItemById.get(line.priceBookItemId) : undefined;
    return ref
      ? {
          ...line,
          description: ref.name,
          unit: ref.unit,
          unitPriceCents: ref.unitPrice,
        }
      : line;
  });

  // Evidence links: validate targets belong to THIS inspection (dangling ids
  // rejected) and stamp review metadata server-side. Prior stamps are kept
  // for unchanged decisions so idempotent outbox replays don't churn them.
  const anyLinks = lineInputs.some((l) => (l.evidenceLinks?.length ?? 0) > 0);
  let normalizedLinksByLine: (EvidenceLink[] | undefined)[] = lineInputs.map(() => undefined);
  if (anyLinks) {
    const [photoRows, damageRows] = await Promise.all([
      db
        .select({ id: inspectionPhotosTable.id })
        .from(inspectionPhotosTable)
        .where(
          and(
            eq(inspectionPhotosTable.inspectionId, inspectionId),
            eq(inspectionPhotosTable.companyId, actor.companyId),
          ),
        ),
      db
        .select({ id: damageInstancesTable.id })
        .from(damageInstancesTable)
        .where(
          and(
            eq(damageInstancesTable.inspectionId, inspectionId),
            eq(damageInstancesTable.companyId, actor.companyId),
          ),
        ),
    ]);
    const validPhotoIds = new Set(photoRows.map((r) => r.id));
    const validDamageInstanceIds = new Set(damageRows.map((r) => r.id));
    // Prior review stamps across the whole stored estimate (lines may move).
    const prior = new Map<string, EvidenceLink>();
    const storedEstimate = inspection.estimate as InspectionEstimate | null;
    for (const line of storedEstimate?.lines ?? []) {
      for (const link of line.evidenceLinks ?? []) {
        prior.set(`${link.targetType}:${link.targetId}`, link);
      }
    }
    const now = new Date().toISOString();
    normalizedLinksByLine = [];
    for (const line of lineInputs) {
      const result = normalizeEvidenceLinks(line.evidenceLinks, {
        validPhotoIds,
        validDamageInstanceIds,
        reviewerUserId: actor.userId,
        now,
        prior,
      });
      if ('error' in result) {
        res.status(400).json({ error: result.error });
        return;
      }
      normalizedLinksByLine.push(result.links.length > 0 ? result.links : undefined);
    }
  }

  const [slopes, sidingFacets, linearMeasurements] = await Promise.all([
    db
      .select({ areaSqft: inspectionSlopesTable.areaSqft })
      .from(inspectionSlopesTable)
      .where(
        and(
          eq(inspectionSlopesTable.inspectionId, inspectionId),
          eq(inspectionSlopesTable.companyId, actor.companyId),
        ),
      ),
    db
      .select({ id: inspectionSidingFacetsTable.id })
      .from(inspectionSidingFacetsTable)
      .where(
        and(
          eq(inspectionSidingFacetsTable.inspectionId, inspectionId),
          eq(inspectionSidingFacetsTable.companyId, actor.companyId),
        ),
      ),
    db
      .select({ measurementType: measurementsTable.measurementType, value: measurementsTable.value })
      .from(measurementsTable)
      .where(
        and(
          eq(measurementsTable.inspectionId, inspectionId),
          eq(measurementsTable.companyId, actor.companyId),
          eq(measurementsTable.subjectType, 'inspection'),
        ),
      ),
  ]);

  // computeLines only does money math — strip the raw client links and
  // attach the server-normalized ones plus approved-only derived arrays.
  const { lines: computedLines, subtotalCents } = computeLines(
    lineInputs.map(({ evidenceLinks: _drop, ...rest }) => rest),
  );
  const lines = computedLines.map((line, i) => {
    const links = normalizedLinksByLine[i];
    if (!links) return line;
    const approved = links.filter((l) => l.reviewStatus === 'approved');
    return {
      ...line,
      evidenceLinks: links,
      linkedPhotoIds: approved
        .filter((l) => l.targetType === 'photo')
        .map((l) => l.targetId),
      linkedDamageInstanceIds: approved
        .filter((l) => l.targetType === 'damage_instance')
        .map((l) => l.targetId),
    };
  });
  const estimate = {
    wastePercent: parsed.data.wastePercent,
    measuredBasis: computeMeasuredBasis({
      slopeAreasSqft: slopes.map((s) => s.areaSqft),
      damagedSidingFacetCount: sidingFacets.length,
      wastePercent: parsed.data.wastePercent,
      linearMeasurements,
    }),
    lines,
    subtotalCents,
    note: parsed.data.note ?? null,
    updatedAt: new Date().toISOString(),
  };

  const [updated] = await db
    .update(inspectionsTable)
    .set({ estimate })
    .where(
      and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, actor.companyId)),
    )
    .returning();

  res.json({ estimate: updated?.estimate ?? estimate });
});

// GET /inspections/:inspectionId/summary — returns the stored AI summary or null.
router.get('/inspections/:inspectionId/summary', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  res.json({ summary: inspection.aiSummary ?? null });
});

// POST /inspections/:inspectionId/summary — calls Claude Sonnet and stores result.
// Optional body: { userPrompt?: string } for regeneration with custom guidance.
// Uses the same write-authorization path as all other inspection mutations:
// only the assigned inspector or a manager/admin may trigger or overwrite the
// AI summary (allowLocked: true so it can be regenerated post-submission too).
// POST /inspections/:inspectionId/analyze-measurements
// Claude Opus reads the uploaded measurements report PDF and returns a
// structured parsed payload for rep review. Does NOT write to the database —
// call apply-measurements to commit confirmed values.
router.post('/inspections/:inspectionId/analyze-measurements', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  if (!inspection.measurementsReportUrl) {
    res.status(422).json({ error: 'No measurements report has been uploaded for this inspection.' });
    return;
  }

  // ── Fetch PDF from GCS and base64-encode for Claude ────────────────────────
  // buf is kept at outer scope so the overview image extraction below can also
  // write it to a temp file for ImageMagick without a second download.
  let pdfBase64: string;
  let buf: Buffer;
  try {
    const file = await objectStorageService.getObjectEntityFile(inspection.measurementsReportUrl);
    const [downloaded] = await file.download();
    buf = downloaded;
    pdfBase64 = buf.toString('base64');
  } catch (err) {
    req.log.error({ err }, 'Failed to read measurements report from storage');
    res.status(422).json({ error: 'Could not read the measurements report from storage.' });
    return;
  }

  const PARSE_PROMPT = `You are a roofing measurements expert. The attached PDF is a roofing measurements report (e.g. EagleView, GAF QuickMeasure, Hover, or similar).

Extract ALL measurements and return ONLY a valid JSON object — no markdown fences, no explanation — with this exact shape:

{
  "slopes": [
    { "label": "F1", "areaSqft": 245.5, "pitchRise": 4, "pitchRun": 12, "materialType": "asphalt_shingle", "compassBearing": 180 }
  ],
  "linears": {
    "ridge_lf": 32,
    "hip_lf": 18,
    "valley_lf": 12,
    "eave_lf": 64,
    "rake_lf": 28
  },
  "totals": {
    "total_area_sqft": 1850.0,
    "total_squares": 18.5,
    "waste_factor_pct": 12
  },
  "accessories": {
    "drip_edge_lf": 120,
    "starter_lf": 120,
    "step_flashing_lf": 45,
    "counter_flashing_lf": 30
  },
  "sidingFacets": [
    { "label": "S1", "areaSqft": 180.0 }
  ],
  "confidence": "high",
  "notes": null,
  "overviewPageNumber": 0
}

Rules:
- Sort slopes by descending areaSqft — the largest slope is always F1, the second-largest F2, and so on. Never use report page order for labeling.
- pitchRise and pitchRun are integers (4/12 pitch → pitchRise: 4, pitchRun: 12).
- materialType must be one of: asphalt_shingle, cedar_shake, standing_seam_metal — or null if not stated.
- compassBearing: the 0–360° azimuth of each slope's downhill-facing direction. Extract from the report's per-facet bearing data — EagleView labels this "Azimuth", Hover labels it "Orientation", GAF labels it "Bearing". Set null when the report does not include per-facet bearing data.
- linears: include ridge_lf, hip_lf, valley_lf, eave_lf, rake_lf only when explicitly stated; omit absent keys.
- totals: total_area_sqft and total_squares are usually on the report summary page. Include waste_factor_pct if stated.
- accessories: drip_edge_lf, starter_lf, step_flashing_lf, counter_flashing_lf — include only when explicitly listed.
- sidingFacets: include only if the report contains siding or wall measurements.
- confidence: "high" = values clearly stated; "medium" = some estimated; "low" = document unclear or unreadable.
- notes: brief string noting any missing data or quality issues, or null.
- Set any numeric field to null if you cannot determine it confidently.
- overviewPageNumber: the 0-based index of the page that contains the labeled roof overview diagram showing each plane with its area. EagleView puts this on page 1 (index 0), GAF/QuickMeasure on page 2 (index 1). Set null if no diagram page is present.`;

  type RawParsed = {
    slopes?: Array<{ label: string; areaSqft?: number | null; pitchRise?: number | null; pitchRun?: number | null; materialType?: string | null; compassBearing?: number | null }>;
    linears?: Record<string, number | null>;
    totals?: Record<string, number | null>;
    accessories?: Record<string, number | null>;
    sidingFacets?: Array<{ label: string; areaSqft?: number | null }>;
    confidence?: string;
    notes?: string | null;
    overviewPageNumber?: number | null;
  };

  let raw: RawParsed;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          } as never,
          { type: 'text', text: PARSE_PROMPT },
        ],
      }],
    });

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    raw = JSON.parse(cleaned) as RawParsed;
  } catch (err) {
    req.log.error({ err }, 'Claude measurements analysis failed');
    res.status(502).json({ error: 'AI analysis failed. Please try again.' });
    return;
  }

  // ── Measurement report page rendering ──────────────────────────────────────
  // Render every page of the PDF to JPEG and save as inspection_photos rows
  // (subjectType 'measurement_report_page') so mobile can flip between pages
  // without any further API calls.  Failures are non-fatal per page — mobile
  // falls back to render-overview-image for entries that are missing.
  let overviewImageUrl: string | null = null;
  const rawPageNum = raw.overviewPageNumber;
  const identifiedPage = (typeof rawPageNum === 'number' && rawPageNum >= 0 && rawPageNum <= 9)
    ? Math.floor(rawPageNum) : null;
  const measurementPages: Array<{ page: number; url: string }> = [];

  let tmpDir: string | null = null;
  try {
    tmpDir = mkdtempSync(pathJoin(tmpdir(), 'rt-overview-'));
    const pdfPath = pathJoin(tmpDir, 'report.pdf');
    writeFileSync(pdfPath, buf);

    // Clear stale pages from any previous analysis.
    await db.delete(inspectionPhotosTable).where(
      and(
        eq(inspectionPhotosTable.inspectionId, inspectionId),
        eq(inspectionPhotosTable.subjectType, 'measurement_report_page'),
      ),
    );

    for (let pageNum = 0; pageNum <= 49; pageNum++) {
      const jpegPath = pathJoin(tmpDir, `page-${pageNum}.jpg`);
      try {
        // IMv7 binary is `magick`; exits non-zero when the page index is past
        // the end of the PDF — use that as the loop terminator.
        execFileSync('magick', [
          '-density', '150',
          `${pdfPath}[${pageNum}]`,
          '-resize', 'x1400',
          '-quality', '85',
          jpegPath,
        ], { timeout: 30_000 });
      } catch {
        break; // no more pages
      }
      try {
        const jpegBuf    = readFileSync(jpegPath);
        const sha256     = createHash('sha256').update(jpegBuf).digest('hex');
        const objectPath = await objectStorageService.uploadObjectBuffer(jpegBuf, 'image/jpeg');
        await db.insert(inspectionPhotosTable).values({
          companyId: inspection.companyId,
          inspectionId,
          subjectType: 'measurement_report_page',
          subjectId: String(pageNum),
          url: objectPath,
          sha256,
          includeInProofPackage: false,
        });
        const signedUrl = await objectStorageService.getSignedDownloadUrl(objectPath, 10_800);
        measurementPages.push({ page: pageNum, url: signedUrl });
        if (pageNum === identifiedPage) overviewImageUrl = signedUrl;
      } catch (err) {
        req.log.warn({ err, pageNum }, 'Measurement page upload failed — skipping');
      }
    }

    // If the AI-identified page failed to render, fall back to page 0.
    if (identifiedPage !== null && overviewImageUrl === null && measurementPages.length > 0) {
      overviewImageUrl = measurementPages[0]!.url;
    }
  } catch (err) {
    req.log.warn({ err }, 'Measurement report page rendering failed');
  } finally {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  }

  // ── Facet inventory extraction ──────────────────────────────────────────────
  // Single-stage: read the same PDF, return facet count / areas / pitches.
  // Failure is non-fatal — the inspector falls back to manual slope ordering.
  let facetInventoryStatus: 'complete' | 'failed' = 'failed';
  let facetInventoryResult: FacetInventoryT | null = null;
  try {
    const inventory = await runFacetInventory(pdfBase64, req);
    facetInventoryResult = inventory;
    // Delete stale rows then reinsert for this inspection (area-descending).
    await db.delete(roofFacetsTable).where(eq(roofFacetsTable.inspectionId, inspectionId));
    if (inventory.facets.length > 0) {
      await db.insert(roofFacetsTable).values(
        inventory.facets.map((f, idx) => ({
          inspectionId,
          facetId: f.id,
          areaSqFt: f.areaSqFt,
          pitch: f.pitch,
          sortOrder: idx,
        })),
      );
    }
    await db.update(inspectionsTable)
      .set({ facetInventory: inventory, facetCount: inventory.facetCount, facetInventoryStatus: 'complete' })
      .where(eq(inspectionsTable.id, inspectionId));
    facetInventoryStatus = 'complete';
  } catch (err) {
    req.log.error({ err }, 'Facet inventory extraction failed');
    await db.update(inspectionsTable)
      .set({ facetInventoryStatus: 'failed' })
      .where(eq(inspectionsTable.id, inspectionId));
  }

  // Normalise into the typed ParsedMeasurements shape and return.
  const parsed = {
    slopes:       (raw.slopes ?? []).map(s => ({
      label:          s.label,
      areaSqft:       s.areaSqft ?? null,
      pitchRise:      s.pitchRise ?? null,
      pitchRun:       s.pitchRun ?? null,
      materialType:   s.materialType ?? null,
      compassBearing: typeof s.compassBearing === 'number' ? s.compassBearing : null,
    })),
    linears:      raw.linears      ?? {},
    totals:       raw.totals       ?? {},
    accessories:  raw.accessories  ?? {},
    sidingFacets: (raw.sidingFacets ?? []).map(f => ({ label: f.label, areaSqft: f.areaSqft ?? null })),
    confidence:        (raw.confidence as 'high' | 'medium' | 'low') ?? 'low',
    notes:             raw.notes ?? null,
    overviewImageUrl,
    overviewPageNumber: typeof rawPageNum === 'number' ? Math.floor(rawPageNum) : null,
  };

  res.json({ parsed, facetInventoryStatus, facetInventory: facetInventoryResult, measurementPages });
});

// ── Facet inventory extraction helpers ───────────────────────────────────────
// Single-stage extraction: read the PDF, return facet count / areas / pitches.
// The system prompt is stored verbatim on disk and loaded once at first use.
let facetExtractorPromptText: string | null = null;
function getFacetExtractorPrompt(): string {
  if (facetExtractorPromptText === null) {
    // The workflow launches from artifacts/api-server; fall back to repo-root.
    const candidates = [
      pathJoin(process.cwd(), 'prompts/facet-extractor.md'),
      pathJoin(process.cwd(), 'artifacts/api-server/prompts/facet-extractor.md'),
    ];
    for (const p of candidates) {
      try {
        facetExtractorPromptText = readFileSync(p, 'utf8');
        break;
      } catch { /* try next */ }
    }
    if (facetExtractorPromptText === null) {
      throw new Error(`facet-extractor prompt file not found; tried: ${candidates.join(', ')}`);
    }
  }
  return facetExtractorPromptText;
}

function stripJsonFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/** Parses "N/12" or "N:12" or bare "N" → rise integer. Returns null when unparseable. */
function parsePitchRise(pitch: string): number | null {
  const m = pitch.match(/^(\d+(?:\.\d+)?)\s*[/:]/);
  if (m) return parseFloat(m[1]!);
  const n = parseFloat(pitch);
  return Number.isFinite(n) ? n : null;
}

const facetInventorySchema = z.object({
  reportType: z.enum(['hover', 'gaf_quickmeasure', 'unknown']),
  property: z.object({
    address: z.string(),
    reportDate: z.string(),
    totalRoofAreaSqFt: z.number(),
    reportFacetCount: z.number(),
    predominantPitch: z.string(),
  }),
  facetCount: z.number().int(),
  facets: z.array(z.object({
    id: z.string(),
    areaSqFt: z.number(),
    pitch: z.string(),
  })),
  excluded: z.object({
    count: z.number().int(),
    areaSqFt: z.number(),
    facets: z.array(z.object({
      id: z.string(),
      areaSqFt: z.number(),
      pitch: z.string(),
    })),
  }),
  warnings: z.array(z.string()),
}).superRefine((inv, ctx) => {
  if (inv.facetCount !== inv.facets.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `facetCount (${inv.facetCount}) must equal facets.length (${inv.facets.length})` });
  }
  if (inv.reportType !== 'unknown' && inv.facets.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'facets must be non-empty unless reportType is "unknown"' });
  }
  for (const f of inv.facets) {
    const rise = parsePitchRise(f.pitch);
    if (rise !== null && rise < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `included facet ${f.id} has pitch "${f.pitch}" which parses to < 1/12 — should be excluded` });
    }
  }
  for (const f of inv.excluded.facets) {
    const rise = parsePitchRise(f.pitch);
    if (rise !== null && rise >= 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `excluded facet ${f.id} has pitch "${f.pitch}" which parses to >= 1/12 — should be included` });
    }
  }
});
type FacetInventoryT = z.infer<typeof facetInventorySchema>;

async function runFacetInventory(pdfBase64: string, req: Request): Promise<FacetInventoryT> {
  const systemPrompt = getFacetExtractorPrompt();
  let lastErrors = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const userContent = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } } as never,
      { type: 'text', text: attempt === 0 ? 'Analyze this report.' : `Your previous output failed validation: ${lastErrors}. Return corrected JSON only.` },
    ];
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent as never }],
    });
    const rawText = message.content[0]?.type === 'text' ? message.content[0].text : '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFences(rawText));
    } catch {
      req.log.warn({ rawText: rawText.slice(0, 2000) }, 'facet-extractor: model output was not JSON');
      lastErrors = 'output was not valid JSON';
      continue;
    }
    const result = facetInventorySchema.safeParse(parsed);
    if (result.success) return result.data;
    req.log.warn({ errors: result.error.issues, rawText: rawText.slice(0, 2000) }, 'facet-extractor: output failed validation');
    lastErrors = result.error.issues.map(i => i.message).join('; ');
  }
  throw new Error(`facet-extractor output failed validation after retry: ${lastErrors}`);
}

// POST /inspections/:inspectionId/render-overview-image
// Renders a single PDF page to JPEG on demand and returns a short-lived signed
// URL.  Called by mobile when the initial analysis lacked an overviewImageUrl
// (e.g. runs done before the magick binary fix) or when the URL has expired.
router.post('/inspections/:inspectionId/render-overview-image', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  if (!inspection.measurementsReportUrl) {
    res.status(422).json({ error: 'No measurements report has been uploaded for this inspection.' });
    return;
  }

  const pageNumber = typeof req.body?.pageNumber === 'number'
    ? Math.max(0, Math.min(49, Math.floor(req.body.pageNumber)))
    : 0;

  let buf: Buffer;
  try {
    const file = await objectStorageService.getObjectEntityFile(inspection.measurementsReportUrl);
    const [downloaded] = await file.download();
    buf = downloaded;
  } catch (err) {
    req.log.error({ err }, 'render-overview-image: failed to read PDF from storage');
    res.status(422).json({ error: 'Could not read the measurements report from storage.' });
    return;
  }

  let tmpDir: string | null = null;
  try {
    tmpDir = mkdtempSync(pathJoin(tmpdir(), 'rt-overview-'));
    const pdfPath  = pathJoin(tmpDir, 'report.pdf');
    const jpegPath = pathJoin(tmpDir, 'overview.jpg');
    writeFileSync(pdfPath, buf);
    execFileSync('magick', [
      '-density', '150',
      `${pdfPath}[${pageNumber}]`,
      '-resize', 'x1400',
      '-quality', '85',
      jpegPath,
    ], { timeout: 30_000 });
    const jpegBuf    = readFileSync(jpegPath);
    const objectPath = await objectStorageService.uploadObjectBuffer(jpegBuf, 'image/jpeg');
    const url        = await objectStorageService.getSignedDownloadUrl(objectPath, 10_800);
    res.json({ url });
  } catch (err) {
    req.log.warn({ err, pageNumber }, 'render-overview-image: magick render failed');
    res.status(500).json({ error: 'Failed to render the overview image from the PDF.' });
  } finally {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  }
});

// GET /inspections/:inspectionId/measurement-pages
// Returns all measurement-report-page photos for this inspection with fresh
// 3-hour signed URLs, sorted by page number.  Called by mobile when the
// in-memory page store is cold (app restart or URL expiry).
router.get('/inspections/:inspectionId/measurement-pages', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res, { allowLocked: true });
  if (!inspection) return;

  const rows = await db
    .select()
    .from(inspectionPhotosTable)
    .where(
      and(
        eq(inspectionPhotosTable.inspectionId, inspectionId),
        eq(inspectionPhotosTable.companyId, actor.companyId),
        eq(inspectionPhotosTable.subjectType, 'measurement_report_page'),
      ),
    );

  const pages = await Promise.all(
    rows.map(async (row) => ({
      page: parseInt(row.subjectId ?? '0', 10),
      url:  await objectStorageService.getSignedDownloadUrl(row.url, 10_800),
    })),
  );
  pages.sort((a, b) => a.page - b.page);

  res.json({ pages });
});

// POST /inspections/:inspectionId/apply-measurements
// Commits a rep-confirmed set of measurements returned by analyze-measurements.
// Records whose label / measurementType already exist are skipped (idempotent).
router.post('/inspections/:inspectionId/apply-measurements', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res);
  if (!inspection) return;

  type ApplyBody = {
    slopes?: Array<{ label: string; areaSqft?: number | null; pitchRise?: number | null; pitchRun?: number | null; materialType?: string | null; compassBearing?: number | null }>;
    linears?: Record<string, number | null>;
    totals?: Record<string, number | null>;
    accessories?: Record<string, number | null>;
    sidingFacets?: Array<{ label: string; areaSqft?: number | null }>;
  };
  const body = req.body as ApplyBody;

  // Unit lookup for inspection-level measurement types.
  function measurementUnit(type: string): string {
    if (type === 'total_area_sqft') return 'sqft';
    if (type === 'total_squares') return 'sq';
    if (type === 'waste_factor_pct') return '%';
    return 'lf';
  }

  const ALLOWED_LINEARS    = new Set(['ridge_lf', 'hip_lf', 'valley_lf', 'eave_lf', 'rake_lf']);
  const ALLOWED_TOTALS     = new Set(['total_area_sqft', 'total_squares', 'waste_factor_pct']);
  const ALLOWED_ACCESSORIES= new Set(['drip_edge_lf', 'starter_lf', 'step_flashing_lf', 'counter_flashing_lf']);

  // Load existing records once to skip duplicates.
  const [existingSlopes, existingMeasurements, existingSiding] = await Promise.all([
    db.select({ label: inspectionSlopesTable.label })
      .from(inspectionSlopesTable)
      .where(and(eq(inspectionSlopesTable.inspectionId, inspectionId), eq(inspectionSlopesTable.companyId, actor.companyId))),
    db.select({ measurementType: measurementsTable.measurementType })
      .from(measurementsTable)
      .where(and(
        eq(measurementsTable.inspectionId, inspectionId),
        eq(measurementsTable.companyId, actor.companyId),
        eq(measurementsTable.subjectType, 'inspection'),
      )),
    db.select({ label: inspectionSidingFacetsTable.label })
      .from(inspectionSidingFacetsTable)
      .where(and(eq(inspectionSidingFacetsTable.inspectionId, inspectionId), eq(inspectionSidingFacetsTable.companyId, actor.companyId))),
  ]);

  const existingSlopeLabels      = new Set(existingSlopes.map(s => s.label));
  const existingMeasurementTypes = new Set(existingMeasurements.map(m => m.measurementType));
  const existingSidingLabels     = new Set(existingSiding.map(s => s.label));

  let slopesCreated      = 0;
  let measurementsCreated = 0;
  let sidingFacetsCreated = 0;

  // Slopes.
  for (const slope of body.slopes ?? []) {
    if (!slope.label || existingSlopeLabels.has(slope.label)) continue;
    await db.insert(inspectionSlopesTable).values({
      companyId:    actor.companyId,
      inspectionId,
      label:        slope.label,
      ...(slope.areaSqft       != null && { areaSqft:       slope.areaSqft }),
      ...(slope.pitchRise      != null && { pitchRise:      slope.pitchRise }),
      ...(slope.pitchRun       != null && { pitchRun:       slope.pitchRun }),
      ...(slope.materialType   != null && { materialType:   slope.materialType }),
      ...(slope.compassBearing != null && { compassBearing: slope.compassBearing }),
    });
    slopesCreated++;
  }

  // Whole-roof linears, totals, and accessories all go into measurementsTable.
  const allMeasurementEntries: Array<[string, number | null | undefined, Set<string>]> = [
    ...Object.entries(body.linears     ?? {}).map(([k, v]) => [k, v, ALLOWED_LINEARS]     as [string, number | null | undefined, Set<string>]),
    ...Object.entries(body.totals      ?? {}).map(([k, v]) => [k, v, ALLOWED_TOTALS]      as [string, number | null | undefined, Set<string>]),
    ...Object.entries(body.accessories ?? {}).map(([k, v]) => [k, v, ALLOWED_ACCESSORIES] as [string, number | null | undefined, Set<string>]),
  ];

  for (const [type, value, allowed] of allMeasurementEntries) {
    if (!allowed.has(type) || value == null || existingMeasurementTypes.has(type)) continue;
    await db.insert(measurementsTable).values({
      companyId:       actor.companyId,
      inspectionId,
      subjectType:     'inspection',
      subjectId:       null,
      measurementType: type,
      value:           Number(value),
      unit:            measurementUnit(type),
    });
    measurementsCreated++;
  }

  // Siding facets.
  for (const facet of body.sidingFacets ?? []) {
    if (!facet.label || existingSidingLabels.has(facet.label)) continue;
    await db.insert(inspectionSidingFacetsTable).values({
      companyId:    actor.companyId,
      inspectionId,
      label:        facet.label,
      ...(facet.areaSqft != null && { areaSqft: facet.areaSqft }),
    });
    sidingFacetsCreated++;
  }

  res.json({ applied: { slopes: slopesCreated, measurements: measurementsCreated, sidingFacets: sidingFacetsCreated } });
});

router.post('/inspections/:inspectionId/summary', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res, { allowLocked: true });
  if (!inspection) return;

  const userPrompt =
    typeof (req.body as { userPrompt?: unknown })?.userPrompt === 'string'
      ? ((req.body as { userPrompt: string }).userPrompt.trim())
      : '';

  // Load company AI settings for an optional custom system prompt.
  const [company] = await db
    .select({ aiSettings: companiesTable.aiSettings })
    .from(companiesTable)
    .where(eq(companiesTable.id, actor.companyId));

  const companySettings = company?.aiSettings as { systemPrompt?: string | null } | null | undefined;
  const systemPrompt = composeAiSystemPrompt(companySettings?.systemPrompt);

  // Hydrate children so the prompt contains complete field data.
  const children = await hydrateInspectionChildren(inspectionId, actor.companyId);

  const brief = buildInspectionBrief(inspection, children);
  const userContent = userPrompt
    ? `${brief}\n\n---\nAdditional focus for this summary: ${userPrompt}`
    : brief;

  let summaryResult: {
    forensicSummary: string;
    repairabilityText: string;
    confidence?: string;
    missingOrUnverifiedItems?: string[];
    qualityFlags?: string[];
  };
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });

    const rawText =
      message.content[0].type === 'text' ? message.content[0].text : '';

    // Strip optional markdown JSON fences before parsing.
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

    summaryResult = parseAiSummaryResponse(rawText, cleaned);
  } catch (err) {
    req.log.error({ err }, 'Claude summary generation failed');
    res.status(502).json({ error: 'AI summary generation failed. Please try again.' });
    return;
  }

  // Contractor-lane lint over the AI narrative before storage. The content
  // is stored verbatim — never rewritten — with the lint result alongside it
  // so reviewers can see exactly what tripped which rule.
  const summaryLint = lintReportFragments([
    { fragmentRef: 'forensicSummary', contentClass: 'construction_fact', text: summaryResult.forensicSummary },
    { fragmentRef: 'repairabilityText', contentClass: 'repairability_analysis', text: summaryResult.repairabilityText },
  ]);

  const summary = {
    ...summaryResult,
    generatedAt: new Date().toISOString(),
    lint: summaryLint,
  };

  await db
    .update(inspectionsTable)
    .set({ aiSummary: summary })
    .where(eq(inspectionsTable.id, inspectionId));

  res.json({ summary });
});

// PATCH /inspections/:inspectionId/summary — manual edit of the stored AI
// summary narrative without regenerating. Same write authorization as
// generation (assigned inspector or manager/admin; allowLocked so a
// post-submission summary can be corrected too). The edited text goes
// through the SAME contractor-lane lint as generated text — the lint is the
// enforcement layer, so a manual edit can't bypass it. Edits are stamped
// (editedAt/editedBy) so the record shows the narrative was human-revised.
router.patch('/inspections/:inspectionId/summary', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res, { allowLocked: true });
  if (!inspection) return;

  const existing = inspection.aiSummary;
  if (!existing) {
    res.status(400).json({ error: 'No summary exists yet — generate one first' });
    return;
  }

  const body = req.body as { forensicSummary?: unknown; repairabilityText?: unknown };
  const forensicSummary =
    typeof body.forensicSummary === 'string' ? body.forensicSummary.trim() : undefined;
  const repairabilityText =
    typeof body.repairabilityText === 'string' ? body.repairabilityText.trim() : undefined;
  if (forensicSummary === undefined && repairabilityText === undefined) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }
  if (forensicSummary !== undefined && forensicSummary.length === 0) {
    res.status(400).json({ error: 'The forensic summary cannot be empty' });
    return;
  }
  if (forensicSummary !== undefined && forensicSummary.length > 20000) {
    res.status(400).json({ error: 'Summary is too long' });
    return;
  }

  const nextForensic = forensicSummary ?? existing.forensicSummary ?? '';
  const nextRepairability = repairabilityText ?? existing.repairabilityText ?? '';

  const summaryLint = lintReportFragments([
    { fragmentRef: 'forensicSummary', contentClass: 'construction_fact', text: nextForensic },
    { fragmentRef: 'repairabilityText', contentClass: 'repairability_analysis', text: nextRepairability },
  ]);

  const summary = {
    ...existing,
    forensicSummary: nextForensic,
    repairabilityText: nextRepairability,
    lint: summaryLint,
    editedAt: new Date().toISOString(),
    editedBy: actor.userId,
  };

  await db
    .update(inspectionsTable)
    .set({ aiSummary: summary })
    .where(eq(inspectionsTable.id, inspectionId));

  res.json({ summary });
});

// ── Report Compilation (Gemini 2.5-flash) ─────────────────────────────────

/**
 * Strict allowlist sanitizer for LLM-generated HTML fragments.
 * Strips all scripts, event handlers, external embeds, and javascript: URLs.
 * Only structural/formatting tags with safe attributes are permitted.
 */
function sanitizeReportFragment(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'p', 'br', 'strong', 'em', 'b', 'i',
      'ul', 'ol', 'li',
      'h2', 'h3', 'h4',
      'span', 'div',
    ],
    allowedAttributes: {
      // class is safe; style is allowed but expressions are stripped below.
      '*': ['class', 'style'],
      'td': ['colspan', 'rowspan'],
      'th': ['colspan', 'rowspan', 'scope'],
    },
    allowedStyles: {
      '*': {
        color: [/^[a-zA-Z0-9#(), .%]+$/],
        'background-color': [/^[a-zA-Z0-9#(), .%]+$/],
        'font-size': [/^[\d.]+(%|px|em|rem|pt)$/],
        'font-weight': [/^(bold|normal|\d+)$/],
        'text-align': [/^(left|right|center|justify)$/],
        padding: [/^[\d. px%]+$/],
        margin: [/^[\d. px%]+$/],
        border: [/^[\d. pxsolid#a-zA-Z]+$/],
        'border-radius': [/^[\d.]+(%|px|em|rem)$/],
        opacity: [/^[\d.]+$/],
        display: [/^(block|inline|flex|grid|table|table-row|table-cell|none)$/],
        'vertical-align': [/^(top|middle|bottom|baseline)$/],
      },
    },
    // Strip unknown tags entirely (don't preserve their content).
    disallowedTagsMode: 'discard',
  });
}


/** Try to get a signed download URL; returns null if the path is not usable. */
async function tryGetPhotoSignedUrl(
  objSvc: ObjectStorageService,
  photoUrl: string,
): Promise<string | null> {
  return objSvc.tryGetSignedObjectUrl(photoUrl, 900); // 15-min TTL
}

// GET /inspections/:inspectionId/report/code-citations
// Lists the code citations from the company state pack that applies to this
// inspection's property state so the rep can pick which ones the compiled
// Proof Package should include. Gated like compile (inspector or manager+).
router.get('/inspections/:inspectionId/report/code-citations', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res, { allowLocked: true });
  if (!inspection) return;

  const allPacks = await db
    .select()
    .from(companyJurisdictionPacksTable)
    .where(eq(companyJurisdictionPacksTable.companyId, actor.companyId));

  // Same state resolution as the compile route: parse from the address,
  // else a company with exactly one pack unambiguously uses that one.
  const stateMatch = (inspection.address ?? '').match(/\b([A-Za-z]{2})[,]?\s+\d{5}(?:-\d{4})?\b/);
  const propertyState =
    stateMatch?.[1]?.toUpperCase() ?? (allPacks.length === 1 ? allPacks[0]!.state : null);
  const matching = propertyState ? allPacks.filter((p) => p.state === propertyState) : [];

  res.json(
    ListInspectionReportCodeCitationsResponse.parse({
      state: propertyState,
      packs: matching
        .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction))
        .map((p) => ({
          id: p.id,
          jurisdiction: p.jurisdiction,
          state: p.state,
          openingStatements: p.openingStatements ?? [],
          uppaLaw: p.uppaLaw ?? null,
          uppaStatement: p.uppaStatement ?? null,
          generalCodeCitations: dedupeCitationsByKey(p.generalCodeCitations ?? []),
          roofingCodeCitations: dedupeCitationsByKey(p.roofingCodeCitations ?? []),
          sidingCodeCitations: dedupeCitationsByKey(p.sidingCodeCitations ?? []),
        })),
    }),
  );
});

// Defensive dedupe (keep first) — new upserts reject duplicate keys, but a
// legacy pack with duplicates would make key-based selection ambiguous.
function dedupeCitationsByKey<T extends { key: string }>(citations: T[]): T[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const k = c.key.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// POST /inspections/:inspectionId/report/compile
// Calls Gemini 2.5-flash to arrange inspection data into the HTML report
// template, uploads the result to object storage, and writes the path back.
// Write-gated via loadWritableInspection (allowLocked: true) — the inspector
// or any manager can trigger or re-trigger after submission.
router.post('/inspections/:inspectionId/report/compile', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadWritableInspection(inspectionId, actor, res, { allowLocked: true });
  if (!inspection) return;

  // AI summary must exist — the Summary step must be completed first.
  const aiSummary = inspection.aiSummary as {
    forensicSummary: string;
    repairabilityText: string;
    generatedAt: string;
  } | null;
  if (!aiSummary) {
    res.status(400).json({ error: 'AI summary not yet generated — complete the Summary step first.' });
    return;
  }

  // ── Stage 0 readiness re-validation ───────────────────────────────────────
  // Server-side gate: recompute the full 9-item readiness checklist before
  // accepting a compile request. Any hard 'fail' item blocks compile so the
  // UI cannot be bypassed by a direct API call.
  {
    const [
      compileProducts,
      compileAttests,
      compileTestSquares,
      compileDamageInstances,
      compileSlopes,
      [compileCompany],
      compileAhjPacks,
      compileLegacyPacks,
      compileClaimSections,
      compileStandardsEntries,
    ] = await Promise.all([
      db.select({
        identificationMethod: inspectionProductsTable.identificationMethod,
        discontinued: inspectionProductsTable.discontinued,
        ordinaryAvailability: inspectionProductsTable.ordinaryAvailability,
      }).from(inspectionProductsTable)
        .where(and(eq(inspectionProductsTable.inspectionId, inspectionId), eq(inspectionProductsTable.companyId, actor.companyId))),
      db.select({ attestationType: attestationsTable.attestationType })
        .from(attestationsTable)
        .where(and(eq(attestationsTable.inspectionId, inspectionId), eq(attestationsTable.companyId, actor.companyId))),
      db.select({ id: testSquaresTable.id })
        .from(testSquaresTable)
        .where(and(eq(testSquaresTable.inspectionId, inspectionId), eq(testSquaresTable.companyId, actor.companyId))),
      db.select({ id: damageInstancesTable.id })
        .from(damageInstancesTable)
        .where(and(eq(damageInstancesTable.inspectionId, inspectionId), eq(damageInstancesTable.companyId, actor.companyId)))
        .limit(1),
      db.select({ materialType: inspectionSlopesTable.materialType })
        .from(inspectionSlopesTable)
        .where(and(eq(inspectionSlopesTable.inspectionId, inspectionId), eq(inspectionSlopesTable.companyId, actor.companyId))),
      db.select({ contractorLicenses: companiesTable.contractorLicenses, qualificationsText: companiesTable.qualificationsText })
        .from(companiesTable).where(eq(companiesTable.id, actor.companyId)).limit(1),
      db.select({ packType: ahjPacksTable.packType, jurisdiction: ahjPacksTable.jurisdiction })
        .from(ahjPacksTable).where(eq(ahjPacksTable.companyId, actor.companyId)),
      db.select({ state: companyJurisdictionPacksTable.state })
        .from(companyJurisdictionPacksTable).where(eq(companyJurisdictionPacksTable.companyId, actor.companyId)),
      db.select({ sectionType: claimSectionsTable.sectionType, libraryVersionSnapshot: claimSectionsTable.libraryVersionSnapshot })
        .from(claimSectionsTable).where(eq(claimSectionsTable.inspectionId, inspectionId)),
      db.select({ entryKey: standardsEntriesTable.entryKey, verificationStatus: standardsEntriesTable.verificationStatus })
        .from(standardsEntriesTable).where(eq(standardsEntriesTable.companyId, actor.companyId)),
    ]);

    const readinessResult = computeReadiness({
      inspectionId,
      inspection: {
        ...inspection,
        rapGateReason: (inspection.rapGateReason as string | null | undefined) ?? null,
        estimate: (inspection.estimate as { lines?: Array<{ description?: string; categoryCode?: string }> } | null),
        temporaryRepairs: (inspection.temporaryRepairs as { performed?: boolean; openings?: boolean } | null),
        propertyProfile: (inspection.propertyProfile as { structureType?: string; garageAttached?: boolean } | null),
        interiorDamageFound: inspection.interiorDamageFound,
      },
      products: compileProducts.map(p => ({ identificationMethod: p.identificationMethod, discontinued: p.discontinued ?? null, ordinaryAvailability: p.ordinaryAvailability ?? null })),
      slopes: compileSlopes,
      attestations: compileAttests.map(a => ({ attestationType: a.attestationType ?? null })),
      testSquaresCount: compileTestSquares.length,
      damageInstancesCount: compileDamageInstances.length,
      company: { contractorLicenses: compileCompany?.contractorLicenses ?? null, qualificationsText: compileCompany?.qualificationsText ?? null },
      ahjPacks: compileAhjPacks,
      legacyJurisdictionStates: compileLegacyPacks.map(p => p.state),
      claimSections: compileClaimSections.map(s => ({ sectionType: s.sectionType, libraryVersionSnapshot: (s.libraryVersionSnapshot as { standardsEntryKeys?: string[] } | null) ?? null })),
      standardsEntries: compileStandardsEntries.map(e => ({ entryKey: e.entryKey, verificationStatus: e.verificationStatus })),
    });

    if (!readinessResult.overallPass) {
      const failingItems = readinessResult.items.filter(i => i.state === 'fail');
      res.status(400).json({
        error: 'Claim is not ready to compile. Resolve the following readiness items first.',
        failingItems: failingItems.map(i => ({ key: i.key, label: i.label, detail: i.detail })),
      });
      return;
    }
  }

  // Load children and inspector info in parallel.
  const children = await hydrateInspectionChildren(inspectionId, actor.companyId);
  const [[inspectorUser], [inspectorProfile]] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, inspection.inspectorUserId)),
    db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, inspection.inspectorUserId)),
  ]);

  const inspectorName =
    [inspectorUser?.firstName, inspectorUser?.lastName].filter(Boolean).join(' ') ||
    inspectorUser?.email ||
    'Inspector';
  const inspector = { name: inspectorName, email: inspectorUser?.email ?? null };

  // Build a stable photo index keyed by id — uses internal object storage paths
  // (NOT signed URLs). Signed URLs are generated at preview time so the stored
  // artifact never embeds expiring credentials.
  type PhotoIndexEntry = {
    objectPath: string;
    stage: string | null;
    triadRole: string | null;
    zone: string | null;
    subjectType: string | null;
  };
  const photoIndex: Record<string, PhotoIndexEntry> = {};
  for (const p of children.photos) {
    photoIndex[p.id] = {
      objectPath: p.url,   // stable /objects/... path or legacy https URL
      stage: p.stage ?? null,
      triadRole: p.triadRole ?? null,
      zone: p.zone ?? null,
      subjectType: p.subjectType ?? null,
    };
  }

  // Immutable evidence manifest — built entirely server-side from DB rows
  // (never AI-generated). Preserves each photo's provenance: source id,
  // original capture timestamp, integrity hash, and any non-destructive
  // annotations layered over the original. AI captions/groupings live
  // separately in photoGroupings and never replace this record.
  const findingLookups = {
    damageById: new Map(children.damageInstances.map((d) => [d.id, d])),
    slopeById: new Map(children.slopes.map((s) => [s.id, s])),
  };
  // The VAP final archive photo is archive-only by product rule: it stays
  // stored evidence but must never enter the report output (photo brief,
  // photo groupings, or evidence manifest) — enforced here, not on mobile.
  // The photoIndex above intentionally stays complete so explicitly referenced
  // protocol photos (e.g. RAP1) always resolve at render time.
  const curatedPhotos = children.photos.filter(
    (p) => !isVapArchiveOnlyPhoto(inspection.repairabilityAssessment, p.id),
  );
  const evidenceManifestEntries = curatedPhotos
    .map((p) => ({
      photoId: p.id,
      objectPath: p.url,
      sha256: p.sha256,
      capturedAtUtc: p.capturedAtUtc ? new Date(p.capturedAtUtc).toISOString() : null,
      uploadedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      stage: p.stage ?? null,
      subjectType: p.subjectType ?? null,
      subjectId: p.subjectId ?? null,
      triadRole: p.triadRole ?? null,
      zone: p.zone ?? null,
      annotations: p.overlayJson ?? null,
      hasExif: p.exifJson != null,
      // Compact immutable summary of the linked finding (photo → finding leg
      // of the evidence chain). Null when the photo has no subject link.
      linkedFinding: buildLinkedFindingSummary(
        { subjectType: p.subjectType ?? null, subjectId: p.subjectId ?? null },
        findingLookups,
      ),
    }))
    .sort((a, b) => a.photoId.localeCompare(b.photoId));

  // Approved evidence→scope links resolved at compile time from the stored
  // estimate. Unreviewed/rejected (incl. AI-suggested) links never enter the
  // snapshot or the manifest hash. Link changes therefore produce a new
  // compiled version with a new manifest digest automatically.
  const estimateForLinks = inspection.estimate as InspectionEstimate | null;
  const approvedScopeLinks = collectApprovedScopeLinks(estimateForLinks?.lines);
  const inspectionDate = inspection.lockedAt
    ? new Date(inspection.lockedAt).toISOString()
    : inspection.updatedAt
      ? new Date(inspection.updatedAt).toISOString()
      : null;
  const evidenceManifest = {
    manifestVersion: 2,
    inspectionId: inspection.id,
    inspectionDate,
    photoCount: evidenceManifestEntries.length,
    photos: evidenceManifestEntries,
    // Approved evidence→scope links are part of the manifest, so they are
    // covered by the integrity hash below.
    approvedScopeLinks,
  };
  // Integrity hash over the manifest itself so any later tampering with a
  // stored package is detectable (entries are sorted for a stable digest).
  const manifestSha256 = createHash('sha256')
    .update(JSON.stringify(evidenceManifest), 'utf-8')
    .digest('hex');

  // Build a concise structured brief for Gemini (not the full raw DB blob).
  const pp = inspection.propertyProfile as {
    propertyType?: string; stories?: number; roofAge?: number;
    roofAgeBasis?: string; deckType?: string;
  } | null;
  const arr = inspection.arrivalConditions as {
    sky?: string; windCondition?: string; tempF?: number; personnel?: string[];
  } | null;
  const raRaw = inspection.repairabilityAssessment as StoredRepairabilityAssessment | null;
  const raSummary = raRaw
    ? raRaw.version === 2
      ? (['roof', 'siding'] as const)
          .filter((s) => raRaw[s])
          .map(
            (s) =>
              `${s}: ${DETERMINATION_LABELS[raRaw[s]!.determination] ?? raRaw[s]!.determination}`,
          )
          .join('; ') || 'Not recorded'
      : raRaw.version === 3
        ? raRaw.warranted === 'yes'
          ? `Repair Attempt Protocol performed (${raRaw.systems.join(', ') || 'no systems'})`
          : (RAP_WARRANTED_LABELS[raRaw.warranted] ?? raRaw.warranted)
        : ((raRaw as unknown as { determination?: string }).determination ?? 'Not recorded')
    : null;
  // Server-built RAP scorecard section (null for pre-RAP assessments — the
  // report simply omits it). Photo references are ids, never URLs.
  const rapSection = buildRapReportSection(inspection.repairabilityAssessment);
  // Server-built VAP scorecard section (vinyl siding; null when absent).
  const vapSection = buildVapReportSection(inspection.repairabilityAssessment);
  const hf = inspection.homeownerFacts as { yearsOwned?: number; knownPriorRoofAge?: number } | null;

  const photoBrief = curatedPhotos.slice(0, 80).map((p) => ({
    id: p.id,
    stage: p.stage ?? null,
    subjectType: p.subjectType ?? null,
    subjectId: p.subjectId ?? null,
    triadRole: p.triadRole ?? null,
    zone: p.zone ?? null,
  }));

  const slopes = children.slopes.map((s) => ({
    label: s.label,
    areaSqft: s.areaSqft ?? null,
    damagePresent: s.damagePresent,
    damageType: s.damageType ?? null,
    materialType: s.materialType ?? null,
  }));

  const products = children.products.slice(0, 10).map((p) => ({
    manufacturer: (p as Record<string, unknown>)['manufacturer'] ?? null,
    productLine: (p as Record<string, unknown>)['productLine'] ?? null,
    colorMatch: (p as Record<string, unknown>)['colorMatch'] ?? null,
  }));

  const geminiPrompt = `You are a technical report writer for a forensic roofing inspection company.

${CONTRACTOR_LANE_POLICY}

Given the structured inspection data below, return a JSON object with EXACTLY these keys:
{
  "propertyConstructionDetailsHtml": "<complete HTML for a property details table>",
  "photoGroupings": [{ "title": "<section title>", "photoIds": ["<id>", ...], "narrative": "<1-2 sentence description>" }],
  "inspectorAttestationHtml": "<HTML paragraph stating that the named inspector personally conducted this inspection>"
}

Rules:
- propertyConstructionDetailsHtml: a clean <table class="detail-table"> with rows for every non-null property attribute (type, age, stories, deck, materials, damage flags, arrival conditions, repairability determination, homeowner facts). Use <th> for labels and <td> for values. If a value is unknown write "Not recorded".
- photoGroupings: group the provided photos by logical area (e.g. "Roof — Front Slope", "Siding — East Elevation", "Collateral Damage", "Interior/Attic", "Test Squares", "General Overview"). Only include groups that have at least one photo. Keep the total number of groups ≤ 10.
- inspectorAttestationHtml: a single <p> stating the inspector's name, their affirmation that they personally conducted this inspection, and the inspection date. Sign it with their name and email.
- Use only HTML safe for direct embedding (no <script>, no external references).
- Return ONLY the JSON object — no markdown fences, no preamble.

INSPECTION DATA:
Property: ${JSON.stringify({
    address: inspection.address,
    claimNumber: inspection.claimNumber,
    policyNumber: inspection.policyNumber,
    insuredName: inspection.insuredName,
    carrierName: inspection.carrierName,
    dateOfLoss: inspection.dateOfLoss,
    damageFlags: {
      roof: inspection.roofDamageFound,
      siding: inspection.sidingDamageFound,
      collateral: inspection.collateralDamageFound,
      interior: inspection.interiorDamageFound,
    },
  })}

Property Profile: ${JSON.stringify(pp)}
Arrival Conditions: ${JSON.stringify(arr)}
Repairability Assessment: ${JSON.stringify(raRaw)}
Homeowner Facts: ${JSON.stringify(hf)}
Roof Facets (${slopes.length} total): ${JSON.stringify(slopes.slice(0, 20))}
Installed Products: ${JSON.stringify(products)}

Inspector: ${JSON.stringify({ name: inspectorName, email: inspector.email })}
Inspection date: ${inspection.lockedAt ? new Date(inspection.lockedAt).toLocaleDateString() : (inspection.updatedAt ? new Date(inspection.updatedAt).toLocaleDateString() : 'On-site')}

AI Summary (already written — DO NOT reproduce it):
Forensic Summary: [provided separately in report]
Repairability: [provided separately in report]

Photos available for grouping (${photoBrief.length} total):
${JSON.stringify(photoBrief)}
`;

  let propertyDetailsHtml: string;
  let photoGroupings: Array<{ title: string; photoIds: string[]; narrative: string }>;
  let attestationHtml: string;

  try {
    const response = await geminiAi.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: [{ role: 'user', parts: [{ text: geminiPrompt }] }],
      config: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
    });
    const raw = response.text ?? '';
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned) as {
      propertyConstructionDetailsHtml?: string;
      photoGroupings?: Array<{ title: string; photoIds: string[]; narrative: string }>;
      inspectorAttestationHtml?: string;
    };
    // Sanitize LLM-generated HTML with a strict allowlist before storing.
    // Inspection fields are user-supplied and flow into the Gemini prompt, so
    // we must treat LLM output as untrusted to prevent prompt-injection XSS.
    const rawPropertyHtml = parsed.propertyConstructionDetailsHtml ?? '';
    propertyDetailsHtml = sanitizeReportFragment(rawPropertyHtml);
    // Defensive fallback: if sanitization zeroed out the content, build a safe
    // server-side table from the structured data directly.
    if (!propertyDetailsHtml.trim()) {
      propertyDetailsHtml = `<table class="detail-table">
        <tr><th>Property type</th><td>${escHtml(pp?.propertyType ?? 'Not recorded')}</td></tr>
        <tr><th>Stories</th><td>${escHtml(pp?.stories ?? 'Not recorded')}</td></tr>
        <tr><th>Roof age (years)</th><td>${escHtml(pp?.roofAge ?? 'Not recorded')}</td></tr>
        <tr><th>Deck type</th><td>${escHtml(pp?.deckType ?? 'Not recorded')}</td></tr>
        <tr><th>Roof damage found</th><td>${inspection.roofDamageFound ? 'Yes' : 'No'}</td></tr>
        <tr><th>Siding damage found</th><td>${inspection.sidingDamageFound ? 'Yes' : 'No'}</td></tr>
        <tr><th>Collateral damage</th><td>${inspection.collateralDamageFound ? 'Yes' : 'No'}</td></tr>
        <tr><th>Repairability</th><td>${escHtml(raSummary ?? 'Not recorded')}</td></tr>
        <tr><th>Arrival conditions</th><td>${escHtml([arr?.sky, arr?.windCondition].filter(Boolean).join(', ') || 'Not recorded')}</td></tr>
      </table>`;
    }

    photoGroupings = Array.isArray(parsed.photoGroupings) ? parsed.photoGroupings : [];

    const rawAttestationHtml = parsed.inspectorAttestationHtml ?? '';
    attestationHtml = sanitizeReportFragment(rawAttestationHtml);
    // Defensive fallback: if sanitization zeroed out content, use a safe template.
    if (!attestationHtml.trim()) {
      attestationHtml = `<p>This forensic inspection was personally conducted by
        <strong>${escHtml(inspectorName)}</strong>${inspector.email ? ` (${escHtml(inspector.email)})` : ''}.
        The inspector affirms that all observations, measurements, and photographs
        documented herein were captured directly by them during the on-site inspection.</p>`;
    }
  } catch (err) {
    req.log.error({ err }, 'Gemini report compilation failed');
    res.status(502).json({ error: 'Report compilation failed. Please try again.' });
    return;
  }

  // Safety boundary: groupings may only reference report-eligible photos.
  // Gemini only ever sees the eligible brief, but its output is untrusted —
  // drop any rogue id before render and prune groups that empty out.
  const curatedIds = new Set(curatedPhotos.map((p) => p.id));
  photoGroupings = photoGroupings
    .map((g) => ({ ...g, photoIds: g.photoIds.filter((pid) => curatedIds.has(pid)) }))
    .filter((g) => g.photoIds.length > 0);

  // Normalise Gemini's groupings — fallback to one group (curated photos
  // only) if it returned none.
  if (photoGroupings.length === 0) {
    photoGroupings = [{ title: 'Evidence Photos', photoIds: curatedPhotos.map((p) => p.id), narrative: '' }];
  }

  // Store a JSON data blob — NOT rendered HTML. Photo URLs are intentionally
  // omitted from this artifact; they are signed fresh on every preview request
  // so the stored data never embeds expiring credentials.
  const generatedAt = new Date().toISOString();

  // Content-class map for every stored fragment (schemaVersion 4). Carrier
  // rendering includes only carrier-facing classes; internal_metadata is
  // provenance/processing data surfaced only via server-built appendices.
  const contentClasses: Record<string, ContentClass> = {
    'aiSummary.forensicSummary': 'construction_fact',
    'aiSummary.repairabilityText': 'repairability_analysis',
    propertyDetailsHtml: 'construction_fact',
    photoGroupings: 'photo_narrative',
    attestationHtml: 'attestation',
    photoIndex: 'internal_metadata',
    evidenceManifest: 'internal_metadata',
    // Server-computed counts + photo references — factual, carrier-facing.
    rapSection: 'construction_fact',
    vapSection: 'construction_fact',
  };

  // Contractor-lane lint over every AI-generated fragment before storage.
  // Content is stored verbatim — findings only classify it; `blocked` gates
  // finalization/export until a reviewer edits or explicitly resolves.
  const lintFragmentInputs: LintFragmentInput[] = [
    { fragmentRef: 'aiSummary.forensicSummary', contentClass: 'construction_fact', text: aiSummary.forensicSummary },
    { fragmentRef: 'aiSummary.repairabilityText', contentClass: 'repairability_analysis', text: aiSummary.repairabilityText },
    { fragmentRef: 'propertyDetailsHtml', contentClass: 'construction_fact', text: propertyDetailsHtml, isHtml: true },
    { fragmentRef: 'attestationHtml', contentClass: 'attestation', text: attestationHtml, isHtml: true },
    ...photoGroupings.flatMap((g, i): LintFragmentInput[] => [
      { fragmentRef: `photoGroupings[${i}].title`, contentClass: 'photo_narrative', text: g.title },
      { fragmentRef: `photoGroupings[${i}].narrative`, contentClass: 'photo_narrative', text: g.narrative ?? '' },
    ]),
  ];
  const lint = lintReportFragments(lintFragmentInputs);

  // ── Proof Package content requirements (schemaVersion 6) ───────────────
  // The A–M template prints company qualifications and state-specific legal
  // content. Compiling without them would ship a legally incomplete package,
  // so missing settings block the compile with an actionable error.
  const [companyRow] = await db
    .select({
      name: companiesTable.name,
      contractorLegalName: companiesTable.contractorLegalName,
      contractorLicenses: companiesTable.contractorLicenses,
      qualificationsText: companiesTable.qualificationsText,
      pricingBasisStatement: companiesTable.pricingBasisStatement,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, actor.companyId));

  const allPacks = await db
    .select()
    .from(companyJurisdictionPacksTable)
    .where(eq(companyJurisdictionPacksTable.companyId, actor.companyId));

  // Property state from the address ("… Fairfax, VA 22030"). When it can't
  // be parsed, a company with exactly one pack unambiguously uses that one.
  const stateMatch = (inspection.address ?? '').match(/\b([A-Za-z]{2})[,]?\s+\d{5}(?:-\d{4})?\b/);
  const propertyState =
    stateMatch?.[1]?.toUpperCase() ?? (allPacks.length === 1 ? allPacks[0]!.state : null);
  const matchingPacks = propertyState ? allPacks.filter((p) => p.state === propertyState) : [];

  // Pack selection: the rep's explicit pick wins (it must belong to this
  // company AND match the property state — a stale/foreign id is an error,
  // not a silent fallback); otherwise a single matching pack is unambiguous.
  const compileBody = CompileInspectionReportBody.safeParse(req.body ?? {});
  const requestedPackId = compileBody.success ? (compileBody.data.jurisdictionPackId ?? null) : null;
  let jurisdictionPack: (typeof allPacks)[number] | null = null;
  if (requestedPackId) {
    jurisdictionPack = matchingPacks.find((p) => p.id === requestedPackId) ?? null;
    if (!jurisdictionPack) {
      res.status(400).json({ error: 'Selected jurisdiction pack not found for this property\u2019s state' });
      return;
    }
  } else if (matchingPacks.length === 1) {
    jurisdictionPack = matchingPacks[0]!;
  }

  const missingSettings: string[] = [];
  if (!companyRow?.contractorLicenses?.length) missingSettings.push('contractor license(s)');
  if (!companyRow?.qualificationsText) missingSettings.push('Statement of Qualifications');
  if (!propertyState) {
    missingSettings.push(
      'property state (add a 2-letter state + ZIP to the inspection address, or set up exactly one jurisdiction pack)',
    );
  } else if (matchingPacks.length === 0) {
    missingSettings.push(`a Building Regulation Jurisdiction Pack for ${propertyState}`);
  } else if (!jurisdictionPack) {
    // Multiple candidate packs and no explicit selection — the rep must pick.
    res.status(422).json({
      error: `Multiple jurisdiction packs match ${propertyState} — pick one when compiling.`,
      missingSettings: ['jurisdiction pack selection'],
    });
    return;
  }
  if (missingSettings.length > 0) {
    res.status(422).json({
      error: `Proof Package settings incomplete — a super admin must add: ${missingSettings.join('; ')}. These live under Proof Package Settings in the admin profile.`,
      missingSettings,
    });
    return;
  }

  // Optional per-compile citation selection: the rep can pick which of the
  // pack's code citations (across all three sections) ship in this Proof
  // Package. Absent/omitted means include all. Baked into the versioned blob.
  const selectedKeys = compileBody.success ? (compileBody.data.codeCitationKeys ?? null) : null;
  const filterSection = (citations: CodeCitationRow[]): CodeCitationRow[] => {
    const deduped = dedupeCitationsByKey(citations);
    return selectedKeys ? deduped.filter((c) => selectedKeys.includes(c.key)) : deduped;
  };
  const selectedGeneral = filterSection(jurisdictionPack!.generalCodeCitations ?? []);
  const selectedRoofing = filterSection(jurisdictionPack!.roofingCodeCitations ?? []);
  const selectedSiding = filterSection(jurisdictionPack!.sidingCodeCitations ?? []);

  // Inspector signature path (object path — signed fresh at render time).
  const signaturePath = inspectorProfile?.signatureUrl ?? null;

  const fmtDate = (d: string | Date | null | undefined): string =>
    d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not recorded';

  // Photo → report area mapping for exhibit ordering.
  const photoArea = (p: (typeof curatedPhotos)[number]): 'roof' | 'siding' | 'interior' | 'collateral' | 'general' => {
    const st = (p.subjectType ?? '').toLowerCase();
    const zone = (p.zone ?? '').toLowerCase();
    if (st.includes('slope') || st.includes('test_square') || st.includes('penetration') || zone.includes('roof')) return 'roof';
    if (st.includes('siding') || st.includes('facet')) return 'siding';
    if (st.includes('interior') || zone.includes('interior') || zone.includes('attic')) return 'interior';
    if (st.includes('collateral') || zone.includes('collateral')) return 'collateral';
    return 'general';
  };
  const captionFromOverlay = (overlay: unknown): string | null => {
    if (overlay && typeof overlay === 'object' && 'caption' in overlay) {
      const c = (overlay as { caption?: unknown }).caption;
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return null;
  };
  const photoMeta = curatedPhotos.map((p) => ({
    id: p.id,
    area: photoArea(p),
    caption:
      captionFromOverlay(p.overlayJson) ??
      [p.zone, p.triadRole, p.subjectType].filter(Boolean).join(' · ') ??
      'Evidence photo',
    sha256: p.sha256 ?? null,
  }));
  // Cover photo: prefer a front elevation shot, else the first curated photo.
  const coverPhotoId =
    curatedPhotos.find(
      (p) => (p.subjectType ?? '').toLowerCase().includes('elevation') && (p.zone ?? '').toLowerCase().includes('front'),
    )?.id ??
    curatedPhotos.find((p) => (p.subjectType ?? '').toLowerCase().includes('elevation'))?.id ??
    curatedPhotos[0]?.id ??
    null;

  // Storm block from the inspector-confirmed storm of record.
  const storm = inspection.stormConfirmedRef
    ? {
        type:
          inspection.stormConfirmedRef.type === 'hail'
            ? 'Hail'
            : inspection.stormConfirmedRef.type === 'wind'
              ? 'Damaging Wind'
              : 'Tornado',
        dateLocalTime: fmtDate(inspection.stormConfirmedRef.date),
        hailSize:
          inspection.stormConfirmedRef.hailSize != null
            ? `${inspection.stormConfirmedRef.hailSize}" diameter`
            : null,
        windSpeed:
          inspection.stormConfirmedRef.windSpeed != null
            ? `${inspection.stormConfirmedRef.windSpeed} mph`
            : null,
        distance:
          inspection.stormConfirmedRef.distance != null
            ? `${inspection.stormConfirmedRef.distance} mi from property`
            : null,
        coordinates: inspection.stormConfirmedRef.queriedLocation || null,
        source: 'Certified weather data (Visual Crossing) confirmed by the inspector',
        narrative: null,
        note: inspection.stormConfirmedRef.description ?? null,
      }
    : null;

  // Methodology: arrival conditions + auto-logged capture counts.
  const conditionsParts = [
    arr?.sky ? `Sky: ${arr.sky}` : null,
    arr?.windCondition ? `Wind: ${arr.windCondition}` : null,
    (arr as { temp?: string | null } | null)?.temp ? `Temp: ${(arr as { temp?: string | null }).temp}` : null,
  ].filter(Boolean);
  const methodology = {
    inspectedAt: fmtDate(inspection.lockedAt ?? inspection.updatedAt),
    conditions: conditionsParts.length ? conditionsParts.join(' · ') : 'Not recorded',
    equipment: [] as string[],
    capture: {
      elevations: children.elevations.length,
      slopes: children.slopes.length,
      testSquares: children.testSquares.length,
      totalHits: children.testSquareHits.length,
      damageInstances: children.damageInstances.length,
      photos: curatedPhotos.length,
    },
  };

  const areasImpacted = [
    { key: 'roof' as const, name: 'Roof System', impacted: inspection.roofDamageFound === true },
    { key: 'siding' as const, name: 'Siding / Exterior', impacted: inspection.sidingDamageFound === true },
    { key: 'collateral' as const, name: 'Collateral (soft metals, screens)', impacted: inspection.collateralDamageFound === true },
    { key: 'interior' as const, name: 'Interior / Attic', impacted: inspection.interiorDamageFound === true },
  ];

  // Component condition rows (Exhibit E tables), derived from recorded facts.
  const componentRows: Record<string, Array<{ component: string; condition: string; method: string; verdict: 'replace' | 'repair' | 'monitor' }>> = {};
  const roofRows = children.slopes
    .filter((s) => s.damagePresent)
    .map((s) => {
      const instances = children.damageInstances.filter((d) => d.slopeId === s.id).length;
      return {
        component: s.label,
        condition: [s.damageType, instances ? `${instances} documented damage instance${instances === 1 ? '' : 's'}` : null]
          .filter(Boolean)
          .join(' — ') || 'Storm damage documented',
        method: 'Full replacement of affected system',
        verdict: 'replace' as const,
      };
    });
  if (roofRows.length) componentRows['roof'] = roofRows;
  const sidingRows = children.sidingFacets
    .filter((f) => (f as { damagePresent?: boolean }).damagePresent)
    .map((f) => ({
      component: (f as { label?: string }).label ?? 'Siding facet',
      condition: 'Storm damage documented',
      method: 'See repairability assessment',
      verdict: 'replace' as const,
    }));
  if (sidingRows.length) componentRows['siding'] = sidingRows;

  // Measurement exhibit from recorded slope areas + linear measurements.
  const slopeAreas = children.slopes
    .filter((s) => s.areaSqft != null && s.areaSqft > 0)
    .map((s) => ({ label: s.label, sqft: s.areaSqft as number }));
  const linearByType = new Map<string, number>();
  for (const mRow of children.measurements) {
    if ((mRow.unit ?? '').toLowerCase() === 'lf' || (mRow.unit ?? '').toLowerCase() === 'ft') {
      linearByType.set(mRow.measurementType, (linearByType.get(mRow.measurementType) ?? 0) + mRow.value);
    }
  }
  const totalSqft = slopeAreas.reduce((sum, s) => sum + s.sqft, 0);
  const measurement =
    slopeAreas.length || linearByType.size
      ? {
          slopes: slopeAreas,
          linear: [...linearByType.entries()].map(([type, lf]) => ({ type, lf })),
          totalSqft,
          squares: totalSqft / 100,
        }
      : null;

  // Scope exhibit from the stored estimate (server-hydrated price snapshot).
  const codeCiteByKey = new Map(
    [...selectedGeneral, ...selectedRoofing, ...selectedSiding].map((c) => [c.key, c.cite]),
  );
  const scope = estimateForLinks?.lines?.length
    ? {
        lineItems: estimateForLinks.lines.map((li) => ({
          description: li.description,
          qty: li.quantity,
          unit: li.unit ?? 'EA',
          rate: li.unitPriceCents / 100,
          total: li.totalCents / 100,
          isAdder: li.isAdder,
          trigger: null as string | null,
          codeRefs: codeCiteByKey.has(li.priceBookItemId ?? '')
            ? [codeCiteByKey.get(li.priceBookItemId ?? '')!]
            : [],
        })),
        subtotal: estimateForLinks.subtotalCents / 100,
        basePricePerSquare: null as number | null,
        squares: estimateForLinks.measuredBasis?.wasteAdjustedSquares ?? estimateForLinks.measuredBasis?.roofSquares ?? null,
      }
    : null;

  // Product identification (Exhibit G) from the repairability product match.
  const productMatch = raRaw
    ? ((raRaw as { roof?: { productMatch?: { name?: string; widthInches?: number | null; exposureInches?: number | null } | null } }).roof?.productMatch ?? null)
    : null;
  const product = productMatch?.name
    ? {
        name: productMatch.name,
        identification: [
          productMatch.widthInches != null ? `${productMatch.widthInches}" width` : null,
          productMatch.exposureInches != null ? `${productMatch.exposureInches}" exposure` : null,
        ]
          .filter(Boolean)
          .join(', ') || 'Matched against the known-product catalog',
        discontinued: true,
        discontinuedNote:
          'This product was matched against the company\u2019s discontinued-product catalog during the repairability assessment.',
      }
    : null;

  const reportData = {
    company: {
      legalName: companyRow!.contractorLegalName ?? companyRow!.name,
      brand: companyRow!.name,
      licenses: companyRow!.contractorLicenses ?? [],
      qualificationsText: companyRow!.qualificationsText ?? '',
      pricingBasisStatement: companyRow!.pricingBasisStatement ?? null,
    },
    // schemaVersion 7: Building Regulation Jurisdiction Pack snapshot. Kept
    // under the legacy `statePack` key so the render path stays uniform.
    statePack: {
      state: jurisdictionPack!.state,
      jurisdictionLabel: jurisdictionPack!.jurisdiction,
      openingStatements: jurisdictionPack!.openingStatements ?? [],
      uppaLaw: jurisdictionPack!.uppaLaw ?? null,
      uppaStatement: jurisdictionPack!.uppaStatement ?? null,
      codeCitationSections: [
        { label: 'General Code Citations', citations: selectedGeneral },
        { label: 'Roofing Code Citations', citations: selectedRoofing },
        { label: 'Siding Code Citations', citations: selectedSiding },
      ],
    },
    phase1Date: fmtDate(inspection.preliminaryCompletedAt),
    phase2Date: fmtDate(inspection.lockedAt ?? inspection.updatedAt),
    storm,
    methodology,
    areasImpacted,
    components: componentRows,
    measurement,
    scope,
    product,
    photoMeta,
    coverPhotoId,
    signaturePath,
  };

  // ── Section assembly & generationSnapshot ──────────────────────────────
  // Read locked sections and build the section assembly HTML (TOC + body).
  // Also gather standards entries for standardsCited snapshot.
  const [lockedSectionRows, allStandardsRows, finalizedBadgeSelections] = await Promise.all([
    db
      .select({
        sectionType: claimSectionsTable.sectionType,
        contentHtml: claimSectionsTable.contentHtml,
        lockedAt: claimSectionsTable.lockedAt,
        lockedBy: claimSectionsTable.lockedBy,
        libraryVersionSnapshot: claimSectionsTable.libraryVersionSnapshot,
        id: claimSectionsTable.id,
      })
      .from(claimSectionsTable)
      .where(
        and(
          eq(claimSectionsTable.inspectionId, inspectionId),
          eq(claimSectionsTable.state, 'locked'),
        ),
      ),
    db
      .select({
        entryKey: standardsEntriesTable.entryKey,
        verificationStatus: standardsEntriesTable.verificationStatus,
        verifiedAt: standardsEntriesTable.verifiedAt,
      })
      .from(standardsEntriesTable)
      .where(eq(standardsEntriesTable.companyId, actor.companyId)),
    db
      .select({ id: exhibitSelectionsTable.id, badgeLabel: exhibitSelectionsTable.badgeLabel, exhibitClass: exhibitSelectionsTable.exhibitClass })
      .from(exhibitSelectionsTable)
      .where(
        and(
          eq(exhibitSelectionsTable.inspectionId, inspectionId),
          eq(exhibitSelectionsTable.companyId, actor.companyId),
          isNotNull(exhibitSelectionsTable.finalizedAt),
        ),
      ),
  ]);

  const sectionAssemblyHtml = assembleSectionHtml(lockedSectionRows as LockedSectionRow[]);

  // ── Exhibit badge map — freeze on first compile ──────────────────────────
  // Build from finalized exhibit selections and store on the inspection row
  // so subsequent recompiles read the same frozen assignments.
  let badgeMap = inspection.exhibitBadgeMap as
    | { counters: Record<string, number>; assignments: Record<string, string> }
    | null;
  if (!badgeMap && finalizedBadgeSelections.length > 0) {
    const counters: Record<string, number> = { R: 0, S: 0, I: 0, F: 0, C: 0, T: 0 };
    const assignments: Record<string, string> = {};
    for (const sel of finalizedBadgeSelections) {
      if (sel.badgeLabel) {
        assignments[sel.id] = sel.badgeLabel;
        const cls = sel.badgeLabel.split('-')[0];
        const num = parseInt(sel.badgeLabel.split('-')[1] ?? '0', 10);
        if (cls && !Number.isNaN(num)) counters[cls] = Math.max(counters[cls] ?? 0, num);
      }
    }
    badgeMap = { counters, assignments };
    // Fire-and-forget update — compile continues without waiting. If this
    // fails (race condition on concurrent first compile), the next compile
    // re-freezes identically (same selections, same labels).
    db
      .update(inspectionsTable)
      .set({ exhibitBadgeMap: badgeMap })
      .where(and(eq(inspectionsTable.id, inspectionId), isNull(inspectionsTable.exhibitBadgeMap)))
      .catch((err: unknown) => req.log.warn({ err, inspectionId }, 'exhibitBadgeMap freeze failed'));
  }

  // ── generationSnapshot ───────────────────────────────────────────────────
  // Records the exact library versions and section row IDs in use at compile
  // time. Baked into the blob so any future re-render uses the snapshot to
  // prove which versions were used rather than relying on current library state.
  const sectionVersions: Record<string, string> = {};
  const libraryVersions: Record<string, number> = {};
  for (const row of lockedSectionRows) {
    sectionVersions[row.sectionType] = row.id;
    const snap = row.libraryVersionSnapshot as { bpVersions?: Record<string, number>; ahjPackVersions?: Record<string, number> } | null;
    if (snap?.bpVersions) Object.assign(libraryVersions, snap.bpVersions);
  }

  // standardsCited: collect every standards entry referenced by any locked section
  const referencedEntryKeys = new Set<string>();
  for (const row of lockedSectionRows) {
    const snap = row.libraryVersionSnapshot as { standardsEntryKeys?: string[] } | null;
    for (const k of snap?.standardsEntryKeys ?? []) referencedEntryKeys.add(k);
  }
  const standardsCited = allStandardsRows
    .filter((e) => referencedEntryKeys.has(e.entryKey))
    .map((e) => ({
      entryKey: e.entryKey,
      verificationStatus: e.verificationStatus,
      verifiedAt: e.verifiedAt?.toISOString() ?? null,
    }));

  const generationSnapshot = {
    protocolVersion: '7.0',
    sectionVersions,
    libraryVersions,
    triggerFlags: (inspection.triggerFlags ?? null) as Record<string, string> | null,
    standardsCited,
    compiledAt: generatedAt,
    compiledBy: actor.userId,
    hasSections: lockedSectionRows.length > 0,
  };

  const compiledData = {
    schemaVersion: 7,
    reportData,
    generatedAt,
    inspector,
    inspectionSnapshot: {
      id: inspection.id,
      address: inspection.address,
      claimNumber: inspection.claimNumber,
      policyNumber: inspection.policyNumber,
      insuredName: inspection.insuredName,
      carrierName: inspection.carrierName,
      dateOfLoss: inspection.dateOfLoss,
      roofDamageFound: inspection.roofDamageFound,
      sidingDamageFound: inspection.sidingDamageFound,
      collateralDamageFound: inspection.collateralDamageFound,
      interiorDamageFound: inspection.interiorDamageFound,
      lockedAt: inspection.lockedAt,
    },
    aiSummary,
    propertyDetailsHtml,
    photoGroupings,
    attestationHtml,
    // Stable per-photo metadata (object paths, NOT signed URLs).
    photoIndex,
    // Server-built provenance record for every evidence photo, plus an
    // integrity digest of the manifest itself.
    evidenceManifest,
    evidenceManifestSha256: manifestSha256,
    // Server-built Repair Attempt Protocol scorecard + photo references
    // (schemaVersion 5). Null when the assessment predates RAP.
    rapSection,
    // Server-built Vinyl Assessment Protocol scorecard + photo references.
    // Null when no vinyl-siding protocol was run.
    vapSection,
    // Present from schemaVersion 4 onward.
    contentClasses,
    lint,
    // Manager-authorized reopen history — disclosed in the rendered package
    // so a re-submitted record never hides that it was unlocked and edited.
    unlockLog: inspection.unlockLog ?? [],
    // Per-section AI generation pipeline (Task #122). Empty until sections
    // are generated, approved, and locked.
    sectionAssemblyHtml,
    generationSnapshot,
    // Frozen exhibit badge map (class-prefixed scheme). Null until badges
    // are finalized via the curation route and a compile runs.
    exhibitBadgeMap: badgeMap,
  };

  const compiledReportPath = await objectStorageService.uploadObjectBuffer(
    Buffer.from(JSON.stringify(compiledData), 'utf-8'),
    'application/json',
  );

  // Append this version to the append-only history via SQL `||` (never
  // read-modify-write) so concurrent compiles can't drop entries and every
  // prior package version stays retrievable with its manifest digest.
  const versionEntry = JSON.stringify({
    path: compiledReportPath,
    generatedAt,
    schemaVersion: 7,
    evidenceManifestSha256: manifestSha256,
    lintStatus: lint.lintStatus,
  });
  await db
    .update(inspectionsTable)
    .set({
      compiledReportPath,
      compiledReportReadyAt: new Date(),
      compiledReportVersions: sql`${inspectionsTable.compiledReportVersions} || ${versionEntry}::jsonb`,
    })
    .where(eq(inspectionsTable.id, inspectionId));

  // Ensure the inspection has a public Evidence Portal share code so the
  // rendered package can print portal access details. Generated once at
  // first compile; retried on the (astronomically unlikely) unique clash.
  // Conditional (isNull-guarded) so two concurrent first compiles can never
  // overwrite each other: exactly one UPDATE takes effect, the loser is a
  // no-op, and the code is stable across every later compile.
  if (!inspection.portalAccessCode) {
    let assigned = false;
    for (let attempt = 0; attempt < 3 && !assigned; attempt++) {
      try {
        await db
          .update(inspectionsTable)
          .set({ portalAccessCode: generatePortalAccessCode() })
          .where(and(eq(inspectionsTable.id, inspectionId), isNull(inspectionsTable.portalAccessCode)));
        assigned = true;
      } catch (err) {
        req.log.warn({ err, inspectionId, attempt }, 'Portal access code assignment attempt failed');
      }
    }
    if (!assigned) {
      // Surfaced loudly (error-level, with the inspection id) — a package
      // without a portal code prints no portal access details, and the next
      // compile is the recovery path.
      req.log.error(
        { inspectionId },
        'Failed to assign portal access code after all retries — Proof Package has no portal access details until the next compile',
      );
    }
  }

  res.json({ compiledReportPath, lintStatus: lint.lintStatus, findings: lint.findings });
});

// GET /inspections/:inspectionId/report/preview-url
// Loads the stored JSON data blob, signs each photo URL fresh (15-min TTL),
// builds the full HTML, and returns it directly as { html }.
// Every call produces fresh signed URLs — the stored blob never embeds expiring ones.
router.get('/inspections/:inspectionId/report/preview-url', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }
  if (!inspection.compiledReportPath) {
    res.status(404).json({ error: 'No compiled report found — compile the report first.' });
    return;
  }

  // Optional ?version=<index> re-opens an older compiled version. Validated
  // against the append-only version history; default is the latest package.
  let reportPath = inspection.compiledReportPath;
  const rawVersion = req.query.version;
  if (typeof rawVersion === 'string' && rawVersion !== '') {
    const versions = (inspection.compiledReportVersions ?? []) as Array<{
      path: string;
      generatedAt: string;
      evidenceManifestSha256: string;
    }>;
    const idx = Number(rawVersion);
    if (!Number.isInteger(idx) || idx < 0 || idx >= versions.length) {
      res.status(400).json({ error: 'Unknown report version' });
      return;
    }
    reportPath = versions[idx].path;
  }

  const reviewRequested = req.query.review === '1' || req.query.review === 'true';
  const rendered = await renderCompiledReportHtml({
    inspection,
    reportPath,
    companyId: actor.companyId,
    allowBlocked: reviewRequested && isManagerOrAdmin(actor.role),
    portalAccess: buildPortalAccessFromRequest(req, inspection.portalAccessCode),
  });
  if (!rendered.ok) {
    res.status(409).json({ error: rendered.error, lintStatus: 'blocked', findings: rendered.findings });
    return;
  }
  res.json({ html: rendered.html });
});

// Shared renderer for a compiled Proof Package blob — used by the
// authenticated preview route above and the public Evidence Portal route.
// Loads the stored JSON data blob, signs each photo URL fresh (15-min TTL),
// and builds the full HTML; the stored blob never embeds expiring URLs.
export async function renderCompiledReportHtml(opts: {
  inspection: typeof inspectionsTable.$inferSelect;
  reportPath: string;
  companyId: string;
  /**
   * Reviewer bypass for blocked-content versions. Callers must gate this on
   * manager/admin role + explicit review mode; the public portal always
   * passes false (blocked versions are never served externally).
   */
  allowBlocked: boolean;
  /** Portal URL + access code block printed in the rendered package. */
  portalAccess?: { url: string; code: string } | null;
}): Promise<{ ok: true; html: string } | { ok: false; error: string; findings: unknown[] }> {
  const { inspection, reportPath } = opts;

  // Load the stored JSON data blob from object storage.
  const dataFile = await objectStorageService.getObjectEntityFile(reportPath);
  const [dataBuffer] = await dataFile.download();
  const compiledData = JSON.parse(dataBuffer.toString('utf-8')) as {
    schemaVersion: number;
    generatedAt: string;
    inspector: { name: string; email: string | null };
    inspectionSnapshot: {
      id: string; address: string | null; claimNumber: string | null;
      policyNumber: string | null; insuredName: string | null; carrierName: string | null;
      dateOfLoss: string | null; roofDamageFound: boolean | null;
      sidingDamageFound: boolean | null; collateralDamageFound: boolean | null;
      interiorDamageFound: boolean | null; lockedAt: Date | null;
    };
    aiSummary: { forensicSummary: string; repairabilityText: string };
    propertyDetailsHtml: string;
    photoGroupings: Array<{ title: string; photoIds: string[]; narrative: string }>;
    attestationHtml: string;
    photoIndex: Record<string, {
      objectPath: string; stage: string | null; triadRole: string | null;
      zone: string | null; subjectType: string | null;
    }>;
    // Present from schemaVersion 2 onward.
    evidenceManifest?: {
      manifestVersion: number;
      inspectionId: string;
      inspectionDate: string | null;
      photoCount: number;
      photos: Array<{
        photoId: string; objectPath: string; sha256: string;
        capturedAtUtc: string | null; uploadedAt: string | null;
        stage: string | null; subjectType: string | null;
        triadRole: string | null; zone: string | null;
        annotations: unknown; hasExif: boolean;
        // Present from schemaVersion 3 onward.
        subjectId?: string | null;
        linkedFinding?: LinkedFindingSummary | null;
      }>;
      // Present from schemaVersion 3 onward.
      approvedScopeLinks?: ApprovedScopeLink[];
    };
    evidenceManifestSha256?: string;
    // Present from schemaVersion 5 onward — server-built RAP scorecard +
    // photo references. Absent/null on older blobs and pre-RAP assessments.
    rapSection?: RapReportSection | null;
    // Server-built VAP (vinyl siding) scorecard + photo references.
    // Absent/null on older blobs and non-vinyl assessments.
    vapSection?: VapReportSection | null;
    // Present from schemaVersion 4 onward.
    contentClasses?: Record<string, ContentClass>;
    lint?: { lintStatus: 'passed' | 'needs_review' | 'blocked'; findings: unknown[] };
    unlockLog?: Array<{
      unlockedByName: string | null;
      unlockedAt: string;
      reason: string;
      previousLockedAt: string;
    }>;
  };

  // ── Blocked-content gate ──────────────────────────────────────────────
  // A `blocked` lint result prevents finalization/export of this version
  // until a reviewer recompiles clean content or explicitly resolves the
  // findings (resolution is scoped to this exact blob path). Reviewers can
  // still open it with ?review=1 to see what they are resolving.
  if (compiledData.lint?.lintStatus === 'blocked') {
    const resolved = inspection.reportLintResolution?.path === reportPath;
    // Reviewer bypass is an authorization boundary, not a convention — the
    // caller asserts it (manager/admin + explicit review mode only).
    if (!resolved && !opts.allowBlocked) {
      return {
        ok: false,
        error:
          'This report version contains blocked content (insurance-advocacy or legal language) and cannot be exported until a reviewer resolves it.',
        findings: compiledData.lint.findings,
      };
    }
  }

  // Carrier-facing content-class allowlist (schemaVersion >= 4). Fragments
  // whose class is not carrier-facing are omitted from the rendered report
  // body — omit, never infer. Older blobs (no contentClasses) render
  // unchanged for backward compatibility.
  const classOf = (fragmentRef: string): ContentClass | null =>
    compiledData.contentClasses ? (compiledData.contentClasses[fragmentRef] ?? null) : null;
  const carrierVisible = (fragmentRef: string): boolean => {
    if (!compiledData.contentClasses) return true; // pre-v4 blob
    const cls = classOf(fragmentRef);
    return cls !== null && CARRIER_FACING_CONTENT_CLASSES.has(cls);
  };

  // Sign each photo URL fresh — best-effort (a missing or invalid path gets null).
  const freshSignedUrls = new Map<string, string | null>();
  await Promise.all(
    Object.entries(compiledData.photoIndex).map(async ([photoId, entry]) => {
      const url = await tryGetPhotoSignedUrl(objectStorageService, entry.objectPath);
      freshSignedUrls.set(photoId, url);
    }),
  );

  // Build photo sections HTML from Gemini's groupings + fresh signed URLs.
  let photoSectionsHtml = '';
  for (const group of compiledData.photoGroupings) {
    const cards = group.photoIds
      .map((pid) => {
        const entry = compiledData.photoIndex[pid];
        if (!entry) return '';
        const signedUrl = freshSignedUrls.get(pid);
        const imgTag = signedUrl
          ? `<img src="${escHtml(signedUrl)}" alt="${escHtml(entry.subjectType ?? 'evidence photo')}" loading="lazy">`
          : `<div style="height:160px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px">Photo unavailable</div>`;
        const label = [entry.zone, entry.triadRole, entry.subjectType].filter(Boolean).join(' · ');
        return `<div class="photo-card">${imgTag}<div class="photo-caption">${escHtml(label || 'Evidence photo')}</div></div>`;
      })
      .filter(Boolean)
      .join('');
    if (!cards) continue;

    photoSectionsHtml += `
<div class="photo-group">
  <div class="photo-group-title">${escHtml(group.title)}</div>
  ${group.narrative ? `<p style="font-size:13px;color:#555;margin-bottom:12px">${escHtml(group.narrative)}</p>` : ''}
  <div class="photo-grid">${cards}</div>
</div>`;
  }

  if (!photoSectionsHtml) {
    photoSectionsHtml = '<p style="color:#888;font-size:13px">No photos available for this inspection.</p>';
  }

  // Build the Repair Attempt Protocol section — entirely server-side from
  // the stored scorecard (never AI-generated). Photos are signed fresh at
  // render time via photoIndex, exactly like the photo-evidence section.
  let rapSectionHtml: string | null = null;
  const rapSection = compiledData.rapSection;
  if (rapSection && carrierVisible('rapSection')) {
    const sc = rapSection.scorecard;
    const scoreRows: Array<[string, number]> = [
      ['Manipulated shingles', sc.manipulatedShingles],
      ['New collateral-damaged shingles', sc.newCollateralDamagedShingles],
      ['Mat-transfer findings on shingles 1–2', sc.matTransferCount],
      ...sc.categories.map((c): [string, number] => [c.label, c.count]),
    ];
    const scorecardHtml = `<table class="detail-table">
      <tr><th>Scorecard</th><th>Count</th></tr>
      ${scoreRows.map(([label, count]) => `<tr><td>${escHtml(label)}</td><td>${escHtml(count)}</td></tr>`).join('\n      ')}
    </table>`;

    const rapPhotoCard = (photoId: string, caption: string): string => {
      const entry = compiledData.photoIndex[photoId];
      if (!entry) return '';
      const signedUrl = freshSignedUrls.get(photoId);
      const imgTag = signedUrl
        ? `<img src="${escHtml(signedUrl)}" alt="${escHtml(caption)}" loading="lazy">`
        : `<div style="height:160px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px">Photo unavailable</div>`;
      return `<div class="photo-card">${imgTag}<div class="photo-caption">${escHtml(caption)}</div></div>`;
    };
    const rapCards = [
      ...(rapSection.rap1PhotoId
        ? [rapPhotoCard(rapSection.rap1PhotoId, 'RAP1 — marked shingles before pull')]
        : []),
      ...rapSection.examplePhotos.map((p) =>
        rapPhotoCard(p.photoId, [p.label, p.note].filter(Boolean).join(' — ')),
      ),
    ]
      .filter(Boolean)
      .join('');

    // Test Area Selection block — rendered only when the rep completed the
    // selection step. Legacy assessments without it render nothing (no
    // negative language for missing data).
    let selectionHtml = '';
    const sel = rapSection.selection;
    if (sel) {
      const confirmedCriteria: string[] = [
        sel.criteria.fullLengthUncut ? 'full length and uncut' : null,
        sel.criteria.twoCoursesAboveEave ? 'at least two courses above the eave' : null,
        sel.criteria.fullShingleLengthFromEdges
          ? 'at least one full shingle length from any rake, valley, or hip'
          : null,
        sel.criteria.freeOfPenetrations ? 'free of roof penetrations' : null,
        sel.criteria.representativeExposure ? 'representative of overall roof exposure' : null,
      ].filter((s): s is string => s !== null);

      const fmtList = (items: string[]) =>
        items.length <= 1
          ? (items[0] ?? '')
          : items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];

      if (sel.mode === 'damaged_target') {
        const all = ['target shingle with documented event-attributed damage', ...confirmedCriteria];
        selectionHtml = `<p style="font-size:13px;margin-bottom:12px">Test area selection criteria were confirmed in the field prior to marking: ${escHtml(fmtList(all))}.</p>`;
      } else if (sel.mode === 'fallback_slope') {
        const noteText = sel.note ? ` Field note: ${escHtml(sel.note)}` : '';
        selectionHtml = `<p style="font-size:13px;margin-bottom:8px">No event-damaged shingle was usable for the assessment; per protocol, the assessment was performed on a slope with identified damage.${noteText}</p>`;
        if (confirmedCriteria.length > 0) {
          selectionHtml += `<p style="font-size:13px;margin-bottom:12px">Confirmed site criteria: ${escHtml(fmtList(confirmedCriteria))}.</p>`;
        }
      }
    }

    rapSectionHtml = `${selectionHtml}${scorecardHtml}${
      rapCards ? `<div class="photo-grid" style="margin-top:16px">${rapCards}</div>` : ''
    }`;
  }

  // Build the Vinyl Assessment Protocol section — same server-side pattern
  // as the RAP section (scorecard table + VAP1 + priority example photos).
  // The final archive photo stays in the inspection archive, not the report.
  let vapSectionHtml: string | null = null;
  const vapSection = compiledData.vapSection;
  if (vapSection && carrierVisible('vapSection')) {
    const sc = vapSection.scorecard;
    const scoreRows: Array<[string, number]> = [
      ['Target panels removed', sc.targetPanelsRemoved],
      ['Panels manipulated', sc.panelsManipulated],
      ['Trim/interface components manipulated', sc.trimManipulated],
      ['New collateral-damaged panels', sc.newCollateralDamagedComponents],
      ...sc.categories.map((c): [string, number] => [c.label, c.count]),
    ];
    const scorecardHtml = `<table class="detail-table">
      <tr><th>Scorecard</th><th>Count</th></tr>
      ${scoreRows.map(([label, count]) => `<tr><td>${escHtml(label)}</td><td>${escHtml(count)}</td></tr>`).join('\n      ')}
    </table>`;

    const vapPhotoCard = (photoId: string, caption: string): string => {
      const entry = compiledData.photoIndex[photoId];
      if (!entry) return '';
      const signedUrl = freshSignedUrls.get(photoId);
      const imgTag = signedUrl
        ? `<img src="${escHtml(signedUrl)}" alt="${escHtml(caption)}" loading="lazy">`
        : `<div style="height:160px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px">Photo unavailable</div>`;
      return `<div class="photo-card">${imgTag}<div class="photo-caption">${escHtml(caption)}</div></div>`;
    };
    const vapCards = [
      ...(vapSection.vap1PhotoId
        ? [vapPhotoCard(vapSection.vap1PhotoId, 'VAP1 — marked vinyl repair zone / pre-manipulation baseline')]
        : []),
      ...vapSection.examplePhotos.map((p) =>
        vapPhotoCard(p.photoId, [p.label, p.note].filter(Boolean).join(' — ')),
      ),
    ]
      .filter(Boolean)
      .join('');

    vapSectionHtml = `${scorecardHtml}${
      vapCards ? `<div class="photo-grid" style="margin-top:16px">${vapCards}</div>` : ''
    }`;
  }

  // Build the Evidence Manifest appendix — entirely server-side from the
  // stored manifest (schemaVersion >= 2). Provenance is never AI-generated.
  let evidenceManifestHtml: string | null = null;
  const manifest = compiledData.evidenceManifest;
  if (manifest && Array.isArray(manifest.photos)) {
    const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Not recorded');
    const rows = manifest.photos
      .map((m) => {
        const hasAnnotations =
          m.annotations != null &&
          (typeof m.annotations !== 'object' || Object.keys(m.annotations as object).length > 0);
        const context = [m.stage, m.zone, m.subjectType, m.triadRole].filter(Boolean).join(' · ');
        return `<tr>
          <td style="font-family:monospace;font-size:10px">${escHtml(m.photoId)}</td>
          <td>${escHtml(fmt(m.capturedAtUtc))}</td>
          <td>${escHtml(fmt(m.uploadedAt))}</td>
          <td style="font-family:monospace;font-size:10px;word-break:break-all">${escHtml(m.sha256)}</td>
          <td>${escHtml(context || '—')}</td>
          <td>${hasAnnotations ? 'Annotated (original preserved)' : 'None'}</td>
        </tr>`;
      })
      .join('');
    evidenceManifestHtml = `
<p style="font-size:12px;color:#555">This manifest is generated directly from the original capture records and is
preserved verbatim in every version of this package. Photo IDs, capture timestamps, and SHA-256 integrity hashes
identify the original source files. Annotations are non-destructive overlays; the original images are never modified.
AI-written captions elsewhere in this report are descriptive aids only and do not replace this provenance record.</p>
<table class="detail-table" style="font-size:11px">
  <tr><th>Photo ID</th><th>Captured</th><th>Uploaded</th><th>SHA-256</th><th>Context</th><th>Edits/Annotations</th></tr>
  ${rows}
</table>
<p style="font-size:11px;color:#555">
  Inspection date: ${escHtml(fmt(manifest.inspectionDate))} ·
  Photos: ${manifest.photos.length}${
    compiledData.evidenceManifestSha256
      ? ` · Manifest SHA-256: <span style="font-family:monospace;word-break:break-all">${escHtml(compiledData.evidenceManifestSha256)}</span>`
      : ''
  }
</p>`;
  }

  // Record reopen history — disclosed inside the Evidence Manifest appendix
  // (server-built, never AI-generated). Older blobs without unlockLog simply
  // omit the section.
  if (compiledData.unlockLog?.length) {
    const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : 'Not recorded');
    const reopenRows = compiledData.unlockLog
      .map(
        (u) => `<tr>
          <td>${escHtml(fmt(u.previousLockedAt))}</td>
          <td>${escHtml(fmt(u.unlockedAt))}</td>
          <td>${escHtml(u.unlockedByName ?? 'Manager')}</td>
          <td>${escHtml(u.reason)}</td>
        </tr>`,
      )
      .join('');
    const reopenHtml = `
<h3 style="font-size:13px;margin-top:18px">Record Reopen History</h3>
<p style="font-size:12px;color:#555">This record was reopened for editing after submission by a manager. Each reopen
is disclosed below; the package was re-verified and re-locked at re-submission.</p>
<table class="detail-table" style="font-size:11px">
  <tr><th>Originally locked</th><th>Reopened</th><th>Authorized by</th><th>Reason</th></tr>
  ${reopenRows}
</table>`;
    evidenceManifestHtml = (evidenceManifestHtml ?? '') + reopenHtml;
  }

  // Build the Evidence-to-Scope Index appendix (schemaVersion >= 3 blobs
  // that carry approved links). Older blobs simply omit the section.
  let evidenceScopeIndexHtml: string | null = null;
  if (manifest?.approvedScopeLinks?.length) {
    const findingDisplayById = new Map<string, { displayRef: string; location: string | null }>();
    for (const p of manifest.photos) {
      if (p.linkedFinding && p.linkedFinding.subjectType === 'damage_instance') {
        findingDisplayById.set(p.linkedFinding.subjectId, {
          displayRef: p.linkedFinding.displayRef,
          location: p.linkedFinding.location,
        });
      }
    }
    evidenceScopeIndexHtml = buildEvidenceScopeIndexHtml({
      approvedScopeLinks: manifest.approvedScopeLinks,
      manifestPhotos: manifest.photos,
      findingDisplayById,
    });
  }

  // Build a minimal inspection row-alike from the snapshot for buildReportHtml.
  const snap = compiledData.inspectionSnapshot;
  const inspSnap = {
    ...inspection,  // real DB row (for any fields not in snapshot)
    id: snap.id,
    address: snap.address,
    claimNumber: snap.claimNumber,
    policyNumber: snap.policyNumber,
    insuredName: snap.insuredName,
    carrierName: snap.carrierName,
    dateOfLoss: snap.dateOfLoss,
    lockedAt: snap.lockedAt ? new Date(snap.lockedAt) : null,
  } as typeof inspectionsTable.$inferSelect;

  // Load the company's report branding — applied at render time so palette
  // changes affect every preview immediately, even for reports compiled
  // before the change. Invalid/missing values fall back to the defaults.
  const [company] = await db
    .select({ reportBranding: companiesTable.reportBranding, logoUrl: companiesTable.logoUrl })
    .from(companiesTable)
    .where(eq(companiesTable.id, opts.companyId));

  // Company logo (when uploaded) is stored as an authenticated
  // /api/storage/objects/... URL — resolve it to a fresh signed URL at
  // render time, never embedding a stored expiring URL. Best-effort: an
  // unusable logo path just renders the cover without a logo.
  const logoSignedUrl = company?.logoUrl
    ? await tryGetPhotoSignedUrl(objectStorageService, company.logoUrl)
    : null;

  // ── schemaVersion 6+: A–M exhibit Proof Package template ──────────────
  // The v6 compile bakes a `reportData` snapshot into the blob; older blobs
  // (v≤5) keep rendering through the legacy template unchanged so previously
  // compiled versions still open exactly as they did.
  const rd = (compiledData as { reportData?: ProofPackageReportData }).reportData;
  if (compiledData.schemaVersion >= 6 && rd) {
    // Sign the cover photo + inspector signature fresh (never stored signed).
    const coverEntry = rd.coverPhotoId ? compiledData.photoIndex[rd.coverPhotoId] : null;
    const [coverPhotoUrl, signatureUrl] = await Promise.all([
      coverEntry ? tryGetPhotoSignedUrl(objectStorageService, coverEntry.objectPath) : Promise.resolve(null),
      rd.signaturePath ? tryGetPhotoSignedUrl(objectStorageService, rd.signaturePath) : Promise.resolve(null),
    ]);

    const photosVisible = carrierVisible('photoGroupings');
    const photos = photosVisible
      ? rd.photoMeta
          .filter((p) => compiledData.photoIndex[p.id])
          .map((p) => {
            const entry = compiledData.photoIndex[p.id]!;
            return {
              id: p.id,
              url: freshSignedUrls.get(p.id) ?? null,
              stage: entry.stage,
              subject: [entry.zone, entry.subjectType].filter(Boolean).join(' · ') || 'Evidence photo',
              caption: p.caption,
              sha256: p.sha256,
              area: p.area,
            };
          })
      : [];

    const unlockLogHtml = compiledData.unlockLog?.length
      ? `<p style="font-size:12px;">This record was reopened under manager authorization after its original lock. Each reopen event is disclosed below.</p>
         <table class="detail-table"><thead><tr><th>Reopened by</th><th>When</th><th>Reason</th><th>Previously locked</th></tr></thead><tbody>
         ${compiledData.unlockLog
           .map(
             (u) =>
               `<tr><td>${escHtml(u.unlockedByName ?? 'Manager')}</td><td>${escHtml(new Date(u.unlockedAt).toLocaleString())}</td><td>${escHtml(u.reason)}</td><td>${escHtml(new Date(u.previousLockedAt).toLocaleString())}</td></tr>`,
           )
           .join('')}
         </tbody></table>`
      : null;

    const html = buildProofPackageHtml({
      reportId: snap.id.slice(0, 8).toUpperCase(),
      generatedAt: compiledData.generatedAt,
      company: rd.company,
      statePack: rd.statePack,
      property: {
        address: snap.address ?? 'Address not recorded',
        addressShort: (snap.address ?? '').split(',')[0] || 'Property',
        insuredName: snap.insuredName ?? 'Not recorded',
        carrier: snap.carrierName ?? 'Not recorded',
        policyNumber: snap.policyNumber ?? 'Not recorded',
        claimNumber: snap.claimNumber ?? 'Not recorded',
        dateOfLoss: snap.dateOfLoss ?? 'Not recorded',
        phase1Date: rd.phase1Date,
        phase2Date: rd.phase2Date,
      },
      inspectorName: compiledData.inspector.name,
      coverPhotoUrl,
      storm: rd.storm,
      methodology: rd.methodology,
      areasImpacted: rd.areasImpacted,
      components: rd.components,
      aiSections: {
        forensicSummary: carrierVisible('aiSummary.forensicSummary') ? compiledData.aiSummary.forensicSummary : '',
        repairabilityText: carrierVisible('aiSummary.repairabilityText') ? compiledData.aiSummary.repairabilityText : '',
      },
      measurement: rd.measurement,
      scope: rd.scope,
      product: rd.product,
      photos,
      attestationHtml: carrierVisible('attestationHtml') ? compiledData.attestationHtml : '',
      extras: {
        propertyDetailsHtml: carrierVisible('propertyDetailsHtml') ? compiledData.propertyDetailsHtml : null,
        rapSectionHtml,
        vapSectionHtml,
        evidenceScopeIndexHtml,
        evidenceManifestHtml,
        unlockLogHtml,
      },
      portalAccess: opts.portalAccess ?? null,
      theme: resolveReportTheme(company?.reportBranding),
      logoUrl: logoSignedUrl,
      signatureUrl,
    });
    return { ok: true, html };
  }

  const html = buildReportHtml({
    inspection: inspSnap,
    inspector: compiledData.inspector,
    aiSummary: {
      forensicSummary: carrierVisible('aiSummary.forensicSummary') ? compiledData.aiSummary.forensicSummary : '',
      repairabilityText: carrierVisible('aiSummary.repairabilityText') ? compiledData.aiSummary.repairabilityText : '',
    },
    propertyDetailsHtml: carrierVisible('propertyDetailsHtml') ? compiledData.propertyDetailsHtml : '',
    photoSectionsHtml: carrierVisible('photoGroupings') ? photoSectionsHtml : '',
    attestationHtml: carrierVisible('attestationHtml') ? compiledData.attestationHtml : '',
    generatedAt: compiledData.generatedAt,
    rapSectionHtml,
    vapSectionHtml,
    theme: resolveReportTheme(company?.reportBranding),
    logoUrl: logoSignedUrl,
    evidenceManifestHtml,
    evidenceScopeIndexHtml,
    portalAccess: opts.portalAccess ?? null,
  });

  return { ok: true, html };
}

// GET /inspections/:inspectionId/report/lint
// Returns the lint status/findings of the latest compiled version plus any
// reviewer resolution, so the mobile review UI can surface them.
router.get('/inspections/:inspectionId/report/lint', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }
  if (!inspection.compiledReportPath) {
    res.status(404).json({ error: 'No compiled report found — compile the report first.' });
    return;
  }

  const dataFile = await objectStorageService.getObjectEntityFile(inspection.compiledReportPath);
  const [dataBuffer] = await dataFile.download();
  const compiledData = JSON.parse(dataBuffer.toString('utf-8')) as {
    lint?: { lintStatus: string; findings: unknown[] };
  };

  const resolution =
    inspection.reportLintResolution?.path === inspection.compiledReportPath
      ? inspection.reportLintResolution
      : null;

  res.json({
    // Pre-v4 blobs carry no lint — report them as passed (legacy content is
    // grandfathered; only newly compiled versions enter the gate).
    lintStatus: compiledData.lint?.lintStatus ?? 'passed',
    findings: compiledData.lint?.findings ?? [],
    resolution,
  });
});

// POST /inspections/:inspectionId/report/lint-resolve — { note? }
// Manager/admin-only explicit resolution of a blocked lint result on the
// LATEST compiled version. Scoped to the exact blob path, so any subsequent
// re-compile re-enters the gate. Content is never rewritten by this action.
router.post('/inspections/:inspectionId/report/lint-resolve', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  if (!isManagerOrAdmin(actor.role)) {
    res.status(403).json({ error: 'Only a manager or admin can resolve report content findings' });
    return;
  }

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }
  if (!inspection.compiledReportPath) {
    res.status(404).json({ error: 'No compiled report found — compile the report first.' });
    return;
  }

  const note =
    typeof (req.body as { note?: unknown })?.note === 'string'
      ? (req.body as { note: string }).note.trim().slice(0, 2000) || null
      : null;

  const resolution = {
    path: inspection.compiledReportPath,
    resolvedBy: actor.userId,
    resolvedAt: new Date().toISOString(),
    note,
  };

  await db
    .update(inspectionsTable)
    .set({ reportLintResolution: resolution })
    .where(eq(inspectionsTable.id, inspectionId));

  res.json({ resolution });
});

// ── Photo Curation & Captioning (Task #125) ────────────────────────────────
//
// Exhibit class inference for photos that haven't been manually classified.
function inferExhibitClass(photo: {
  stage: string | null;
  subjectType: string;
  triadRole: string | null;
  preliminaryRole: string | null;
}): ExhibitClass {
  const { stage, subjectType, triadRole, preliminaryRole } = photo;
  if (stage === 'test_squares' || subjectType === 'test_square' || subjectType === 'test_square_hit') return 'T';
  if (stage === 'interior' || subjectType === 'interior_observation') return 'I';
  if (stage === 'collateral' || triadRole === 'collateral') return 'C';
  if (triadRole === 'measurement') return 'F';
  if (stage === 'arrival' || preliminaryRole === 'front_of_home' || preliminaryRole === 'roof_overview') return 'S';
  return 'R';
}

/**
 * Returns true and sends a 409 response if the inspection's exhibit selection
 * set has already been finalized (any selection row has `finalizedAt` set).
 * All mutating curation endpoints must call this and return early on true.
 */
async function checkCurationNotFinalized(
  inspectionId: string,
  companyId: string,
  res: Response,
): Promise<boolean> {
  const [finalized] = await db
    .select({ id: exhibitSelectionsTable.id })
    .from(exhibitSelectionsTable)
    .where(
      and(
        eq(exhibitSelectionsTable.inspectionId, inspectionId),
        eq(exhibitSelectionsTable.companyId, companyId),
        sql`${exhibitSelectionsTable.finalizedAt} IS NOT NULL`,
      ),
    )
    .limit(1);
  if (finalized) {
    res.status(409).json({
      error: 'Badges are frozen — exhibit selections and comparison pairs cannot be changed after finalization.',
    });
    return true;
  }
  return false;
}

// Shared helper: load full curation state for a given inspection.
async function loadCurationState(inspectionId: string, companyId: string) {
  const [photos, selections, pairs, captions] = await Promise.all([
    db
      .select()
      .from(inspectionPhotosTable)
      .where(and(eq(inspectionPhotosTable.inspectionId, inspectionId), eq(inspectionPhotosTable.companyId, companyId)))
      .orderBy(inspectionPhotosTable.createdAt),
    db
      .select()
      .from(exhibitSelectionsTable)
      .where(and(eq(exhibitSelectionsTable.inspectionId, inspectionId), eq(exhibitSelectionsTable.companyId, companyId)))
      .orderBy(exhibitSelectionsTable.sortOrder),
    db
      .select()
      .from(comparisonPairsTable)
      .where(and(eq(comparisonPairsTable.inspectionId, inspectionId), eq(comparisonPairsTable.companyId, companyId)))
      .orderBy(comparisonPairsTable.createdAt),
    db
      .select()
      .from(exhibitCaptionsTable)
      .where(and(eq(exhibitCaptionsTable.inspectionId, inspectionId), eq(exhibitCaptionsTable.companyId, companyId)))
      .orderBy(exhibitCaptionsTable.badgeLabel),
  ]);

  const photoMap = new Map(photos.map((p) => [p.id, p]));

  const isFinalized = selections.length > 0 && selections.every((s) => s.finalizedAt !== null);
  const allCaptionsLocked = captions.length > 0 && captions.every((c) => c.state === 'locked');

  return {
    inspectionId,
    photos: photos.map((p) => ({
      id: p.id,
      url: p.url,
      stage: p.stage,
      subjectType: p.subjectType,
      triadRole: p.triadRole,
      preliminaryRole: p.preliminaryRole,
      capturedAtUtc: p.capturedAtUtc?.toISOString() ?? null,
      sha256: p.sha256,
    })),
    selections: selections.map((s) => ({
      ...s,
      finalizedAt: s.finalizedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      photo: photoMap.has(s.photoId)
        ? {
            id: s.photoId,
            url: photoMap.get(s.photoId)!.url,
            stage: photoMap.get(s.photoId)!.stage,
            subjectType: photoMap.get(s.photoId)!.subjectType,
            triadRole: photoMap.get(s.photoId)!.triadRole,
            preliminaryRole: photoMap.get(s.photoId)!.preliminaryRole,
            capturedAtUtc: photoMap.get(s.photoId)!.capturedAtUtc?.toISOString() ?? null,
            sha256: photoMap.get(s.photoId)!.sha256,
          }
        : null,
    })),
    pairs: pairs.map((pair) => ({
      ...pair,
      confirmedAt: pair.confirmedAt?.toISOString() ?? null,
      createdAt: pair.createdAt.toISOString(),
      beforePhoto: photoMap.has(pair.beforePhotoId)
        ? { id: pair.beforePhotoId, url: photoMap.get(pair.beforePhotoId)!.url, stage: photoMap.get(pair.beforePhotoId)!.stage, subjectType: photoMap.get(pair.beforePhotoId)!.subjectType, triadRole: photoMap.get(pair.beforePhotoId)!.triadRole, preliminaryRole: photoMap.get(pair.beforePhotoId)!.preliminaryRole, capturedAtUtc: photoMap.get(pair.beforePhotoId)!.capturedAtUtc?.toISOString() ?? null, sha256: photoMap.get(pair.beforePhotoId)!.sha256 }
        : null,
      afterPhoto: photoMap.has(pair.afterPhotoId)
        ? { id: pair.afterPhotoId, url: photoMap.get(pair.afterPhotoId)!.url, stage: photoMap.get(pair.afterPhotoId)!.stage, subjectType: photoMap.get(pair.afterPhotoId)!.subjectType, triadRole: photoMap.get(pair.afterPhotoId)!.triadRole, preliminaryRole: photoMap.get(pair.afterPhotoId)!.preliminaryRole, capturedAtUtc: photoMap.get(pair.afterPhotoId)!.capturedAtUtc?.toISOString() ?? null, sha256: photoMap.get(pair.afterPhotoId)!.sha256 }
        : null,
    })),
    captions: captions.map((c) => ({
      ...c,
      generatedAt: c.generatedAt?.toISOString() ?? null,
      lockedAt: c.lockedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    isFinalized,
    exhibitBadgeMap: null as null | { counters: Record<string, number>; assignments: Record<string, string> },
    photoComparisonGateActive: isFinalized && allCaptionsLocked,
  };
}

// GET /inspections/:inspectionId/curation
router.get('/:inspectionId/curation', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }

  const state = await loadCurationState(inspection.id, actor.companyId);
  const inspectionRow = await db.select({ compiledReportVersions: inspectionsTable.compiledReportVersions }).from(inspectionsTable).where(eq(inspectionsTable.id, inspection.id)).limit(1);
  // exhibitBadgeMap stored in compiledReportVersions or a side channel — for now read from first compiled blob metadata if available
  res.json(state);
});

// POST /inspections/:inspectionId/curation/propose — AI-propose exhibit set
router.post('/:inspectionId/curation/propose', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }
  if (await checkCurationNotFinalized(inspection.id, actor.companyId, res)) return;

  const photos = await db
    .select()
    .from(inspectionPhotosTable)
    .where(and(eq(inspectionPhotosTable.inspectionId, inspection.id), eq(inspectionPhotosTable.companyId, actor.companyId)))
    .orderBy(inspectionPhotosTable.createdAt);

  // Auto-proposal algorithm: prioritise by stage/role, cap at 12 exhibits
  const proposed: typeof photos = [];
  const addedIds = new Set<string>();

  function tryAdd(p: (typeof photos)[number]) {
    if (!addedIds.has(p.id) && proposed.length < 12) {
      proposed.push(p);
      addedIds.add(p.id);
    }
  }

  // 1. Overview / arrival photos
  for (const p of photos) {
    if (p.preliminaryRole === 'front_of_home' || p.preliminaryRole === 'roof_overview') tryAdd(p);
  }
  // 2. Test square close-ups (up to 4)
  const tsClosed = photos.filter((p) => p.subjectType === 'test_square' || p.subjectType === 'test_square_hit');
  for (const p of tsClosed.slice(0, 4)) tryAdd(p);
  // 3. Collateral / storm
  for (const p of photos.filter((p) => p.stage === 'collateral' || p.triadRole === 'collateral').slice(0, 2)) tryAdd(p);
  // 4. Interior (up to 2)
  for (const p of photos.filter((p) => p.stage === 'interior' || p.subjectType === 'interior_observation').slice(0, 2)) tryAdd(p);
  // 5. Roof damage — prefer close-ups per subjectId group, then wides to fill
  const damagePhotos = photos.filter((p) => ['slope', 'elevation', 'damage_instance'].includes(p.subjectType));
  const groupedBySubject = new Map<string, (typeof photos)[number][]>();
  for (const p of damagePhotos) {
    const key = `${p.subjectType}:${p.subjectId ?? 'none'}`;
    if (!groupedBySubject.has(key)) groupedBySubject.set(key, []);
    groupedBySubject.get(key)!.push(p);
  }
  for (const group of groupedBySubject.values()) {
    const close = group.find((p) => p.triadRole === 'close');
    const wide = group.find((p) => p.triadRole === 'wide');
    if (close) tryAdd(close);
    if (wide) tryAdd(wide);
    if (proposed.length >= 12) break;
  }

  // Clear existing AI-proposed selections, insert new ones
  await db.delete(exhibitSelectionsTable).where(
    and(
      eq(exhibitSelectionsTable.inspectionId, inspection.id),
      eq(exhibitSelectionsTable.companyId, actor.companyId),
      eq(exhibitSelectionsTable.isAiProposed, true),
    ),
  );

  for (let i = 0; i < proposed.length; i++) {
    const p = proposed[i];
    const inferredClass = inferExhibitClass(p);
    // Upsert: if already manually selected, don't overwrite
    const existing = await db
      .select()
      .from(exhibitSelectionsTable)
      .where(and(eq(exhibitSelectionsTable.inspectionId, inspection.id), eq(exhibitSelectionsTable.photoId, p.id)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(exhibitSelectionsTable).values({
        inspectionId: inspection.id,
        companyId: actor.companyId,
        photoId: p.id,
        exhibitClass: inferredClass,
        sortOrder: i,
        isAiProposed: true,
      });
    }
  }

  await db.insert(claimEventsTable).values({
    inspectionId: inspection.id,
    companyId: actor.companyId,
    eventType: 'exhibit_selected',
    payload: { source: 'ai_proposal', count: proposed.length },
    actorId: actor.userId,
  });

  const state = await loadCurationState(inspection.id, actor.companyId);
  res.json(state);
});

// PATCH /inspections/:inspectionId/curation/photos/:photoId — select/deselect/reclassify
router.patch('/:inspectionId/curation/photos/:photoId', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }

  const { selected, exhibitClass, sortOrder } = z.object({
    selected: z.boolean(),
    exhibitClass: z.enum(['R', 'S', 'I', 'F', 'C', 'T']).nullable().optional(),
    sortOrder: z.number().int().optional(),
  }).parse(req.body);

  // Inspection-level guard: blocks both edits to existing rows AND new insertions
  if (await checkCurationNotFinalized(inspection.id, actor.companyId, res)) return;

  const photoId = req.params.photoId as string;
  const photo = await db.select().from(inspectionPhotosTable).where(and(eq(inspectionPhotosTable.id, photoId), eq(inspectionPhotosTable.inspectionId, inspection.id))).limit(1);
  if (!photo.length) { res.status(404).json({ error: 'Photo not found' }); return; }

  const existing = await db.select().from(exhibitSelectionsTable).where(and(eq(exhibitSelectionsTable.inspectionId, inspection.id), eq(exhibitSelectionsTable.photoId, photoId))).limit(1);

  if (!selected) {
    await db.delete(exhibitSelectionsTable).where(and(eq(exhibitSelectionsTable.inspectionId, inspection.id), eq(exhibitSelectionsTable.photoId, photoId)));
    await db.insert(claimEventsTable).values({ inspectionId: inspection.id, companyId: actor.companyId, eventType: 'exhibit_deselected', payload: { photoId }, actorId: actor.userId });
    res.json({ selection: null });
    return;
  }

  const inferredClass = inferExhibitClass(photo[0]);
  const resolvedClass = (exhibitClass ?? existing[0]?.exhibitClass ?? inferredClass) as ExhibitClass;

  if (existing.length > 0) {
    await db.update(exhibitSelectionsTable).set({
      exhibitClass: resolvedClass,
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      isAiProposed: false,
    }).where(and(eq(exhibitSelectionsTable.inspectionId, inspection.id), eq(exhibitSelectionsTable.photoId, photoId)));
  } else {
    await db.insert(exhibitSelectionsTable).values({
      inspectionId: inspection.id,
      companyId: actor.companyId,
      photoId,
      exhibitClass: resolvedClass,
      sortOrder: sortOrder ?? 0,
      isAiProposed: false,
    });
    await db.insert(claimEventsTable).values({ inspectionId: inspection.id, companyId: actor.companyId, eventType: 'exhibit_selected', payload: { photoId }, actorId: actor.userId });
  }

  if (exhibitClass !== undefined) {
    await db.insert(claimEventsTable).values({ inspectionId: inspection.id, companyId: actor.companyId, eventType: 'exhibit_class_set', payload: { photoId, exhibitClass }, actorId: actor.userId });
  }

  const [updated] = await db.select().from(exhibitSelectionsTable).where(and(eq(exhibitSelectionsTable.inspectionId, inspection.id), eq(exhibitSelectionsTable.photoId, photoId))).limit(1);
  res.json({ selection: updated });
});

// POST /inspections/:inspectionId/curation/pairs — confirm a comparison pair
router.post('/:inspectionId/curation/pairs', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }
  if (await checkCurationNotFinalized(inspection.id, actor.companyId, res)) return;

  const { beforePhotoId, afterPhotoId, pairType, notes } = z.object({
    beforePhotoId: z.string().min(1),
    afterPhotoId: z.string().min(1),
    pairType: z.enum(['pre_post_loss', 'condition_differentiation', 'directional_comparison']),
    notes: z.string().max(1000).optional(),
  }).parse(req.body);

  if (beforePhotoId === afterPhotoId) { res.status(400).json({ error: 'A photo cannot be paired with itself.' }); return; }

  // Validate both photos belong to this inspection and company (prevent cross-tenant ID injection)
  const [beforePhotoRow] = await db
    .select({ id: inspectionPhotosTable.id })
    .from(inspectionPhotosTable)
    .where(and(
      eq(inspectionPhotosTable.id, beforePhotoId),
      eq(inspectionPhotosTable.inspectionId, inspection.id),
      eq(inspectionPhotosTable.companyId, actor.companyId),
    ))
    .limit(1);
  if (!beforePhotoRow) { res.status(422).json({ error: 'Before photo not found in this inspection.' }); return; }

  const [afterPhotoRow] = await db
    .select({ id: inspectionPhotosTable.id })
    .from(inspectionPhotosTable)
    .where(and(
      eq(inspectionPhotosTable.id, afterPhotoId),
      eq(inspectionPhotosTable.inspectionId, inspection.id),
      eq(inspectionPhotosTable.companyId, actor.companyId),
    ))
    .limit(1);
  if (!afterPhotoRow) { res.status(422).json({ error: 'After photo not found in this inspection.' }); return; }

  const [pair] = await db.insert(comparisonPairsTable).values({
    inspectionId: inspection.id,
    companyId: actor.companyId,
    beforePhotoId,
    afterPhotoId,
    pairType,
    confirmedBy: actor.userId,
    confirmedAt: new Date(),
    notes: notes ?? null,
  }).returning();

  await db.insert(claimEventsTable).values({ inspectionId: inspection.id, companyId: actor.companyId, eventType: 'comparison_pair_confirmed', payload: { pairId: pair.id, pairType }, actorId: actor.userId });

  res.json({ pair: { ...pair, confirmedAt: pair.confirmedAt?.toISOString() ?? null, createdAt: pair.createdAt.toISOString() } });
});

// DELETE /inspections/:inspectionId/curation/pairs/:pairId
router.delete('/:inspectionId/curation/pairs/:pairId', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }
  if (await checkCurationNotFinalized(inspection.id, actor.companyId, res)) return;

  const pairId = req.params.pairId as string;
  const existing = await db.select().from(comparisonPairsTable).where(and(eq(comparisonPairsTable.id, pairId), eq(comparisonPairsTable.inspectionId, inspection.id))).limit(1);
  if (!existing.length) { res.status(404).json({ error: 'Pair not found' }); return; }

  await db.delete(comparisonPairsTable).where(eq(comparisonPairsTable.id, pairId));
  await db.insert(claimEventsTable).values({ inspectionId: inspection.id, companyId: actor.companyId, eventType: 'comparison_pair_removed', payload: { pairId }, actorId: actor.userId });

  res.json({ ok: true });
});

// POST /inspections/:inspectionId/curation/finalize — freeze badge assignments
router.post('/:inspectionId/curation/finalize', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  if (!isManagerOrAdmin(actor.role)) { res.status(403).json({ error: 'Only managers and admins can finalize badge assignments.' }); return; }

  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }

  const selections = await db
    .select()
    .from(exhibitSelectionsTable)
    .where(and(eq(exhibitSelectionsTable.inspectionId, inspection.id), eq(exhibitSelectionsTable.companyId, actor.companyId)))
    .orderBy(exhibitSelectionsTable.sortOrder);

  if (selections.length === 0) { res.status(422).json({ error: 'No photos selected — select at least one exhibit photo before freezing.' }); return; }

  const alreadyFinalized = selections.every((s) => s.finalizedAt !== null);
  if (alreadyFinalized) { res.status(409).json({ error: 'Badge assignments are already frozen.' }); return; }

  // Fetch photo metadata for class inference (outside transaction — read-only)
  const photoIds = selections.map((s) => s.photoId);
  const photos = await db.select().from(inspectionPhotosTable).where(inArray(inspectionPhotosTable.id, photoIds));
  const photoMap = new Map(photos.map((p) => [p.id, p]));

  // Compute badge assignments before the transaction
  const counters: Record<string, number> = { R: 0, S: 0, I: 0, F: 0, C: 0, T: 0 };
  const assignments: Record<string, { cls: ExhibitClass; badge: string }> = {};
  for (const sel of selections) {
    const photo = photoMap.get(sel.photoId);
    const cls = (sel.exhibitClass ?? (photo ? inferExhibitClass(photo) : 'R')) as ExhibitClass;
    counters[cls] = (counters[cls] ?? 0) + 1;
    assignments[sel.id] = { cls, badge: `${cls}-${counters[cls]}` };
  }

  // Wrap all writes in a transaction — partial failure leaves no half-frozen state.
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const sel of selections) {
      const { cls, badge } = assignments[sel.id];
      await tx.update(exhibitSelectionsTable).set({
        exhibitClass: cls,
        badgeLabel: badge,
        finalizedAt: now,
      }).where(eq(exhibitSelectionsTable.id, sel.id));
    }

    for (const sel of selections) {
      const { badge } = assignments[sel.id];
      const [exists] = await tx
        .select({ id: exhibitCaptionsTable.id })
        .from(exhibitCaptionsTable)
        .where(eq(exhibitCaptionsTable.exhibitSelectionId, sel.id))
        .limit(1);
      if (!exists) {
        await tx.insert(exhibitCaptionsTable).values({
          inspectionId: inspection.id,
          companyId: actor.companyId,
          exhibitSelectionId: sel.id,
          badgeLabel: badge,
          state: 'pending',
        });
      }
    }

    await tx.insert(claimEventsTable).values({
      inspectionId: inspection.id,
      companyId: actor.companyId,
      eventType: 'exhibit_badges_finalized',
      payload: { counters, assignmentCount: Object.keys(assignments).length },
      actorId: actor.userId,
    });
  });

  const state = await loadCurationState(inspection.id, actor.companyId);
  res.json(state);
});

// POST /inspections/:inspectionId/sections/captions/generate — AI caption generation
router.post('/:inspectionId/sections/captions/generate', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  if (!isManagerOrAdmin(actor.role)) { res.status(403).json({ error: 'Only managers and admins can generate captions.' }); return; }

  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }

  // Must be finalized first
  const selections = await db.select().from(exhibitSelectionsTable)
    .where(and(eq(exhibitSelectionsTable.inspectionId, inspection.id), eq(exhibitSelectionsTable.companyId, actor.companyId)));
  const isFinalized = selections.length > 0 && selections.every((s) => s.finalizedAt !== null);
  if (!isFinalized) { res.status(422).json({ error: 'Freeze badge assignments before generating captions.' }); return; }

  const allCaptions = await db.select().from(exhibitCaptionsTable)
    .where(and(eq(exhibitCaptionsTable.inspectionId, inspection.id), eq(exhibitCaptionsTable.companyId, actor.companyId)))
    .orderBy(exhibitCaptionsTable.badgeLabel);

  if (allCaptions.length === 0) { res.status(422).json({ error: 'No caption slots found — finalize badge assignments first.' }); return; }

  // Only regenerate unlocked captions — locked captions are permanently immutable.
  const captions = allCaptions.filter((c) => c.state !== 'locked');
  if (captions.length === 0) {
    res.status(422).json({ error: 'All captions are locked — nothing to regenerate.' });
    return;
  }

  // Build photo brief for the AI prompt (unlocked slots only)
  const photoIds = selections.map((s) => s.photoId);
  const photos = await db.select().from(inspectionPhotosTable).where(inArray(inspectionPhotosTable.id, photoIds));
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  const selectionMap = new Map(selections.map((s) => [s.id, s]));

  const exhibitBrief = captions.map((c) => {
    const sel = selectionMap.get(c.exhibitSelectionId);
    const photo = sel ? photoMap.get(sel.photoId) : undefined;
    return {
      exhibitCaptionId: c.id,
      badge: c.badgeLabel,
      stage: photo?.stage ?? 'unknown',
      subjectType: photo?.subjectType ?? 'unknown',
      triadRole: photo?.triadRole ?? null,
      preliminaryRole: photo?.preliminaryRole ?? null,
      exhibitClass: sel?.exhibitClass ?? 'R',
    };
  });

  const prompt = `You are a technical report writer for a forensic roofing and siding inspection company.

Generate one concise exhibit caption for each photo below. Each caption MUST:
1. Start with exactly "Photo — Exhibit {badge} —" (use the badge field provided)
2. Describe the observed condition or subject in technical, observation-based language
3. Reference the specific building component (facet, elevation, surface) where applicable
4. State what the photo documents (e.g. "hail impact damage to field shingles", "displacement of step flashing at chimney", "granule loss pattern on south-facing slope")
5. Be exactly 1-2 sentences
6. Never assert coverage conclusions, policy interpretations, dollar amounts, or insurance-advocacy language
7. Never use words like "should be covered", "insurance", "claim", "settlement", "damages owed"

Exhibit class guide: R=Roof, S=Storm/storm-event evidence, I=Interior/attic, F=Field measurement, C=Collateral damage, T=Test square

Photos:
${JSON.stringify(exhibitBrief, null, 2)}

Return a JSON array exactly: [{ "exhibitCaptionId": "...", "caption": "Photo — Exhibit X-# — ..." }, ...]`;

  let generated: Array<{ exhibitCaptionId: string; caption: string }> = [];
  try {
    const response = await geminiAi.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', maxOutputTokens: 4096 },
    });
    const raw = response.text ?? '';
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    generated = JSON.parse(cleaned) as typeof generated;
  } catch (err) {
    req.log.error({ err }, 'Caption generation failed');
    res.status(502).json({ error: 'Caption generation failed. Please try again.' });
    return;
  }

  // Accept only IDs that belong to unlocked caption slots for this inspection.
  const captionIdSet = new Set(captions.map((c) => c.id));
  const validGenerated = (Array.isArray(generated) ? generated : []).filter(
    (g) =>
      typeof g.exhibitCaptionId === 'string' &&
      captionIdSet.has(g.exhibitCaptionId) &&
      typeof g.caption === 'string' &&
      g.caption.length > 0,
  );

  // Safety threshold: require ≥50% of unlocked target captions to be returned validly.
  // A lower match rate indicates a malformed/truncated AI response — fail fast rather than
  // silently committing a partial update.
  const targetCount = captions.length;
  if (validGenerated.length < Math.ceil(targetCount * 0.5)) {
    req.log.error(
      { validCount: validGenerated.length, targetCount, rawLength: (generated as unknown[]).length },
      'Caption generation AI response below 50% valid-ID threshold — aborting commit',
    );
    res.status(502).json({
      error: `Caption generation produced too few valid results (${validGenerated.length}/${targetCount}). The AI response may be malformed — please retry.`,
    });
    return;
  }

  const now = new Date();
  for (const g of validGenerated) {
    const sanitized = sanitizeHtml(g.caption, { allowedTags: [], allowedAttributes: {} });
    const captionText = sanitized.slice(0, 500) || `Photo — Exhibit (see badge) — [caption pending review]`;
    // Double-guard: also exclude locked rows in the update predicate (belt-and-suspenders).
    await db.update(exhibitCaptionsTable)
      .set({ captionText, state: 'generated', generatedAt: now })
      .where(and(
        eq(exhibitCaptionsTable.id, g.exhibitCaptionId),
        eq(exhibitCaptionsTable.inspectionId, inspection.id),
        sql`${exhibitCaptionsTable.state} != 'locked'`,
      ));
  }

  await db.insert(claimEventsTable).values({
    inspectionId: inspection.id,
    companyId: actor.companyId,
    eventType: 'captions_generated',
    payload: { count: validGenerated.length },
    actorId: actor.userId,
  });

  const updated = await db.select().from(exhibitCaptionsTable)
    .where(and(eq(exhibitCaptionsTable.inspectionId, inspection.id), eq(exhibitCaptionsTable.companyId, actor.companyId)))
    .orderBy(exhibitCaptionsTable.badgeLabel);

  res.json({ captions: updated.map((c) => ({ ...c, generatedAt: c.generatedAt?.toISOString() ?? null, lockedAt: c.lockedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() })) });
});

// PATCH /inspections/:inspectionId/sections/captions/:captionId — edit caption text
router.patch('/:inspectionId/sections/captions/:captionId', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }

  const { captionText } = z.object({ captionText: z.string().min(1).max(500) }).parse(req.body);
  const captionId = req.params.captionId as string;

  const [caption] = await db.select().from(exhibitCaptionsTable).where(and(eq(exhibitCaptionsTable.id, captionId), eq(exhibitCaptionsTable.inspectionId, inspection.id))).limit(1);
  if (!caption) { res.status(404).json({ error: 'Caption not found' }); return; }
  if (caption.state === 'locked') { res.status(409).json({ error: 'Caption is locked and cannot be edited.' }); return; }

  const sanitized = sanitizeHtml(captionText, { allowedTags: [], allowedAttributes: {} });
  const [updated] = await db.update(exhibitCaptionsTable)
    .set({ captionText: sanitized, state: 'in_review' })
    .where(eq(exhibitCaptionsTable.id, captionId))
    .returning();

  res.json({ caption: { ...updated, generatedAt: updated.generatedAt?.toISOString() ?? null, lockedAt: updated.lockedAt?.toISOString() ?? null, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() } });
});

// POST /inspections/:inspectionId/sections/captions/approve — approve all generated captions
router.post('/:inspectionId/sections/captions/approve', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  if (!isManagerOrAdmin(actor.role)) { res.status(403).json({ error: 'Only managers and admins can approve captions.' }); return; }

  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }

  await db.update(exhibitCaptionsTable)
    .set({ state: 'approved' })
    .where(and(
      eq(exhibitCaptionsTable.inspectionId, inspection.id),
      eq(exhibitCaptionsTable.companyId, actor.companyId),
      inArray(exhibitCaptionsTable.state, ['generated', 'in_review']),
    ));

  const updated = await db.select().from(exhibitCaptionsTable)
    .where(and(eq(exhibitCaptionsTable.inspectionId, inspection.id), eq(exhibitCaptionsTable.companyId, actor.companyId)))
    .orderBy(exhibitCaptionsTable.badgeLabel);

  res.json({ captions: updated.map((c) => ({ ...c, generatedAt: c.generatedAt?.toISOString() ?? null, lockedAt: c.lockedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() })) });
});

// POST /inspections/:inspectionId/sections/captions/lock — lock all approved captions
router.post('/:inspectionId/sections/captions/lock', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;
  if (!isManagerOrAdmin(actor.role)) { res.status(403).json({ error: 'Only managers and admins can lock captions.' }); return; }

  const inspection = await loadInspectionInCompany(req.params.inspectionId as string, actor.companyId);
  if (!inspection) { res.status(404).json({ error: 'Inspection not found' }); return; }

  const allCaptions = await db.select().from(exhibitCaptionsTable)
    .where(and(eq(exhibitCaptionsTable.inspectionId, inspection.id), eq(exhibitCaptionsTable.companyId, actor.companyId)));

  const unapproved = allCaptions.filter((c) => c.state !== 'approved' && c.state !== 'locked');
  if (unapproved.length > 0) {
    res.status(422).json({ error: `${unapproved.length} caption(s) are not yet approved — approve all captions before locking.` });
    return;
  }

  const now = new Date();
  await db.update(exhibitCaptionsTable)
    .set({ state: 'locked', lockedAt: now, lockedBy: actor.userId })
    .where(and(
      eq(exhibitCaptionsTable.inspectionId, inspection.id),
      eq(exhibitCaptionsTable.companyId, actor.companyId),
      eq(exhibitCaptionsTable.state, 'approved'),
    ));

  await db.insert(claimEventsTable).values({
    inspectionId: inspection.id,
    companyId: actor.companyId,
    eventType: 'section_locked',
    payload: { section: 'captions' },
    actorId: actor.userId,
  });

  const updated = await db.select().from(exhibitCaptionsTable)
    .where(and(eq(exhibitCaptionsTable.inspectionId, inspection.id), eq(exhibitCaptionsTable.companyId, actor.companyId)))
    .orderBy(exhibitCaptionsTable.badgeLabel);

  res.json({ captions: updated.map((c) => ({ ...c, generatedAt: c.generatedAt?.toISOString() ?? null, lockedAt: c.lockedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() })) });
});

// =============================================================================
// PIPELINE (company-wide manager view) — Task #120
// =============================================================================

// GET /pipeline
// Company-wide inspection list with rep identity, for the CRM pipeline board.
// Accessible to any user with inspection module access; returns all company
// inspections rather than the actor-scoped list at GET /inspections.
router.get('/pipeline', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const rows = await db
    .select({
      id: inspectionsTable.id,
      address: inspectionsTable.address,
      status: inspectionsTable.status,
      phase: inspectionsTable.phase,
      damageType: inspectionsTable.damageType,
      compiledReportVersions: inspectionsTable.compiledReportVersions,
      pinId: inspectionsTable.pinId,
      createdAt: inspectionsTable.createdAt,
      updatedAt: inspectionsTable.updatedAt,
      inspectorUserId: inspectionsTable.inspectorUserId,
      repFirstName: usersTable.firstName,
      repLastName: usersTable.lastName,
    })
    .from(inspectionsTable)
    .leftJoin(usersTable, eq(usersTable.id, inspectionsTable.inspectorUserId))
    .where(eq(inspectionsTable.companyId, actor.companyId))
    .orderBy(desc(inspectionsTable.updatedAt));

  const inspections = rows.map((r) => ({
    id: r.id,
    address: r.address,
    status: r.status,
    phase: r.phase,
    damageType: r.damageType,
    pinId: r.pinId ?? null,
    compiledReportVersions: (r.compiledReportVersions ?? []) as Array<{
      path: string;
      compiledAt: string;
      schemaVersion?: number;
      lintStatus?: string;
    }>,
    repName: r.repFirstName
      ? [r.repFirstName, r.repLastName].filter(Boolean).join(' ')
      : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  // Include insurance-workflow pins that have no linked inspection yet.
  // These surface in the Insurance Pipeline's "Pin Dropped" column (status = 'pin_dropped').
  const unlinkedPinRows = await db
    .select({
      id:           pinsTable.id,
      address:      pinsTable.address,
      damageType:   pinsTable.damageType,
      createdAt:    pinsTable.createdAt,
      updatedAt:    pinsTable.updatedAt,
      repFirstName: usersTable.firstName,
      repLastName:  usersTable.lastName,
    })
    .from(pinsTable)
    .leftJoin(usersTable, eq(usersTable.id, pinsTable.userId))
    .leftJoin(
      inspectionsTable,
      and(
        eq(inspectionsTable.pinId, pinsTable.id),
        eq(inspectionsTable.companyId, actor.companyId),
      ),
    )
    .where(
      and(
        eq(pinsTable.companyId, actor.companyId),
        eq(pinsTable.workflow, 'insurance'),
        isNull(inspectionsTable.id),
      ),
    )
    .orderBy(desc(pinsTable.createdAt));

  const pinDroppedItems = unlinkedPinRows.map((p) => ({
    id:                     p.id,
    address:                p.address,
    status:                 'pin_dropped',
    phase:                  'forensic',
    damageType:             p.damageType,
    pinId:                  p.id,
    compiledReportVersions: [] as Array<{ path: string; compiledAt: string; schemaVersion?: number; lintStatus?: string }>,
    repName:                p.repFirstName ? [p.repFirstName, p.repLastName].filter(Boolean).join(' ') : null,
    createdAt:              p.createdAt.toISOString(),
    updatedAt:              p.updatedAt.toISOString(),
  }));

  res.json({ inspections: [...inspections, ...pinDroppedItems] });
});

// ---------------------------------------------------------------------------
// GET /search?q= — search inspections by insuredName or address
// ---------------------------------------------------------------------------

router.get('/search', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) return void res.json({ results: [] });

  const term = `%${q}%`;

  const rows = await db
    .select({
      id:          inspectionsTable.id,
      address:     inspectionsTable.address,
      insuredName: inspectionsTable.insuredName,
      status:      inspectionsTable.status,
    })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, actor.companyId),
        or(
          ilike(inspectionsTable.address,     term),
          ilike(inspectionsTable.insuredName, term),
        ),
      ),
    )
    .orderBy(desc(inspectionsTable.updatedAt))
    .limit(10);

  res.json({ results: rows });
});

// =============================================================================
// CLAIM HUB ROUTES (Task #120)
// =============================================================================

// ---------------------------------------------------------------------------
// GET /inspections/:inspectionId/readiness
// Stage 0 readiness checklist. Returns pass/fail/warning for each prerequisite.
// Full validation engine lands in Task #121; this route implements reasonable
// DB-backed checks using the data that already exists.
// ---------------------------------------------------------------------------
router.get('/inspections/:inspectionId/readiness', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) return void res.status(404).json({ error: 'Inspection not found' });

  // Fetch all data needed for the full 9-item readiness check in parallel.
  const [
    products,
    attests,
    testSquares,
    damageInstances,
    slopes,
    [company],
    ahjPacks,
    legacyJurisdictionPacks,
    claimSections,
    standardsEntries,
  ] = await Promise.all([
    db.select({
      identificationMethod: inspectionProductsTable.identificationMethod,
      discontinued: inspectionProductsTable.discontinued,
      ordinaryAvailability: inspectionProductsTable.ordinaryAvailability,
    })
      .from(inspectionProductsTable)
      .where(and(
        eq(inspectionProductsTable.inspectionId, inspectionId),
        eq(inspectionProductsTable.companyId, actor.companyId),
      )),
    db.select({ attestationType: attestationsTable.attestationType })
      .from(attestationsTable)
      .where(and(
        eq(attestationsTable.inspectionId, inspectionId),
        eq(attestationsTable.companyId, actor.companyId),
      )),
    db.select({ id: testSquaresTable.id })
      .from(testSquaresTable)
      .where(and(
        eq(testSquaresTable.inspectionId, inspectionId),
        eq(testSquaresTable.companyId, actor.companyId),
      )),
    db.select({ id: damageInstancesTable.id })
      .from(damageInstancesTable)
      .where(and(
        eq(damageInstancesTable.inspectionId, inspectionId),
        eq(damageInstancesTable.companyId, actor.companyId),
      ))
      .limit(1),
    db.select({ materialType: inspectionSlopesTable.materialType })
      .from(inspectionSlopesTable)
      .where(and(
        eq(inspectionSlopesTable.inspectionId, inspectionId),
        eq(inspectionSlopesTable.companyId, actor.companyId),
      )),
    db.select({
      contractorLicenses: companiesTable.contractorLicenses,
      qualificationsText: companiesTable.qualificationsText,
    })
      .from(companiesTable)
      .where(eq(companiesTable.id, actor.companyId))
      .limit(1),
    db.select({ packType: ahjPacksTable.packType, jurisdiction: ahjPacksTable.jurisdiction })
      .from(ahjPacksTable)
      .where(eq(ahjPacksTable.companyId, actor.companyId)),
    db.select({ state: companyJurisdictionPacksTable.state })
      .from(companyJurisdictionPacksTable)
      .where(eq(companyJurisdictionPacksTable.companyId, actor.companyId)),
    db.select({
      sectionType: claimSectionsTable.sectionType,
      libraryVersionSnapshot: claimSectionsTable.libraryVersionSnapshot,
    })
      .from(claimSectionsTable)
      .where(eq(claimSectionsTable.inspectionId, inspectionId)),
    db.select({ entryKey: standardsEntriesTable.entryKey, verificationStatus: standardsEntriesTable.verificationStatus })
      .from(standardsEntriesTable)
      .where(eq(standardsEntriesTable.companyId, actor.companyId)),
  ]);

  const result = computeReadiness({
    inspectionId,
    inspection: {
      ...inspection,
      rapGateReason: (inspection.rapGateReason as string | null | undefined) ?? null,
      estimate: (inspection.estimate as { lines?: Array<{ description?: string; categoryCode?: string }> } | null),
      temporaryRepairs: (inspection.temporaryRepairs as { performed?: boolean; openings?: boolean } | null),
      propertyProfile: (inspection.propertyProfile as { structureType?: string; garageAttached?: boolean } | null),
      interiorDamageFound: inspection.interiorDamageFound,
    },
    products: products.map(p => ({
      identificationMethod: p.identificationMethod,
      discontinued: p.discontinued ?? null,
      ordinaryAvailability: p.ordinaryAvailability ?? null,
    })),
    slopes,
    attestations: attests.map(a => ({ attestationType: a.attestationType ?? null })),
    testSquaresCount: testSquares.length,
    damageInstancesCount: damageInstances.length,
    company: {
      contractorLicenses: company?.contractorLicenses ?? null,
      qualificationsText: company?.qualificationsText ?? null,
    },
    ahjPacks,
    legacyJurisdictionStates: legacyJurisdictionPacks.map(p => p.state),
    claimSections: claimSections.map(s => ({
      sectionType: s.sectionType,
      libraryVersionSnapshot: (s.libraryVersionSnapshot as { standardsEntryKeys?: string[] } | null) ?? null,
    })),
    standardsEntries: standardsEntries.map(e => ({
      entryKey: e.entryKey,
      verificationStatus: e.verificationStatus,
    })),
  });

  res.json(result);
});

// ---------------------------------------------------------------------------
// GET /inspections/:inspectionId/sections
// Returns section lifecycle states. Stub implementation — Task #122 builds
// the full section pipeline and claim_sections table.
// ---------------------------------------------------------------------------
const SECTION_TYPES = [
  'findings',
  'causation',
  'detriment_application',
  'rap_narrative',
  'estimate_justifications',
  'summary_of_findings',
  'closing_statement',
] as const;

router.get('/inspections/:inspectionId/sections', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) return void res.status(404).json({ error: 'Inspection not found' });

  // Read from claim_sections. Rows are created by Task #122's generation pipeline.
  // Until then, return all section types as not_started (matching the pre-Task#122 stub).
  const rows = await db
    .select()
    .from(claimSectionsTable)
    .where(eq(claimSectionsTable.inspectionId, inspectionId));

  const rowsByType = new Map(rows.map(r => [r.sectionType, r]));

  const sections = SECTION_TYPES.map(sectionType => {
    const row = rowsByType.get(sectionType);
    return {
      sectionType,
      state: row?.state ?? 'not_started',
      contentHtml: row?.contentHtml ?? null,
      gateFlags: row?.gateFlags ?? null,
      lintStatus: row?.lintStatus ?? null,
      lintFindings: row?.lintFindings ?? null,
      generatedAt: row?.generatedAt ?? null,
      lockedAt: row?.lockedAt ?? null,
      lockedBy: row?.lockedBy ?? null,
      libraryVersionSnapshot: row?.libraryVersionSnapshot ?? null,
      rapMode: (row?.gateFlags as { rapMode?: string } | null)?.rapMode ?? null,
    };
  });

  res.json({ sections });
});

// ---------------------------------------------------------------------------
// POST /inspections/:inspectionId/sections/:sectionType/generate
// Real AI generation — Task #122.
//
// DAG enforcement: summary_of_findings and closing_statement return 409 if
// any upstream section (findings/causation/detriment_application/rap_narrative/
// estimate_justifications) is not yet approved or locked.
//
// Applicability gate: detriment entries are pre-filtered by condition set
// derived from the attested field record BEFORE the prompt is built.
// This is a code check, not a prompt instruction.
//
// Re-generation: if a section row already exists in approved/locked state,
// DAG-downstream sections are flipped to in_review (stale propagation).
// ---------------------------------------------------------------------------
router.post('/inspections/:inspectionId/sections/:sectionType/generate', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const rawType = req.params.sectionType as string;

  // captions has its own dedicated route; reject here to avoid confusion.
  if (rawType === 'captions') {
    return void res.status(422).json({
      error: 'Requires photo curation.',
      detail: 'Caption generation requires finalized badge assignments from the Photo Curation task.',
    });
  }

  if (!GENERATABLE_SECTION_TYPES.includes(rawType as GeneratableSectionType)) {
    return void res.status(400).json({ error: 'Unknown section type' });
  }
  const sectionType = rawType as GeneratableSectionType;

  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) return void res.status(404).json({ error: 'Inspection not found' });

  // ── DAG enforcement ──────────────────────────────────────────────────────
  // DAG-last sections require all upstream sections to be approved or locked.
  if (DAG_LAST_SECTION_TYPES.has(sectionType)) {
    const upstreamRows = await db
      .select({ sectionType: claimSectionsTable.sectionType, state: claimSectionsTable.state })
      .from(claimSectionsTable)
      .where(
        and(
          eq(claimSectionsTable.inspectionId, inspectionId),
          inArray(claimSectionsTable.sectionType, [...DAG_UPSTREAM_SECTION_TYPES]),
        ),
      );
    const upstreamByType = new Map(upstreamRows.map((r) => [r.sectionType, r.state]));
    const notReady = DAG_UPSTREAM_SECTION_TYPES.filter(
      (t) => !['approved', 'locked'].includes(upstreamByType.get(t) ?? 'not_started'),
    );
    if (notReady.length > 0) {
      return void res.status(409).json({
        error: `Cannot generate ${sectionType} until all upstream sections are approved. Pending: ${notReady.join(', ')}`,
        pendingSections: notReady,
      });
    }
  }

  // ── Load generation data in parallel ────────────────────────────────────
  const [
    children,
    detrimentEntries,
    boilerplateVersions,
    ahjPackVersionRows,
    standardsEntriesRows,
    approvedSectionRows,
    existingRow,
  ] = await Promise.all([
    hydrateInspectionChildren(inspectionId, actor.companyId),
    db
      .select({
        entryKey: detrimentEntriesTable.entryKey,
        statement: detrimentEntriesTable.statement,
        requiredSupport: detrimentEntriesTable.requiredSupport,
        limitation: detrimentEntriesTable.limitation,
        applicabilityConditions: detrimentEntriesTable.applicabilityConditions,
      })
      .from(detrimentEntriesTable)
      .where(eq(detrimentEntriesTable.companyId, actor.companyId)),
    db
      .select({ sectionKey: boilerplateSectionsTable.sectionKey, version: boilerplateSectionsTable.version })
      .from(boilerplateSectionsTable)
      .where(eq(boilerplateSectionsTable.companyId, actor.companyId)),
    db
      .select({ packType: ahjPacksTable.packType, version: ahjPacksTable.version })
      .from(ahjPacksTable)
      .where(eq(ahjPacksTable.companyId, actor.companyId)),
    db
      .select({ entryKey: standardsEntriesTable.entryKey, verificationStatus: standardsEntriesTable.verificationStatus, version: standardsEntriesTable.version })
      .from(standardsEntriesTable)
      .where(eq(standardsEntriesTable.companyId, actor.companyId)),
    // For DAG-last sections: load approved/locked upstream sections' content
    DAG_LAST_SECTION_TYPES.has(sectionType)
      ? db
          .select({ sectionType: claimSectionsTable.sectionType, contentHtml: claimSectionsTable.contentHtml, state: claimSectionsTable.state })
          .from(claimSectionsTable)
          .where(
            and(
              eq(claimSectionsTable.inspectionId, inspectionId),
              inArray(claimSectionsTable.sectionType, [...DAG_UPSTREAM_SECTION_TYPES]),
            ),
          )
      : Promise.resolve([] as { sectionType: string; contentHtml: string | null; state: string }[]),
    // Check if a section row already exists (for stale propagation)
    db
      .select({ id: claimSectionsTable.id, state: claimSectionsTable.state })
      .from(claimSectionsTable)
      .where(
        and(
          eq(claimSectionsTable.inspectionId, inspectionId),
          eq(claimSectionsTable.sectionType, sectionType),
        ),
      )
      .limit(1),
  ]);

  // ── Locked-section guard ─────────────────────────────────────────────────
  // A locked section is final. Re-generation is blocked; the caller must
  // unlock (reopen) the section through an authorized flow before replacing it.
  if (existingRow.length > 0 && existingRow[0]!.state === 'locked') {
    return void res.status(409).json({
      error: 'Section is locked and cannot be re-generated. It must be unlocked by a manager before changes can be made.',
      state: 'locked',
      sectionId: existingRow[0]!.id,
    });
  }

  const approvedSections = new Map<string, string>(
    (approvedSectionRows as { sectionType: string; contentHtml: string | null; state: string }[])
      .filter((r) => ['approved', 'locked'].includes(r.state) && r.contentHtml)
      .map((r) => [r.sectionType, r.contentHtml!]),
  );

  // ── AI generation ────────────────────────────────────────────────────────
  let generationResult;
  try {
    generationResult = await generateSectionContent({
      inspectionId,
      sectionType,
      inspection: inspection as unknown as Record<string, unknown>,
      children,
      detrimentEntries: detrimentEntries.map((d) => ({
        ...d,
        requiredSupport: d.requiredSupport ?? null,
        limitation: d.limitation ?? null,
      })),
      approvedSections,
      standardsEntries: standardsEntriesRows.map((e) => ({
        ...e,
        version: e.version ?? 1,
        verifiedAt: null,
      })),
      boilerplateVersions: boilerplateVersions.map((b) => ({
        sectionKey: b.sectionKey,
        version: b.version ?? 1,
      })),
      ahjPackVersions: ahjPackVersionRows.map((p) => ({
        packType: p.packType,
        version: p.version ?? 1,
      })),
    });
  } catch (err) {
    req.log.error({ err, inspectionId, sectionType }, 'Section AI generation failed');
    return void res.status(502).json({ error: 'Section generation failed. Please try again.' });
  }

  const now = new Date();

  // ── Stale propagation ────────────────────────────────────────────────────
  // If re-generating an upstream section whose downstream DAG sections are
  // already approved or locked, flip them to in_review with staledBy.
  if (existingRow.length > 0 && !DAG_LAST_SECTION_TYPES.has(sectionType)) {
    const existingState = existingRow[0]!.state;
    if (['generated', 'in_review', 'approved', 'locked'].includes(existingState)) {
      // Only stale sections that depend on this one
      const downstreamTypes = [...DAG_LAST_SECTION_TYPES];
      for (const downstreamType of downstreamTypes) {
        await db
          .update(claimSectionsTable)
          .set({ state: 'in_review', staledBy: sectionType, updatedAt: now })
          .where(
            and(
              eq(claimSectionsTable.inspectionId, inspectionId),
              eq(claimSectionsTable.sectionType, downstreamType),
              inArray(claimSectionsTable.state, ['approved', 'locked']),
            ),
          );
      }
    }
  }

  // ── Upsert claim_sections row ────────────────────────────────────────────
  const upsertValues = {
    inspectionId,
    companyId: actor.companyId,
    sectionType,
    state: 'generated' as const,
    contentHtml: generationResult.contentHtml,
    lintStatus: generationResult.lintResult.lintStatus,
    lintFindings: generationResult.lintResult.findings,
    gateFlags: { rapMode: generationResult.rapMode },
    generatedAt: now,
    // Clear stale marker when re-generating
    staledBy: null,
    libraryVersionSnapshot: generationResult.libraryVersionSnapshot,
  };

  let sectionId: string;
  if (existingRow.length > 0) {
    await db
      .update(claimSectionsTable)
      .set({ ...upsertValues, lockedAt: null, lockedBy: null })
      .where(eq(claimSectionsTable.id, existingRow[0]!.id));
    sectionId = existingRow[0]!.id;
  } else {
    const [inserted] = await db
      .insert(claimSectionsTable)
      .values(upsertValues)
      .returning({ id: claimSectionsTable.id });
    sectionId = inserted!.id;
  }

  res.json({
    sectionType,
    state: 'generated',
    sectionId,
    contentHtml: generationResult.contentHtml,
    lintStatus: generationResult.lintResult.lintStatus,
    lintFindings: generationResult.lintResult.findings,
    rapMode: generationResult.rapMode,
    libraryVersionSnapshot: generationResult.libraryVersionSnapshot,
    generatedAt: now.toISOString(),
  });
});

// ---------------------------------------------------------------------------
// POST /inspections/:inspectionId/sections/:sectionType/approve
// Advances state generated → approved with gate checks:
//   causation / detriment_application: causationReviewConfirmed: true required
//   rap_narrative: rapFallbackConfirmed: true required when mode=fallback_slope
//   findings: photoComparisonConfirmed always passes (stub until photo curation)
// Manager-or-admin only for causation/detriment_application gates.
// ---------------------------------------------------------------------------
router.post('/inspections/:inspectionId/sections/:sectionType/approve', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const rawType = req.params.sectionType as string;

  if (!GENERATABLE_SECTION_TYPES.includes(rawType as GeneratableSectionType)) {
    return void res.status(400).json({ error: 'Unknown section type' });
  }
  const sectionType = rawType as GeneratableSectionType;

  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) return void res.status(404).json({ error: 'Inspection not found' });

  const [sectionRow] = await db
    .select()
    .from(claimSectionsTable)
    .where(
      and(
        eq(claimSectionsTable.inspectionId, inspectionId),
        eq(claimSectionsTable.sectionType, sectionType),
      ),
    )
    .limit(1);

  if (!sectionRow) {
    return void res.status(404).json({ error: 'Section not found — generate it first' });
  }
  if (!['generated', 'in_review'].includes(sectionRow.state)) {
    return void res.status(409).json({
      error: `Section is in state '${sectionRow.state}' — can only approve from generated or in_review`,
    });
  }

  const body = req.body as Record<string, unknown>;
  const existingGateFlags = (sectionRow.gateFlags as Record<string, unknown> | null) ?? {};
  const newGateFlags: Record<string, unknown> = { ...existingGateFlags };

  // ── Gate checks per section type ─────────────────────────────────────────
  if (sectionType === 'causation' || sectionType === 'detriment_application') {
    // Requires manager+ to confirm deliberate review act
    if (!isManagerOrAdmin(actor.role)) {
      return void res.status(403).json({
        error: 'Causation and Detriment Application sections require manager or admin approval',
      });
    }
    if (body.causationReviewConfirmed !== true) {
      return void res.status(422).json({
        error: 'causationReviewConfirmed: true is required to approve this section',
        detail:
          'This confirms a deliberate review of the causation reasoning against the attested field record.',
      });
    }
    newGateFlags.causationReviewConfirmed = true;
    newGateFlags.reviewerUserId = actor.userId;
    newGateFlags.reviewedAt = new Date().toISOString();
  }

  if (sectionType === 'rap_narrative') {
    const rapMode = (existingGateFlags.rapMode as string | null) ?? null;
    if (rapMode === 'fallback_slope' && body.rapFallbackConfirmed !== true) {
      return void res.status(422).json({
        error: 'rapFallbackConfirmed: true is required when RAP mode is fallback_slope',
        detail: 'This asserts the fallback-variant narrative rendered correctly for this inspection.',
      });
    }
    if (body.rapFallbackConfirmed === true) {
      newGateFlags.rapFallbackConfirmed = true;
    }
  }

  // findings: photoComparisonConfirmed always passes (stub — real gate lands in photo curation task)
  if (sectionType === 'findings') {
    newGateFlags.photoComparisonConfirmed = true;
  }

  await db
    .update(claimSectionsTable)
    .set({
      state: 'approved',
      gateFlags: newGateFlags,
      staledBy: null,
    })
    .where(eq(claimSectionsTable.id, sectionRow.id));

  res.json({
    sectionType,
    state: 'approved',
    sectionId: sectionRow.id,
    gateFlags: newGateFlags,
  });
});

// ---------------------------------------------------------------------------
// POST /inspections/:inspectionId/sections/:sectionType/auto-approve
// Manager-only shortcut: approves without gate checks. Intended for
// boilerplate shells accepted as-is and for sections reviewed offline.
// ---------------------------------------------------------------------------
router.post('/inspections/:inspectionId/sections/:sectionType/auto-approve', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  if (!isManagerOrAdmin(actor.role)) {
    return void res.status(403).json({ error: 'Only managers and admins can auto-approve sections' });
  }

  const inspectionId = req.params.inspectionId as string;
  const rawType = req.params.sectionType as string;

  if (!GENERATABLE_SECTION_TYPES.includes(rawType as GeneratableSectionType)) {
    return void res.status(400).json({ error: 'Unknown section type' });
  }
  const sectionType = rawType as GeneratableSectionType;

  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) return void res.status(404).json({ error: 'Inspection not found' });

  const [sectionRow] = await db
    .select()
    .from(claimSectionsTable)
    .where(
      and(
        eq(claimSectionsTable.inspectionId, inspectionId),
        eq(claimSectionsTable.sectionType, sectionType),
      ),
    )
    .limit(1);

  if (!sectionRow) {
    return void res.status(404).json({ error: 'Section not found — generate it first' });
  }
  if (sectionRow.state === 'locked') {
    return void res.status(409).json({ error: 'Section is already locked and cannot be changed' });
  }

  const existingGateFlags = (sectionRow.gateFlags as Record<string, unknown> | null) ?? {};

  await db
    .update(claimSectionsTable)
    .set({
      state: 'approved',
      staledBy: null,
      gateFlags: {
        ...existingGateFlags,
        autoApprovedBy: actor.userId,
        autoApprovedAt: new Date().toISOString(),
      },
    })
    .where(eq(claimSectionsTable.id, sectionRow.id));

  res.json({
    sectionType,
    state: 'approved',
    sectionId: sectionRow.id,
    autoApproved: true,
  });
});

// ---------------------------------------------------------------------------
// POST /inspections/:inspectionId/sections/:sectionType/lock
// Advances approved → locked. Final; no further changes allowed.
// Stale propagation: locking an upstream section flips any approved or locked
// DAG-downstream sections (summary_of_findings, closing_statement) to in_review.
// Blocked lint status prevents locking unless a manager explicitly overrides.
// ---------------------------------------------------------------------------
router.post('/inspections/:inspectionId/sections/:sectionType/lock', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const rawType = req.params.sectionType as string;

  if (!GENERATABLE_SECTION_TYPES.includes(rawType as GeneratableSectionType)) {
    return void res.status(400).json({ error: 'Unknown section type' });
  }
  const sectionType = rawType as GeneratableSectionType;

  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) return void res.status(404).json({ error: 'Inspection not found' });

  const [sectionRow] = await db
    .select()
    .from(claimSectionsTable)
    .where(
      and(
        eq(claimSectionsTable.inspectionId, inspectionId),
        eq(claimSectionsTable.sectionType, sectionType),
      ),
    )
    .limit(1);

  if (!sectionRow) {
    return void res.status(404).json({ error: 'Section not found' });
  }
  if (sectionRow.state !== 'approved') {
    return void res.status(409).json({
      error: `Section must be in 'approved' state to lock — current state: ${sectionRow.state}`,
    });
  }

  // Blocked lint prevents locking. Only a manager/admin can override, and they
  // must do so explicitly via { overrideLintBlock: true } in the request body.
  // A non-manager sending overrideLintBlock: true is still rejected — the flag
  // only activates the override for users who already pass the role check.
  const body = req.body as { overrideLintBlock?: boolean } | null;
  if (sectionRow.lintStatus === 'blocked') {
    if (!isManagerOrAdmin(actor.role)) {
      return void res.status(422).json({
        error: 'Section has blocked lint findings. A manager must resolve or override before locking.',
        lintStatus: 'blocked',
        lintFindings: sectionRow.lintFindings,
      });
    }
    // Manager must confirm the override explicitly.
    if (body?.overrideLintBlock !== true) {
      return void res.status(422).json({
        error: 'Section has blocked lint findings. Pass overrideLintBlock: true to acknowledge and proceed.',
        lintStatus: 'blocked',
        lintFindings: sectionRow.lintFindings,
      });
    }
  }

  const now = new Date();
  await db
    .update(claimSectionsTable)
    .set({
      state: 'locked',
      lockedAt: now,
      lockedBy: actor.userId,
    })
    .where(eq(claimSectionsTable.id, sectionRow.id));

  // ── Stale propagation ────────────────────────────────────────────────────
  // Locking an upstream section flips DAG-downstream sections that are already
  // approved or locked back to in_review so they incorporate the finalized content.
  if (!DAG_LAST_SECTION_TYPES.has(sectionType)) {
    const downstreamTypes = [...DAG_LAST_SECTION_TYPES];
    for (const downstreamType of downstreamTypes) {
      await db
        .update(claimSectionsTable)
        .set({ state: 'in_review', staledBy: sectionType, lockedAt: null, lockedBy: null })
        .where(
          and(
            eq(claimSectionsTable.inspectionId, inspectionId),
            eq(claimSectionsTable.sectionType, downstreamType),
            inArray(claimSectionsTable.state, ['approved', 'locked']),
          ),
        );
    }
  }

  res.json({
    sectionType,
    state: 'locked',
    sectionId: sectionRow.id,
    lockedAt: now.toISOString(),
    lockedBy: actor.userId,
  });
});

// ---------------------------------------------------------------------------
// GET /inspections/:inspectionId/events
// Chronological claim event log from claimEventsTable.
// ---------------------------------------------------------------------------
router.get('/inspections/:inspectionId/events', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) return void res.status(404).json({ error: 'Inspection not found' });

  const events = await db
    .select()
    .from(claimEventsTable)
    .where(and(
      eq(claimEventsTable.inspectionId, inspectionId),
      eq(claimEventsTable.companyId, actor.companyId),
    ))
    .orderBy(claimEventsTable.createdAt);

  res.json({
    events: events.map(e => ({
      id: e.id,
      eventType: e.eventType,
      payload: e.payload,
      actorId: e.actorId,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /inspections/:inspectionId/events
// Record a UI-triggered claim event. Only the allowlisted event types that a
// rep action creates (e.g. field_record_reviewed) may be posted here.
// Internal pipeline events (compiled, section_generated, etc.) are recorded
// by their own routes.
// ---------------------------------------------------------------------------

const UI_RECORDABLE_EVENT_TYPES = ['field_record_reviewed'] as const;
type UiRecordableEventType = (typeof UI_RECORDABLE_EVENT_TYPES)[number];

router.post('/inspections/:inspectionId/events', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  const inspectionId = req.params.inspectionId as string;
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) return void res.status(404).json({ error: 'Inspection not found' });

  const body = req.body as Record<string, unknown>;
  const eventType = body.eventType as string | undefined;

  if (!eventType || !(UI_RECORDABLE_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return void res.status(400).json({
      error: `eventType must be one of: ${UI_RECORDABLE_EVENT_TYPES.join(', ')}`,
    });
  }

  const typedEvent = eventType as UiRecordableEventType;

  // Idempotent: if this event already exists for the inspection, return the
  // existing record rather than duplicating it.
  const [existing] = await db
    .select()
    .from(claimEventsTable)
    .where(
      and(
        eq(claimEventsTable.inspectionId, inspectionId),
        eq(claimEventsTable.companyId, actor.companyId),
        eq(claimEventsTable.eventType, typedEvent),
      ),
    )
    .limit(1);

  if (existing) {
    return void res.json({
      event: {
        id: existing.id,
        eventType: existing.eventType,
        payload: existing.payload,
        actorId: existing.actorId,
        createdAt: existing.createdAt.toISOString(),
      },
    });
  }

  const [inserted] = await db
    .insert(claimEventsTable)
    .values({
      inspectionId,
      companyId: actor.companyId,
      eventType: typedEvent,
      payload: (body.payload as Record<string, unknown> | undefined) ?? {},
      actorId: actor.userId,
    })
    .returning();

  res.status(201).json({
    event: {
      id: inserted.id,
      eventType: inserted.eventType,
      payload: inserted.payload,
      actorId: inserted.actorId,
      createdAt: inserted.createdAt.toISOString(),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /leads
// All pins (door-knock leads) for the authenticated user's company.
// Includes the inspectionId when a linked inspection exists.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /retail-pipeline
// Pins grouped into retail pipeline stages. Stage is derived server-side
// from doorKnockResult, contactOutcome, and linked inspection status.
// ---------------------------------------------------------------------------

router.get('/retail-pipeline', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  const companyId = req.user.companyId;

  const rows = await db
    .select({
      id:             pinsTable.id,
      address:        pinsTable.address,
      workflow:       pinsTable.workflow,
      damageType:     pinsTable.damageType,
      doorKnockResult: pinsTable.doorKnockResult,
      contactOutcome: pinsTable.contactOutcome,
      customerName:   pinsTable.customerName,
      customerPhone:  pinsTable.customerPhone,
      retailData:     pinsTable.retailData,
      createdAt:      pinsTable.createdAt,
      repFirstName:   usersTable.firstName,
      repLastName:    usersTable.lastName,
      inspectionId:   inspectionsTable.id,
      inspectionStatus: inspectionsTable.status,
    })
    .from(pinsTable)
    .leftJoin(usersTable, eq(usersTable.id, pinsTable.userId))
    .leftJoin(
      inspectionsTable,
      and(
        eq(inspectionsTable.pinId, pinsTable.id),
        eq(inspectionsTable.companyId, companyId),
      ),
    )
    .where(
      and(
        eq(pinsTable.companyId, companyId),
        eq(pinsTable.workflow, 'retail'),
      ),
    )
    .orderBy(desc(pinsTable.createdAt));

  function deriveRetailStage(r: typeof rows[number]): string {
    if (r.doorKnockResult === 'no_answer') return 'archived_lost';
    if (r.inspectionId) {
      const s = r.inspectionStatus;
      if (s === 'submitted' || s === 'package_ready') return 'contract_signed';
      return 'estimate_provided';
    }
    if (r.doorKnockResult === 'appointment' || r.contactOutcome === 'call_to_schedule') return 'appt_scheduled';
    if (r.doorKnockResult === 'no_appointment') return 'followup_required';
    return 'pin_dropped';
  }

  const leads = rows.map(r => ({
    id:              r.id,
    address:         r.address,
    customerName:    r.customerName,
    customerPhone:   r.customerPhone,
    damageType:      r.damageType,
    doorKnockResult: r.doorKnockResult,
    contactOutcome:  r.contactOutcome,
    workflow:        r.workflow,
    repName:         r.repFirstName ? [r.repFirstName, r.repLastName].filter(Boolean).join(' ') : null,
    inspectionId:    r.inspectionId ?? null,
    retailStage:     deriveRetailStage(r),
    createdAt:       r.createdAt.toISOString(),
  }));

  res.json({ leads });
});

// ---------------------------------------------------------------------------
// GET /leads/:leadId — unified lead detail (pin or inspection)
// Accepts plain pin IDs (e.g. "abc-123") or "ins-<inspectionId>" prefixed IDs.
// ---------------------------------------------------------------------------

router.get('/leads/:leadId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  const { leadId } = req.params as { leadId: string };

  if (leadId.startsWith('ins-')) {
    const inspectionId = leadId.slice(4);
    const inspection = await loadInspectionInCompany(inspectionId, req.user.companyId);
    if (!inspection) return void res.status(404).json({ error: 'Lead not found' });

    const [user] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, inspection.inspectorUserId));

    const repName = user
      ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null
      : null;

    const lead = {
      id: `ins-${inspection.id}`,
      address: inspection.address,
      latitude: inspection.latitude ?? 0,
      longitude: inspection.longitude ?? 0,
      workflow: 'insurance' as const,
      damageType: inspection.damageType,
      photoUrl: null,
      doorKnockResult: null,
      contactOutcome: null,
      customerName: inspection.insuredName,
      customerPhone: null,
      status: inspection.status,
      pipelineStage: null,
      profileStatus: null,
      statusNotes: null,
      statusLastUpdated: null,
      ownerFirstName: null,
      ownerLastName: null,
      ownerEmail: null,
      owner2FirstName: null,
      owner2LastName: null,
      notes: inspection.notes,
      insuranceCarrier: inspection.carrierName,
      policyNumber: inspection.policyNumber,
      claimNumber: inspection.claimNumber,
      dateOfLoss: inspection.dateOfLoss ?? null,
      inspectionDate: null,
      adjusterName: null,
      adjusterPhone: null,
      adjusterEmail: null,
      adjusterMeetingDate: null,
      contractAmount: null,
      depositAmount: null,
      depositDate: null,
      depositPaymentMethod: null,
      deductibleAmount: null,
      rcvAmount: null,
      acvAmount: null,
      supplementAmount: null,
      finalPaymentAmount: null,
      contractScope: null,
      squareFootage: null,
      roofPitch: null,
      measurementVendor: null,
      measurementReportUrl: inspection.measurementsReportUrl ?? null,
      materialBrand: null,
      materialColor: null,
      materialStyle: null,
      retailData: null,
      // Lead Dashboard fields (ins- leads don't have these)
      nonOwnerOccupied:  null,
      mailingAddress:    null,
      mailingCity:       null,
      mailingState:      null,
      mailingZip:        null,
      mailerSentDate:    null,
      claimFiledDate:    null,
      policyHolder:      null,
      coverageType:      null,
      approvedRcvAmount: null,
      approvedAcvAmount: null,
      depreciationAmount: null,
      inspectionNotes:   null,
      inspectionId: inspectionId,
      ahjCheck: inspection.ahjCheck ?? null,
      repName,
      userId: inspection.inspectorUserId,
      companyId: inspection.companyId,
      createdAt: inspection.createdAt.toISOString(),
      updatedAt: inspection.updatedAt.toISOString(),
    };

    return void res.json({ lead });
  }

  // Plain pin ID
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, leadId), eq(pinsTable.companyId, req.user.companyId)));

  if (!pin) return void res.status(404).json({ error: 'Lead not found' });

  const [[user], [linked]] = await Promise.all([
    db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, pin.userId)),
    db
      .select({ id: inspectionsTable.id })
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.pinId, leadId), eq(inspectionsTable.companyId, req.user.companyId)))
      .limit(1),
  ]);

  const repName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null
    : null;

  res.json({ lead: { ...pin, repName, inspectionId: linked?.id ?? null } });
});

// ---------------------------------------------------------------------------
// PATCH /leads/:leadId/profile — save profile fields (pin or inspection)
// ---------------------------------------------------------------------------

router.patch('/leads/:leadId/profile', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  const { leadId } = req.params as { leadId: string };

  if (leadId.startsWith('ins-')) {
    const inspectionId = leadId.slice(4);
    const inspection = await loadInspectionInCompany(inspectionId, req.user.companyId);
    if (!inspection) return void res.status(404).json({ error: 'Lead not found' });

    const body = req.body as Record<string, string | null | undefined>;

    // Map FullLead profile fields → inspection columns
    const set: Record<string, unknown> = {};
    if (body.customerName       !== undefined) set.insuredName  = body.customerName;
    if (body.insuranceCarrier   !== undefined) set.carrierName  = body.insuranceCarrier;
    if (body.claimNumber        !== undefined) set.claimNumber  = body.claimNumber;
    if (body.policyNumber       !== undefined) set.policyNumber = body.policyNumber;
    if (body.dateOfLoss         !== undefined) set.dateOfLoss   = body.dateOfLoss ?? null;
    if (body.notes              !== undefined) set.notes        = body.notes;

    if (Object.keys(set).length > 0) {
      await db
        .update(inspectionsTable)
        .set(set)
        .where(eq(inspectionsTable.id, inspectionId));
    }

    const updated = await loadInspectionInCompany(inspectionId, req.user.companyId);
    const [user] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, inspection.inspectorUserId));
    const repName = user
      ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null
      : null;

    return void res.json({
      lead: {
        id: `ins-${updated!.id}`,
        address: updated!.address,
        latitude: updated!.latitude ?? 0,
        longitude: updated!.longitude ?? 0,
        workflow: 'insurance' as const,
        damageType: updated!.damageType,
        photoUrl: null,
        doorKnockResult: null,
        contactOutcome: null,
        customerName: updated!.insuredName,
        customerPhone: null,
        status: updated!.status,
        pipelineStage: null,
        profileStatus: null,
        statusNotes: null,
        statusLastUpdated: null,
        ownerFirstName: null,
        ownerLastName: null,
        ownerEmail: null,
        owner2FirstName: null,
        owner2LastName: null,
        notes: updated!.notes,
        insuranceCarrier: updated!.carrierName,
        policyNumber: updated!.policyNumber,
        claimNumber: updated!.claimNumber,
        dateOfLoss: updated!.dateOfLoss ?? null,
        inspectionDate: null,
        adjusterName: null,
        adjusterPhone: null,
        adjusterEmail: null,
        adjusterMeetingDate: null,
        contractAmount: null,
        depositAmount: null,
        depositDate: null,
        depositPaymentMethod: null,
        deductibleAmount: null,
        rcvAmount: null,
        acvAmount: null,
        supplementAmount: null,
        finalPaymentAmount: null,
        contractScope: null,
        squareFootage: null,
        roofPitch: null,
        measurementVendor: null,
        measurementReportUrl: updated!.measurementsReportUrl ?? null,
        materialBrand: null,
        materialColor: null,
        materialStyle: null,
        retailData: null,
        nonOwnerOccupied:   null,
        mailingAddress:     null,
        mailingCity:        null,
        mailingState:       null,
        mailingZip:         null,
        mailerSentDate:     null,
        claimFiledDate:     null,
        policyHolder:       null,
        coverageType:       null,
        approvedRcvAmount:  null,
        approvedAcvAmount:  null,
        depreciationAmount: null,
        inspectionNotes:    null,
        repName,
        userId: updated!.inspectorUserId,
        companyId: updated!.companyId,
        createdAt: updated!.createdAt.toISOString(),
        updatedAt: updated!.updatedAt.toISOString(),
      },
    });
  }

  // Pin lead — proxy through to the existing pin profile handler
  // Re-use the same Zod schema and DB logic as PATCH /pins/:pinId/profile
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, leadId), eq(pinsTable.companyId, req.user.companyId)));

  if (!pin) return void res.status(404).json({ error: 'Lead not found' });

  const role = await getRole(req.user.id);
  if (!canEditPin(role, req.user.id, pin.userId)) {
    return void res.status(403).json({ error: 'Not permitted to edit this lead' });
  }

  const parsed = LeadProfileBody.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const d = parsed.data;
  const [updated] = await db
    .update(pinsTable)
    .set({
      ...(d.ownerFirstName       !== undefined && { ownerFirstName:       d.ownerFirstName }),
      ...(d.ownerLastName        !== undefined && { ownerLastName:        d.ownerLastName }),
      ...(d.ownerEmail           !== undefined && { ownerEmail:           d.ownerEmail }),
      ...(d.owner2FirstName      !== undefined && { owner2FirstName:      d.owner2FirstName }),
      ...(d.owner2LastName       !== undefined && { owner2LastName:       d.owner2LastName }),
      ...(d.customerName         !== undefined && { customerName:         d.customerName }),
      ...(d.customerPhone        !== undefined && { customerPhone:        d.customerPhone }),
      ...(d.notes                !== undefined && { notes:                d.notes }),
      ...(d.pipelineStage        !== undefined && { pipelineStage:        d.pipelineStage }),
      ...(d.insuranceCarrier     !== undefined && { insuranceCarrier:     d.insuranceCarrier }),
      ...(d.policyNumber         !== undefined && { policyNumber:         d.policyNumber }),
      ...(d.claimNumber          !== undefined && { claimNumber:          d.claimNumber }),
      ...(d.dateOfLoss           !== undefined && { dateOfLoss:           toDateOrNull(d.dateOfLoss) }),
      ...(d.inspectionDate       !== undefined && { inspectionDate:       toDateOrNull(d.inspectionDate) }),
      ...(d.adjusterName         !== undefined && { adjusterName:         d.adjusterName }),
      ...(d.adjusterPhone        !== undefined && { adjusterPhone:        d.adjusterPhone }),
      ...(d.adjusterEmail        !== undefined && { adjusterEmail:        d.adjusterEmail }),
      ...(d.adjusterMeetingDate  !== undefined && { adjusterMeetingDate:  toDateOrNull(d.adjusterMeetingDate) }),
      ...(d.contractAmount       !== undefined && { contractAmount:       d.contractAmount }),
      ...(d.depositAmount        !== undefined && { depositAmount:        d.depositAmount }),
      ...(d.depositDate          !== undefined && { depositDate:          toDateOrNull(d.depositDate) }),
      ...(d.depositPaymentMethod !== undefined && { depositPaymentMethod: d.depositPaymentMethod }),
      ...(d.deductibleAmount     !== undefined && { deductibleAmount:     d.deductibleAmount }),
      ...(d.rcvAmount            !== undefined && { rcvAmount:            d.rcvAmount }),
      ...(d.acvAmount            !== undefined && { acvAmount:            d.acvAmount }),
      ...(d.supplementAmount     !== undefined && { supplementAmount:     d.supplementAmount }),
      ...(d.finalPaymentAmount   !== undefined && { finalPaymentAmount:   d.finalPaymentAmount }),
      ...(d.contractScope        !== undefined && { contractScope:        d.contractScope }),
      ...(d.squareFootage        !== undefined && { squareFootage:        d.squareFootage }),
      ...(d.roofPitch            !== undefined && { roofPitch:            d.roofPitch }),
      ...(d.measurementVendor    !== undefined && { measurementVendor:    d.measurementVendor }),
      ...(d.measurementReportUrl !== undefined && { measurementReportUrl: d.measurementReportUrl }),
      ...(d.materialBrand        !== undefined && { materialBrand:        d.materialBrand }),
      ...(d.materialColor        !== undefined && { materialColor:        d.materialColor }),
      ...(d.materialStyle        !== undefined && { materialStyle:        d.materialStyle }),
      // Lead Dashboard fields
      ...(d.nonOwnerOccupied   !== undefined && { nonOwnerOccupied:   d.nonOwnerOccupied }),
      ...(d.mailingAddress     !== undefined && { mailingAddress:     d.mailingAddress }),
      ...(d.mailingCity        !== undefined && { mailingCity:        d.mailingCity }),
      ...(d.mailingState       !== undefined && { mailingState:       d.mailingState }),
      ...(d.mailingZip         !== undefined && { mailingZip:         d.mailingZip }),
      ...(d.mailerSentDate     !== undefined && { mailerSentDate:     d.mailerSentDate ? new Date(d.mailerSentDate) : null }),
      ...(d.claimFiledDate     !== undefined && { claimFiledDate:     d.claimFiledDate ? new Date(d.claimFiledDate) : null }),
      ...(d.policyHolder       !== undefined && { policyHolder:       d.policyHolder }),
      ...(d.coverageType       !== undefined && { coverageType:       d.coverageType }),
      ...(d.approvedRcvAmount  !== undefined && { approvedRcvAmount:  d.approvedRcvAmount }),
      ...(d.approvedAcvAmount  !== undefined && { approvedAcvAmount:  d.approvedAcvAmount }),
      ...(d.depreciationAmount !== undefined && { depreciationAmount: d.depreciationAmount }),
      ...(d.inspectionNotes    !== undefined && { inspectionNotes:    d.inspectionNotes }),
      ...(d.profileStatus        !== undefined && { profileStatus:        d.profileStatus }),
      ...(d.statusNotes          !== undefined && { statusNotes:          d.statusNotes }),
      ...(d.statusLastUpdated    !== undefined && { statusLastUpdated:    d.statusLastUpdated ? new Date(d.statusLastUpdated) : null }),
    })
    .where(eq(pinsTable.id, leadId))
    .returning();

  const [user] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, pin.userId));

  const repName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null
    : null;

  res.json({ lead: { ...updated, repName } });
});


router.get('/leads', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  const companyId = req.user.companyId;

  // ── 1. Pins (retail + insurance door-knock leads) ────────────────────────
  const pinRows = await db
    .select({
      id:              pinsTable.id,
      address:         pinsTable.address,
      workflow:        pinsTable.workflow,
      damageType:      pinsTable.damageType,
      doorKnockResult: pinsTable.doorKnockResult,
      contactOutcome:  pinsTable.contactOutcome,
      customerName:    pinsTable.customerName,
      customerPhone:   pinsTable.customerPhone,
      ownerFirstName:  pinsTable.ownerFirstName,
      ownerLastName:   pinsTable.ownerLastName,
      retailData:      pinsTable.retailData,
      createdAt:       pinsTable.createdAt,
      repFirstName:    usersTable.firstName,
      repLastName:     usersTable.lastName,
      inspectionId:    inspectionsTable.id,
      inspectionStatus: inspectionsTable.status,
    })
    .from(pinsTable)
    .leftJoin(usersTable, eq(usersTable.id, pinsTable.userId))
    .leftJoin(
      inspectionsTable,
      and(
        eq(inspectionsTable.pinId, pinsTable.id),
        eq(inspectionsTable.companyId, companyId),
      ),
    )
    .where(eq(pinsTable.companyId, companyId))
    .orderBy(desc(pinsTable.createdAt));

  // ── 2. Inspections (insurance/project claims that have no pin, or all) ──
  // We include ALL inspections so every claim appears in the list even if
  // the pin was created before the pin-inspection link existed.
  const inspectionRows = await db
    .select({
      id:           inspectionsTable.id,
      address:      inspectionsTable.address,
      status:       inspectionsTable.status,
      damageType:   inspectionsTable.damageType,
      insuredName:  inspectionsTable.insuredName,
      pinId:        inspectionsTable.pinId,
      createdAt:    inspectionsTable.createdAt,
      repFirstName: usersTable.firstName,
      repLastName:  usersTable.lastName,
    })
    .from(inspectionsTable)
    .leftJoin(usersTable, eq(usersTable.id, inspectionsTable.inspectorUserId))
    .where(eq(inspectionsTable.companyId, companyId))
    .orderBy(desc(inspectionsTable.createdAt));

  // ── Stage derivation helpers ─────────────────────────────────────────────
  const INSPECTION_STATUS_LABELS: Record<string, string> = {
    scheduled:    'Phase 1 Inspection Scheduled',
    capturing:    'Phase 2 Inspection Complete',
    validating:   'Proof Package Generated',
    package_ready:'Proof Package Generated',
    submitted:    'Claim Filed',
  };

  function derivePinStage(r: typeof pinRows[number]): string {
    if (r.doorKnockResult === 'no_answer') return 'Archived – Lost';
    if (r.inspectionId) {
      const s = r.inspectionStatus ?? '';
      return INSPECTION_STATUS_LABELS[s] ?? 'Estimate Provided';
    }
    if (r.doorKnockResult === 'appointment' || r.contactOutcome === 'call_to_schedule') return 'Appt. Scheduled';
    if (r.doorKnockResult === 'no_appointment') return 'Follow-Up Required';
    return 'Pin Dropped';
  }

  // Set of inspection IDs already covered via a pin link (avoid duplicates)
  const coveredInspectionIds = new Set(pinRows.map(r => r.inspectionId).filter(Boolean));

  // ── 3. Build unified rows ────────────────────────────────────────────────
  const pinLeads = pinRows.map(r => {
    const ownerName = [r.ownerFirstName, r.ownerLastName].filter(Boolean).join(' ') || null;
    return {
      id:         r.id,
      recordType: 'pin' as const,
      pipeline:   r.workflow as 'retail' | 'insurance',
      name:       ownerName || r.customerName || (r.retailData as any)?.ownerName1 || null,
      address:    r.address,
      phone:      r.customerPhone || (r.retailData as any)?.phone || null,
      damageType: r.damageType,
      stage:      derivePinStage(r),
      repName:    r.repFirstName ? [r.repFirstName, r.repLastName].filter(Boolean).join(' ') : null,
      detailPath: `/leads/${r.id}`,
      createdAt:  r.createdAt.toISOString(),
    };
  });

  const inspectionLeads = inspectionRows
    .filter(r => !coveredInspectionIds.has(r.id)) // skip inspections already shown via pin
    .map(r => ({
      id:         r.id,
      recordType: 'inspection' as const,
      pipeline:   'insurance' as const,
      name:       r.insuredName ?? null,
      address:    r.address,
      phone:      null as string | null,
      damageType: r.damageType,
      stage:      INSPECTION_STATUS_LABELS[r.status ?? ''] ?? (r.status ?? 'Unknown'),
      repName:    r.repFirstName ? [r.repFirstName, r.repLastName].filter(Boolean).join(' ') : null,
      detailPath: r.pinId ? `/leads/${r.pinId}` : `/leads/ins-${r.id}`,
      createdAt:  r.createdAt.toISOString(),
    }));

  // Sort merged list newest-first
  const leads = [...pinLeads, ...inspectionLeads].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  res.json({ leads });
});

// ---------------------------------------------------------------------------
// Lead Files  GET/POST /leads/:leadId/files
//             PATCH/DELETE /leads/:leadId/files/:fileId
// ---------------------------------------------------------------------------

/**
 * Verify the requesting user may read/write files on this lead.
 * Returns the lead owner's userId on success.
 */
async function checkLeadFileAccess(
  leadId: string,
  user: { id: string; companyId: string },
  role: string,
): Promise<{ ok: true; ownerId: string } | { ok: false; status: number; error: string }> {
  // Narrow the string role to the Role union for isManagerOrAdmin
  const typedRole = role as import('@workspace/db').Role;
  if (leadId.startsWith('ins-')) {
    const inspectionId = leadId.slice(4);
    const [row] = await db
      .select({ id: inspectionsTable.id, inspectorUserId: inspectionsTable.inspectorUserId })
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, user.companyId)))
      .limit(1);
    if (!row) return { ok: false, status: 404, error: 'Lead not found' };
    if (row.inspectorUserId !== user.id && !isManagerOrAdmin(typedRole)) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: true, ownerId: row.inspectorUserId };
  }
  const [pin] = await db
    .select({ id: pinsTable.id, userId: pinsTable.userId })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, leadId), eq(pinsTable.companyId, user.companyId)))
    .limit(1);
  if (!pin) return { ok: false, status: 404, error: 'Lead not found' };
  if (pin.userId !== user.id && !isManagerOrAdmin(typedRole)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true, ownerId: pin.userId };
}

router.get('/leads/:leadId/files', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });
  const { leadId } = req.params as { leadId: string };
  const role = await getRole(req.user.id);
  const access = await checkLeadFileAccess(leadId, req.user, role);
  if (!access.ok) return void res.status(access.status).json({ error: access.error });

  const files = await db
    .select({
      id: leadFilesTable.id,
      leadId: leadFilesTable.leadId,
      userId: leadFilesTable.userId,
      objectPath: leadFilesTable.objectPath,
      fileName: leadFilesTable.fileName,
      originalName: leadFilesTable.originalName,
      fileSize: leadFilesTable.fileSize,
      mimeType: leadFilesTable.mimeType,
      category: leadFilesTable.category,
      createdAt: leadFilesTable.createdAt,
      updatedAt: leadFilesTable.updatedAt,
      uploaderFirstName: usersTable.firstName,
      uploaderLastName: usersTable.lastName,
    })
    .from(leadFilesTable)
    .leftJoin(usersTable, eq(leadFilesTable.userId, usersTable.id))
    .where(
      and(
        eq(leadFilesTable.leadId, leadId),
        eq(leadFilesTable.companyId, req.user.companyId),
      ),
    )
    .orderBy(leadFilesTable.createdAt);

  const mapped = files.map((f) => ({
    ...f,
    uploaderName:
      [f.uploaderFirstName, f.uploaderLastName].filter(Boolean).join(' ') || 'Unknown',
    uploaderFirstName: undefined,
    uploaderLastName: undefined,
  }));

  return void res.json({ files: mapped });
});

router.post('/leads/:leadId/files', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });
  const { leadId } = req.params as { leadId: string };
  const role = await getRole(req.user.id);
  const access = await checkLeadFileAccess(leadId, req.user, role);
  if (!access.ok) return void res.status(access.status).json({ error: access.error });

  const body = z.object({
    objectPath: z.string().min(1),
    fileName: z.string().min(1),
    originalName: z.string().min(1),
    fileSize: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    category: z.enum([
      'site_photos', 'contracts', 'estimates', 'insurance_documents',
      'measurement_reports', 'permits', 'correspondence', 'general',
    ]).default('general'),
  }).safeParse(req.body);

  if (!body.success) return void res.status(400).json({ error: 'Invalid file payload' });

  // Security: verify the objectPath was minted via /storage/uploads/request-url
  // for this company. Prevents users from registering arbitrary paths and
  // attaching/deleting objects they don't own.
  const [ownership] = await db
    .select({ objectPath: objectOwnershipTable.objectPath })
    .from(objectOwnershipTable)
    .where(
      and(
        eq(objectOwnershipTable.objectPath, body.data.objectPath),
        eq(objectOwnershipTable.companyId, req.user.companyId),
      ),
    )
    .limit(1);

  if (!ownership) {
    return void res.status(403).json({ error: 'Object path not owned by your company' });
  }

  const [file] = await db
    .insert(leadFilesTable)
    .values({
      leadId,
      companyId: req.user.companyId,
      userId: req.user.id,
      objectPath: body.data.objectPath,
      fileName: body.data.fileName,
      originalName: body.data.originalName,
      fileSize: body.data.fileSize,
      mimeType: body.data.mimeType,
      category: body.data.category,
    })
    .returning();

  return void res.status(201).json({ file });
});

router.patch('/leads/:leadId/files/:fileId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });
  const { leadId, fileId } = req.params as { leadId: string; fileId: string };
  const role = await getRole(req.user.id);
  const access = await checkLeadFileAccess(leadId, req.user, role);
  if (!access.ok) return void res.status(access.status).json({ error: access.error });

  const body = z.object({ fileName: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: 'fileName is required' });

  const [file] = await db
    .update(leadFilesTable)
    .set({ fileName: body.data.fileName })
    .where(
      and(
        eq(leadFilesTable.id, fileId),
        eq(leadFilesTable.leadId, leadId),
        eq(leadFilesTable.companyId, req.user.companyId),
      ),
    )
    .returning();

  if (!file) return void res.status(404).json({ error: 'File not found' });
  return void res.json({ file });
});

router.delete('/leads/:leadId/files/:fileId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });
  const { leadId, fileId } = req.params as { leadId: string; fileId: string };
  const role = await getRole(req.user.id);
  const access = await checkLeadFileAccess(leadId, req.user, role);
  if (!access.ok) return void res.status(access.status).json({ error: access.error });

  const [file] = await db
    .select()
    .from(leadFilesTable)
    .where(
      and(
        eq(leadFilesTable.id, fileId),
        eq(leadFilesTable.leadId, leadId),
        eq(leadFilesTable.companyId, req.user.companyId),
      ),
    )
    .limit(1);

  if (!file) return void res.status(404).json({ error: 'File not found' });

  // Delete the lead_files row first.
  await db.delete(leadFilesTable).where(eq(leadFilesTable.id, fileId));

  // Only clean up object_ownership and the backing GCS object when no other
  // lead_files rows still reference the same objectPath. This prevents
  // accidental deletion of shared assets (e.g. the same upload registered
  // against multiple leads, or referenced by another table in the future).
  const [otherRef] = await db
    .select({ id: leadFilesTable.id })
    .from(leadFilesTable)
    .where(eq(leadFilesTable.objectPath, file.objectPath))
    .limit(1);

  if (!otherRef) {
    // Safe to remove the ownership record and the GCS object.
    await db
      .delete(objectOwnershipTable)
      .where(eq(objectOwnershipTable.objectPath, file.objectPath));

    // Best-effort GCS delete — swallow errors so the DB delete still succeeds.
    objectStorageService.deleteObjectEntity(file.objectPath).catch((err: unknown) => {
      req.log.warn({ err, objectPath: file.objectPath }, 'Lead file GCS delete failed (best-effort)');
    });
  }

  return void res.json({ deleted: true });
});

// ── POST /inspections/:id/ahj-check ──────────────────────────────────────────
// Lets managers re-trigger the AHJ jurisdiction check on demand — without
// voiding and re-collecting the FIPSA. Gated to manager+ so field reps cannot
// spam the Gemini API. Awaited (not fire-and-forget) so the caller can show a
// loading state and refresh the badge immediately on completion.
router.post('/inspections/:id/ahj-check', async (req: Request, res: Response) => {
  const actor = await requireInspectionModuleAccess(req, res);
  if (!actor) return;

  if (!isManagerOrAdmin(actor.role)) {
    res.status(403).json({ error: 'Only managers and above may re-trigger the AHJ check' });
    return;
  }

  const inspectionId = String(req.params.id);
  const inspection = await loadInspectionInCompany(inspectionId, actor.companyId);
  if (!inspection) {
    res.status(404).json({ error: 'Inspection not found' });
    return;
  }

  if (!inspection.address) {
    res.status(422).json({ error: 'Inspection has no address — AHJ check cannot run' });
    return;
  }

  // Await the check so the response carries the fresh result. runAhjCheck
  // swallows its own errors and writes the result to the DB on success.
  await runAhjCheck(inspectionId, inspection.address, actor.companyId, req.log);

  // Re-fetch the (potentially updated) inspection to return the latest ahjCheck.
  const [updated] = await db
    .select({ ahjCheck: inspectionsTable.ahjCheck })
    .from(inspectionsTable)
    .where(eq(inspectionsTable.id, inspectionId))
    .limit(1);

  res.json({ ahjCheck: updated?.ahjCheck ?? null });
});

export default router;

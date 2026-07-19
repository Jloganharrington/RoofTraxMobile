// App → Brain courier (outbound half of the app↔Brain connection).
//
// On successful submission — AFTER intake's verification, which stays the
// gatekeeper — this module builds the Brain's `SubmittedInspection` payload
// from stored rows and POSTs `{ manifest, inspection }` to
// `${BRAIN_BASE_URL}/submissions` with the machine token.
//
// Design constraints (work order):
// - Courier failure must NEVER fail the rep's submit. Delivery is a background
//   concern: the submit route marks the row 'pending' and fires an async
//   attempt; a worker retries failures with exponential backoff.
// - Delivery state is surfaced on the inspection row
//   (brain_delivery_status / brain_submission_id / brain_last_error) so a
//   stuck package is visible rather than silently undelivered.
// - The Brain's receiveSubmission is idempotent by inspectionId, so a retry
//   or duplicate send is safe by design.
// - Photos travel as `objstore://photos/{photoId}` refs + sha256 hashes, NOT
//   bytes; the Brain fetches bytes independently through the read-only photo
//   proxy (routes/internal.ts) and re-hashes them — that independent fetch is
//   the chain-of-custody claim, so never inline the bytes here.
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
  measurementsTable,
  testSquareHitsTable,
  testSquaresTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { logger } from './logger';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** A machine token, optionally scoped to a single company's evidence. */
export interface BrainMachineToken {
  token: string;
  /** null ⇒ global (single-tenant Brain deployment). */
  companyId: string | null;
}

export interface BrainConfig {
  baseUrl: string;
  tokens: BrainMachineToken[];
}

/**
 * Reads courier config from the environment. Absent ⇒ courier disabled and
 * logged (once, at boot via logBrainCourierStatus) — never a crash.
 *
 * BRAIN_MACHINE_TOKEN accepts either a single bare token (global scope) or a
 * comma-separated list of `companyId:token` pairs. A company-scoped token can
 * only fetch that company's evidence through the photo proxy; the courier
 * picks the matching token per inspection.
 */
export function getBrainConfig(): BrainConfig | null {
  const baseUrl = process.env['BRAIN_BASE_URL'];
  const raw = process.env['BRAIN_MACHINE_TOKEN'];
  if (!baseUrl || !raw) return null;

  const tokens: BrainMachineToken[] = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const sep = entry.indexOf(':');
      if (sep > 0 && sep < entry.length - 1) {
        return { companyId: entry.slice(0, sep), token: entry.slice(sep + 1) };
      }
      return { companyId: null, token: entry };
    });
  if (tokens.length === 0) return null;

  return { baseUrl: baseUrl.replace(/\/+$/, ''), tokens };
}

/** Token the courier presents for a given company's submissions. */
export function machineTokenForCompany(
  config: BrainConfig,
  companyId: string,
): string | null {
  const scoped = config.tokens.find((t) => t.companyId === companyId);
  if (scoped) return scoped.token;
  return config.tokens.find((t) => t.companyId === null)?.token ?? null;
}

export function logBrainCourierStatus(): void {
  if (getBrainConfig()) {
    logger.info('Brain courier enabled (BRAIN_BASE_URL + BRAIN_MACHINE_TOKEN present)');
  } else {
    logger.warn(
      'Brain courier DISABLED: BRAIN_BASE_URL and/or BRAIN_MACHINE_TOKEN not set. ' +
        'Submissions will lock locally but will not be delivered to the Brain.',
    );
  }
}

// ---------------------------------------------------------------------------
// Payload builder — maps stored rows into the Brain's SubmittedInspection
// contract shape. Field names were aligned to the app's schema on 2026-07-19;
// where they diverge the Brain is wrong and should be told, not worked around.
// ---------------------------------------------------------------------------

type InspectionRow = typeof inspectionsTable.$inferSelect;

/** `objstore://` ref the Brain resolves against OBJECT_STORAGE_BASE_URL
 *  (pointed at this app's /api/internal photo proxy). */
export function photoObjstoreRef(photoId: string): string {
  return `objstore://photos/${photoId}`;
}

export async function buildSubmittedInspection(inspection: InspectionRow) {
  const { id: inspectionId, companyId } = inspection;
  const scoped = <T extends { inspectionId: any; companyId: any }>(table: T) =>
    and(eq(table.inspectionId, inspectionId), eq(table.companyId, companyId));

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
    addenda,
    [inspectorUser],
    [inspectorProfile],
  ] = await Promise.all([
    db.select().from(inspectionSlopesTable).where(scoped(inspectionSlopesTable)).orderBy(inspectionSlopesTable.createdAt),
    db.select().from(inspectionSidingFacetsTable).where(scoped(inspectionSidingFacetsTable)).orderBy(inspectionSidingFacetsTable.createdAt),
    db.select().from(inspectionElevationsTable).where(scoped(inspectionElevationsTable)).orderBy(inspectionElevationsTable.createdAt),
    db.select().from(damageInstancesTable).where(scoped(damageInstancesTable)).orderBy(damageInstancesTable.createdAt),
    db.select().from(inspectionPhotosTable).where(scoped(inspectionPhotosTable)).orderBy(inspectionPhotosTable.createdAt),
    db.select().from(inspectionComponentsTable).where(scoped(inspectionComponentsTable)).orderBy(inspectionComponentsTable.createdAt),
    db.select().from(inspectionPenetrationsTable).where(scoped(inspectionPenetrationsTable)).orderBy(inspectionPenetrationsTable.createdAt),
    db.select().from(inspectionProductsTable).where(scoped(inspectionProductsTable)).orderBy(inspectionProductsTable.createdAt),
    db.select().from(testSquaresTable).where(scoped(testSquaresTable)).orderBy(testSquaresTable.createdAt),
    db.select().from(attestationsTable).where(scoped(attestationsTable)).orderBy(attestationsTable.attestedAt),
    db.select().from(inspectionInteriorObservationsTable).where(scoped(inspectionInteriorObservationsTable)).orderBy(inspectionInteriorObservationsTable.createdAt),
    db.select().from(measurementsTable).where(scoped(measurementsTable)).orderBy(measurementsTable.createdAt),
    db.select().from(inspectionAddendaTable).where(scoped(inspectionAddendaTable)).orderBy(inspectionAddendaTable.createdAt),
    db.select().from(usersTable).where(eq(usersTable.id, inspection.inspectorUserId)),
    db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, inspection.inspectorUserId)),
  ]);

  const testSquareIds = testSquares.map((ts) => ts.id);
  const testSquareHits = testSquareIds.length
    ? await db
        .select()
        .from(testSquareHitsTable)
        .where(inArray(testSquareHitsTable.testSquareId, testSquareIds))
        .orderBy(testSquareHitsTable.createdAt)
    : [];
  const hitsBySquare = new Map<string, typeof testSquareHits>();
  for (const hit of testSquareHits) {
    const list = hitsBySquare.get(hit.testSquareId) ?? [];
    list.push(hit);
    hitsBySquare.set(hit.testSquareId, list);
  }

  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

  return {
    id: inspectionId,
    companyId,
    stateCode: 'VA', // hardcoded for NuHome/Virginia-only phase; derive from address/service-areas when multi-state work begins
    submittedAtUtc: iso(inspection.lockedAt),
    phase: inspection.phase,
    property: {
      address: inspection.address ?? null,
      latitude: inspection.latitude ?? null,
      longitude: inspection.longitude ?? null,
      claimNumber: inspection.claimNumber ?? null,
      policyNumber: inspection.policyNumber ?? null,
      carrierName: inspection.carrierName ?? null,
      insuredName: inspection.insuredName ?? null,
      dateOfLoss: inspection.dateOfLoss ?? null,
    },
    storm: inspection.stormConfirmedRef ?? null,
    inspector: {
      userId: inspection.inspectorUserId,
      name:
        [inspectorUser?.firstName, inspectorUser?.lastName].filter(Boolean).join(' ') || null,
      email: inspectorUser?.email ?? null,
      certifications: inspectorProfile?.certifications ?? [],
      yearsExperience: inspectorProfile?.yearsExperience ?? null,
      signatureOnFile:
        inspectorProfile?.signatureUrl && inspectorProfile.signatureSha256
          ? {
              url: inspectorProfile.signatureUrl,
              sha256: inspectorProfile.signatureSha256,
              signedAt: iso(inspectorProfile.signatureSignedAt),
            }
          : null,
    },
    // All FOUR flags, including interiorDamageFound.
    damageFlags: {
      roofDamageFound: inspection.roofDamageFound,
      sidingDamageFound: inspection.sidingDamageFound,
      collateralDamageFound: inspection.collateralDamageFound,
      interiorDamageFound: inspection.interiorDamageFound,
    },
    damageType: inspection.damageType ?? null,
    arrival: inspection.arrivalConditions ?? null,
    // REPORT_DATA v2 capture blocks — pass through null when not captured;
    // never synthesise an empty object.
    propertyProfile: inspection.propertyProfile ?? null,
    existingOrUnrelatedConditions: inspection.existingOrUnrelatedConditions ?? null,
    repairabilityAssessment: inspection.repairabilityAssessment ?? null,
    temporaryRepairs: inspection.temporaryRepairs ?? null,
    propertyProtectionPlan: inspection.propertyProtectionPlan ?? null,
    homeownerFacts: inspection.homeownerFacts ?? null,
    sidingWrbPresent: inspection.sidingWrbPresent ?? null,
    sidingMeasurementReportRef: inspection.sidingMeasurementReportRef ?? null,
    damageSurfaceChangeLog: inspection.damageSurfaceChangeLog ?? [],
    slopes: slopes.map((s) => ({
      id: s.id,
      label: s.label,
      areaSqft: s.areaSqft ?? null,
      damagePresent: s.damagePresent ?? null,
      damageType: s.damageType ?? null,
      tieInValley: s.tieInValley ?? null,
      tieInHipRidge: s.tieInHipRidge ?? null,
    })),
    elevations,
    sidingFacets,
    damageInstances,
    testSquares: testSquares.map((ts) => ({
      ...ts,
      hits: hitsBySquare.get(ts.id) ?? [],
    })),
    measurements,
    components,
    penetrations,
    products,
    interiorObservations,
    attestations,
    addenda,
    photos: photos.map((p) => ({
      id: p.id,
      // objstore:// ref the Brain resolves against its OBJECT_STORAGE_BASE_URL
      // (this app's photo proxy). Bytes are fetched + re-hashed independently.
      url: photoObjstoreRef(p.id),
      sha256: p.sha256,
      stage: p.stage ?? null,
      subjectType: p.subjectType,
      subjectId: p.subjectId ?? null,
      triadRole: p.triadRole ?? null,
      preliminaryRole: p.preliminaryRole ?? null,
      area: p.zone ?? null,
      sidingRole: p.sidingRole ?? null,
      sidingComponentIndex: p.sidingComponentIndex ?? null,
      capturedAtUtc: iso(p.capturedAtUtc),
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      caption: null, // no caption field exists app-side today
    })),
  };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** Injectable for tests. */
export type FetchLike = typeof fetch;

/**
 * Attempts one delivery of a locked inspection to the Brain and records the
 * outcome on the row. Never throws — all failures land in brain_last_error.
 */
export async function deliverInspectionToBrain(
  inspectionId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const config = getBrainConfig();
  if (!config) return;

  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(eq(inspectionsTable.id, inspectionId));
  if (!inspection || !inspection.lockedAt || !inspection.submissionManifest) return;
  if (inspection.brainDeliveryStatus === 'delivered') return;

  const markAttempt = { brainLastAttemptAt: new Date() };
  try {
    const machineToken = machineTokenForCompany(config, inspection.companyId);
    if (!machineToken) {
      throw new Error(
        `No Brain machine token configured for company ${inspection.companyId}`,
      );
    }
    const payload = await buildSubmittedInspection(inspection);
    const response = await fetchImpl(`${config.baseUrl}/submissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${machineToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        manifest: inspection.submissionManifest,
        inspection: payload,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Brain responded ${response.status}: ${text.slice(0, 500)}`);
    }

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      submissionId?: string;
    };
    const brainSubmissionId = body.submissionId ?? body.id ?? inspectionId;

    await db
      .update(inspectionsTable)
      .set({
        ...markAttempt,
        brainDeliveryStatus: 'delivered',
        brainSubmissionId,
        brainLastError: null,
        brainDeliveredAt: new Date(),
        brainDeliveryAttempts: sql`${inspectionsTable.brainDeliveryAttempts} + 1`,
      })
      .where(eq(inspectionsTable.id, inspectionId));
    logger.info({ inspectionId, brainSubmissionId }, 'Brain delivery succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(inspectionsTable)
      .set({
        ...markAttempt,
        brainDeliveryStatus: 'failed',
        brainLastError: message.slice(0, 2000),
        brainDeliveryAttempts: sql`${inspectionsTable.brainDeliveryAttempts} + 1`,
      })
      .where(eq(inspectionsTable.id, inspectionId))
      .catch((dbErr) => logger.error({ err: dbErr, inspectionId }, 'Failed to record Brain delivery failure'));
    logger.warn({ inspectionId, err: message }, 'Brain delivery failed; will retry with backoff');
  }
}

// ---------------------------------------------------------------------------
// Retry worker — exponential backoff, capped at 1 hour between attempts.
// ---------------------------------------------------------------------------

const WORKER_INTERVAL_MS = 60_000;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;

export function backoffMsForAttempts(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(attempts - 1, 0), MAX_BACKOFF_MS);
}

/** One worker pass: retries every due pending/failed delivery. Exported for tests. */
export async function runBrainCourierPass(fetchImpl: FetchLike = fetch): Promise<number> {
  if (!getBrainConfig()) return 0;

  const rows = await db
    .select({
      id: inspectionsTable.id,
      attempts: inspectionsTable.brainDeliveryAttempts,
      lastAttemptAt: inspectionsTable.brainLastAttemptAt,
    })
    .from(inspectionsTable)
    .where(
      and(
        inArray(inspectionsTable.brainDeliveryStatus, ['pending', 'failed']),
        or(
          isNull(inspectionsTable.brainLastAttemptAt),
          lt(inspectionsTable.brainLastAttemptAt, new Date(Date.now() - BASE_BACKOFF_MS)),
        ),
      ),
    )
    .limit(20);

  let attempted = 0;
  for (const row of rows) {
    const due =
      !row.lastAttemptAt ||
      Date.now() - row.lastAttemptAt.getTime() >= backoffMsForAttempts(row.attempts);
    if (!due) continue;
    attempted += 1;
    await deliverInspectionToBrain(row.id, fetchImpl);
  }
  return attempted;
}

let workerTimer: NodeJS.Timeout | null = null;

export function startBrainCourierWorker(): void {
  if (!getBrainConfig() || workerTimer) return;
  workerTimer = setInterval(() => {
    runBrainCourierPass().catch((err) =>
      logger.error({ err }, 'Brain courier worker pass failed'),
    );
  }, WORKER_INTERVAL_MS);
  workerTimer.unref();
}

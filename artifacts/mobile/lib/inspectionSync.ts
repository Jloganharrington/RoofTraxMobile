import * as Crypto from 'expo-crypto';
import type { QueryClient } from '@tanstack/react-query';
import {
  getGetInspectionQueryKey,
  getListInspectionsQueryKey,
} from '@workspace/api-client-react';
import type {
  Attestation,
  CaptureStage,
  CreateAttestationInput,
  CreateDamageInstanceInput,
  CreateInspectionComponentInput,
  CreateInspectionElevationInput,
  CreateInspectionInput,
  CreateInspectionPenetrationInput,
  CreateInspectionProductInput,
  CreateInspectionSlopeInput,
  UpdateInspectionSlopeInput,
  CreateInteriorObservationInput,
  CreateMeasurementInput,
  CreateTestSquareInput,
  CreateTestSquareHitInput,
  DamageInstance,
  ElevationDirection,
  HomeownerFacts,
  Inspection,
  InspectionComponent,
  InspectionElevation,
  InspectionEnvelope,
  InspectionPenetration,
  InspectionPhoto,
  InspectionProduct,
  InspectionSlope,
  InspectionSubjectType,
  InteriorObservation,
  Measurement,
  PhotoTriadRole,
  PreliminaryPhotoRole,
  SubmissionManifestV1,
  TestSquare,
  TestSquareHit,
  UpdateInspectionInput,
} from '@workspace/api-client-react';

import { enqueueOutboxItem } from './outbox/queue';
import { drainOutbox } from './outbox/drain';

/**
 * Offline-first inspection writes. Every write is durably queued in the
 * outbox (so it survives a force-quit) and is also applied optimistically to
 * the react-query cache so the UI stays live even in airplane mode. A drain
 * is kicked after each enqueue; when offline it's a no-op and the periodic
 * outbox sync replays the queue once connectivity returns.
 */

interface StartArgs {
  queryClient: QueryClient;
  input: Omit<CreateInspectionInput, 'id'>;
  /** Filled onto the optimistic cache row so the detail screen renders
   * before the server has ever seen this inspection. */
  companyId: string;
  inspectorUserId: string;
}

/** Creates an inspection offline-first and returns its client-generated id. */
export async function startInspection({
  queryClient,
  input,
  companyId,
  inspectorUserId,
}: StartArgs): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();

  const optimistic: Inspection = {
    id,
    companyId,
    inspectorUserId,
    pinId: input.pinId ?? null,
    status: input.status ?? 'capturing',
    phase: input.phase ?? 'forensic',
    damageType: input.damageType ?? null,
    preliminaryCompletedAt: null,
    claimNumber: input.claimNumber ?? null,
    policyNumber: input.policyNumber ?? null,
    carrierName: input.carrierName ?? null,
    insuredName: input.insuredName ?? null,
    address: input.address ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    notes: input.notes ?? null,
    dateOfLoss: input.dateOfLoss ?? null,
    stormConfirmedRef: null,
    arrivalConditions: null,
    homeownerFacts: null,
    submissionManifest: null,
    lockedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  queryClient.setQueryData<InspectionEnvelope>(getGetInspectionQueryKey(id), {
    inspection: optimistic,
  });

  await enqueueOutboxItem('inspection.create', {
    input: { id, ...input } satisfies CreateInspectionInput,
  });
  void drainOutbox();
  return id;
}

/** Patches an inspection offline-first, updating the cached row in place. */
export async function patchInspection(
  queryClient: QueryClient,
  inspectionId: string,
  patch: UpdateInspectionInput,
): Promise<void> {
  queryClient.setQueryData<InspectionEnvelope>(
    getGetInspectionQueryKey(inspectionId),
    (prev) =>
      prev
        ? {
            inspection: {
              ...prev.inspection,
              ...patch,
              updatedAt: new Date().toISOString(),
            },
          }
        : prev,
  );

  await enqueueOutboxItem('inspection.update', { inspectionId, patch });
  void drainOutbox();
}

/** Records an attestation offline-first (equipment checklist, GPS override…).
 * A client-generated id makes the queued write idempotent — a retry after a
 * partial success (server committed, ack lost) returns the same row rather
 * than duplicating the attestation. */
export async function attestInspection(
  inspectionId: string,
  input: CreateAttestationInput,
): Promise<void> {
  const withId: CreateAttestationInput = { id: Crypto.randomUUID(), ...input };
  await enqueueOutboxItem('inspection.attestation', { inspectionId, input: withId });
  void drainOutbox();
}

/** Mutates the cached inspection detail in place. No-op if the inspection
 * isn't cached yet (the caller is always on its detail screen, so it is). */
function patchCachedInspection(
  queryClient: QueryClient,
  inspectionId: string,
  mutate: (inspection: Inspection) => Inspection,
): void {
  queryClient.setQueryData<InspectionEnvelope>(
    getGetInspectionQueryKey(inspectionId),
    (prev) => (prev ? { inspection: mutate(prev.inspection) } : prev),
  );
}

/** Creates an elevation offline-first and returns its client-generated id.
 * The id is echoed to the server so the create is idempotent and so a wide
 * photo captured against this elevation can reference it before it syncs. */
export async function createElevation(
  queryClient: QueryClient,
  inspectionId: string,
  direction: ElevationDirection,
  notes?: string | null,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: InspectionElevation = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      direction,
      notes: notes ?? null,
      createdAt: now,
    };
    return { ...inspection, elevations: [...(inspection.elevations ?? []), optimistic] };
  });
  const input: CreateInspectionElevationInput = { id, direction, notes: notes ?? null };
  await enqueueOutboxItem('inspection.elevation', { inspectionId, input });
  void drainOutbox();
  return id;
}

/** Creates a slope offline-first and returns its client-generated id. */
export async function createSlope(
  queryClient: QueryClient,
  inspectionId: string,
  fields: Omit<CreateInspectionSlopeInput, 'id'>,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: InspectionSlope = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      label: fields.label,
      pitchRise: fields.pitchRise ?? null,
      pitchRun: fields.pitchRun ?? null,
      materialType: fields.materialType ?? null,
      areaSqft: fields.areaSqft ?? null,
      damageType: fields.damageType ?? null,
      damagePresent: fields.damagePresent ?? false,
      tieInValley: fields.tieInValley ?? false,
      tieInHipRidge: fields.tieInHipRidge ?? false,
      notes: fields.notes ?? null,
      createdAt: now,
    };
    return { ...inspection, slopes: [...(inspection.slopes ?? []), optimistic] };
  });
  const input: CreateInspectionSlopeInput = { id, ...fields };
  await enqueueOutboxItem('inspection.slope', { inspectionId, input });
  void drainOutbox();
  return id;
}

/** Updates a facet's details offline-first (partial patch). */
export async function updateSlope(
  queryClient: QueryClient,
  inspectionId: string,
  slopeId: string,
  patch: UpdateInspectionSlopeInput,
): Promise<void> {
  patchCachedInspection(queryClient, inspectionId, (inspection) => ({
    ...inspection,
    slopes: (inspection.slopes ?? []).map((slope) =>
      slope.id === slopeId ? { ...slope, ...patch } : slope,
    ),
  }));
  await enqueueOutboxItem('inspection.slopeUpdate', { inspectionId, slopeId, patch });
  void drainOutbox();
}

/** Removes a facet offline-first. */
export async function deleteSlope(
  queryClient: QueryClient,
  inspectionId: string,
  slopeId: string,
): Promise<void> {
  patchCachedInspection(queryClient, inspectionId, (inspection) => ({
    ...inspection,
    slopes: (inspection.slopes ?? []).filter((slope) => slope.id !== slopeId),
  }));
  await enqueueOutboxItem('inspection.slopeDelete', { inspectionId, slopeId });
  void drainOutbox();
}

/** Creates a damage instance offline-first and returns its client id. */
export async function createDamageInstance(
  queryClient: QueryClient,
  inspectionId: string,
  fields: Omit<CreateDamageInstanceInput, 'id'>,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: DamageInstance = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      slopeId: fields.slopeId ?? null,
      elevationId: fields.elevationId ?? null,
      damageType: fields.damageType,
      severity: fields.severity ?? null,
      causationNote: fields.causationNote ?? null,
      notes: fields.notes ?? null,
      createdAt: now,
    };
    return {
      ...inspection,
      damageInstances: [...(inspection.damageInstances ?? []), optimistic],
    };
  });
  const input: CreateDamageInstanceInput = { id, ...fields };
  await enqueueOutboxItem('inspection.damage', { inspectionId, input });
  void drainOutbox();
  return id;
}

/** Creates a C4 existing-component / layer-count record offline-first and
 * returns its client-generated id. */
export async function createComponent(
  queryClient: QueryClient,
  inspectionId: string,
  fields: Omit<CreateInspectionComponentInput, 'id'>,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: InspectionComponent = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      slopeId: fields.slopeId ?? null,
      componentType: fields.componentType,
      status: fields.status ?? null,
      layerCount: fields.layerCount ?? null,
      notes: fields.notes ?? null,
      createdAt: now,
    };
    return { ...inspection, components: [...(inspection.components ?? []), optimistic] };
  });
  const input: CreateInspectionComponentInput = { id, ...fields };
  await enqueueOutboxItem('inspection.component', { inspectionId, input });
  void drainOutbox();
  return id;
}

/** Creates a C4 roof-penetration inventory record offline-first and returns
 * its client-generated id. */
export async function createPenetration(
  queryClient: QueryClient,
  inspectionId: string,
  fields: Omit<CreateInspectionPenetrationInput, 'id'>,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: InspectionPenetration = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      slopeId: fields.slopeId ?? null,
      penetrationType: fields.penetrationType,
      flashingCondition: fields.flashingCondition ?? null,
      notes: fields.notes ?? null,
      createdAt: now,
    };
    return { ...inspection, penetrations: [...(inspection.penetrations ?? []), optimistic] };
  });
  const input: CreateInspectionPenetrationInput = { id, ...fields };
  await enqueueOutboxItem('inspection.penetration', { inspectionId, input });
  void drainOutbox();
  return id;
}

/** Creates a C5 product-identification record offline-first and returns its
 * client-generated id. */
export async function createProduct(
  queryClient: QueryClient,
  inspectionId: string,
  fields: Omit<CreateInspectionProductInput, 'id'>,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: InspectionProduct = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      slopeId: fields.slopeId ?? null,
      category: fields.category ?? null,
      brand: fields.brand ?? null,
      productLine: fields.productLine ?? null,
      identificationMethod: fields.identificationMethod,
      itelSampleRef: fields.itelSampleRef ?? null,
      unidentifiableReason: fields.unidentifiableReason ?? null,
      notes: fields.notes ?? null,
      createdAt: now,
    };
    return { ...inspection, products: [...(inspection.products ?? []), optimistic] };
  });
  const input: CreateInspectionProductInput = { id, ...fields };
  await enqueueOutboxItem('inspection.product', { inspectionId, input });
  void drainOutbox();
  return id;
}

/** Creates a test square (D1) offline-first and returns its client id. The
 * id is echoed to the server so the create is idempotent and so the overview
 * photo + per-hit close-ups can reference it before it syncs. */
export async function createTestSquare(
  queryClient: QueryClient,
  inspectionId: string,
  fields: Omit<CreateTestSquareInput, 'id'>,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: TestSquare = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      slopeId: fields.slopeId ?? null,
      label: fields.label,
      sizeSqFt: fields.sizeSqFt ?? null,
      notes: fields.notes ?? null,
      createdAt: now,
    };
    return { ...inspection, testSquares: [...(inspection.testSquares ?? []), optimistic] };
  });
  const input: CreateTestSquareInput = { id, ...fields };
  await enqueueOutboxItem('inspection.testSquare', { inspectionId, input });
  void drainOutbox();
  return id;
}

/** Records a single hit (D1) inside a test square offline-first and returns
 * its client id. The optimistic append updates the live hit counter
 * immediately, even in airplane mode; the client id keeps the queued write
 * idempotent so a replay never inflates the count. */
export async function createTestSquareHit(
  queryClient: QueryClient,
  inspectionId: string,
  testSquareId: string,
  fields: Omit<CreateTestSquareHitInput, 'id'>,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: TestSquareHit = {
      id,
      companyId: inspection.companyId,
      testSquareId,
      hitType: fields.hitType,
      notes: fields.notes ?? null,
      createdAt: now,
    };
    return {
      ...inspection,
      testSquareHits: [...(inspection.testSquareHits ?? []), optimistic],
    };
  });
  const input: CreateTestSquareHitInput = { id, ...fields };
  await enqueueOutboxItem('inspection.testSquareHit', { inspectionId, testSquareId, input });
  void drainOutbox();
  return id;
}

/** Documents a slope as inaccessible (D2) with a required reason, clearing its
 * S4 test-square requirement while recording *why* no square could be marked.
 * Recorded as an S4 stage attestation and optimistically appended so the gate
 * clears live/offline. A client id keeps the queued write idempotent. */
export async function markSlopeInaccessible(
  queryClient: QueryClient,
  inspectionId: string,
  slopeId: string,
  reason: string,
  actorUserId: string,
): Promise<void> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const details = { kind: 'inaccessible_slope', slopeId, reason };
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: Attestation = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      userId: actorUserId,
      stage: 'facets',
      attestationType: 'stage_signoff',
      details,
      signatureData: null,
      attestedAt: now,
    };
    return { ...inspection, attestations: [...(inspection.attestations ?? []), optimistic] };
  });
  const input: CreateAttestationInput = {
    id,
    stage: 'facets',
    attestationType: 'stage_signoff',
    details,
  };
  await enqueueOutboxItem('inspection.attestation', { inspectionId, input });
  void drainOutbox();
}

/** Records a raw measurement (E1 / S7) offline-first and returns its client
 * id. The app stores only the fact captured — never a computed square count
 * or waste factor, which is the Brain's job downstream. */
export async function createMeasurement(
  queryClient: QueryClient,
  inspectionId: string,
  fields: Omit<CreateMeasurementInput, 'id'>,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: Measurement = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      subjectType: fields.subjectType,
      subjectId: fields.subjectId ?? null,
      measurementType: fields.measurementType,
      value: fields.value,
      unit: fields.unit ?? null,
      createdAt: now,
    };
    return { ...inspection, measurements: [...(inspection.measurements ?? []), optimistic] };
  });
  const input: CreateMeasurementInput = { id, ...fields };
  await enqueueOutboxItem('inspection.measurement', { inspectionId, input });
  void drainOutbox();
  return id;
}

/** Records an interior/attic observation (E2 / S6) offline-first and returns
 * its client id. One or more observations clears the INTERIOR_NOT_ADDRESSED
 * soft flag; see also `markNoInteriorClaim` for the explicit-waiver path. */
export async function createInteriorObservation(
  queryClient: QueryClient,
  inspectionId: string,
  fields: Omit<CreateInteriorObservationInput, 'id'>,
): Promise<string> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: InteriorObservation = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      location: fields.location,
      observationType: fields.observationType,
      moistureReading: fields.moistureReading ?? null,
      notes: fields.notes ?? null,
      createdAt: now,
    };
    return {
      ...inspection,
      interiorObservations: [...(inspection.interiorObservations ?? []), optimistic],
    };
  });
  const input: CreateInteriorObservationInput = { id, ...fields };
  await enqueueOutboxItem('inspection.interiorObservation', { inspectionId, input });
  void drainOutbox();
  return id;
}

/** Explicitly waives interior documentation (E2) with a "no interior claim"
 * attestation on S6, clearing the INTERIOR_NOT_ADDRESSED soft flag without a
 * recorded observation. Offline-first + idempotent by client id. */
export async function markNoInteriorClaim(
  queryClient: QueryClient,
  inspectionId: string,
  actorUserId: string,
  reason?: string,
): Promise<void> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const details = { kind: 'no_interior_claim', reason: reason ?? null };
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: Attestation = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      userId: actorUserId,
      stage: 'interior',
      attestationType: 'stage_signoff',
      details,
      signatureData: null,
      attestedAt: now,
    };
    return { ...inspection, attestations: [...(inspection.attestations ?? []), optimistic] };
  });
  const input: CreateAttestationInput = {
    id,
    stage: 'interior',
    attestationType: 'stage_signoff',
    details,
  };
  await enqueueOutboxItem('inspection.attestation', { inspectionId, input });
  void drainOutbox();
}

/** Stores homeowner facts (E3) offline-first. Thin wrapper over the inspection
 * patch — the facts live in a single additive jsonb column. */
export async function updateHomeownerFacts(
  queryClient: QueryClient,
  inspectionId: string,
  facts: HomeownerFacts,
): Promise<void> {
  await patchInspection(queryClient, inspectionId, { homeownerFacts: facts });
}

/** Records the inspector's methodology attestation (E5 / S8) offline-first,
 * applying their signature-on-file (M-F / F0). The inspector no longer draws a
 * fresh signature per inspection: they capture it once on their profile, and
 * here they attest to the declaration ("Apply my signature & sign"). The S8
 * proof recorded is a SHA-256 of the exact declaration text signed; the on-file
 * signature is recorded by reference (its URL + hash), never re-inlined. Clears
 * the S8 hard gate. Idempotent by client id. */
export async function recordSignatureAttestation(
  queryClient: QueryClient,
  inspectionId: string,
  actorUserId: string,
  args: {
    declarationHash: string;
    signatureUrl: string;
    signatureSha256: string;
    signedAt: string | null;
  },
): Promise<void> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const details = {
    kind: 'methodology_declaration',
    declarationHash: args.declarationHash,
    signatureRef: {
      url: args.signatureUrl,
      sha256: args.signatureSha256,
      signedAt: args.signedAt,
    },
  };
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: Attestation = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      userId: actorUserId,
      stage: 'declaration',
      attestationType: 'stage_signoff',
      details,
      // The on-file signature hash stands in as the attestation's signature
      // proof; the raw image lives in object storage, referenced above.
      signatureData: args.signatureSha256,
      attestedAt: now,
    };
    return { ...inspection, attestations: [...(inspection.attestations ?? []), optimistic] };
  });
  const input: CreateAttestationInput = {
    id,
    stage: 'declaration',
    attestationType: 'stage_signoff',
    details,
    signatureData: args.signatureSha256,
  };
  await enqueueOutboxItem('inspection.attestation', { inspectionId, input });
  void drainOutbox();
}

/** Confirms the final package review (E6 / S9) offline-first — a distinct,
 * deliberate act from the mechanical submit. Filed as an S9 attestation that
 * clears the S9 hard gate. Idempotent by client id. */
export async function confirmFinalReview(
  queryClient: QueryClient,
  inspectionId: string,
  actorUserId: string,
): Promise<void> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const details = { kind: 'final_review' };
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: Attestation = {
      id,
      companyId: inspection.companyId,
      inspectionId,
      userId: actorUserId,
      stage: 'submit',
      attestationType: 'stage_signoff',
      details,
      signatureData: null,
      attestedAt: now,
    };
    return { ...inspection, attestations: [...(inspection.attestations ?? []), optimistic] };
  });
  const input: CreateAttestationInput = {
    id,
    stage: 'submit',
    attestationType: 'stage_signoff',
    details,
  };
  await enqueueOutboxItem('inspection.attestation', { inspectionId, input });
  void drainOutbox();
}

/** Submits the assembled package (E6) offline-first. The caller must have
 * confirmed zero hard deficiencies via the shared gate engine before calling
 * — the server accept is thin (M-F seam) and does not re-verify. Optimistically
 * flips the cached status to `submitted` and stores the manifest. */
export async function submitInspection(
  queryClient: QueryClient,
  inspectionId: string,
  manifest: SubmissionManifestV1,
): Promise<void> {
  patchCachedInspection(queryClient, inspectionId, (inspection) => ({
    ...inspection,
    status: 'submitted',
    submissionManifest: manifest,
    updatedAt: new Date().toISOString(),
  }));
  await enqueueOutboxItem('inspection.submission', { inspectionId, input: { manifest } });
  void drainOutbox();
}

/** Optimistically appends captured evidence photos to the cached inspection
 * so gate progress reflects them immediately, before the outbox has synced
 * (or even while offline). Each photo carries the SAME client-generated id
 * used for its outbox payload and the idempotent server write, so the cached
 * row's id is the durable record id — never a throwaway placeholder. This
 * matters for the E6 submission manifest, which is assembled from these cached
 * rows and must reference ids that actually persist server-side. The URL is a
 * placeholder until sync; a later refetch replaces these rows with server
 * truth (same ids). */
export function appendOptimisticPhotos(
  queryClient: QueryClient,
  inspectionId: string,
  photos: Array<{
    id: string;
    subjectType: InspectionSubjectType;
    subjectId: string | null;
    stage?: CaptureStage | null;
    triadRole?: PhotoTriadRole | null;
    preliminaryRole?: PreliminaryPhotoRole | null;
    sha256: string;
  }>,
): void {
  const now = new Date().toISOString();
  patchCachedInspection(queryClient, inspectionId, (inspection) => {
    const optimistic: InspectionPhoto[] = photos.map((p) => ({
      id: p.id,
      companyId: inspection.companyId,
      inspectionId,
      stage: p.stage ?? null,
      subjectType: p.subjectType,
      subjectId: p.subjectId ?? null,
      triadRole: p.triadRole ?? null,
      preliminaryRole: p.preliminaryRole ?? null,
      url: '',
      sha256: p.sha256,
      exifJson: null,
      overlayJson: null,
      capturedAtUtc: now,
      latitude: null,
      longitude: null,
      createdAt: now,
    }));
    return { ...inspection, photos: [...(inspection.photos ?? []), ...optimistic] };
  });
}

/** Query key helpers re-exported so screens can invalidate the list feed. */
export const inspectionsListKey = getListInspectionsQueryKey;

// Supported outbox item kinds. Each is an inspection write that must survive
// being captured offline and replay in FIFO order once connectivity returns.
// Ordering matters: `inspection.create` for a given client id is enqueued
// before any `inspection.update` / `inspection.attestation` that references
// it, and the drainer processes oldest-first, so the create always lands
// (idempotently, via the client-supplied id) before its dependents.
export type OutboxItemKind =
  | 'inspection.photo'
  | 'inspection.create'
  | 'inspection.update'
  | 'inspection.attestation'
  | 'inspection.elevation'
  | 'inspection.slope'
  | 'inspection.slopeUpdate'
  | 'inspection.slopeDelete'
  | 'inspection.sidingFacet'
  | 'inspection.sidingFacetUpdate'
  | 'inspection.sidingFacetDelete'
  | 'inspection.damage'
  | 'inspection.component'
  | 'inspection.componentUpdate'
  | 'inspection.componentDelete'
  | 'inspection.penetration'
  | 'inspection.product'
  | 'inspection.testSquare'
  | 'inspection.testSquareHit'
  | 'inspection.measurement'
  | 'inspection.interiorObservation'
  | 'inspection.submission';

export interface InspectionPhotoOutboxPayload {
  /** Client-generated photo id so a replayed outbox item (e.g. after a lost
   * upload response) is idempotent server-side and can't duplicate the row. */
  id: string;
  inspectionId: string;
  subjectType: string;
  subjectId: string | null;
  /** Optional capture stage (e.g. 'S2' for a roof-access photo). Lets the
   * gate engine distinguish otherwise-identical inspection-subject photos. */
  stage?: string | null;
  /** Forensic triad slot. Null/omitted for Phase 1 single-shot photos, which
   * carry `preliminaryRole` instead. */
  triadRole?: 'wide' | 'mid' | 'close' | null;
  /** Phase 1 single-shot slot (P2). Mutually exclusive with `triadRole`. */
  preliminaryRole?: 'front_of_home' | 'roof_overview' | 'damage_closeup' | null;
  /** Path to a copy of the photo in this app's stable document storage —
   * NOT the original camera-roll/cache URI, which the OS may evict before
   * connectivity returns. */
  localFilePath: string;
  mimeType: string;
  sha256: string;
  exifJson: Record<string, unknown> | null;
  overlayJson: Record<string, unknown> | null;
  capturedAtUtc: string;
  latitude: number | null;
  longitude: number | null;
  /** Component-zone tag for shared zone photos (subjectType 'component',
   * no subjectId). Null/omitted for every other photo. */
  zone?: 'eave_edge' | 'ridge_hip' | null;
  /** v2.1 siding-photo role tag for subjectType 'siding_facet' photos
   * (damage close-up / facet shot / per-component photo). Null/omitted for
   * every other photo. */
  sidingRole?: 'damage' | 'facet' | 'component' | null;
  /** 1-based component slot (S{n}C{k}) a 'component'-role photo evidences.
   * Null/omitted for every other photo. */
  sidingComponentIndex?: number | null;
}

/** Offline-first inspection create. Carries a client-generated `id` so the
 * server upserts idempotently — a retried queue item never double-creates. */
export interface InspectionCreateOutboxPayload {
  input: Record<string, unknown>;
}

/** Offline-first patch to an existing (possibly not-yet-synced) inspection. */
export interface InspectionUpdateOutboxPayload {
  inspectionId: string;
  patch: Record<string, unknown>;
}

/** Offline-first attestation (equipment checklist, GPS override, sign-off). */
export interface InspectionAttestationOutboxPayload {
  inspectionId: string;
  input: Record<string, unknown>;
}

/** Offline-first child create (elevation / slope / damage instance). Each
 * carries a client-generated `id` so the server upserts idempotently and so
 * evidence photos queued in the same session can reference the child before
 * it has synced. `input` is the matching Create*Input shape. */
export interface InspectionChildCreateOutboxPayload {
  inspectionId: string;
  input: Record<string, unknown>;
}

/** Offline-first facet (slope) update. Replays after the facet's own create
 * (FIFO) and is idempotent server-side — re-applying the same partial patch
 * converges on the same row. */
export interface InspectionSlopeUpdateOutboxPayload {
  inspectionId: string;
  slopeId: string;
  patch: Record<string, unknown>;
}

/** Offline-first facet (slope) delete. Idempotent: a 404 on replay means the
 * facet is already gone and counts as success. */
export interface InspectionSlopeDeleteOutboxPayload {
  inspectionId: string;
  slopeId: string;
}

/** Offline-first siding-facet update. Replays after the facet's own create
 * (FIFO) and is idempotent server-side. */
export interface InspectionSidingFacetUpdateOutboxPayload {
  inspectionId: string;
  sidingFacetId: string;
  patch: Record<string, unknown>;
}

/** Offline-first siding-facet delete. Idempotent: a 404 on replay means the
 * facet is already gone and counts as success. */
export interface InspectionSidingFacetDeleteOutboxPayload {
  inspectionId: string;
  sidingFacetId: string;
}

/** Offline-first component update. Replays after the component's own create
 * (FIFO) and is idempotent server-side. */
export interface InspectionComponentUpdateOutboxPayload {
  inspectionId: string;
  componentId: string;
  patch: Record<string, unknown>;
}

/** Offline-first component delete. Idempotent: a 404 on replay means the
 * component is already gone and counts as success. */
export interface InspectionComponentDeleteOutboxPayload {
  inspectionId: string;
  componentId: string;
}

/** Offline-first test-square hit create (D1). Carries the parent
 * `testSquareId` (the hit route is nested under the square) plus a
 * client-generated `id` inside `input` so the server upserts idempotently and
 * a replay never inflates the live hit counter. */
export interface InspectionTestSquareHitOutboxPayload {
  inspectionId: string;
  testSquareId: string;
  input: Record<string, unknown>;
}

/** Offline-first submission (E6). Carries the client-assembled submission
 * manifest v1 (record ids, photo SHA-256s, gate results). The server accepts
 * it thinly — stores the manifest verbatim and transitions the inspection to
 * `submitted`; hash/lock/pre-flight verification is deferred to M-F. */
export interface InspectionSubmissionOutboxPayload {
  inspectionId: string;
  input: Record<string, unknown>;
}

// `dead` — permanently rejected by the server (4xx on a well-formed replay,
// e.g. an item queued under an older contract). Never retried, so one
// poisoned item can't spam the server or mask real sync progress.
export type OutboxStatus = 'pending' | 'syncing' | 'done' | 'failed' | 'dead';

export interface OutboxItem {
  id: string;
  kind: OutboxItemKind;
  /** JSON-serialized payload. Written once at enqueue time and never
   * mutated afterward — only `status`/`attempts`/`lastError` change as the
   * item moves through the drain lifecycle. */
  payload: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

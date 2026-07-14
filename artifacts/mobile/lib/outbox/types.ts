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
  | 'inspection.attestation';

export interface InspectionPhotoOutboxPayload {
  inspectionId: string;
  subjectType: string;
  subjectId: string | null;
  triadRole: 'wide' | 'mid' | 'close';
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

export type OutboxStatus = 'pending' | 'syncing' | 'done' | 'failed';

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

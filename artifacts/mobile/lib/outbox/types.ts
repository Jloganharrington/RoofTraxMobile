// A single supported outbox item kind so far: an inspection evidence photo
// captured offline. Extend this union as more inspection writes (damage
// instances, measurements, etc.) get offline support.
export type OutboxItemKind = 'inspection.photo';

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

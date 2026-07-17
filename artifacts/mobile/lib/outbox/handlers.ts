import { File } from 'expo-file-system';
import {
  createAttestation,
  createDamageInstance,
  createInspection,
  createInspectionComponent,
  createInspectionElevation,
  createInspectionPenetration,
  createInspectionPhoto,
  createInspectionProduct,
  createInspectionSlope,
  createInteriorObservation,
  createMeasurement,
  createTestSquare,
  createTestSquareHit,
  deleteInspectionComponent,
  deleteInspectionSlope,
  updateInspectionComponent,
  submitInspection,
  updateInspection,
  updateInspectionSlope,
} from '@workspace/api-client-react';
import type {
  CreateAttestationInput,
  CreateDamageInstanceInput,
  CreateInspectionComponentInput,
  CreateInspectionElevationInput,
  CreateInspectionInput,
  CreateInspectionPenetrationInput,
  CreateInspectionProductInput,
  CreateInspectionSlopeInput,
  CreateInteriorObservationInput,
  CreateMeasurementInput,
  CreateTestSquareInput,
  CreateTestSquareHitInput,
  CaptureStage,
  InspectionSubjectType,
  PhotoTriadRole,
  SubmitInspectionInput,
  UpdateInspectionComponentInput,
  UpdateInspectionInput,
  UpdateInspectionSlopeInput,
} from '@workspace/api-client-react';

import { uploadFile } from '../upload';
import type {
  InspectionAttestationOutboxPayload,
  InspectionChildCreateOutboxPayload,
  InspectionComponentDeleteOutboxPayload,
  InspectionComponentUpdateOutboxPayload,
  InspectionCreateOutboxPayload,
  InspectionPhotoOutboxPayload,
  InspectionSlopeDeleteOutboxPayload,
  InspectionSlopeUpdateOutboxPayload,
  InspectionSubmissionOutboxPayload,
  InspectionTestSquareHitOutboxPayload,
  InspectionUpdateOutboxPayload,
  OutboxItemKind,
} from './types';

type Handler = (payload: string) => Promise<void>;

// Each handler must be safe to invoke on an item that has already partially
// succeeded on a prior drain attempt (e.g. the storage upload went through
// but the metadata POST failed before the drainer could mark the item
// done). Known caveat for the photo handler: retrying after a partial
// failure re-uploads the file, leaving a harmless orphaned blob in storage
// behind the first attempt — acceptable in this phase since nothing reads
// storage state to detect duplicates, but worth revisiting before this
// module carries higher-value writes.
async function syncInspectionPhoto(payloadJson: string): Promise<void> {
  const payload: InspectionPhotoOutboxPayload = JSON.parse(payloadJson);

  const url = await uploadFile(payload.localFilePath, payload.mimeType);

  await createInspectionPhoto(payload.inspectionId, {
    id: payload.id,
    subjectType: payload.subjectType as InspectionSubjectType,
    subjectId: payload.subjectId ?? undefined,
    stage: (payload.stage as CaptureStage | null | undefined) ?? undefined,
    triadRole: (payload.triadRole as PhotoTriadRole | null | undefined) ?? undefined,
    preliminaryRole: payload.preliminaryRole ?? undefined,
    url,
    sha256: payload.sha256,
    exifJson: payload.exifJson,
    overlayJson: payload.overlayJson,
    capturedAtUtc: payload.capturedAtUtc,
    latitude: payload.latitude,
    longitude: payload.longitude,
  });

  // Best-effort cleanup of the local copy now that the server has the
  // photo — failure to delete never fails the sync itself.
  try {
    // See the comment on `asFile` in lib/inspectionPhoto.ts — the exported
    // `File` class's declared type is missing its own documented instance
    // members, so this casts around that upstream declaration gap.
    const file = new File(payload.localFilePath) as unknown as { exists: boolean; delete(): void };
    if (file.exists) file.delete();
  } catch {
    // Ignore — an orphaned local file costs disk space, not correctness.
  }
}

async function syncInspectionCreate(payloadJson: string): Promise<void> {
  const payload: InspectionCreateOutboxPayload = JSON.parse(payloadJson);
  // Idempotent by the client-supplied id — a retry after a partial failure
  // returns the existing row instead of creating a duplicate.
  await createInspection(payload.input as CreateInspectionInput);
}

async function syncInspectionUpdate(payloadJson: string): Promise<void> {
  const payload: InspectionUpdateOutboxPayload = JSON.parse(payloadJson);
  await updateInspection(payload.inspectionId, payload.patch as UpdateInspectionInput);
}

async function syncInspectionAttestation(payloadJson: string): Promise<void> {
  const payload: InspectionAttestationOutboxPayload = JSON.parse(payloadJson);
  await createAttestation(payload.inspectionId, payload.input as CreateAttestationInput);
}

// Child creates are idempotent by their client-supplied id — a retry after a
// partial failure returns the existing row instead of duplicating it.
async function syncInspectionElevation(payloadJson: string): Promise<void> {
  const payload: InspectionChildCreateOutboxPayload = JSON.parse(payloadJson);
  await createInspectionElevation(
    payload.inspectionId,
    payload.input as unknown as CreateInspectionElevationInput,
  );
}

async function syncInspectionSlope(payloadJson: string): Promise<void> {
  const payload: InspectionChildCreateOutboxPayload = JSON.parse(payloadJson);
  await createInspectionSlope(
    payload.inspectionId,
    payload.input as unknown as CreateInspectionSlopeInput,
  );
}

async function syncInspectionSlopeUpdate(payloadJson: string): Promise<void> {
  const payload: InspectionSlopeUpdateOutboxPayload = JSON.parse(payloadJson);
  await updateInspectionSlope(
    payload.inspectionId,
    payload.slopeId,
    payload.patch as unknown as UpdateInspectionSlopeInput,
  );
}

async function syncInspectionSlopeDelete(payloadJson: string): Promise<void> {
  const payload: InspectionSlopeDeleteOutboxPayload = JSON.parse(payloadJson);
  try {
    await deleteInspectionSlope(payload.inspectionId, payload.slopeId);
  } catch (error) {
    // Idempotent replay: the facet already being gone is success.
    if (error instanceof Error && /404/.test(error.message)) return;
    throw error;
  }
}

async function syncInspectionDamage(payloadJson: string): Promise<void> {
  const payload: InspectionChildCreateOutboxPayload = JSON.parse(payloadJson);
  await createDamageInstance(
    payload.inspectionId,
    payload.input as unknown as CreateDamageInstanceInput,
  );
}

async function syncInspectionComponent(payloadJson: string): Promise<void> {
  const payload: InspectionChildCreateOutboxPayload = JSON.parse(payloadJson);
  await createInspectionComponent(
    payload.inspectionId,
    payload.input as unknown as CreateInspectionComponentInput,
  );
}

async function syncInspectionComponentUpdate(payloadJson: string): Promise<void> {
  const payload: InspectionComponentUpdateOutboxPayload = JSON.parse(payloadJson);
  try {
    await updateInspectionComponent(
      payload.inspectionId,
      payload.componentId,
      payload.patch as unknown as UpdateInspectionComponentInput,
    );
  } catch (error) {
    // Replay tolerance: a queued update whose component was deleted by a
    // later local action would otherwise be permanently rejected (dead) and
    // block submission readiness. The row being gone means the update is
    // moot — treat it as success.
    if (error instanceof Error && /404/.test(error.message)) return;
    throw error;
  }
}

async function syncInspectionComponentDelete(payloadJson: string): Promise<void> {
  const payload: InspectionComponentDeleteOutboxPayload = JSON.parse(payloadJson);
  try {
    await deleteInspectionComponent(payload.inspectionId, payload.componentId);
  } catch (error) {
    // Idempotent replay: the component already being gone is success.
    if (error instanceof Error && /404/.test(error.message)) return;
    throw error;
  }
}

async function syncInspectionPenetration(payloadJson: string): Promise<void> {
  const payload: InspectionChildCreateOutboxPayload = JSON.parse(payloadJson);
  await createInspectionPenetration(
    payload.inspectionId,
    payload.input as unknown as CreateInspectionPenetrationInput,
  );
}

async function syncInspectionProduct(payloadJson: string): Promise<void> {
  const payload: InspectionChildCreateOutboxPayload = JSON.parse(payloadJson);
  await createInspectionProduct(
    payload.inspectionId,
    payload.input as unknown as CreateInspectionProductInput,
  );
}

async function syncInspectionTestSquare(payloadJson: string): Promise<void> {
  const payload: InspectionChildCreateOutboxPayload = JSON.parse(payloadJson);
  await createTestSquare(
    payload.inspectionId,
    payload.input as unknown as CreateTestSquareInput,
  );
}

async function syncInspectionTestSquareHit(payloadJson: string): Promise<void> {
  const payload: InspectionTestSquareHitOutboxPayload = JSON.parse(payloadJson);
  await createTestSquareHit(
    payload.inspectionId,
    payload.testSquareId,
    payload.input as unknown as CreateTestSquareHitInput,
  );
}

async function syncInspectionMeasurement(payloadJson: string): Promise<void> {
  const payload: InspectionChildCreateOutboxPayload = JSON.parse(payloadJson);
  await createMeasurement(
    payload.inspectionId,
    payload.input as unknown as CreateMeasurementInput,
  );
}

async function syncInspectionInteriorObservation(payloadJson: string): Promise<void> {
  const payload: InspectionChildCreateOutboxPayload = JSON.parse(payloadJson);
  await createInteriorObservation(
    payload.inspectionId,
    payload.input as unknown as CreateInteriorObservationInput,
  );
}

// The submission is the last write in the queue for an inspection — it replays
// after every child create it references (FIFO), so by the time it lands the
// records and photo hashes in its manifest already exist server-side.
async function syncInspectionSubmission(payloadJson: string): Promise<void> {
  const payload: InspectionSubmissionOutboxPayload = JSON.parse(payloadJson);
  await submitInspection(payload.inspectionId, payload.input as unknown as SubmitInspectionInput);
}

export const OUTBOX_HANDLERS: Record<OutboxItemKind, Handler> = {
  'inspection.photo': syncInspectionPhoto,
  'inspection.create': syncInspectionCreate,
  'inspection.update': syncInspectionUpdate,
  'inspection.attestation': syncInspectionAttestation,
  'inspection.elevation': syncInspectionElevation,
  'inspection.slope': syncInspectionSlope,
  'inspection.slopeUpdate': syncInspectionSlopeUpdate,
  'inspection.slopeDelete': syncInspectionSlopeDelete,
  'inspection.damage': syncInspectionDamage,
  'inspection.component': syncInspectionComponent,
  'inspection.componentUpdate': syncInspectionComponentUpdate,
  'inspection.componentDelete': syncInspectionComponentDelete,
  'inspection.penetration': syncInspectionPenetration,
  'inspection.product': syncInspectionProduct,
  'inspection.testSquare': syncInspectionTestSquare,
  'inspection.testSquareHit': syncInspectionTestSquareHit,
  'inspection.measurement': syncInspectionMeasurement,
  'inspection.interiorObservation': syncInspectionInteriorObservation,
  'inspection.submission': syncInspectionSubmission,
};

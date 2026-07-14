import { File } from 'expo-file-system';
import { createInspectionPhoto } from '@workspace/api-client-react';
import type { InspectionSubjectType, PhotoTriadRole } from '@workspace/api-client-react';

import { uploadFile } from '../upload';
import type { InspectionPhotoOutboxPayload, OutboxItemKind } from './types';

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
    subjectType: payload.subjectType as InspectionSubjectType,
    subjectId: payload.subjectId ?? undefined,
    triadRole: payload.triadRole as PhotoTriadRole,
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

export const OUTBOX_HANDLERS: Record<OutboxItemKind, Handler> = {
  'inspection.photo': syncInspectionPhoto,
};

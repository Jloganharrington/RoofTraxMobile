import * as Crypto from 'expo-crypto';
import type { QueryClient } from '@tanstack/react-query';
import {
  getGetInspectionQueryKey,
  getListInspectionsQueryKey,
} from '@workspace/api-client-react';
import type {
  CreateAttestationInput,
  CreateInspectionInput,
  Inspection,
  InspectionEnvelope,
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

/** Query key helpers re-exported so screens can invalidate the list feed. */
export const inspectionsListKey = getListInspectionsQueryKey;

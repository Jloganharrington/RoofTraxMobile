/**
 * Local hooks for the forensic agreement signing API.
 * Pattern matches priceBookApi.ts — uses customFetch<T> which returns the
 * parsed response body directly and throws ApiError on non-2xx responses.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SignedAgreementRecord {
  id: string;
  inspectionId: string;
  signerName: string;
  documentVersion: string;
  signedAt: string;
  documentObjectPath: string;
  /** Short-lived presigned GCS URL for direct PDF download. May be null. */
  downloadUrl?: string | null;
}

export interface AgreementStatusResponse {
  agreement: SignedAgreementRecord | null;
  /** 'forensic' | 'preliminary' */
  phase: string;
}

export interface SignAgreementVariables {
  inspectionId: string;
  signerName: string;
  /** Raw base64 PNG (no data: prefix). */
  signatureImageBase64: string;
}

// ── Query key ─────────────────────────────────────────────────────────────────

export function getAgreementQueryKey(inspectionId: string) {
  return ['agreement', inspectionId] as const;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useGetAgreement(inspectionId: string) {
  return useQuery<AgreementStatusResponse, Error>({
    queryKey: getAgreementQueryKey(inspectionId),
    queryFn: async () => {
      try {
        return await customFetch<AgreementStatusResponse>(
          `/api/inspections/${inspectionId}/agreement`,
        );
      } catch (err) {
        // A 404 means the inspection doesn't have a signed agreement yet —
        // treat it as "not signed" rather than a hard query failure.
        if (
          err != null &&
          typeof err === 'object' &&
          'status' in err &&
          (err as { status: number }).status === 404
        ) {
          return { agreement: null, phase: 'forensic' };
        }
        throw err;
      }
    },
    enabled: !!inspectionId,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useSignAgreement() {
  const queryClient = useQueryClient();
  return useMutation<
    SignedAgreementRecord,
    Error,
    SignAgreementVariables
  >({
    mutationFn: async ({ inspectionId, signerName, signatureImageBase64 }) => {
      const data = await customFetch<{ agreement: SignedAgreementRecord }>(
        `/api/inspections/${inspectionId}/agreement/sign`,
        {
          method: 'POST',
          body: JSON.stringify({ signerName, signatureImageBase64 }),
        },
      );
      return data.agreement;
    },
    onSuccess: (_, { inspectionId }) => {
      queryClient.invalidateQueries({ queryKey: getAgreementQueryKey(inspectionId) });
    },
  });
}

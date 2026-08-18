/**
 * Photo Curation & Captioning API hooks.
 * Curation endpoints are not yet in the OpenAPI spec — wired manually
 * via customFetch following the same pattern as priceBookApi.ts.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExhibitClass = 'R' | 'S' | 'I' | 'F' | 'C' | 'T';

export interface PhotoBrief {
  id: string;
  url: string;
  stage: string | null;
  subjectType: string;
  triadRole: string | null;
  preliminaryRole: string | null;
  capturedAtUtc: string | null;
  sha256: string;
}

export interface ExhibitSelection {
  id: string;
  photoId: string;
  exhibitClass: ExhibitClass | null;
  badgeLabel: string | null;
  sortOrder: number;
  isAiProposed: boolean;
  finalizedAt: string | null;
  photo: PhotoBrief;
}

export type ComparisonPairType =
  | 'recency'
  | 'covered_vs_unrelated'
  | 'cause_differentiation';

export interface ComparisonPair {
  id: string;
  beforePhotoId: string;
  afterPhotoId: string;
  pairType: ComparisonPairType;
  confirmedBy: string | null;
  confirmedAt: string | null;
  notes: string | null;
  beforePhoto: PhotoBrief;
  afterPhoto: PhotoBrief;
}

export type CaptionState = 'pending' | 'generated' | 'in_review' | 'approved' | 'locked';

export interface ExhibitCaption {
  id: string;
  exhibitSelectionId: string;
  badgeLabel: string;
  captionText: string | null;
  state: CaptionState;
  generatedAt: string | null;
  lockedAt: string | null;
}

export interface CurationState {
  inspectionId: string;
  photos: PhotoBrief[];
  selections: ExhibitSelection[];
  pairs: ComparisonPair[];
  captions: ExhibitCaption[];
  isFinalized: boolean;
  exhibitBadgeMap: {
    counters: Record<ExhibitClass, number>;
    assignments: Record<string, string>;
  } | null;
  photoComparisonGateActive: boolean;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const getCurationQueryKey = (inspectionId: string) =>
  ['inspection', inspectionId, 'curation'] as const;

export const getCaptionsQueryKey = (inspectionId: string) =>
  ['inspection', inspectionId, 'captions'] as const;

// ---------------------------------------------------------------------------
// Curation hooks
// ---------------------------------------------------------------------------

export function useGetCuration(
  inspectionId: string,
  options?: Omit<UseQueryOptions<CurationState>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getCurationQueryKey(inspectionId),
    queryFn: () =>
      customFetch<CurationState>(`/api/inspections/${inspectionId}/curation`),
    enabled: !!inspectionId,
    ...options,
  });
}

export function useProposeCuration(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<CurationState>(
        `/api/inspections/${inspectionId}/curation/propose`,
        { method: 'POST' },
      ),
    onSuccess: (data) =>
      qc.setQueryData(getCurationQueryKey(inspectionId), data),
  });
}

export function useSetExhibitSelection(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      photoId,
      selected,
      exhibitClass,
      sortOrder,
    }: {
      photoId: string;
      selected: boolean;
      exhibitClass?: ExhibitClass | null;
      sortOrder?: number;
    }) =>
      customFetch<{ selection: ExhibitSelection | null }>(
        `/api/inspections/${inspectionId}/curation/photos/${photoId}`,
        { method: 'PATCH', body: JSON.stringify({ selected, exhibitClass, sortOrder }) },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getCurationQueryKey(inspectionId) }),
  });
}

export function useConfirmPair(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      beforePhotoId: string;
      afterPhotoId: string;
      pairType: ComparisonPairType;
      notes?: string;
    }) =>
      customFetch<{ pair: ComparisonPair }>(
        `/api/inspections/${inspectionId}/curation/pairs`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getCurationQueryKey(inspectionId) }),
  });
}

export function useRemovePair(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pairId: string) =>
      customFetch<{ ok: boolean }>(
        `/api/inspections/${inspectionId}/curation/pairs/${pairId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getCurationQueryKey(inspectionId) }),
  });
}

export function useFinalizeCuration(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<CurationState>(
        `/api/inspections/${inspectionId}/curation/finalize`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      qc.setQueryData(getCurationQueryKey(inspectionId), data);
      qc.invalidateQueries({ queryKey: getCaptionsQueryKey(inspectionId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Caption hooks
// ---------------------------------------------------------------------------

export function useGenerateCaptions(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ captions: ExhibitCaption[] }>(
        `/api/inspections/${inspectionId}/sections/captions/generate`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getCaptionsQueryKey(inspectionId) });
      qc.invalidateQueries({ queryKey: getCurationQueryKey(inspectionId) });
    },
  });
}

export function useUpdateCaption(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ captionId, captionText }: { captionId: string; captionText: string }) =>
      customFetch<{ caption: ExhibitCaption }>(
        `/api/inspections/${inspectionId}/sections/captions/${captionId}`,
        { method: 'PATCH', body: JSON.stringify({ captionText }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getCaptionsQueryKey(inspectionId) });
      qc.invalidateQueries({ queryKey: getCurationQueryKey(inspectionId) });
    },
  });
}

export function useApproveCaptions(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ captions: ExhibitCaption[] }>(
        `/api/inspections/${inspectionId}/sections/captions/approve`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getCaptionsQueryKey(inspectionId) });
      qc.invalidateQueries({ queryKey: getCurationQueryKey(inspectionId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Exhibit Slots (slot-based curation manifest)
// ---------------------------------------------------------------------------

export interface SlotPhotoCandidate {
  id: string;
  url: string;
  subjectType: string;
  triadRole: string | null;
  preliminaryRole: string | null;
  stage: string | null;
  capturedAtUtc: string | null;
}

export type SlotKind = 'single' | 'comparison';

export interface ExhibitSlot {
  slotKey: string;
  label: string;
  required: boolean;
  kind: SlotKind;
  comparisonType: ComparisonPairType | null;
  candidates: SlotPhotoCandidate[];
  confirmedPhotoId: string | null;
  beforeCandidates: SlotPhotoCandidate[];
  afterCandidates: SlotPhotoCandidate[];
  confirmedPairId: string | null;
  isSkipped: boolean;
}

export interface ExhibitSlotsResponse {
  inspectionId: string;
  slots: ExhibitSlot[];
  allRequiredConfirmed: boolean;
}

export const getExhibitSlotsQueryKey = (inspectionId: string) =>
  ['inspection', inspectionId, 'exhibit-slots'] as const;

export function useGetExhibitSlots(
  inspectionId: string,
  options?: Omit<UseQueryOptions<ExhibitSlotsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getExhibitSlotsQueryKey(inspectionId),
    queryFn: () =>
      customFetch<ExhibitSlotsResponse>(`/api/inspections/${inspectionId}/exhibit-slots`),
    enabled: !!inspectionId,
    ...options,
  });
}

export function useLockCaptions(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ captions: ExhibitCaption[] }>(
        `/api/inspections/${inspectionId}/sections/captions/lock`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getCaptionsQueryKey(inspectionId) });
      qc.invalidateQueries({ queryKey: getCurationQueryKey(inspectionId) });
    },
  });
}

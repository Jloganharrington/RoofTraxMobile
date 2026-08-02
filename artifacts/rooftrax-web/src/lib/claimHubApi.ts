/**
 * Manual React Query hooks for Claim Hub endpoints.
 * Endpoints are not in the OpenAPI spec yet — follows the same pattern as
 * curationApi.ts, using customFetch from @workspace/api-client-react.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { customFetch, getGetInspectionQueryKey } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReadinessState = 'pass' | 'fail' | 'warning';

export interface ReadinessItem {
  key: string;
  label: string;
  state: ReadinessState;
  detail?: string | null;
}

export interface ReadinessResult {
  inspectionId: string;
  overallPass: boolean;
  items: ReadinessItem[];
}

export type SectionType =
  | 'findings'
  | 'causation'
  | 'detriment_application'
  | 'rap_narrative'
  | 'estimate_justifications'
  | 'summary_of_findings'
  | 'closing_statement';

export type SectionState =
  | 'not_started'
  | 'generating'
  | 'generated'
  | 'in_review'
  | 'approved'
  | 'locked';

export interface ClaimSection {
  sectionType: SectionType;
  state: SectionState;
  content?: string | null;
  gateFlags?: Record<string, boolean | null>;
  generatedAt?: string | null;
  approvedAt?: string | null;
  lockedAt?: string | null;
  rapMode?: 'damaged_target' | 'fallback_slope' | null;
}

export interface ClaimEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  actorId: string | null;
  createdAt: string;
}

export interface PipelineLead {
  id: string;
  address: string | null;
  workflow: 'retail' | 'insurance';
  damageType: string | null;
  doorKnockResult: string | null;
  contactOutcome: string | null;
  customerName: string | null;
  customerPhone: string | null;
  retailData: {
    ownerName1?: string;
    interestedRoof?: boolean;
    interestedSiding?: boolean;
    interestedWindows?: boolean;
    interestedDoors?: boolean;
    appointmentDate?: string | null;
  } | null;
  repName: string | null;
  inspectionId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const getReadinessQueryKey = (id: string) =>
  ['inspection', id, 'readiness'] as const;

export const getSectionsQueryKey = (id: string) =>
  ['inspection', id, 'sections'] as const;

export const getEventsQueryKey = (id: string) =>
  ['inspection', id, 'events'] as const;

export const getLeadsQueryKey = () => ['leads'] as const;

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export function useGetReadiness(
  inspectionId: string,
  options?: Omit<UseQueryOptions<ReadinessResult>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getReadinessQueryKey(inspectionId),
    queryFn: () =>
      customFetch<ReadinessResult>(`/api/inspections/${inspectionId}/readiness`),
    enabled: !!inspectionId,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function useGetSections(
  inspectionId: string,
  options?: Omit<UseQueryOptions<{ sections: ClaimSection[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getSectionsQueryKey(inspectionId),
    queryFn: () =>
      customFetch<{ sections: ClaimSection[] }>(`/api/inspections/${inspectionId}/sections`),
    enabled: !!inspectionId,
    ...options,
  });
}

export function useGenerateSection(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sectionType: SectionType) =>
      customFetch<{ section: ClaimSection }>(
        `/api/inspections/${inspectionId}/sections/${sectionType}/generate`,
        { method: 'POST' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: getSectionsQueryKey(inspectionId) }),
  });
}

export function useApproveSection(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sectionType,
      causationReviewConfirmed,
      rapFallbackConfirmed,
    }: {
      sectionType: SectionType;
      causationReviewConfirmed?: boolean;
      rapFallbackConfirmed?: boolean;
    }) =>
      customFetch<{ section: ClaimSection }>(
        `/api/inspections/${inspectionId}/sections/${sectionType}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({ causationReviewConfirmed, rapFallbackConfirmed }),
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: getSectionsQueryKey(inspectionId) }),
  });
}

export function useLockSection(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sectionType: SectionType) =>
      customFetch<{ section: ClaimSection }>(
        `/api/inspections/${inspectionId}/sections/${sectionType}/lock`,
        { method: 'POST' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: getSectionsQueryKey(inspectionId) }),
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function useGetEvents(
  inspectionId: string,
  options?: Omit<UseQueryOptions<{ events: ClaimEvent[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getEventsQueryKey(inspectionId),
    queryFn: () =>
      customFetch<{ events: ClaimEvent[] }>(`/api/inspections/${inspectionId}/events`),
    enabled: !!inspectionId,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

export interface CompileResult {
  compiledReportPath: string;
  lintStatus: 'passed' | 'needs_review' | 'blocked';
  findings: unknown[];
}

export function useCompileReport(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<CompileResult>(`/api/inspections/${inspectionId}/report/compile`, {
        method: 'POST',
      }),
    onSuccess: () => {
      // Bust the exact cache key used by useGetInspection so compiledReportVersions
      // updates immediately in the Package version list.
      qc.invalidateQueries({ queryKey: getGetInspectionQueryKey(inspectionId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Pipeline (company-wide, manager+ view)
// ---------------------------------------------------------------------------

export interface PipelineInspection {
  id: string;
  address: string | null;
  status: string;
  phase: string;
  damageType: string | null;
  compiledReportVersions: Array<{ path: string; compiledAt: string; schemaVersion?: number; lintStatus?: string }>;
  repName: string | null;
  createdAt: string;
  updatedAt: string;
}

export const getPipelineQueryKey = () => ['pipeline'] as const;

export function useGetPipeline(
  options?: Omit<UseQueryOptions<{ inspections: PipelineInspection[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getPipelineQueryKey(),
    queryFn: () =>
      customFetch<{ inspections: PipelineInspection[] }>('/api/pipeline'),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export function useGetLeads(
  options?: Omit<UseQueryOptions<{ leads: PipelineLead[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getLeadsQueryKey(),
    queryFn: () => customFetch<{ leads: PipelineLead[] }>('/api/leads'),
    ...options,
  });
}

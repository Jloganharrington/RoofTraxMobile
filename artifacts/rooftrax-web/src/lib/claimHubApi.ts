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

/** Unified lead row — covers pins (retail/insurance) and inspection claims */
export interface UnifiedLead {
  id: string;
  recordType: 'pin' | 'inspection';
  pipeline: 'retail' | 'insurance' | 'project';
  name: string | null;
  address: string | null;
  phone: string | null;
  damageType: string | null;
  stage: string;
  repName: string | null;
  detailPath: string;
  createdAt: string;
}

/** @deprecated Use UnifiedLead — kept temporarily to avoid type errors during migration */
export type PipelineLead = UnifiedLead;

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
// Report Attestation (Variant B — Task #126)
// ---------------------------------------------------------------------------

export interface ReportAttestationRecord {
  id: string;
  preparerId: string;
  preparedAt: string;
  blobVersionIndex: number;
  attestationBlockKey: 'attestation_block_a' | 'attestation_block_b';
  statementHash: string;
  statementText: string;
}

export type ReportAttestationResult =
  | { attested: true; attestation: ReportAttestationRecord }
  | {
      attested: false;
      reason?: string;
      blobVersionIndex?: number;
      statementText?: string;
      preparerName?: string | null;
      isSameIdentity?: boolean;
    };

export const getReportAttestationQueryKey = (id: string) =>
  ['inspection', id, 'report-attestation'] as const;

export function useGetReportAttestation(
  inspectionId: string,
  options?: Omit<UseQueryOptions<ReportAttestationResult>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getReportAttestationQueryKey(inspectionId),
    queryFn: () =>
      customFetch<ReportAttestationResult>(
        `/api/inspections/${inspectionId}/report-attestation`,
      ),
    enabled: !!inspectionId,
    ...options,
  });
}

export function useAttestReport(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ attested: true; attestation: ReportAttestationRecord }>(
        `/api/inspections/${inspectionId}/report-attestation`,
        {
          method: 'POST',
          body: JSON.stringify({ acknowledged: true }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getReportAttestationQueryKey(inspectionId) });
      qc.invalidateQueries({ queryKey: getGetInspectionQueryKey(inspectionId) });
    },
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
      // A new compile creates a new blob version index — the previous attestation
      // no longer covers the latest version. Invalidate so the UI reflects that
      // re-attestation is required rather than showing the stale "Report Attested" badge.
      qc.invalidateQueries({ queryKey: getReportAttestationQueryKey(inspectionId) });
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
  pinId: string | null;
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
// Leads — full profile type + hooks
// ---------------------------------------------------------------------------

export interface FullLead {
  id: string;
  address: string | null;
  latitude: number;
  longitude: number;
  workflow: 'retail' | 'insurance';
  damageType: string | null;
  photoUrl: string | null;
  doorKnockResult: string | null;
  contactOutcome: string | null;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  pipelineStage: string | null;
  profileStatus: string | null;
  statusNotes: string | null;
  statusLastUpdated: string | null;
  // Owner info
  ownerFirstName: string | null;
  ownerLastName: string | null;
  ownerEmail: string | null;
  owner2FirstName: string | null;
  owner2LastName: string | null;
  notes: string | null;
  // Insurance
  insuranceCarrier: string | null;
  policyNumber: string | null;
  claimNumber: string | null;
  dateOfLoss: string | null;
  inspectionDate: string | null;
  adjusterName: string | null;
  adjusterPhone: string | null;
  adjusterEmail: string | null;
  adjusterMeetingDate: string | null;
  // Financials
  contractAmount: string | null;
  depositAmount: string | null;
  depositDate: string | null;
  depositPaymentMethod: string | null;
  deductibleAmount: string | null;
  rcvAmount: string | null;
  acvAmount: string | null;
  supplementAmount: string | null;
  finalPaymentAmount: string | null;
  // Selections & Scope
  contractScope: string | null;
  squareFootage: string | null;
  roofPitch: string | null;
  measurementVendor: string | null;
  measurementReportUrl: string | null;
  materialBrand: string | null;
  materialColor: string | null;
  materialStyle: string | null;
  // Retail jsonb blob
  retailData: {
    ownerName1?: string;
    ownerName2?: string | null;
    phone?: string | null;
    email?: string | null;
    interestedRoof?: boolean;
    interestedSiding?: boolean;
    interestedWindows?: boolean;
    interestedDoors?: boolean;
    appointmentDate?: string | null;
    notes?: string | null;
  } | null;
  // Property
  nonOwnerOccupied: boolean | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
  // Extended insurance
  mailerSentDate: string | null;
  claimFiledDate: string | null;
  policyHolder: string | null;
  coverageType: string | null;
  approvedRcvAmount: string | null;
  approvedAcvAmount: string | null;
  depreciationAmount: string | null;
  inspectionNotes: string | null;
  // Linked inspection (set for pin leads that have a converted inspection, and always set for ins- leads)
  inspectionId: string | null;
  // Meta
  repName: string | null;
  userId: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export const getLeadQueryKey = (id: string) => ['lead', id] as const;

export function useGetLead(
  leadId: string,
  options?: Omit<UseQueryOptions<{ lead: FullLead }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getLeadQueryKey(leadId),
    queryFn: () => customFetch<{ lead: FullLead }>(`/api/leads/${leadId}`),
    enabled: !!leadId,
    ...options,
  });
}

export function useUpdateLead(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, string | boolean | null>) =>
      customFetch<{ lead: FullLead }>(`/api/leads/${leadId}/profile`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      // Invalidate and re-fetch so inspectionId and other computed fields stay fresh
      qc.invalidateQueries({ queryKey: getLeadQueryKey(leadId) });
      qc.invalidateQueries({ queryKey: getLeadsQueryKey() });
    },
  });
}

// ---------------------------------------------------------------------------
// Retail Pipeline
// ---------------------------------------------------------------------------

export interface RetailLead {
  id: string;
  address: string | null;
  customerName: string | null;
  customerPhone: string | null;
  damageType: string | null;
  doorKnockResult: string | null;
  contactOutcome: string | null;
  workflow: string | null;
  repName: string | null;
  inspectionId: string | null;
  retailStage: string;
  createdAt: string;
}

export const getRetailPipelineQueryKey = () => ['retail-pipeline'] as const;

export function useGetRetailPipeline(
  options?: Omit<UseQueryOptions<{ leads: RetailLead[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getRetailPipelineQueryKey(),
    queryFn: () => customFetch<{ leads: RetailLead[] }>('/api/retail-pipeline'),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Submit claim
// ---------------------------------------------------------------------------

export function useSubmitClaim(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ submission: Record<string, unknown> }>(
        `/api/inspections/${inspectionId}/submission`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetInspectionQueryKey(inspectionId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  id: string;
  address: string | null;
  insuredName: string | null;
  status: string;
}

export function useSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['search', trimmed],
    queryFn: () =>
      customFetch<{ results: SearchResult[] }>(
        `/api/search?q=${encodeURIComponent(trimmed)}`,
      ),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
    placeholderData: { results: [] },
  });
}

export function useGetLeads(
  options?: Omit<UseQueryOptions<{ leads: PipelineLead[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getLeadsQueryKey(),
    queryFn: () => customFetch<{ leads: PipelineLead[] }>('/api/leads'),
    ...options,
  });
}

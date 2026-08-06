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

export interface ClaimSectionLintFinding {
  ruleId: string;
  fragmentRef: string;
  matchedText: string;
  severity: 'blocked' | 'needs_review';
}

export interface ClaimSection {
  sectionType: SectionType;
  state: SectionState;
  content?: string | null;
  gateFlags?: Record<string, unknown> | null;
  lintStatus?: string | null;
  lintFindings?: ClaimSectionLintFinding[] | null;
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
  isDemo: boolean;
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

export interface IicrcCitationFill {
  citationText: string;
  locator: string;
}

/** Submit filled IICRC citation text + locator for placeholder tokens in a
 *  generated section. Clears `iicrc_citation_unfilled` lint findings server-side,
 *  which unblocks the approve route. */
export function useFillIicrcCitations(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sectionType,
      citations,
    }: {
      sectionType: SectionType;
      citations: Record<string, IicrcCitationFill>;
    }) =>
      customFetch<{ filledCount: number; remainingUnfilled: string[] }>(
        `/api/inspections/${inspectionId}/sections/${sectionType}/fill-iicrc-citations`,
        {
          method: 'PATCH',
          body: JSON.stringify({ citations }),
        },
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
  /** Pin pipeline stage key — present for pin-based leads */
  stageKey: string | null;
  /** ISO timestamp when the pin entered its current stage */
  stageEnteredAt: string | null;
  /** ISO timestamp for next loop action (supplement/dispute next action, scheduled inspections) */
  loopNextActionAt: string | null;
  /** Source pipeline when this lead converges (e.g. 'insurance' on pm_handoff) */
  sourcePipeline: string | null;
  isDemo: boolean;
  needsStageReview: boolean;
}

// ---------------------------------------------------------------------------
// Sample Proof Package
// ---------------------------------------------------------------------------

export interface SamplePackageInfo {
  pinId: string | null;
  inspectionId: string | null;
}

export const getSamplePackageInfoQueryKey = () => ['sample-package', 'info'] as const;

export function useGetSamplePackageInfo() {
  return useQuery({
    queryKey: getSamplePackageInfoQueryKey(),
    queryFn: () => customFetch<SamplePackageInfo>('/api/sample-package/info'),
    staleTime: 5 * 60 * 1000, // 5 min — rarely changes
  });
}

export function useProvisionSamplePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => customFetch<SamplePackageInfo>('/api/sample-package/provision', { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(getSamplePackageInfoQueryKey(), data);
    },
  });
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
// Project Pipeline
// ---------------------------------------------------------------------------

export interface ProjectPipelineLead {
  id: string;
  address: string | null;
  pipelineStage: string;
  /** 'retail' | 'insurance' — which pipeline the lead converged from */
  sourcePipeline: string | null;
  /** ISO timestamp when the lead entered its current pipelineStage */
  stageEnteredAt: string | null;
  loopNextActionAt: string | null;
  /**
   * ISO timestamp when the lead first entered pm_handoff.
   * Used to compute the 21-day CFR supplement clock for insurance-sourced leads.
   */
  pmHandoffAt: string | null;
  damageType: string | null;
  customerName: string | null;
  repName: string | null;
  createdAt: string;
  isDemo: boolean;
  needsStageReview: boolean;
}

export const getProjectPipelineQueryKey = () => ['project-pipeline'] as const;

export function useGetProjectPipeline(
  options?: Omit<UseQueryOptions<{ leads: ProjectPipelineLead[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getProjectPipelineQueryKey(),
    queryFn: () => customFetch<{ leads: ProjectPipelineLead[] }>('/api/project-pipeline'),
    ...options,
  });
}

export function useAdvanceProjectStage(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdvanceStagePayload) =>
      customFetch<{ lead: FullLead }>(`/api/leads/${leadId}/advance-stage`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getProjectPipelineQueryKey() });
      qc.invalidateQueries({ queryKey: getLeadQueryKey(leadId) });
    },
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
  // Pipeline tracking
  stageEnteredAt:   string | null;
  loopNextActionAt: string | null;
  lossReason:       string | null;
  sourcePipeline:   string | null;
  // Linked inspection (set for pin leads that have a converted inspection, and always set for ins- leads)
  inspectionId: string | null;
  // AHJ jurisdiction check — populated non-blocking after FIPSA signing
  ahjCheck: {
    jurisdiction: string;
    packPresent: boolean;
    checkedAt: string;
    model: string;
    confidence: 'high' | 'medium' | 'low';
    summary: string;
  } | null;
  // Lead sourcing & file handler
  externalLeadSource: string | null;
  projectManagerName: string | null;
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

export interface AdvanceStagePayload {
  toStage: string;
  trigger: 'task' | 'auto_event' | 'manual_move';
  taskPayload?: Record<string, unknown>;
  lossReason?: string;
  /** ISO datetime for loop-stage next-action due date */
  loopNextActionAt?: string;
}

/**
 * Insurance-pipeline-specific advance hook.
 * Calls PATCH /api/leads/:leadId/advance-stage and invalidates the pipeline
 * query so the kanban board refreshes immediately.
 */
export function useAdvanceInsuranceStage(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdvanceStagePayload) =>
      customFetch<{ lead: FullLead }>(`/api/leads/${leadId}/advance-stage`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getPipelineQueryKey() });
    },
  });
}
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
  /** Canonical stage key from the DB pipelineStage column */
  stageKey: string;
  /** Backwards-compat alias for stageKey */
  retailStage: string;
  stageEnteredAt: string | null;
  loopNextActionAt: string | null;
  lossReason: string | null;
  isDemo: boolean;
  needsStageReview: boolean;
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
// Submit / Deliver claim
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
      qc.invalidateQueries({ queryKey: getEventsQueryKey(inspectionId) });
    },
  });
}

// Alias used by the new Deliver step — same endpoint, same behaviour.
export const useDeliverPackage = useSubmitClaim;

// ---------------------------------------------------------------------------
// Record a UI-triggered claim event (e.g. field_record_reviewed)
// ---------------------------------------------------------------------------

export function useRecordClaimEvent(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventType, payload }: { eventType: string; payload?: Record<string, unknown> }) =>
      customFetch<{ event: ClaimEvent }>(
        `/api/inspections/${inspectionId}/events`,
        {
          method: 'POST',
          body: JSON.stringify({ eventType, payload }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getEventsQueryKey(inspectionId) });
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

// ---------------------------------------------------------------------------
// Current user profile (role gating)
// ---------------------------------------------------------------------------

export interface MyProfile {
  userId: string;

  role: string;

  department: string | null;

  companyId: string;

  companyLogoUrl?: string | null;

  betaBugReporting?: boolean;
  // Wave-2B personal profile fields

  firstName?: string | null;

  lastName?: string | null;

  email?: string | null;

  profileImageUrl?: string | null;

  phone?: string | null;

  workflowAssignment?: string | null;

  signatureSignedAt?: string | null;

  smtpConfigured?: boolean;

  smtpHost?: string | null;

  smtpPort?: number | null;

  smtpSecure?: boolean | null;

  smtpUsername?: string | null;

  smtpFromEmail?: string | null;
}

export const getMyProfileQueryKey = () => ['my-profile'] as const;

export function useGetMyProfile(
  options?: Omit<UseQueryOptions<{ profile: MyProfile }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getMyProfileQueryKey(),
    queryFn: () => customFetch<{ profile: MyProfile }>('/api/profile'),
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// AHJ re-check
// ---------------------------------------------------------------------------

export interface AhjCheckResult {
  jurisdiction: string;
  packPresent: boolean;
  checkedAt: string;
  model: string;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
}

// ---------------------------------------------------------------------------
// Lead Files
// ---------------------------------------------------------------------------

export const LEAD_FILE_CATEGORIES = [
  'site_photos',
  'contracts',
  'estimates',
  'insurance_documents',
  'measurement_reports',
  'permits',
  'correspondence',
  'general',
] as const;

export type LeadFileCategory = (typeof LEAD_FILE_CATEGORIES)[number];

export interface LeadFileRow {
  id: string;
  leadId: string;
  userId: string;
  objectPath: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  category: LeadFileCategory;
  uploaderName: string;
  createdAt: string;
  updatedAt: string;
}

export const getLeadFilesQueryKey = (leadId: string) =>
  ['lead', leadId, 'files'] as const;

export function useGetLeadFiles(
  leadId: string,
  options?: Omit<UseQueryOptions<{ files: LeadFileRow[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getLeadFilesQueryKey(leadId),
    queryFn: () => customFetch<{ files: LeadFileRow[] }>(`/api/leads/${leadId}/files`),
    enabled: !!leadId,
    ...options,
  });
}

export function useRegisterLeadFile(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      objectPath: string;
      fileName: string;
      originalName: string;
      fileSize: number;
      mimeType: string;
      category: LeadFileCategory;
    }) =>
      customFetch<{ file: LeadFileRow }>(`/api/leads/${leadId}/files`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: getLeadFilesQueryKey(leadId) }),
  });
}

export function useRenameLeadFile(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, fileName }: { fileId: string; fileName: string }) =>
      customFetch<{ file: LeadFileRow }>(`/api/leads/${leadId}/files/${fileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fileName }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: getLeadFilesQueryKey(leadId) }),
  });
}

export function useDeleteLeadFile(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) =>
      customFetch<{ deleted: boolean }>(`/api/leads/${leadId}/files/${fileId}`, {
        method: 'DELETE',
      }),
    onMutate: async (fileId: string) => {
      await qc.cancelQueries({ queryKey: getLeadFilesQueryKey(leadId) });
      const prev = qc.getQueryData<{ files: LeadFileRow[] }>(getLeadFilesQueryKey(leadId));
      qc.setQueryData(
        getLeadFilesQueryKey(leadId),
        (old: { files: LeadFileRow[] } | undefined) =>
          old ? { files: old.files.filter((f) => f.id !== fileId) } : old,
      );
      return { prev };
    },
    onError: (_err, _fileId, context) => {
      if (context?.prev) qc.setQueryData(getLeadFilesQueryKey(leadId), context.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: getLeadFilesQueryKey(leadId) }),
  });
}

export function useRecheckAhj(inspectionId: string, leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ ahjCheck: AhjCheckResult | null }>(
        `/api/inspections/${inspectionId}/ahj-check`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getLeadQueryKey(leadId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Lead Sources — company-level configurable non-canvassing source list
// ---------------------------------------------------------------------------

export const DEFAULT_LEAD_SOURCES = ["Angi's", 'Yelp', 'Call-In', 'Website'] as const;

const getLeadSourcesQueryKey = (companyId: string) =>
  ['lead-sources', companyId] as const;

export function useGetLeadSources(
  companyId: string,
  options?: Omit<UseQueryOptions<{ leadSources: string[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getLeadSourcesQueryKey(companyId),
    queryFn: () =>
      customFetch<{ leadSources: string[] }>(
        `/api/companies/${companyId}/lead-sources`,
      ),
    enabled: !!companyId,
    ...options,
  });
}

export function useUpdateLeadSources(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadSources: string[]) =>
      customFetch<{ leadSources: string[] }>(
        `/api/companies/${companyId}/lead-sources`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadSources }),
        },
      ),
    onSuccess: (data) => {
      qc.setQueryData(getLeadSourcesQueryKey(companyId), data);
    },
  });
}

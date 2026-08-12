import { getGetMyProfileQueryKey, useGetMyProfile } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';

/**
 * Wraps the generated `/profile/me` query, only enabled once the user is
 * authenticated. Returns the field rep's role + workflow assignment, which
 * drives tab visibility and the pin-creation workflow picker.
 */
export function useProfile() {
  const { isAuthenticated } = useAuth();
  const query = useGetMyProfile({
    query: { enabled: isAuthenticated, queryKey: getGetMyProfileQueryKey() },
  });

  return {
    profile: query.data?.profile,
    isLoading: isAuthenticated ? query.isLoading : false,
    role: query.data?.profile.role ?? 'field_rep',
    workflowAssignment: query.data?.profile.workflowAssignment ?? 'insurance_retail',
    department: query.data?.profile.department ?? 'canvasser',
    companyId: query.data?.profile.companyId,
    companyName: query.data?.profile.companyName,
    companyLogoUrl: query.data?.profile.companyLogoUrl ?? null,
    contractorLegalName: query.data?.profile.contractorLegalName ?? null,
    contractorAddress: query.data?.profile.contractorAddress ?? null,
    fipsaFeeCents: query.data?.profile.fipsaFeeCents ?? null,
    // M-F (F0) — signature-on-file. Null until the inspector captures one.
    signatureUrl: query.data?.profile.signatureUrl ?? null,
    signatureSha256: query.data?.profile.signatureSha256 ?? null,
    signatureSignedAt: query.data?.profile.signatureSignedAt ?? null,
    // Beta instrument gate (company flag): shows/hides the bug-report button.
    betaBugReporting: query.data?.profile.betaBugReporting ?? false,
    // Company product tier — 'pp_only' for PP-only subscribers, 'crm' otherwise.
    // Used to gate CRM-only screens (pipeline board, leads list, etc.) in mobile.
    companyPpTier: query.data?.profile.companyPpTier ?? 'crm',
    refetch: query.refetch,
  };
}

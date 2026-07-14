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
    refetch: query.refetch,
  };
}

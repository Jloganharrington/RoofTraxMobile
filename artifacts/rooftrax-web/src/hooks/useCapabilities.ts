import { useMemo } from 'react';
import { resolveCapabilities, type Capability } from '@workspace/authz';
import { useGetMyProfile } from '@workspace/api-client-react';
import type { WorkflowAssignment, Department, Role } from '@workspace/authz';

/**
 * Resolves the current user's capability set from the live permission registry.
 * Capabilities are computed from role + department + workflowAssignment so they
 * automatically stay in sync whenever the registry is updated — no manual
 * role-string comparisons needed in component code.
 *
 * Usage:
 *   const { can, loading } = useCapabilities();
 *   if (!can('invoice.create')) return null;
 */
export function useCapabilities() {
  const { data: profileData, isLoading } = useGetMyProfile();
  const profile = profileData?.profile;

  const caps = useMemo(() => {
    if (!profile) return new Set<Capability>();
    return resolveCapabilities({
      role:       (profile.role ?? 'field_rep')              as Role,
      department: (profile.department ?? 'canvasser')        as Department,
      workflow:   (profile.workflowAssignment ?? 'retail')   as WorkflowAssignment,
    });
  }, [profile?.role, profile?.department, profile?.workflowAssignment]);

  return {
    caps,
    /** Returns true when the current user's capability set includes `key`. */
    can: (key: Capability): boolean => caps.has(key),
    loading: isLoading,
  };
}

import { useMemo } from 'react';
import { resolveCapabilities, type Capability } from '@workspace/authz';
import type { WorkflowAssignment, Department, Role } from '@workspace/authz';
import { useProfile } from './useProfile';

/**
 * Resolves the current user's capability set from the live permission registry.
 * Capabilities are computed from role + department + workflowAssignment so they
 * automatically stay in sync whenever the registry is updated — no manual
 * role-string comparisons needed in screen/component code.
 *
 * Usage:
 *   const { can } = useCapabilities();
 *   if (!can('inspection.manage')) return null;
 */
export function useCapabilities() {
  const { role, department, workflowAssignment, isLoading } = useProfile();

  const caps = useMemo(() => {
    return resolveCapabilities({
      role:       (role              ?? 'field_rep') as Role,
      department: (department        ?? 'canvasser') as Department,
      workflow:   (workflowAssignment ?? 'retail')   as WorkflowAssignment,
    });
  }, [role, department, workflowAssignment]);

  return {
    caps,
    /** Returns true when the current user's capability set includes `key`. */
    can: (key: Capability): boolean => caps.has(key),
    loading: isLoading,
  };
}

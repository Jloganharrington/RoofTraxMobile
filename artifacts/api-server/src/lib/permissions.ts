import type { Role } from '@workspace/db';

// Role-hierarchy rules for managing team members:
// - Nobody can change their own role.
// - Admins can manage everyone (except their own role).
// - Managers can only manage field reps; they cannot touch other managers or
//   admins, and cannot promote anyone to manager/admin.
// - Field reps cannot manage anyone.
export function canManageUser(
  actorRole: Role,
  actorId: string,
  targetId: string,
  targetRole: Role,
  nextRole?: Role,
): boolean {
  if (actorId === targetId) return false;
  if (actorRole === 'field_rep') return false;

  if (actorRole === 'admin') return true;

  // actorRole === "manager"
  if (targetRole !== 'field_rep') return false;
  if (nextRole && nextRole !== 'field_rep') return false;
  return true;
}

export function isManagerOrAdmin(role: Role): boolean {
  return role === 'manager' || role === 'admin';
}

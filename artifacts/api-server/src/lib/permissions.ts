import type { Department, Role } from '@workspace/db';

// Strict role hierarchy, ranked low to high. All access decisions below are
// rank comparisons within the same company (company scoping is enforced by
// the caller before these run) — there is no separate "reporting tree";
// outranking someone is sufficient regardless of who manages whom.
const ROLE_RANK: Record<Role, number> = {
  field_rep: 0,
  manager: 1,
  admin: 2,
  super_admin: 3,
};

export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}

export function isManagerOrAdmin(role: Role): boolean {
  return roleRank(role) >= ROLE_RANK.manager;
}

// True once the actor strictly outranks the target's current role, and (if
// assigning a new role) strictly outranks the role being assigned too — you
// can never promote someone to your own rank or above.
function actorOutranks(actorRole: Role, targetRole: Role, nextRole?: Role): boolean {
  if (roleRank(actorRole) <= roleRank(targetRole)) return false;
  if (nextRole && roleRank(actorRole) <= roleRank(nextRole)) return false;
  return true;
}

// Role-hierarchy rules for managing team members:
// - Nobody can change their own role.
// - An actor may only act on someone who ranks strictly below them, and may
//   only assign a role that ranks strictly below them.
// - super_admin outranks admin, which outranks manager, which outranks
//   field_rep.
export function canManageUser(
  actorRole: Role,
  actorId: string,
  targetId: string,
  targetRole: Role,
  nextRole?: Role,
): boolean {
  if (actorId === targetId) return false;
  return actorOutranks(actorRole, targetRole, nextRole);
}

// Governs a combined admin edit to a teammate's role, department, and (in a
// later phase) specialization. Department has no rank of its own — same
// outranking rule as role gates whether the actor may touch this teammate
// at all.
export function canSetRoleDeptSpec(
  actorRole: Role,
  actorId: string,
  targetId: string,
  targetRole: Role,
  next?: { role?: Role },
): boolean {
  if (actorId === targetId) return false;
  return actorOutranks(actorRole, targetRole, next?.role);
}

// Pin edit rules: owners may edit their own pins; managers and above may
// edit anyone's pin in their company.
export function canEditPin(actorRole: Role, actorId: string, pinOwnerId: string): boolean {
  return actorId === pinOwnerId || isManagerOrAdmin(actorRole);
}

// Pin delete is stricter than edit: field reps may add and edit their own
// pins, but only managers and above may delete a pin — including their own.
export function canDeletePin(actorRole: Role): boolean {
  return isManagerOrAdmin(actorRole);
}

// Inspection write rules mirror pin edits: the inspection's owner (the
// assigned inspector) may mutate it, and managers and above may mutate any
// inspection in their company. Company scoping is enforced by the caller
// before this runs. A null owner (legacy/unassigned inspection) falls through
// to the manager-only branch, so a peer field rep can never claim it.
export function canWriteInspection(
  actorRole: Role,
  actorId: string,
  inspectorUserId: string | null,
): boolean {
  return actorId === inspectorUserId || isManagerOrAdmin(actorRole);
}

// Workflow (Insurance+Retail/Retail) assignment rules:
// - Admins and super_admins can set anyone's workflow assignment, including
//   their own.
// - Managers can only set field reps' workflow assignment, never their own
//   or another manager's/admin's.
// - Field reps cannot set anyone's workflow assignment.
export function canSetWorkflow(
  actorRole: Role,
  actorId: string,
  targetId: string,
  targetRole: Role,
): boolean {
  if (roleRank(actorRole) >= ROLE_RANK.admin) return true;

  if (actorRole === 'manager') {
    if (actorId === targetId) return false;
    return targetRole === 'field_rep';
  }

  return false;
}

// Gates the (future) forensic inspection module: inspector_canvasser is the
// department built for it, and super_admin can always reach every module
// regardless of department. This phase only stores/gates the assignment —
// the module's actual content ships in a later phase.
export function canAccessInspectionModule(role: Role, department: Department): boolean {
  return department === 'inspector_canvasser' || role === 'super_admin';
}

/**
 * lib/authz/src/resolver.ts
 *
 * Unified permission resolver.  Given a `Permission` key and a `ResolveContext`
 * describing the actor, returns `{ allowed, reason }`.
 *
 * ─── Design notes ────────────────────────────────────────────────────────────
 *
 * • This file is the single entry point for every access decision.
 *   Route middleware, settings UI, and per-user overrides (Step 5) all call
 *   `resolve()` — no other place should re-implement role comparisons.
 *
 * • `resolveResolution()` is exported for unit-testing synthetic resolution
 *   kinds that are not yet used in the registry (floor, selfOnly, department,
 *   workflow) and for the per-user override layer (Step 5), which builds a
 *   modified `DefaultResolution` before calling back into this function.
 *
 * • The role ordering is strict: field_rep < manager < admin < super_admin.
 *   Higher-ranked roles inherit all lower-rank allowances automatically.
 *
 * • `coc.sign` has a department shortcut: any non-null-role member in the
 *   "office" department may sign regardless of ownership.  This matches the
 *   legacy `canSignCompletionCertificate()` helper and is documented in the
 *   registry entry's note field.
 */

import type { Department, Role, WorkflowAssignment } from './vocabulary';
import { PERMISSION_MAP } from './registry';
import type { DefaultResolution, Permission } from './registry';

// ── Role ordering ─────────────────────────────────────────────────────────────

const ROLE_RANK: Readonly<Record<Role, number>> = {
  field_rep:   0,
  manager:     1,
  admin:       2,
  super_admin: 3,
};

/** True when `role` is at least as permissive as `minRole`. */
function roleAtLeast(role: Role | null, minRole: Role): boolean {
  if (role === null) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Actor descriptor passed to every resolve call.
 *
 * For `ownerOrRole` and `selfOnly` permissions, provide `ownerId` (the user ID
 * that owns the resource being acted upon).  Omitting it is treated
 * conservatively: the owner check fails, and resolution falls through to the
 * role gate.
 */
export interface ResolveContext {
  /** Actor's role. Null for unauthenticated users or users without a profile row. */
  role: Role | null;
  /** The actor's own user ID. */
  actorId: string;
  /** Resource owner's user ID — required for `ownerOrRole` and `selfOnly`. */
  ownerId?: string | null;
  /** Actor's department — consulted by `department` kind and the `coc.sign` shortcut. */
  department?: Department | null;
  /** Actor's workflow assignment — consulted by `workflow` kind. */
  workflowAssignment?: WorkflowAssignment | null;
}

export interface ResolveResult {
  allowed: boolean;
  /** Human-readable explanation for debug logs, audit trails, and settings UI tooltips. */
  reason: string;
}

// ── Core resolution logic ─────────────────────────────────────────────────────

/**
 * Resolve a `DefaultResolution` + context directly.
 *
 * Exported so that:
 *  – Unit tests can exercise synthetic resolution kinds that are not yet in the
 *    registry (floor, selfOnly, department, workflow).
 *  – Step 5 override logic can mutate the resolution before calling back here.
 *
 * For production code, prefer `resolve(permission, ctx)` which looks up the
 * resolution from the registry automatically.
 */
export function resolveResolution(
  res:        DefaultResolution,
  permission: Permission,
  ctx:        ResolveContext,
): ResolveResult {
  switch (res.kind) {
    // ── minRole ────────────────────────────────────────────────────────────
    case 'minRole': {
      if (roleAtLeast(ctx.role, res.minRole)) {
        return {
          allowed: true,
          reason:  `role '${ctx.role}' ≥ minRole '${res.minRole}'`,
        };
      }
      return {
        allowed: false,
        reason:  `role '${ctx.role ?? '(none)'}' is below minRole '${res.minRole}'`,
      };
    }

    // ── ownerOrRole ────────────────────────────────────────────────────────
    case 'ownerOrRole': {
      // coc.sign shortcut: office-department members may sign regardless of
      // ownership, matching the legacy canSignCompletionCertificate() check.
      if (permission === 'coc.sign' && ctx.department === 'office' && ctx.role !== null) {
        return {
          allowed: true,
          reason:  `coc.sign: office-department shortcut (department='office', role='${ctx.role}')`,
        };
      }

      const isOwner =
        ctx.ownerId !== undefined &&
        ctx.ownerId !== null &&
        ctx.ownerId === ctx.actorId;

      if (isOwner) {
        return { allowed: true, reason: `actor is the resource owner` };
      }
      if (roleAtLeast(ctx.role, res.minRole)) {
        return {
          allowed: true,
          reason:  `not owner; role '${ctx.role}' ≥ minRole '${res.minRole}'`,
        };
      }
      return {
        allowed: false,
        reason:
          `not owner, and role '${ctx.role ?? '(none)'}' is below minRole '${res.minRole}'`,
      };
    }

    // ── selfOnly ───────────────────────────────────────────────────────────
    case 'selfOnly': {
      const isSelf =
        ctx.ownerId !== undefined &&
        ctx.ownerId !== null &&
        ctx.ownerId === ctx.actorId;

      return isSelf
        ? { allowed: true,  reason: `selfOnly: actor is the subject` }
        : { allowed: false, reason: `selfOnly: actor '${ctx.actorId}' ≠ subject '${ctx.ownerId ?? '(none)'}'` };
    }

    // ── floor ──────────────────────────────────────────────────────────────
    case 'floor': {
      return {
        allowed: false,
        reason:  `'${permission}' is a system-internal permission; it cannot be granted`,
      };
    }

    // ── department ─────────────────────────────────────────────────────────
    case 'department': {
      if (
        ctx.department !== undefined &&
        ctx.department !== null &&
        (res.departments as readonly string[]).includes(ctx.department)
      ) {
        return {
          allowed: true,
          reason:  `department '${ctx.department}' is in allowed set [${res.departments.join(', ')}]`,
        };
      }
      return {
        allowed: false,
        reason:  `department '${ctx.department ?? '(none)'}' not in allowed set [${res.departments.join(', ')}]`,
      };
    }

    // ── workflow ───────────────────────────────────────────────────────────
    case 'workflow': {
      if (
        ctx.workflowAssignment !== undefined &&
        ctx.workflowAssignment !== null &&
        (res.workflows as readonly string[]).includes(ctx.workflowAssignment)
      ) {
        return {
          allowed: true,
          reason:  `workflow '${ctx.workflowAssignment}' is in allowed set [${res.workflows.join(', ')}]`,
        };
      }
      return {
        allowed: false,
        reason:  `workflow '${ctx.workflowAssignment ?? '(none)'}' not in allowed set [${res.workflows.join(', ')}]`,
      };
    }
  }
}

/**
 * Primary entry point.  Resolves `permission` for an actor described by `ctx`.
 *
 * ```ts
 * const { allowed } = resolve('profitability.view', { role, actorId });
 * if (!allowed) return res.status(403).json({ error: 'Forbidden' });
 * ```
 */
export function resolve(permission: Permission, ctx: ResolveContext): ResolveResult {
  const entry = PERMISSION_MAP[permission];
  return resolveResolution(entry.default, permission, ctx);
}

/** Convenience wrapper — returns only the boolean. */
export function can(permission: Permission, ctx: ResolveContext): boolean {
  return resolve(permission, ctx).allowed;
}

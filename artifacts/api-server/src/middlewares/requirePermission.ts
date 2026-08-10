/**
 * requirePermission.ts
 *
 * Shared middleware factory and actor-context loader for the permission system.
 *
 * Usage (minRole-type routes — no resource ownership needed):
 *   router.post('/some-route', requirePermission('lead.create'), handler);
 *
 * Usage (ownerOrRole routes — check inside handler after fetching the resource):
 *   const ctx = await loadActorCtx(req);
 *   if (!ctx) return void res.status(401).json({ error: 'Unauthorized' });
 *   const { allowed, reason } = resolve('lead.update', { ...ctx, ownerId: lead.repUserId });
 *   if (!allowed) return void res.status(403).json({ error: reason });
 *
 * The middleware also sets req.actorCtx so handlers can skip a second DB round-trip
 * when they only need role/department for non-ownership decisions.
 */

import { resolve, type Permission, type ResolveContext } from '@workspace/authz';
import type { Role } from '@workspace/authz';
import { db } from '@workspace/db';
import { userProfilesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ── Actor context ─────────────────────────────────────────────────────────────

export interface ActorCtx extends Omit<ResolveContext, 'role'> {
  /**
   * Always non-null. Defaults to 'field_rep' when the user has no profile row,
   * matching the convention used by every route-local guard in the codebase.
   */
  role: Role;
  /** Drizzle-safe company scope for tenant isolation. */
  companyId: string;
}

// Augment Express Request so handlers can read actorCtx without a second DB hit.
declare global {
  namespace Express {
    interface Request {
      actorCtx?: ActorCtx;
    }
  }
}

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Load role + department for the current authenticated actor.
 * Returns null if the request is unauthenticated or the session has no user row.
 * Does NOT send a response — callers decide how to handle null.
 */
export async function loadActorCtx(req: Request): Promise<ActorCtx | null> {
  if (!req.isAuthenticated()) return null;
  const { id: actorId, companyId } = req.user;
  const rows = await db
    .select({
      role:       userProfilesTable.role,
      department: userProfilesTable.department,
    })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, actorId));
  const profile = rows[0];
  return {
    actorId,
    companyId,
    role:               (profile?.role ?? 'field_rep') as Role,
    department:         (profile?.department ?? null) as ActorCtx['department'],
    workflowAssignment: null,
    // ownerId is intentionally absent here — handlers supply it when checking
    // ownerOrRole permissions against a fetched resource.
  };
}

// ── Middleware factory ─────────────────────────────────────────────────────────

/**
 * Express middleware for permissions where ownership is irrelevant (minRole kind).
 * Also works for ownerOrRole permissions used on collection endpoints where
 * "no resource to check ownership against" effectively enforces the role gate.
 *
 * On success: sets req.actorCtx and calls next().
 * On failure: sends 401 (unauthenticated) or 403 (insufficient role) and returns.
 */
export function requirePermission(permission: Permission): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const ctx = await loadActorCtx(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { allowed, reason } = resolve(permission, ctx);
    if (!allowed) {
      res.status(403).json({ error: reason });
      return;
    }
    req.actorCtx = ctx;
    next();
  };
}

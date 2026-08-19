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
 *
 * Step 5 — per-user override layer:
 *   requirePermission() checks the user_permission_overrides table before falling
 *   through to the registry default. All overrides for the current user are loaded
 *   once per request and cached on req.permissionOverrides (lazy, on first call).
 *   loadPermissionOverrides() is exported for use in routes that need to inspect
 *   overrides directly (e.g. the GET /team/users/:userId/permissions endpoint).
 */

import { resolve, type Permission, type ResolveContext } from '@workspace/authz';
import type { Role } from '@workspace/authz';
import {
  companiesTable,
  db,
  rolePermissionOverridesTable,
  userPermissionOverridesTable,
  userProfilesTable,
} from '@workspace/db';
import { and, eq } from 'drizzle-orm';
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
  /**
   * 'pp_only' for PP self-serve companies; 'crm' for all others.
   * Used to block crm.* permissions for companies that are Proof-Package-only.
   */
  ppTier: string;
  /**
   * Active CRM subscription tier. 'none' means no active subscription.
   * CRM companies with 'none' are blocked from CRM routes with a 402.
   * Values: 'none' | 'solo' | 'crew' | 'team' | 'fleet' | 'regional'
   */
  subscriptionLevel: string;
  /**
   * Tenant-specific policy overrides for this actor's preset role. Loaded once
   * with the actor context so all authorization paths see the same policy.
   */
  rolePermissionOverrides: Map<string, boolean>;
  /**
   * @deprecated Backward-compat alias for `actorId`. Kept so inspection handler
   * bodies using `actor.userId` continue to work during the write-route migration
   * without requiring a mass rename. Remove once the migration is complete.
   */
  userId: string;
}

// Augment Express Request so handlers can read actorCtx and the override cache
// without a second DB hit.
declare global {
  namespace Express {
    interface Request {
      actorCtx?: ActorCtx;
      /**
       * Lazy cache of per-user permission overrides for this request.
       * Populated on first call to loadPermissionOverrides(); undefined means
       * not yet loaded (distinct from an empty Map = loaded, no overrides).
       */
      permissionOverrides?: Map<string, boolean>;
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
  const [profileRow, companyRow] = await Promise.all([
    db
      .select({
        role: userProfilesTable.role,
        department: userProfilesTable.department,
        workflowAssignment: userProfilesTable.workflowAssignment,
      })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, actorId))
      .then(rows => rows[0]),
    db
      .select({ ppTier: companiesTable.ppTier, subscriptionLevel: companiesTable.subscriptionLevel })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .then(rows => rows[0]),
  ]);
  const role = (profileRow?.role ?? 'field_rep') as Role;
  const roleOverrideRows = await db
    .select({
      permission: rolePermissionOverridesTable.permission,
      granted: rolePermissionOverridesTable.granted,
    })
    .from(rolePermissionOverridesTable)
    .where(and(
      eq(rolePermissionOverridesTable.companyId, companyId),
      eq(rolePermissionOverridesTable.role, role),
    ));

  const ctx: ActorCtx = {
    actorId,
    companyId,
    role,
    department:         (profileRow?.department ?? null) as ActorCtx['department'],
    workflowAssignment: (profileRow?.workflowAssignment ?? null) as ActorCtx['workflowAssignment'],
    ppTier:             companyRow?.ppTier ?? 'crm',
    subscriptionLevel:  companyRow?.subscriptionLevel ?? 'none',
    rolePermissionOverrides: new Map(roleOverrideRows.map(row => [row.permission, row.granted])),
    // ownerId is intentionally absent here — handlers supply it when checking
    // ownerOrRole permissions against a fetched resource.
    userId: actorId, // @deprecated alias — remove after write-route migration is complete
  };
  // Also stamp req.actorCtx so Pattern-B handlers (which call loadActorCtx
  // directly without going through the middleware) can use req.actorCtx!.* in
  // nested callbacks (e.g. notify(), audit inserts) alongside the local variable.
  req.actorCtx = ctx;
  return ctx;
}

// ── Override cache ────────────────────────────────────────────────────────────

/**
 * Load all permission overrides for the current actor into a Map keyed by
 * permission string.  Results are cached on req.permissionOverrides for the
 * lifetime of the request so multiple requirePermission() calls only hit the
 * DB once.
 *
 * Exported so that GET /team/users/:userId/permissions can inspect overrides
 * for a target user by calling it with a synthetic req object.  In normal
 * middleware usage, call with the live req.
 */
export async function loadPermissionOverrides(
  req: Request,
  userId: string,
  companyId: string,
): Promise<Map<string, boolean>> {
  // Return cached result if already populated for this request.
  if (req.permissionOverrides !== undefined) {
    return req.permissionOverrides;
  }
  const rows = await db
    .select({
      permission: userPermissionOverridesTable.permission,
      granted:    userPermissionOverridesTable.granted,
    })
    .from(userPermissionOverridesTable)
    .where(
      and(
        eq(userPermissionOverridesTable.companyId, companyId),
        eq(userPermissionOverridesTable.userId, userId),
      ),
    );
  const map = new Map<string, boolean>(rows.map(r => [r.permission, r.granted]));
  req.permissionOverrides = map;
  return map;
}

// ── Owner-aware resolver (includes Step 5 override layer) ─────────────────────

/**
 * Resolve a permission for an already-loaded actor, applying the per-user
 * override layer (Step 5) before falling through to the registry default.
 *
 * Use this in ownerOrRole route handlers instead of calling `resolve()` directly.
 * It guarantees that an explicit grant or revoke is honoured regardless of the
 * actor's role or ownership status.
 *
 *   const { allowed } = await resolveWithOverrides(req, 'invoice.read', actorCtx, pin.userId);
 *   if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return; }
 *
 * @param req        - Live Express request (used to read / populate the override cache).
 * @param permission - The permission key to check.
 * @param ctx        - Actor context produced by loadActorCtx().
 * @param ownerId    - userId of the resource owner; undefined for collection routes
 *                     where ownership is not applicable.
 */
export async function resolveWithOverrides(
  req: Request,
  permission: Permission,
  ctx: ActorCtx,
  ownerId: string | undefined,
): Promise<{ allowed: boolean; reason?: string }> {
  // PP-only companies cannot access field-sales CRM domains regardless of grants.
  if (ctx.ppTier === 'pp_only') {
    const domain = (permission as string).split('.')[0];
    if (['crm', 'lead', 'canvassing', 'pipeline'].includes(domain)) {
      return { allowed: false, reason: `The '${domain}' feature is not available on the Proof Package plan.` };
    }
  }

  // Subscription gate — mirrors the check in requirePermission(). CRM companies
  // with no active subscription cannot access any permission-gated route.
  if (ctx.ppTier === 'crm' && ctx.subscriptionLevel === 'none') {
    return { allowed: false, reason: 'no_subscription' };
  }

  const overrides = await loadPermissionOverrides(req, ctx.actorId, ctx.companyId);
  const override = overrides.get(permission);
  if (override !== undefined) {
    if (!override) {
      return {
        allowed: false,
        reason: `Permission '${permission}' has been explicitly revoked for your account.`,
      };
    }
    // Explicit grant — bypass registry default (owner check irrelevant).
    return { allowed: true };
  }
  const roleOverride = ctx.rolePermissionOverrides.get(permission);
  if (roleOverride !== undefined) {
    return roleOverride
      ? { allowed: true }
      : {
          allowed: false,
          reason: `Permission '${permission}' has been revoked for the '${ctx.role}' role at your company.`,
        };
  }
  // Registry default — pass ownerId so ownerOrRole entries can short-circuit.
  return resolve(permission, { ...ctx, ownerId });
}

// ── Sync owner-aware resolver with subscription gate ──────────────────────────

/**
 * Synchronous counterpart to resolveWithOverrides for routes that call the raw
 * resolve() from @workspace/authz directly (no per-user override layer needed).
 *
 * Applies the same PP-only and subscription gates as requirePermission() and
 * resolveWithOverrides() before delegating to the registry resolve().
 *
 * Use wherever resolve() is called directly after loadActorCtx(), e.g. routes
 * that fetch the resource first to determine ownerId before checking permission.
 */
/**
 * Send the appropriate HTTP error for a failed resolveOwnerAware() check.
 * Returns 402 with the no_subscription payload when the subscription gate
 * fired; falls back to 403 with a caller-supplied message otherwise.
 */
export function sendOwnerAwareDenial(
  res: Response,
  result: { allowed: boolean; reason?: string },
  fallbackMessage: string,
): void {
  if (result.reason === 'no_subscription') {
    res.status(402).json({ code: 'no_subscription', upgradeUrl: '/pricing' });
  } else {
    res.status(403).json({ error: result.reason ?? fallbackMessage });
  }
}

export function resolveOwnerAware(
  permission: Permission,
  ctx: ActorCtx,
  ownerId: string | undefined,
): { allowed: boolean; reason?: string } {
  // Subscription gate — CRM companies with no active subscription are blocked.
  if (ctx.ppTier === 'crm' && ctx.subscriptionLevel === 'none') {
    return { allowed: false, reason: 'no_subscription' };
  }
  // PP-only gate — mirrors the check in requirePermission() and resolveWithOverrides().
  if (ctx.ppTier === 'pp_only') {
    const domain = (permission as string).split('.')[0];
    if (['crm', 'lead', 'canvassing', 'pipeline'].includes(domain)) {
      return { allowed: false, reason: `The '${domain}' feature is not available on the Proof Package plan.` };
    }
  }
  const roleOverride = ctx.rolePermissionOverrides.get(permission);
  if (roleOverride !== undefined) {
    return roleOverride
      ? { allowed: true }
      : {
          allowed: false,
          reason: `Permission '${permission}' has been revoked for the '${ctx.role}' role at your company.`,
        };
  }
  return resolve(permission, { ...ctx, ownerId });
}

// ── Middleware factory ─────────────────────────────────────────────────────────

/**
 * Express middleware for permissions where ownership is irrelevant (minRole kind).
 * Also works for ownerOrRole permissions used on collection endpoints where
 * "no resource to check ownership against" effectively enforces the role gate.
 *
 * On success: sets req.actorCtx and calls next().
 * On failure: sends 401 (unauthenticated) or 403 (insufficient role / explicitly
 * revoked) and returns.
 *
 * Step 5 override check: explicit per-user overrides (user_permission_overrides)
 * are consulted before the registry default.  An explicit grant bypasses the role
 * check; an explicit revoke short-circuits even if the role would normally allow.
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

    // ── PP-only entitlement gate ─────────────────────────────────────────────
    // PP self-serve companies (ppTier = 'pp_only') are Proof-Package-only tenants.
    // The following permission domains belong exclusively to the field-sales CRM
    // feature set and must not be accessible to PP accounts regardless of role:
    //   crm       — CRM integration (Salesforce-style external connector)
    //   lead      — lead/contact management (field sales pipeline)
    //   canvassing — door-to-door canvassing campaigns
    //   pipeline  — sales pipeline board
    if (ctx.ppTier === 'pp_only') {
      const domain = (permission as string).split('.')[0];
      if (['crm', 'lead', 'canvassing', 'pipeline'].includes(domain)) {
        res.status(403).json({ error: `The '${domain}' feature is not available on the Proof Package plan.` });
        return;
      }
    }

    // ── Subscription gate ────────────────────────────────────────────────────
    // CRM-tier companies must have an active subscription (subscription_level
    // != 'none') to access the CRM. This gate fires after the pp_only check so
    // pp_only companies are never erroneously shown a payment prompt.
    if (ctx.ppTier === 'crm' && ctx.subscriptionLevel === 'none') {
      res.status(402).json({ code: 'no_subscription', upgradeUrl: '/pricing' });
      return;
    }

    // ── Step 5: per-user override check ─────────────────────────────────────
    const overrides = await loadPermissionOverrides(req, ctx.actorId, ctx.companyId);
    const override = overrides.get(permission);
    if (override !== undefined) {
      if (!override) {
        res.status(403).json({
          error: `Permission '${permission}' has been explicitly revoked for your account.`,
        });
        return;
      }
      // Explicit grant — bypass registry default.
      req.actorCtx = ctx;
      next();
      return;
    }

    const roleOverride = ctx.rolePermissionOverrides.get(permission);
    if (roleOverride !== undefined) {
      if (!roleOverride) {
        res.status(403).json({
          error: `Permission '${permission}' has been revoked for the '${ctx.role}' role at your company.`,
        });
        return;
      }
      req.actorCtx = ctx;
      next();
      return;
    }

    // ── Registry default ─────────────────────────────────────────────────────
    const { allowed, reason } = resolve(permission, ctx);
    if (!allowed) {
      res.status(403).json({ error: reason });
      return;
    }
    req.actorCtx = ctx;
    next();
  };
}

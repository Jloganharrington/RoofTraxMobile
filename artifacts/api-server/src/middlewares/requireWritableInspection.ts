/**
 * requireWritableInspection.ts
 *
 * Single-decision-point middleware for inspection write routes.
 *
 * Consolidates what was previously three scattered checks:
 *   1. requirePermission('inspection.read')  — middleware role gate (wrong key for writes)
 *   2. requireInspectionModuleAccess(req, res) — inline dept check (redundant DB query)
 *   3. loadWritableInspection(…)             — inline ownership + lock check
 *
 * Usage:
 *   router.patch('/inspections/:inspectionId/…', requireWritableInspection(), handler);
 *   router.post('/inspections/:inspectionId/addenda', requireWritableInspection({ allowLocked: true }), handler);
 *
 * On success:
 *   - req.actorCtx is set (role, department, companyId, actorId)
 *   - req.inspection is set (the full inspection row, company-scoped)
 *   - next() is called
 *
 * On failure:
 *   - 401 if unauthenticated
 *   - 403 if dept gate fails (not inspector_canvasser dept, unless super_admin)
 *   - 404 if inspection not found in this company
 *   - 403 if ownership gate fails (not the assigned inspector, and role < manager)
 *   - 409 if locked and allowLocked is false
 */

import { canAccessInspectionModule, canWriteInspection } from '@workspace/authz';
import type { Department } from '@workspace/authz';
import { db } from '@workspace/db';
import { inspectionsTable } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { loadActorCtx } from './requirePermission';

// ── Extend Express Request with the pre-loaded inspection row ────────────────

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by requireWritableInspection middleware. Contains the full
       * inspection row after auth, company-scope, ownership, and lock checks
       * have all passed.
       */
      inspection?: typeof inspectionsTable.$inferSelect;
    }
  }
}

// ── Middleware factory ────────────────────────────────────────────────────────

export interface WritableInspectionOpts {
  /**
   * When true, the lock check is skipped so the handler can mutate a locked
   * inspection. Use for addenda, supplement compile/attest/deliver,
   * report attestation, preflight, and submission routes.
   */
  allowLocked?: boolean;
}

/**
 * Express middleware that enforces all three write-gate layers in one place:
 *
 *   1. Department gate — canAccessInspectionModule (inspector_canvasser dept,
 *      or super_admin role bypass).
 *   2. Company-scoped inspection load — 404 if not found.
 *   3. Ownership gate — canWriteInspection (owner-or-manager+).
 *   4. Lock gate — 409 if lockedAt is set and opts.allowLocked is false.
 *
 * Re-uses req.actorCtx if it was already populated by a preceding
 * requirePermission call; otherwise loads it fresh (one DB query).
 */
export function requireWritableInspection(
  opts: WritableInspectionOpts = {},
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // ── 1. Actor context ────────────────────────────────────────────────────
    const actorCtx = req.actorCtx ?? (await loadActorCtx(req));
    if (!actorCtx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { role, department, actorId, companyId } = actorCtx;

    // ── 2. Department / module gate ─────────────────────────────────────────
    if (!canAccessInspectionModule(role, (department ?? 'canvasser') as Department)) {
      res.status(403).json({
        error: `role '${role}' in department '${department ?? '(none)'}' cannot access the inspection module`,
      });
      return;
    }

    // ── 3. Load inspection (company-scoped) ─────────────────────────────────
    const inspectionId = req.params.inspectionId as string;
    if (!inspectionId) {
      res.status(400).json({ error: 'inspectionId route param is required' });
      return;
    }

    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, inspectionId),
          eq(inspectionsTable.companyId, companyId),
        ),
      );

    if (!inspection) {
      res.status(404).json({ error: 'Inspection not found' });
      return;
    }

    // ── 4. Ownership gate ───────────────────────────────────────────────────
    if (!canWriteInspection(role, actorId, inspection.inspectorUserId)) {
      res.status(403).json({ error: 'Not authorized to modify this inspection' });
      return;
    }

    // ── 5. Lock gate ────────────────────────────────────────────────────────
    if (inspection.lockedAt && !opts.allowLocked) {
      res.status(409).json({
        error: 'Inspection is locked; corrections must be filed as an addendum',
      });
      return;
    }

    // ── Success ─────────────────────────────────────────────────────────────
    req.inspection = inspection;
    next();
  };
}

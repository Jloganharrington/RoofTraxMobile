import type { Capability, Department, Role, WorkflowAssignment } from '@workspace/authz';
import { resolveCapabilities } from '@workspace/authz';
import { db, userProfilesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';

/**
 * Express middleware factory for widget data routes.
 *
 * Loads the caller's profile row (role / department / workflowAssignment),
 * computes their capability set, and short-circuits with:
 *   401 — not authenticated
 *   403 — authenticated but the widget key is not in their capability set
 *
 * Calls next() only when the capability is confirmed.
 *
 * IMPORTANT: profile values are always loaded from the DB. Nothing in the
 * request (query params, body, headers) is consulted for the capability
 * check — this is the only place that determines access for widget data.
 */
export function requireWidgetCapability(key: Capability): RequestHandler {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, req.user.id));

    const role: Role = (profile?.role ?? 'field_rep') as Role;
    const department: Department = (profile?.department ?? 'canvasser') as Department;
    const workflow: WorkflowAssignment = (profile?.workflowAssignment ?? 'retail') as WorkflowAssignment;

    const caps = resolveCapabilities({ role, department, workflow });
    if (!caps.has(key)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
}

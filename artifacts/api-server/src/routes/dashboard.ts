import { GetDashboardManifestResponse } from '@workspace/api-zod';
import { db, userProfilesTable } from '@workspace/db';
import type { Department, Role, WorkflowAssignment } from '@workspace/authz';
import { selectWidgetsFor } from '@workspace/authz';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

const router: IRouter = Router();

// Role/department/workflow are always loaded from the authenticated user's
// profile row — never from the request body, query string, or any other
// client-supplied field. Client values cannot escalate privilege.
router.get('/dashboard/manifest', async (req: Request, res: Response) => {
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

  const widgets = selectWidgetsFor({ role, department, workflow }).map((w) => ({
    key: w.key,
    title: w.title,
    size: w.size,
  }));

  const body = GetDashboardManifestResponse.parse({ widgets });
  res.json(body);
});

export default router;

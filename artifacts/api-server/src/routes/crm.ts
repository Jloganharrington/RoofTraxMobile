import { GetCrmStatusResponse } from '@workspace/api-zod';
import { db, userProfilesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { canAccessInspectionModule } from '@workspace/authz';
import { crmSeamStatus, getCompanyCrmConfig } from '../lib/crm';

const router: IRouter = Router();

// M-F (F4) — CRM seam status. Reports whether the per-tenant CRM linkage is
// active or pending for each thread (scheduled feed inbound, appointment sync
// and report ingest outbound). No data is fabricated: an unconfigured tenant
// reads "pending" everywhere, which is why the scheduled feed is empty and the
// appointment-completion metric is null. Gated to the inspection module (C0).
router.get('/crm/status', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = profile?.role ?? 'field_rep';
  const department = profile?.department ?? 'canvasser';
  if (!canAccessInspectionModule(role, department)) {
    res.status(403).json({ error: 'Inspection module not enabled for this user' });
    return;
  }

  const config = await getCompanyCrmConfig(req.user.companyId);
  res.json(GetCrmStatusResponse.parse({ crm: crmSeamStatus(config) }));
});

export default router;

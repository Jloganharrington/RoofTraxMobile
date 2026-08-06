import {
  db,
  companyTemplatesTable,
  objectOwnershipTable,
  userProfilesTable,
  TEMPLATE_USE_CASES,
} from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Auth helper — authenticated admin/super_admin of the target company.
// Returns the resolved companyId string, or null after responding with an
// appropriate error code.
// ---------------------------------------------------------------------------
async function requireCompanyAdmin(
  req: Request,
  res: Response,
): Promise<string | null> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const companyId = (req.params.companyId as string).toUpperCase();

  if (req.user.companyId !== companyId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  const [actorProfile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = actorProfile?.role ?? 'field_rep';
  if (role !== 'admin' && role !== 'super_admin') {
    res.status(403).json({ error: 'Admin role required' });
    return null;
  }

  return companyId;
}

// ---------------------------------------------------------------------------
// Verify that objectPath is owned by the target company. Returns true if the
// ownership row exists and belongs to the same company; responds 400 and
// returns false otherwise.
// ---------------------------------------------------------------------------
async function verifyObjectOwnership(
  req: Request,
  res: Response,
  objectPath: string,
  companyId: string,
): Promise<boolean> {
  const [ownership] = await db
    .select({ companyId: objectOwnershipTable.companyId })
    .from(objectOwnershipTable)
    .where(eq(objectOwnershipTable.objectPath, objectPath));

  if (!ownership) {
    res.status(400).json({ error: 'objectPath not found in object storage' });
    return false;
  }
  if (ownership.companyId !== companyId) {
    res.status(400).json({ error: 'objectPath does not belong to this company' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /companies/:companyId/templates
// ---------------------------------------------------------------------------
router.get('/companies/:companyId/templates', async (req: Request, res: Response) => {
  const companyId = await requireCompanyAdmin(req, res);
  if (!companyId) return;

  const templates = await db
    .select()
    .from(companyTemplatesTable)
    .where(eq(companyTemplatesTable.companyId, companyId));

  res.json({ templates });
});

// ---------------------------------------------------------------------------
// POST /companies/:companyId/templates
// ---------------------------------------------------------------------------
router.post('/companies/:companyId/templates', async (req: Request, res: Response) => {
  const companyId = await requireCompanyAdmin(req, res);
  if (!companyId) return;

  const { name, objectPath, mimeType, useCase, originalFilename } = req.body as {
    name?: unknown;
    objectPath?: unknown;
    mimeType?: unknown;
    useCase?: unknown;
    originalFilename?: unknown;
  };

  if (
    typeof name !== 'string' || !name.trim() ||
    typeof objectPath !== 'string' || !objectPath.trim() ||
    typeof mimeType !== 'string' || !mimeType.trim() ||
    typeof useCase !== 'string' || !useCase.trim() ||
    typeof originalFilename !== 'string' || !originalFilename.trim()
  ) {
    res.status(400).json({ error: 'name, objectPath, mimeType, useCase, and originalFilename are required' });
    return;
  }

  // Validate useCase against the known vocabulary.
  if (!(TEMPLATE_USE_CASES as readonly string[]).includes(useCase.trim())) {
    res.status(400).json({
      error: `useCase must be one of: ${TEMPLATE_USE_CASES.join(', ')}`,
    });
    return;
  }

  // Enforce that the objectPath was uploaded by this company.
  const owned = await verifyObjectOwnership(req, res, objectPath.trim(), companyId);
  if (!owned) return;

  const [template] = await db
    .insert(companyTemplatesTable)
    .values({
      companyId,
      name: name.trim(),
      objectPath: objectPath.trim(),
      mimeType: mimeType.trim(),
      useCase: useCase.trim(),
      originalFilename: originalFilename.trim(),
      // req.user is guaranteed non-null: requireCompanyAdmin called isAuthenticated()
      uploadedByUserId: req.user!.id,
    })
    .returning();

  res.status(201).json({ template });
});

// ---------------------------------------------------------------------------
// PATCH /companies/:companyId/templates/:templateId
// ---------------------------------------------------------------------------
router.patch(
  '/companies/:companyId/templates/:templateId',
  async (req: Request, res: Response) => {
    const companyId = await requireCompanyAdmin(req, res);
    if (!companyId) return;

    const templateId = req.params.templateId as string;

    // Confirm the template belongs to this company.
    const [existing] = await db
      .select({ id: companyTemplatesTable.id })
      .from(companyTemplatesTable)
      .where(
        and(
          eq(companyTemplatesTable.id, templateId),
          eq(companyTemplatesTable.companyId, companyId),
        ),
      );

    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const body = req.body as {
      name?: unknown;
      useCase?: unknown;
      objectPath?: unknown;
    };

    const patch: { name?: string; useCase?: string; objectPath?: string } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        res.status(400).json({ error: 'name must be a non-empty string' });
        return;
      }
      patch.name = body.name.trim();
    }

    if (body.useCase !== undefined) {
      if (typeof body.useCase !== 'string' || !body.useCase.trim()) {
        res.status(400).json({ error: 'useCase must be a non-empty string' });
        return;
      }
      if (!(TEMPLATE_USE_CASES as readonly string[]).includes(body.useCase.trim())) {
        res.status(400).json({
          error: `useCase must be one of: ${TEMPLATE_USE_CASES.join(', ')}`,
        });
        return;
      }
      patch.useCase = body.useCase.trim();
    }

    if (body.objectPath !== undefined) {
      if (typeof body.objectPath !== 'string' || !body.objectPath.trim()) {
        res.status(400).json({ error: 'objectPath must be a non-empty string' });
        return;
      }
      // Enforce that the replacement object was uploaded by this company.
      const owned = await verifyObjectOwnership(req, res, body.objectPath.trim(), companyId);
      if (!owned) return;
      patch.objectPath = body.objectPath.trim();
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'At least one of name, useCase, or objectPath must be provided' });
      return;
    }

    const [updated] = await db
      .update(companyTemplatesTable)
      .set(patch)
      .where(
        and(
          eq(companyTemplatesTable.id, templateId),
          eq(companyTemplatesTable.companyId, companyId),
        ),
      )
      .returning();

    res.json({ template: updated });
  },
);

// ---------------------------------------------------------------------------
// DELETE /companies/:companyId/templates/:templateId
// ---------------------------------------------------------------------------
router.delete(
  '/companies/:companyId/templates/:templateId',
  async (req: Request, res: Response) => {
    const companyId = await requireCompanyAdmin(req, res);
    if (!companyId) return;

    const templateId = req.params.templateId as string;

    const [deleted] = await db
      .delete(companyTemplatesTable)
      .where(
        and(
          eq(companyTemplatesTable.id, templateId),
          eq(companyTemplatesTable.companyId, companyId),
        ),
      )
      .returning({ id: companyTemplatesTable.id });

    if (!deleted) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json({ ok: true });
  },
);

export default router;

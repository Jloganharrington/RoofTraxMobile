/**
 * Company template routes — CRUD for document templates stored in object
 * storage.  Accessible to admins and super admins only.
 *
 * Fixes applied:
 *  1. MIME type allowlist + content sniff + 20 MB cap on POST and PATCH.
 *  2. HTML sanitization in-place before insert/update.
 *  4. Object lifecycle — delete old storage object + ownership on PATCH
 *     replace and on DELETE.
 *  6. Partial unique index enforced: 409 with holder info on use_case conflict.
 */

import { roleRank, type Role } from '@workspace/authz';
import {
  db,
  companyTemplatesTable,
  objectOwnershipTable,
  userProfilesTable,
  TEMPLATE_USE_CASES,
} from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import pino from 'pino';
import { ObjectStorageService } from '../lib/objectStorage';
import { sanitizeTemplateHtml } from '../lib/htmlSanitize';

const router: IRouter = Router();
const log = pino({ name: 'templates' });

// One shared instance per process (state-free wrapper over the GCS client).
const storage = new ObjectStorageService();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

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
  if (roleRank(role as Role) < roleRank('admin')) {
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
// Content-sniff helpers
// ---------------------------------------------------------------------------

/**
 * Verify that the first bytes of the stored object match the declared MIME
 * type's magic signature.
 *
 * PDF  : %PDF  (0x25 0x50 0x44 0x46)
 * DOCX : PK   (0x50 0x4B — ZIP container)
 * HTML : reject if it sniffs as PDF or DOCX; otherwise accept
 */
function matchesMagicBytes(firstBytes: Buffer, mimeType: string): boolean {
  if (mimeType === 'application/pdf') {
    return (
      firstBytes.length >= 4 &&
      firstBytes[0] === 0x25 &&
      firstBytes[1] === 0x50 &&
      firstBytes[2] === 0x44 &&
      firstBytes[3] === 0x46
    );
  }
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return (
      firstBytes.length >= 2 &&
      firstBytes[0] === 0x50 &&
      firstBytes[1] === 0x4b
    );
  }
  if (mimeType === 'text/html') {
    const looksLikePdf =
      firstBytes.length >= 4 &&
      firstBytes[0] === 0x25 &&
      firstBytes[1] === 0x50 &&
      firstBytes[2] === 0x44 &&
      firstBytes[3] === 0x46;
    const looksLikeZip =
      firstBytes.length >= 2 &&
      firstBytes[0] === 0x50 &&
      firstBytes[1] === 0x4b;
    return !looksLikePdf && !looksLikeZip;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Unique-constraint helper
// ---------------------------------------------------------------------------

/** True when err is a PostgreSQL unique-constraint violation (code 23505). */
function isUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const anyErr = err as Record<string, unknown>;
  // Direct code (node-postgres DatabaseError)
  if (anyErr['code'] === '23505') return true;
  // Drizzle may wrap in .cause
  if (typeof anyErr['cause'] === 'object' && anyErr['cause'] !== null) {
    if ((anyErr['cause'] as Record<string, unknown>)['code'] === '23505') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core validation + processing pipeline (runs on POST and on PATCH when
// objectPath is being replaced)
// ---------------------------------------------------------------------------

/**
 * 1. Check MIME type against the allowlist.
 * 2. Fetch first bytes + size from storage.
 * 3. Enforce the 20 MB cap.
 * 4. Content-sniff: reject if magic bytes don't match the declared MIME type.
 * 5. If HTML: read full bytes, sanitize, overwrite in storage.
 *
 * Returns true when all checks pass. On failure, sends a 400 and returns
 * false — the caller must return immediately.
 */
async function validateAndProcessObject(
  res: Response,
  objectPath: string,
  mimeType: string,
): Promise<boolean> {
  // 1. MIME allowlist
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    res.status(400).json({
      error: `mimeType must be one of: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
    });
    return false;
  }

  // 2. Fetch head (size + first 8 bytes for sniff)
  let head: { firstBytes: Buffer; sizeBytes: number };
  try {
    head = await storage.readObjectEntityHead(objectPath, 8);
  } catch {
    res.status(400).json({ error: 'Could not read object from storage for validation' });
    return false;
  }

  // 3. Size cap
  if (head.sizeBytes > MAX_FILE_BYTES) {
    res.status(400).json({
      error: `File exceeds the 20 MB limit (${Math.round(head.sizeBytes / 1024 / 1024)} MB uploaded)`,
    });
    return false;
  }

  // 4. Content sniff
  if (!matchesMagicBytes(head.firstBytes, mimeType)) {
    res.status(400).json({
      error: 'File content does not match the declared mimeType (content sniff failed)',
    });
    return false;
  }

  // 5. HTML sanitization
  if (mimeType === 'text/html') {
    let rawBytes: Buffer;
    try {
      rawBytes = await storage.readObjectEntityBytes(objectPath);
    } catch {
      res.status(400).json({ error: 'Could not read HTML content for sanitization' });
      return false;
    }

    const sanitized = sanitizeTemplateHtml(rawBytes.toString('utf-8'));
    try {
      await storage.overwriteObjectEntityBytes(
        objectPath,
        Buffer.from(sanitized, 'utf-8'),
        'text/html',
      );
    } catch (err) {
      log.error({ err, objectPath }, 'Failed to write sanitized HTML back to storage');
      res.status(500).json({ error: 'Failed to store sanitized HTML content' });
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Object lifecycle cleanup — delete storage object and its ownership row.
// Failures are logged but never fatal: the DB row is the source of truth.
// ---------------------------------------------------------------------------

async function cleanupStorageObject(objectPath: string, context: string): Promise<void> {
  try {
    await storage.deleteObjectEntity(objectPath);
  } catch (err) {
    log.warn({ err, objectPath, context }, 'Failed to delete storage object');
  }
  try {
    await db
      .delete(objectOwnershipTable)
      .where(eq(objectOwnershipTable.objectPath, objectPath));
  } catch (err) {
    log.warn({ err, objectPath, context }, 'Failed to delete ownership row');
  }
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
    res.status(400).json({
      error: 'name, objectPath, mimeType, useCase, and originalFilename are required',
    });
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

  // MIME allowlist + size cap + content sniff + HTML sanitization.
  const valid = await validateAndProcessObject(res, objectPath.trim(), mimeType.trim());
  if (!valid) return;

  try {
    const [template] = await db
      .insert(companyTemplatesTable)
      .values({
        companyId,
        name: name.trim(),
        objectPath: objectPath.trim(),
        mimeType: mimeType.trim(),
        useCase: useCase.trim(),
        originalFilename: originalFilename.trim(),
        uploadedByUserId: req.user!.id,
      })
      .returning();

    res.status(201).json({ template });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err) && useCase.trim() !== 'other') {
      // Return the current holder so the UI can prompt to reassign.
      const [holder] = await db
        .select({ id: companyTemplatesTable.id, name: companyTemplatesTable.name })
        .from(companyTemplatesTable)
        .where(
          and(
            eq(companyTemplatesTable.companyId, companyId),
            eq(companyTemplatesTable.useCase, useCase.trim()),
          ),
        );
      res.status(409).json({ error: 'use_case_conflict', holder: holder ?? null });
      return;
    }
    throw err;
  }
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

    // Fetch the current row (need objectPath + mimeType for lifecycle cleanup).
    const [existing] = await db
      .select({
        id: companyTemplatesTable.id,
        objectPath: companyTemplatesTable.objectPath,
        mimeType: companyTemplatesTable.mimeType,
      })
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
      mimeType?: unknown;
      originalFilename?: unknown;
    };

    const patch: {
      name?: string;
      useCase?: string;
      objectPath?: string;
      mimeType?: string;
      originalFilename?: string;
    } = {};

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

    // objectPath replacement: full validation pipeline on the new object.
    let oldObjectPath: string | null = null;
    if (body.objectPath !== undefined) {
      if (typeof body.objectPath !== 'string' || !body.objectPath.trim()) {
        res.status(400).json({ error: 'objectPath must be a non-empty string' });
        return;
      }

      const newPath = body.objectPath.trim();

      // Determine the effective MIME type for the replacement.
      const newMimeType =
        typeof body.mimeType === 'string' && body.mimeType.trim()
          ? body.mimeType.trim()
          : existing.mimeType;

      // Enforce that the replacement object was uploaded by this company.
      const owned = await verifyObjectOwnership(req, res, newPath, companyId);
      if (!owned) return;

      // MIME allowlist + size cap + content sniff + HTML sanitization.
      const valid = await validateAndProcessObject(res, newPath, newMimeType);
      if (!valid) return;

      // Track the old path so we can clean it up after the DB update.
      oldObjectPath = existing.objectPath;
      patch.objectPath = newPath;
      patch.mimeType = newMimeType;
    }

    // Accept mimeType / originalFilename independently (e.g. metadata-only fix).
    if (body.mimeType !== undefined && !patch.mimeType) {
      if (typeof body.mimeType !== 'string' || !body.mimeType.trim()) {
        res.status(400).json({ error: 'mimeType must be a non-empty string' });
        return;
      }
      if (!ALLOWED_MIME_TYPES.has(body.mimeType.trim())) {
        res.status(400).json({
          error: `mimeType must be one of: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
        });
        return;
      }
      patch.mimeType = body.mimeType.trim();
    }

    if (body.originalFilename !== undefined) {
      if (typeof body.originalFilename !== 'string' || !body.originalFilename.trim()) {
        res.status(400).json({ error: 'originalFilename must be a non-empty string' });
        return;
      }
      patch.originalFilename = body.originalFilename.trim();
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({
        error: 'At least one of name, useCase, or objectPath must be provided',
      });
      return;
    }

    let updated: typeof companyTemplatesTable.$inferSelect | undefined;
    try {
      const [row] = await db
        .update(companyTemplatesTable)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(companyTemplatesTable.id, templateId),
            eq(companyTemplatesTable.companyId, companyId),
          ),
        )
        .returning();
      updated = row;
    } catch (err: unknown) {
      if (isUniqueConstraintError(err) && patch.useCase && patch.useCase !== 'other') {
        const [holder] = await db
          .select({ id: companyTemplatesTable.id, name: companyTemplatesTable.name })
          .from(companyTemplatesTable)
          .where(
            and(
              eq(companyTemplatesTable.companyId, companyId),
              eq(companyTemplatesTable.useCase, patch.useCase),
            ),
          );
        res.status(409).json({ error: 'use_case_conflict', holder: holder ?? null });
        return;
      }
      throw err;
    }

    // DB update succeeded — clean up the old object (non-fatal).
    if (oldObjectPath) {
      void cleanupStorageObject(oldObjectPath, 'patch-replace');
    }

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
      .returning({
        id: companyTemplatesTable.id,
        objectPath: companyTemplatesTable.objectPath,
      });

    if (!deleted) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    // DB row gone — clean up the storage object and its ownership row (non-fatal).
    void cleanupStorageObject(deleted.objectPath, 'delete');

    res.json({ ok: true });
  },
);

export default router;

/**
 * BP/Standards/Detriment/AHJ library management API — Task #121.
 * All endpoints require the requesting user to be a super_admin of the
 * company identified by their session (no companyId URL param).
 */

import { Router, type Request, type Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  userProfilesTable,
  boilerplateSectionsTable,
  standardsEntriesTable,
  detrimentEntriesTable,
  ahjPacksTable,
  BOILERPLATE_SECTION_KEYS,
  AHJ_PACK_TYPES,
} from '@workspace/db';

const router = Router();

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function requireLibrarySuperAdmin(
  req: Request,
  res: Response,
): Promise<{ companyId: string; userId: string } | null> {
  if (!req.isAuthenticated?.() || !req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const companyId: string = req.user.companyId;
  const userId: string = req.user.id;
  const [profile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);
  if ((profile?.role ?? 'field_rep') !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden — super_admin only' });
    return null;
  }
  return { companyId, userId };
}

// ---------------------------------------------------------------------------
// Boilerplate Library
// ---------------------------------------------------------------------------

// GET /report-settings/bp-library
// List the current version of every section key, with a content preview.
router.get('/report-settings/bp-library', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  // Fetch latest version per section key via window function.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (section_key)
      id, section_key, content, version, created_at, created_by
    FROM boilerplate_sections
    WHERE company_id = ${actor.companyId}
    ORDER BY section_key, version DESC, created_at DESC
  `);

  // Build a complete list including keys with no entry yet.
  const byKey = new Map<string, typeof rows.rows[0]>();
  for (const row of rows.rows) {
    byKey.set(row.section_key as string, row);
  }

  const entries = BOILERPLATE_SECTION_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      sectionKey: key,
      version: row ? Number(row.version) : 0,
      contentPreview: row
        ? String(row.content).slice(0, 200)
        : null,
      updatedAt: row ? row.created_at : null,
      hasContent: !!row,
    };
  });

  res.json({ entries });
});

// GET /report-settings/bp-library/:sectionKey
// Fetch the full current content for a single section key.
router.get('/report-settings/bp-library/:sectionKey', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  const sectionKey = req.params.sectionKey as string;
  if (!(BOILERPLATE_SECTION_KEYS as readonly string[]).includes(sectionKey)) {
    return void res.status(400).json({ error: `Unknown sectionKey: ${sectionKey}` });
  }

  const [row] = await db
    .select()
    .from(boilerplateSectionsTable)
    .where(
      and(
        eq(boilerplateSectionsTable.companyId, actor.companyId),
        eq(boilerplateSectionsTable.sectionKey, sectionKey as typeof BOILERPLATE_SECTION_KEYS[number]),
      ),
    )
    .orderBy(desc(boilerplateSectionsTable.version))
    .limit(1);

  res.json({ entry: row ?? null });
});

// PUT /report-settings/bp-library/:sectionKey
// Save a new version (immutable — creates a new row, never mutates).
router.put('/report-settings/bp-library/:sectionKey', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  const sectionKey = req.params.sectionKey as string;
  if (!(BOILERPLATE_SECTION_KEYS as readonly string[]).includes(sectionKey)) {
    return void res.status(400).json({ error: `Unknown sectionKey: ${sectionKey}` });
  }

  const body = z.object({ content: z.string() }).safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: 'content (string) required' });

  // Compute next version number.
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(version), 0) + 1 AS next_version
    FROM boilerplate_sections
    WHERE company_id = ${actor.companyId}
      AND section_key = ${sectionKey}
  `);
  const nextVersion = Number(result.rows[0]?.next_version ?? 1);

  const [inserted] = await db
    .insert(boilerplateSectionsTable)
    .values({
      companyId: actor.companyId,
      sectionKey: sectionKey as typeof BOILERPLATE_SECTION_KEYS[number],
      content: body.data.content,
      version: nextVersion,
      createdBy: actor.userId,
    })
    .returning();

  res.status(201).json({ entry: inserted });
});

// ---------------------------------------------------------------------------
// Standards Entries
// ---------------------------------------------------------------------------

// GET /report-settings/standards-entries
router.get('/report-settings/standards-entries', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  // Latest version per entry key.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (entry_key)
      id, entry_key, source_type, citation_text, verification_status,
      verified_at, authority_limit, locator_template, version, created_at, created_by
    FROM standards_entries
    WHERE company_id = ${actor.companyId}
    ORDER BY entry_key, version DESC, created_at DESC
  `);

  res.json({ entries: rows.rows });
});

// PUT /report-settings/standards-entries/:entryKey
const StandardsEntryBody = z.object({
  sourceType: z.string().optional(),
  citationText: z.string().optional(),
  authorityLimit: z.string().optional(),
  locatorTemplate: z.string().optional(),
  /** Pass true to mark this entry as verified. */
  markVerified: z.boolean().optional(),
  /** Explicit verified date (ISO string). Used by the .md importer. If omitted
   *  and markVerified is true, defaults to now(). */
  verifiedAt: z.string().optional(),
  /** Whether this entry's provisions were authored by a human (not AI-generated). */
  humanEnteredProvisionsOnly: z.boolean().optional(),
});

router.put('/report-settings/standards-entries/:entryKey', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  const entryKey = req.params.entryKey as string;
  if (!entryKey || entryKey.length > 80) {
    return void res.status(400).json({ error: 'Invalid entryKey' });
  }

  const body = StandardsEntryBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  // Next version.
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(version), 0) + 1 AS next_version
    FROM standards_entries
    WHERE company_id = ${actor.companyId}
      AND entry_key = ${entryKey}
  `);
  const nextVersion = Number(result.rows[0]?.next_version ?? 1);

  // IICRC entries are always verify_before_ship regardless of markVerified.
  const isIicrc = entryKey.toUpperCase().startsWith('IICRC');
  const verificationStatus = isIicrc
    ? 'verify_before_ship'
    : body.data.markVerified
    ? 'verified'
    : 'verify_before_ship';

  // Use caller-supplied verifiedAt if present; otherwise default to now().
  let verifiedAt: Date | null = null;
  if (verificationStatus === 'verified') {
    verifiedAt = body.data.verifiedAt ? new Date(body.data.verifiedAt) : new Date();
  }

  const [inserted] = await db
    .insert(standardsEntriesTable)
    .values({
      companyId: actor.companyId,
      entryKey,
      sourceType: body.data.sourceType ?? null,
      citationText: body.data.citationText ?? null,
      verificationStatus: verificationStatus as 'verified' | 'verify_before_ship',
      verifiedAt,
      authorityLimit: body.data.authorityLimit ?? null,
      locatorTemplate: body.data.locatorTemplate ?? null,
      humanEnteredProvisionsOnly: body.data.humanEnteredProvisionsOnly ?? false,
      version: nextVersion,
      createdBy: actor.userId,
    })
    .returning();

  res.status(201).json({ entry: inserted });
});

// DELETE /report-settings/standards-entries/:entryKey
router.delete('/report-settings/standards-entries/:entryKey', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;
  const entryKey = req.params.entryKey as string;
  if (!entryKey) return void res.status(400).json({ error: 'Invalid entryKey' });
  await db.delete(standardsEntriesTable).where(
    and(
      eq(standardsEntriesTable.companyId, actor.companyId),
      eq(standardsEntriesTable.entryKey, entryKey),
    ),
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Detriment Entries
// ---------------------------------------------------------------------------

// GET /report-settings/detriment-entries
router.get('/report-settings/detriment-entries', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  const rows = await db.execute(sql`
    SELECT DISTINCT ON (entry_key)
      id, entry_key, applicability_conditions, statement,
      required_support, limitation, version, created_at, created_by
    FROM detriment_entries
    WHERE company_id = ${actor.companyId}
    ORDER BY entry_key, version DESC, created_at DESC
  `);

  res.json({ entries: rows.rows });
});

// PUT /report-settings/detriment-entries/:entryKey
const DetrimentEntryBody = z.object({
  applicabilityConditions: z.array(z.string()),
  statement: z.string(),
  requiredSupport: z.string().optional(),
  limitation: z.string().optional(),
});

router.put('/report-settings/detriment-entries/:entryKey', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  const entryKey = req.params.entryKey as string;
  if (!entryKey || entryKey.length > 80) {
    return void res.status(400).json({ error: 'Invalid entryKey' });
  }

  const body = DetrimentEntryBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const result = await db.execute(sql`
    SELECT COALESCE(MAX(version), 0) + 1 AS next_version
    FROM detriment_entries
    WHERE company_id = ${actor.companyId}
      AND entry_key = ${entryKey}
  `);
  const nextVersion = Number(result.rows[0]?.next_version ?? 1);

  const [inserted] = await db
    .insert(detrimentEntriesTable)
    .values({
      companyId: actor.companyId,
      entryKey,
      applicabilityConditions: body.data.applicabilityConditions,
      statement: body.data.statement,
      requiredSupport: body.data.requiredSupport ?? null,
      limitation: body.data.limitation ?? null,
      version: nextVersion,
      createdBy: actor.userId,
    })
    .returning();

  res.status(201).json({ entry: inserted });
});

// DELETE /report-settings/detriment-entries/:entryKey
router.delete('/report-settings/detriment-entries/:entryKey', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;
  const entryKey = req.params.entryKey as string;
  if (!entryKey) return void res.status(400).json({ error: 'Invalid entryKey' });
  await db.delete(detrimentEntriesTable).where(
    and(
      eq(detrimentEntriesTable.companyId, actor.companyId),
      eq(detrimentEntriesTable.entryKey, entryKey),
    ),
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// AHJ Packs
// ---------------------------------------------------------------------------

// GET /report-settings/ahj-packs
router.get('/report-settings/ahj-packs', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  // Latest version per (pack_type, jurisdiction).
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (pack_type, jurisdiction)
      id, pack_type, jurisdiction, items, version, created_at, created_by
    FROM ahj_packs
    WHERE company_id = ${actor.companyId}
    ORDER BY pack_type, jurisdiction, version DESC, created_at DESC
  `);

  res.json({ packs: rows.rows });
});

// POST /report-settings/ahj-packs
const AhjPackCreateBody = z.object({
  packType: z.enum(AHJ_PACK_TYPES),
  jurisdiction: z.string().min(2).max(120),
  items: z.array(
    z.object({
      key: z.string(),
      citationText: z.string(),
      edition: z.string().optional(),
      trigger: z.string().optional(),
      active: z.boolean().default(true),
    }),
  ),
});

router.post('/report-settings/ahj-packs', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  const body = AhjPackCreateBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const [inserted] = await db
    .insert(ahjPacksTable)
    .values({
      companyId: actor.companyId,
      packType: body.data.packType,
      jurisdiction: body.data.jurisdiction,
      items: body.data.items,
      version: 1,
      createdBy: actor.userId,
    })
    .returning();

  res.status(201).json({ pack: inserted });
});

// PATCH /report-settings/ahj-packs/:packId
// Update items — creates a new version row, never mutates the existing one.
const AhjPackUpdateBody = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      citationText: z.string(),
      edition: z.string().optional(),
      trigger: z.string().optional(),
      active: z.boolean().default(true),
    }),
  ),
});

router.patch('/report-settings/ahj-packs/:packId', async (req: Request, res: Response) => {
  const actor = await requireLibrarySuperAdmin(req, res);
  if (!actor) return;

  const packId = req.params.packId as string;
  const [existing] = await db
    .select()
    .from(ahjPacksTable)
    .where(
      and(eq(ahjPacksTable.id, packId), eq(ahjPacksTable.companyId, actor.companyId)),
    )
    .orderBy(desc(ahjPacksTable.version))
    .limit(1);

  if (!existing) return void res.status(404).json({ error: 'Pack not found' });

  const body = AhjPackUpdateBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const [inserted] = await db
    .insert(ahjPacksTable)
    .values({
      companyId: actor.companyId,
      packType: existing.packType,
      jurisdiction: existing.jurisdiction,
      items: body.data.items,
      version: existing.version + 1,
      createdBy: actor.userId,
    })
    .returning();

  res.status(200).json({ pack: inserted });
});

export default router;

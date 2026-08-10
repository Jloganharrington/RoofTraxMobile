/**
 * BP/Standards/Detriment/AHJ library management API — Task #121.
 * All endpoints require the requesting user to be a super_admin of the
 * company identified by their session (no companyId URL param).
 */

// report.settings_view (GETs) / report.settings_edit (writes) — super_admin+.
import { requirePermission } from '../middlewares/requirePermission';
import { Router, type Request, type Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ai as geminiAi } from '@workspace/integrations-gemini-ai';
import {
  db,
  boilerplateSectionsTable,
  standardsEntriesTable,
  detrimentEntriesTable,
  ahjPacksTable,
  agentPromptsTable,
  BOILERPLATE_SECTION_KEYS,
  AHJ_PACK_TYPES,
  AGENT_PROMPT_KEYS,
} from '@workspace/db';

const router = Router();

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Boilerplate Library
// ---------------------------------------------------------------------------

// GET /report-settings/bp-library
// List the current version of every section key, with a content preview.
router.get('/report-settings/bp-library', requirePermission('report.settings_view'), async (req: Request, res: Response) => {

  // Fetch latest version per section key via window function.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (section_key)
      id, section_key, content, version, created_at, created_by
    FROM boilerplate_sections
    WHERE company_id = ${req.actorCtx!.companyId}
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
router.get('/report-settings/bp-library/:sectionKey', requirePermission('report.settings_view'), async (req: Request, res: Response) => {

  const sectionKey = req.params.sectionKey as string;
  if (!(BOILERPLATE_SECTION_KEYS as readonly string[]).includes(sectionKey)) {
    return void res.status(400).json({ error: `Unknown sectionKey: ${sectionKey}` });
  }

  const [row] = await db
    .select()
    .from(boilerplateSectionsTable)
    .where(
      and(
        eq(boilerplateSectionsTable.companyId, req.actorCtx!.companyId),
        eq(boilerplateSectionsTable.sectionKey, sectionKey as typeof BOILERPLATE_SECTION_KEYS[number]),
      ),
    )
    .orderBy(desc(boilerplateSectionsTable.version))
    .limit(1);

  res.json({ entry: row ?? null });
});

// PUT /report-settings/bp-library/:sectionKey
// Save a new version (immutable — creates a new row, never mutates).
router.put('/report-settings/bp-library/:sectionKey', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {

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
    WHERE company_id = ${req.actorCtx!.companyId}
      AND section_key = ${sectionKey}
  `);
  const nextVersion = Number(result.rows[0]?.next_version ?? 1);

  const [inserted] = await db
    .insert(boilerplateSectionsTable)
    .values({
      companyId: req.actorCtx!.companyId,
      sectionKey: sectionKey as typeof BOILERPLATE_SECTION_KEYS[number],
      content: body.data.content,
      version: nextVersion,
      createdBy: req.actorCtx!.actorId,
    })
    .returning();

  res.status(201).json({ entry: inserted });
});

// ---------------------------------------------------------------------------
// Standards Entries
// ---------------------------------------------------------------------------

// GET /report-settings/standards-entries
router.get('/report-settings/standards-entries', requirePermission('report.settings_view'), async (req: Request, res: Response) => {

  // Latest version per entry key. Include `title` so it is never dropped on
  // subsequent PUT calls that carry only the fields they want to update.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (entry_key)
      id, entry_key, title, source_type, citation_text, verification_status,
      verified_at, authority_limit, locator_template,
      human_entered_provisions_only, version, created_at, created_by
    FROM standards_entries
    WHERE company_id = ${req.actorCtx!.companyId}
    ORDER BY entry_key, version DESC, created_at DESC
  `);

  res.json({ entries: rows.rows });
});

// PUT /report-settings/standards-entries/:entryKey
const StandardsEntryBody = z.object({
  /** Full display label for the entry, e.g. 'IICRC S500 Standard…'.
   *  Separate from the URL :entryKey param which holds the short key only. */
  title: z.string().optional(),
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

router.put('/report-settings/standards-entries/:entryKey', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {

  const entryKey = req.params.entryKey as string;
  if (!entryKey || entryKey.length > 80) {
    return void res.status(400).json({ error: 'Invalid entryKey' });
  }

  const body = StandardsEntryBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  // Load the current latest version so we can carry forward any fields the
  // caller did not explicitly provide (e.g. `title` preserved across updates
  // that only change citationText).
  const latestResult = await db.execute(sql`
    SELECT COALESCE(MAX(version), 0) + 1 AS next_version,
           (ARRAY_AGG(title ORDER BY version DESC))[1] AS current_title,
           (ARRAY_AGG(human_entered_provisions_only ORDER BY version DESC))[1] AS current_human_only
    FROM standards_entries
    WHERE company_id = ${req.actorCtx!.companyId}
      AND entry_key = ${entryKey}
  `);
  const nextVersion = Number(latestResult.rows[0]?.next_version ?? 1);
  // Carry forward `title` and `humanEnteredProvisionsOnly` when not supplied
  // so partial updates never silently wipe migration-stamped values.
  const inheritedTitle = (latestResult.rows[0]?.current_title as string | null) ?? null;
  const inheritedHumanOnly = (latestResult.rows[0]?.current_human_only as boolean | null) ?? false;

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
      companyId: req.actorCtx!.companyId,
      entryKey,
      // Prefer explicitly supplied title; fall back to the inherited value so a
      // partial update (e.g. updating citationText only) never blanks the title
      // that was set by the initial import or migration.
      title: body.data.title !== undefined ? body.data.title : inheritedTitle,
      sourceType: body.data.sourceType ?? null,
      citationText: body.data.citationText ?? null,
      verificationStatus: verificationStatus as 'verified' | 'verify_before_ship',
      verifiedAt,
      authorityLimit: body.data.authorityLimit ?? null,
      locatorTemplate: body.data.locatorTemplate ?? null,
      // Likewise carry forward humanEnteredProvisionsOnly — a partial update
      // must never accidentally reset a manually-flagged IICRC entry to false.
      humanEnteredProvisionsOnly:
        body.data.humanEnteredProvisionsOnly !== undefined
          ? body.data.humanEnteredProvisionsOnly
          : inheritedHumanOnly,
      version: nextVersion,
      createdBy: req.actorCtx!.actorId,
    })
    .returning();

  res.status(201).json({ entry: inserted });
});

// DELETE /report-settings/standards-entries/:entryKey
router.delete('/report-settings/standards-entries/:entryKey', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {
  const entryKey = req.params.entryKey as string;
  if (!entryKey) return void res.status(400).json({ error: 'Invalid entryKey' });
  await db.delete(standardsEntriesTable).where(
    and(
      eq(standardsEntriesTable.companyId, req.actorCtx!.companyId),
      eq(standardsEntriesTable.entryKey, entryKey),
    ),
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Detriment Entries
// ---------------------------------------------------------------------------

// GET /report-settings/detriment-entries
router.get('/report-settings/detriment-entries', requirePermission('report.settings_view'), async (req: Request, res: Response) => {

  const rows = await db.execute(sql`
    SELECT DISTINCT ON (entry_key)
      id, entry_key, applicability_conditions, statement,
      required_support, limitation, version, created_at, created_by
    FROM detriment_entries
    WHERE company_id = ${req.actorCtx!.companyId}
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

router.put('/report-settings/detriment-entries/:entryKey', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {

  const entryKey = req.params.entryKey as string;
  if (!entryKey || entryKey.length > 80) {
    return void res.status(400).json({ error: 'Invalid entryKey' });
  }

  const body = DetrimentEntryBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const result = await db.execute(sql`
    SELECT COALESCE(MAX(version), 0) + 1 AS next_version
    FROM detriment_entries
    WHERE company_id = ${req.actorCtx!.companyId}
      AND entry_key = ${entryKey}
  `);
  const nextVersion = Number(result.rows[0]?.next_version ?? 1);

  const [inserted] = await db
    .insert(detrimentEntriesTable)
    .values({
      companyId: req.actorCtx!.companyId,
      entryKey,
      applicabilityConditions: body.data.applicabilityConditions,
      statement: body.data.statement,
      requiredSupport: body.data.requiredSupport ?? null,
      limitation: body.data.limitation ?? null,
      version: nextVersion,
      createdBy: req.actorCtx!.actorId,
    })
    .returning();

  res.status(201).json({ entry: inserted });
});

// DELETE /report-settings/detriment-entries/:entryKey
router.delete('/report-settings/detriment-entries/:entryKey', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {
  const entryKey = req.params.entryKey as string;
  if (!entryKey) return void res.status(400).json({ error: 'Invalid entryKey' });
  await db.delete(detrimentEntriesTable).where(
    and(
      eq(detrimentEntriesTable.companyId, req.actorCtx!.companyId),
      eq(detrimentEntriesTable.entryKey, entryKey),
    ),
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// AHJ Packs
// ---------------------------------------------------------------------------

// GET /report-settings/ahj-packs
router.get('/report-settings/ahj-packs', requirePermission('report.settings_view'), async (req: Request, res: Response) => {

  // Latest version per (pack_type, jurisdiction).
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (pack_type, jurisdiction)
      id, pack_type, jurisdiction, items, version, created_at, created_by
    FROM ahj_packs
    WHERE company_id = ${req.actorCtx!.companyId}
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

router.post('/report-settings/ahj-packs', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {

  const body = AhjPackCreateBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const [inserted] = await db
    .insert(ahjPacksTable)
    .values({
      companyId: req.actorCtx!.companyId,
      packType: body.data.packType,
      jurisdiction: body.data.jurisdiction,
      items: body.data.items,
      version: 1,
      createdBy: req.actorCtx!.actorId,
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

router.patch('/report-settings/ahj-packs/:packId', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {

  const packId = req.params.packId as string;
  const [existing] = await db
    .select()
    .from(ahjPacksTable)
    .where(
      and(eq(ahjPacksTable.id, packId), eq(ahjPacksTable.companyId, req.actorCtx!.companyId)),
    )
    .orderBy(desc(ahjPacksTable.version))
    .limit(1);

  if (!existing) return void res.status(404).json({ error: 'Pack not found' });

  const body = AhjPackUpdateBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const [inserted] = await db
    .insert(ahjPacksTable)
    .values({
      companyId: req.actorCtx!.companyId,
      packType: existing.packType,
      jurisdiction: existing.jurisdiction,
      items: body.data.items,
      version: existing.version + 1,
      createdBy: req.actorCtx!.actorId,
    })
    .returning();

  res.status(200).json({ pack: inserted });
});

// ---------------------------------------------------------------------------
// AI Agent Prompts
// ---------------------------------------------------------------------------

// GET /report-settings/agent-prompts
// Returns all configured custom prompts for the company.
router.get('/report-settings/agent-prompts', requirePermission('report.settings_view'), async (req: Request, res: Response) => {
  const prompts = await db
    .select()
    .from(agentPromptsTable)
    .where(eq(agentPromptsTable.companyId, req.actorCtx!.companyId))
    .orderBy(agentPromptsTable.agentKey);
  res.json({ prompts });
});

const AgentPromptBody = z.object({
  systemPrompt: z.string().min(1).max(20_000),
});

// PUT /report-settings/agent-prompts/:agentKey
// Upsert a custom prompt. Rejects unknown agent keys.
router.put('/report-settings/agent-prompts/:agentKey', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {
  const agentKey = String(req.params.agentKey);
  if (!(AGENT_PROMPT_KEYS as readonly string[]).includes(agentKey)) {
    res.status(400).json({ error: `Unknown agent key: ${agentKey}` });
    return;
  }
  const body = AgentPromptBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .insert(agentPromptsTable)
    .values({
      companyId: req.actorCtx!.companyId,
      agentKey,
      systemPrompt: body.data.systemPrompt,
      updatedBy: req.actorCtx!.actorId,
    })
    .onConflictDoUpdate({
      target: [agentPromptsTable.companyId, agentPromptsTable.agentKey],
      set: {
        systemPrompt: body.data.systemPrompt,
        updatedBy: req.actorCtx!.actorId,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json({ prompt: row });
});

// DELETE /report-settings/agent-prompts/:agentKey
// Removes the custom prompt — agent reverts to built-in default.
router.delete('/report-settings/agent-prompts/:agentKey', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {
  const agentKey = String(req.params.agentKey);
  await db
    .delete(agentPromptsTable)
    .where(
      and(
        eq(agentPromptsTable.companyId, req.actorCtx!.companyId),
        eq(agentPromptsTable.agentKey, agentKey),
      ),
    );
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Proof Package Data Wizard — AI content routing
// ---------------------------------------------------------------------------

const PP_WIZARD_PROMPT = `You are the Proof Package Data Wizard for a professional roofing inspection company.

Your task: analyze the provided document(s) and route each piece of content to the correct destination in the system. Do NOT modify, paraphrase, or summarize any content — extract and route it exactly as written in the source.

DESTINATION TYPES AND THEIR SCHEMAS:

1. "boilerplate" — Standard report narrative text. Route to one of these section keys ONLY (use the exact key string):
   • opening_statement — Introductory statement describing the purpose/scope of the inspection report
   • inspection_method — Methodology description for how inspections are performed
   • caption_patterns — Rules or patterns governing how photo captions are written
   • rap_field_protocol — Field protocol for the Rapid Assessment Protocol (RAP)
   • attestation_block_a — Inspector attestation/certification language, block A
   • attestation_block_b — Inspector attestation/certification language, block B
   • attestation_block_c — Inspector attestation/certification language, block C
   • uniform_inspection_procedure — Standard uniform inspection procedure text
   • product_id_methodology — Methodology for identifying roofing products
   • scope_block — Scope of inspection boilerplate block
   • std_rpr_01_source_record — STD-RPR-01 source record text

   If content clearly matches a named boilerplate section, use that key. If you are uncertain which section key applies, skip it.

2. "standards" — Published code/standards citations used to support inspection findings. Fields:
   • entryKey (string, UPPER_SNAKE_CASE, e.g. "ASTM_D3462", "IRC_R905_2") — derive from the standard's identifier
   • sourceType (string | null) — issuing organization: "ASTM", "ICC", "IRC", "IBC", "NRCA", "ARMA", "UL", "ASCE", etc.
   • citationText (string) — EXACT citation text as written in the source, verbatim
   • authorityLimit (string | null) — any stated limit on what this standard supports (optional)
   • locatorTemplate (string | null) — URL or reference locator (optional)
   • humanEnteredProvisionsOnly (boolean) — true if the provisions were human-authored (not AI-generated)

3. "detriment" — Adverse condition / deficiency entries used to document damage. Fields:
   • entryKey (string, UPPER_SNAKE_CASE, e.g. "MISSING_DRIP_EDGE") — short identifier
   • applicabilityConditions (string[]) — snake_case condition tags that trigger this detriment
   • statement (string) — EXACT detriment statement, verbatim
   • requiredSupport (string | null) — what documentation or evidence is required (optional)
   • limitation (string | null) — any limitation on applicability (optional)

4. "ahj_pack" — Building code provisions for a specific jurisdiction. Fields:
   • jurisdiction (string) — e.g. "Virginia", "Texas", "Travis County, TX"
   • packType ("ahj_roof" | "ahj_siding") — roof pack unless content explicitly describes siding
   • packItems (array of objects):
     - key (string) — citation identifier, e.g. "VRC_R905_2_8_5"
     - citationText (string) — EXACT citation text, verbatim
     - edition (string | null) — code edition year (optional)
     - trigger (string | null) — when this citation applies (optional)
     - active (boolean, always true)

   Group ALL items for the same jurisdiction+packType into a SINGLE "ahj_pack" entry.

RULES:
- Extract content VERBATIM — do not rewrite, summarize, or paraphrase citation or statement text
- Only route content that clearly fits a destination; skip ambiguous or unclear content
- Use confidence 0.0–1.0: ≥0.9 = very certain, 0.7–0.9 = likely, <0.7 = uncertain
- Provide a short "reasoning" string (1 sentence max) for each routing decision
- Provide a human-readable "label" for display in the UI (e.g. "Opening Statement", "ASTM D3462", "Missing Drip Edge")

Output valid JSON only — no markdown fences, no explanation outside the JSON object:
{
  "items": [
    { "destination": "boilerplate", "sectionKey": "...", "label": "...", "content": "...", "confidence": 0.0, "reasoning": "..." },
    { "destination": "standards", "entryKey": "...", "label": "...", "sourceType": null, "citationText": "...", "authorityLimit": null, "locatorTemplate": null, "humanEnteredProvisionsOnly": true, "confidence": 0.0, "reasoning": "..." },
    { "destination": "detriment", "entryKey": "...", "label": "...", "applicabilityConditions": [], "statement": "...", "requiredSupport": null, "limitation": null, "confidence": 0.0, "reasoning": "..." },
    { "destination": "ahj_pack", "jurisdiction": "...", "packType": "ahj_roof", "label": "...", "packItems": [{ "key": "...", "citationText": "...", "edition": null, "trigger": null, "active": true }], "confidence": 0.0, "reasoning": "..." }
  ]
}`;

const PpWizardAnalyzeBody = z.object({
  files: z.array(
    z.object({
      name: z.string().max(200),
      content: z.string().max(150_000),
    }),
  ).min(1).max(8),
});

router.post('/report-settings/pp-wizard/analyze', requirePermission('report.settings_edit'), async (req: Request, res: Response) => {

  const body = PpWizardAnalyzeBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const combined = body.data.files
    .map((f) => `=== FILE: ${f.name} ===\n\n${f.content}`)
    .join('\n\n---\n\n');

  let plan: unknown;
  try {
    const response = await geminiAi.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: combined }] }],
      config: {
        systemInstruction: PP_WIZARD_PROMPT,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 8192 },
      },
    });
    plan = JSON.parse(response.text ?? '{}');
  } catch (err) {
    return void res.status(502).json({ error: 'AI analysis failed', detail: String(err) });
  }

  res.json({ plan });
});

export default router;

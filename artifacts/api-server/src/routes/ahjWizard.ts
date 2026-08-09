/**
 * AHJ Wizard API — code sources, extraction runs, verification queue,
 * and pack assembly. All endpoints require super_admin.
 *
 * Architecture: ingest → extract → verify (human) → activate.
 * Draft and rejected items are NEVER citable, renderable, or pack-eligible.
 */

import { roleRank, type Role } from '@workspace/authz';
import { Router, type Request, type Response } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  userProfilesTable,
  codeSourcesTable,
  corpusChunksTable,
  wizardRunsTable,
  ahjCandidateItemsTable,
  ahjPacksTable,
  AHJ_PACK_TYPES,
  AHJ_WIZARD_ACQUISITION_BASES,
  agentPromptsTable,
} from '@workspace/db';
import {
  runCategoryExtraction,
  lintCandidateContent,
  scoreVirginiaGoldenSet,
  AHJ_WIZARD_PROMPT_VERSION,
  AHJ_WIZARD_CATEGORIES,
  MATERIAL_SENSITIVE_CATEGORIES,
  type AhjWizardCategory,
} from '../lib/ahjWizard';

const router = Router();

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function requireSuperAdmin(
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
  if (roleRank((profile?.role ?? 'field_rep') as Role) < roleRank('super_admin')) {
    res.status(403).json({ error: 'Forbidden — super_admin only' });
    return null;
  }
  return { companyId, userId };
}

// ---------------------------------------------------------------------------
// Corpus chunking helper
// ---------------------------------------------------------------------------

/**
 * Chunk a corpus document by section boundary (R###, Section ###, Chapter ###).
 */
function chunkCorpusBySection(text: string): Array<{ sectionId: string; text: string }> {
  const SECTION_RE = /^((?:Section\s+|Chapter\s+|Table\s+|Appendix\s+)?[A-Z]?\d+(?:\.\d+)*(?:\.\d+)*(?:\.\d+)*)\s*[.–\-\s]/m;

  const lines = text.split(/\r?\n/);
  const chunks: Array<{ sectionId: string; text: string }> = [];
  let currentSection = 'PREAMBLE';
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(SECTION_RE);
    if (match && line.length < 120) {
      if (currentLines.length > 0) {
        const chunkText = currentLines.join('\n').trim();
        if (chunkText.length > 20) chunks.push({ sectionId: currentSection, text: chunkText });
      }
      currentSection = match[1].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    const chunkText = currentLines.join('\n').trim();
    if (chunkText.length > 20) chunks.push({ sectionId: currentSection, text: chunkText });
  }
  return chunks;
}

/**
 * Retrieve relevant corpus chunks for a given category using keyword matching.
 */
function selectChunksForCategory(
  chunks: Array<{ sectionId: string; text: string }>,
  category: AhjWizardCategory,
): string {
  const CATEGORY_KEYWORDS: Record<AhjWizardCategory, string[]> = {
    fire_separation: ['fire', 'separation', 'compartment', 'rating', 'assembly', 'garage', 'R302'],
    structural_attachment: ['structural', 'load', 'uplift', 'wind', 'attachment', 'anchor', 'R802', 'R301'],
    ventilation: ['ventilation', 'vent', 'attic', 'airspace', 'net free', 'R806'],
    energy_code: ['energy', 'insulation', 'thermal', 'air barrier', 'R-value', 'N1101', 'R402'],
    underlayment: ['underlayment', 'felt', 'moisture', 'R905.2', 'R703', 'weather resistant'],
    ice_water_shield: ['ice', 'water shield', 'eave', 'climate zone', 'R905.1.2'],
    flashing: ['flash', 'counter', 'valley', 'R703.11', 'R905.2.8'],
    deck_attachment: ['deck', 'sheathing', 'plywood', 'OSB', 'R503', 'span'],
    valley_construction: ['valley', 'open', 'closed', 'woven', 'R905.2.8.1'],
    ridge_hip: ['ridge', 'hip', 'cap', 'R905.2.6', 'ridge vent'],
    penetrations: ['penetration', 'pipe', 'boot', 'curb', 'plumbing', 'P2603', 'R903.2'],
    drip_edge_metal: ['drip edge', 'eave metal', 'edge metal', 'R905.2.8.5', 'corrosion'],
    layering_tearoff: ['reroof', 'recover', 'layer', 'tear', 'R908', 'existing roof'],
    permit_inspection: ['permit', 'inspection', 'exempt', 'R105', 'building official'],
  };

  const keywords = CATEGORY_KEYWORDS[category] ?? [];
  const norm = (s: string) => s.toLowerCase();
  const scored = chunks.map((chunk) => {
    const t = norm(chunk.text + chunk.sectionId);
    const score = keywords.reduce((acc, kw) => acc + (t.includes(norm(kw)) ? 1 : 0), 0);
    return { ...chunk, score };
  });
  const relevant = scored.filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 15);
  const toUse = relevant.length > 0 ? relevant : chunks.slice(0, 8);
  let combined = '';
  for (const c of toUse) {
    const snippet = `[${c.sectionId}]\n${c.text}`;
    if (combined.length + snippet.length > 10000) break;
    combined += '\n\n' + snippet;
  }
  return combined.trim();
}

// ---------------------------------------------------------------------------
// Background extraction driver
// ---------------------------------------------------------------------------

async function runExtractionBackground(opts: {
  runId: string;
  companyId: string;
  jurisdiction: string;
  packType: 'ahj_roof' | 'ahj_siding';
  codeSourceIds: string[];
  edition?: string;
  categoryExcerpts?: Record<string, string>;
}): Promise<void> {
  const { runId, companyId, jurisdiction, packType, codeSourceIds, edition, categoryExcerpts = {} } = opts;

  try {
    const allChunks: Array<{ sectionId: string; text: string }> = [];
    if (codeSourceIds.length > 0) {
      const chunkRows = await db
        .select({ sectionId: corpusChunksTable.sectionId, text: corpusChunksTable.text })
        .from(corpusChunksTable)
        .where(
          and(
            eq(corpusChunksTable.companyId, companyId),
            inArray(corpusChunksTable.codeSourceId, codeSourceIds),
          ),
        );
      allChunks.push(...chunkRows);
    }

    const [customPromptRow] = await db
      .select({ systemPrompt: agentPromptsTable.systemPrompt })
      .from(agentPromptsTable)
      .where(
        and(
          eq(agentPromptsTable.companyId, companyId),
          eq(agentPromptsTable.agentKey, 'ahj_wizard_extraction'),
        ),
      )
      .limit(1);
    void customPromptRow;

    const categorySweep: Record<string, unknown> = {};
    const seenKeys = new Set<string>();
    let totalItems = 0;
    let totalGaps = 0;
    const byCategory: Record<string, number> = {};

    for (let i = 0; i < AHJ_WIZARD_CATEGORIES.length; i += 4) {
      const batch = AHJ_WIZARD_CATEGORIES.slice(i, i + 4) as AhjWizardCategory[];
      const batchResults = await Promise.all(
        batch.map(async (category: AhjWizardCategory) => {
          const sectionText =
            categoryExcerpts[category] ||
            (allChunks.length > 0 ? selectChunksForCategory(allChunks, category) : '');

          if (!sectionText) {
            return {
              category,
              candidates: [],
              gaps: [
                {
                  description: `No corpus text available for category ${category}`,
                  category,
                  gapsContext: { note: 'No stored corpus; provide an excerpt via categoryExcerpts or attach a licensed corpus.' },
                },
              ],
              rawResponse: '',
            };
          }

          return runCategoryExtraction({ category, jurisdiction, packType, sectionText, edition });
        }),
      );

      for (const result of batchResults) {
        categorySweep[result.category] = {
          candidatesFound: result.candidates.length,
          gapsFound: result.gaps.length,
        };

        for (const cand of result.candidates) {
          const dedupKey = `${cand.citation ?? 'gap'}_${packType}`;
          if (seenKeys.has(dedupKey)) continue;
          seenKeys.add(dedupKey);
          const lintNote = lintCandidateContent(cand);
          await db.insert(ahjCandidateItemsTable).values({
            companyId,
            wizardRunId: runId,
            packType,
            jurisdiction,
            status: 'draft',
            candidateKey: cand.candidateKey,
            citation: cand.citation,
            edition: cand.edition,
            provisionSummary: cand.provisionSummary,
            classification: cand.classification,
            factualTrigger: cand.factualTrigger,
            scopeConnection: cand.scopeConnection,
            sourceLocator: cand.sourceLocator,
            amendmentNote: cand.amendmentNote,
            confidence: cand.confidence,
            lintNote: lintNote ?? undefined,
            category: result.category,
            materialApplicability: cand.materialApplicability,
            // Flag for verifier when the AI returned ["all"] for a material-sensitive
            // category — verifier must confirm or correct before marking verified.
            needsMaterialReview:
              MATERIAL_SENSITIVE_CATEGORIES.includes(result.category as AhjWizardCategory) &&
              cand.materialApplicability.length === 1 &&
              cand.materialApplicability[0] === 'all',
          });
          totalItems++;
          byCategory[result.category] = (byCategory[result.category] ?? 0) + 1;
        }

        for (const gap of result.gaps) {
          await db.insert(ahjCandidateItemsTable).values({
            companyId,
            wizardRunId: runId,
            packType,
            jurisdiction,
            status: 'draft',
            candidateKey: `gap_${result.category}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            citation: null,
            classification: 'gap_identified',
            factualTrigger: {},
            sourceLocator: {},
            gapsContext: { ...gap.gapsContext, description: gap.description },
            category: result.category,
          });
          totalGaps++;
        }
      }
    }

    // Virginia golden-set eval
    let evalReport: ReturnType<typeof scoreVirginiaGoldenSet> | null = null;
    if (jurisdiction.toLowerCase().includes('virginia')) {
      const candidateRows = await db
        .select({
          citation: ahjCandidateItemsTable.citation,
          candidateKey: ahjCandidateItemsTable.candidateKey,
          materialApplicability: ahjCandidateItemsTable.materialApplicability,
        })
        .from(ahjCandidateItemsTable)
        .where(
          and(
            eq(ahjCandidateItemsTable.wizardRunId, runId),
            sql`${ahjCandidateItemsTable.gapsContext} IS NULL`,
          ),
        );
      const gapRows = await db
        .select({ gapsContext: ahjCandidateItemsTable.gapsContext, description: ahjCandidateItemsTable.provisionSummary })
        .from(ahjCandidateItemsTable)
        .where(
          and(
            eq(ahjCandidateItemsTable.wizardRunId, runId),
            sql`${ahjCandidateItemsTable.gapsContext} IS NOT NULL`,
          ),
        );
      evalReport = scoreVirginiaGoldenSet(
        candidateRows.map((r) => ({
          citation: r.citation,
          candidateKey: r.candidateKey,
          materialApplicability: r.materialApplicability as string[] | undefined,
        })),
        gapRows.map((r) => ({
          gapsContext: (r.gapsContext as Record<string, unknown>) ?? {},
          description: r.description ?? '',
        })),
      );
    }

    await db
      .update(wizardRunsTable)
      .set({
        status: 'complete',
        completedAt: new Date(),
        categorySweep,
        stats: {
          itemsEmitted: totalItems,
          gapsEmitted: totalGaps,
          byCategory,
          ...(evalReport ? { evalReport } : {}),
        },
      })
      .where(eq(wizardRunsTable.id, runId));
  } catch (err) {
    await db
      .update(wizardRunsTable)
      .set({ status: 'failed', completedAt: new Date(), stats: { error: String(err) } })
      .where(eq(wizardRunsTable.id, runId));
  }
}

// ---------------------------------------------------------------------------
// POST /ahj-wizard/sources
// ---------------------------------------------------------------------------

const AHJ_ACQUISITION_BASES_TUPLE = [...AHJ_WIZARD_ACQUISITION_BASES] as [string, ...string[]];
const AHJ_PACK_TYPES_TUPLE = [...AHJ_PACK_TYPES] as [string, ...string[]];

const CodeSourceBody = z.object({
  jurisdiction: z.string().min(2).max(200),
  title: z.string().min(2).max(500),
  edition: z.string().min(1).max(100),
  effectiveDate: z.string().optional(),
  sourceUrl: z.string().optional(),
  acquisitionBasis: z.enum(AHJ_ACQUISITION_BASES_TUPLE),
  licensingNote: z.string().min(1).max(5000),
  corpusText: z.string().optional(),
});

router.post('/ahj-wizard/sources', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const body = CodeSourceBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const { acquisitionBasis, corpusText } = body.data;

  if (acquisitionBasis !== 'licensed_corpus' && corpusText) {
    return void res.status(400).json({
      error: 'corpusText upload is only allowed when acquisitionBasis is licensed_corpus',
    });
  }

  const storedCorpus = acquisitionBasis === 'licensed_corpus' && !!corpusText;

  const [source] = await db
    .insert(codeSourcesTable)
    .values({
      companyId: actor.companyId,
      jurisdiction: body.data.jurisdiction,
      title: body.data.title,
      edition: body.data.edition,
      effectiveDate: body.data.effectiveDate ?? null,
      sourceUrl: body.data.sourceUrl ?? null,
      acquisitionBasis,
      licensingNote: body.data.licensingNote,
      storedCorpus,
      accessedAt: new Date(),
      createdBy: actor.userId,
    })
    .returning();

  if (storedCorpus && corpusText) {
    const chunks = chunkCorpusBySection(corpusText);
    if (chunks.length > 0) {
      await db.insert(corpusChunksTable).values(
        chunks.map((c, idx) => ({
          codeSourceId: source.id,
          companyId: actor.companyId,
          sectionId: c.sectionId,
          chunkIndex: idx,
          text: c.text,
        })),
      );
    }
  }

  res.status(201).json({ source });
});

// ---------------------------------------------------------------------------
// GET /ahj-wizard/sources
// ---------------------------------------------------------------------------

router.get('/ahj-wizard/sources', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const sources = await db
    .select()
    .from(codeSourcesTable)
    .where(eq(codeSourcesTable.companyId, actor.companyId))
    .orderBy(desc(codeSourcesTable.createdAt));

  res.json({ sources });
});

// ---------------------------------------------------------------------------
// POST /ahj-wizard/runs
// ---------------------------------------------------------------------------

const WizardRunBody = z.object({
  jurisdiction: z.string().min(2).max(200),
  packType: z.enum(AHJ_PACK_TYPES_TUPLE),
  codeSourceIds: z.array(z.string()).default([]),
  categoryExcerpts: z.record(z.string(), z.string()).optional(),
  edition: z.string().optional(),
});

router.post('/ahj-wizard/runs', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const body = WizardRunBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const { jurisdiction, packType, codeSourceIds, categoryExcerpts, edition } = body.data;

  if (codeSourceIds.length > 0) {
    const owned = await db
      .select({ id: codeSourcesTable.id })
      .from(codeSourcesTable)
      .where(
        and(
          eq(codeSourcesTable.companyId, actor.companyId),
          inArray(codeSourcesTable.id, codeSourceIds),
        ),
      );
    if (owned.length !== codeSourceIds.length) {
      return void res.status(400).json({ error: 'One or more codeSourceIds not found for this company' });
    }
  }

  const [run] = await db
    .insert(wizardRunsTable)
    .values({
      companyId: actor.companyId,
      jurisdiction,
      packType,
      codeSourceIds,
      promptVersion: AHJ_WIZARD_PROMPT_VERSION,
      model: 'gemini-2.5-flash',
      status: 'running',
      createdBy: actor.userId,
    })
    .returning();

  setImmediate(() => {
    void runExtractionBackground({
      runId: run.id,
      companyId: actor.companyId,
      jurisdiction,
      packType: packType as 'ahj_roof' | 'ahj_siding',
      codeSourceIds,
      edition,
      categoryExcerpts: categoryExcerpts ?? {},
    });
  });

  res.status(202).json({ run });
});

// ---------------------------------------------------------------------------
// GET /ahj-wizard/runs
// ---------------------------------------------------------------------------

router.get('/ahj-wizard/runs', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const runs = await db
    .select()
    .from(wizardRunsTable)
    .where(eq(wizardRunsTable.companyId, actor.companyId))
    .orderBy(desc(wizardRunsTable.createdAt));

  const runIds = runs.map((r) => r.id);
  let countsRows: Array<{ wizard_run_id: string; status: string; cnt: number }> = [];
  if (runIds.length > 0) {
    const result = await db.execute(sql`
      SELECT wizard_run_id, status, COUNT(*)::int AS cnt
      FROM ahj_candidate_items
      WHERE wizard_run_id = ANY(${sql.raw(`ARRAY[${runIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')}]`)})
      GROUP BY wizard_run_id, status
    `);
    countsRows = result.rows as Array<{ wizard_run_id: string; status: string; cnt: number }>;
  }

  const countsMap: Record<string, Record<string, number>> = {};
  for (const row of countsRows) {
    if (!countsMap[row.wizard_run_id]) countsMap[row.wizard_run_id] = {};
    countsMap[row.wizard_run_id][row.status] = row.cnt;
  }

  res.json({ runs: runs.map((r) => ({ ...r, itemCounts: countsMap[r.id] ?? {} })) });
});

// ---------------------------------------------------------------------------
// DELETE /ahj-wizard/runs/:id
// ---------------------------------------------------------------------------

router.delete('/ahj-wizard/runs/:id', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const runId = String(req.params.id);
  const [run] = await db
    .select({ id: wizardRunsTable.id, status: wizardRunsTable.status })
    .from(wizardRunsTable)
    .where(and(eq(wizardRunsTable.id, runId), eq(wizardRunsTable.companyId, actor.companyId)))
    .limit(1);

  if (!run) return void res.status(404).json({ error: 'Run not found' });
  if (run.status === 'running') {
    return void res.status(409).json({ error: 'Cannot delete a run that is still in progress' });
  }

  // Candidate items cascade-delete automatically via FK onDelete: cascade
  await db.delete(wizardRunsTable).where(eq(wizardRunsTable.id, runId));

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// GET /ahj-wizard/runs/:id/items
// ---------------------------------------------------------------------------

router.get('/ahj-wizard/runs/:id/items', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const runId = String(req.params.id);
  const [run] = await db
    .select({ id: wizardRunsTable.id })
    .from(wizardRunsTable)
    .where(and(eq(wizardRunsTable.id, runId), eq(wizardRunsTable.companyId, actor.companyId)))
    .limit(1);

  if (!run) return void res.status(404).json({ error: 'Run not found' });

  const { category, status, minConfidence } = req.query as Record<string, string | undefined>;

  // Build conditions array — always has at least one element
  const baseCondition = eq(ahjCandidateItemsTable.wizardRunId, runId);
  const items = await db
    .select()
    .from(ahjCandidateItemsTable)
    .where(
      and(
        baseCondition,
        category ? eq(ahjCandidateItemsTable.category, category) : undefined,
        status ? eq(ahjCandidateItemsTable.status, status) : undefined,
      ),
    )
    .orderBy(desc(ahjCandidateItemsTable.confidence), ahjCandidateItemsTable.category);

  const filtered =
    minConfidence != null
      ? items.filter((i) => i.confidence == null || i.confidence >= parseFloat(minConfidence))
      : items;

  res.json({ items: filtered });
});

// ---------------------------------------------------------------------------
// PATCH /ahj-wizard/items/:id
// ---------------------------------------------------------------------------

const ItemPatchBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('verify'),
    factualTrigger: z.record(z.unknown()),
    /** Gap-to-citation conversion: supply non-empty citation to promote a gap marker. */
    citation: z.string().optional(),
    edition: z.string().optional(),
    provisionSummary: z.string().optional(),
    scopeConnection: z.string().optional(),
    amendmentNote: z.string().optional(),
    /** Required when promoting a gap marker (must not be gap_identified). */
    classification: z.string().optional(),
    /** Confirm or correct which materials this provision applies to. Required when needsMaterialReview=true. */
    materialApplicability: z.array(z.string().min(1)).min(1).optional(),
    needsMaterialReview: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('edit_verify'),
    factualTrigger: z.record(z.unknown()),
    citation: z.string().optional(),
    edition: z.string().optional(),
    provisionSummary: z.string().optional(),
    scopeConnection: z.string().optional(),
    amendmentNote: z.string().optional(),
    classification: z.string().optional(),
    materialApplicability: z.array(z.string().min(1)).min(1).optional(),
    needsMaterialReview: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('reject'),
    rejectionReason: z.string().min(1),
  }),
]);

router.patch('/ahj-wizard/items/:id', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const itemId = String(req.params.id);
  const [item] = await db
    .select()
    .from(ahjCandidateItemsTable)
    .where(
      and(eq(ahjCandidateItemsTable.id, itemId), eq(ahjCandidateItemsTable.companyId, actor.companyId)),
    )
    .limit(1);

  if (!item) return void res.status(404).json({ error: 'Item not found' });

  const body = ItemPatchBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const now = new Date();

  if (body.data.action === 'reject') {
    const [updated] = await db
      .update(ahjCandidateItemsTable)
      .set({ status: 'rejected', rejectionReason: body.data.rejectionReason, updatedAt: now })
      .where(eq(ahjCandidateItemsTable.id, itemId))
      .returning();
    return void res.json({ item: updated });
  }

  // ---- Gap marker gate ----
  // Gap items (gapsContext IS NOT NULL OR classification='gap_identified') cannot be verified
  // without first being converted to a real citation. Conversion requires:
  //   1. A non-empty `citation` in the request body
  //   2. A `classification` that is NOT 'gap_identified'
  const isGapItem = item.gapsContext != null || item.classification === 'gap_identified';
  if (isGapItem) {
    const incomingCitation = body.data.citation?.trim() ?? '';
    const incomingClassification = body.data.classification ?? '';
    if (!incomingCitation) {
      return void res.status(422).json({
        error: 'Gap markers cannot be verified without conversion. Provide a non-empty citation to convert this gap to a citation item.',
      });
    }
    if (!incomingClassification || incomingClassification === 'gap_identified') {
      return void res.status(422).json({
        error: "Gap markers must be reclassified (classification must be set and must not be 'gap_identified') before verifying.",
      });
    }
  }

  // needsMaterialReview gate — verifier must confirm or correct material tags
  // before marking the item verified. They must explicitly send materialApplicability
  // (even if they keep ["all"]) so the confirmation is intentional, not accidental.
  if (item.needsMaterialReview && !body.data.materialApplicability?.length) {
    return void res.status(422).json({
      error: 'This item has unconfirmed material applicability. Provide materialApplicability to confirm or correct the tags before verifying.',
      hint: 'Valid codes: all, asphalt_shingle, cedar_shake, wood_shingle, standing_seam_metal, metal_panel, vinyl_siding, aluminum_siding, fiber_cement, wood_siding',
    });
  }

  const { factualTrigger, action } = body.data;
  const editDiff: Record<string, unknown> = {};

  // Build typed update object (fields the schema accepts)
  type ItemUpdate = Parameters<ReturnType<typeof db.update<typeof ahjCandidateItemsTable>>['set']>[0];
  const updates: ItemUpdate = {
    status: action === 'edit_verify' ? 'edited_verified' : 'verified',
    verifiedBy: actor.userId,
    verifiedAt: now,
    factualTrigger,
    updatedAt: now,
    // When converting a gap, clear gapsContext so the item is no longer treated as a gap
    ...(isGapItem ? { gapsContext: null } : {}),
  };

  if (body.data.citation !== undefined) {
    if (item.citation !== body.data.citation) editDiff['citation'] = { from: item.citation, to: body.data.citation };
    updates.citation = body.data.citation;
  }
  if (body.data.edition !== undefined) {
    if (item.edition !== body.data.edition) editDiff['edition'] = { from: item.edition, to: body.data.edition };
    updates.edition = body.data.edition;
  }
  if (body.data.provisionSummary !== undefined) {
    if (item.provisionSummary !== body.data.provisionSummary) editDiff['provisionSummary'] = { from: item.provisionSummary, to: body.data.provisionSummary };
    updates.provisionSummary = body.data.provisionSummary;
  }
  if (body.data.scopeConnection !== undefined) {
    if (item.scopeConnection !== body.data.scopeConnection) editDiff['scopeConnection'] = { from: item.scopeConnection, to: body.data.scopeConnection };
    updates.scopeConnection = body.data.scopeConnection;
  }
  if (body.data.amendmentNote !== undefined) {
    if (item.amendmentNote !== body.data.amendmentNote) editDiff['amendmentNote'] = { from: item.amendmentNote, to: body.data.amendmentNote };
    updates.amendmentNote = body.data.amendmentNote;
  }
  if (body.data.classification !== undefined) {
    if (item.classification !== body.data.classification) editDiff['classification'] = { from: item.classification, to: body.data.classification };
    updates.classification = body.data.classification;
  }
  if (body.data.materialApplicability !== undefined) {
    const prev = JSON.stringify(item.materialApplicability);
    const next = JSON.stringify(body.data.materialApplicability);
    if (prev !== next) editDiff['materialApplicability'] = { from: item.materialApplicability, to: body.data.materialApplicability };
    updates.materialApplicability = body.data.materialApplicability;
    // Explicitly providing materialApplicability clears the review flag
    updates.needsMaterialReview = false;
  }
  if (body.data.needsMaterialReview !== undefined) {
    // Allow an explicit override (e.g. super-admin re-flagging an item for re-review)
    updates.needsMaterialReview = body.data.needsMaterialReview;
  }

  if (action === 'edit_verify' && Object.keys(editDiff).length > 0) {
    updates.editDiff = editDiff;
  }

  const [updated] = await db
    .update(ahjCandidateItemsTable)
    .set(updates)
    .where(eq(ahjCandidateItemsTable.id, itemId))
    .returning();

  res.json({ item: updated });
});

// ---------------------------------------------------------------------------
// POST /ahj-wizard/items/bulk-reject
// ---------------------------------------------------------------------------

const BulkRejectBody = z.object({
  itemIds: z.array(z.string()).min(1).max(200),
  rejectionReason: z.string().min(1),
});

router.post('/ahj-wizard/items/bulk-reject', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const body = BulkRejectBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const owned = await db
    .select({ id: ahjCandidateItemsTable.id })
    .from(ahjCandidateItemsTable)
    .where(
      and(
        inArray(ahjCandidateItemsTable.id, body.data.itemIds),
        eq(ahjCandidateItemsTable.companyId, actor.companyId),
      ),
    );

  if (owned.length !== body.data.itemIds.length) {
    return void res.status(400).json({ error: 'One or more item IDs not found for this company' });
  }

  await db
    .update(ahjCandidateItemsTable)
    .set({ status: 'rejected', rejectionReason: body.data.rejectionReason, updatedAt: new Date() })
    .where(inArray(ahjCandidateItemsTable.id, body.data.itemIds));

  res.json({ rejected: owned.length });
});

// ---------------------------------------------------------------------------
// POST /ahj-wizard/assemble
// ---------------------------------------------------------------------------

const AssembleBody = z.object({
  jurisdiction: z.string().min(2).max(200),
  packType: z.enum(AHJ_PACK_TYPES_TUPLE),
  runIds: z.array(z.string()).min(1),
});

router.post('/ahj-wizard/assemble', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  const body = AssembleBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.message });

  const { jurisdiction, packType, runIds } = body.data;

  const ownedRuns = await db
    .select({ id: wizardRunsTable.id })
    .from(wizardRunsTable)
    .where(
      and(inArray(wizardRunsTable.id, runIds), eq(wizardRunsTable.companyId, actor.companyId)),
    );
  if (ownedRuns.length !== runIds.length) {
    return void res.status(400).json({ error: 'One or more runIds not found for this company' });
  }

  // Collect all verified/edited_verified items, then enforce the gap-exclusion invariant
  // at query level: gap_identified classification and null/empty citations are never pack-eligible,
  // even if a status was incorrectly set (defense-in-depth below assembly gate).
  const verifiedItems = await db
    .select()
    .from(ahjCandidateItemsTable)
    .where(
      and(
        inArray(ahjCandidateItemsTable.wizardRunId, runIds),
        eq(ahjCandidateItemsTable.companyId, actor.companyId),
        eq(ahjCandidateItemsTable.jurisdiction, jurisdiction),
        eq(ahjCandidateItemsTable.packType, packType),
        inArray(ahjCandidateItemsTable.status, ['verified', 'edited_verified']),
        // Hard exclusion: unresolved gap markers are never pack-eligible
        sql`${ahjCandidateItemsTable.classification} != 'gap_identified'`,
        sql`${ahjCandidateItemsTable.gapsContext} IS NULL`,
        sql`${ahjCandidateItemsTable.citation} IS NOT NULL`,
        sql`length(trim(${ahjCandidateItemsTable.citation})) > 0`,
      ),
    );

  if (verifiedItems.length === 0) {
    // Diagnose why — give the caller an actionable explanation.
    const allItems = await db
      .select({
        status: ahjCandidateItemsTable.status,
        classification: ahjCandidateItemsTable.classification,
      })
      .from(ahjCandidateItemsTable)
      .where(
        and(
          inArray(ahjCandidateItemsTable.wizardRunId, runIds),
          eq(ahjCandidateItemsTable.companyId, actor.companyId),
          eq(ahjCandidateItemsTable.jurisdiction, jurisdiction),
          eq(ahjCandidateItemsTable.packType, packType),
        ),
      );

    const totalItems = allItems.length;
    const gapCount = allItems.filter(i => i.classification === 'gap_identified').length;
    const realCount = totalItems - gapCount;
    const unverifiedRealCount = allItems.filter(
      i => i.classification !== 'gap_identified' && i.status === 'draft',
    ).length;

    if (totalItems === 0) {
      return void res.status(422).json({
        error: 'No items found for this jurisdiction and pack type',
        details: ['Run the extraction wizard first to generate candidate items.'],
      });
    }

    if (gapCount === totalItems) {
      return void res.status(422).json({
        error: 'All extracted items are gap markers — no real code provisions were found in the source',
        details: [
          `The extraction produced ${gapCount} gap marker${gapCount !== 1 ? 's' : ''} (provisions the AI expected but could not locate in the supplied source text) and 0 citable code provisions.`,
          'Upload a source document that contains the full adopted code text (not just a table of contents or index), then start a new wizard run.',
        ],
        diagnostic: { totalItems, gapCount, realCount },
      });
    }

    return void res.status(422).json({
      error: 'No verified items ready to assemble',
      details: [
        `${unverifiedRealCount} item${unverifiedRealCount !== 1 ? 's' : ''} still need${unverifiedRealCount === 1 ? 's' : ''} verification.`,
        'Open the verification queue, review each item against the source, and mark them Verified or Edit & Verify.',
        'Draft and rejected items are never included in packs.',
      ],
      diagnostic: { totalItems, gapCount, realCount, unverifiedRealCount },
    });
  }

  const packItems = verifiedItems.map((item) => ({
    key: item.candidateKey,
    citationText: item.citation ?? item.provisionSummary ?? '(see provision summary)',
    edition: item.edition ?? undefined,
    trigger: (() => {
      const ft = item.factualTrigger as Record<string, unknown>;
      const parts = [ft.condition, ft.threshold, ft.exampleScenario].filter(Boolean);
      return parts.length > 0 ? parts.join('; ') : undefined;
    })(),
    active: true,
    classification: item.classification,
    scopeConnection: item.scopeConnection ?? undefined,
    materialApplicability: (item.materialApplicability as string[] | null) ?? ['all'],
  }));

  // Find next version
  const versionResult = await db.execute(sql`
    SELECT COALESCE(MAX(version), 0) AS max_version
    FROM ahj_packs
    WHERE company_id = ${actor.companyId}
      AND pack_type = ${packType}
      AND jurisdiction = ${jurisdiction}
  `);
  const maxVersion = Number((versionResult.rows[0] as Record<string, unknown>)?.max_version ?? 0);
  const nextVersion = maxVersion + 1;

  const [newPack] = await db
    .insert(ahjPacksTable)
    .values({
      companyId: actor.companyId,
      packType: packType as typeof AHJ_PACK_TYPES[number],
      jurisdiction,
      items: packItems,
      version: nextVersion,
      createdBy: actor.userId,
    })
    .returning();

  res.status(201).json({ pack: newPack, itemsAssembled: packItems.length });
});

// ---------------------------------------------------------------------------
// POST /ahj-wizard/seed-virginia
// Idempotent seed: inserts a pre-verified Virginia 2021 USBC roof pack.
// Safe to call multiple times; skips if a seed run already exists.
// ---------------------------------------------------------------------------

router.post('/ahj-wizard/seed-virginia', async (req: Request, res: Response) => {
  const actor = await requireSuperAdmin(req, res);
  if (!actor) return;

  // Idempotency: skip if we already seeded for this company
  const existing = await db
    .select({ id: wizardRunsTable.id })
    .from(wizardRunsTable)
    .where(
      and(
        eq(wizardRunsTable.companyId, actor.companyId),
        eq(wizardRunsTable.jurisdiction, 'Virginia'),
        eq(wizardRunsTable.model, 'seed'),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return void res.status(409).json({ error: 'Virginia seed already exists for this company', runId: existing[0].id });
  }

  // 1. Create code source
  const [source] = await db
    .insert(codeSourcesTable)
    .values({
      companyId: actor.companyId,
      jurisdiction: 'Virginia',
      title: '2021 Virginia Uniform Statewide Building Code (USBC) – Residential & Existing Building',
      edition: '2021',
      effectiveDate: 'January 18, 2025',
      sourceUrl: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html',
      acquisitionBasis: 'official_public_view',
      licensingNote: 'Public-access reference view of the Virginia USBC (2021 edition, effective January 18, 2025) as published by Virginia DHCD. Covers VRC, VCC (IBC framework), and VEBC. Used for citation reference and field training; no full-text reproduction.',
      storedCorpus: false,
      createdBy: actor.userId,
    })
    .returning({ id: codeSourcesTable.id });

  // 2. Create a completed wizard run (model = 'seed' marks it as manually seeded)
  const [run] = await db
    .insert(wizardRunsTable)
    .values({
      companyId: actor.companyId,
      jurisdiction: 'Virginia',
      packType: 'ahj_roof',
      codeSourceIds: [source.id],
      promptVersion: 'seed-1.0',
      model: 'seed',
      status: 'complete',
      completedAt: new Date(),
      stats: { itemsEmitted: 24, gapsEmitted: 1, seeded: true },
      createdBy: actor.userId,
    })
    .returning({ id: wizardRunsTable.id });

  const runId = run.id;
  const { companyId, userId } = actor;
  const now = new Date();

  // 3. Seed items — all verified except the gap marker
  const items: Parameters<typeof db.insert>[0] extends never ? never : Array<typeof ahjCandidateItemsTable.$inferInsert> = [
    // ── Governing framework ──────────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R103_VEBC_706_permit_inspection',
      citation: 'VRC R103; VEBC §706',
      edition: '2021',
      category: 'permits_inspections',
      classification: 'permit_inspection',
      provisionSummary: 'Occupancy path: detached 1–2 family homes and qualifying townhouses → 2021 VRC; commercial, multifamily, mixed-use → 2021 VCC (IBC framework); repair/reroofing/alteration of existing structures → 2021 VEBC plus applicable VRC/VCC new-work requirements.',
      factualTrigger: { trigger: 'All Virginia roof permits', triggerDescription: 'Determines which code path governs; must be confirmed before code citations are selected' },
      scopeConnection: 'Statewide baseline; applies to all Virginia jurisdictions under 2021 USBC effective January 18, 2025',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 Virginia USBC' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.98,
    },

    // ── Structural / design loads ──────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R301_R802_IBC_Ch16_structural_attachment',
      citation: 'VRC R301.2.1; R802; VCC/IBC Chapter 16; §1609',
      edition: '2021',
      category: 'structural',
      classification: 'structural_attachment',
      provisionSummary: 'Roof design loads: wind speed, exposure category, roof height, topographic effects, snow/ice, roof live load, and load path must be determined for the site. Applies to both residential (VRC) and commercial (VCC/IBC). Engineering review required where work affects load path or roof assembly.',
      factualTrigger: { trigger: 'All roof replacements and new roofs', triggerDescription: 'Design loads govern fastener selection, sheathing attachment, and structural member sizing' },
      scopeConnection: 'All materials and occupancies; load path review triggered whenever structural members or connections are altered',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R301.2.1, R802 / VCC IBC Ch16 §1609' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.98,
    },

    // ── Roof framing ───────────────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R802_VEBC_502_structural_attachment',
      citation: 'VRC R802; VEBC §502',
      edition: '2021',
      category: 'structural',
      classification: 'structural_attachment',
      provisionSummary: 'Roof framing: rafters, ceiling joists, ridge boards/beams, collar ties, rafter ties, and uplift connections must comply with VRC R802. New repair members and connections must meet requirements for comparable new construction (VEBC §502).',
      factualTrigger: { trigger: 'Structural deck or framing repair/replacement', triggerDescription: 'Triggered whenever decking or framing members are replaced, repaired, or altered' },
      scopeConnection: 'VRC R802 for residential; VEBC §502 for repair work on existing structures',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R802; VEBC §502' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Roof sheathing / decking ───────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R803_IBC_1504_deck_attachment',
      citation: 'VRC R803; VCC/IBC §1504.1',
      edition: '2021',
      category: 'decking',
      classification: 'deck_attachment',
      provisionSummary: 'Roof sheathing/decking: material, structural adequacy, attachment pattern, support spacing, deterioration, and compatibility with the proposed roof system must be verified. Deteriorated or inadequate decking must be repaired or replaced before new covering is installed.',
      factualTrigger: { trigger: 'All roofing projects', triggerDescription: 'Deck condition and attachment must be confirmed before new covering proceeds; prerequisite gate for all roof systems' },
      scopeConnection: 'Applies to all materials; deck condition is a universal prerequisite for any new roof covering installation',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R803; VCC §1504.1' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Weather protection (general) ───────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R903_1_IBC_1503_flashing',
      citation: 'VRC R903.1; VCC/IBC §1503.1',
      edition: '2021',
      category: 'general_weather_protection',
      classification: 'flashing',
      provisionSummary: 'Roof assembly must provide weather protection; the roof covering alone is not the entire water-control system. Flashing, drainage, underlayment, and all weather-protection components are required as part of the complete assembly.',
      factualTrigger: { trigger: 'All roof covering installations', triggerDescription: 'Weather protection applies to the complete assembly — field of coverage alone is insufficient' },
      scopeConnection: 'General requirement for all residential and commercial roof assemblies',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R903.1; VCC §1503.1' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.96,
    },

    // ── Flashing (general) ─────────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R903_2_IBC_1503_2_flashing',
      citation: 'VRC R903.2; VCC/IBC §1503.2',
      edition: '2021',
      category: 'flashings',
      classification: 'flashing',
      provisionSummary: 'Flashing required at all wall intersections, roof slope/direction changes, valleys, chimneys, skylights, penetrations, and water-entry points. Material-specific flashing details in R905.x supplement these general requirements.',
      factualTrigger: { trigger: 'Any roof-to-wall, chimney, skylight, or penetration interface', triggerDescription: 'All interfaces and transitions require compliant flashing; material-specific sections add further detail' },
      scopeConnection: 'All materials and occupancies; material-specific R905.x flashing sections build on this baseline',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R903.2; VCC §1503.2' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.98,
    },

    // ── Drainage ───────────────────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R903_4_IBC_1503_4_flashing',
      citation: 'VRC R903.4; VCC/IBC §1503.4',
      edition: '2021',
      category: 'flashings',
      classification: 'flashing',
      provisionSummary: 'Roof drainage, scuppers/gutters where required, and prevention of water accumulation. Drainage design must be appropriate for roof type, slope, and local precipitation conditions.',
      factualTrigger: { trigger: 'All roof covering installations; low-slope or flat roofs especially', triggerDescription: 'Drainage path and ponding prevention must be addressed for every project' },
      scopeConnection: 'All materials; particularly critical for low-slope roofs where ponding risk exists',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R903.4; VCC §1503.4' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.95,
    },

    // ── Fire classification (general) ──────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R902_1_IBC_1505_fire_separation',
      citation: 'VRC R902.1; Table R902.1; VCC/IBC §1505',
      edition: '2021',
      category: 'fire_classification',
      classification: 'fire_separation',
      provisionSummary: 'Class A/B/C roof-covering requirements based on occupancy, location, exposure, and assembly. Fire classification must be confirmed for the specific product, listing, and assembly — not assumed from material type alone. WUI zones and fire-area overlays may impose higher requirements.',
      factualTrigger: { trigger: 'All roof covering material selection', triggerDescription: 'Required fire class must match occupancy and location; product listing must confirm the fire rating for the complete assembly' },
      scopeConnection: 'All materials and occupancies statewide; WUI and fire-area overlays may impose Class A requirements',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R902.1, Table R902.1; VCC §1505' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.98,
    },

    // ── Ventilation ────────────────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R806_ventilation',
      citation: 'VRC R806',
      edition: '2021',
      category: 'ventilation',
      classification: 'ventilation',
      provisionSummary: 'Intake/exhaust ventilation: net-free vent area, ventilation distribution, and compliant unvented-roof assemblies. Ventilation must be addressed for the complete attic/roof assembly; unvented roof designs require the specific compliance path under R806.',
      factualTrigger: { trigger: 'All roof system replacements and attic modifications', triggerDescription: 'Ventilation adequacy must be confirmed or re-established when the roof assembly is altered' },
      scopeConnection: 'Residential roof assemblies under VRC; VCC commercial provisions apply for non-residential',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R806' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Energy / insulation ────────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VECC_energy_code',
      citation: 'Virginia Energy Conservation Code',
      edition: '2021',
      category: 'energy',
      classification: 'energy_code',
      provisionSummary: 'Added roof insulation, cathedral ceilings, unvented roofs, condensation control, and thermal-envelope changes must comply with the Virginia Energy Conservation Code. Applies where the thermal envelope or insulation assembly is changed.',
      factualTrigger: { trigger: 'Projects adding insulation, modifying cathedral ceilings, or constructing unvented roofs', triggerDescription: 'Energy code compliance triggered by insulation additions or roof assembly type changes' },
      scopeConnection: 'Important for insulation additions, cathedral ceilings, compact roofs, and unvented roof assemblies',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: 'Virginia Energy Conservation Code (2021 USBC edition)' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.95,
    },

    // ── Reroofing / recover (primary) ──────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VEBC_706_layering_tearoff_primary',
      citation: 'VEBC §706',
      edition: '2021',
      category: 'reroof_recover',
      classification: 'layering_tearoff',
      provisionSummary: 'Primary Virginia reroofing section. Recover may be permitted over one sound existing roof layer if the new system is approved for recover and manufacturer requirements are met. Two or more existing roof-covering applications: additional recover generally prohibited — tear-off required.',
      factualTrigger: { trigger: 'All reroofing and recover projects on existing structures', triggerDescription: 'Number of existing roof layers must be confirmed before a recover can be authorized' },
      scopeConnection: 'All reroofing work on existing Virginia buildings; VEBC §706 is the controlling section statewide',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 Virginia Existing Building Code §706' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.98,
    },

    // ── Reroofing — substrate condition ───────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VEBC_706_R803_layering_tearoff_substrate',
      citation: 'VEBC §706; VRC R803',
      edition: '2021',
      category: 'reroof_recover',
      classification: 'layering_tearoff',
      provisionSummary: 'Water-soaked, deteriorated, or structurally inadequate existing base requires tear-off and substrate repair before new covering is installed. A recover assembly is never a shortcut around wet, rotten, delaminated, or poorly attached decking.',
      factualTrigger: { trigger: 'Reroofing projects with suspect deck condition', triggerDescription: 'Deck inspection is mandatory before recover authorization; substrate must be confirmed sound' },
      scopeConnection: 'All existing structures statewide; deck inspection is a prerequisite gate before recover authorization',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VEBC §706; VRC R803' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.98,
    },

    // ── Asphalt shingle — underlayment ─────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_1_1_R905_2_7_underlayment',
      citation: 'VRC R905.1.1; R905.2.7',
      edition: '2021',
      category: 'underlayment',
      classification: 'underlayment',
      provisionSummary: 'Asphalt shingle underlayment: type and installation must meet both general (R905.1.1) and asphalt-specific (R905.2.7) rules. At slopes below the standard minimum, an enhanced underlayment configuration is required.',
      factualTrigger: { trigger: 'All asphalt shingle installations; low-slope trigger applies below minimum standard slope', triggerDescription: 'Slope must be confirmed before underlayment product and method are selected' },
      scopeConnection: 'Asphalt shingle installations; underlayment must be compatible with slope and the product system',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R905.1.1; R905.2.7' },
      materialApplicability: ['asphalt_shingle'], needsMaterialReview: false, confidence: 0.98,
    },

    // ── Ice and water shield ───────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_1_2_ice_water_shield',
      citation: 'VRC R905.1.2',
      edition: '2021',
      category: 'ice_water_shield',
      classification: 'ice_water_shield',
      provisionSummary: 'Ice barrier required in areas with an established history of eave ice-dam backup. Extends from eave edge to at least 24 inches inside the exterior wall line. Not an automatic statewide requirement — local AHJ must confirm whether the locality has established ice-dam history and enforces this provision.',
      factualTrigger: { trigger: 'Localities with established history of eave ice-dam backup; AHJ confirmation required', triggerDescription: 'Ice barrier is locality-specific in Virginia; do not assume required or excluded without AHJ confirmation' },
      scopeConnection: 'Mountain and western Virginia localities more likely to enforce; coastal and tidewater areas generally not enforced — confirm with each local building department',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R905.1.2' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Asphalt — drip edge ────────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_2_8_5_drip_edge_metal',
      citation: 'VRC R905.2.8.5',
      edition: '2021',
      category: 'drip_edge',
      classification: 'drip_edge_metal',
      provisionSummary: 'Drip edge required at eaves and gables for asphalt shingles. Sequence is mandatory: over underlayment at eaves, under underlayment at rakes. Incorrect sequence is a common inspection failure point.',
      factualTrigger: { trigger: 'All asphalt shingle installations', triggerDescription: 'Drip edge is required; eave vs. rake installation sequence differs and must be verified in the field' },
      scopeConnection: 'Asphalt shingle installations; sequence requirement is a frequent field error and inspection failure',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R905.2.8.5' },
      materialApplicability: ['asphalt_shingle'], needsMaterialReview: false, confidence: 0.98,
    },

    // ── Asphalt — valley construction ──────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_2_8_2_valley_construction',
      citation: 'VRC R905.2.8.2',
      edition: '2021',
      category: 'valley_construction',
      classification: 'valley_construction',
      provisionSummary: 'Valley lining and installation sequence must meet asphalt-shingle valley requirements. Open, closed, and woven valley methods each have specific sequencing and material requirements; method must comply with both the code section and manufacturer instructions.',
      factualTrigger: { trigger: 'All asphalt shingle installations with roof valleys', triggerDescription: 'Valley method selection and installation sequence must comply with R905.2.8.2 and product instructions' },
      scopeConnection: 'Asphalt shingle installations with valleys; method must be pre-selected and compliant before laying begins',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R905.2.8.2' },
      materialApplicability: ['asphalt_shingle'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Asphalt — fasteners / wind resistance ──────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_2_6_R301_structural_attachment',
      citation: 'VRC R905.2.6; R301.2.1; VCC/IBC §1504.3; §1609',
      edition: '2021',
      category: 'wind_resistance',
      classification: 'structural_attachment',
      provisionSummary: 'Asphalt shingle fastener type, count, placement, and nail-line position must comply with code. Site wind criteria and manufacturer instructions may require enhanced fastening (e.g., 6-nail pattern) beyond the standard minimum.',
      factualTrigger: { trigger: 'All asphalt shingle installations; enhanced fastening triggered by wind exposure category', triggerDescription: 'High-wind areas, coastal exposure, and elevated structures require fastening pattern matched to the product listing and site wind conditions' },
      scopeConnection: 'All asphalt shingle installations; fastening pattern must match product listing and site design wind criteria',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R905.2.6; R301.2.1; VCC §1504.3 §1609' },
      materialApplicability: ['asphalt_shingle'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Cedar shingle ──────────────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_8_IBC_1507_8_underlayment',
      citation: 'VRC R905.8; VCC/IBC §1507.8',
      edition: '2021',
      category: 'underlayment',
      classification: 'underlayment',
      provisionSummary: 'Wood/cedar shingle: generally minimum 3:12 slope; underlayment, corrosion-resistant fasteners, exposure, and fire classification requirements apply. Verify product listing, fire classification, fire-treatment requirement, and deck type (solid vs. spaced sheathing where permitted).',
      factualTrigger: { trigger: 'All wood/cedar shingle installations', triggerDescription: 'Cedar shingles (R905.8) and cedar shakes (R905.9) are separate code sections with different slope and installation requirements — do not treat interchangeably' },
      scopeConnection: 'Wood/cedar shingle systems; VRC R905.8 residential, IBC §1507.8 commercial',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R905.8; VCC §1507.8' },
      materialApplicability: ['wood_shingle'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Cedar shake ────────────────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_9_IBC_1507_9_underlayment',
      citation: 'VRC R905.9; VCC/IBC §1507.9',
      edition: '2021',
      category: 'underlayment',
      classification: 'underlayment',
      provisionSummary: 'Wood/cedar shake: generally minimum 4:12 slope; underlayment/interlayment, corrosion-resistant fasteners, exposure, deck configuration, valley details, and fire classification requirements apply. Shingle vs. shake classification must be confirmed before citing this section.',
      factualTrigger: { trigger: 'All wood/cedar shake installations', triggerDescription: 'Minimum slope for cedar shake (4:12) differs from cedar shingle (3:12); interlayment is shake-specific' },
      scopeConnection: 'Wood/cedar shake systems; VRC R905.9 residential, IBC §1507.9 commercial',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R905.9; VCC §1507.9' },
      materialApplicability: ['cedar_shake'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Cedar — fire classification ────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_8_R905_9_R902_fire_separation',
      citation: 'VRC R905.8; R905.9; R902.1; Table R902.1',
      edition: '2021',
      category: 'fire_classification',
      classification: 'fire_separation',
      provisionSummary: 'Cedar shingle and shake fire classification: fire retardant treatment may be required to meet the required roof classification. Cedar is not code-compliant simply because it is cedar — product listing and fire classification must be verified. WUI, fire-area, historic-district, and architectural-review overlays may impose additional requirements.',
      factualTrigger: { trigger: 'All cedar shingle and shake installations', triggerDescription: 'Untreated cedar may not meet the required classification; treatment and product listing must be confirmed' },
      scopeConnection: 'Cedar shingle and shake systems; local fire-area or WUI overlay may impose Class A requirement',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R905.8; R905.9; R902.1' },
      materialApplicability: ['cedar_shake', 'wood_shingle'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Standing-seam metal — underlayment ─────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_10_IBC_1507_4_underlayment',
      citation: 'VRC R905.10; VCC/IBC §1507.4',
      edition: '2021',
      category: 'underlayment',
      classification: 'underlayment',
      provisionSummary: 'Metal panel systems (including standing-seam): underlayment must meet the approved panel-system and slope requirements. Standing seam is a panel profile, not a standalone code category — the exact panel system, tested assembly, clip pattern, substrate, slope listing, and manufacturer instructions control.',
      factualTrigger: { trigger: 'All standing-seam and metal panel roof installations', triggerDescription: 'Underlayment selection must match the approved system listing; generic underlayment is not acceptable without system confirmation' },
      scopeConnection: 'Metal roof panel systems; VRC R905.10 residential, IBC §1507.4 commercial',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R905.10; VCC §1507.4' },
      materialApplicability: ['standing_seam_metal', 'metal_panel'], needsMaterialReview: false, confidence: 0.96,
    },

    // ── Standing-seam metal — wind uplift ──────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R905_10_IBC_1504_wind_structural_attachment',
      citation: 'VRC R301.2.1; R905.10; VCC/IBC §1504.3; §1609',
      edition: '2021',
      category: 'wind_resistance',
      classification: 'structural_attachment',
      provisionSummary: 'Metal panel wind uplift requires tested/calculated assembly performance for the site wind criteria — not merely panel gauge or profile. Clip spacing, panel length, expansion provisions, and attachment details must follow the manufacturer system requirements and cannot be improvised.',
      factualTrigger: { trigger: 'All metal panel roof installations', triggerDescription: 'Assembly-level wind uplift performance must be documented; gauge alone does not constitute compliance' },
      scopeConnection: 'Metal roof panel systems; standing-seam uplift testing is system-specific and must be confirmed for site conditions',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R301.2.1; R905.10; VCC §1504.3 §1609' },
      materialApplicability: ['standing_seam_metal', 'metal_panel'], needsMaterialReview: false, confidence: 0.96,
    },

    // ── Standing-seam metal — flashing / thermal movement ──────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'VRC_R903_2_R903_4_metal_flashing',
      citation: 'VRC R903.2–R903.4; VCC/IBC §1503',
      edition: '2021',
      category: 'flashings',
      classification: 'flashing',
      provisionSummary: 'Metal panel roof: all edges, transitions, penetrations, curbs, walls, valleys, and drainage points require compatible flashing. Thermal movement design (clip spacing, panel length, expansion provisions) must follow manufacturer requirements. Corrosion control: verify dissimilar-metal contact, treated-lumber compatibility, fastener material, and flashing compatibility.',
      factualTrigger: { trigger: 'All metal panel roof installations with transitions, penetrations, or wall interfaces', triggerDescription: 'Thermal movement and corrosion compatibility requirements are system-specific and cannot be substituted' },
      scopeConnection: 'Metal roof panel systems; especially critical at eave, ridge, hip, valley, wall, and penetration transitions',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R903.2–R903.4; VCC §1503' },
      materialApplicability: ['standing_seam_metal', 'metal_panel'], needsMaterialReview: false, confidence: 0.95,
    },

    // ── Permits and inspections ────────────────────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'USBC_local_36_99_permit_inspection',
      citation: 'USBC Local Enforcement; Virginia Code §36-99; 13VAC5-63',
      edition: '2021',
      category: 'permits_inspections',
      classification: 'permit_inspection',
      provisionSummary: 'The USBC is statewide but enforced by the local building department. Inspection sequence may include hold points for: deck repair, dry-in/underlayment, flashing, final roof, and structural work before concealment. Confirm required inspection hold points with the AHJ before work begins — missing a hold point can require uncovering completed work.',
      factualTrigger: { trigger: 'All permitted roof work in Virginia', triggerDescription: 'Required inspection sequence varies by locality; failure to confirm hold points risks requiring re-exposure of finished work' },
      scopeConnection: 'Applies statewide; locality-specific requirements must be confirmed with the local building department before project start',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: 'USBC Local Enforcement; Virginia Code §36-99; 13VAC5-63' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.97,
    },

    // ── Design wind criteria (AHJ-specific) ───────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'verified', verifiedBy: userId, verifiedAt: now,
      candidateKey: 'USBC_R301_wind_criteria_permit_inspection',
      citation: 'VRC R301.2.1; VCC/IBC §1609; USBC Local Enforcement',
      edition: '2021',
      category: 'permits_inspections',
      classification: 'permit_inspection',
      provisionSummary: 'Design wind criteria must be confirmed with the local AHJ: wind speed, exposure category, roof height, topographic effects, risk category, and coastal conditions. Mountain and western Virginia conditions can affect structural and ice-barrier analysis. Coastal Virginia areas require specific wind design inputs.',
      factualTrigger: { trigger: 'All roof projects in coastal, elevated, or high-wind exposure zones', triggerDescription: 'Site-specific wind criteria affect fastener selection, underlayment, and structural requirements' },
      scopeConnection: 'Particularly important in coastal Virginia, Tidewater, and elevated mountain zones; confirm with AHJ before finalizing fastening schedules',
      sourceLocator: { url: 'https://www.dhcd.virginia.gov/index.php/va-codes/building-codes.html', note: '2021 VRC R301.2.1; VCC §1609; USBC Local Enforcement' },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.96,
    },

    // ── GAP: Ice-barrier locality enforcement ──────────────────────────
    {
      companyId, wizardRunId: runId, packType: 'ahj_roof', jurisdiction: 'Virginia',
      status: 'draft',
      candidateKey: `gap_ice_barrier_locality_${Date.now()}`,
      citation: null,
      edition: '2021',
      category: 'ice_water_shield',
      classification: 'gap_identified',
      provisionSummary: null,
      factualTrigger: {},
      scopeConnection: null,
      sourceLocator: {},
      gapsContext: {
        gap: 'Ice-barrier locality enforcement is not uniform statewide',
        detail: 'VRC R905.1.2 triggers ice barrier only where the local AHJ has established a history of eave ice-dam backup. Virginia DHCD does not publish a definitive list of qualifying localities. Each local building department must be queried directly to confirm whether they enforce R905.1.2 for the project location.',
        action: 'Obtain written confirmation from the local building department on whether ice barrier is required before each project in an unfamiliar locality.',
      },
      materialApplicability: ['all'], needsMaterialReview: false, confidence: 0.95,
    },
  ];

  await db.insert(ahjCandidateItemsTable).values(items as typeof ahjCandidateItemsTable.$inferInsert[]);

  res.status(201).json({
    message: 'Virginia seeded successfully',
    runId,
    sourceId: source.id,
    itemsInserted: items.length,
    verified: items.filter((i) => i.status === 'verified').length,
    gaps: items.filter((i) => i.classification === 'gap_identified').length,
  });
});

export default router;

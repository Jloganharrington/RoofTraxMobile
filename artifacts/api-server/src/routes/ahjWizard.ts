/**
 * AHJ Wizard API — code sources, extraction runs, verification queue,
 * and pack assembly. All endpoints require super_admin.
 *
 * Architecture: ingest → extract → verify (human) → activate.
 * Draft and rejected items are NEVER citable, renderable, or pack-eligible.
 */

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
  if ((profile?.role ?? 'field_rep') !== 'super_admin') {
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

export default router;

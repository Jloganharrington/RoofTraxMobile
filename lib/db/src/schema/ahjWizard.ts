/**
 * AHJ Wizard schema — code sources, extraction runs, candidate item queue,
 * and corpus chunks. All per-company; the wizard output is never a live pack:
 * every candidate is born draft and requires human verification before it can
 * enter an ahj_packs version.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { companiesTable, usersTable } from './auth';

// ---------------------------------------------------------------------------
// Enumerations (stored as varchar with runtime validation)
// ---------------------------------------------------------------------------

export const AHJ_WIZARD_ACQUISITION_BASES = [
  'licensed_corpus',
  'official_public_view',
  'print_reference',
] as const;
export type AhjWizardAcquisitionBasis = (typeof AHJ_WIZARD_ACQUISITION_BASES)[number];

export const AHJ_WIZARD_RUN_STATUSES = ['running', 'complete', 'failed'] as const;
export type AhjWizardRunStatus = (typeof AHJ_WIZARD_RUN_STATUSES)[number];

export const AHJ_CANDIDATE_STATUSES = ['draft', 'verified', 'edited_verified', 'rejected'] as const;
export type AhjCandidateStatus = (typeof AHJ_CANDIDATE_STATUSES)[number];

export const AHJ_CANDIDATE_CLASSIFICATIONS = [
  'fire_separation',
  'structural_attachment',
  'ventilation',
  'energy_code',
  'underlayment',
  'ice_water_shield',
  'flashing',
  'deck_attachment',
  'valley_construction',
  'ridge_hip',
  'penetrations',
  'drip_edge_metal',
  'layering_tearoff',
  'permit_inspection',
  'gap_identified',
] as const;
export type AhjCandidateClassification = (typeof AHJ_CANDIDATE_CLASSIFICATIONS)[number];

// One controlled vocabulary for material codes — matches the field app's material_set values.
export const MATERIAL_APPLICABILITY_CODES = [
  'all',
  'asphalt_shingle',
  'cedar_shake',
  'wood_shingle',
  'standing_seam_metal',
  'metal_panel',
  'vinyl_siding',
  'aluminum_siding',
  'fiber_cement',
  'wood_siding',
] as const;
export type MaterialApplicabilityCode = (typeof MATERIAL_APPLICABILITY_CODES)[number];

// ---------------------------------------------------------------------------
// code_sources — registered jurisdiction code corpus metadata
// ---------------------------------------------------------------------------

/**
 * A registered code corpus source for a company's AHJ jurisdiction library.
 * When acquisitionBasis === 'licensed_corpus' the full document text may be
 * stored in corpus_chunks; otherwise only metadata + URL is stored.
 */
export const codeSourcesTable = pgTable('code_sources', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),
  jurisdiction: text('jurisdiction').notNull(),
  title: text('title').notNull(),
  edition: text('edition').notNull(),
  effectiveDate: text('effective_date'),
  sourceUrl: text('source_url'),
  acquisitionBasis: varchar('acquisition_basis').notNull(),
  licensingNote: text('licensing_note').notNull(),
  storedCorpus: boolean('stored_corpus').notNull().default(false),
  accessedAt: timestamp('accessed_at', { withTimezone: true }),
  createdBy: varchar('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CodeSource = typeof codeSourcesTable.$inferSelect;
export type NewCodeSource = typeof codeSourcesTable.$inferInsert;

// ---------------------------------------------------------------------------
// corpus_chunks — section-level text chunks for licensed corpora
// ---------------------------------------------------------------------------

/**
 * Individual section chunks extracted from a licensed corpus document.
 * Chunked by section boundary (R###, Section ###, etc.) at upload time.
 * Retrieval for extraction passes uses keyword match on sectionId.
 */
export const corpusChunksTable = pgTable('corpus_chunks', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  codeSourceId: varchar('code_source_id')
    .notNull()
    .references(() => codeSourcesTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),
  sectionId: text('section_id').notNull(),
  chunkIndex: integer('chunk_index').notNull().default(0),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CorpusChunk = typeof corpusChunksTable.$inferSelect;

// ---------------------------------------------------------------------------
// wizard_runs — a single extraction sweep across 14 categories
// ---------------------------------------------------------------------------

/**
 * One AHJ Wizard extraction run for a jurisdiction + packType pair.
 * Created with status 'running', updated to 'complete'/'failed' when all
 * 14-category Gemini passes finish. Stats and categorySweep written at
 * completion. Virginia eval score written to stats.evalReport when applicable.
 */
export const wizardRunsTable = pgTable('wizard_runs', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),
  jurisdiction: text('jurisdiction').notNull(),
  packType: varchar('pack_type').notNull(),
  codeSourceIds: jsonb('code_source_ids').notNull().default([]),
  promptVersion: text('prompt_version').notNull(),
  model: text('model').notNull().default('gemini-2.5-flash'),
  categorySweep: jsonb('category_sweep').notNull().default({}),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  stats: jsonb('stats').notNull().default({}),
  status: varchar('status').notNull().default('running'),
  createdBy: varchar('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WizardRun = typeof wizardRunsTable.$inferSelect;

// ---------------------------------------------------------------------------
// ahj_candidate_items — per-candidate items from extraction runs
// ---------------------------------------------------------------------------

/**
 * A single code citation candidate or gap marker produced by one category
 * extraction pass. Born as 'draft'; human must confirm/correct and mark
 * 'verified'/'edited_verified' before the item is pack-eligible. 'rejected'
 * items are permanently excluded. Gap markers have citation = null and
 * gapsContext set; they can only be Rejected or converted to a full citation.
 *
 * factualTrigger must be explicitly confirmed or corrected on every verify
 * action — PATCH rejects verify attempts that omit this field.
 *
 * Draft and rejected items are never citable, renderable, or pack-eligible.
 */
export const ahjCandidateItemsTable = pgTable('ahj_candidate_items', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),
  wizardRunId: varchar('wizard_run_id')
    .notNull()
    .references(() => wizardRunsTable.id, { onDelete: 'cascade' }),
  packType: varchar('pack_type').notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  status: varchar('status').notNull().default('draft'),
  /** Stable key for deduplication (citation + category slug). */
  candidateKey: text('candidate_key').notNull(),
  /** Null for gap markers. */
  citation: text('citation'),
  edition: text('edition'),
  provisionSummary: text('provision_summary'),
  classification: varchar('classification').notNull(),
  /** Required; must be confirmed/corrected on every verify action. */
  factualTrigger: jsonb('factual_trigger').notNull().default({}),
  scopeConnection: text('scope_connection'),
  /** { section, page, chunkId? } for corpus sources; { url, note } for non-corpus. */
  sourceLocator: jsonb('source_locator').notNull().default({}),
  amendmentNote: text('amendment_note'),
  confidence: doublePrecision('confidence'),
  /** Set on gap markers only. */
  gapsContext: jsonb('gaps_context'),
  /** Lint note set when provisionSummary/scopeConnection triggers CONTRACTOR_LANE_POLICY. */
  lintNote: text('lint_note'),
  /** Set by the verifier. */
  verifiedBy: varchar('verified_by').references(() => usersTable.id, { onDelete: 'set null' }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  /** Diff of fields changed by the verifier before marking edited_verified. */
  editDiff: jsonb('edit_diff'),
  /** Required when status = 'rejected'. */
  rejectionReason: text('rejection_reason'),
  category: text('category').notNull(),
  /**
   * Which installed materials this provision applies to.
   * ["all"] for material-agnostic provisions (fire separation, structural,
   * ventilation, permits, reroofing limits). Specific codes for provisions
   * that live inside a per-material chapter (e.g. R905.2 → asphalt_shingle).
   * One controlled list — matches the field app's material_set vocabulary.
   */
  materialApplicability: jsonb('material_applicability').notNull().default(['all']),
  /**
   * Set true when extraction auto-tagged ["all"] for a material-sensitive
   * category (underlayment, ice barrier, valley, ridge/hip). Verifier must
   * confirm or correct the tags before marking the item verified.
   */
  needsMaterialReview: boolean('needs_material_review').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AhjCandidateItem = typeof ahjCandidateItemsTable.$inferSelect;
export type NewAhjCandidateItem = typeof ahjCandidateItemsTable.$inferInsert;

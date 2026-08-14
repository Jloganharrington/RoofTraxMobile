/**
 * AHJ Master Library schema — platform-level (no company_id).
 * Tenants generate packs in-company via the AHJ Wizard; a super_admin
 * promotes a verified company pack up to the master library.  New tenants
 * in that jurisdiction adopt from master, copying items into a company-scoped
 * ahj_packs row and recording the event in ahj_master_adoptions.
 *
 * Contribution flow:  company ahj_packs  →  promote  →  ahj_master_packs
 * Distribution flow:  ahj_master_packs   →  adopt    →  company ahj_packs
 */

import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { companiesTable, usersTable } from './auth';
import { ahjPacksTable } from './inspections';

// ---------------------------------------------------------------------------
// ahj_master_packs
// ---------------------------------------------------------------------------

/**
 * A published, jurisdiction-keyed version of an AHJ pack.
 * Unique on (state, county, pack_type, version); promoting into an existing
 * (state, county, pack_type) creates version N+1 and sets superseded_by_id
 * on the prior version. Published versions are immutable.
 *
 * items carries citation, edition, provisionSummary, classification,
 * factualTrigger, scopeConnection, and materialApplicability only —
 * never corpus text, chunk references, or source locators.
 */
export const ahjMasterPacksTable = pgTable(
  'ahj_master_packs',
  {
    id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Two-letter uppercase state code, e.g. "VA". */
    state: varchar('state', { length: 2 }).notNull(),
    /** County name, e.g. "Fairfax County". Empty string for state-wide packs. */
    county: varchar('county', { length: 255 }).notNull(),
    packType: varchar('pack_type').notNull(),
    version: integer('version').notNull().default(1),
    /** Research output items only — no verbatim source text or corpus refs. */
    items: jsonb('items').notNull().default([]),
    codeCycle: varchar('code_cycle', { length: 100 }),
    /**
     * Set on the previous version when a new version is promoted.
     * Forms an immutable version chain — never mutate a published version.
     */
    supersededById: varchar('superseded_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('ahj_master_packs_state_county_type_version_uidx').on(
      t.state,
      t.county,
      t.packType,
      t.version,
    ),
  ],
);

export type AhjMasterPack = typeof ahjMasterPacksTable.$inferSelect;
export type NewAhjMasterPack = typeof ahjMasterPacksTable.$inferInsert;

// ---------------------------------------------------------------------------
// ahj_master_adoptions
// ---------------------------------------------------------------------------

/**
 * Records which company adopted which master pack version and which
 * company-scoped ahj_packs row was created as a result.
 * Unique on (company_id, master_pack_id) so re-running the provisioning
 * transaction is idempotent.
 */
export const ahjMasterAdoptionsTable = pgTable(
  'ahj_master_adoptions',
  {
    id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar('company_id')
      .notNull()
      .references(() => companiesTable.id),
    masterPackId: varchar('master_pack_id')
      .notNull()
      .references(() => ahjMasterPacksTable.id),
    /** The company-scoped ahj_packs row created during adoption. */
    adoptedPackId: varchar('adopted_pack_id')
      .notNull()
      .references(() => ahjPacksTable.id),
    adoptedAt: timestamp('adopted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ahj_master_adoptions_company_master_uidx').on(t.companyId, t.masterPackId),
  ],
);

export type AhjMasterAdoption = typeof ahjMasterAdoptionsTable.$inferSelect;
export type NewAhjMasterAdoption = typeof ahjMasterAdoptionsTable.$inferInsert;

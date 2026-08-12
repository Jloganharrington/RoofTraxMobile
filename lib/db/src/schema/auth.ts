import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessionsTable = pgTable(
  'sessions',
  {
    sid: varchar('sid').primaryKey(),
    sess: jsonb('sess').notNull(),
    expire: timestamp('expire').notNull(),
  },
  (table) => [index('IDX_session_expire').on(table.expire)],
);

// A tenant/organization. `id` is a short, human-typeable code (e.g.
// "R7K2QX") shown to the company's founder so teammates can join with it —
// it doubles as the natural primary key since the expected row count
// (hundreds to low thousands of companies) makes that simple and fast.
// `founderUserId` is set once, the first time a user ever logs in with this
// company's ID — that user is auto-promoted to admin.
// A contractor license shown in the Proof Package's Statement of
// Qualifications (Exhibit B) — one row per licensing state.
export type ContractorLicense = {
  state: string; // "VA"
  number: string; // "2705-064938A"
  classification: string; // "VA Class A Contractor"
};

// One Proof Package opening statement — an applicable code book title in
// effect for the jurisdiction, with its statement text.
export type OpeningStatement = { title: string; body: string };

// A building-code citation for Exhibit I, keyed by the scope element it
// governs (e.g. "roof_covering", "drip_edge", "decking").
export type CodeCitation = {
  key: string;
  element: string;
  title: string;
  cite: string;
  body: string;
};

export const companiesTable = pgTable('companies', {
  id: varchar('id').primaryKey(),
  name: varchar('name').notNull(),
  founderUserId: varchar('founder_user_id'),
  // Beta instrument gate: shows/hides the in-app bug-report button. Defaults
  // ON for the beta cohort; end of beta = flip the flag (no code change, no
  // revert). Reports already stored stay readable when this is off.
  betaBugReporting: boolean('beta_bug_reporting').notNull().default(true),
  // Company logo uploaded by a manager/admin. Stored as a full
  // authenticated URL (/api/storage/objects/...) — displayed in the FIPSA
  // letterhead instead of the hardcoded default logo.
  logoUrl: varchar('logo_url'),
  // Company-level AI settings: custom system prompt for the Summary step.
  // Null means the default prompt is used.
  aiSettings: jsonb('ai_settings')
    .$type<{ systemPrompt: string | null } | null>()
    .default(null),
  // Company-level forensic-report color palette, set by a super_admin.
  // Strict #RRGGBB hex values only (validated at write time and re-validated
  // at render time). Null means the default palette.
  // FIPSA agreement settings (multi-tenant agreement): the contractor's
  // legal name and address printed on the agreement + Notice of Cancellation,
  // and the Documentation Fee in cents. Null = not configured yet (the
  // template falls back to blank lines / $750.00 default fee).
  contractorLegalName: varchar('contractor_legal_name'),
  contractorAddress: varchar('contractor_address'),
  fipsaFeeCents: integer('fipsa_fee_cents'),
  reportBranding: jsonb('report_branding')
    .$type<{
      headerColor: string;
      headerTextColor: string;
      accentColor: string;
    } | null>()
    .default(null),
  // ── Lead source configuration ─────────────────────────────────────────────
  // Company-configured non-canvassing lead sources (e.g. "Angi's", "Yelp",
  // "Call-In", "Website"). Null means the built-in defaults are in effect;
  // an empty array means all custom sources have been removed.
  leadSources: jsonb('lead_sources')
    .$type<string[] | null>()
    .default(null),

  // ── Proof Package (report) settings — super admin curated ────────────────
  // Contractor licenses printed in Exhibit B (Statement of Qualifications).
  contractorLicenses: jsonb('contractor_licenses')
    .$type<ContractorLicense[] | null>()
    .default(null),
  // Narrative "Statement of Qualifications" paragraph for Exhibit B.
  qualificationsText: varchar('qualifications_text'),
  // Pricing-basis statement printed under the scope table (Exhibit J).
  // Null falls back to a neutral default at render time.
  pricingBasisStatement: varchar('pricing_basis_statement'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const usersTable = pgTable('users', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar('email').unique(),
  firstName: varchar('first_name'),
  lastName: varchar('last_name'),
  profileImageUrl: varchar('profile_image_url'),
  // Fixed at account creation (first login) and never changed afterward.
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  // Soft deactivation (migration 047). Set by POST /team/users/:userId/terminate.
  // Non-null = the user is deactivated: auth middleware returns 401, sessions
  // are purged, and the user is hidden from assignment pickers. The row and all
  // signed documents stay intact — signatures must remain renderable.
  // Hard delete (DELETE /team/users/:userId, super_admin only) is only allowed
  // when the inventory is empty — this column guards nothing by itself against
  // re-login; the auth middleware check is the enforcement point.
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  // PII purge timestamp (migration 049). Set by the nightly termination sweep
  // at 30 days post-deactivation. Non-null means firstName/lastName/email have
  // been scrubbed; the row is retained for FK integrity and audit purposes.
  piiPurgedAt: timestamp('pii_purged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Building Regulation Jurisdiction Pack — the jurisdiction-specific legal
// content a Proof Package requires: the opening statement titles (applicable
// code book titles in effect), the UPPA law + statement (summary page), and
// the general/roofing/siding code citations (Exhibit I). Packs are named
// free-form (e.g. "Dallas County, TX") and carry a two-letter state code so
// the inspection's property state can match candidate packs at compile time;
// a state can have several packs.
export const companyJurisdictionPacksTable = pgTable(
  'company_jurisdiction_packs',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: varchar('company_id')
      .notNull()
      .references(() => companiesTable.id),
    // Free-form jurisdiction name, unique per company.
    jurisdiction: varchar('jurisdiction', { length: 120 }).notNull(),
    // Two-letter state code, stored uppercase ("VA") — compile-time matching.
    state: varchar('state', { length: 2 }).notNull(),
    openingStatements: jsonb('opening_statements')
      .$type<OpeningStatement[]>()
      .notNull()
      .default([]),
    // UPPA law / governing statute reference.
    uppaLaw: varchar('uppa_law'),
    // UPPA statement printed in the Proof Package summary.
    uppaStatement: varchar('uppa_statement'),
    generalCodeCitations: jsonb('general_code_citations').$type<CodeCitation[]>().notNull().default([]),
    roofingCodeCitations: jsonb('roofing_code_citations').$type<CodeCitation[]>().notNull().default([]),
    sidingCodeCitations: jsonb('siding_code_citations').$type<CodeCitation[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('company_jurisdiction_packs_company_jurisdiction_idx').on(
      table.companyId,
      table.jurisdiction,
    ),
  ],
);

export type CompanyJurisdictionPack = typeof companyJurisdictionPacksTable.$inferSelect;
export type Company = typeof companiesTable.$inferSelect;
export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;

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
  // PP tier discriminator: 'crm' for full-CRM tenants (all existing companies),
  // 'pp_only' for companies provisioned through the PP self-serve registration
  // track. PP-only companies have no CRM enabled.
  ppTier: varchar('pp_tier').notNull().default('crm'),
  // CRM subscription tier — set by Stripe fulfillment when a plan activates.
  // 'none' = no active subscription (default for new companies). CRM routes
  // require a non-'none' value for pp_tier = 'crm' companies. PP-only
  // companies stay at 'none' since they are blocked by the pp_tier check.
  // Values: 'none' | 'solo' | 'crew' | 'team' | 'fleet' | 'regional'
  subscriptionLevel: varchar('subscription_level').notNull().default('regional'),
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

  // ── Work type — captured during PP self-serve registration ───────────────
  // Market type: 'retail' | 'insurance' | 'retail_insurance'
  workType: varchar('work_type'),
  // Trade types: e.g. ['roofing', 'siding']
  tradeTypes: jsonb('trade_types').$type<string[] | null>().default(null),
  // Selected AHJ coverage row (nullable — populated when a covered jurisdiction
  // is selected during registration; null when a free-text request was submitted).
  ahjCoverageId: varchar('ahj_coverage_id'),

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
  // PP auth: email + password for self-registered PP users. OIDC users never
  // have password_hash set (column stays null throughout their lifecycle).
  passwordHash: varchar('password_hash'),
  // Email verification for PP registrations (null = not yet verified or OIDC user).
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // Single-use token sent in the verification email (null once consumed).
  verifyToken: varchar('verify_token'),
  verifyTokenExpiresAt: timestamp('verify_token_expires_at', { withTimezone: true }),
  // Single-use password-reset token and its expiry.
  resetToken: varchar('reset_token'),
  resetTokenExpiresAt: timestamp('reset_token_expires_at', { withTimezone: true }),
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

export const ppPendingRegistrationsTable = pgTable('pp_pending_registrations', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  companyName: varchar('company_name').notNull(),
  email: varchar('email').notNull().unique(),
  passwordHash: varchar('password_hash').notNull(),
  logoObjectPath: varchar('logo_object_path'),
  stripeSessionId: varchar('stripe_session_id').unique(),
  // Work type fields — captured in the wizard before Stripe checkout.
  workType: varchar('work_type'), // 'retail' | 'insurance' | 'retail_insurance'
  tradeTypes: jsonb('trade_types').$type<string[] | null>(),
  // AHJ selection: either a covered coverage ID or a free-text request.
  ahjCoverageId: varchar('ahj_coverage_id'), // FK enforced at DB level via migration
  ahjRequestJurisdiction: varchar('ahj_request_jurisdiction'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true })
    .notNull()
    .default(sql`now() + INTERVAL '24 hours'`),
});

/**
 * Per-package payment credits for PP-only subscribers.
 * A row here means the company has paid for a Proof Package for the given inspection.
 * The compile route checks for a credit row before allowing generation.
 * Recompilation is free once a credit row exists (idempotent).
 */
export const ppPackageCreditsTable = pgTable(
  'pp_package_credits',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    companyId: varchar('company_id')
      .notNull()
      .references(() => companiesTable.id, { onDelete: 'cascade' }),
    inspectionId: varchar('inspection_id').notNull(),
    stripePaymentIntentId: varchar('stripe_payment_intent_id').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pp_package_credits_company_inspection_idx').on(
      table.companyId,
      table.inspectionId,
    ),
  ],
);

/**
 * pp_pending_checkouts — tracks an in-flight Stripe Checkout Session for a
 * per-package payment.  Keyed (company_id, inspection_id) so repeat calls to
 * POST /pp/packages/checkout reuse the same session instead of creating a new
 * one (preventing double-charges).  Cleaned up when the credit row lands.
 */
export const ppPendingCheckoutsTable = pgTable(
  'pp_pending_checkouts',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    companyId: varchar('company_id')
      .notNull()
      .references(() => companiesTable.id, { onDelete: 'cascade' }),
    inspectionId: varchar('inspection_id').notNull(),
    stripeSessionId: varchar('stripe_session_id').notNull(),
    sessionUrl: varchar('session_url', { length: 2048 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pp_pending_checkouts_company_inspection_idx').on(
      table.companyId,
      table.inspectionId,
    ),
  ],
);

/**
 * ahj_requests — free-text AHJ coverage requests from PP subscribers whose
 * jurisdiction is not yet in the covered list.  Populated at confirm time:
 * company_id is set after the company row exists; pending_registration_id
 * is set at insert (nullable once the pending row is deleted post-confirm).
 */
export const ahjRequestsTable = pgTable('ahj_requests', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()::text`),
  companyId: varchar('company_id').references(() => companiesTable.id, { onDelete: 'set null' }),
  pendingRegistrationId: varchar('pending_registration_id').references(
    () => ppPendingRegistrationsTable.id,
    { onDelete: 'set null' },
  ),
  jurisdictionText: varchar('jurisdiction_text').notNull(),
  state: varchar('state', { length: 2 }),
  county: varchar('county', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type CompanyJurisdictionPack = typeof companyJurisdictionPacksTable.$inferSelect;
export type Company = typeof companiesTable.$inferSelect;
export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;

export type PpPendingRegistration = typeof ppPendingRegistrationsTable.$inferSelect;
export type PpPackageCredit = typeof ppPackageCreditsTable.$inferSelect;
export type PpPendingCheckout = typeof ppPendingCheckoutsTable.$inferSelect;

export type AhjRequest = typeof ahjRequestsTable.$inferSelect;

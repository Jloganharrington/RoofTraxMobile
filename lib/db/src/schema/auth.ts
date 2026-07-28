import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

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
  // letterhead instead of the hardcoded NuHome logo.
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
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Company = typeof companiesTable.$inferSelect;
export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;

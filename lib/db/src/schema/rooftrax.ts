import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { companiesTable, usersTable } from './auth';

// Vocabulary lives in @workspace/authz. Import for use in column definitions
// below, then re-export so every existing `import { Role } from '@workspace/db'`
// keeps working unchanged.
import { DEPARTMENTS, ROLES, WORKFLOW_ASSIGNMENTS } from '@workspace/authz';
export { DEPARTMENTS, ROLES, WORKFLOW_ASSIGNMENTS } from '@workspace/authz';
export type { Department, Role, WorkflowAssignment } from '@workspace/authz';

export const PIN_WORKFLOWS = ['retail', 'insurance'] as const;
export const DAMAGE_TYPES = ['roof', 'siding', 'roof_and_siding'] as const;
export const DOOR_KNOCK_RESULTS = [
  'no_answer',
  'no_appointment',
  'appointment',
] as const;
// Homeowner-contact outcome captured on insurance/damage pins. When
// "call_to_schedule" is selected, the rep must also capture the
// customer's name and phone number so the office can follow up.
export const CONTACT_OUTCOMES = [
  'no_soliciting',
  'priority_inspection',
  'call_to_schedule',
] as const;

export type PinWorkflow = (typeof PIN_WORKFLOWS)[number];
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type DoorKnockResult = (typeof DOOR_KNOCK_RESULTS)[number];
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

// REPORT_DATA v2 — an individual inspector certification (name, issuing
// body, cert number, expiry ISO date). Stored on the profile, surfaced into
// every submission payload.
export interface InspectorCertification {
  name: string;
  issuingBody?: string | null;
  number?: string | null;
  expiry?: string | null;
}

// Per-user role + workflow assignment + department. Row is created lazily
// on first profile access (defaults: field_rep / insurance_retail /
// canvasser), mirroring the source app's behavior.
export const userProfilesTable = pgTable('user_profiles', {
  userId: varchar('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  role: varchar('role', { enum: ROLES }).notNull().default('field_rep'),
  workflowAssignment: varchar('workflow_assignment', {
    enum: WORKFLOW_ASSIGNMENTS,
  })
    .notNull()
    .default('insurance_retail'),
  department: varchar('department', { enum: DEPARTMENTS })
    .notNull()
    .default('canvasser'),
  // Signature-on-file (M-F / F0). Captured once on the profile and reused
  // across every inspection declaration, so the inspector never re-draws a
  // signature per submission. The image itself lives in tenant-scoped object
  // storage (read access enforced by objectOwnershipTable); we store only the
  // servable URL, a SHA-256 of the exact bytes (integrity proof), and when it
  // was captured. All nullable: a profile with no signature on file blocks
  // submission until one is captured.
  signatureUrl: text('signature_url'),
  signatureSha256: text('signature_sha256'),
  signatureSignedAt: timestamp('signature_signed_at', { withTimezone: true }),
  // Per-user outbound SMTP settings, so the server can email reports on the
  // rep's behalf (no mail app needed on the device). The password is stored
  // AES-256-GCM encrypted (keyed off SESSION_SECRET) and is NEVER returned by
  // the API — reads expose only whether SMTP is configured plus the
  // non-secret fields. All nullable: unset means "not configured".
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  smtpSecure: boolean('smtp_secure'),
  smtpUsername: text('smtp_username'),
  smtpPasswordEnc: text('smtp_password_enc'),
  smtpFromEmail: text('smtp_from_email'),
  // REPORT_DATA v2 — the individual credential layer behind
  // `assessorCredentials`: a forensic opinion's weight attaches to the
  // person, not the company (company pack lives Brain-side).
  certifications: jsonb('certifications').$type<InspectorCertification[] | null>(),
  yearsExperience: integer('years_experience'),
  // Wave-2B personal profile columns
  // Per-user contact phone, editable via PATCH /profile/me.
  phone: text('phone'),
  // UI theme preference. Default 'dark' = no visual change for existing users
  // until they opt in via the Appearance settings tab (Task A1).
  theme: varchar('theme', { enum: ['light', 'dark', 'system'] }).notNull().default('dark'),
  // Dashboard widget layout: { hidden: string[], order: string[] }.
  // null = defaults (catalog order, all granted widgets visible).
  // Managed via PATCH /dashboard/layout and DELETE /dashboard/layout (Task D1).
  dashboardLayout: jsonb('dashboard_layout')
    .$type<{ hidden: string[]; order: string[] } | null>()
    .default(null),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Retail door-knock detail captured when doorKnockResult === "appointment".
export interface RetailData {
  ownerName1: string;
  ownerName2?: string | null;
  phone?: string | null;
  email?: string | null;
  interestedRoof: boolean;
  interestedSiding: boolean;
  interestedWindows: boolean;
  interestedDoors: boolean;
  interestNotes?: string | null;
  appointmentDate?: string | null;
  notes?: string | null;
}

export const pinsTable = pgTable('pins', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  // Denormalized from the creating user's company so every pin query can
  // be scoped by companyId without joining through users.
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  address: text('address'),
  workflow: varchar('workflow', { enum: PIN_WORKFLOWS }).notNull(),
  damageType: varchar('damage_type', { enum: DAMAGE_TYPES }),
  photoUrl: text('photo_url'),
  doorKnockResult: varchar('door_knock_result', { enum: DOOR_KNOCK_RESULTS }),
  retailData: jsonb('retail_data').$type<RetailData>(),
  contactOutcome: varchar('contact_outcome', { enum: CONTACT_OUTCOMES }),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  status: varchar('status').notNull().default('active'),

  // ── Lead profile fields ────────────────────────────────────────────────
  ownerFirstName: text('owner_first_name'),
  ownerLastName: text('owner_last_name'),
  ownerEmail: text('owner_email'),
  owner2FirstName: text('owner2_first_name'),
  owner2LastName: text('owner2_last_name'),
  notes: text('notes'),
  pipelineStage: varchar('pipeline_stage'),
  profileStatus: varchar('profile_status'),
  statusNotes: text('status_notes'),
  statusLastUpdated: timestamp('status_last_updated', { withTimezone: true }),

  // ── Insurance ──────────────────────────────────────────────────────────
  insuranceCarrier: varchar('insurance_carrier'),
  policyNumber: varchar('policy_number'),
  claimNumber: varchar('claim_number'),
  dateOfLoss: timestamp('date_of_loss', { withTimezone: true }),
  inspectionDate: timestamp('inspection_date', { withTimezone: true }),
  adjusterName: varchar('adjuster_name'),
  adjusterPhone: varchar('adjuster_phone'),
  adjusterEmail: varchar('adjuster_email'),
  adjusterMeetingDate: timestamp('adjuster_meeting_date', { withTimezone: true }),

  // ── Financials ─────────────────────────────────────────────────────────
  contractAmount: varchar('contract_amount'),
  depositAmount: varchar('deposit_amount'),
  depositDate: timestamp('deposit_date', { withTimezone: true }),
  depositPaymentMethod: varchar('deposit_payment_method'),
  deductibleAmount: varchar('deductible_amount'),
  rcvAmount: varchar('rcv_amount'),
  acvAmount: varchar('acv_amount'),
  supplementAmount: varchar('supplement_amount'),
  finalPaymentAmount: varchar('final_payment_amount'),

  // ── Selections & Scope ─────────────────────────────────────────────────
  contractScope: text('contract_scope'),
  squareFootage: varchar('square_footage'),
  roofPitch: varchar('roof_pitch'),
  measurementVendor: varchar('measurement_vendor'),
  measurementReportUrl: text('measurement_report_url'),
  materialBrand: varchar('material_brand'),
  materialColor: varchar('material_color'),
  materialStyle: varchar('material_style'),

  // ── Lead Dashboard fields (imported from GitHub schema) ───────────────────
  nonOwnerOccupied:   boolean('non_owner_occupied').default(false),
  mailingAddress:     text('mailing_address'),
  mailingCity:        varchar('mailing_city'),
  mailingState:       varchar('mailing_state'),
  mailingZip:         varchar('mailing_zip'),
  mailerSentDate:     timestamp('mailer_sent_date', { withTimezone: true }),
  claimFiledDate:     timestamp('claim_filed_date', { withTimezone: true }),
  policyHolder:       varchar('policy_holder'),
  coverageType:       varchar('coverage_type'),
  approvedRcvAmount:  varchar('approved_rcv_amount'),
  approvedAcvAmount:  varchar('approved_acv_amount'),
  depreciationAmount: varchar('depreciation_amount'),
  inspectionNotes:    text('inspection_notes'),

  // ── Pipeline tracking ──────────────────────────────────────────────────────
  /** Timestamp when the pin entered its current pipelineStage */
  stageEnteredAt:   timestamp('stage_entered_at',    { withTimezone: true }),
  /** For loop stages: when the next action is due */
  loopNextActionAt: timestamp('loop_next_action_at', { withTimezone: true }),
  /** Reason for archiving as lost (required when pipelineStage = 'archived_lost') */
  lossReason:       varchar('loss_reason'),
  /** Which pipeline this pin belongs to ('retail' | 'insurance') */
  sourcePipeline:   varchar('source_pipeline'),

  // ── Lead sourcing & file handler ──────────────────────────────────────────
  /**
   * Non-canvassing lead source (e.g. "Angi's", "Yelp", "Call-In", "Website").
   * Null means the lead was acquired by canvassing — the creating user IS the
   * canvasser. Set at pin-creation time by the mobile app and editable from the
   * lead profile in the web app.
   */
  externalLeadSource: varchar('external_lead_source'),
  /**
   * Display name of the assigned Project Manager. Denormalised for easy display
   * without an extra join; updated when the PM is assigned through the Project
   * pipeline or via the lead profile.
   */
  projectManagerName: varchar('project_manager_name'),

  /** True when the pin was seeded/created as demo or test data */
  isDemo:            boolean('is_demo').default(false).notNull(),
  /**
   * Set to true when a null pipelineStage was automatically mapped to
   * pin_dropped during the stage-normalisation migration. Cards in the
   * pipeline show a "Stage review needed" badge so managers can confirm the
   * correct placement.
   */
  needsStageReview: boolean('needs_stage_review').default(false).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Tracks which user/company an uploaded object storage entity belongs to,
// recorded when the presigned upload URL is issued (before the file itself
// exists). GET /storage/objects/*path uses this to enforce that only
// authenticated users from the same company can read the file back.
export const objectOwnershipTable = pgTable('object_ownership', {
  objectPath: varchar('object_path').primaryKey(),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Latest known GPS position per rep — internal team-position awareness.
export const userLocationsTable = pgTable('user_locations', {
  userId: varchar('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Beta bug reports — temporary beta instrument (flag-gated by
// companies.beta_bug_reporting). The value of a report is the auto-captured
// context, stored whole as jsonb: over-capture now, because context can never
// be collected retroactively once the beta ends. Descriptions and screenshots
// WILL contain homeowner PII, so rows are company-scoped exactly like
// inspection data and screenshots live in the same object storage.
export const BUG_REPORT_SEVERITIES = ['blocks_me', 'annoying', 'cosmetic'] as const;
export const BUG_REPORT_STATUSES = ['new', 'triaged', 'fixed'] as const;

export const bugReportsTable = pgTable('bug_reports', {
  // Client-generated UUID: bug reports replay from the mobile outbox, so the
  // id must be idempotent across retries (a lost response must not duplicate
  // the row on the next drain).
  id: varchar('id').primaryKey(),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id),
  route: varchar('route').notNull(),
  routeParams: jsonb('route_params'),
  severity: varchar('severity', { enum: BUG_REPORT_SEVERITIES }).notNull(),
  description: text('description').notNull(),
  context: jsonb('context').notNull(),
  screenshotUrl: text('screenshot_url'),
  appVersion: varchar('app_version'),
  platform: varchar('platform'),
  osVersion: varchar('os_version'),
  status: varchar('status', { enum: BUG_REPORT_STATUSES }).notNull().default('new'),
  internalNote: text('internal_note'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BugReport = typeof bugReportsTable.$inferSelect;

export type UserProfile = typeof userProfilesTable.$inferSelect;
export type Pin = typeof pinsTable.$inferSelect;
export type InsertPin = typeof pinsTable.$inferInsert;
export type UserLocation = typeof userLocationsTable.$inferSelect;
export type ObjectOwnership = typeof objectOwnershipTable.$inferSelect;

export const STAGE_TRANSITION_TRIGGERS = ['task', 'auto_event', 'manual_move'] as const;
export const INSPECTION_CONDITIONS = [
  'roof_damage',
  'siding_damage',
  'roof_and_siding_damage',
] as const;
export type InspectionCondition = (typeof INSPECTION_CONDITIONS)[number];

// Individual line items — name, optional description, unit price in cents.
export const priceBookItemsTable = pgTable('price_book_items', {
  id: varchar('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  unitPrice: integer('unit_price').notNull().default(0), // cents
  // Optional billing-unit label shown next to the price (e.g. "per square",
  // "per LF", "each"). Free text — companies bill in too many vocabularies
  // to enumerate.
  unit: varchar('unit', { length: 60 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Named packages that group line items and can be auto-suggested based on
// what the inspection found (e.g. roof_damage → "Roofing Package").
export const priceBookPackagesTable = pgTable('price_book_packages', {
  id: varchar('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  inspectionCondition: varchar('inspection_condition', {
    enum: INSPECTION_CONDITIONS,
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Junction: which items (and how many) belong to each package.
export const priceBookPackageItemsTable = pgTable(
  'price_book_package_items',
  {
    packageId: varchar('package_id')
      .notNull()
      .references(() => priceBookPackagesTable.id, { onDelete: 'cascade' }),
    itemId: varchar('item_id')
      .notNull()
      .references(() => priceBookItemsTable.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.packageId, t.itemId] })],
);

export type PriceBookItem = typeof priceBookItemsTable.$inferSelect;
export type PriceBookPackage = typeof priceBookPackagesTable.$inferSelect;

// Known discontinued roofing products a company maintains in settings.
// Reps pick from this catalog during a repairability assessment (RR-010A);
// the picked product's attributes are snapshotted onto the flow server-side.
export const discontinuedProductsTable = pgTable('discontinued_products', {
  id: varchar('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  // Servable object path (e.g. /objects/uploads/{uuid}) for a reference photo.
  photoPath: text('photo_path'),
  widthInches: doublePrecision('width_inches'),
  exposureInches: doublePrecision('exposure_inches'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type DiscontinuedProduct = typeof discontinuedProductsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Lead Files — documents, photos, and attachments linked to a pin/lead.
// ---------------------------------------------------------------------------

export const LEAD_FILE_CATEGORIES = [
  'site_photos',
  'contracts',
  'estimates',
  'insurance_documents',
  'measurement_reports',
  'permits',
  'correspondence',
  'general',
] as const;

export type LeadFileCategory = (typeof LEAD_FILE_CATEGORIES)[number];

/**
 * Files attached to a lead (pin or ins- inspection). `leadId` is the raw
 * lead identifier used throughout the UI — either a pin UUID or the
 * "ins-{inspectionId}" form. No FK constraint so both formats can coexist.
 */
export const leadFilesTable = pgTable('lead_files', {
  id: varchar('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  leadId: varchar('lead_id').notNull(),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id),
  objectPath: text('object_path').notNull(),
  // Display name — can be edited by the rep without re-uploading.
  fileName: text('file_name').notNull(),
  // Original file name at upload time — immutable audit trail.
  originalName: text('original_name').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: varchar('mime_type').notNull(),
  category: varchar('category', { enum: LEAD_FILE_CATEGORIES })
    .notNull()
    .default('general'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type LeadFile = typeof leadFilesTable.$inferSelect;

export const stageTransitionsTable = pgTable('stage_transitions', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** The pin id this transition belongs to */
  leadId: varchar('lead_id').notNull(),
  /** Stage the pin was in before the move (null for first assignment) */
  fromStage: varchar('from_stage'),
  /** Stage the pin moved into */
  toStage: varchar('to_stage').notNull(),
  /** What initiated the move */
  trigger: varchar('trigger', { enum: STAGE_TRANSITION_TRIGGERS }).notNull(),
  /** Arbitrary widget/task data submitted alongside the move */
  taskPayload: jsonb('task_payload'),
  /** User who initiated the move (null for auto_event triggers) */
  userId: varchar('user_id').references(() => usersTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type StageTransitionTrigger = (typeof STAGE_TRANSITION_TRIGGERS)[number];

export type InsertStageTransition = typeof stageTransitionsTable.$inferInsert;

export type StageTransition = typeof stageTransitionsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Company Templates — metadata for document templates stored in object storage
// ---------------------------------------------------------------------------

export const TEMPLATE_USE_CASES = [
  'forensic_report',
  'proof_package',
  'fipsa_agreement',
  'estimate_proposal',
  'homeowner_email',
  'claim_supplement',
  'other',
] as const;

export type TemplateUseCase = (typeof TEMPLATE_USE_CASES)[number];

export const companyTemplatesTable = pgTable('company_templates', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  objectPath: text('object_path').notNull(),
  mimeType: text('mime_type').notNull(),
  useCase: text('use_case').notNull(),
  originalFilename: text('original_filename').notNull(),
  uploadedByUserId: varchar('uploaded_by_user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CompanyTemplate = typeof companyTemplatesTable.$inferSelect;
export type InsertCompanyTemplate = typeof companyTemplatesTable.$inferInsert;

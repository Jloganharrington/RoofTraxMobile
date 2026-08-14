import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
  // Signer title shown on Completion Certificates (e.g. "Project Manager").
  // Optional; supplied per-sign via the sign-endpoint body, else falls back
  // to this stored value. (migration 043)
  title: text('title'),
  // UI theme preference. Default 'dark' = no visual change for existing users
  // until they opt in via the Appearance settings tab (Task A1).
  theme: varchar('theme', { enum: ['light', 'dark', 'system'] }).notNull().default('dark'),
  // Dashboard widget layout: { hidden: string[], order: string[] }.
  // null = defaults (catalog order, all granted widgets visible).
  // Managed via PATCH /dashboard/layout and DELETE /dashboard/layout (Task D1).
  dashboardLayout: jsonb('dashboard_layout')
    .$type<{ hidden: string[]; order: string[] } | null>()
    .default(null),
  // Step 4: direct manager assignment. Null means no manager assigned.
  // SET NULL on cascade so deleting a manager row auto-clears their reports'
  // assignment rather than cascading the delete. Admin+ required to set
  // (team.assign_manager). Must stay same-company — enforced at write time.
  managerUserId: varchar('manager_user_id')
    .references(() => usersTable.id, { onDelete: 'set null' }),
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
  // RESTRICT (not CASCADE) — deleting a user who owns leads must be blocked.
  // Use POST /team/users/:id/terminate to reassign leads first, then the
  // super_admin hard-delete route will find no referencing rows and succeed.
  // This prevents any code path (API bug, script, psql) from silently
  // destroying job history by deleting a user row.
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'restrict' }),
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

  // ── Costs & Commissions (step 3 — migration 025) ───────────────────────
  // Integer cents. Manager-only via PATCH /pins/:pinId/commissions.
  // Must NOT be writable via the generic pin PATCH endpoint.
  leadAcquisitionCostCents:  integer('lead_acquisition_cost_cents'),
  referralFeeCents:          integer('referral_fee_cents'),
  salesCommissionCents:      integer('sales_commission_cents'),
  salesCommissionPaidDate:   timestamp('sales_commission_paid_date', { withTimezone: true }),
  pmCommissionCents:         integer('pm_commission_cents'),
  pmCommissionPaidDate:      timestamp('pm_commission_paid_date',    { withTimezone: true }),

  // ── Overhead additions (step 5 — migration 028) ────────────────────────
  // Canvassing commission: new overhead line with full amount + paid-date shape.
  canvassingCommissionCents:     integer('canvassing_commission_cents'),
  canvassingCommissionPaidDate:  timestamp('canvassing_commission_paid_date', { withTimezone: true }),
  // Paid dates for the two existing overhead lines that previously had amounts
  // but no paid-date tracking (referral fee, lead acquisition).
  referralFeePaidDate:           timestamp('referral_fee_paid_date',          { withTimezone: true }),
  leadAcquisitionPaidDate:       timestamp('lead_acquisition_paid_date',      { withTimezone: true }),

  // ── Insurance analytics (migration 032) ───────────────────────────────
  // Validated server-side against CLAIM_STATUSES constant; stored as varchar
  // so additions do not require a schema migration.
  claimStatus:            varchar('claim_status'),
  adjusterLastContact:    timestamp('adjuster_last_contact',    { withTimezone: true }),
  // Integer cents (not legacy varchar) — safe to use in arithmetic directly.
  bettermentsAmountCents: integer('betterments_amount_cents'),
  supplementNotes:        text('supplement_notes'),

  // ── Retail appointments (migration 037) ───────────────────────────────
  // Promoted out of retailData.appointmentDate (jsonb free-text, unqueryable).
  // appointmentDate is KEPT in retailData as read-only legacy; these columns
  // are the authoritative source for calendar and scheduling queries.
  // appointment_status values: scheduled | completed | canceled | no_show
  // (validated server-side, never an enum so additions need no migration).
  appointmentAt:           timestamp('appointment_at',           { withTimezone: true }),
  appointmentAssignedTo:   varchar('appointment_assigned_to').references(() => usersTable.id),
  appointmentStatus:       varchar('appointment_status'),

  // ── Approved carrier estimate (migration 041) ────────────────────────
  // Object-storage path and sha256 of the carrier-approved estimate document.
  // Required before a pin may advance to claim_approved — acts as a gate so
  // downstream COC extraction always has a source document to read from.
  approvedEstimateObjectPath:  text('approved_estimate_object_path'),
  approvedEstimateObjectSha256: text('approved_estimate_sha256'),

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
  'change_order',
  'contract',
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

// ---------------------------------------------------------------------------
// Payments ledger — per-lead financial transactions (migration 023)
// ---------------------------------------------------------------------------

export const PAYMENT_TYPES = [
  'deposit',
  'acv',
  'betterment',
  'supplement',
  'final',
  'rcv_holdback',
  'deductible',
  'other',
] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Customer Invoices — step 2
// ---------------------------------------------------------------------------

export const INVOICE_TYPES = [
  'initial_deposit',
  'acv_payment',
  'supplement',
  'final_payment',
  'service',
  'other',
] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_STATUSES = ['open', 'sent', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Maps customer invoice type → payments ledger type. */
export const INVOICE_TYPE_TO_PAYMENT_TYPE: Record<InvoiceType, PaymentType> = {
  initial_deposit: 'deposit',
  acv_payment: 'acv',
  supplement: 'supplement',
  final_payment: 'final',
  service: 'other',
  other: 'other',
};

export const customerInvoicesTable = pgTable('customer_invoices', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  pinId: varchar('pin_id')
    .notNull()
    .references(() => pinsTable.id, { onDelete: 'cascade' }),
  invoiceNumber: varchar('invoice_number').notNull(),
  customerName: varchar('customer_name').notNull(),
  customerAddress: text('customer_address').notNull(),
  invoiceType: varchar('invoice_type', { enum: INVOICE_TYPES }).notNull(),
  amountCents: integer('amount_cents').notNull(),
  status: varchar('status', { enum: INVOICE_STATUSES }).notNull().default('open'),
  notes: text('notes'),
  pdfUrl: text('pdf_url'),
  sentDate: timestamp('sent_date', { withTimezone: true }),
  paidDate: timestamp('paid_date', { withTimezone: true }),
  paymentMethod: varchar('payment_method'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CustomerInvoice = typeof customerInvoicesTable.$inferSelect;
export type InsertCustomerInvoice = typeof customerInvoicesTable.$inferInsert;

// ---------------------------------------------------------------------------

export const paymentsTable = pgTable('payments', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  pinId: varchar('pin_id')
    .notNull()
    .references(() => pinsTable.id, { onDelete: 'cascade' }),
  type: varchar('type', { enum: PAYMENT_TYPES }).notNull(),
  amountCents: integer('amount_cents').notNull(),
  method: varchar('method'),
  paymentDate: timestamp('payment_date', { withTimezone: true }).notNull(),
  notes: text('notes'),
  // FK enforced in migration 024; ON DELETE SET NULL keeps ledger intact when
  // an invoice is deleted or voided.
  customerInvoiceId: varchar('customer_invoice_id').references(
    () => customerInvoicesTable.id,
    { onDelete: 'set null' },
  ),
  createdByUserId: varchar('created_by_user_id')
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Payment = typeof paymentsTable.$inferSelect;
export type InsertPayment = typeof paymentsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Vendor Expenses (step 3 — migration 025)
// ---------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = [
  'materials',
  'labor',
  'subcontractor',
  'equipment',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const vendorExpensesTable = pgTable('vendor_expenses', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  pinId: varchar('pin_id')
    .notNull()
    .references(() => pinsTable.id, { onDelete: 'cascade' }),
  vendorName:    varchar('vendor_name').notNull(),
  invoiceNumber: varchar('invoice_number'),
  invoiceDate:   timestamp('invoice_date',  { withTimezone: true }),
  amountCents:   integer('amount_cents').notNull(),
  // category values: EXPENSE_CATEGORIES
  category:      varchar('category').notNull(),
  description:   text('description'),
  documentUrl:   text('document_url'),
  isPaid:        boolean('is_paid').notNull().default(false),
  // paid_date is ALWAYS set server-side by the mark-paid endpoint — never
  // accepted from the client. See /expenses/:expenseId/mark-paid.
  paidDate:      timestamp('paid_date',     { withTimezone: true }),
  dueDate:       timestamp('due_date',      { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type VendorExpense = typeof vendorExpensesTable.$inferSelect;
export type InsertVendorExpense = typeof vendorExpensesTable.$inferInsert;

// ---------------------------------------------------------------------------
// Change Orders (step 5 — migration 028)
// ---------------------------------------------------------------------------

export const CHANGE_ORDER_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

export const changeOrdersTable = pgTable('change_orders', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  pinId: varchar('pin_id')
    .notNull()
    .references(() => pinsTable.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  // amount_cents is DERIVED — always the sum of change_order_line_items.total_cents.
  // Never set by the client; recomputed on every line-item write.
  // May be negative when deductive line items exceed additive ones.
  amountCents: integer('amount_cents').notNull().default(0),
  // Status vocabulary: pending | approved | rejected
  status: varchar('status', { enum: CHANGE_ORDER_STATUSES }).notNull().default('pending'),
  // Set server-side when status → 'approved'; cleared when status → other.
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  // Migration 030 — on-site capture fields
  // Scope flag: true = hidden conditions discovered during job (supplement candidate)
  requiredToCompleteScope: boolean('required_to_complete_scope').notNull().default(false),
  // Document (PDF generated on-device, uploaded to object storage)
  documentObjectPath: text('document_object_path'),
  documentSha256: text('document_sha256'),
  // Homeowner signature (PNG uploaded separately)
  homeownerSignaturePath: text('homeowner_signature_path'),
  homeownerSignedAt: timestamp('homeowner_signed_at', { withTimezone: true }),
  // Rep signature
  repSignaturePath: text('rep_signature_path'),
  repSignedAt: timestamp('rep_signed_at', { withTimezone: true }),
  // Void semantics (never hard-delete a signed CO)
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedByUserId: varchar('voided_by_user_id')
    .references(() => usersTable.id),
  voidReason: text('void_reason'),
  /** Stamped when the signed PDF is successfully emailed on approval (best-effort). */
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  /**
   * When true, this approved + non-voided CO appears on the Completion
   * Certificate as its own section between the base contract and PWI sections.
   * Must be set explicitly; defaults false so legacy COs are never silently
   * included. (migration 042)
   */
  carrierReimbursable: boolean('carrier_reimbursable').notNull().default(false),
  createdByUserId: varchar('created_by_user_id')
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ChangeOrder = typeof changeOrdersTable.$inferSelect;
export type InsertChangeOrder = typeof changeOrdersTable.$inferInsert;

// ---------------------------------------------------------------------------
// Change Order Line Items (migration 030)
// ---------------------------------------------------------------------------

export const changeOrderLineItemsTable = pgTable('change_order_line_items', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  changeOrderId: varchar('change_order_id')
    .notNull()
    .references(() => changeOrdersTable.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  // Stored as numeric(10,4) — fractional quantities (e.g. 0.5 squares) are common.
  quantity: numeric('quantity', { precision: 10, scale: 4 }).notNull().default('1'),
  unitPriceCents: integer('unit_price_cents').notNull(), // may be negative (credit)
  // Stored total: round(quantity × unit_price_cents). Stored so signed documents
  // remain reproducible even if a price-book item later changes.
  totalCents: integer('total_cents').notNull(),
  priceBookItemId: varchar('price_book_item_id')
    .references(() => priceBookItemsTable.id),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ChangeOrderLineItem = typeof changeOrderLineItemsTable.$inferSelect;
export type InsertChangeOrderLineItem = typeof changeOrderLineItemsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Selections Library (migration 2026-08-07)
// Hierarchy: Category → Brand → Product (tier) → Options (colours)
// ---------------------------------------------------------------------------

export const selectionCategoriesTable = pgTable('selection_categories', {
  id:        varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar('company_id').notNull().references(() => companiesTable.id),
  name:      varchar('name', { length: 120 }).notNull(),
  slug:      varchar('slug', { length: 80 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SelectionCategory = typeof selectionCategoriesTable.$inferSelect;
export type InsertSelectionCategory = typeof selectionCategoriesTable.$inferInsert;

export const selectionBrandsTable = pgTable('selection_brands', {
  id:         varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId:  varchar('company_id').notNull().references(() => companiesTable.id),
  categoryId: varchar('category_id').notNull().references(() => selectionCategoriesTable.id),
  name:       varchar('name', { length: 120 }).notNull(),
  logoPath:   text('logo_path'),
  sortOrder:  integer('sort_order').notNull().default(0),
  isActive:   boolean('is_active').notNull().default(true),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SelectionBrand = typeof selectionBrandsTable.$inferSelect;
export type InsertSelectionBrand = typeof selectionBrandsTable.$inferInsert;

export const selectionProductsTable = pgTable('selection_products', {
  id:               varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId:        varchar('company_id').notNull().references(() => companiesTable.id),
  categoryId:       varchar('category_id').notNull().references(() => selectionCategoriesTable.id),
  brandId:          varchar('brand_id').notNull().references(() => selectionBrandsTable.id),
  name:             varchar('name', { length: 200 }).notNull(),
  description:      text('description'),
  specs:            jsonb('specs'),
  isBase:           boolean('is_base').notNull().default(false),
  priceDeltaCents:  integer('price_delta_cents').notNull().default(0),
  unit:             varchar('unit', { length: 60 }).notNull(),
  sortOrder:        integer('sort_order').notNull().default(0),
  isActive:         boolean('is_active').notNull().default(true),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SelectionProduct = typeof selectionProductsTable.$inferSelect;
export type InsertSelectionProduct = typeof selectionProductsTable.$inferInsert;

export const selectionOptionsTable = pgTable('selection_options', {
  id:               varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId:        varchar('company_id').notNull().references(() => companiesTable.id),
  brandId:          varchar('brand_id').notNull().references(() => selectionBrandsTable.id),
  name:             varchar('name', { length: 120 }).notNull(),
  optionGroup:      varchar('option_group', { length: 80 }),
  swatchHex:        varchar('swatch_hex', { length: 7 }),
  swatchImagePath:  text('swatch_image_path'),
  hoaCompliant:     boolean('hoa_compliant'),
  sortOrder:        integer('sort_order').notNull().default(0),
  isActive:         boolean('is_active').notNull().default(true),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SelectionOption = typeof selectionOptionsTable.$inferSelect;
export type InsertSelectionOption = typeof selectionOptionsTable.$inferInsert;

export const selectionProductOptionsTable = pgTable('selection_product_options', {
  id:        varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar('company_id').notNull().references(() => companiesTable.id),
  productId: varchar('product_id').notNull().references(() => selectionProductsTable.id),
  optionId:  varchar('option_id').notNull().references(() => selectionOptionsTable.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SelectionProductOption = typeof selectionProductOptionsTable.$inferSelect;
export type InsertSelectionProductOption = typeof selectionProductOptionsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Contracts (migration 036)
// Tables: contracts, contract_scope_packages, contract_selections
// Pricing rule (LOCKED):
//   betterments_cents    = SUM(contract_selections.extended_delta_cents)
//   total_contract_cents = covered_scope_cents + betterments_cents
// ---------------------------------------------------------------------------

export const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'voided'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const contractsTable = pgTable('contracts', {
  id:                    varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId:             varchar('company_id').notNull().references(() => companiesTable.id),
  pinId:                 varchar('pin_id').notNull().references(() => pinsTable.id),
  accessCode:            varchar('access_code').notNull(),
  accessCodeExpiresAt:   timestamp('access_code_expires_at', { withTimezone: true }),
  status:                varchar('status').notNull().default('draft'),
  sentAt:                timestamp('sent_at', { withTimezone: true }),
  coveredScopeCents:     integer('covered_scope_cents').notNull().default(0),
  bettermentsCents:      integer('betterments_cents').notNull().default(0),
  deductibleCents:       integer('deductible_cents').notNull().default(0),
  totalContractCents:    integer('total_contract_cents').notNull().default(0),
  scopeSummary:          text('scope_summary'),
  scopeSource:           varchar('scope_source'),
  templateId:            varchar('template_id'),     // FK: company_templates.id (SQL migration)
  documentObjectPath:    text('document_object_path'),
  documentSha256:        text('document_sha256'),
  customerSignaturePath: text('customer_signature_path'),
  customerSignedAt:      timestamp('customer_signed_at', { withTimezone: true }),
  customerPrintName:     varchar('customer_print_name'),
  repSignaturePath:      text('rep_signature_path'),
  repSignedAt:           timestamp('rep_signed_at', { withTimezone: true }),
  voidedAt:              timestamp('voided_at', { withTimezone: true }),
  voidedByUserId:        varchar('voided_by_user_id').references(() => usersTable.id),
  voidReason:            text('void_reason'),
  createdByUserId:       varchar('created_by_user_id').notNull().references(() => usersTable.id),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Contract = typeof contractsTable.$inferSelect;
export type InsertContract = typeof contractsTable.$inferInsert;

export const contractScopePackagesTable = pgTable('contract_scope_packages', {
  id:                  varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId:           varchar('company_id').notNull().references(() => companiesTable.id),
  contractId:          varchar('contract_id').notNull().references(() => contractsTable.id),
  categoryId:          varchar('category_id').notNull().references(() => selectionCategoriesTable.id),
  quantity:            numeric('quantity').notNull(),
  unit:                varchar('unit').notNull(),
  coveredAmountCents:  integer('covered_amount_cents').notNull().default(0),
  sortOrder:           integer('sort_order').notNull().default(0),
});

export type ContractScopePackage = typeof contractScopePackagesTable.$inferSelect;
export type InsertContractScopePackage = typeof contractScopePackagesTable.$inferInsert;

export const contractSelectionsTable = pgTable('contract_selections', {
  id:                  varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId:           varchar('company_id').notNull().references(() => companiesTable.id),
  contractId:          varchar('contract_id').notNull().references(() => contractsTable.id),
  scopePackageId:      varchar('scope_package_id').notNull().references(() => contractScopePackagesTable.id),
  productId:           varchar('product_id').notNull().references(() => selectionProductsTable.id),
  optionId:            varchar('option_id').references(() => selectionOptionsTable.id),
  // Snapshot — resolved at selection time, never re-read from the library
  productName:         varchar('product_name').notNull(),
  brandName:           varchar('brand_name').notNull(),
  optionName:          varchar('option_name'),
  unitDeltaCents:      integer('unit_delta_cents').notNull(),
  quantity:            numeric('quantity').notNull(),
  extendedDeltaCents:  integer('extended_delta_cents').notNull(),
  selectedBy:          varchar('selected_by').notNull(),   // 'customer' | 'rep'
  selectedByUserId:    varchar('selected_by_user_id').references(() => usersTable.id),
  selectedAt:          timestamp('selected_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ContractSelection = typeof contractSelectionsTable.$inferSelect;
export type InsertContractSelection = typeof contractSelectionsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Claim Status History (migration 038)
// ---------------------------------------------------------------------------
// Forward-only log of every claim_status change on a pin. Written in the same
// transaction as the PATCH /pins/:pinId/insurance update, with a no-op guard
// so setting the SAME status twice produces no row. No backfill — there is no
// retroactive source for prior changes, and fabricating timestamps would be
// misleading. The live activity feed starts empty for this event type.

export const claimStatusHistoryTable = pgTable('claim_status_history', {
  id:               varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId:        varchar('company_id').notNull().references(() => companiesTable.id),
  pinId:            varchar('pin_id').notNull().references(() => pinsTable.id, { onDelete: 'cascade' }),
  fromStatus:       varchar('from_status'),           // null on first-ever set
  toStatus:         varchar('to_status'),             // null = status was cleared
  changedByUserId:  varchar('changed_by_user_id').notNull().references(() => usersTable.id),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ClaimStatusHistory = typeof claimStatusHistoryTable.$inferSelect;
export type InsertClaimStatusHistory = typeof claimStatusHistoryTable.$inferInsert;

// ---------------------------------------------------------------------------
// Notification Preferences (migration 039)
// ---------------------------------------------------------------------------
// Rows are written ONLY when a user changes something from the catalog default.
// Absence of a row = "use the catalog default" — this avoids backfilling every
// new notification type for every existing user when new types are added.
//
// frequency stores all four values even though v1 only dispatches immediate/off.
// UNIQUE (user_id, notification_type) enforces one row per type per user.

export const notificationPreferencesTable = pgTable(
  'notification_preferences',
  {
    id:               varchar('id').primaryKey().default(sql`gen_random_uuid()`),
    companyId:        varchar('company_id').notNull().references(() => companiesTable.id),
    userId:           varchar('user_id').notNull().references(() => usersTable.id),
    notificationType: varchar('notification_type').notNull(),
    emailEnabled:     boolean('email_enabled').notNull(),
    pushEnabled:      boolean('push_enabled').notNull(),
    frequency:        varchar('frequency').notNull().default('immediate'),
    createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTypeUniq: uniqueIndex('notification_prefs_user_type_uniq').on(t.userId, t.notificationType),
  }),
);

export type NotificationPreference = typeof notificationPreferencesTable.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferencesTable.$inferInsert;

// ---------------------------------------------------------------------------
// User push tokens — one row per device, one user may have many
// ---------------------------------------------------------------------------

export const userPushTokensTable = pgTable(
  'user_push_tokens',
  {
    id:             varchar('id').primaryKey().default(sql`gen_random_uuid()`),
    companyId:      varchar('company_id').notNull().references(() => companiesTable.id, { onDelete: 'cascade' }),
    userId:         varchar('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
    expoPushToken:  varchar('expo_push_token').notNull(),
    deviceLabel:    varchar('device_label'),
    platform:       varchar('platform'),
    lastSeenAt:     timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenUnique: uniqueIndex('user_push_tokens_token_uq').on(t.expoPushToken),
  }),
);

export type UserPushToken = typeof userPushTokensTable.$inferSelect;
export type InsertUserPushToken = typeof userPushTokensTable.$inferInsert;

// ---------------------------------------------------------------------------
// Completion Certificates (migration 042)
// ---------------------------------------------------------------------------
// One record per compile cycle for a claim_approved pin.
// status: draft → signed → voided (never hard-deleted).
// line_items is an immutable snapshot once status = 'signed'.
// Corrections void the existing record and create a new draft.
// ---------------------------------------------------------------------------

export const COMPLETION_CERTIFICATE_STATUSES = ['draft', 'signed', 'voided'] as const;

export const completionCertificatesTable = pgTable('completion_certificates', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  pinId: varchar('pin_id')
    .notNull()
    .references(() => pinsTable.id, { onDelete: 'cascade' }),
  /** Linked contract; may be null if no contract has been signed yet. */
  contractId: varchar('contract_id')
    .references(() => contractsTable.id),
  status: varchar('status', { enum: COMPLETION_CERTIFICATE_STATUSES })
    .notNull()
    .default('draft'),
  documentObjectPath: text('document_object_path'),
  documentSha256: text('document_sha256'),
  signedByUserId: varchar('signed_by_user_id')
    .references(() => usersTable.id),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  signerTitle: text('signer_title'),
  /**
   * Immutable once status = 'signed'.
   * Shape: { baseContract: LineItem[], pwi: LineItem[], dropped: DroppedItem[] }
   * where LineItem = { description, quantity?, unit?, amountCents }
   * and DroppedItem = { text, reason }
   */
  lineItems: jsonb('line_items'),
  createdByUserId: varchar('created_by_user_id')
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CompletionCertificate = typeof completionCertificatesTable.$inferSelect;
export type InsertCompletionCertificate = typeof completionCertificatesTable.$inferInsert;

// ---------------------------------------------------------------------------
// Migration 044: pin_financial_changes
// Purpose-built audit log for manager edits to financial fields.
// Pattern: stage_transitions (pipeline), report_attestations (report sign-off).
// Company-scoped directly — no join needed for tenancy.
// Consumer: Financials surface ("contract value changed from X to Y by Z").
// ---------------------------------------------------------------------------
export const PIN_FINANCIAL_CHANGE_FIELDS = [
  'contract_amount',
  'deductible_amount',
  'rcv_amount',
] as const;
export type PinFinancialChangeField = (typeof PIN_FINANCIAL_CHANGE_FIELDS)[number];

export const pinFinancialChangesTable = pgTable('pin_financial_changes', {
  id: varchar('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  pinId: varchar('pin_id')
    .notNull()
    .references(() => pinsTable.id),
  /** 'contract_amount' | 'deductible_amount' | 'rcv_amount' */
  field: text('field').notNull().$type<PinFinancialChangeField>(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  changedByUserId: varchar('changed_by_user_id')
    .notNull()
    .references(() => usersTable.id),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason').notNull(),
});

export type PinFinancialChange = typeof pinFinancialChangesTable.$inferSelect;
export type InsertPinFinancialChange = typeof pinFinancialChangesTable.$inferInsert;

// ---------------------------------------------------------------------------
// Deactivation Sweep Log (migration 050)
// Written by the nightly termination sweep for every deactivated user it
// touches. One row per action attempted per run. action_taken values:
//   alert_7d     — manager/admin alerted at 7 days
//   alert_14d    — manager/admin alerted at 14 days
//   escalate_21d — all admins escalated at 21 days
//   purge_30d    — PII scrubbed successfully at 30 days
//   blocked      — purge attempted but failed; blockedReason carries the error
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Beta applications — incoming marketing funnel (no company FK)
// ---------------------------------------------------------------------------
export const betaApplications = pgTable('beta_applications', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  firstName:      varchar('first_name', { length: 100 }).notNull(),
  lastName:       varchar('last_name',  { length: 100 }).notNull(),
  email:          varchar('email',      { length: 255 }).notNull(),
  phone:          varchar('phone',      { length: 50  }).notNull(),
  company:        varchar('company',    { length: 255 }).notNull(),
  state:          varchar('state',      { length: 100 }).notNull(),
  repCount:       varchar('rep_count',  { length: 50  }).notNull(),
  claimVolume:    varchar('claim_volume', { length: 50  }).notNull(),
  revenueRange:   varchar('revenue_range', { length: 100 }).notNull(),
  currentStack:   varchar('current_stack', { length: 255 }).notNull(),
  challenge:      text('challenge').notNull().default(''),
  referralSource: varchar('referral_source', { length: 500 }).notNull().default(''),
  status:         varchar('status', { length: 50 }).notNull().default('pending'),
  notes:          text('notes'),
  reviewedAt:     timestamp('reviewed_at', { withTimezone: true }),
  createdAt:      timestamp('created_at',  { withTimezone: true }).notNull().defaultNow(),
});

export type BetaApplication = typeof betaApplications.$inferSelect;
export type InsertBetaApplication = typeof betaApplications.$inferInsert;

// ---------------------------------------------------------------------------
// Trial Proof Package (migration 054) — paid trial intake on the marketing
// site. Non-customer contractors buy up to 3 proof packages. No company FK:
// trial accounts are pre-tenant. Enum-like columns are varchar + zod-validated
// at the API layer (avoids the pg enum → generated-file cascade).
// ---------------------------------------------------------------------------

export const TRIAL_COMPANY_SIZE_BANDS = ['1-3', '4-10', '11-25', '26-50', '50+'] as const;
export const TRIAL_CLAIM_BANDS = ['1-5', '6-15', '16-40', '40+'] as const;
export const TRIAL_PERIL_TYPES = ['hail', 'wind', 'wind_hail', 'tree_impact', 'other'] as const;
export const TRIAL_UPLOAD_TYPES = ['photo', 'measurement_report', 'carrier_estimate', 'logo', 'deliverable', 'other'] as const;
export const TRIAL_SUBMISSION_STATUSES = [
  'draft', 'paid', 'in_review', 'approved', 'building', 'ready', 'delivered', 'rejected',
] as const;
export const AHJ_COVERAGE_STATUSES = ['covered', 'in_progress', 'none'] as const;
export type TrialSubmissionStatus = (typeof TRIAL_SUBMISSION_STATUSES)[number];

export const trialAccounts = pgTable('trial_accounts', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyName:      varchar('company_name', { length: 255 }).notNull(),
  contactName:      varchar('contact_name', { length: 255 }).notNull(),
  email:            varchar('email', { length: 255 }).notNull().unique(), // business domain required (API-enforced)
  phone:            varchar('phone', { length: 50 }).notNull(),
  licenseNumber:    varchar('license_number', { length: 100 }).notNull(),
  licenseState:     varchar('license_state', { length: 2 }).notNull(),
  companySizeBand:  varchar('company_size_band', { length: 10 }).notNull(),
  monthlyClaimBand: varchar('monthly_claim_band', { length: 10 }).notNull(),
  currentCrm:       varchar('current_crm', { length: 255 }),
  emailVerifiedAt:  timestamp('email_verified_at', { withTimezone: true }),
  verifyToken:      varchar('verify_token', { length: 64 }),
  packagesPurchased: integer('packages_purchased').notNull().default(0), // hard cap TRIAL_MAX_PACKAGES (3)
  creditBalanceCents: integer('credit_balance_cents').notNull().default(0),
  creditExpiresAt:  timestamp('credit_expires_at', { withTimezone: true }), // first purchase + 90d
  convertedTenantId: varchar('converted_tenant_id'), // set on subscription
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type TrialAccount = typeof trialAccounts.$inferSelect;
export type InsertTrialAccount = typeof trialAccounts.$inferInsert;

// Lightweight session for trial accounts (separate from tenant user sessions).
export const trialSessions = pgTable('trial_sessions', {
  token: varchar('token', { length: 64 }).primaryKey(),
  accountId: varchar('account_id').notNull().references(() => trialAccounts.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type TrialSession = typeof trialSessions.$inferSelect;

export const trialSubmissions = pgTable('trial_submissions', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId:   varchar('account_id').notNull().references(() => trialAccounts.id),
  sequenceNum: integer('sequence_num').notNull(), // 1, 2, or 3
  status:      varchar('status', { length: 20 }).notNull().default('draft'),
  amountPaidCents: integer('amount_paid_cents'),
  stripePaymentId: varchar('stripe_payment_id', { length: 255 }),

  // claim intake (PURGED 30 days after delivery; rejected purge at 7 days)
  propertyAddress: text('property_address'),
  propertyCity:    varchar('property_city', { length: 255 }),
  propertyState:   varchar('property_state', { length: 2 }),
  propertyZip:     varchar('property_zip', { length: 10 }),
  county:          varchar('county', { length: 255 }),
  ahjJurisdiction: varchar('ahj_jurisdiction', { length: 255 }),
  dateOfLoss:      timestamp('date_of_loss', { withTimezone: true }),
  perilType:       varchar('peril_type', { length: 20 }),
  carrierName:     varchar('carrier_name', { length: 255 }),
  claimNumberRef:  varchar('claim_number_ref', { length: 100 }), // contractor's internal ref
  roofSystem:      varchar('roof_system', { length: 255 }),
  stories:         integer('stories'),
  scopeNotes:      text('scope_notes'), // 2000 char (API-enforced)

  // branding (retained)
  logoFileKey:    varchar('logo_file_key', { length: 500 }),
  brandColorHex:  varchar('brand_color_hex', { length: 9 }),
  licenseDisplay: varchar('license_display', { length: 255 }),

  // delivery
  deliverableFileKey: varchar('deliverable_file_key', { length: 500 }),
  deliverableToken:   varchar('deliverable_token', { length: 64 }), // emailed access link; valid 30d post-delivery
  rejectReason:       text('reject_reason'),
  refundIssuedAt:     timestamp('refund_issued_at', { withTimezone: true }),

  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  approvedAt:  timestamp('approved_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  purgeAfter:  timestamp('purge_after', { withTimezone: true }), // delivered_at + 30d (or rejected + 7d)
  purgedAt:    timestamp('purged_at', { withTimezone: true }),
  adminNotes:  text('admin_notes'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type TrialSubmission = typeof trialSubmissions.$inferSelect;
export type InsertTrialSubmission = typeof trialSubmissions.$inferInsert;

export const trialUploads = pgTable('trial_uploads', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  submissionId: varchar('submission_id').notNull().references(() => trialSubmissions.id, { onDelete: 'cascade' }),
  fileKey:   varchar('file_key', { length: 500 }).notNull(),
  fileType:  varchar('file_type', { length: 30 }).notNull(),
  fileName:  varchar('file_name', { length: 255 }).notNull().default(''),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});
export type TrialUpload = typeof trialUploads.$inferSelect;

// Jurisdiction coverage — permanent AHJ work product index (no claim data).
// master_pack_id links to the ahj_master_packs row that backs this entry;
// null until a master pack is promoted for that jurisdiction.
export const ahjCoverage = pgTable('ahj_coverage', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  state:  varchar('state', { length: 2 }).notNull(),
  county: varchar('county', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('none'), // covered | in_progress | none
  codeCycle: varchar('code_cycle', { length: 100 }),
  /** FK to ahj_master_packs.id — set when a master pack is promoted. */
  masterPackId: varchar('master_pack_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type AhjCoverage = typeof ahjCoverage.$inferSelect;

export const waitlistEntries = pgTable('waitlist_entries', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  companyName:   varchar('company_name', { length: 255 }).notNull(),
  email:         varchar('email', { length: 255 }).notNull(),
  phone:         varchar('phone', { length: 50 }).notNull(),
  licenseNumber: varchar('license_number', { length: 100 }).notNull().default(''),
  state:  varchar('state', { length: 2 }).notNull(),
  county: varchar('county', { length: 255 }).notNull().default(''),
  reason: varchar('reason', { length: 50 }).notNull().default('coverage'), // coverage | capacity
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;

export const trialCreditLedger = pgTable('trial_credit_ledger', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar('account_id').notNull().references(() => trialAccounts.id),
  deltaCents: integer('delta_cents').notNull(),
  reason: varchar('reason', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type TrialCreditLedgerEntry = typeof trialCreditLedger.$inferSelect;

// Purge job audit log (spec §8).
export const trialPurgeAudit = pgTable('trial_purge_audit', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  submissionId: varchar('submission_id').notNull(),
  uploadsDeleted: integer('uploads_deleted').notNull().default(0),
  fieldsNulled: text('fields_nulled').notNull().default(''),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type TrialPurgeAuditRow = typeof trialPurgeAudit.$inferSelect;

export const SWEEP_ACTIONS = [
  'alert_7d',
  'alert_14d',
  'escalate_21d',
  'purge_30d',
  'blocked',
] as const;
export type SweepAction = (typeof SWEEP_ACTIONS)[number];

export const deactivationSweepLogTable = pgTable('deactivation_sweep_log', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }).notNull(),
  daysSince: integer('days_since').notNull(),
  actionTaken: varchar('action_taken', { enum: SWEEP_ACTIONS }).notNull(),
  blockedReason: text('blocked_reason'),
  detail: jsonb('detail'),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DeactivationSweepLog = typeof deactivationSweepLogTable.$inferSelect;
export type InsertDeactivationSweepLog = typeof deactivationSweepLogTable.$inferInsert;

// ---------------------------------------------------------------------------
// Per-claim pricing model (Master Build Document v1.0, migration 056)
// Seats are unlimited and free. Customers pay per claim delivered.
// All pricing values are table-driven — never hardcode amounts or rates.
// ---------------------------------------------------------------------------

export const BILLING_TERMS = ['annual', 'quarterly', 'monthly'] as const;
export type BillingTerm = (typeof BILLING_TERMS)[number];
export const SUBSCRIPTION_STATUSES = ['pending', 'active', 'canceled', 'past_due'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const CLAIM_LEDGER_SOURCES = ['commitment', 'bank', 'overage'] as const;
export type ClaimLedgerSource = (typeof CLAIM_LEDGER_SOURCES)[number];

/** Graduated pricing band (§2.1). bandTo null = open-ended last band. */
export const pricingBands = pgTable('pricing_bands', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  bandFrom: integer('band_from').notNull(),
  bandTo: integer('band_to'),
  rateCents: integer('rate_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});
export type PricingBand = typeof pricingBands.$inferSelect;

/** Named plan at a committed claim volume (§2.3). */
export const plans = pgTable('plans', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  planKey: varchar('plan_key', { length: 30 }).notNull().unique(),
  displayName: varchar('display_name', { length: 60 }).notNull(),
  committedClaims: integer('committed_claims').notNull(),
  /** Base annual price at 1.0× multiplier. Billing-term multiplier applied at quote time. */
  annualCents: integer('annual_cents').notNull(),
  setupAnnualCents: integer('setup_annual_cents').notNull(),
  /** Setup for quarterly or monthly billing (always ≥ setupAnnualCents). */
  setupInstallmentCents: integer('setup_installment_cents').notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});
export type Plan = typeof plans.$inferSelect;

/** Billing term with annual-price multiplier and installment count (§2.4). */
export const billingTerms = pgTable('billing_terms', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  termKey: varchar('term_key', { length: 20 }).notNull().unique(),
  displayName: varchar('display_name', { length: 40 }).notNull(),
  multiplier: numeric('multiplier', { precision: 4, scale: 2 }).notNull(),
  installments: integer('installments').notNull(),
});
export type BillingTermRow = typeof billingTerms.$inferSelect;

/** Feature-tier add-on, independent of volume plan (§2.6). */
export const featureTiers = pgTable('feature_tiers', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  tierKey: varchar('tier_key', { length: 20 }).notNull().unique(),
  displayName: varchar('display_name', { length: 60 }).notNull(),
  monthlyCents: integer('monthly_cents').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
});
export type FeatureTier = typeof featureTiers.$inferSelect;

/** Customer subscription — prospect fields null until tenant onboarded. */
export const subscriptions = pgTable('subscriptions', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  email: varchar('email', { length: 255 }),
  companyName: varchar('company_name', { length: 255 }),
  tenantId: varchar('tenant_id', { length: 100 }),
  trialAccountId: varchar('trial_account_id').references(() => trialAccounts.id),
  planId: varchar('plan_id').notNull().references(() => plans.id),
  billingTerm: varchar('billing_term', { length: 20 }).notNull(),
  featureTierId: varchar('feature_tier_id').references(() => featureTiers.id),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  committedClaims: integer('committed_claims').notNull(),
  claimsConsumed: integer('claims_consumed').notNull().default(0),
  claimsBanked: integer('claims_banked').notNull().default(0),
  termStart: timestamp('term_start', { withTimezone: true }),
  termEnd: timestamp('term_end', { withTimezone: true }),
  setupFeeCents: integer('setup_fee_cents').notNull(),
  setupPaidAt: timestamp('setup_paid_at', { withTimezone: true }),
  creditAppliedCents: integer('credit_applied_cents').notNull().default(0),
  overageRateCents: integer('overage_rate_cents').notNull().default(0),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type Subscription = typeof subscriptions.$inferSelect;

/** Claim consumption audit trail. */
export const claimLedger = pgTable('claim_ledger', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar('subscription_id').notNull().references(() => subscriptions.id),
  claimId: varchar('claim_id', { length: 100 }),
  packageId: varchar('package_id', { length: 100 }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
  source: varchar('source', { length: 20 }).notNull(),
  rateCents: integer('rate_cents').notNull(),
});
export type ClaimLedgerRow = typeof claimLedger.$inferSelect;

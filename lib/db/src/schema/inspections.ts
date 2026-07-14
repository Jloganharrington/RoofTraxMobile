import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { companiesTable, usersTable } from './auth';
import { pinsTable } from './rooftrax';

// Forensic inspection lifecycle. Content for each stage ships in a later
// phase — this phase only stores raw values and the lifecycle status.
export const INSPECTION_STATUSES = [
  'scheduled',
  'capturing',
  'validating',
  'submitted',
  'package_ready',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

// S0-S9 capture-stage vocabulary that lib/protocol (a later phase) will
// attach rules to. Stored here as plain values now so photos/attestations
// can reference a stage without a hard dependency on that package.
export const CAPTURE_STAGES = [
  'S0',
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
  'S6',
  'S7',
  'S8',
  'S9',
] as const;
export type CaptureStage = (typeof CAPTURE_STAGES)[number];

export const ELEVATION_DIRECTIONS = ['front', 'right', 'back', 'left'] as const;
export type ElevationDirection = (typeof ELEVATION_DIRECTIONS)[number];

// Which kind of record a photo/measurement is attached to. Polymorphic by
// design since the same evidence-capture flow attaches to slopes,
// elevations, damage instances, and test squares alike.
export const INSPECTION_SUBJECT_TYPES = [
  'inspection',
  'slope',
  'elevation',
  'damage_instance',
  'test_square',
] as const;
export type InspectionSubjectType = (typeof INSPECTION_SUBJECT_TYPES)[number];

export const PHOTO_TRIAD_ROLES = ['wide', 'mid', 'close'] as const;
export type PhotoTriadRole = (typeof PHOTO_TRIAD_ROLES)[number];

// Kind of attestation captured (Phase M-B). `equipment` is the S0
// equipment checklist; `gps_override` records an inspector overriding a
// failed arrival GPS-vs-geocode tolerance check (B6). `stage_signoff` is
// the generic per-stage sign-off from M-A (null attestationType behaves as
// that for backwards compatibility).
export const ATTESTATION_TYPES = ['equipment', 'gps_override', 'stage_signoff'] as const;
export type AttestationType = (typeof ATTESTATION_TYPES)[number];

// Structured arrival-conditions log recorded on arrival (B6 / S1). Stored
// verbatim on the inspection row; no derived logic.
export interface ArrivalConditions {
  sky: string | null;
  wind: string | null;
  temp: string | null;
  personnelPresent: string | null;
  recordedAtUtc: string;
}

// The inspector-confirmed "storm of record" (Phase M-B / B5), written to
// inspections.stormConfirmedRef. This is a raw snapshot of the single
// severe-weather event the inspector selected as the cause of loss —
// pulled from the deterministic VisualCrossing engine (no AI scoring in
// this phase). Stored verbatim; no derived logic.
export interface StormConfirmedRef {
  // 'YYYY-MM-DD' event date.
  date: string;
  type: 'hail' | 'wind' | 'tornado';
  hailSize: number | null;
  windSpeed: number | null;
  distance: number | null;
  description: string | null;
  // The dateOfLoss + location the pull was run against, for provenance.
  queriedLocation: string;
  dateOfLoss: string | null;
  // When the inspector confirmed this event (UTC ISO-8601).
  confirmedAtUtc: string;
}

// A single forensic inspection engagement. `pinId` is nullable because an
// inspection can be scheduled directly (e.g. from a carrier referral)
// without ever having gone through the canvassing pin-drop flow.
export const inspectionsTable = pgTable('inspections', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  pinId: varchar('pin_id').references(() => pinsTable.id, { onDelete: 'set null' }),
  inspectorUserId: varchar('inspector_user_id')
    .notNull()
    .references(() => usersTable.id),
  status: varchar('status', { enum: INSPECTION_STATUSES }).notNull().default('scheduled'),
  claimNumber: text('claim_number'),
  policyNumber: text('policy_number'),
  carrierName: text('carrier_name'),
  insuredName: text('insured_name'),
  address: text('address'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  notes: text('notes'),
  // Additional intake fields (B4). Carrier/policy/claim/insured already
  // exist above; date-of-loss is captured here for the storm engine (B5).
  dateOfLoss: text('date_of_loss'),
  // Inspector-confirmed storm of record (B5). Nullable + a SOFT gate —
  // an inspection may proceed without it.
  stormConfirmedRef: jsonb('storm_confirmed_ref').$type<StormConfirmedRef | null>(),
  // Arrival-conditions log captured in S1 (B6). Nullable.
  arrivalConditions: jsonb('arrival_conditions').$type<ArrivalConditions | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// A roof facet/plane on the inspected structure. Raw geometry only — no
// derived area/waste; that math belongs to a later phase.
export const inspectionSlopesTable = pgTable('inspection_slopes', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  pitchRise: doublePrecision('pitch_rise'),
  pitchRun: doublePrecision('pitch_run'),
  materialType: text('material_type'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One of the four building elevations (front/right/back/left).
export const inspectionElevationsTable = pgTable('inspection_elevations', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  direction: varchar('direction', { enum: ELEVATION_DIRECTIONS }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A single documented instance of damage, optionally tied to a specific
// slope or elevation. `causationNote` records the inspector's raw
// observation of cause (e.g. "hail impact, granule loss") — not a scored
// determination.
export const damageInstancesTable = pgTable('damage_instances', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  slopeId: varchar('slope_id').references(() => inspectionSlopesTable.id, {
    onDelete: 'set null',
  }),
  elevationId: varchar('elevation_id').references(() => inspectionElevationsTable.id, {
    onDelete: 'set null',
  }),
  damageType: text('damage_type').notNull(),
  severity: text('severity'),
  causationNote: text('causation_note'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A marked test square (typically 10'x10') used to sample hail-hit density
// on a slope.
export const testSquaresTable = pgTable('test_squares', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  slopeId: varchar('slope_id').references(() => inspectionSlopesTable.id, {
    onDelete: 'set null',
  }),
  label: text('label').notNull(),
  sizeSqFt: doublePrecision('size_sq_ft'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// An individual hit/mark counted within a test square.
export const testSquareHitsTable = pgTable('test_square_hits', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  testSquareId: varchar('test_square_id')
    .notNull()
    .references(() => testSquaresTable.id, { onDelete: 'cascade' }),
  hitType: text('hit_type'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Evidence photo captured during an inspection. `subjectType`/`subjectId`
// form a polymorphic reference (no DB-level FK, since it can point at any
// of several tables) to whatever the photo documents. EXIF/GPS/UTC and the
// SHA-256 are captured client-side at shutter time (A6) and stored
// verbatim; `overlayJson` holds annotation data layered on top of, but
// never modifying, the original image.
export const inspectionPhotosTable = pgTable('inspection_photos', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  stage: varchar('stage', { enum: CAPTURE_STAGES }),
  subjectType: varchar('subject_type', { enum: INSPECTION_SUBJECT_TYPES }).notNull(),
  subjectId: varchar('subject_id'),
  triadRole: varchar('triad_role', { enum: PHOTO_TRIAD_ROLES }),
  url: text('url').notNull(),
  sha256: text('sha256').notNull(),
  exifJson: jsonb('exif_json'),
  overlayJson: jsonb('overlay_json'),
  capturedAtUtc: timestamp('captured_at_utc', { withTimezone: true }),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A single raw measurement (length, width, count, etc.) attached to any
// subject in the inspection. Unit-agnostic string `unit` field — no
// conversion or derived math happens here.
export const measurementsTable = pgTable('measurements', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  subjectType: varchar('subject_type', { enum: INSPECTION_SUBJECT_TYPES }).notNull(),
  subjectId: varchar('subject_id'),
  measurementType: text('measurement_type').notNull(),
  value: doublePrecision('value').notNull(),
  unit: text('unit'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Inspector sign-off at a given capture stage. `signatureData` stores
// whatever raw attestation payload the client captures (e.g. a typed
// name/timestamp confirmation, or a signature image URL) — no validation
// logic lives here yet.
export const attestationsTable = pgTable('attestations', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id),
  stage: varchar('stage', { enum: CAPTURE_STAGES }),
  // What kind of attestation this is (B4/B6). Null = the generic M-A
  // per-stage sign-off.
  attestationType: varchar('attestation_type', { enum: ATTESTATION_TYPES }),
  // Structured payload for typed attestations: the equipment checklist for
  // `equipment`, and the measured distance + reason for `gps_override`.
  details: jsonb('details'),
  signatureData: text('signature_data'),
  attestedAt: timestamp('attested_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Inspection = typeof inspectionsTable.$inferSelect;
export type InsertInspection = typeof inspectionsTable.$inferInsert;
export type InspectionSlope = typeof inspectionSlopesTable.$inferSelect;
export type InspectionElevation = typeof inspectionElevationsTable.$inferSelect;
export type DamageInstance = typeof damageInstancesTable.$inferSelect;
export type TestSquare = typeof testSquaresTable.$inferSelect;
export type TestSquareHit = typeof testSquareHitsTable.$inferSelect;
export type InspectionPhoto = typeof inspectionPhotosTable.$inferSelect;
export type Measurement = typeof measurementsTable.$inferSelect;
export type Attestation = typeof attestationsTable.$inferSelect;

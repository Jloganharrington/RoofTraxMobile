import { sql } from 'drizzle-orm';
import {
  boolean,
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

// Business phase of a single inspection record. An inspection begins as a
// light top-of-funnel `preliminary` (address + damage type + 4 single-shot
// photos + storm confirm + a homeowner report) and, at the P4 checkpoint,
// advances IN PLACE to `forensic` — the same row inherits its Phase 1 data by
// identity, so there are never two records for one property. `forensic` is the
// default so every pre-existing inspection (and the unchanged forensic
// create/gate model) keeps behaving exactly as before.
export const INSPECTION_PHASES = ['preliminary', 'forensic'] as const;
export type InspectionPhase = (typeof INSPECTION_PHASES)[number];

// The four single-shot Phase 1 evidence slots (P2). Captured through the same
// evidence module as the forensic triad but WITHOUT a triad (one shot each,
// still hashed + GPS-stamped). `damage_closeup` is captured twice.
export const PRELIMINARY_PHOTO_ROLES = [
  'front_of_home',
  'roof_overview',
  'damage_closeup',
] as const;
export type PreliminaryPhotoRole = (typeof PRELIMINARY_PHOTO_ROLES)[number];

// Protocol v2 step-key vocabulary that lib/protocol attaches rules to.
// Stored here as plain values so photos/attestations can reference a step
// without a hard dependency on that package. S-numbers are retired — these
// mirror (by key only) PROTOCOL_STEPS in @workspace/protocol.
export const CAPTURE_STAGES = [
  'arrival',
  'elevation_access',
  'facets',
  'test_squares',
  'components',
  'collateral',
  'product',
  'interior',
  'homeowner',
  'declaration',
  'submit',
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
  // M-D additive subject: a per-hit close-up (with scale gauge in frame)
  // attaches to the individual test-square hit it documents, so no S4 photo
  // is ever left as an orphan (D4).
  'test_square_hit',
  // C4 / C5 additive subjects: the same evidence-capture flow attaches to a
  // documented existing-component, a roof penetration, and a product-ID
  // record just as it does to slopes and damage instances.
  'component',
  'penetration',
  'product',
  // M-E (E2) additive subject: an interior/attic observation the evidence
  // capture flow attaches room-stain / moisture / attic photos to.
  'interior_observation',
] as const;
export type InspectionSubjectType = (typeof INSPECTION_SUBJECT_TYPES)[number];

// C4 — Components documentation. Controlled vocabulary for the
// existing-components checklist plus the `layer_count` observation (a
// numeric count recorded from the eave/rake tear-off photo). No derived
// logic: `status` is a raw present/absent/not-determined observation and
// `layerCount` is a raw integer, both captured by the inspector.
export const COMPONENT_TYPES = [
  'drip_edge',
  'ice_and_water_shield',
  'ventilation',
  'decking',
  'underlayment',
  'flashing',
  'layer_count',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const COMPONENT_STATUSES = ['present', 'absent', 'not_determined'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

// C4 — Penetration inventory. Each roof penetration the inspector logs is a
// discrete raw observation with a controlled type.
export const PENETRATION_TYPES = [
  'plumbing_vent',
  'pipe_boot',
  'exhaust_vent',
  'chimney',
  'skylight',
  'satellite_mount',
  'other',
] as const;
export type PenetrationType = (typeof PENETRATION_TYPES)[number];

// C5 — Product identification. How the roofing product was identified in the
// field: read directly, sampled for lab (ITEL) identification, or flagged as
// unidentifiable-in-field (which the protocol soft-flags for reviewer follow-up).
export const PRODUCT_ID_METHODS = ['field_identified', 'itel_sample', 'unidentifiable'] as const;
export type ProductIdMethod = (typeof PRODUCT_ID_METHODS)[number];

// Protocol v2 — per-facet damage classification. Drives the Step-4 hail
// gate: only facets carrying hail (hail | hail_and_wind) require a test
// square.
export const FACET_DAMAGE_TYPES = ['hail', 'wind', 'hail_and_wind', 'none'] as const;
export type FacetDamageType = (typeof FACET_DAMAGE_TYPES)[number];

// How a facet ties into its neighbors — drives the tie-in cut protocol.
export const TIE_IN_PROTOCOLS = ['valley', 'hip_ridge'] as const;
export type TieInProtocol = (typeof TIE_IN_PROTOCOLS)[number];

export const PHOTO_TRIAD_ROLES = ['wide', 'mid', 'close'] as const;
export type PhotoTriadRole = (typeof PHOTO_TRIAD_ROLES)[number];

// M-E (E2) — Controlled vocabulary for a single interior/attic observation.
// Raw facts only: the inspector records what they saw (a stain, a moisture
// reading, an attic pass) — no derived severity or causation lives here.
export const INTERIOR_OBSERVATION_TYPES = [
  'ceiling_stain',
  'wall_stain',
  'moisture_reading',
  'attic_pass',
  'other',
] as const;
export type InteriorObservationType = (typeof INTERIOR_OBSERVATION_TYPES)[number];

// M-D (D1) — Controlled vocabulary for classifying each hit counted inside a
// test square. The app records the raw classification only; it never derives
// hail density, severity, or significance from these counts (that is the
// Brain's job downstream). `foot_scuff` / `mechanical` / `blistering` let the
// inspector distinguish non-storm marks so the raw hit count stays honest.
export const TEST_SQUARE_HIT_TYPES = [
  'hail_strike',
  'mechanical',
  'blistering',
  'foot_scuff',
] as const;
export type TestSquareHitType = (typeof TEST_SQUARE_HIT_TYPES)[number];

// Kind of attestation captured (Phase M-B). `equipment` is the S0
// equipment checklist; `gps_override` records an inspector overriding a
// failed arrival GPS-vs-geocode tolerance check (B6). `stage_signoff` is
// the generic per-stage sign-off from M-A (null attestationType behaves as
// that for backwards compatibility).
export const ATTESTATION_TYPES = ['equipment', 'gps_override', 'stage_signoff'] as const;
export type AttestationType = (typeof ATTESTATION_TYPES)[number];

// Structured arrival-conditions log recorded on arrival (Step 1 · Arrival
// Log). Stored verbatim on the inspection row; no derived logic.
// `windCondition` replaces the old `wind` field and `personnelPresent` is an
// array (protocol v2) — pre-launch, no prod data to migrate.
export interface ArrivalConditions {
  sky: string | null;
  windCondition: string | null;
  temp: string | null;
  personnelPresent: string[];
  // Auto-captured on arrival: device local time + GPS position (§4 contract).
  timeLocal: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  recordedAtUtc: string;
}

// Structured homeowner facts (M-E / E3). Plain factual intake only — no
// coverage, settlement, or advice language ever lives here. Stored verbatim
// on the inspection row as a single additive jsonb column.
export interface HomeownerFacts {
  // Whether the homeowner is aware of / can corroborate the date of loss.
  awareOfDateOfLoss: boolean | null;
  // Free-text factual notes on prior repairs and prior claims.
  priorRepairs: string | null;
  priorClaims: string | null;
  recordedAtUtc: string;
}

// The client-assembled submission contract (M-E / E6), stored verbatim when
// the inspection is submitted. The app authors it (manifest of records +
// photo SHA-256 hashes + protocol version + gate results); the server accepts
// it thin. Hash verification, record locking, and a pre-flight endpoint are
// deferred to M-F — this column is just the durable snapshot of what was sent.
export type SubmissionManifestV1 = Record<string, unknown>;

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
  // Business phase (P0). Defaults to `forensic` so every pre-existing row and
  // the unchanged forensic create path are untouched; the Phase 1 flow sets
  // `preliminary` explicitly, and the P4 checkpoint advances it in place.
  phase: varchar('phase', { enum: INSPECTION_PHASES }).notNull().default('forensic'),
  // Phase 1 light damage type (P2), e.g. "hail" / "wind" / "wind_and_hail".
  // Free text so the mobile choice set can evolve without a migration. Nullable
  // because forensic-first inspections never capture it here.
  damageType: text('damage_type'),
  // Set when the inspector marks Phase 1 done at the P4 checkpoint (either
  // "preliminary complete — resume later" or as provenance when advancing to
  // forensic). Nullable until then.
  preliminaryCompletedAt: timestamp('preliminary_completed_at', { withTimezone: true }),
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
  // Structured homeowner facts (E3). Nullable; facts only.
  homeownerFacts: jsonb('homeowner_facts').$type<HomeownerFacts | null>(),
  // Client-assembled submission contract v1 (E6), stored verbatim on submit.
  // Nullable until the inspection is submitted.
  submissionManifest: jsonb('submission_manifest').$type<SubmissionManifestV1 | null>(),
  // Immutability marker (M-F / F2). Set at the moment a submission passes
  // server-side verification (photo-hash re-check + gate re-evaluation). Once
  // set, the record is locked: every child-write route rejects further edits,
  // and a correction must be filed as an addendum instead. Nullable until the
  // inspection is successfully submitted.
  lockedAt: timestamp('locked_at', { withTimezone: true }),
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
  // Protocol v2 facet fields: per-facet area (feeds squares/pricing), the
  // damage classification that drives the Step-4 hail gate, and whether the
  // inspector observed damage on this facet at all.
  areaSqft: doublePrecision('area_sqft'),
  damageType: varchar('damage_type', { enum: FACET_DAMAGE_TYPES }),
  damagePresent: boolean('damage_present').notNull().default(false),
  // How this facet ties into its neighbors (valley vs hip/ridge cut protocol).
  tieInProtocol: varchar('tie_in_protocol', { enum: TIE_IN_PROTOCOLS }),
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
  // Controlled classification (D1). Stored as text so no DB migration is
  // needed; the `enum` only constrains the TypeScript type. Nullable for
  // backwards compatibility with any pre-M-D free-text rows.
  hitType: text('hit_type', { enum: TEST_SQUARE_HIT_TYPES }),
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
  // Phase 1 single-shot slot (P2). Mutually exclusive with `triadRole`: a
  // preliminary photo sets this and leaves triadRole null; a forensic triad
  // photo sets triadRole and leaves this null. Nullable for every existing row.
  preliminaryRole: varchar('preliminary_role', { enum: PRELIMINARY_PHOTO_ROLES }),
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

// C4 — A documented existing-component observation (checklist item or the
// eave/rake layer-count). Raw facts only: a `status` for checklist items and
// an optional integer `layerCount` for the layer-count entry. `slopeId` is
// nullable because some components (e.g. layer count at a single eave) are
// documented against a specific slope while others are whole-roof.
export const inspectionComponentsTable = pgTable('inspection_components', {
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
  componentType: varchar('component_type', { enum: COMPONENT_TYPES }).notNull(),
  status: varchar('status', { enum: COMPONENT_STATUSES }),
  layerCount: doublePrecision('layer_count'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// C4 — A single roof penetration logged during the components sweep.
export const inspectionPenetrationsTable = pgTable('inspection_penetrations', {
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
  penetrationType: varchar('penetration_type', { enum: PENETRATION_TYPES }).notNull(),
  flashingCondition: text('flashing_condition'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// C5 — Product identification record. Captures the raw brand/profile the
// inspector read (or the ITEL sample reference, or an unidentifiable flag).
// `itelSampleRef` records the bag-&-label id when a physical sample was
// taken; `unidentifiableReason` records the inspector's note when the
// product could not be identified in the field. No pricing/derived logic.
export const inspectionProductsTable = pgTable('inspection_products', {
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
  category: text('category'),
  brand: text('brand'),
  productLine: text('product_line'),
  identificationMethod: varchar('identification_method', { enum: PRODUCT_ID_METHODS }).notNull(),
  itelSampleRef: text('itel_sample_ref'),
  unidentifiableReason: text('unidentifiable_reason'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// M-E (E2) — A single interior/attic observation. Additive, company- and
// inspection-scoped. Raw facts only: a location, a controlled observation
// type, and an optional numeric moisture reading. Whether an inspection needs
// interior documentation at all is a protocol soft flag, cleared either by
// recording observations or by filing an explicit "no interior claim"
// attestation (S6).
export const inspectionInteriorObservationsTable = pgTable('inspection_interior_observations', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  location: text('location').notNull(),
  observationType: varchar('observation_type', { enum: INTERIOR_OBSERVATION_TYPES }).notNull(),
  moistureReading: doublePrecision('moisture_reading'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// M-F (F2) — Post-lock corrections. Once an inspection is locked at
// submission, its captured records are immutable; any later correction is an
// append-only addendum rather than an edit, preserving the original evidentiary
// record. Additive, company- and inspection-scoped. `body` is the free-text
// correction the inspector files; there is no derived logic here — the Brain
// consumes the original record plus its addenda downstream.
export const inspectionAddendaTable = pgTable('inspection_addenda', {
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
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// M-F (F4) — Per-tenant CRM linkage config. The CRM seam (scheduled-inspection
// queue in, appointment-completion + report ingest out) is keyed by a
// per-company field key issued by the external CRM. No external CRM keys exist
// in the platform yet, so this stays disabled by default: reads report
// "pending" and return empty/null rather than fabricating data. `fieldKey` is
// the opaque per-tenant key; `enabled` flips the seam from pending to active
// once a real key is provisioned. One row per company.
export const companyCrmConfigTable = pgTable('company_crm_config', {
  companyId: varchar('company_id')
    .primaryKey()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  fieldKey: text('field_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Inspection = typeof inspectionsTable.$inferSelect;
export type InspectionAddendum = typeof inspectionAddendaTable.$inferSelect;
export type CompanyCrmConfig = typeof companyCrmConfigTable.$inferSelect;
export type InteriorObservation = typeof inspectionInteriorObservationsTable.$inferSelect;
export type InsertInspection = typeof inspectionsTable.$inferInsert;
export type InspectionSlope = typeof inspectionSlopesTable.$inferSelect;
export type InspectionElevation = typeof inspectionElevationsTable.$inferSelect;
export type DamageInstance = typeof damageInstancesTable.$inferSelect;
export type TestSquare = typeof testSquaresTable.$inferSelect;
export type TestSquareHit = typeof testSquareHitsTable.$inferSelect;
export type InspectionPhoto = typeof inspectionPhotosTable.$inferSelect;
export type Measurement = typeof measurementsTable.$inferSelect;
export type Attestation = typeof attestationsTable.$inferSelect;
export type InspectionComponent = typeof inspectionComponentsTable.$inferSelect;
export type InspectionPenetration = typeof inspectionPenetrationsTable.$inferSelect;
export type InspectionProduct = typeof inspectionProductsTable.$inferSelect;

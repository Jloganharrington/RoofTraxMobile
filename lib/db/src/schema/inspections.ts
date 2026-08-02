import { sql } from 'drizzle-orm';
import { uniqueIndex } from 'drizzle-orm/pg-core';
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  real,
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
  // Legacy generic close-up (pre surface-tagging). Counted as a ROOF
  // close-up by the gates so old records stay green.
  'damage_closeup',
  // Surface-tagged close-ups: >=1 required per damage surface selected in
  // Phase 1 (roof/siding/collateral), so the preliminary report never
  // asserts damage on a surface with no photo of it.
  'damage_closeup_roof',
  'damage_closeup_siding',
  'damage_closeup_collateral',
  'damage_closeup_interior',
] as const;
export type PreliminaryPhotoRole = (typeof PRELIMINARY_PHOTO_ROLES)[number];

// Protocol v2 step-key vocabulary that lib/protocol attaches rules to.
// Stored here as plain values so photos/attestations can reference a step
// without a hard dependency on that package. S-numbers are retired — these
// mirror (by key only) PROTOCOL_STEPS in @workspace/protocol.
export const CAPTURE_STAGES = [
  'arrival',
  'property_profile',
  'elevation_access',
  'facets',
  'test_squares',
  'components',
  'product',
  'siding',
  'collateral',
  'interior',
  'repairability',
  'mitigation',
  'homeowner',
  'existing_conditions',
  'declaration',
  'summary',
  'estimate',
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
  // v2.1 additive subject: a siding facet (S1, S2, …) the siding-inspection
  // flow attaches damage / facet / component photos to.
  'siding_facet',
] as const;
export type InspectionSubjectType = (typeof INSPECTION_SUBJECT_TYPES)[number];

// C4 — Components documentation. Controlled vocabulary for the
// existing-components checklist plus the `layer_count` observation (a
// numeric count recorded from the eave/rake tear-off photo). No derived
// logic: `status` is a raw present/absent/not-determined observation and
// `layerCount` is a raw integer, both captured by the inspector.
export const COMPONENT_TYPES = [
  'gutter_apron',
  'drip_edge',
  'ice_and_water_shield',
  'underlayment',
  'starter',
  'decking',
  'ventilation',
  // Retired from the checklist UI but kept for legacy rows.
  'flashing',
  'layer_count',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

// Zone-based component capture (Step 5). One shared zone photo evidences
// every component documented in that zone.
export const COMPONENT_ZONES = ['eave_edge', 'ridge_hip', 'shingle_gauge'] as const;
export type ComponentZone = (typeof COMPONENT_ZONES)[number];

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

// v2.1 — Siding facet damage classification (distinct vocabulary from roof
// facets: siding claims classify wind / hail / tree impact).
export const SIDING_DAMAGE_TYPES = ['wind', 'hail', 'tree'] as const;
export type SidingDamageType = (typeof SIDING_DAMAGE_TYPES)[number];

// v2.1 — Which role a siding-facet photo plays: the damage close-up, the
// whole-facet shot, or one declared component's photo. Deterministic gate
// discrimination (mirrors the `zone` tag pattern) — never inferred from
// caption strings.
export const SIDING_PHOTO_ROLES = ['damage', 'facet', 'component'] as const;
export type SidingPhotoRole = (typeof SIDING_PHOTO_ROLES)[number];

export const PHOTO_TRIAD_ROLES = ['wide', 'mid', 'close'] as const;
export type PhotoTriadRole = (typeof PHOTO_TRIAD_ROLES)[number];

// REPORT_DATA v2 — the full role vocabulary the photo column accepts. The
// forensic triad stays wide/mid/close (triad gates key off PHOTO_TRIAD_ROLES
// only); `measurement` and `collateral` are additional standalone roles that
// map 1:1 onto the report contract's `captureContext`. Extend this list —
// never build a parallel tagging system.
export const PHOTO_CAPTURE_ROLES = ['wide', 'mid', 'close', 'measurement', 'collateral'] as const;
export type PhotoCaptureRole = (typeof PHOTO_CAPTURE_ROLES)[number];

// The report contract's captureContext vocabulary, derived (never stored)
// from triadRole/preliminaryRole at serialization time.
export const PHOTO_CAPTURE_CONTEXTS = [
  'overview',
  'mid-range',
  'close-up',
  'measurement',
  'collateral',
] as const;
export type PhotoCaptureContext = (typeof PHOTO_CAPTURE_CONTEXTS)[number];

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
  recordedAtUtc: string;
  // Legacy free-text fields (superseded by previousRepairs / previousClaimsOpened).
  priorRepairs?: string | null;
  priorClaims?: string | null;
  // Policy Review
  policyActiveAtLoss?: boolean | null;
  replacementCostCoverage?: boolean | null;
  olCoverage?: boolean | null;
  specialExclusions?: string | null;
  // Property facts reported by homeowner
  lengthOfOwnership?: string | null;
  knownRoofAge?: string | null;
  knownSidingAge?: string | null;
  // Event facts
  homeAtTimeOfEvent?: boolean | null;
  mitigationStepsPrior?: string | null;
  // Claim & repair history
  previousClaimsOpened?: string | null;
  currentClaimsOpened?: string | null;
  previousRepairs?: string | null;
  previousUnrepairedDamage?: string | null;
}

// ── Contractor-lane content lint (Phase 2 forensic report) ────────────────
// The Phase 2 report is a contractor construction document. Every AI-written
// fragment is linted server-side against a forbidden-phrase rule set before
// storage; results are stored verbatim alongside the content (AI text is
// never silently rewritten).

export const REPORT_LINT_STATUSES = ['passed', 'needs_review', 'blocked'] as const;
export type ReportLintStatus = (typeof REPORT_LINT_STATUSES)[number];

export interface ReportLintFinding {
  // Which fragment the finding is in, e.g. "forensicSummary",
  // "photoGroupings[2].narrative".
  fragmentRef: string;
  ruleId: string;
  matchedText: string;
  severity: 'blocked' | 'needs_review';
}

export interface ReportLintResult {
  lintStatus: ReportLintStatus;
  findings: ReportLintFinding[];
}

// Reviewer resolution of a blocked lint result — server-stamped, scoped to
// one compiled blob path so re-compiles always re-enter the gate.
export interface ReportLintResolution {
  // Compiled report blob path this resolution applies to.
  path: string;
  resolvedBy: string; // user id (manager/admin)
  resolvedAt: string; // ISO timestamp, server-stamped
  note: string | null;
}

// One manager-authorized reopen of a locked (submitted) inspection. All
// fields server-stamped; `reason` is required at the API so the audit trail
// always says why the evidentiary seal was broken.
export interface InspectionUnlockEvent {
  unlockedBy: string; // user id (manager/admin)
  unlockedByName: string | null;
  unlockedAt: string; // ISO timestamp, server-stamped
  reason: string;
  previousLockedAt: string; // ISO timestamp the record had been locked since
  previousStatus: string;
}

// REPORT_DATA v2 — Property Profile (field-captured, non-derived fields
// only). Derived values (roofSlopeCount, roofCovering, interiorAreasInspected,
// temporaryRepairsCompleted, flashingsAndPenetrations) are computed by the
// Brain from data the app already holds — never asked twice.
// Advisory contractor estimate saved at the Estimate step. All money in
// integer cents. Line rows snapshot the price-book item's description /
// unit / unit price at save time so later price-book edits never rewrite
// history; priceBookItemId is kept for traceability only (null for manual
// lines).
// Evidence-chain link provenance (photo/finding → scope line). Who created
// the link and whether a reviewer approved it. AI-suggested links must never
// be treated as verified evidence unless approved.
export const EVIDENCE_LINK_SOURCES = ['inspector', 'user', 'ai_suggested', 'imported'] as const;
export type EvidenceLinkSource = (typeof EVIDENCE_LINK_SOURCES)[number];

export const EVIDENCE_LINK_REVIEW_STATUSES = ['unreviewed', 'approved', 'rejected'] as const;
export type EvidenceLinkReviewStatus = (typeof EVIDENCE_LINK_REVIEW_STATUSES)[number];

// A structured link from an estimate/scope line to a piece of evidence — a
// photo or a damage finding. reviewedBy/reviewedAt are stamped SERVER-SIDE
// whenever reviewStatus is approved/rejected; never trusted from the client.
export interface EvidenceLink {
  targetType: 'photo' | 'damage_instance';
  targetId: string;
  linkSource: EvidenceLinkSource;
  reviewStatus: EvidenceLinkReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface EstimateLineItem {
  priceBookItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  isAdder: boolean;
  /** Structured evidence links (with provenance/review state). Optional —
   *  absent on legacy lines. */
  evidenceLinks?: EvidenceLink[];
  /** Server-derived convenience arrays of APPROVED link targets only.
   *  Recomputed on every save from evidenceLinks; never client-trusted. */
  linkedPhotoIds?: string[];
  linkedDamageInstanceIds?: string[];
}

export interface InspectionEstimate {
  /** Waste factor applied to measured roof squares (e.g. 10 = 10%). */
  wastePercent: number;
  /** The measurements the estimate was derived from, frozen at save time. */
  measuredBasis: {
    roofAreaSqft: number | null;
    roofSquares: number | null;
    wasteAdjustedSquares: number | null;
    damagedSidingFacetCount: number;
  };
  lines: EstimateLineItem[];
  subtotalCents: number;
  note: string | null;
  updatedAt: string;
}

export interface PropertyProfile {
  propertyType?: string | null; // single_family / townhome / condo / multi_family / commercial
  stories?: string | null; // '1' / '1.5' / '2' / '2.5' / '3+'
  roofType?: string | null;
  roofAgeYears?: number | null;
  // Basis for the roof age — an unsourced number is attackable. Required
  // whenever roofAgeYears is set.
  roofAgeBasis?: string | null; // homeowner_reported / permit_record / product_date_code / estimated
  accessibilityNotes?: string | null;
  buildingType?: string | null;
  attachedOrDetached?: string | null; // attached / detached
  roofGeometry?: string[]; // gable / hip / mansard / gambrel / flat / complex (multi-select)
  deckType?: string | null; // plywood / osb / plank / skip_sheathing / unknown
  framingConditionNotes?: string | null;
  recordedAtUtc: string;
}

// REPORT_DATA v2 — Repairability Assessment. The crux of replace-vs-repair
// disputes: MUST be explicitly performed, never defaulted or auto-populated.
// Null on the inspection row means "not performed" and the report section
// omits. assessorName/assessorCredentials are injected server-side from the
// inspector's profile at save time — never typed in the field.
// v2 (2026-07-26): structured question-flow record. Per-system (roof /
// siding) answer maps keyed by question id (RR-xxx / SR-xxx), a gated
// 4-level determination (never "full replacement required"), documented
// basis factors, and linked evidence. Validation rules live in
// api-server/src/lib/repairabilityRules.ts. Legacy v1 records (free-text
// fields + repairable/not_repairable) may still exist in stored rows;
// readers must tolerate both shapes.
export type RepairabilityDetermination =
  | 'supported'
  | 'conditionally_supported'
  | 'not_supported'
  | 'indeterminate';

// Roof flows branch by roofing material. Legacy v2 roof flows written before
// material branching carry no roofMaterial — readers treat those as
// asphalt_shingle (the only flow that existed then).
export type RepairabilityRoofMaterial = 'asphalt_shingle' | 'cedar_shake' | 'standing_seam_metal';

// Snapshot of the Known Product Catalog entry a rep matched during
// identification (RR-010A). Attributes are server-hydrated from the
// company's discontinued-products catalog at save time so the record
// stays intact even if the catalog entry is later edited or removed.
export interface RepairabilityProductMatch {
  productId: string;
  // Optional on input (clients may send only productId); always present in
  // stored records because the server hydrates it from the catalog.
  name?: string;
  photoPath?: string | null;
  widthInches?: number | null;
  exposureInches?: number | null;
}

// Repair Attempt Protocol (RAP) — asphalt-shingle roof flows only. Mirrors
// the mobile RAP screen: shingle "X" is pulled, shingles 1–8 around it are
// manipulated, mat transfer is checked on 1–2, and five collateral-damage
// questions cover shingles 3–8. Photo fields reference inspection_photos
// row ids (never URLs). Optional/absent on flows recorded before RAP; the
// report renders the scorecard only when a RAP record is present.
export type RapYesNo = 'yes' | 'no';

// Ordered — this order is also the report/scorecard display order and the
// photo-priority order (delamination first, then creasing/cracking).
export type RapDamageCategoryKey =
  | 'delamination'
  | 'creasing'
  | 'nailZone'
  | 'puncture'
  | 'reseat';

export interface RapDamageFinding {
  answer: RapYesNo;
  /** Affected shingle numbers (3–8). */
  shingles: number[];
  /** inspection_photos id of the one example photo for this category. */
  photoId?: string | null;
  note?: string | null;
}

/** The five geometric/site criteria the rep confirms before marking. */
export interface RapSelectionCriteria {
  fullLengthUncut: boolean;
  twoCoursesAboveEave: boolean;
  fullShingleLengthFromEdges: boolean;
  freeOfPenetrations: boolean;
  representativeExposure: boolean;
}

/** Target-shingle selection record. Added after initial RAP launch — absent
 *  on legacy assessments that predate the selection step. */
export interface RapSelection {
  /** 'damaged_target': the standard case — a shingle with documented
   *  event-attributed damage was selected. 'fallback_slope': no usable
   *  damaged shingle was available; protocol performed on a slope with
   *  identified damage (note required). */
  mode: 'damaged_target' | 'fallback_slope';
  /** Required when mode === 'fallback_slope'. */
  note?: string;
  criteria: RapSelectionCriteria;
}

export interface RepairAttemptProtocol {
  /** Target-shingle selection confirmations. Absent on assessments
   *  predating the selection step — readers must treat it as optional. */
  selection?: RapSelection | null;
  /** How many shingles required manipulation to complete the protocol
   * (6, 7, or 8). Null while unanswered; legacy records without it render
   * the historical fixed count. */
  manipulatedCount?: 6 | 7 | 8 | null;
  /** inspection_photos id of the marked-shingles (RAP1) photo. */
  rap1PhotoId?: string | null;
  /** Mat-transfer findings on shingles 1 and 2 during removal. */
  matTransfer: { shingle1: RapYesNo | null; shingle2: RapYesNo | null };
  /** Collateral-damage answers keyed by category. */
  damage: Partial<Record<RapDamageCategoryKey, RapDamageFinding>>;
}

// Vinyl Assessment Protocol (VAP) — vinyl-siding flows only. Mirrors the
// mobile vinyl repairability screen: panel "X" is removed and replaced,
// surrounding panels 1–4 and trim components T1+ are manipulated, and five
// collateral-damage questions cover the manipulated components. Photo fields
// reference inspection_photos row ids (never URLs).

// Ordered — this order is the report/scorecard display order (question order
// 1–5 on the mobile screen). Photo PRIORITY differs: see
// VAP_PHOTO_PRIORITY in the server scorecard lib (locking edge first).
export type VapDamageCategoryKey =
  | 'crackSplit'
  | 'lockingEdge'
  | 'nailHem'
  | 'trimInterface'
  | 'reseat';

/** Manipulated-component label: panels "1"–"4", trim "T1"–"T4". */
export type VapComponentId = string;

export interface VapDamageFinding {
  answer: RapYesNo;
  /** Affected components ("1"–"4", "T1"–"T4"). */
  components: VapComponentId[];
  /** inspection_photos id of the one example photo for this category. */
  photoId?: string | null;
  note?: string | null;
}

export interface VinylAssessmentProtocol {
  /** Panels manipulated beside/around X (2–6). Null while unanswered. */
  panelsManipulated?: number | null;
  /** Trim/interface components manipulated (0–4). Null while unanswered. */
  trimManipulated?: number | null;
  /** inspection_photos id of the marked repair-zone (VAP1) photo. */
  vap1PhotoId?: string | null;
  /** inspection_photos id of the final annotated archive photo. */
  finalPhotoId?: string | null;
  /** Collateral-damage answers keyed by category. */
  damage: Partial<Record<VapDamageCategoryKey, VapDamageFinding>>;
}

export interface RepairabilitySystemFlow {
  // Roof flows only: which material's question flow was completed.
  roofMaterial?: RepairabilityRoofMaterial | null;
  // Asphalt-shingle roof flows only: the Repair Attempt Protocol record.
  // Absent on siding flows, non-asphalt roof flows, and pre-RAP records.
  rap?: RepairAttemptProtocol | null;
  // Set when RR-010 = catalog_match: the probable product match picked
  // from the company's Known Product Catalog.
  productMatch?: RepairabilityProductMatch | null;
  // Answers keyed by question id (e.g. 'RR-001', 'CS-032A', 'SM-042').
  // Radio answers are single value keys; multi-selects are arrays of value keys.
  answers: Record<string, string | string[]>;
  determination: RepairabilityDetermination;
  basisFactors: string[];
  nextStep: string;
  evidencePhotoIds?: string[];
  evidenceDocRefs?: string[];
  notes?: string | null;
}

export interface RepairabilityAssessment {
  version: 2;
  systems: Array<'roof' | 'siding'>;
  roof?: RepairabilitySystemFlow | null;
  siding?: RepairabilitySystemFlow | null;
  assessorName?: string | null; // server-populated
  assessorCredentials?: string | null; // server-populated
  recordedAtUtc: string;
}

// v3 (2026-07-28): Repair Attempt Protocol flow — the rebuilt Repairability
// screen. Gate question (warranted/authorized), assessed systems, roof type,
// and the RAP record at the top level. Partial protocol runs are savable so
// field answers are never lost; server validation enforces internal
// consistency only. Stored rows may be v1 (legacy free-text), v2 (question
// flow), or v3 — readers must tolerate all three shapes.
export type RepairabilityWarranted = 'yes' | 'not_warranted_discontinued' | 'not_authorized';

export interface RepairabilityAssessmentV3 {
  version: 3;
  warranted: RepairabilityWarranted;
  /** Empty unless warranted === 'yes'. */
  systems: Array<'roof' | 'siding'>;
  roofType?: 'asphalt_shingle' | null;
  /** Siding material — vinyl runs the VAP; aluminum routes to the Product
   * ID–supported non-repairability determination (no simulated repair). */
  sidingType?: 'vinyl' | 'aluminum' | null;
  /** Present when the asphalt-shingle roof protocol was run. */
  rap?: RepairAttemptProtocol | null;
  /** Present when the vinyl-siding protocol was run. */
  vap?: VinylAssessmentProtocol | null;
  assessorName?: string | null; // server-populated
  assessorCredentials?: string | null; // server-populated
  recordedAtUtc: string;
}

/** Any currently-writable stored shape (legacy v1 rows also still exist). */
export type StoredRepairabilityAssessment = RepairabilityAssessment | RepairabilityAssessmentV3;

// REPORT_DATA v2 — pre-existing / non-storm conditions the inspector
// explicitly EXCLUDES from the claim. A credibility asset, not a concession.
export interface ExistingCondition {
  location: string;
  note: string;
}

// REPORT_DATA v2 — temporary repairs & mitigation. Captured in Phase 1 (a
// tarp most often goes on at the first visit) and carried into Phase 2.
// `performed` must be explicitly true — never inferred.
export interface TemporaryRepairs {
  performed: boolean;
  tarpInvoiceRef?: string | null;
  description?: string | null;
  datePerformed?: string | null;
  materialsUsed?: string | null;
  crewAndEquipment?: string | null;
  beforeAfterPhotoIds?: string[];
  recordedAtUtc: string;
}

// REPORT_DATA v2 — property-protection plan for scaffold/specialized cases
// (NOT ordinary tarping). `specializedRequired` is an explicit flag the rep
// affirmatively sets; laborEstimate/rentalCost are office-side and never
// captured in the field.
export interface PropertyProtectionPlan {
  specializedRequired: boolean;
  featureProtected?: string | null; // pool_spa / solar_panels / skylights / hvac / satellite / specimen_landscaping / detached_structure / driveway_hardscape / septic_field
  whyOrdinaryTarpingInsufficient?: string | null; // required when specializedRequired
  proposedEquipment?: string | null;
  setupMethod?: string | null;
  photoIds?: string[];
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
  description?: string | null;
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
  // v2.1 — the three "damage found" flags captured on the Elevation Walk.
  // They drive which conditional protocol steps apply (roof group / siding /
  // collateral). Raw booleans; default false for every pre-v2.1 row.
  roofDamageFound: boolean('roof_damage_found').notNull().default(false),
  sidingDamageFound: boolean('siding_damage_found').notNull().default(false),
  // v2.2 — Water-resistive barrier question, asked ONCE at the inspection
  // level on the Siding Inspection step (shown when at least one siding facet
  // is marked damaged). Null until answered. Replaces the old per-facet
  // wrbPresent question (that column is retained for historical rows and
  // offline outbox replay compatibility, but the UI no longer asks it).
  sidingWrbPresent: boolean('siding_wrb_present'),
  collateralDamageFound: boolean('collateral_damage_found').notNull().default(false),
  // REPORT_DATA v2 — fourth damage-surface flag. An explicit claim-scope
  // decision ("interior is part of this claim"), never derived from the
  // presence of interior observations. Gates the Interior/Attic step.
  interiorDamageFound: boolean('interior_damage_found').notNull().default(false),
  // v2.1 — optional siding measurement report reference (the client id of the
  // uploaded report photo). Nullable; absence is a soft flag, never a block.
  sidingMeasurementReportRef: text('siding_measurement_report_ref'),
  measurementsReportUrl: text('measurements_report_url'),
  // Facet routing (two-stage EXTRACT → SEQUENCE flow). facetGraph holds the
  // full EXTRACT output; facetSequence the SEQUENCE output (optionally
  // manually adjusted). Re-analysis clears entryFacetId + facetSequence.
  facetGraph: jsonb('facet_graph').$type<unknown | null>(),
  facetGraphStatus: text('facet_graph_status').$type<'pending' | 'complete' | 'failed' | null>(),
  entryFacetId: text('entry_facet_id'),
  facetSequence: jsonb('facet_sequence').$type<unknown | null>(),
  sequenceGeneratedAt: timestamp('sequence_generated_at', { withTimezone: true }),
  // REPORT_DATA v2 capture blocks — all nullable; null means "not captured"
  // and the corresponding report section omits.
  propertyProfile: jsonb('property_profile').$type<PropertyProfile | null>(),
  repairabilityAssessment: jsonb('repairability_assessment').$type<StoredRepairabilityAssessment | null>(),
  existingOrUnrelatedConditions: jsonb('existing_or_unrelated_conditions').$type<
    ExistingCondition[] | null
  >(),
  temporaryRepairs: jsonb('temporary_repairs').$type<TemporaryRepairs | null>(),
  propertyProtectionPlan: jsonb('property_protection_plan').$type<PropertyProtectionPlan | null>(),
  // Audit trail for damage-surface flag REMOVALS during the forensic phase.
  // The flags are first set in Phase 1 and drive measurement-report ordering
  // between phases; if Phase 2 un-sets one, we record who/when/prior value
  // (server-side, append-only) instead of silently flipping it.
  damageSurfaceChangeLog: jsonb('damage_surface_change_log')
    .$type<
      Array<{
        surface: 'roof' | 'siding' | 'collateral' | 'interior';
        prior: boolean;
        next: boolean;
        changedByUserId: string;
        changedAt: string;
      }>
    >()
    .notNull()
    .default([]),
  // AI-generated summary written by Claude Sonnet at the Summary step.
  // Persisted here so it survives app restarts and is available for the report.
  // Null until the inspector triggers generation for the first time.
  // Advisory contractor estimate built at the Estimate step. Full-replace
  // jsonb document: waste %, the measured basis it was derived from, and
  // price-book line items with unit-price/total snapshots in integer cents
  // (snapshots survive later price-book edits). Null until a rep saves one;
  // never gates submit.
  estimate: jsonb('estimate').$type<InspectionEstimate | null>().default(null),
  aiSummary: jsonb('ai_summary')
    .$type<{
      forensicSummary: string;
      repairabilityText: string;
      generatedAt: string;
      // Contractor-lane content lint over the AI narrative (additive; present
      // from summaries generated after the lint gate shipped). Content is
      // never rewritten — findings only classify it for reviewer attention.
      lint?: ReportLintResult;
      // Set when the narrative was manually revised via PATCH (no AI
      // involvement). Absent on purely generated summaries.
      editedAt?: string;
      editedBy?: string;
    } | null>()
    .default(null),
  // Gemini-compiled HTML report stored in object storage. Written by the
  // report/compile route; null until the inspector triggers compilation.
  // Format: `/objects/uploads/{uuid}` — the same convention as uploadObjectBuffer.
  compiledReportPath: text('compiled_report_path'),
  compiledReportReadyAt: timestamp('compiled_report_ready_at', { withTimezone: true }),
  // Append-only history of compiled report versions. Each entry:
  // { path, generatedAt, evidenceManifestSha256 }. Appended via SQL `||`
  // (never read-modify-write) so concurrent compiles can't drop entries and
  // every prior package version stays retrievable with its manifest digest.
  compiledReportVersions: jsonb('compiled_report_versions').notNull().default([]),
  // Reviewer resolution of a `blocked` content-lint result on a compiled
  // report version. Keyed by the compiled blob path (version entries are
  // append-only, so resolution lives here rather than mutating history).
  // Null until a manager/admin explicitly resolves; a new compile with a
  // different path requires a fresh resolution.
  reportLintResolution: jsonb('report_lint_resolution')
    .$type<ReportLintResolution | null>()
    .default(null),
  // Append-only history of manager-authorized unlocks. Locking is one-way for
  // reps; a manager/admin may reopen a submitted record for editing, and every
  // reopen is recorded here (never removed) so a re-submitted package clearly
  // shows it was reopened. Appended via SQL `||`, never read-modify-write.
  unlockLog: jsonb('unlock_log').notNull().default([]).$type<InspectionUnlockEvent[]>(),
  // Public Evidence Portal share code — the sole capability for contractors
  // and adjusters to view this inspection's photos and Proof Package versions
  // without an account. Generated at first Proof Package compile; null until
  // then. FIPSA/agreement content is NEVER exposed through the portal.
  portalAccessCode: text('portal_access_code').unique(),
  // Set when a manager revokes portal access; a non-null value disables the
  // code without destroying it (audit trail preserved).
  portalAccessRevokedAt: timestamp('portal_access_revoked_at', { withTimezone: true }),
  // Homeowner contact email captured at scheduling time. Used for appointment
  // notifications and Phase 2 comms; carried forward to the owner record when
  // Phase 2 is completed so reps never have to re-enter it.
  ownerEmail: text('owner_email'),
  // Rep-chosen date for the Phase 2 (forensic) inspection, set in the
  // post-agreement scheduling flow. Null until the rep books a date.
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  // Stage 0: RAP gate reason — set when an inspector documents why the RAP
  // protocol does not apply to this claim. Gates downstream generation.
  // `not_warranted_discontinued` is only valid when product_id_class='identified'.
  rapGateReason: varchar('rap_gate_reason', {
    enum: ['not_warranted_discontinued', 'not_authorized'],
  }),
  // Deterministic trigger flags derived from the field record (Task #121).
  // Recomputed and stored when the field record is attested or any material
  // input changes. Never use the stored value for gating — always recompute.
  triggerFlags: jsonb('trigger_flags'),
  // Frozen exhibit-badge map built at first compile (Task #122).
  // Structure: { counters: { R, S, I, F, C, T }, assignments: { selectionId → badge } }
  // Subsequent recompiles read this frozen map — nothing ever renumbers.
  // New content at supplement time appends within class using counters[class]+1.
  exhibitBadgeMap: jsonb('exhibit_badge_map'),
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
  // Tie-in protocol: how this facet meets its neighbors. Multi-select — a
  // facet can carry both, either, or neither. The Brain uses these to
  // conditionally include the fixed tie-in exhibit.
  tieInValley: boolean('tie_in_valley').notNull().default(false),
  tieInHipRidge: boolean('tie_in_hip_ridge').notNull().default(false),
  notes: text('notes'),
  // AI-extracted bearing: 0–360° downhill-facing azimuth. Null when the vendor
  // report does not publish per-facet bearing data (EagleView "Azimuth", Hover
  // "Orientation", GAF "Bearing"). Used to display a cardinal direction to the
  // inspector on the roof so they can orient to the correct slope.
  compassBearing: doublePrecision('compass_bearing'),
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
  triadRole: varchar('triad_role', { enum: PHOTO_CAPTURE_ROLES }),
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
  // Component-zone tag: set only on shared zone photos (subjectType
  // 'component', no subjectId) so the Brain can group them. Null elsewhere.
  zone: varchar('zone', { enum: COMPONENT_ZONES }),
  // v2.1 — Siding-photo role tag: set only on subjectType 'siding_facet'
  // photos so the gate can tell the damage close-up, the facet shot, and the
  // per-component photos apart deterministically. Null elsewhere.
  sidingRole: varchar('siding_role', { enum: SIDING_PHOTO_ROLES }),
  // 1-based component slot (S{n}C{k}) this photo evidences. Set only when
  // sidingRole is 'component'; the gate matches it against the facet's
  // components array positionally. Null elsewhere.
  sidingComponentIndex: integer('siding_component_index'),
  // Pre-submission curation: when false, the photo is kept as captured
  // evidence but omitted from Proof Package generation (report body, AI
  // grouping brief, and evidence manifest). Defaults to included.
  includeInProofPackage: boolean('include_in_proof_package').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// v2.1 — A siding facet (S1, S2, …) documented during the Siding Inspection
// step. Raw facts only: label, whether the inspector observed damage (and
// its classification), whether a water-resistive barrier is present, and the
// facet's component list (S{n}C1…S{n}Ck) — each component carries its
// disposition and requires its own 'component'-role photo whose
// sidingComponentIndex matches. No area / pitch / material fields by design.
export const inspectionSidingFacetsTable = pgTable('inspection_siding_facets', {
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
  areaSqft: real('area_sqft'),
  damaged: boolean('damaged').notNull().default(false),
  damageType: varchar('damage_type', { enum: SIDING_DAMAGE_TYPES }),
  // Water-resistive barrier present? Null until the inspector answers; new
  // facets default from the first facet's answer client-side.
  wrbPresent: boolean('wrb_present'),
  // Is this an isolated siding facet? Null until the inspector answers.
  isolated: boolean('isolated'),
  // Positional component list: components[k-1] is S{n}C{k}. Each entry holds
  // its disposition (`action`: 'detach_reset' | 'remove_replace' | null).
  components: jsonb('components')
    .$type<Array<{ action: 'detach_reset' | 'remove_replace' | null }>>()
    .notNull()
    .default([]),
  notes: text('notes'),
  // Pre-existing or excluded conditions on this facet — anything not being
  // claimed, documented to make the rest of the claim credible.
  preExistingConditions: jsonb('pre_existing_conditions')
    .$type<Array<{ note: string }>>()
    .default([]),
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
  // Product determination fields added in Task #121. Null until desk-verified.
  // `discontinued`: whether the product is still manufactured.
  discontinued: varchar('discontinued', {
    enum: ['still_manufactured', 'discontinued', 'not_verified'],
  }),
  // `ordinaryAvailability`: whether the product can be reasonably sourced.
  ordinaryAvailability: varchar('ordinary_availability', {
    enum: ['available', 'not_reasonably_available', 'not_assessed'],
  }),
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

// Signed agreement metadata. One row per inspection — immutable after insert.
// The PDF is stored in object storage; `documentObjectPath` is the
// `/objects/...` path served by GET /storage/objects/*path.
export interface AgreementAuditMetadata {
  /** userId of the rep who performed the signing. */
  inspectorUserId: string;
  /** App version string from the request (if provided). */
  appVersion?: string | null;
  /** User-agent of the signing device. */
  userAgent?: string | null;
}

export const signedAgreementsTable = pgTable('signed_agreements', {
  id: varchar('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  inspectionId: varchar('inspection_id')
    .notNull()
    // NOTE: uniqueness is enforced via a partial index on the DB (see
    // data-migrations/004_signed_agreements_partial_unique.sql) so that voided
    // rows do not block a replacement signing. The full unique constraint was
    // dropped when void support was added.
    .references(() => inspectionsTable.id, { onDelete: 'restrict' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  signerName: text('signer_name').notNull(),
  /** Semver string identifying the agreement template version used. */
  documentVersion: varchar('document_version', { length: 20 }).notNull(),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  auditMetadata: jsonb('audit_metadata')
    .notNull()
    .$type<AgreementAuditMetadata>(),
  /** `/objects/uploads/{uuid}` — the signed PDF in private object storage. */
  documentObjectPath: text('document_object_path').notNull(),
  // ── Void support (super_admin only) ────────────────────────────────────────
  // A voided agreement is soft-deleted in place. A new signing is allowed on
  // the same inspection once the prior agreement is voided (the partial unique
  // index excludes voided rows, so only one *active* agreement can exist per
  // inspection). All three columns are set atomically when voiding.
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedByUserId: varchar('voided_by_user_id').references(() => usersTable.id),
  voidReason: text('void_reason'),
  /** Set when the server successfully emailed the signed PDF to the homeowner. */
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
});

export type SignedAgreement = typeof signedAgreementsTable.$inferSelect;

// ── Exhibit Curation (Photo Curation & Captioning) ─────────────────────────

export const EXHIBIT_CLASSES = ['R', 'S', 'I', 'F', 'C', 'T'] as const;
export type ExhibitClass = (typeof EXHIBIT_CLASSES)[number];
// R = Roof, S = Storm/collateral, I = Interior, F = Field measurement,
// C = Collateral/general, T = Test square

/**
 * One row per photo selected as a package exhibit for an inspection.
 * `finalizedAt` is set when the badge map is frozen; before that, selections
 * can be freely added/removed. After finalization the badgeLabel is immutable.
 */
export const exhibitSelectionsTable = pgTable('inspection_exhibit_selections', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  photoId: varchar('photo_id')
    .notNull()
    .references(() => inspectionPhotosTable.id, { onDelete: 'cascade' }),
  exhibitClass: varchar('exhibit_class', { enum: EXHIBIT_CLASSES }),
  /** Assigned at finalization, e.g. "R-3". Null until badges are frozen. */
  badgeLabel: varchar('badge_label'),
  sortOrder: integer('sort_order').notNull().default(0),
  isAiProposed: boolean('is_ai_proposed').notNull().default(false),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const COMPARISON_PAIR_TYPES = [
  'pre_post_loss',
  'condition_differentiation',
  'directional_comparison',
] as const;
export type ComparisonPairType = (typeof COMPARISON_PAIR_TYPES)[number];

/**
 * A confirmed comparison pair: two photos displayed stacked vertically in the
 * package and confirmed by a human reviewer. Hard gate — cannot be inferred.
 */
export const comparisonPairsTable = pgTable('inspection_comparison_pairs', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  beforePhotoId: varchar('before_photo_id')
    .notNull()
    .references(() => inspectionPhotosTable.id),
  afterPhotoId: varchar('after_photo_id')
    .notNull()
    .references(() => inspectionPhotosTable.id),
  pairType: varchar('pair_type', { enum: COMPARISON_PAIR_TYPES }).notNull(),
  confirmedBy: varchar('confirmed_by').references(() => usersTable.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only audit trail for claim-level workflow events. */
export const CLAIM_EVENT_TYPES = [
  'inspection_synced',
  'attested',
  'generation_started',
  'section_generated',
  'section_approved',
  'section_locked',
  'compiled',
  'report_attested',
  'delivered',
  'supplemented',
  'exhibit_selected',
  'exhibit_deselected',
  'exhibit_class_set',
  'comparison_pair_confirmed',
  'comparison_pair_removed',
  'exhibit_badges_finalized',
  'captions_generated',
] as const;
export type ClaimEventType = (typeof CLAIM_EVENT_TYPES)[number];

export const claimEventsTable = pgTable('claim_events', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  eventType: varchar('event_type', { enum: CLAIM_EVENT_TYPES }).notNull(),
  payload: jsonb('payload'),
  actorId: varchar('actor_id').references(() => usersTable.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const CAPTION_STATES = ['pending', 'generated', 'in_review', 'approved', 'locked'] as const;
export type CaptionState = (typeof CAPTION_STATES)[number];

/**
 * One caption row per exhibit slot. Generated by AI from the photo's metadata
 * and the caption_patterns library, then reviewed and locked by a human.
 * Will migrate to the claim_sections table when Task #121 lands.
 */
export const exhibitCaptionsTable = pgTable('exhibit_captions', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  exhibitSelectionId: varchar('exhibit_selection_id')
    .notNull()
    .references(() => exhibitSelectionsTable.id, { onDelete: 'cascade' }),
  badgeLabel: varchar('badge_label').notNull(),
  captionText: text('caption_text'),
  state: varchar('state', { enum: CAPTION_STATES }).notNull().default('pending'),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: varchar('locked_by').references(() => usersTable.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// =============================================================================
// BOILERPLATE LIBRARY (Task #121)
// =============================================================================

// Valid section keys for the per-tenant boilerplate library.
export const BOILERPLATE_SECTION_KEYS = [
  'opening_statement',
  'inspection_method',
  'caption_patterns',
  'rap_field_protocol',
  'attestation_block_a',
  'attestation_block_b',
  'attestation_block_c',
  'uniform_inspection_procedure',
  'product_id_methodology',
  'scope_block',
  'std_rpr_01_source_record',
] as const;
export type BoilerplateSectionKey = (typeof BOILERPLATE_SECTION_KEYS)[number];

/**
 * Per-tenant versioned boilerplate library. A new row is created for every
 * save — never mutate an existing version row. The latest active version is
 * the highest version per (companyId, sectionKey).
 */
export const boilerplateSectionsTable = pgTable('boilerplate_sections', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  sectionKey: varchar('section_key', { enum: BOILERPLATE_SECTION_KEYS }).notNull(),
  content: text('content').notNull().default(''),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
});

export const STANDARDS_VERIFICATION_STATUSES = ['verified', 'verify_before_ship'] as const;
export type StandardsVerificationStatus = (typeof STANDARDS_VERIFICATION_STATUSES)[number];

/**
 * Structured Standards Citation Library — individual entries queryable by key.
 * `verify_before_ship` entries block compile until verifiedAt is set.
 * IICRC S500/S520 entries are always `verify_before_ship`.
 */
export const standardsEntriesTable = pgTable('standards_entries', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  entryKey: varchar('entry_key').notNull(), // e.g. 'ASTM-D3161'
  sourceType: varchar('source_type'), // e.g. 'ASTM', 'IRC', 'IBC', 'IICRC'
  citationText: text('citation_text'),
  verificationStatus: varchar('verification_status', {
    enum: STANDARDS_VERIFICATION_STATUSES,
  })
    .notNull()
    .default('verify_before_ship'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  authorityLimit: text('authority_limit'),
  locatorTemplate: text('locator_template'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
});

/**
 * Structured Detriment Library with machine-readable Applicability gates.
 * Generation workers filter to entries whose applicabilityConditions are all
 * present in the attested field record before building the prompt.
 */
export const detrimentEntriesTable = pgTable('detriment_entries', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  entryKey: varchar('entry_key').notNull(), // e.g. 'DET-AS-01'
  // Array of condition codes (e.g. ['hail_damage', 'deck_exposed']) — ALL must
  // be present in the attested field record for this entry to apply.
  applicabilityConditions: jsonb('applicability_conditions').notNull().default([]),
  statement: text('statement').notNull().default(''),
  requiredSupport: text('required_support'),
  limitation: text('limitation'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
});

export const AHJ_PACK_TYPES = ['ahj_roof', 'ahj_siding'] as const;
export type AhjPackType = (typeof AHJ_PACK_TYPES)[number];

/**
 * Per-tenant jurisdiction packs (AHJ-Roof, AHJ-Siding). Items are a jsonb
 * array of { key, citationText, edition, trigger?, active }.
 */
export const ahjPacksTable = pgTable('ahj_packs', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  packType: varchar('pack_type', { enum: AHJ_PACK_TYPES }).notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  items: jsonb('items').notNull().default([]),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
});

// =============================================================================
// CLAIM SECTIONS (Task #121 — full lifecycle in Task #122)
// =============================================================================

export const CLAIM_SECTION_TYPES = [
  'findings',
  'causation',
  'detriment_application',
  'rap_narrative',
  'estimate_justifications',
  'summary_of_findings',
  'closing_statement',
  'captions',
] as const;
export type ClaimSectionType = (typeof CLAIM_SECTION_TYPES)[number];

export const CLAIM_SECTION_STATES = [
  'not_started',
  'generating',
  'generated',
  'in_review',
  'approved',
  'locked',
] as const;
export type ClaimSectionState = (typeof CLAIM_SECTION_STATES)[number];

/**
 * Per-inspection section lifecycle. One row per (inspectionId, sectionType).
 * Replaced by real content when the AI generation pipeline runs (Task #122).
 * `libraryVersionSnapshot` records the BP/AHJ/standards versions used at
 * generation time so the claim remains auditable after library updates.
 */
export const claimSectionsTable = pgTable('claim_sections', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  inspectionId: varchar('inspection_id')
    .notNull()
    .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
  companyId: varchar('company_id')
    .notNull()
    .references(() => companiesTable.id),
  sectionType: varchar('section_type', { enum: CLAIM_SECTION_TYPES }).notNull(),
  state: varchar('state', { enum: CLAIM_SECTION_STATES }).notNull().default('not_started'),
  contentHtml: text('content_html'),
  lintStatus: varchar('lint_status'),
  lintFindings: jsonb('lint_findings'),
  // Stores reviewer confirmations and resolved gate booleans (e.g. causation
  // reviewer checkbox, RAP slope mode, comparison-pass confirmation).
  gateFlags: jsonb('gate_flags'),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: varchar('locked_by').references(() => usersTable.id, { onDelete: 'set null' }),
  // Snapshot of library versions used at generation time — BP section versions,
  // AHJ pack versions, and the set of standardsEntryKeys referenced.
  libraryVersionSnapshot: jsonb('library_version_snapshot'),
  // Set when a re-generate of an upstream section stales this section. Cleared
  // when the section is re-generated. Format: the sectionType that caused staleness.
  staledBy: varchar('staled_by', { length: 100 }),
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
export type InspectionSidingFacet = typeof inspectionSidingFacetsTable.$inferSelect;
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
export type ExhibitSelection = typeof exhibitSelectionsTable.$inferSelect;
export type ComparisonPair = typeof comparisonPairsTable.$inferSelect;
export type ClaimEvent = typeof claimEventsTable.$inferSelect;
export type ExhibitCaption = typeof exhibitCaptionsTable.$inferSelect;
export type BoilerplateSection = typeof boilerplateSectionsTable.$inferSelect;
export type StandardsEntry = typeof standardsEntriesTable.$inferSelect;
export type DetrimentEntry = typeof detrimentEntriesTable.$inferSelect;
export type AhjPack = typeof ahjPacksTable.$inferSelect;
export type ClaimSection = typeof claimSectionsTable.$inferSelect;

// ---------------------------------------------------------------------------
// REPORT ATTESTATIONS (Task #126)
// ---------------------------------------------------------------------------
// Records a named preparer's Variant B sign-off on a compiled proof package.
// One row per compiled blob version (enforced by unique constraint on
// inspectionId + blobVersionIndex). The blobVersionIndex is the 0-based
// position in the inspection's compiledReportVersions jsonb array.

export const reportAttestationsTable = pgTable(
  'report_attestations',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    inspectionId: varchar('inspection_id')
      .notNull()
      .references(() => inspectionsTable.id, { onDelete: 'cascade' }),
    companyId: varchar('company_id')
      .notNull()
      .references(() => companiesTable.id),
    /** The user who submitted the attestation (may differ from inspectorUserId). */
    preparerId: varchar('preparer_id')
      .notNull()
      .references(() => usersTable.id),
    preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),
    /** 0-based index into the inspection's compiledReportVersions jsonb array. */
    blobVersionIndex: integer('blob_version_index').notNull(),
    /** SHA-256 hex digest of statementText at the moment of signing. */
    statementHash: varchar('statement_hash', { length: 64 }).notNull(),
    /** Full statement text shown to the preparer at signing — the hash proves it. */
    statementText: text('statement_text').notNull(),
    /**
     * attestation_block_a → preparer and inspector are the same person.
     * attestation_block_b → preparer and inspector are different people.
     */
    attestationBlockKey: varchar('attestation_block_key', {
      enum: ['attestation_block_a', 'attestation_block_b'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Prevent double-attestation of the same blob version on the same claim.
    uniqueIndex('report_attestations_inspection_version_idx').on(t.inspectionId, t.blobVersionIndex),
  ],
);

export type ReportAttestation = typeof reportAttestationsTable.$inferSelect;
export type NewReportAttestation = typeof reportAttestationsTable.$inferInsert;

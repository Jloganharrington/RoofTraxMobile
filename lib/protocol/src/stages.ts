// Forensic Protocol v2.1 — the physically-ordered steps of a forensic
// inspection. These keys mirror (by id only — no runtime dependency) the
// CAPTURE_STAGES values stored on `inspection_photos`/`attestations` rows in
// @workspace/db. This package owns the *meaning* of each step and the rules
// for progressing through them; the DB just persists which step a given
// record belongs to. S-numbers are retired, and (v2.1) so are user-facing
// "Step N" prefixes — steps are named only.
export const STAGES = [
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
  'submit',
] as const;
export type Stage = (typeof STAGES)[number];

// Alias — the v2 vocabulary calls these "steps"; `Stage` is kept as the
// primary exported name so Deficiency/SoftFlag consumers don't churn.
export type StepKey = Stage;

// The "damage found" flags captured on the Elevation Walk (v2.1 had three;
// REPORT_DATA v2 adds interior as an explicit fourth claim-scope decision).
// They drive which conditional steps apply (are shown + gated) for this
// inspection. Raw booleans stored on the inspection row.
export interface DamageFlags {
  roofDamageFound: boolean;
  sidingDamageFound: boolean;
  collateralDamageFound: boolean;
  interiorDamageFound: boolean;
}

export interface ProtocolStep {
  key: Stage;
  order: number;
  name: string;
  description: string;
  /** v2.1 conditional steps: present only when the predicate passes. Steps
   * without a predicate always apply. */
  appliesWhen?: (flags: DamageFlags) => boolean;
}

const whenRoof = (flags: DamageFlags) => flags.roofDamageFound;
const whenSiding = (flags: DamageFlags) => flags.sidingDamageFound;
const whenCollateral = (flags: DamageFlags) => flags.collateralDamageFound;
const whenInterior = (flags: DamageFlags) => flags.interiorDamageFound;
const whenRoofOrSiding = (flags: DamageFlags) => flags.roofDamageFound || flags.sidingDamageFound;

// THE ordered source of truth for the step flow. Imported by the step
// hub, the gate engine, and the server — no hard-coded step strings
// scattered across screens.
export const PROTOCOL_STEPS: readonly ProtocolStep[] = [
  {
    key: 'arrival',
    order: 1,
    name: 'Arrival Log',
    description: 'On-site conditions (sky, wind, temp), personnel present, GPS + time.',
  },
  {
    key: 'property_profile',
    order: 2,
    name: 'Property Profile',
    description:
      'Property & construction description — type, stories, roof age with basis, deck type. Prefilled from the lead where available.',
  },
  {
    key: 'elevation_access',
    order: 3,
    name: 'Elevation Walk',
    description:
      'A wide photo of each of the four elevations, plus the three damage-found flags.',
  },
  {
    key: 'facets',
    order: 4,
    name: 'Roof Facets & Measurements',
    description:
      'Every roof facet with area, material, pitch and damage documentation, plus whole-roof linears.',
    appliesWhen: whenRoof,
  },
  {
    key: 'test_squares',
    order: 5,
    name: 'Test Squares',
    description: 'A test-square photo on every facet that carries hail damage.',
    appliesWhen: whenRoof,
  },
  {
    key: 'components',
    order: 6,
    name: 'Roof Components & Penetrations',
    description: 'Existing components and roof penetrations, each with a photo.',
    appliesWhen: whenRoof,
  },
  {
    key: 'product',
    order: 7,
    name: 'Roofing Product ID',
    description: 'At least one roofing-product identification record.',
    appliesWhen: whenRoof,
  },
  {
    key: 'siding',
    order: 8,
    name: 'Siding Inspection',
    description:
      'Siding facets S1…S{n}: damage classification, facet photo, and per-component photos.',
    appliesWhen: whenSiding,
  },
  {
    key: 'collateral',
    order: 9,
    name: 'Collateral Sweep',
    description: 'Labeled collateral photos, roof-level then ground-level.',
    appliesWhen: whenCollateral,
  },
  {
    key: 'interior',
    order: 10,
    name: 'Interior / Attic',
    description: 'Interior/attic evidence, or an explicit no-interior-claim waiver.',
    appliesWhen: whenInterior,
  },
  {
    key: 'repairability',
    order: 11,
    name: 'Repairability Assessment',
    description:
      'Explicit repair-vs-replace field determination — never defaulted. Skipping leaves the record null and the report section omits.',
    appliesWhen: whenRoofOrSiding,
  },
  {
    key: 'mitigation',
    order: 12,
    name: 'Temporary Repairs & Mitigation',
    description:
      'Emergency tarping / mitigation performed, with before & after photos. Carried forward from Phase 1.',
  },
  {
    key: 'homeowner',
    order: 13,
    name: 'Homeowner',
    description: 'Factual homeowner intake (prior repairs, prior claims).',
  },
  {
    key: 'existing_conditions',
    order: 14,
    name: 'Existing / Unrelated Conditions',
    description:
      'Pre-existing or non-storm conditions explicitly excluded from the claim — documenting what is NOT storm damage is what makes the rest credible.',
  },
  {
    key: 'declaration',
    order: 15,
    name: 'Declaration',
    description: 'The inspector signs off on the completeness of the capture.',
  },
  {
    key: 'submit',
    order: 16,
    name: 'Readiness & Submit',
    description: 'Zero hard deficiencies remain and the package is confirmed ready.',
  },
] as const;

const STEP_BY_KEY = new Map(PROTOCOL_STEPS.map((step) => [step.key, step]));

export function protocolStep(key: Stage): ProtocolStep {
  const step = STEP_BY_KEY.get(key);
  if (!step) throw new Error(`Unknown protocol step: ${key}`);
  return step;
}

/** True when the given step applies for this inspection's damage flags. Used
 * by the hub (visibility) and the gate engine (which steps to gate) — the two
 * must never disagree, so both call exactly this. */
export function stepApplies(key: Stage, flags: DamageFlags): boolean {
  const step = protocolStep(key);
  return step.appliesWhen ? step.appliesWhen(flags) : true;
}

/** The ordered steps that apply for this inspection's damage flags. */
export function applicableSteps(flags: DamageFlags): ProtocolStep[] {
  return PROTOCOL_STEPS.filter((step) => stepApplies(step.key, flags));
}

/** User-facing label. v2.1: the step's name only — "Step N" prefixes are
 * retired (conditional steps make fixed numbering meaningless). */
export function stepLabel(key: Stage): string {
  return protocolStep(key).name;
}

// Back-compat shaped lookup (name + description keyed by step key).
export const STAGE_DEFINITIONS: Record<Stage, { name: string; description: string }> =
  Object.fromEntries(
    PROTOCOL_STEPS.map((step) => [step.key, { name: step.name, description: step.description }]),
  ) as Record<Stage, { name: string; description: string }>;

export const ELEVATION_DIRECTIONS = ['front', 'right', 'back', 'left'] as const;
export type ElevationDirection = (typeof ELEVATION_DIRECTIONS)[number];

// Facet damage classification (mirrors FACET_DAMAGE_TYPES in @workspace/db).
export const FACET_DAMAGE_TYPES = ['hail', 'wind', 'hail_and_wind', 'none'] as const;
export type FacetDamageType = (typeof FACET_DAMAGE_TYPES)[number];

// Siding facet damage classification (v2.1 — mirrors SIDING_DAMAGE_TYPES in
// @workspace/db). Distinct vocabulary from roof facets: siding claims
// classify wind / hail / tree impact.
export const SIDING_DAMAGE_TYPES = ['wind', 'hail', 'tree'] as const;
export type SidingDamageType = (typeof SIDING_DAMAGE_TYPES)[number];

// Which role a siding-facet photo plays (mirrors SIDING_PHOTO_ROLES in
// @workspace/db): the damage close-up, the whole-facet shot, or one
// component's photo. Deterministic gate discrimination — never inferred from
// caption strings.
export const SIDING_PHOTO_ROLES = ['damage', 'facet', 'component'] as const;
export type SidingPhotoRole = (typeof SIDING_PHOTO_ROLES)[number];

// Disposition for each documented siding component (S1C1, S1C2, …): whether
// the component can be detached and reset, or must be removed and replaced.
// Every component requires a selection plus its own photo.
export const SIDING_COMPONENT_ACTIONS = ['detach_reset', 'remove_replace'] as const;
export type SidingComponentAction = (typeof SIDING_COMPONENT_ACTIONS)[number];

/** True when a facet's damage classification requires a Step-4 test square. */
export function carriesHail(damageType: FacetDamageType | null | undefined): boolean {
  return damageType === 'hail' || damageType === 'hail_and_wind';
}

// Whole-roof linear measurement types, stored in `measurements` with
// slopeId = null.
export const WHOLE_ROOF_LINEAR_TYPES = [
  'ridge_lf',
  'hip_lf',
  'valley_lf',
  'eave_lf',
  'rake_lf',
] as const;
export type WholeRoofLinearType = (typeof WHOLE_ROOF_LINEAR_TYPES)[number];

// Forensic Protocol v2 — the 11 physically-ordered steps of a forensic
// inspection. These keys mirror (by id only — no runtime dependency) the
// CAPTURE_STAGES values stored on `inspection_photos`/`attestations` rows in
// @workspace/db. This package owns the *meaning* of each step and the rules
// for progressing through them; the DB just persists which step a given
// record belongs to. S-numbers are retired.
export const STAGES = [
  'arrival',
  'elevation_access',
  'facets',
  'test_squares',
  'components',
  'product',
  'collateral',
  'interior',
  'homeowner',
  'declaration',
  'submit',
] as const;
export type Stage = (typeof STAGES)[number];

// Alias — the v2 vocabulary calls these "steps"; `Stage` is kept as the
// primary exported name so Deficiency/SoftFlag consumers don't churn.
export type StepKey = Stage;

export interface ProtocolStep {
  key: Stage;
  order: number;
  name: string;
  description: string;
}

// THE ordered source of truth for the 11-step flow. Imported by the step
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
    key: 'elevation_access',
    order: 2,
    name: 'Elevation Walk & Access',
    description: 'A wide photo of each of the four elevations plus the roof-access photo.',
  },
  {
    key: 'facets',
    order: 3,
    name: 'Facets & Measurements',
    description:
      'Every roof facet with area, material, pitch and damage documentation, plus whole-roof linears.',
  },
  {
    key: 'test_squares',
    order: 4,
    name: 'Test Squares',
    description: 'A test-square photo on every facet that carries hail damage.',
  },
  {
    key: 'components',
    order: 5,
    name: 'Components & Penetrations',
    description: 'Existing components and roof penetrations, each with a photo.',
  },
  {
    key: 'product',
    order: 6,
    name: 'Product ID',
    description: 'At least one roofing-product identification record.',
  },
  {
    key: 'collateral',
    order: 7,
    name: 'Collateral Sweep',
    description: 'Optional labeled collateral photos, roof-level then ground-level.',
  },
  {
    key: 'interior',
    order: 8,
    name: 'Interior / Attic',
    description: 'Interior/attic evidence, or an explicit no-interior-claim waiver.',
  },
  {
    key: 'homeowner',
    order: 9,
    name: 'Homeowner',
    description: 'Factual homeowner intake (prior repairs, prior claims).',
  },
  {
    key: 'declaration',
    order: 10,
    name: 'Declaration',
    description: 'The inspector signs off on the completeness of the capture.',
  },
  {
    key: 'submit',
    order: 11,
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

/** User-facing label, e.g. `Step 3 · Facets & Measurements`. */
export function stepLabel(key: Stage): string {
  const step = protocolStep(key);
  return `Step ${step.order} · ${step.name}`;
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

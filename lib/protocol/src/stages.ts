// The forensic inspection capture protocol's ten stages. These mirror
// (by id only — no runtime dependency) the CAPTURE_STAGES values stored on
// `inspection_photos`/`attestations` rows in @workspace/db. This package
// owns the *meaning* of each stage and the rules for progressing through
// them; the DB just persists which stage a given record belongs to.
export const STAGES = [
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
export type Stage = (typeof STAGES)[number];

export const STAGE_DEFINITIONS: Record<Stage, { name: string; description: string }> = {
  S0: {
    name: 'Pre-Inspection Overview',
    description: 'A single wide context photo establishing the property being inspected.',
  },
  S1: {
    name: 'Elevations',
    description: 'A wide photo of each of the four building elevations (front/right/back/left).',
  },
  S2: {
    name: 'Roof Access & Safety',
    description: 'Documentation that the roof was safely accessed.',
  },
  S3: {
    name: 'Slope Documentation',
    description: 'Every roof slope/facet is identified and photographed.',
  },
  S4: {
    name: 'Test Squares',
    description: 'At least one test square is marked and its hits recorded.',
  },
  S5: {
    name: 'Damage Documentation',
    description: 'Every recorded damage instance has a complete wide/mid/close photo triad.',
  },
  S6: {
    name: 'Interior / Ancillary',
    description: 'Interior damage evidence, when reported, is photographed.',
  },
  S7: {
    name: 'Measurements',
    description: 'Raw measurements are recorded for the documented slopes.',
  },
  S8: {
    name: 'Attestation',
    description: 'The inspector signs off on the completeness of the capture.',
  },
  S9: {
    name: 'Final Review / Package',
    description: 'The inspector explicitly confirms the inspection package is ready.',
  },
};

export const ELEVATION_DIRECTIONS = ['front', 'right', 'back', 'left'] as const;
export type ElevationDirection = (typeof ELEVATION_DIRECTIONS)[number];

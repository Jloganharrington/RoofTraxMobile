import { ELEVATION_DIRECTIONS } from './stages';
import type { Deficiency, EvaluationResult, InspectionProtocolState, SoftFlag } from './types';

function deficiency(stage: Deficiency['stage'], code: string, message: string): Deficiency {
  return { stage, code, message };
}

function softFlag(stage: SoftFlag['stage'], code: string, message: string): SoftFlag {
  return { stage, code, message };
}

// Hard gates: each returns the deficiencies for exactly one stage. Kept as
// small, independent functions (rather than one big switch) so a fixture
// with exactly one thing missing produces exactly one deficiency.
function checkS0(state: InspectionProtocolState): Deficiency[] {
  if (!state.overviewPhotoCaptured) {
    return [deficiency('S0', 'MISSING_OVERVIEW_PHOTO', 'Property overview photo not captured.')];
  }
  return [];
}

function checkS1(state: InspectionProtocolState): Deficiency[] {
  return ELEVATION_DIRECTIONS.filter(
    (direction) => !state.elevations[direction]?.widePhotoCaptured,
  ).map((direction) =>
    deficiency(
      'S1',
      `MISSING_ELEVATION_PHOTO_${direction.toUpperCase()}`,
      `Wide photo missing for the ${direction} elevation.`,
    ),
  );
}

function checkS2(state: InspectionProtocolState): Deficiency[] {
  if (!state.roofAccessPhotoCaptured) {
    return [deficiency('S2', 'MISSING_ROOF_ACCESS_PHOTO', 'Roof access photo not captured.')];
  }
  return [];
}

function checkS3(state: InspectionProtocolState): Deficiency[] {
  if (state.slopes.length === 0) {
    return [deficiency('S3', 'NO_SLOPES_CAPTURED', 'No roof slopes have been documented.')];
  }
  return state.slopes
    .filter((slope) => !slope.widePhotoCaptured)
    .map((slope) =>
      deficiency(
        'S3',
        `MISSING_SLOPE_PHOTO_${slope.id}`,
        `Wide photo missing for slope ${slope.id}.`,
      ),
    );
}

function checkS4(state: InspectionProtocolState): Deficiency[] {
  if (state.testSquares.length === 0) {
    return [deficiency('S4', 'NO_TEST_SQUARES_CAPTURED', 'No test squares have been recorded.')];
  }
  return [];
}

function checkS5(state: InspectionProtocolState): Deficiency[] {
  return state.damageInstances
    .filter(
      (instance) =>
        !instance.widePhotoCaptured || !instance.midPhotoCaptured || !instance.closePhotoCaptured,
    )
    .map((instance) =>
      deficiency(
        'S5',
        `INCOMPLETE_DAMAGE_TRIAD_${instance.id}`,
        `Damage instance ${instance.id} is missing wide/mid/close photos.`,
      ),
    );
}

function checkS7(state: InspectionProtocolState): Deficiency[] {
  if (state.measurements.length === 0) {
    return [deficiency('S7', 'NO_MEASUREMENTS_RECORDED', 'No measurements have been recorded.')];
  }
  return [];
}

function checkS8(state: InspectionProtocolState): Deficiency[] {
  if (!state.attestationRecorded) {
    return [deficiency('S8', 'MISSING_ATTESTATION', 'Inspector attestation not recorded.')];
  }
  return [];
}

function checkS9(state: InspectionProtocolState): Deficiency[] {
  if (!state.finalReviewConfirmed) {
    return [
      deficiency('S9', 'FINAL_REVIEW_NOT_CONFIRMED', 'Final review has not been confirmed.'),
    ];
  }
  return [];
}

const HARD_GATE_CHECKS = [
  checkS0,
  checkS1,
  checkS2,
  checkS3,
  checkS4,
  checkS5,
  checkS7,
  checkS8,
  checkS9,
];

// Soft flags: non-blocking observations. S6 (Interior/Ancillary) has no
// hard requirement of its own — it is purely a soft-flag stage, since not
// every inspection has interior damage to document.
function checkInteriorLeakWithoutPhoto(state: InspectionProtocolState): SoftFlag[] {
  if (state.observedIndicators.includes('interior_leak_reported') && !state.interiorPhotoCaptured) {
    return [
      softFlag(
        'S6',
        'INTERIOR_LEAK_REPORTED_WITHOUT_PHOTO',
        'Interior leak was reported but no interior photo was captured.',
      ),
    ];
  }
  return [];
}

function checkZeroHitTestSquares(state: InspectionProtocolState): SoftFlag[] {
  return state.testSquares
    .filter((square) => square.hitCount === 0)
    .map((square) =>
      softFlag(
        'S4',
        `TEST_SQUARE_ZERO_HITS_${square.id}`,
        `Test square ${square.id} recorded zero hits — confirm this was intentional.`,
      ),
    );
}

function checkUnidentifiedProducts(state: InspectionProtocolState): SoftFlag[] {
  return state.productIdentifications
    .filter((product) => product.unidentifiable)
    .map((product) =>
      softFlag(
        'S4',
        `PRODUCT_UNIDENTIFIED_${product.id}`,
        `Roofing product ${product.id} could not be identified in the field — confirm a sample was bagged or the attestation was filed.`,
      ),
    );
}

const SOFT_FLAG_CHECKS = [
  checkInteriorLeakWithoutPhoto,
  checkZeroHitTestSquares,
  checkUnidentifiedProducts,
];

// Single entry point: given the raw capture state of an inspection, returns
// every hard-gate deficiency (blocking) and soft flag (non-blocking).
export function evaluate(state: InspectionProtocolState): EvaluationResult {
  return {
    deficiencies: HARD_GATE_CHECKS.flatMap((check) => check(state)),
    softFlags: SOFT_FLAG_CHECKS.flatMap((check) => check(state)),
  };
}

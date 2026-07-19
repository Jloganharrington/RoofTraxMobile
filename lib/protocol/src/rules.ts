import { ELEVATION_DIRECTIONS, carriesHail, stepApplies } from './stages';
import type { Stage } from './stages';
import type {
  ComponentZone,
  Deficiency,
  EvaluationResult,
  InspectionProtocolState,
  SoftFlag,
} from './types';

function deficiency(stage: Deficiency['stage'], code: string, message: string): Deficiency {
  return { stage, code, message };
}

function softFlag(stage: SoftFlag['stage'], code: string, message: string): SoftFlag {
  return { stage, code, message };
}

// Hard gates: each returns the deficiencies for exactly one step. Kept as
// small, independent functions (rather than one big switch) so a fixture
// with exactly one thing missing produces exactly one deficiency.

// Step 1 — conditions logged (sky, wind, temp), personnel recorded,
// GPS + time present.
function checkArrival(state: InspectionProtocolState): Deficiency[] {
  const out: Deficiency[] = [];
  const { arrival } = state;
  if (!arrival.skyLogged) {
    out.push(deficiency('arrival', 'MISSING_ARRIVAL_SKY', 'Sky condition not logged.'));
  }
  if (!arrival.windLogged) {
    out.push(deficiency('arrival', 'MISSING_ARRIVAL_WIND', 'Wind condition not logged.'));
  }
  if (!arrival.tempLogged) {
    out.push(deficiency('arrival', 'MISSING_ARRIVAL_TEMP', 'Temperature not logged.'));
  }
  if (!arrival.personnelRecorded) {
    out.push(
      deficiency('arrival', 'MISSING_ARRIVAL_PERSONNEL', 'Personnel present not recorded.'),
    );
  }
  if (!arrival.gpsPresent) {
    out.push(deficiency('arrival', 'MISSING_ARRIVAL_GPS', 'Arrival GPS position not captured.'));
  }
  if (!arrival.timePresent) {
    out.push(deficiency('arrival', 'MISSING_ARRIVAL_TIME', 'Arrival time not captured.'));
  }
  return out;
}

// Step 2 — 4 elevations each photographed. (v2.1: the roof-access photo is
// retired; the damage-found flags captured here are gated on submit via
// NO_DAMAGE_SURFACE_SELECTED, not here, so an untouched walk-through doesn't
// scream before the inspector has walked.)
function checkElevationAccess(state: InspectionProtocolState): Deficiency[] {
  return ELEVATION_DIRECTIONS.filter(
    (direction) => !state.elevations[direction]?.widePhotoCaptured,
  ).map((direction) =>
    deficiency(
      'elevation_access',
      `MISSING_ELEVATION_PHOTO_${direction.toUpperCase()}`,
      `Wide photo missing for the ${direction} elevation.`,
    ),
  );
}

// Step 3 — ≥1 facet; every facet has area + material + pitch; every facet
// with damagePresent has ≥1 damage record, each with ≥1 photo; whole-roof
// linears recorded.
function checkFacets(state: InspectionProtocolState): Deficiency[] {
  if (state.facets.length === 0) {
    return [deficiency('facets', 'NO_FACETS_DOCUMENTED', 'No roof facets have been documented.')];
  }
  const out: Deficiency[] = [];
  for (const facet of state.facets) {
    if (!facet.hasArea) {
      out.push(
        deficiency(
          'facets',
          `MISSING_FACET_AREA_${facet.id}`,
          `Facet ${facet.label} is missing its area (sqft).`,
        ),
      );
    }
    if (!facet.hasMaterial) {
      out.push(
        deficiency(
          'facets',
          `MISSING_FACET_MATERIAL_${facet.id}`,
          `Facet ${facet.label} is missing its material.`,
        ),
      );
    }
    if (!facet.hasPitch) {
      out.push(
        deficiency(
          'facets',
          `MISSING_FACET_PITCH_${facet.id}`,
          `Facet ${facet.label} is missing its pitch.`,
        ),
      );
    }
    if (facet.damagePresent) {
      const damages = state.damageInstances.filter((instance) => instance.slopeId === facet.id);
      if (damages.length === 0) {
        out.push(
          deficiency(
            'facets',
            `MISSING_FACET_DAMAGE_RECORDS_${facet.id}`,
            `Facet ${facet.label} is marked damaged but has no damage records.`,
          ),
        );
      }
    }
  }
  // Every facet-attached damage record needs at least one photo. Records
  // detached from any live facet (slopeId null — e.g. the FK was nulled when
  // its facet was deleted) can no longer be resolved from the facet flow, so
  // they must not hard-block; they simply carry no gate.
  const liveFacetIds = new Set(state.facets.map((facet) => facet.id));
  for (const instance of state.damageInstances) {
    if (instance.slopeId == null || !liveFacetIds.has(instance.slopeId)) continue;
    if (!instance.photoCaptured) {
      out.push(
        deficiency(
          'facets',
          `MISSING_DAMAGE_PHOTO_${instance.id}`,
          `Damage record ${instance.id} has no photo.`,
        ),
      );
    }
  }
  if (state.wholeRoofLinearCount === 0) {
    out.push(
      deficiency(
        'facets',
        'NO_WHOLE_ROOF_LINEARS',
        'No whole-roof linear measurements (ridge/hip/valley/eave/rake) recorded.',
      ),
    );
  }
  return out;
}

// Step 4 — hail-gated: every facet whose damageType carries hail has a
// test-square photo. Wind-only facets are not required.
function checkTestSquares(state: InspectionProtocolState): Deficiency[] {
  return state.facets
    .filter((facet) => carriesHail(facet.damageType))
    .filter(
      (facet) =>
        !state.testSquares.some(
          (square) => square.slopeId === facet.id && square.photoCaptured,
        ),
    )
    .map((facet) =>
      deficiency(
        'test_squares',
        `MISSING_TEST_SQUARE_${facet.id}`,
        `Facet ${facet.label} carries hail damage and needs a test-square photo.`,
      ),
    );
}

// Step 5 — zone-based capture: each zone with ≥1 documented component needs
// one shared zone photo (a single eave shot evidences every eave-edge
// component at once). None documented at all is a soft flag, not a hard
// block.
const ZONE_LABELS: Record<ComponentZone, string> = {
  eave_edge: 'Eave/Edge',
  ridge_hip: 'Ridge/Hip',
};

function checkComponents(state: InspectionProtocolState): Deficiency[] {
  const documentedZones = new Set<ComponentZone>();
  for (const component of state.components) {
    if (component.zone) documentedZones.add(component.zone);
  }
  return [...documentedZones]
    .filter((zone) => !state.componentZonePhotos.includes(zone))
    .map((zone) =>
      deficiency(
        'components',
        `MISSING_ZONE_PHOTO_${zone}`,
        `${ZONE_LABELS[zone]} components are documented but the zone has no photo.`,
      ),
    );
}

// Step 5 — penetrations are discrete objects; each keeps its own photo.
function checkPenetrations(state: InspectionProtocolState): Deficiency[] {
  return state.penetrations
    .filter((penetration) => !penetration.photoCaptured)
    .map((penetration) =>
      deficiency(
        'components',
        `MISSING_PENETRATION_PHOTO_${penetration.id}`,
        `Documented penetration ${penetration.id} has no photo.`,
      ),
    );
}

// Siding Inspection (v2.1) — ≥1 siding facet; every facet has its facet
// photo; each damaged facet has a damage type and ≥1 damage photo; every
// declared component (S{n}C{k}) has a disposition selection and its own photo.
function checkSiding(state: InspectionProtocolState): Deficiency[] {
  if (state.sidingFacets.length === 0) {
    return [
      deficiency(
        'siding',
        'NO_SIDING_FACETS_DOCUMENTED',
        'Siding damage was reported but no siding facets have been documented.',
      ),
    ];
  }
  const out: Deficiency[] = [];
  for (const facet of state.sidingFacets) {
    if (!facet.facetPhotoCaptured) {
      out.push(
        deficiency(
          'siding',
          `MISSING_SIDING_FACET_PHOTO_${facet.id}`,
          `Siding facet ${facet.label} has no facet photo.`,
        ),
      );
    }
    if (facet.damaged) {
      if (!facet.damageType) {
        out.push(
          deficiency(
            'siding',
            `MISSING_SIDING_DAMAGE_TYPE_${facet.id}`,
            `Siding facet ${facet.label} is marked damaged but has no damage type.`,
          ),
        );
      }
      if (facet.damagePhotoCount === 0) {
        out.push(
          deficiency(
            'siding',
            `MISSING_SIDING_DAMAGE_PHOTO_${facet.id}`,
            `Siding facet ${facet.label} is marked damaged but has no damage photo.`,
          ),
        );
      }
    }
    for (const component of facet.components) {
      const componentLabel = `${facet.label}C${component.index}`;
      if (!component.actionSelected) {
        out.push(
          deficiency(
            'siding',
            `MISSING_SIDING_COMPONENT_ACTION_${facet.id}_${component.index}`,
            `Siding component ${componentLabel} has no disposition (Detach & Reset / Remove & Replace).`,
          ),
        );
      }
      if (!component.photoCaptured) {
        out.push(
          deficiency(
            'siding',
            `MISSING_SIDING_COMPONENT_PHOTO_${facet.id}_${component.index}`,
            `Siding component ${componentLabel} has no photo.`,
          ),
        );
      }
    }
  }
  return out;
}

// Step 7 (collateral) — no hard gate: optional evidence.

// Step 6 — at least one product record.
function checkProduct(state: InspectionProtocolState): Deficiency[] {
  if (state.productIdentifications.length === 0) {
    return [
      deficiency('product', 'NO_PRODUCT_RECORD', 'No roofing-product identification recorded.'),
    ];
  }
  return [];
}

// Step 8 (interior) — conditional; soft-flagged only, never a hard block.

// Step 10 — declaration attestation + signature present.
function checkDeclaration(state: InspectionProtocolState): Deficiency[] {
  if (!state.declarationSigned) {
    return [
      deficiency(
        'declaration',
        'MISSING_DECLARATION',
        'Inspector declaration (attestation + signature) not recorded.',
      ),
    ];
  }
  return [];
}

// Each check is tagged with the step it gates so `evaluate` can skip checks
// whose step does not apply for this inspection's damage flags — the SAME
// applicability predicate the step hub uses for visibility (stepApplies), so
// a hidden step can never block submission.
const STEP_CHECKS: Array<{
  stage: Stage;
  check: (state: InspectionProtocolState) => Deficiency[];
}> = [
  { stage: 'arrival', check: checkArrival },
  { stage: 'elevation_access', check: checkElevationAccess },
  { stage: 'facets', check: checkFacets },
  { stage: 'test_squares', check: checkTestSquares },
  { stage: 'components', check: checkComponents },
  { stage: 'components', check: checkPenetrations },
  { stage: 'product', check: checkProduct },
  { stage: 'siding', check: checkSiding },
  { stage: 'declaration', check: checkDeclaration },
];

// Step 11 — submit: zero hard deficiencies across every prior step, plus the
// explicit final-review confirmation. Computed from the other checks'
// results (the old checkS9 aggregate).
function checkSubmit(
  state: InspectionProtocolState,
  priorDeficiencies: Deficiency[],
): Deficiency[] {
  const out: Deficiency[] = [];
  if (priorDeficiencies.length > 0) {
    out.push(
      deficiency(
        'submit',
        'HARD_DEFICIENCIES_REMAIN',
        `${priorDeficiencies.length} blocking deficiencies remain across earlier steps.`,
      ),
    );
  }
  const { roofDamageFound, sidingDamageFound, collateralDamageFound, interiorDamageFound } =
    state.damageFlags;
  if (!roofDamageFound && !sidingDamageFound && !collateralDamageFound && !interiorDamageFound) {
    out.push(
      deficiency(
        'submit',
        'NO_DAMAGE_SURFACE_SELECTED',
        'No damage surface was selected on the Elevation Walk — mark roof, siding, interior, or collateral damage before submitting.',
      ),
    );
  }
  if (!state.finalReviewConfirmed) {
    out.push(
      deficiency('submit', 'FINAL_REVIEW_NOT_CONFIRMED', 'Final review has not been confirmed.'),
    );
  }
  return out;
}

// Soft flags: non-blocking observations.
function checkInteriorLeakWithoutPhoto(state: InspectionProtocolState): SoftFlag[] {
  if (state.observedIndicators.includes('interior_leak_reported') && !state.interiorPhotoCaptured) {
    return [
      softFlag(
        'interior',
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
        'test_squares',
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
        'product',
        `PRODUCT_UNIDENTIFIED_${product.id}`,
        `Roofing product ${product.id} could not be identified in the field — confirm a sample was bagged or the attestation was filed.`,
      ),
    );
}

// No components documented at all — worth a look, never a block.
function checkNoComponentsDocumented(state: InspectionProtocolState): SoftFlag[] {
  if (state.components.length === 0) {
    return [
      softFlag(
        'components',
        'NO_COMPONENTS_DOCUMENTED',
        'No existing components were documented — confirm this was intentional.',
      ),
    ];
  }
  return [];
}

// Interior/attic is conditional: an inspection either records at least one
// interior observation OR the inspector explicitly waives it with a "no
// interior claim" attestation. Neither is a soft flag (an undocumented
// skip), never a hard block.
function checkInteriorNotAddressed(state: InspectionProtocolState): SoftFlag[] {
  if (state.interiorObservationCount === 0 && !state.interiorClaimWaived) {
    return [
      softFlag(
        'interior',
        'INTERIOR_NOT_ADDRESSED',
        'Interior/attic was neither documented nor explicitly waived with a no-interior-claim attestation.',
      ),
    ];
  }
  return [];
}

// Siding measurement report is optional — soft-flag its absence so the
// reviewer sees the gap without blocking the field submission.
function checkSidingMeasurementReport(state: InspectionProtocolState): SoftFlag[] {
  if (!state.sidingMeasurementReportUploaded) {
    return [
      softFlag(
        'siding',
        'SIDING_MEASUREMENT_REPORT_MISSING',
        'No siding measurement report was uploaded — attach one if available.',
      ),
    ];
  }
  return [];
}

const SOFT_FLAG_CHECKS: Array<{
  stage: Stage;
  check: (state: InspectionProtocolState) => SoftFlag[];
}> = [
  { stage: 'interior', check: checkInteriorLeakWithoutPhoto },
  { stage: 'test_squares', check: checkZeroHitTestSquares },
  { stage: 'product', check: checkUnidentifiedProducts },
  { stage: 'components', check: checkNoComponentsDocumented },
  { stage: 'interior', check: checkInteriorNotAddressed },
  { stage: 'siding', check: checkSidingMeasurementReport },
];

// Single entry point: given the raw capture state of an inspection, returns
// every hard-gate deficiency (blocking) and soft flag (non-blocking).
// v2.1: checks for conditional steps run only when the step applies for the
// inspection's damage flags.
export function evaluate(state: InspectionProtocolState): EvaluationResult {
  const flags = state.damageFlags;
  const stepDeficiencies = STEP_CHECKS.filter(({ stage }) => stepApplies(stage, flags)).flatMap(
    ({ check }) => check(state),
  );
  return {
    deficiencies: [...stepDeficiencies, ...checkSubmit(state, stepDeficiencies)],
    softFlags: SOFT_FLAG_CHECKS.filter(({ stage }) => stepApplies(stage, flags)).flatMap(
      ({ check }) => check(state),
    ),
  };
}

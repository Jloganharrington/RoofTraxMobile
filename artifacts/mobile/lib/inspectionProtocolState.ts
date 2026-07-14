import {
  ELEVATION_DIRECTIONS,
  evaluate,
  type Deficiency,
  type InspectionProtocolState,
  type Stage,
} from '@workspace/protocol';
import type { Inspection } from '@workspace/api-client-react';

// Bridges the api-client inspection detail (raw captured rows the server
// returns / the optimistic cache holds) into lib/protocol's pure
// InspectionProtocolState, then runs the shared gate engine. Keeping this
// mapping here — not in lib/protocol — preserves that package's freedom from
// any transport/DB shape. The app computes nothing derivable: it only reports
// which raw captures exist, exactly as the evidentiary protocol requires.

type Photo = NonNullable<Inspection['photos']>[number];

function hasTriad(photos: Photo[], subjectId: string, role: 'wide' | 'mid' | 'close'): boolean {
  return photos.some(
    (p) => p.subjectId === subjectId && p.triadRole === role,
  );
}

/** Builds the protocol state from an inspection detail. Stages not yet wired
 * into the app (S0 overview, S4 test squares, S6 interior, S7 measurements,
 * S8/S9 sign-off) are reported as their raw-empty facts; the UI only consumes
 * the deficiencies for the stages it has actually built (see `stageStatus`).
 * C5 product identifications are now populated, so the S4 unidentified-product
 * soft flag fires whenever a product row is marked `unidentifiable`. */
export function buildProtocolState(inspection: Inspection): InspectionProtocolState {
  const photos = inspection.photos ?? [];
  const elevations = inspection.elevations ?? [];
  const slopes = inspection.slopes ?? [];
  const damageInstances = inspection.damageInstances ?? [];
  const products = inspection.products ?? [];
  const testSquares = inspection.testSquares ?? [];
  const testSquareHits = inspection.testSquareHits ?? [];
  const attestations = inspection.attestations ?? [];

  // D2 — slopes the inspector documented as inaccessible via an S4 reason
  // attestation. Such a slope clears its test-square requirement while
  // recording why no square could be marked.
  const inaccessibleSlopeIds = attestations.flatMap((attestation) => {
    if (attestation.stage !== 'S4' || attestation.attestationType !== 'stage_signoff') return [];
    const details = attestation.details as { kind?: string; slopeId?: string } | null;
    if (details?.kind !== 'inaccessible_slope' || !details.slopeId) return [];
    return [details.slopeId];
  });

  const elevationState: InspectionProtocolState['elevations'] = {};
  for (const elevation of elevations) {
    elevationState[elevation.direction] = {
      widePhotoCaptured: photos.some(
        (p) =>
          p.subjectType === 'elevation' &&
          p.subjectId === elevation.id &&
          p.triadRole === 'wide',
      ),
    };
  }

  return {
    overviewPhotoCaptured: photos.some(
      (p) => p.subjectType === 'inspection' && p.stage === 'S0',
    ),
    elevations: elevationState,
    roofAccessPhotoCaptured: photos.some(
      (p) => p.subjectType === 'inspection' && p.stage === 'S2',
    ),
    slopes: slopes.map((slope) => ({
      id: slope.id,
      widePhotoCaptured: photos.some(
        (p) => p.subjectType === 'slope' && p.subjectId === slope.id && p.triadRole === 'wide',
      ),
    })),
    testSquares: testSquares.map((square) => ({
      id: square.id,
      slopeId: square.slopeId ?? '',
      overviewPhotoCaptured: photos.some(
        (p) =>
          p.subjectType === 'test_square' &&
          p.subjectId === square.id &&
          p.triadRole === 'wide',
      ),
      hitCount: testSquareHits.filter((hit) => hit.testSquareId === square.id).length,
    })),
    inaccessibleSlopeIds,
    damageInstances: damageInstances.map((instance) => {
      const own = photos.filter(
        (p) => p.subjectType === 'damage_instance' && p.subjectId === instance.id,
      );
      return {
        id: instance.id,
        widePhotoCaptured: hasTriad(own, instance.id, 'wide'),
        midPhotoCaptured: hasTriad(own, instance.id, 'mid'),
        closePhotoCaptured: hasTriad(own, instance.id, 'close'),
      };
    }),
    interiorPhotoCaptured: false,
    productIdentifications: products.map((product) => ({
      id: product.id,
      unidentifiable: product.identificationMethod === 'unidentifiable',
    })),
    measurements: [],
    attestationRecorded: false,
    finalReviewConfirmed: false,
    observedIndicators: [],
  };
}

/** Deficiencies for a single stage, computed from the current capture state. */
export function stageDeficiencies(inspection: Inspection, stage: Stage): Deficiency[] {
  return evaluate(buildProtocolState(inspection)).deficiencies.filter((d) => d.stage === stage);
}

/** True when the given stage has no blocking deficiencies. */
export function isStageComplete(inspection: Inspection, stage: Stage): boolean {
  return stageDeficiencies(inspection, stage).length === 0;
}

/** Per-elevation wide-photo completion, keyed by direction, for the walk UI. */
export function elevationWideCaptured(inspection: Inspection) {
  const state = buildProtocolState(inspection);
  return Object.fromEntries(
    ELEVATION_DIRECTIONS.map((direction) => [
      direction,
      state.elevations[direction]?.widePhotoCaptured ?? false,
    ]),
  ) as Record<(typeof ELEVATION_DIRECTIONS)[number], boolean>;
}

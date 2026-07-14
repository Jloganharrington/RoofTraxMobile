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

/** Builds the protocol state from an inspection detail. Every stage the app
 * captures is mapped from its raw rows: elevations/slopes/damage triads/test
 * squares (M-A–M-D), plus M-E's measurements (S7), interior observations and
 * no-interior-claim waiver (S6), methodology signature (S8) and final-review
 * confirmation (S9). The app reports only raw facts; the shared gate engine
 * derives blocking deficiencies and soft flags from them. */
export function buildProtocolState(inspection: Inspection): InspectionProtocolState {
  const photos = inspection.photos ?? [];
  const elevations = inspection.elevations ?? [];
  const slopes = inspection.slopes ?? [];
  const damageInstances = inspection.damageInstances ?? [];
  const products = inspection.products ?? [];
  const testSquares = inspection.testSquares ?? [];
  const testSquareHits = inspection.testSquareHits ?? [];
  const attestations = inspection.attestations ?? [];
  const interiorObservations = inspection.interiorObservations ?? [];
  const measurements = inspection.measurements ?? [];

  // A stage_signoff attestation filed on a specific stage clears that stage's
  // hard gate (S8 methodology/signature, S9 final review) or its conditional
  // soft flag (S6 no-interior-claim waiver). Qualify BOTH the stage and the
  // attestationType — a bare stage match would let an unrelated attestation
  // (e.g. a GPS override) bypass the gate. (see protocol-gate-mapping-layer.)
  const hasStageSignoff = (stage: string, kind?: string): boolean =>
    attestations.some((attestation) => {
      if (attestation.stage !== stage || attestation.attestationType !== 'stage_signoff') {
        return false;
      }
      if (!kind) return true;
      const details = attestation.details as { kind?: string } | null;
      return details?.kind === kind;
    });

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
    interiorPhotoCaptured: photos.some((p) => p.subjectType === 'interior_observation'),
    interiorObservationCount: interiorObservations.length,
    interiorClaimWaived: hasStageSignoff('S6', 'no_interior_claim'),
    productIdentifications: products.map((product) => ({
      id: product.id,
      unidentifiable: product.identificationMethod === 'unidentifiable',
    })),
    // E1 — a whole-roof measurement carries no slopeId (empty string); a
    // per-slope measurement ties to the slope it was taken on, which the S7
    // cross-check reconciles against the S3 slope inventory.
    measurements: measurements.map((measurement) => ({
      id: measurement.id,
      slopeId: measurement.subjectType === 'slope' ? (measurement.subjectId ?? '') : '',
    })),
    attestationRecorded: hasStageSignoff('S8'),
    finalReviewConfirmed: hasStageSignoff('S9'),
    observedIndicators: [],
  };
}

/** Full gate evaluation (hard deficiencies + soft flags) for the readiness
 * screen (E4). The centerpiece runs exactly this shared engine — the app never
 * re-implements gate logic. */
export function evaluateInspection(inspection: Inspection) {
  return evaluate(buildProtocolState(inspection));
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

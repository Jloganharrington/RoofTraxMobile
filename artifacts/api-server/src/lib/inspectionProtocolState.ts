import {
  evaluate,
  type EvaluationResult,
  type InspectionProtocolState,
} from '@workspace/protocol';
import type {
  Attestation,
  DamageInstance,
  InspectionComponent,
  InspectionElevation,
  InteriorObservation,
  InspectionPenetration,
  InspectionPhoto,
  InspectionProduct,
  InspectionSlope,
  Measurement,
  TestSquare,
  TestSquareHit,
} from '@workspace/db';

// Server-side twin of the mobile `buildProtocolState` (see
// artifacts/mobile/lib/inspectionProtocolState.ts). Phase M-F makes the server
// the authoritative gatekeeper: the pre-flight endpoint (F1) and the submission
// hardening (F2) must derive the SAME InspectionProtocolState the mobile
// readiness screen derives, then run the SAME shared lib/protocol evaluate().
//
// This mapping MUST stay byte-for-byte equivalent to the mobile mapping. If the
// two drift, the client can pass its own gate while the server rejects (or,
// worse, the server passes something the client would have blocked). Both files
// carry the same qualify-BOTH-stage-AND-attestationType rule for exactly that
// reason — a bare stage match would let an unrelated attestation bypass a gate.

export interface HydratedInspectionChildren {
  photos: InspectionPhoto[];
  elevations: InspectionElevation[];
  slopes: InspectionSlope[];
  damageInstances: DamageInstance[];
  components: InspectionComponent[];
  penetrations: InspectionPenetration[];
  products: InspectionProduct[];
  testSquares: TestSquare[];
  testSquareHits: TestSquareHit[];
  attestations: Attestation[];
  interiorObservations: InteriorObservation[];
  measurements: Measurement[];
}

function hasTriad(
  photos: InspectionPhoto[],
  subjectId: string,
  role: 'wide' | 'mid' | 'close',
): boolean {
  return photos.some((p) => p.subjectId === subjectId && p.triadRole === role);
}

export function buildServerProtocolState(
  children: HydratedInspectionChildren,
): InspectionProtocolState {
  const {
    photos,
    elevations,
    slopes,
    damageInstances,
    products,
    testSquares,
    testSquareHits,
    attestations,
    interiorObservations,
    measurements,
  } = children;

  // A stage_signoff attestation filed on a specific stage clears that stage's
  // hard gate (S8 methodology/signature, S9 final review) or its conditional
  // soft flag (S6 no-interior-claim waiver). Qualify BOTH the stage and the
  // attestationType — a bare stage match would let an unrelated attestation
  // (e.g. a GPS override) bypass the gate.
  const hasStageSignoff = (stage: string, kind?: string): boolean =>
    attestations.some((attestation) => {
      if (attestation.stage !== stage || attestation.attestationType !== 'stage_signoff') {
        return false;
      }
      if (!kind) return true;
      const details = attestation.details as { kind?: string } | null;
      return details?.kind === kind;
    });

  // D2 — slopes documented as inaccessible via an S4 reason attestation.
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
    measurements: measurements.map((measurement) => ({
      id: measurement.id,
      slopeId: measurement.subjectType === 'slope' ? (measurement.subjectId ?? '') : '',
    })),
    attestationRecorded: hasStageSignoff('S8'),
    finalReviewConfirmed: hasStageSignoff('S9'),
    observedIndicators: [],
  };
}

export function evaluateServerInspection(
  children: HydratedInspectionChildren,
): EvaluationResult {
  return evaluate(buildServerProtocolState(children));
}

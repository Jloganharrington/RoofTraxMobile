import {
  COMPONENT_ZONES,
  WHOLE_ROOF_LINEAR_TYPES,
  componentZoneForType,
  evaluate,
  type DamageFlags,
  type EvaluationResult,
  type InspectionProtocolState,
  type SidingDamageType,
} from '@workspace/protocol';
import type {
  ArrivalConditions,
  Attestation,
  DamageInstance,
  FacetDamageType,
  InspectionComponent,
  InspectionElevation,
  InteriorObservation,
  InspectionPenetration,
  InspectionPhoto,
  InspectionProduct,
  InspectionSidingFacet,
  InspectionSlope,
  Measurement,
  TestSquare,
  TestSquareHit,
} from '@workspace/db';

// Server-side twin of the mobile `buildProtocolState` (see
// artifacts/mobile/lib/inspectionProtocolState.ts). The server is the
// authoritative gatekeeper: the pre-flight endpoint and the submission
// hardening must derive the SAME InspectionProtocolState the mobile
// readiness screen derives, then run the SAME shared lib/protocol evaluate().
//
// This mapping MUST stay byte-for-byte equivalent to the mobile mapping. If the
// two drift, the client can pass its own gate while the server rejects (or,
// worse, the server passes something the client would have blocked). Both files
// carry the same qualify-BOTH-stage-AND-attestationType rule for exactly that
// reason — a bare stage match would let an unrelated attestation bypass a gate.

export interface HydratedInspectionChildren {
  arrivalConditions: ArrivalConditions | null;
  // v2.1 — the Elevation Walk damage flags + the optional siding measurement
  // report ref live on the inspection row itself, so the caller passes them
  // alongside the hydrated child collections.
  damageFlags: DamageFlags;
  sidingMeasurementReportRef: string | null;
  // From the inspection row's propertyProfile jsonb — townhomes share side
  // walls, so right/left elevations are exempt from the gate.
  propertyType: string | null;
  photos: InspectionPhoto[];
  elevations: InspectionElevation[];
  slopes: InspectionSlope[];
  sidingFacets: InspectionSidingFacet[];
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

const WHOLE_ROOF_LINEARS: readonly string[] = WHOLE_ROOF_LINEAR_TYPES;

export function buildServerProtocolState(
  children: HydratedInspectionChildren,
): InspectionProtocolState {
  const {
    arrivalConditions,
    damageFlags,
    sidingMeasurementReportRef,
    photos,
    elevations,
    slopes,
    sidingFacets,
    damageInstances,
    components,
    penetrations,
    products,
    testSquares,
    testSquareHits,
    attestations,
    interiorObservations,
    measurements,
  } = children;

  // A stage_signoff attestation filed on a specific step clears that step's
  // hard gate (declaration signature, submit final review) or its conditional
  // soft flag (interior no-interior-claim waiver). Qualify BOTH the stage and
  // the attestationType — a bare stage match would let an unrelated
  // attestation (e.g. a GPS override) bypass the gate.
  const hasStageSignoff = (stage: string, kind?: string): boolean =>
    attestations.some((attestation) => {
      if (attestation.stage !== stage || attestation.attestationType !== 'stage_signoff') {
        return false;
      }
      if (!kind) return true;
      const details = attestation.details as { kind?: string } | null;
      return details?.kind === kind;
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
    arrival: {
      skyLogged: Boolean(arrivalConditions?.sky),
      windLogged: Boolean(arrivalConditions?.windCondition),
      tempLogged: Boolean(arrivalConditions?.temp),
      personnelRecorded: (arrivalConditions?.personnelPresent?.length ?? 0) > 0,
      gpsPresent:
        arrivalConditions?.gpsLatitude != null && arrivalConditions?.gpsLongitude != null,
      timePresent: Boolean(arrivalConditions?.timeLocal ?? arrivalConditions?.recordedAtUtc),
    },
    elevations: elevationState,
    // Mirrored in the mobile mapper (buildProtocolState).
    sideElevationsExempt: children.propertyType === 'townhome',
    damageFlags,
    facets: slopes.map((slope) => ({
      id: slope.id,
      label: slope.label,
      hasArea: slope.areaSqft != null,
      hasMaterial: Boolean(slope.materialType),
      hasPitch: slope.pitchRise != null && slope.pitchRun != null,
      damagePresent: Boolean(slope.damagePresent),
      damageType: (slope.damageType as FacetDamageType | null) ?? null,
    })),
    damageInstances: damageInstances.map((instance) => ({
      id: instance.id,
      slopeId: instance.slopeId ?? '',
      photoCaptured: photos.some(
        (p) => p.subjectType === 'damage_instance' && p.subjectId === instance.id,
      ),
    })),
    // Whole-roof linears: measurements recorded against the inspection itself
    // (no slope subject) with a linear measurement type.
    wholeRoofLinearCount: measurements.filter(
      (m) => m.subjectType !== 'slope' && WHOLE_ROOF_LINEARS.includes(m.measurementType),
    ).length,
    testSquares: testSquares.map((square) => ({
      id: square.id,
      slopeId: square.slopeId ?? '',
      photoCaptured: photos.some(
        (p) => p.subjectType === 'test_square' && p.subjectId === square.id,
      ),
      hitCount: testSquareHits.filter((hit) => hit.testSquareId === square.id).length,
    })),
    // Zone-based component capture: one shared zone photo (subjectType
    // 'component' + a zone tag) evidences every component documented in that
    // zone. Penetrations stay discrete — each keeps its own photo.
    components: components.map((component) => ({
      id: component.id,
      zone: componentZoneForType(component.componentType),
    })),
    componentZonePhotos: COMPONENT_ZONES.filter((zone) =>
      photos.some((p) => p.subjectType === 'component' && p.zone === zone),
    ),
    penetrations: penetrations.map((penetration) => ({
      id: penetration.id,
      photoCaptured: photos.some(
        (p) => p.subjectType === 'penetration' && p.subjectId === penetration.id,
      ),
    })),
    productIdentifications: products.map((product) => ({
      id: product.id,
      unidentifiable: product.identificationMethod === 'unidentifiable',
    })),
    // v2.1 — Siding facets. Photos are discriminated by subjectType
    // 'siding_facet' + the sidingRole tag (never by caption strings), so the
    // gate can tell the damage close-up, facet shot, and per-component photos
    // apart deterministically.
    sidingFacets: sidingFacets.map((facet) => {
      const facetPhotos = photos.filter(
        (p) => p.subjectType === 'siding_facet' && p.subjectId === facet.id,
      );
      return {
        id: facet.id,
        label: facet.label,
        damaged: Boolean(facet.damaged),
        damageType: (facet.damageType as SidingDamageType | null) ?? null,
        // Positional components: slot k (1-based) is satisfied by a
        // 'component'-role photo whose sidingComponentIndex === k.
        components: ((facet.components ?? []) as Array<{ action?: string | null }>).map(
          (component, i) => ({
            index: i + 1,
            actionSelected: Boolean(component?.action),
            photoCaptured: facetPhotos.some(
              (p) => p.sidingRole === 'component' && p.sidingComponentIndex === i + 1,
            ),
          }),
        ),
        facetPhotoCaptured: facetPhotos.some((p) => p.sidingRole === 'facet'),
        damagePhotoCount: facetPhotos.filter((p) => p.sidingRole === 'damage').length,
      };
    }),
    sidingMeasurementReportUploaded: Boolean(sidingMeasurementReportRef),
    interiorPhotoCaptured: photos.some((p) => p.subjectType === 'interior_observation'),
    interiorObservationCount: interiorObservations.length,
    interiorClaimWaived: hasStageSignoff('interior', 'no_interior_claim'),
    declarationSigned: hasStageSignoff('declaration'),
    finalReviewConfirmed: hasStageSignoff('submit'),
    observedIndicators: [],
  };
}

export function evaluateServerInspection(
  children: HydratedInspectionChildren,
): EvaluationResult {
  return evaluate(buildServerProtocolState(children));
}

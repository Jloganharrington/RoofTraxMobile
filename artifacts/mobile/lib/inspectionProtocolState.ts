import {
  COMPONENT_ZONES,
  ELEVATION_DIRECTIONS,
  WHOLE_ROOF_LINEAR_TYPES,
  componentZoneForType,
  evaluate,
  type Deficiency,
  type FacetDamageType,
  type InspectionProtocolState,
  type SidingDamageType,
  type Stage,
} from '@workspace/protocol';
import type { Inspection } from '@workspace/api-client-react';

// Bridges the api-client inspection detail (raw captured rows the server
// returns / the optimistic cache holds) into lib/protocol's pure
// InspectionProtocolState, then runs the shared gate engine. Keeping this
// mapping here — not in lib/protocol — preserves that package's freedom from
// any transport/DB shape. The app computes nothing derivable: it only reports
// which raw captures exist, exactly as the evidentiary protocol requires.
//
// This mapping MUST stay byte-for-byte equivalent to the server mapping in
// artifacts/api-server/src/lib/inspectionProtocolState.ts (see the parity
// notes there).

type Photo = NonNullable<Inspection['photos']>[number];

const WHOLE_ROOF_LINEARS: readonly string[] = WHOLE_ROOF_LINEAR_TYPES;

/** Builds the protocol-v2 state from an inspection detail. Every step the app
 * captures is mapped from its raw rows. The app reports only raw facts; the
 * shared gate engine derives blocking deficiencies and soft flags from them. */
export function buildProtocolState(inspection: Inspection): InspectionProtocolState {
  const photos: Photo[] = inspection.photos ?? [];
  const elevations = inspection.elevations ?? [];
  const slopes = inspection.slopes ?? [];
  const sidingFacets = inspection.sidingFacets ?? [];
  const damageInstances = inspection.damageInstances ?? [];
  const components = inspection.components ?? [];
  const penetrations = inspection.penetrations ?? [];
  const products = inspection.products ?? [];
  const testSquares = inspection.testSquares ?? [];
  const testSquareHits = inspection.testSquareHits ?? [];
  const attestations = inspection.attestations ?? [];
  const interiorObservations = inspection.interiorObservations ?? [];
  const measurements = inspection.measurements ?? [];
  const arrivalConditions = inspection.arrivalConditions ?? null;

  // A stage_signoff attestation filed on a specific step clears that step's
  // hard gate (declaration signature, submit final review) or its conditional
  // soft flag (interior no-interior-claim waiver). Qualify BOTH the stage and
  // the attestationType — a bare stage match would let an unrelated
  // attestation (e.g. a GPS override) bypass the gate. (see
  // protocol-gate-mapping-layer.)
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
    damageFlags: {
      roofDamageFound: Boolean(inspection.roofDamageFound),
      sidingDamageFound: Boolean(inspection.sidingDamageFound),
      collateralDamageFound: Boolean(inspection.collateralDamageFound),
    },
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
        wrbPresent: (facet.wrbPresent as boolean | null) ?? null,
        // Positional components: slot k (1-based) is satisfied by a
        // 'component'-role photo whose sidingComponentIndex === k.
        components: (facet.components ?? []).map((component, i) => ({
          index: i + 1,
          actionSelected: Boolean(component?.action),
          photoCaptured: facetPhotos.some(
            (p) => p.sidingRole === 'component' && p.sidingComponentIndex === i + 1,
          ),
        })),
        facetPhotoCaptured: facetPhotos.some((p) => p.sidingRole === 'facet'),
        damagePhotoCount: facetPhotos.filter((p) => p.sidingRole === 'damage').length,
      };
    }),
    sidingMeasurementReportUploaded: Boolean(inspection.sidingMeasurementReportRef),
    interiorPhotoCaptured: photos.some((p) => p.subjectType === 'interior_observation'),
    interiorObservationCount: interiorObservations.length,
    interiorClaimWaived: hasStageSignoff('interior', 'no_interior_claim'),
    declarationSigned: hasStageSignoff('declaration'),
    finalReviewConfirmed: hasStageSignoff('submit'),
    observedIndicators: [],
  };
}

/** Full gate evaluation (hard deficiencies + soft flags) for the readiness
 * screen. The centerpiece runs exactly this shared engine — the app never
 * re-implements gate logic. */
/** True when the inspector filed a "no collateral damage found" attestation on
 * the collateral stage. Qualifies stage + attestationType + details.kind so an
 * unrelated attestation cannot mark the step addressed (see
 * protocol-gate-mapping-layer). Collateral has no hard protocol gate — this
 * only drives the hub's step-complete state. */
export function isCollateralWaived(inspection: Inspection): boolean {
  return (inspection.attestations ?? []).some((attestation) => {
    if (attestation.stage !== 'collateral' || attestation.attestationType !== 'stage_signoff') {
      return false;
    }
    const details = attestation.details as { kind?: string } | null;
    return details?.kind === 'no_collateral_damage';
  });
}

export function evaluateInspection(inspection: Inspection) {
  return evaluate(buildProtocolState(inspection));
}

/** Deficiencies for a single step, computed from the current capture state. */
export function stageDeficiencies(inspection: Inspection, stage: Stage): Deficiency[] {
  return evaluate(buildProtocolState(inspection)).deficiencies.filter((d) => d.stage === stage);
}

/** True when the given step has no blocking deficiencies. */
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

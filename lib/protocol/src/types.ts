import type { ElevationDirection, FacetDamageType, Stage } from './stages';
import type { ObservedIndicator } from './indicators';

// Raw capture-completion state for a single inspection (Protocol v2). Every
// field is a plain fact ("was this captured?", "how many?") — no computed
// squares/waste/pricing lives here or anywhere in this package.
export interface InspectionProtocolState {
  // Step 1 — Arrival Log (data only, no photos).
  arrival: {
    skyLogged: boolean;
    windLogged: boolean;
    tempLogged: boolean;
    personnelRecorded: boolean;
    gpsPresent: boolean;
    timePresent: boolean;
  };
  // Step 2 — Elevation Walk & Access.
  elevations: Partial<Record<ElevationDirection, { widePhotoCaptured: boolean }>>;
  roofAccessPhotoCaptured: boolean;
  // Step 3 — Facets & Measurements. One entry per documented facet.
  facets: Array<{
    id: string;
    label: string;
    hasArea: boolean;
    hasMaterial: boolean;
    hasPitch: boolean;
    damagePresent: boolean;
    damageType: FacetDamageType | null;
  }>;
  // Per-damage records tied to a facet (slopeId). Each needs ≥1 photo.
  damageInstances: Array<{ id: string; slopeId: string; photoCaptured: boolean }>;
  // Count of whole-roof linear measurements recorded (slopeId = null,
  // measurementType ∈ WHOLE_ROOF_LINEAR_TYPES).
  wholeRoofLinearCount: number;
  // Step 4 — Test Squares. `photoCaptured` is the chalked square shot;
  // `slopeId` ties the square to the facet whose hail gate it satisfies.
  testSquares: Array<{ id: string; slopeId: string; photoCaptured: boolean; hitCount: number }>;
  // Step 5 — each documented component, and whether it has a photo.
  components: Array<{ id: string; photoCaptured: boolean }>;
  // Step 7 — product identification records.
  productIdentifications: Array<{ id: string; unidentifiable: boolean }>;
  // Step 8 — interior/attic (conditional; soft-flagged, never hard-blocked).
  interiorPhotoCaptured: boolean;
  interiorObservationCount: number;
  interiorClaimWaived: boolean;
  // Step 10 — declaration attestation + signature.
  declarationSigned: boolean;
  // Step 11 — explicit final-review confirmation.
  finalReviewConfirmed: boolean;
  observedIndicators: ObservedIndicator[];
}

// A blocking issue: the inspection cannot move past `stage` until resolved.
export interface Deficiency {
  stage: Stage;
  code: string;
  message: string;
}

// A non-blocking issue worth surfacing to the inspector/reviewer, but that
// does not prevent progression.
export interface SoftFlag {
  stage: Stage;
  code: string;
  message: string;
}

export interface EvaluationResult {
  deficiencies: Deficiency[];
  softFlags: SoftFlag[];
}

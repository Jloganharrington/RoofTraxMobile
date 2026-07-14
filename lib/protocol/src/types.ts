import type { ElevationDirection, Stage } from './stages';
import type { ObservedIndicator } from './indicators';

// Raw capture-completion state for a single inspection. Every field is a
// plain fact ("was this captured?", "how many hits?") — no computed
// squares/waste/pricing lives here or anywhere in this package.
export interface InspectionProtocolState {
  overviewPhotoCaptured: boolean;
  elevations: Partial<Record<ElevationDirection, { widePhotoCaptured: boolean }>>;
  roofAccessPhotoCaptured: boolean;
  slopes: Array<{ id: string; widePhotoCaptured: boolean }>;
  // One test square per directional slope (D1). `overviewPhotoCaptured` is the
  // chalked full-square shot; `hitCount` is the raw number of recorded hits (a
  // documented zero-hit square is valid — see the S4 soft flag). `slopeId` ties
  // the square to the slope whose S4 gate it satisfies.
  testSquares: Array<{
    id: string;
    slopeId: string;
    overviewPhotoCaptured: boolean;
    hitCount: number;
  }>;
  // Slopes the inspector documented as inaccessible via a reason attestation
  // (D2). Such a slope clears its S4 test-square requirement while recording
  // *why* no square could be marked. An undocumented missing square still
  // fails the gate.
  inaccessibleSlopeIds: string[];
  damageInstances: Array<{
    id: string;
    widePhotoCaptured: boolean;
    midPhotoCaptured: boolean;
    closePhotoCaptured: boolean;
  }>;
  interiorPhotoCaptured: boolean;
  // How many interior/attic observations were recorded (E2), and whether the
  // inspector explicitly waived interior documentation via a "no interior
  // claim" attestation. An inspection with neither raises a soft flag — it is
  // never a hard block, since many roofs have no interior claim at all.
  interiorObservationCount: number;
  interiorClaimWaived: boolean;
  // Product identifications captured during S4 close-up documentation. Each is
  // a plain fact: was the roofing product identified in the field, or flagged
  // as unidentifiable (deferred to lab/ITEL)? Drives a non-blocking soft flag.
  productIdentifications: Array<{ id: string; unidentifiable: boolean }>;
  // Raw measurements recorded (E1). `slopeId` is the slope a per-slope
  // measurement is tied to (empty for whole-roof measurements). Used to
  // cross-check against the S3 slope inventory (a measurement referencing a
  // slope that was never documented is soft-flagged).
  measurements: Array<{ id: string; slopeId: string }>;
  attestationRecorded: boolean;
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

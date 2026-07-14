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
  testSquares: Array<{ id: string; slopeId: string; hitCount: number }>;
  damageInstances: Array<{
    id: string;
    widePhotoCaptured: boolean;
    midPhotoCaptured: boolean;
    closePhotoCaptured: boolean;
  }>;
  interiorPhotoCaptured: boolean;
  // Product identifications captured during S4 close-up documentation. Each is
  // a plain fact: was the roofing product identified in the field, or flagged
  // as unidentifiable (deferred to lab/ITEL)? Drives a non-blocking soft flag.
  productIdentifications: Array<{ id: string; unidentifiable: boolean }>;
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

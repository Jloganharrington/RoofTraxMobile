import type {
  DamageFlags,
  ElevationDirection,
  FacetDamageType,
  SidingDamageType,
  Stage,
} from './stages';
import type { ObservedIndicator } from './indicators';

// Step 5 — Components capture is zone-based: one shared "zone photo"
// evidences every component visible in that zone (a single eave shot shows
// the drip edge, gutter apron, starter, ice-&-water and decking layers at
// once). The zone vocabulary is shared by the photo record (`zone` field),
// the gate rules, and the Brain's photo grouping.
export const COMPONENT_ZONES = ['eave_edge', 'ridge_hip'] as const;
export type ComponentZone = (typeof COMPONENT_ZONES)[number];

// Which zone each component type is documented under. `flashing` is retired
// from the checklist and maps to no zone (legacy rows never demand a photo).
const COMPONENT_TYPE_ZONES: Record<string, ComponentZone> = {
  gutter_apron: 'eave_edge',
  drip_edge: 'eave_edge',
  starter: 'eave_edge',
  ice_and_water_shield: 'eave_edge',
  underlayment: 'eave_edge',
  decking: 'eave_edge',
  layer_count: 'eave_edge',
  ventilation: 'ridge_hip',
};

/** Zone a component type belongs to, or null for retired/unzoned types. */
export function componentZoneForType(componentType: string): ComponentZone | null {
  return COMPONENT_TYPE_ZONES[componentType] ?? null;
}

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
  // Step 2 — Elevation Walk: four wide elevation photos plus the three
  // damage-found flags. The flags drive which conditional steps apply.
  elevations: Partial<Record<ElevationDirection, { widePhotoCaptured: boolean }>>;
  damageFlags: DamageFlags;
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
  // Step 5 — each documented component and the zone it belongs to (derived
  // from its componentType via componentZoneForType). Photos are per-zone,
  // not per-component: a zone with ≥1 documented component needs one shared
  // zone photo.
  components: Array<{ id: string; zone: ComponentZone | null }>;
  // Zones that have at least one zone photo (subjectType 'component' with a
  // `zone` value).
  componentZonePhotos: ComponentZone[];
  // Roof penetrations are discrete objects — each keeps its own photo.
  penetrations: Array<{ id: string; photoCaptured: boolean }>;
  // Step 6 — product identification records.
  productIdentifications: Array<{ id: string; unidentifiable: boolean }>;
  // Siding Inspection (v2.1, applies when sidingDamageFound). One entry per
  // documented siding facet (S1, S2, …). Photo counts are derived from
  // siding_facet-subject photos discriminated by their sidingRole tag.
  sidingFacets: Array<{
    id: string;
    label: string;
    damaged: boolean;
    damageType: SidingDamageType | null;
    // Components S{n}C1…S{n}Ck, positional (index is 1-based). Each needs a
    // disposition selection and its own photo (a 'component'-role photo whose
    // sidingComponentIndex matches).
    components: Array<{ index: number; actionSelected: boolean; photoCaptured: boolean }>;
    facetPhotoCaptured: boolean;
    damagePhotoCount: number;
  }>;
  // Optional siding measurement report (soft-flagged when siding applies and
  // it's missing — never a hard block).
  sidingMeasurementReportUploaded: boolean;
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

/**
 * Canonical measurement vocabulary for the inspection protocol.
 *
 * Every measurementType string stored in the `measurements` table or returned
 * by the AI analysis endpoint must appear here so the mobile app and API
 * server share a single source of truth for labels, units, and grouping.
 */

// ── Whole-roof linears ────────────────────────────────────────────────────────
export const INSPECTION_LINEAR_TYPES = [
  'ridge_lf',
  'hip_lf',
  'valley_lf',
  'eave_lf',
  'rake_lf',
] as const;
export type InspectionLinearType = (typeof INSPECTION_LINEAR_TYPES)[number];

// ── Whole-roof totals ─────────────────────────────────────────────────────────
export const INSPECTION_TOTAL_TYPES = [
  'total_area_sqft',
  'total_squares',
  'waste_factor_pct',
] as const;
export type InspectionTotalType = (typeof INSPECTION_TOTAL_TYPES)[number];

// ── Accessory / material take-offs ───────────────────────────────────────────
export const INSPECTION_ACCESSORY_TYPES = [
  'drip_edge_lf',
  'starter_lf',
  'step_flashing_lf',
  'counter_flashing_lf',
] as const;
export type InspectionAccessoryType = (typeof INSPECTION_ACCESSORY_TYPES)[number];

// ── Combined set for DB validation ───────────────────────────────────────────
export const ALL_INSPECTION_MEASUREMENT_TYPES = [
  ...INSPECTION_LINEAR_TYPES,
  ...INSPECTION_TOTAL_TYPES,
  ...INSPECTION_ACCESSORY_TYPES,
] as const;
export type InspectionMeasurementType = (typeof ALL_INSPECTION_MEASUREMENT_TYPES)[number];

// ── Display metadata (label, unit, section) ───────────────────────────────────
export interface MeasurementMeta {
  label: string;
  unit: string;
  section: 'Linears' | 'Totals' | 'Accessories';
}

export const MEASUREMENT_META: Record<InspectionMeasurementType, MeasurementMeta> = {
  // Linears
  ridge_lf:           { label: 'Ridge',           unit: 'lf',  section: 'Linears' },
  hip_lf:             { label: 'Hip',              unit: 'lf',  section: 'Linears' },
  valley_lf:          { label: 'Valley',           unit: 'lf',  section: 'Linears' },
  eave_lf:            { label: 'Eave',             unit: 'lf',  section: 'Linears' },
  rake_lf:            { label: 'Rake',             unit: 'lf',  section: 'Linears' },
  // Totals
  total_area_sqft:    { label: 'Total Area',       unit: 'sqft', section: 'Totals' },
  total_squares:      { label: 'Total Squares',    unit: 'sq',   section: 'Totals' },
  waste_factor_pct:   { label: 'Waste Factor',     unit: '%',    section: 'Totals' },
  // Accessories
  drip_edge_lf:       { label: 'Drip Edge',        unit: 'lf',  section: 'Accessories' },
  starter_lf:         { label: 'Starter Strip',    unit: 'lf',  section: 'Accessories' },
  step_flashing_lf:   { label: 'Step Flashing',    unit: 'lf',  section: 'Accessories' },
  counter_flashing_lf:{ label: 'Counter Flashing', unit: 'lf',  section: 'Accessories' },
};

// ── AI-parsed measurement payload shapes ─────────────────────────────────────
// These are the typed shapes returned by the analyze-measurements API and
// accepted by the apply-measurements API. Nullable fields mean Claude could
// not determine the value with confidence.

export interface ParsedSlope {
  label: string;
  areaSqft: number | null;
  pitchRise: number | null;
  pitchRun: number | null;
  materialType: string | null;
  /** 0–360° azimuth of the slope's downhill-facing direction, or null when the
   *  vendor report does not include per-facet bearing data. */
  compassBearing: number | null;
}

// ── Compass direction helpers ─────────────────────────────────────────────────

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/**
 * Convert a compass bearing (0–360°) to the nearest 8-point cardinal label.
 * Normalises values outside 0–360 and handles negatives gracefully.
 */
export function bearingToCardinal(deg: number): CompassPoint {
  const normalized = ((deg % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return COMPASS_POINTS[idx];
}

export interface ParsedSidingFacet {
  label: string;
  areaSqft: number | null;
}

export interface ParsedMeasurements {
  slopes: ParsedSlope[];
  linears: Partial<Record<InspectionLinearType, number | null>>;
  totals: Partial<Record<InspectionTotalType, number | null>>;
  accessories: Partial<Record<InspectionAccessoryType, number | null>>;
  sidingFacets: ParsedSidingFacet[];
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
}

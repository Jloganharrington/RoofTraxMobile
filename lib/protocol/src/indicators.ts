// Vocabulary of raw, inspector-observed conditions. These are recorded
// as-is (no scoring/derivation) and can drive soft-flag checks — e.g. an
// interior leak report should have a corresponding interior photo.
export const OBSERVED_INDICATORS = [
  'hail_hit',
  'wind_crease',
  'granule_loss',
  'mat_exposure',
  'soft_metal_dents',
  'interior_leak_reported',
  'prior_repair_patch',
] as const;
export type ObservedIndicator = (typeof OBSERVED_INDICATORS)[number];

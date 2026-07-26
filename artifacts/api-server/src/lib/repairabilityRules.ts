// Repairability question-flow validation (v2, 2026-07-26 spec).
//
// The flow is designed so the record is defensible: a user can never jump
// from "damage exists" straight to a replacement conclusion. The app only
// ever outputs one of four determinations, and each determination is gated
// by documented basis factors plus universal evidence rules. The mobile UI
// enforces these interactively; this module is the server-side authority so
// the gate cannot be bypassed by a raw API call.

import type { RepairabilityAssessment, RepairabilitySystemFlow } from '@workspace/db';

export type RepairabilitySystem = 'roof' | 'siding';

// ---------------------------------------------------------------------------
// Basis factor catalogs (RR-051 / SR-051), classified by evidence category:
//   direct  — direct repair-test evidence (Category A)
//   product — product / material evidence (Category B)
//   manufacturer — manufacturer guidance (Category B)
//   system  — system / access evidence (Category C)
//   incomplete — unresolved-evidence marker
// ---------------------------------------------------------------------------

export type FactorCategory = 'direct' | 'product' | 'manufacturer' | 'system' | 'incomplete';

export const ROOF_BASIS_FACTORS: Record<string, { label: string; category: FactorCategory }> = {
  same_product_available: { label: 'Same product available in sufficient quantity', category: 'product' },
  same_product_unavailable: { label: 'Same product unavailable in sufficient quantity', category: 'product' },
  substitute_compatible: { label: 'Substitute product physically compatible', category: 'product' },
  substitute_not_compatible: { label: 'Substitute product not physically compatible', category: 'product' },
  removal_no_adjacent_damage: { label: 'Controlled removal completed without adjacent damage', category: 'direct' },
  removal_caused_adjacent_damage: { label: 'Controlled removal caused adjacent damage', category: 'direct' },
  shingles_reset_securely: { label: 'Existing shingles reset securely', category: 'direct' },
  shingles_could_not_reset: { label: 'Existing shingles could not be reset securely', category: 'direct' },
  manufacturer_supports_repair: { label: 'Manufacturer guidance supports repair', category: 'manufacturer' },
  manufacturer_does_not_support_repair: { label: 'Manufacturer guidance does not support repair', category: 'manufacturer' },
  repair_requires_disturbance: { label: 'Repair requires disturbance of additional materials', category: 'system' },
  repair_within_damaged_area: { label: 'Repair can be completed without disturbance beyond damaged area', category: 'system' },
  evidence_incomplete: { label: 'Supporting evidence remains incomplete', category: 'incomplete' },
};

export const SIDING_BASIS_FACTORS: Record<string, { label: string; category: FactorCategory }> = {
  same_product_available: { label: 'Same product available in sufficient quantity', category: 'product' },
  same_product_unavailable: { label: 'Same product unavailable in sufficient quantity', category: 'product' },
  substitute_compatible: { label: 'Substitute product physically compatible', category: 'product' },
  substitute_not_compatible: { label: 'Substitute product not physically compatible', category: 'product' },
  panels_detached_without_damage: { label: 'Existing panels detached without damage', category: 'direct' },
  panels_cracked_during_test: { label: 'Existing panels cracked or deformed during testing', category: 'direct' },
  panels_reset_securely: { label: 'Existing panels reset securely', category: 'direct' },
  panels_could_not_reset: { label: 'Existing panels could not be reset securely', category: 'direct' },
  locks_engaged: { label: 'Existing and substitute locks engaged', category: 'direct' },
  locks_did_not_engage: { label: 'Existing and substitute locks did not engage', category: 'direct' },
  repair_requires_additional_panels: { label: 'Repair requires disturbance of additional panels', category: 'system' },
  repair_terminates_at_natural_break: { label: 'Repair can terminate at a documented natural break', category: 'system' },
  no_natural_break: { label: 'No documented natural break supports the proposed limited repair', category: 'system' },
  disturbs_wrb_flashing_trim: { label: 'Repair disturbs WRB, flashing, trim, or accessories', category: 'system' },
  evidence_incomplete: { label: 'Supporting evidence remains incomplete', category: 'incomplete' },
};

// Factors that represent an unresolved limitation (for "conditionally
// supported": at least one supporting factor PLUS one limitation).
const LIMITATION_FACTORS = new Set([
  'same_product_unavailable',
  'substitute_not_compatible',
  'removal_caused_adjacent_damage',
  'shingles_could_not_reset',
  'manufacturer_does_not_support_repair',
  'repair_requires_disturbance',
  'panels_cracked_during_test',
  'panels_could_not_reset',
  'locks_did_not_engage',
  'repair_requires_additional_panels',
  'no_natural_break',
  'disturbs_wrb_flashing_trim',
  'evidence_incomplete',
]);

export const DETERMINATION_LABELS: Record<string, string> = {
  supported: 'Spot repair supported by documented evidence',
  conditionally_supported: 'Spot repair conditionally supported',
  not_supported: 'Documented evidence does not support a reliable spot repair',
  indeterminate: 'Repairability cannot yet be determined',
};

const TEST_DERIVED_FACTORS = new Set([
  'removal_no_adjacent_damage',
  'removal_caused_adjacent_damage',
  'shingles_reset_securely',
  'shingles_could_not_reset',
  'panels_detached_without_damage',
  'panels_cracked_during_test',
  'panels_reset_securely',
  'panels_could_not_reset',
  'locks_engaged',
  'locks_did_not_engage',
]);

function answer(flow: RepairabilitySystemFlow, id: string): string | undefined {
  const v = flow.answers?.[id];
  return typeof v === 'string' ? v : undefined;
}
function multiAnswer(flow: RepairabilitySystemFlow, id: string): string[] {
  const v = flow.answers?.[id];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function hasEvidence(flow: RepairabilitySystemFlow): boolean {
  return (flow.evidencePhotoIds?.length ?? 0) > 0 || (flow.evidenceDocRefs?.length ?? 0) > 0;
}

/**
 * Validate one system's flow. Returns a list of human-readable violations
 * (empty = valid). Question-id prefixes differ (RR vs SR) but the structure
 * is shared.
 */
export function validateSystemFlow(system: RepairabilitySystem, flow: RepairabilitySystemFlow): string[] {
  const q = system === 'roof' ? 'RR' : 'SR';
  const catalog = system === 'roof' ? ROOF_BASIS_FACTORS : SIDING_BASIS_FACTORS;
  const errors: string[] = [];
  const label = system === 'roof' ? 'Roofing' : 'Siding';

  const factors = Array.isArray(flow.basisFactors) ? flow.basisFactors : [];
  const unknown = factors.filter((f) => !catalog[f]);
  if (unknown.length > 0) {
    errors.push(`${label}: unknown basis factor(s): ${unknown.join(', ')}`);
  }
  const known = factors.filter((f) => catalog[f]);
  const categories = new Set(known.map((f) => catalog[f].category));
  const testPerformed = answer(flow, `${q}-040`) === 'yes';
  const testMediaLinked = system === 'roof' ? answer(flow, 'RR-048') === 'yes' : hasEvidence(flow);

  // Required root questions for every flow.
  const damageDocumented = answer(flow, `${q}-001`);
  if (!damageDocumented) {
    errors.push(`${label}: ${q}-001 (is direct physical damage documented?) is required.`);
  }
  if (!answer(flow, `${q}-003`)) errors.push(`${label}: ${q}-003 (accessibility) is required.`);
  if (!answer(flow, `${q}-004`)) errors.push(`${label}: ${q}-004 (assessment type) is required.`);
  if (!answer(flow, `${q}-010`)) errors.push(`${label}: ${q}-010 (product identification) is required.`);
  if (!answer(flow, `${q}-012`)) errors.push(`${label}: ${q}-012 (discontinuation) is required.`);
  if (!answer(flow, `${q}-020`)) errors.push(`${label}: ${q}-020 (availability) is required.`);
  if (!answer(flow, `${q}-021`)) errors.push(`${label}: ${q}-021 (substitute identified) is required.`);
  if (!answer(flow, `${q}-040`)) errors.push(`${label}: ${q}-040 (controlled test) is required.`);
  if (!flow.nextStep?.trim()) errors.push(`${label}: next step (${q}-052) is required.`);
  if (known.length === 0) errors.push(`${label}: at least one documented basis factor (${q}-051) is required.`);

  // Damage documented = Yes requires affected facet(s)/elevation(s).
  if (damageDocumented === 'yes' && multiAnswer(flow, `${q}-002`).length === 0) {
    errors.push(`${label}: affected area selection (${q}-002) is required when damage is documented.`);
  }
  // Damage NOT documented forces "cannot yet be determined".
  if ((damageDocumented === 'no' || damageDocumented === 'unknown') && flow.determination !== 'indeterminate') {
    errors.push(
      `${label}: without documented direct physical damage the determination must be "Repairability cannot yet be determined".`,
    );
  }

  // Product identified requires supporting identification source + linked evidence.
  const productId = answer(flow, `${q}-010`);
  if (productId && productId !== 'not_identified') {
    if (multiAnswer(flow, `${q}-011`).length === 0) {
      errors.push(`${label}: product identification requires at least one supporting source (${q}-011).`);
    }
    if (!hasEvidence(flow)) {
      errors.push(`${label}: product identification requires linked photo, sample, or document evidence.`);
    }
  }

  // Discontinuation confirmed requires linked discontinuation evidence.
  const discontinued = answer(flow, `${q}-012`);
  if (discontinued === 'manufacturer_confirmed' || discontinued === 'distributor_confirmed') {
    if (multiAnswer(flow, `${q}-012A`).length === 0 || !hasEvidence(flow)) {
      errors.push(
        `${label}: confirmed discontinuation requires linked manufacturer/distributor evidence (${q}-012A).`,
      );
    }
  }

  // "Not sourceable" requires a documented supplier/manufacturer search.
  const availability = answer(flow, `${q}-020`);
  if (availability === 'no_sufficient_quantity' && multiAnswer(flow, `${q}-020A`).length === 0) {
    errors.push(`${label}: "no sufficient quantity located" requires the documented sources searched (${q}-020A).`);
  }
  if (factors.includes('same_product_unavailable') && availability !== 'no_sufficient_quantity') {
    errors.push(
      `${label}: "same product unavailable" basis factor requires a documented search finding no sufficient quantity (${q}-020).`,
    );
  }

  // Substitute-comparison differences require linked evidence.
  if (multiAnswer(flow, `${q}-021B`).length > 0 && !hasEvidence(flow)) {
    errors.push(`${label}: documented substitute differences (${q}-021B) require linked photo/measurement/document evidence.`);
  }

  // Test-derived basis factors require a controlled test with linked media.
  const testFactorsUsed = known.filter((f) => TEST_DERIVED_FACTORS.has(f));
  if (testFactorsUsed.length > 0) {
    if (!testPerformed) {
      errors.push(`${label}: test-derived basis factors require a controlled repairability test (${q}-040 = Yes).`);
    } else if (!testMediaLinked || !hasEvidence(flow)) {
      errors.push(`${label}: a controlled test cannot support the determination unless test photos/video are linked.`);
    }
  }

  // "Could not reset" additionally allows a documented manufacturer limitation
  // in place of a test — but never bare assertion.
  const couldNotReset = factors.includes('shingles_could_not_reset') || factors.includes('panels_could_not_reset');
  if (couldNotReset) {
    const mfr = answer(flow, `${q}-032`);
    const mfrLimitation = mfr === 'does_not_support' && hasEvidence(flow);
    if (!(testPerformed && testMediaLinked && hasEvidence(flow)) && !mfrLimitation) {
      errors.push(
        `${label}: "could not be reset" requires a linked test record or documented manufacturer limitation.`,
      );
    }
  }

  // Manufacturer guidance factors require the method question + document.
  if (factors.includes('manufacturer_supports_repair') || factors.includes('manufacturer_does_not_support_repair')) {
    const mfr = answer(flow, `${q}-032`);
    if ((mfr !== 'supports' && mfr !== 'does_not_support') || !hasEvidence(flow)) {
      errors.push(`${label}: manufacturer-guidance basis factors require a reviewed method (${q}-032) with a linked document reference.`);
    }
  }

  // "Same product available" must reflect a documented sufficient-quantity
  // finding, and substitute-compatibility factors require a completed
  // physical comparison — not an assertion.
  if (factors.includes('same_product_available') && availability !== 'sufficient_quantity') {
    errors.push(
      `${label}: "same product available" basis factor requires a documented sufficient-quantity finding (${q}-020).`,
    );
  }
  if (factors.includes('substitute_compatible') || factors.includes('substitute_not_compatible')) {
    if (answer(flow, `${q}-021A`) !== 'yes') {
      errors.push(
        `${label}: substitute-compatibility basis factors require a completed physical comparison (${q}-021A = Yes).`,
      );
    }
  }

  // Universal evidence rule: any determination other than "cannot yet be
  // determined" rests on conclusion-supporting answers, which must carry
  // linked photo/measurement/sample/document/test evidence.
  if (flow.determination && flow.determination !== 'indeterminate' && !hasEvidence(flow)) {
    errors.push(`${label}: a conclusive determination requires linked photo or document evidence.`);
  }

  // Access limitations alone can never support "not supported".
  // (Enforced structurally: access answers are not basis factors.)

  // Determination validation table.
  const direct = known.some((f) => catalog[f].category === 'direct');
  const product = known.some((f) => catalog[f].category === 'product');
  const manufacturer = known.some((f) => catalog[f].category === 'manufacturer');
  const supporting = known.some((f) => catalog[f].category !== 'incomplete');
  const limitation = known.some((f) => LIMITATION_FACTORS.has(f));
  const incomplete = known.includes('evidence_incomplete');

  switch (flow.determination) {
    case 'supported':
      if (!(direct || product || manufacturer)) {
        errors.push(`${label}: "spot repair supported" requires at least one direct-test, product, or manufacturer basis factor.`);
      }
      break;
    case 'conditionally_supported':
      if (!supporting || !limitation) {
        errors.push(`${label}: "conditionally supported" requires at least one supporting factor plus one unresolved limitation.`);
      }
      break;
    case 'not_supported': {
      const directOrProduct = known.filter((f) => catalog[f].category === 'direct' || catalog[f].category === 'product');
      if (known.length < 2 || directOrProduct.length === 0) {
        errors.push(
          `${label}: "does not support a reliable spot repair" requires at least two basis factors, including one direct-test or product-evidence factor.`,
        );
      }
      break;
    }
    case 'indeterminate':
      if (!incomplete) {
        errors.push(`${label}: "cannot yet be determined" requires the "supporting evidence remains incomplete" basis factor.`);
      }
      break;
    default:
      errors.push(`${label}: a determination is required.`);
  }

  // Unsupported categories can never appear (Set of allowed values enforced by
  // the API schema enum), so "full replacement required" is unrepresentable.

  return errors;
}

/** Validate the whole assessment; returns violations (empty = valid). */
export function validateRepairabilityAssessment(ra: RepairabilityAssessment): string[] {
  const errors: string[] = [];
  const systems = Array.isArray(ra.systems) ? ra.systems : [];
  if (systems.length === 0) errors.push('At least one system (roof or siding) must be selected.');
  for (const system of ['roof', 'siding'] as const) {
    const selected = systems.includes(system);
    const flow = ra[system];
    if (selected && !flow) {
      errors.push(`${system === 'roof' ? 'Roofing' : 'Siding'}: flow must be completed for the selected system.`);
    }
    if (!selected && flow) {
      errors.push(`${system === 'roof' ? 'Roofing' : 'Siding'}: flow present but system not selected — one system's evidence cannot populate the other's determination.`);
    }
    if (selected && flow) errors.push(...validateSystemFlow(system, flow));
  }
  return errors;
}

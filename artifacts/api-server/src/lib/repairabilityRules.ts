// Repairability question-flow validation (v2, 2026-07-26 spec).
//
// The flow is designed so the record is defensible: a user can never jump
// from "damage exists" straight to a replacement conclusion. The app only
// ever outputs one of four determinations, and each determination is gated
// by documented basis factors plus universal evidence rules. The mobile UI
// enforces these interactively; this module is the server-side authority so
// the gate cannot be bypassed by a raw API call.

import type {
  RepairabilityAssessment,
  RepairabilityAssessmentV3,
  RepairabilitySystemFlow,
  RepairAttemptProtocol,
  RapDamageCategoryKey,
  VinylAssessmentProtocol,
  VapDamageCategoryKey,
  AluminumSidingProtocol,
  AspConditionKey,
} from '@workspace/db';

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

// ---------------------------------------------------------------------------
// Roof-material catalogs (roof flows branch by material; cedar CS-051 and
// standing seam SM-051 keep their own factor vocabularies — shingle-specific
// terminology is never reused for cedar or standing seam systems).
// ---------------------------------------------------------------------------

export type RepairabilityRoofMaterial = 'asphalt_shingle' | 'cedar_shake' | 'standing_seam_metal';

export const ROOF_MATERIAL_LABELS: Record<RepairabilityRoofMaterial, string> = {
  asphalt_shingle: 'Asphalt Shingle',
  cedar_shake: 'Cedar Shake',
  standing_seam_metal: 'Standing Seam Metal',
};

export const CEDAR_BASIS_FACTORS: Record<string, { label: string; category: FactorCategory }> = {
  matching_cedar_available: { label: 'Matching cedar material available in sufficient quantity', category: 'product' },
  matching_cedar_unavailable: { label: 'Matching cedar material unavailable in sufficient quantity', category: 'product' },
  proposed_shake_compatible: { label: 'Proposed shake is compatible with existing shake system', category: 'product' },
  proposed_shake_not_compatible: { label: 'Proposed shake is not compatible with existing shake system', category: 'product' },
  adjacent_shakes_removed_without_damage: { label: 'Adjacent shakes removed without damage', category: 'direct' },
  adjacent_shakes_damaged_during_test: { label: 'Adjacent shakes split, cracked, or broke during testing', category: 'direct' },
  shakes_reset_securely: { label: 'Existing shakes reset securely', category: 'direct' },
  shakes_could_not_reset: { label: 'Existing shakes could not be reset securely', category: 'direct' },
  replacement_shake_fit: { label: 'Replacement shake fit existing course and overlap geometry', category: 'direct' },
  replacement_shake_did_not_fit: { label: 'Replacement shake did not fit existing course and overlap geometry', category: 'direct' },
  repair_disturbs_interlayment_deck: { label: 'Repair disturbs interlayment, underlayment, or deck components', category: 'system' },
  guidance_supports_repair: { label: 'Manufacturer or technical guidance supports repair', category: 'manufacturer' },
  guidance_does_not_support_repair: { label: 'Manufacturer or technical guidance does not support repair', category: 'manufacturer' },
  evidence_incomplete: { label: 'Supporting evidence remains incomplete', category: 'incomplete' },
};

export const METAL_BASIS_FACTORS: Record<string, { label: string; category: FactorCategory }> = {
  matching_panel_available: { label: 'Matching panel system available in sufficient quantity', category: 'product' },
  matching_panel_unavailable: { label: 'Matching panel system unavailable in sufficient quantity', category: 'product' },
  replacement_panel_compatible: { label: 'Proposed replacement panel is compatible', category: 'product' },
  replacement_panel_not_compatible: { label: 'Proposed replacement panel is not compatible', category: 'product' },
  seam_released_without_deformation: { label: 'Panel seam released without deformation', category: 'direct' },
  adjacent_seam_deformed_during_test: { label: 'Adjacent seam or panel deformed during testing', category: 'direct' },
  panels_reseamed_securely: { label: 'Existing panels could be reseamed securely', category: 'direct' },
  panels_could_not_reseam: { label: 'Existing panels could not be reseamed securely', category: 'direct' },
  replacement_panel_integrated: { label: 'Replacement panel integrated with existing system', category: 'direct' },
  replacement_panel_did_not_integrate: { label: 'Replacement panel did not integrate with existing system', category: 'direct' },
  repair_disturbs_attachment_or_flashing: { label: 'Repair requires disturbance of clips, fasteners, underlayment, or flashing', category: 'system' },
  manufacturer_supports_repair: { label: 'Manufacturer guidance supports repair', category: 'manufacturer' },
  manufacturer_does_not_support_repair: { label: 'Manufacturer guidance does not support repair', category: 'manufacturer' },
  evidence_incomplete: { label: 'Supporting evidence remains incomplete', category: 'incomplete' },
};

/** v3 gate-question labels — matches the rebuilt mobile screen's options. */
export const RAP_WARRANTED_LABELS: Record<string, string> = {
  yes: 'Yes',
  not_warranted_discontinued: 'Not Warranted - Discontinued',
  not_authorized: 'Not Authorized',
};

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
 * (empty = valid). Roof flows branch by roofing material: asphalt shingle
 * keeps the original RR-xxx flow; cedar shake (CS-xxx) and standing seam
 * metal (SM-xxx) have their own question sets, factor vocabularies, and
 * repair logic — shingle terminology is never reused for them. A roof flow
 * without roofMaterial predates material branching and is asphalt.
 */
export function validateSystemFlow(system: RepairabilitySystem, flow: RepairabilitySystemFlow): string[] {
  if (system === 'roof') {
    const material = (flow.roofMaterial ?? 'asphalt_shingle') as RepairabilityRoofMaterial;
    if (!ROOF_MATERIAL_LABELS[material]) {
      return [`Roofing: unknown roofing material "${String(flow.roofMaterial)}".`];
    }
    if (material === 'cedar_shake') return validateMaterialFlow(CEDAR_CONFIG, flow);
    if (material === 'standing_seam_metal') return validateMaterialFlow(METAL_CONFIG, flow);
    return validateShingleOrSidingFlow('roof', flow);
  }
  const errors = flow.roofMaterial
    ? ['Siding: roofMaterial does not apply to the siding flow.']
    : [];
  return [...errors, ...validateShingleOrSidingFlow('siding', flow)];
}

function validateShingleOrSidingFlow(system: RepairabilitySystem, flow: RepairabilitySystemFlow): string[] {
  const q = system === 'roof' ? 'RR' : 'SR';
  const catalog = system === 'roof' ? ROOF_BASIS_FACTORS : SIDING_BASIS_FACTORS;
  const errors: string[] = [];
  const label = system === 'roof' ? 'Asphalt Shingle' : 'Siding';

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
  // RR-020 (availability search) is not asked when discontinuation is already
  // confirmed by the manufacturer or distributor (roof flow only).
  const discAnswer = answer(flow, `${q}-012`);
  const discConfirmed = discAnswer === 'manufacturer_confirmed' || discAnswer === 'distributor_confirmed';
  if (!answer(flow, `${q}-020`) && !(system === 'roof' && discConfirmed)) {
    errors.push(`${label}: ${q}-020 (availability) is required.`);
  }
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

  // Product identified requires linked evidence. Siding also requires a
  // supporting identification source (SR-011); on the roof flow RR-011 IS
  // the Known Product Catalog selection (see below).
  const productId = answer(flow, `${q}-010`);
  if (productId && productId !== 'not_identified') {
    if (system === 'siding' && multiAnswer(flow, `${q}-011`).length === 0) {
      errors.push(`${label}: product identification requires at least one supporting source (${q}-011).`);
    }
    if (!hasEvidence(flow)) {
      errors.push(`${label}: product identification requires linked photo, sample, or document evidence.`);
    }
  }
  // Known Product Catalog match (roof only). RR-010 = catalog_match requires
  // the picked product (RR-011); a product match with any other answer is
  // inconsistent. Legacy records use 'exact', which stays valid.
  if (system === 'roof') {
    if (productId === 'catalog_match' && !flow.productMatch?.productId) {
      errors.push(`${label}: a Known Product Catalog match requires the probable product selection (RR-011).`);
    }
    if (flow.productMatch && productId !== 'catalog_match') {
      errors.push(`${label}: a probable product match (RR-011) only applies when RR-010 is a catalog match.`);
    }
  } else if (flow.productMatch) {
    errors.push(`${label}: productMatch does not apply to siding flows.`);
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

// ---------------------------------------------------------------------------
// Cedar shake (CS) and standing seam metal (SM) flows share a structure but
// keep their own question ids, vocabularies, and factor catalogs. Config-
// driven so the shared validation rules are enforced identically.
// ---------------------------------------------------------------------------

interface MaterialFlowConfig {
  prefix: 'CS' | 'SM';
  label: string;
  catalog: Record<string, { label: string; category: FactorCategory }>;
  /** Question-id suffixes that must always be answered. */
  requiredRoot: string[];
  /** Multi-select id suffixes required when the product/system is identified. */
  identificationSupport: string[];
  /** The manufacturer/technical-guidance method question suffix. */
  guidanceQ: string;
  availableFactor: string;
  unavailableFactor: string;
  compatibleFactor: string;
  notCompatibleFactor: string;
  couldNotResetFactor: string;
}

const CEDAR_CONFIG: MaterialFlowConfig = {
  prefix: 'CS',
  label: 'Cedar Shake',
  catalog: CEDAR_BASIS_FACTORS,
  requiredRoot: ['001', '004', '010', '020', '021', '022', '030', '031', '032', '033', '040'],
  identificationSupport: ['011', '013'],
  guidanceQ: '033',
  availableFactor: 'matching_cedar_available',
  unavailableFactor: 'matching_cedar_unavailable',
  compatibleFactor: 'proposed_shake_compatible',
  notCompatibleFactor: 'proposed_shake_not_compatible',
  couldNotResetFactor: 'shakes_could_not_reset',
};

const METAL_CONFIG: MaterialFlowConfig = {
  prefix: 'SM',
  label: 'Standing Seam Metal',
  catalog: METAL_BASIS_FACTORS,
  requiredRoot: ['001', '004', '010', '020', '021', '022', '030', '031', '032', '033', '034', '040'],
  identificationSupport: ['011', '012'],
  guidanceQ: '034',
  availableFactor: 'matching_panel_available',
  unavailableFactor: 'matching_panel_unavailable',
  compatibleFactor: 'replacement_panel_compatible',
  notCompatibleFactor: 'replacement_panel_not_compatible',
  couldNotResetFactor: 'panels_could_not_reseam',
};

function validateMaterialFlow(cfg: MaterialFlowConfig, flow: RepairabilitySystemFlow): string[] {
  const { prefix: q, label, catalog } = cfg;
  const errors: string[] = [];

  const factors = Array.isArray(flow.basisFactors) ? flow.basisFactors : [];
  const unknown = factors.filter((f) => !catalog[f]);
  if (unknown.length > 0) errors.push(`${label}: unknown basis factor(s): ${unknown.join(', ')}`);
  const known = factors.filter((f) => catalog[f]);
  const evidence = hasEvidence(flow);
  const testPerformed = answer(flow, `${q}-040`) === 'yes';

  // The Known Product Catalog (RR-010A) is asphalt-shingle-only.
  if (flow.productMatch) {
    errors.push(`${label}: a Known Product Catalog match does not apply to this material's flow.`);
  }
  for (const suffix of cfg.requiredRoot) {
    if (!answer(flow, `${q}-${suffix}`)) errors.push(`${label}: ${q}-${suffix} is required.`);
  }
  if (!flow.nextStep?.trim()) errors.push(`${label}: next step (${q}-052) is required.`);
  if (known.length === 0) errors.push(`${label}: at least one documented basis factor (${q}-051) is required.`);

  // Damage documented = Yes requires affected area(s); documented damage
  // conditions require linked photo evidence. No documented damage forces
  // "cannot yet be determined".
  const damage = answer(flow, `${q}-001`);
  if (damage === 'yes' && multiAnswer(flow, `${q}-002`).length === 0) {
    errors.push(`${label}: affected area selection (${q}-002) is required when damage is documented.`);
  }
  if (multiAnswer(flow, `${q}-003`).length > 0 && !evidence) {
    errors.push(`${label}: documented damage conditions (${q}-003) require linked photo evidence.`);
  }
  if ((damage === 'no' || damage === 'unknown') && flow.determination !== 'indeterminate') {
    errors.push(
      `${label}: without documented direct physical damage the determination must be "Repairability cannot yet be determined".`,
    );
  }

  // Identification requires supporting sources + linked evidence.
  const productId = answer(flow, `${q}-010`);
  if (productId && productId !== 'not_identified') {
    for (const suffix of cfg.identificationSupport) {
      if (multiAnswer(flow, `${q}-${suffix}`).length === 0) {
        errors.push(`${label}: identification requires ${q}-${suffix} when the product/system is identified.`);
      }
    }
    if (!evidence) errors.push(`${label}: identification requires linked photo, sample, or document evidence.`);
  }

  // Confirmed discontinuation requires manufacturer/distributor evidence.
  const discontinued = answer(flow, `${q}-020`);
  if ((discontinued === 'manufacturer_confirmed' || discontinued === 'distributor_confirmed') && !evidence) {
    errors.push(`${label}: confirmed discontinuation requires linked manufacturer/distributor evidence.`);
  }

  // "No sufficient quantity located" requires a documented availability search.
  const availability = answer(flow, `${q}-021`);
  if (availability === 'no_sufficient_quantity' && !evidence) {
    errors.push(`${label}: "no sufficient quantity located" requires documented availability-search evidence.`);
  }
  if (factors.includes(cfg.unavailableFactor) && availability !== 'no_sufficient_quantity') {
    errors.push(`${label}: the unavailable-material basis factor requires a documented search finding no sufficient quantity (${q}-021).`);
  }
  if (factors.includes(cfg.availableFactor) && availability !== 'sufficient_quantity') {
    errors.push(`${label}: the available-material basis factor requires a documented sufficient-quantity finding (${q}-021).`);
  }

  // Substitute-compatibility factors require a completed documented comparison;
  // documented differences require linked comparison evidence.
  if (multiAnswer(flow, `${q}-022B`).length > 0 && !evidence) {
    errors.push(`${label}: documented substitute differences (${q}-022B) require linked comparison evidence.`);
  }
  if (
    (factors.includes(cfg.compatibleFactor) || factors.includes(cfg.notCompatibleFactor)) &&
    answer(flow, `${q}-022A`) !== 'yes'
  ) {
    errors.push(`${label}: substitute-compatibility basis factors require a completed documented comparison (${q}-022A = Yes).`);
  }

  // Test-derived factors require a controlled test with linked photos/video.
  const testFactorsUsed = known.filter((f) => catalog[f].category === 'direct');
  if (testFactorsUsed.length > 0) {
    if (!testPerformed) {
      errors.push(`${label}: test-derived basis factors require a controlled test (${q}-040 = Yes).`);
    } else if (!evidence) {
      errors.push(`${label}: a controlled test cannot support the determination unless test photos or video are linked.`);
    }
  }

  // "Could not reset/reseam" requires a test record or documented
  // manufacturer/technical limitation — never bare assertion.
  if (factors.includes(cfg.couldNotResetFactor)) {
    const guidance = answer(flow, `${q}-${cfg.guidanceQ}`);
    const guidanceLimitation = guidance === 'does_not_support' && evidence;
    if (!(testPerformed && evidence) && !guidanceLimitation) {
      errors.push(`${label}: "could not be reset/reseamed securely" requires a linked test record or documented manufacturer limitation.`);
    }
  }

  // Manufacturer/technical guidance factors require a reviewed method + document.
  if (known.some((f) => catalog[f].category === 'manufacturer')) {
    const guidance = answer(flow, `${q}-${cfg.guidanceQ}`);
    if ((guidance !== 'supports' && guidance !== 'does_not_support') || !evidence) {
      errors.push(`${label}: guidance basis factors require a reviewed repair method (${q}-${cfg.guidanceQ}) with a linked document reference.`);
    }
  }

  // Universal: a conclusive determination requires linked evidence.
  if (flow.determination && flow.determination !== 'indeterminate' && !evidence) {
    errors.push(`${label}: a conclusive determination requires linked photo or document evidence.`);
  }

  // Temporary weather protection is only recordable when emergency
  // mitigation was selected OR a controlled test created an exposed /
  // non-weather-resistant condition — and is required in the exposed case.
  const emergency = answer(flow, `${q}-040`) === 'no_emergency';
  const testExposed = testPerformed && answer(flow, `${q}-046`) === 'yes';
  const tempProtectionAnswered =
    answer(flow, `${q}-046A`) !== undefined || multiAnswer(flow, `${q}-046B`).length > 0;
  if (tempProtectionAnswered && !emergency && !testExposed) {
    errors.push(
      `${label}: temporary weather protection (${q}-046A/B) only applies when emergency mitigation was required or a controlled test created an exposed condition.`,
    );
  }
  if (testExposed && !answer(flow, `${q}-046A`)) {
    errors.push(`${label}: an exposed test condition requires the temporary-protection answer (${q}-046A).`);
  }

  // Determination validation table (same universal gates as all systems).
  const direct = known.some((f) => catalog[f].category === 'direct');
  const product = known.some((f) => catalog[f].category === 'product');
  const manufacturer = known.some((f) => catalog[f].category === 'manufacturer');
  const supporting = known.some((f) => catalog[f].category !== 'incomplete');
  const limitation = known.some(
    (f) =>
      f === cfg.unavailableFactor ||
      f === cfg.notCompatibleFactor ||
      f === cfg.couldNotResetFactor ||
      catalog[f].category === 'incomplete' ||
      catalog[f].category === 'system' ||
      catalog[f].label.toLowerCase().includes('not ') ||
      catalog[f].label.toLowerCase().includes('deformed') ||
      catalog[f].label.toLowerCase().includes('damaged') ||
      catalog[f].label.toLowerCase().includes('broke'),
  );
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
      if (!known.includes('evidence_incomplete')) {
        errors.push(`${label}: "cannot yet be determined" requires the "supporting evidence remains incomplete" basis factor.`);
      }
      break;
    default:
      errors.push(`${label}: a determination is required.`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// v3 — Repair Attempt Protocol (RAP) flow, 2026-07-28 rebuilt screen.
// Philosophy differs from v2: partial protocol runs are SAVABLE (a rep must
// never lose field answers because a question is still open), so validation
// enforces internal consistency only — never completeness. The scorecard and
// report render whatever was answered.
// ---------------------------------------------------------------------------

const RAP_CATEGORY_KEYS: RapDamageCategoryKey[] = [
  'delamination',
  'creasing',
  'nailZone',
  'puncture',
  'reseat',
];

function validateRap(rap: RepairAttemptProtocol): string[] {
  const errors: string[] = [];
  const count = rap.manipulatedCount;
  if (count != null && count !== 6 && count !== 7 && count !== 8) {
    errors.push('RAP: manipulated-shingle count must be 6, 7, or 8.');
  }
  const maxShingle = count ?? 8;
  const damage = rap.damage ?? {};
  for (const key of Object.keys(damage)) {
    if (!RAP_CATEGORY_KEYS.includes(key as RapDamageCategoryKey)) {
      errors.push(`RAP: unknown damage category "${key}".`);
      continue;
    }
    const finding = damage[key as RapDamageCategoryKey];
    if (!finding) continue;
    const shingles = Array.isArray(finding.shingles) ? finding.shingles : [];
    if (finding.answer === 'yes' && shingles.length === 0) {
      errors.push(`RAP: ${key} answered Yes requires at least one affected shingle.`);
    }
    if (finding.answer === 'no' && shingles.length > 0) {
      errors.push(`RAP: ${key} answered No cannot carry affected shingles.`);
    }
    const invalid = shingles.filter(
      (s) => !Number.isInteger(s) || s < 3 || s > maxShingle,
    );
    if (invalid.length > 0) {
      errors.push(
        `RAP: ${key} affected shingles must be between 3 and ${maxShingle} (the manipulated count); got ${invalid.join(', ')}.`,
      );
    }
    if (new Set(shingles).size !== shingles.length) {
      errors.push(`RAP: ${key} affected shingles must be unique.`);
    }
  }
  return errors;
}

const VAP_CATEGORY_KEYS: VapDamageCategoryKey[] = [
  'crackSplit',
  'lockingEdge',
  'nailHem',
  'trimInterface',
  'reseat',
];

/** Valid manipulated-component labels: panels 1-4, trim T1-T4. */
const VAP_COMPONENT_RE = /^(?:[1-4]|T[1-4])$/;

function validateVap(vap: VinylAssessmentProtocol): string[] {
  const errors: string[] = [];
  const panels = vap.panelsManipulated;
  if (panels != null && (!Number.isInteger(panels) || panels < 2 || panels > 6)) {
    errors.push('VAP: manipulated-panel count must be between 2 and 6.');
  }
  const trim = vap.trimManipulated;
  if (trim != null && (!Number.isInteger(trim) || trim < 0 || trim > 4)) {
    errors.push('VAP: manipulated trim/interface component count must be between 0 and 4.');
  }
  const damage = vap.damage ?? {};
  for (const key of Object.keys(damage)) {
    if (!VAP_CATEGORY_KEYS.includes(key as VapDamageCategoryKey)) {
      errors.push(`VAP: unknown damage category "${key}".`);
      continue;
    }
    const finding = damage[key as VapDamageCategoryKey];
    if (!finding) continue;
    const components = Array.isArray(finding.components) ? finding.components : [];
    if (finding.answer === 'yes' && components.length === 0) {
      errors.push(`VAP: ${key} answered Yes requires at least one affected component.`);
    }
    if (finding.answer === 'no' && components.length > 0) {
      errors.push(`VAP: ${key} answered No cannot carry affected components.`);
    }
    const invalid = components.filter((c) => typeof c !== 'string' || !VAP_COMPONENT_RE.test(c));
    if (invalid.length > 0) {
      errors.push(
        `VAP: ${key} affected components must be panels 1-4 or trim T1-T4; got ${invalid.join(', ')}.`,
      );
    }
    if (new Set(components).size !== components.length) {
      errors.push(`VAP: ${key} affected components must be unique.`);
    }
  }
  return errors;
}

/**
 * Validate a v3 (Repair Attempt Protocol) assessment. Returns violations
 * (empty = valid). Structural gates: the systems selection only exists when
 * the assessment is warranted and authorized, and a RAP record only exists
 * for an asphalt-shingle roof.
 */
export function validateRepairabilityAssessmentV3(ra: RepairabilityAssessmentV3): string[] {
  const errors: string[] = [];
  const systems = Array.isArray(ra.systems) ? ra.systems : [];

  if (ra.warranted !== 'yes') {
    if (systems.length > 0) {
      errors.push('Systems can only be assessed when the assessment is warranted and authorized.');
    }
    if (ra.roofType) {
      errors.push('Roof type only applies when the assessment is warranted and authorized.');
    }
    if (ra.rap) {
      errors.push('A Repair Attempt Protocol record only applies when the assessment is warranted and authorized.');
    }
    if (ra.sidingType) {
      errors.push('Siding type only applies when the assessment is warranted and authorized.');
    }
    if (ra.vap) {
      errors.push('A Vinyl Assessment Protocol record only applies when the assessment is warranted and authorized.');
    }
    if (ra.asp) {
      errors.push('An Aluminum Siding Forensic Inspection Protocol record only applies when the assessment is warranted and authorized.');
    }
    return errors;
  }

  if (systems.length === 0) {
    errors.push('At least one system (roof or siding) must be selected when the assessment is warranted.');
  }
  if (ra.roofType && !systems.includes('roof')) {
    errors.push('Roof type only applies when the roof system is selected.');
  }
  if (ra.rap) {
    if (!systems.includes('roof') || ra.roofType !== 'asphalt_shingle') {
      errors.push('The Repair Attempt Protocol only applies to asphalt-shingle roof assessments.');
    }
    errors.push(...validateRap(ra.rap));
  }
  if (ra.sidingType && !systems.includes('siding')) {
    errors.push('Siding type only applies when the siding system is selected.');
  }
  if (ra.vap) {
    if (!systems.includes('siding') || ra.sidingType !== 'vinyl') {
      errors.push('The Vinyl Assessment Protocol only applies to vinyl siding assessments.');
    }
    errors.push(...validateVap(ra.vap));
  }
  if (ra.asp) {
    if (!systems.includes('siding') || ra.sidingType !== 'aluminum') {
      errors.push('The Aluminum Siding Forensic Inspection Protocol only applies to aluminum siding assessments.');
    }
    errors.push(...validateAsp(ra.asp));
  }
  return errors;
}

const ASP_CONDITION_KEYS: AspConditionKey[] = [
  'impactDeformation', 'coatingBreach', 'substrateExposure', 'nailHemCondition',
  'interlockDisplacement', 'chalking', 'finishVariance', 'priorRepair',
  'coatingAdhesion', 'collateralSoftMetal',
];

/** Internal-consistency checks for an ASP record. The assessment remains
 * saveable when incomplete; only contradictions and unsafe data are rejected. */
export function validateAsp(asp: AluminumSidingProtocol): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const elevation of asp.elevations ?? []) {
    const key = `${elevation.elevation}:${elevation.elevation === 'other' ? elevation.label?.trim() ?? '' : ''}`;
    if (seen.has(key)) errors.push(`Duplicate ASP elevation: ${key}.`);
    seen.add(key);
    if (!elevation.accessible && !elevation.inaccessibleReason?.trim()) {
      errors.push(`An inaccessible ${elevation.elevation} elevation requires an access reason.`);
    }
  }
  const knownElevations = new Set((asp.elevations ?? []).map((e) => e.elevation));
  for (const square of asp.testSquares ?? []) {
    if (!Number.isInteger(square.impactCount) || square.impactCount < 0) {
      errors.push('ASP test-square impact counts must be non-negative integers.');
    }
    if (!knownElevations.has(square.elevation)) {
      errors.push(`ASP test square references an unsurveyed elevation: ${square.elevation}.`);
    }
  }
  for (const key of ASP_CONDITION_KEYS) {
    const finding = asp.findings?.[key];
    if (!finding) continue;
    if (!Array.isArray(finding.elevations)) {
      errors.push(`ASP ${key} elevations must be an array.`);
      continue;
    }
    if (finding.answer === 'yes' && finding.elevations.length === 0) {
      errors.push(`ASP ${key} needs at least one affected elevation when answered yes.`);
    }
    if (finding.answer === 'no' && finding.elevations.length > 0) {
      errors.push(`ASP ${key} cannot carry affected elevations when answered no.`);
    }
    for (const elevation of finding.elevations) {
      if (!knownElevations.has(elevation)) errors.push(`ASP ${key} references an unsurveyed elevation: ${elevation}.`);
    }
  }
  if (asp.conclusion && !asp.conclusionBasis?.trim()) {
    errors.push('ASP conclusion basis is required when a conclusion is selected.');
  }
  if (asp.vintage?.preNineteenNinety === 'yes' && !asp.vintage.basis?.trim()) {
    errors.push('ASP pre-1990 vintage requires a documented basis.');
  }
  if (asp.conclusion === 'repair_not_supported_product') {
    if (asp.vintage?.preNineteenNinety !== 'yes' || !asp.vintage.basis?.trim()) {
      errors.push(
        'ASP product non-repairability requires a documented pre-1990 vintage observation and basis.',
      );
    }
    if (!asp.lockBehaviorBasis?.trim() && asp.findings?.interlockDisplacement?.answer !== 'yes') {
      errors.push(
        'ASP product non-repairability requires a documented lock-condition basis or an affirmative interlock-displacement finding.',
      );
    }
  }
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

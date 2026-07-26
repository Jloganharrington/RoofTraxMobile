import { describe, expect, it } from 'vitest';

import type { RepairabilityAssessment, RepairabilitySystemFlow } from '@workspace/db';

import { validateRepairabilityAssessment, validateSystemFlow } from '../repairabilityRules';

// A complete, valid roofing flow: documented damage, identified product with
// evidence, documented availability search, controlled test with linked
// media, and a determination supported by direct-test factors.
function validRoofFlow(overrides: Partial<RepairabilitySystemFlow> = {}): RepairabilitySystemFlow {
  return {
    answers: {
      'RR-001': 'yes',
      'RR-002': ['facet:F1'],
      'RR-003': 'yes',
      'RR-004': 'controlled_test',
      'RR-010': 'exact',
      'RR-011': ['rear_stamp'],
      'RR-012': 'no',
      'RR-020': 'no_sufficient_quantity',
      'RR-020A': ['manufacturer', 'local_distributor'],
      'RR-021': 'no',
      'RR-030': 'yes',
      'RR-031': 'no',
      'RR-040': 'yes',
      'RR-041': 'yes',
      'RR-043': 'yes',
      'RR-044': 'no',
      'RR-048': 'yes',
      ...overrides.answers,
    },
    determination: 'not_supported',
    basisFactors: ['removal_caused_adjacent_damage', 'shingles_could_not_reset', 'same_product_unavailable'],
    nextStep: 'prepare_summary',
    evidencePhotoIds: ['photo-1'],
    evidenceDocRefs: [],
    ...overrides,
  };
}

const assessment = (roof: RepairabilitySystemFlow): RepairabilityAssessment => ({
  version: 2,
  systems: ['roof'],
  roof,
  recordedAtUtc: new Date('2026-07-26T00:00:00Z').toISOString(),
});

describe('validateSystemFlow — valid flows pass', () => {
  it('accepts a fully documented not-supported determination', () => {
    expect(validateSystemFlow('roof', validRoofFlow())).toEqual([]);
  });

  it('accepts an indeterminate determination with the incomplete factor', () => {
    const flow = validRoofFlow({
      answers: { 'RR-001': 'no', 'RR-040': 'no_not_needed', 'RR-020': 'search_not_performed', 'RR-010': 'not_identified', 'RR-012': 'unknown' } as never,
      determination: 'indeterminate',
      basisFactors: ['evidence_incomplete'],
      evidencePhotoIds: [],
    });
    // Rebuild answers cleanly (the override merge above replaces keys but keeps others).
    flow.answers = {
      'RR-001': 'no',
      'RR-003': 'unknown',
      'RR-004': 'visual_screening',
      'RR-010': 'not_identified',
      'RR-012': 'unknown',
      'RR-020': 'search_not_performed',
      'RR-021': 'not_applicable',
      'RR-040': 'no_not_needed',
    };
    expect(validateSystemFlow('roof', flow)).toEqual([]);
  });
});

describe('validateSystemFlow — determination gating', () => {
  it('cannot jump from "damage exists" straight to not-supported without evidence factors', () => {
    const flow = validRoofFlow({ basisFactors: ['repair_requires_disturbance', 'evidence_incomplete'] });
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('at least two basis factors, including one direct-test or product-evidence factor');
  });

  it('undocumented damage forces indeterminate', () => {
    const flow = validRoofFlow();
    flow.answers['RR-001'] = 'unknown';
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('cannot yet be determined');
  });

  it('supported requires a direct, product, or manufacturer factor', () => {
    const flow = validRoofFlow({ determination: 'supported', basisFactors: ['repair_within_damaged_area'] });
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('requires at least one direct-test, product, or manufacturer basis factor');
  });

  it('conditionally supported requires a supporting factor plus a limitation', () => {
    const flow = validRoofFlow({ determination: 'conditionally_supported', basisFactors: ['shingles_reset_securely'] });
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('one supporting factor plus one unresolved limitation');
  });

  it('indeterminate requires the evidence-incomplete factor', () => {
    const flow = validRoofFlow({ determination: 'indeterminate' });
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('"supporting evidence remains incomplete"');
  });
});

describe('validateSystemFlow — universal evidence rules', () => {
  it('test-derived factors require a controlled test', () => {
    const flow = validRoofFlow();
    flow.answers['RR-040'] = 'no_not_needed';
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('require a controlled repairability test');
  });

  it('a test without linked media cannot support the determination', () => {
    const flow = validRoofFlow();
    flow.answers['RR-048'] = 'no';
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('unless test photos/video are linked');
  });

  it('confirmed discontinuation requires linked evidence', () => {
    const flow = validRoofFlow();
    flow.answers['RR-012'] = 'manufacturer_confirmed';
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('confirmed discontinuation requires linked manufacturer/distributor evidence');
    flow.answers['RR-012A'] = ['manufacturer_letter'];
    expect(validateSystemFlow('roof', flow)).toEqual([]);
  });

  it('"not sourceable" requires a documented search', () => {
    const flow = validRoofFlow();
    delete flow.answers['RR-020A'];
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('requires the documented sources searched');
  });

  it('"same product unavailable" basis requires the no-sufficient-quantity search outcome', () => {
    const flow = validRoofFlow();
    flow.answers['RR-020'] = 'unknown';
    delete flow.answers['RR-020A'];
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('requires a documented search finding no sufficient quantity');
  });

  it('unknown basis factors are rejected — "full replacement required" is unrepresentable', () => {
    const flow = validRoofFlow({ basisFactors: ['full_replacement_required'] });
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('unknown basis factor');
  });
});

// A complete, valid cedar-shake flow with a controlled test and linked media.
function validCedarFlow(overrides: Partial<RepairabilitySystemFlow> = {}): RepairabilitySystemFlow {
  return {
    roofMaterial: 'cedar_shake',
    answers: {
      'CS-001': 'yes',
      'CS-002': ['facet:F1'],
      'CS-003': ['split_shake'],
      'CS-004': 'controlled_test',
      'CS-010': 'species_profile',
      'CS-011': ['tapersawn'],
      'CS-013': ['physical_sample'],
      'CS-020': 'available',
      'CS-021': 'no_sufficient_quantity',
      'CS-022': 'no',
      'CS-030': 'yes',
      'CS-031': 'yes',
      'CS-032': 'no',
      'CS-033': 'not_available',
      'CS-040': 'yes',
      'CS-041': 'yes',
      'CS-042': 'yes',
      'CS-043': 'no',
    },
    determination: 'not_supported',
    basisFactors: ['adjacent_shakes_damaged_during_test', 'shakes_could_not_reset', 'matching_cedar_unavailable'],
    nextStep: 'prepare_summary',
    evidencePhotoIds: ['photo-1'],
    evidenceDocRefs: [],
    ...overrides,
  };
}

function validMetalFlow(): RepairabilitySystemFlow {
  return {
    roofMaterial: 'standing_seam_metal',
    answers: {
      'SM-001': 'yes',
      'SM-002': ['facet:F1'],
      'SM-003': ['seam_separation'],
      'SM-004': 'controlled_test',
      'SM-010': 'manufacturer_profile',
      'SM-011': ['seam_profile'],
      'SM-012': ['field_measurement'],
      'SM-020': 'available',
      'SM-021': 'search_not_performed',
      'SM-022': 'no',
      'SM-030': 'yes',
      'SM-031': 'yes',
      'SM-032': 'no',
      'SM-033': 'yes',
      'SM-033A': ['clips'],
      'SM-034': 'not_reviewed',
      'SM-040': 'yes',
      'SM-041': 'yes',
      'SM-042': 'no',
      'SM-043': 'no',
    },
    determination: 'not_supported',
    basisFactors: ['adjacent_seam_deformed_during_test', 'panels_could_not_reseam'],
    nextStep: 'prepare_summary',
    evidencePhotoIds: ['photo-1'],
    evidenceDocRefs: [],
  };
}

describe('RR-010 known product catalog match', () => {
  const match = {
    productId: 'prod-1',
    name: 'Horizon Shadow 25',
    photoPath: '/objects/p.jpg',
    widthInches: 39.375,
    exposureInches: 5.625,
  };

  it('legacy "exact" identification stays valid', () => {
    expect(validateSystemFlow('roof', validRoofFlow())).toEqual([]);
  });

  it('catalog_match with a picked product is valid', () => {
    const flow = validRoofFlow({ productMatch: match });
    flow.answers['RR-010'] = 'catalog_match';
    expect(validateSystemFlow('roof', flow)).toEqual([]);
  });

  it('catalog_match requires the RR-011 product selection', () => {
    const flow = validRoofFlow();
    flow.answers['RR-010'] = 'catalog_match';
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('RR-011');
  });

  it('roof identification no longer requires RR-011 supporting sources', () => {
    const flow = validRoofFlow();
    delete flow.answers['RR-011'];
    expect(validateSystemFlow('roof', flow)).toEqual([]);
  });

  it('a product match without catalog_match is inconsistent', () => {
    const flow = validRoofFlow({ productMatch: match });
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('only applies when RR-010 is a catalog match');
  });

  it('productMatch does not apply to siding flows', () => {
    const flow = validRoofFlow({ productMatch: match });
    delete (flow as { roofMaterial?: unknown }).roofMaterial;
    expect(validateSystemFlow('siding', flow).join(' ')).toContain('does not apply to siding');
  });

  it('productMatch does not apply to cedar/metal flows', () => {
    const flow = validCedarFlow({ productMatch: match });
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('does not apply');
  });
});

describe('roof material branching', () => {
  it('a roof flow without roofMaterial is validated as asphalt shingle (legacy)', () => {
    const flow = validRoofFlow();
    delete (flow as { roofMaterial?: unknown }).roofMaterial;
    expect(validateSystemFlow('roof', flow)).toEqual([]);
  });

  it('rejects an unknown roofing material', () => {
    const flow = validRoofFlow({ roofMaterial: 'slate' as never });
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('unknown roofing material');
  });

  it('rejects roofMaterial on a siding flow', () => {
    const flow = validRoofFlow({ roofMaterial: 'asphalt_shingle' });
    expect(validateSystemFlow('siding', flow).join(' ')).toContain('roofMaterial does not apply');
  });

  it('shingle factor vocabulary is not valid in a cedar flow', () => {
    const flow = validCedarFlow({ basisFactors: ['shingles_could_not_reset', 'same_product_unavailable'] });
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('unknown basis factor');
  });
});

describe('cedar shake flow', () => {
  it('accepts a fully documented not-supported determination', () => {
    expect(validateSystemFlow('roof', validCedarFlow())).toEqual([]);
  });

  it('accepts a valid standing seam flow too', () => {
    expect(validateSystemFlow('roof', validMetalFlow())).toEqual([]);
  });

  it('test-derived cedar factors require the controlled test', () => {
    const flow = validCedarFlow();
    flow.answers['CS-040'] = 'no_not_needed';
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('test-derived basis factors require a controlled test');
  });

  it('a conclusive cedar determination requires linked evidence', () => {
    const flow = validCedarFlow({ evidencePhotoIds: [], evidenceDocRefs: [] });
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('linked');
  });

  it('"unavailable" factor requires the documented no-sufficient-quantity search outcome', () => {
    const flow = validCedarFlow();
    flow.answers['CS-021'] = 'unknown';
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('no sufficient quantity');
  });

  it('substitute-compatibility factors require a completed comparison', () => {
    const flow = validCedarFlow({
      determination: 'conditionally_supported',
      basisFactors: ['proposed_shake_not_compatible', 'shakes_reset_securely'],
    });
    flow.answers['CS-021'] = 'sufficient_quantity';
    const errors = validateSystemFlow('roof', flow);
    expect(errors.join(' ')).toContain('completed documented comparison');
  });

  it('no documented damage forces indeterminate', () => {
    const flow = validCedarFlow();
    flow.answers['CS-001'] = 'no';
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('cannot yet be determined');
  });

  it('identified cedar requires the shake-type answer (CS-011)', () => {
    const flow = validCedarFlow();
    delete flow.answers['CS-011'];
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('CS-011');
  });

  it('temporary protection is rejected outside emergency mitigation or an exposed test condition', () => {
    const flow = validCedarFlow();
    flow.answers['CS-046'] = 'no';
    flow.answers['CS-046A'] = 'yes';
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('temporary weather protection');
  });

  it('temporary protection is allowed for emergency mitigation without a test', () => {
    const flow = validCedarFlow({
      determination: 'indeterminate',
      basisFactors: ['evidence_incomplete'],
    });
    flow.answers['CS-040'] = 'no_emergency';
    flow.answers['CS-046A'] = 'yes';
    flow.answers['CS-046B'] = ['tarp'];
    expect(validateSystemFlow('roof', flow)).toEqual([]);
  });

  it('an exposed test condition requires the temporary-protection answer', () => {
    const flow = validCedarFlow();
    flow.answers['CS-046'] = 'yes';
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('CS-046A');
  });

  it('not-supported still needs two factors including direct/product evidence', () => {
    const flow = validCedarFlow({ basisFactors: ['repair_disturbs_interlayment_deck', 'evidence_incomplete'] });
    expect(validateSystemFlow('roof', flow).join(' ')).toContain('at least two basis factors, including one direct-test or product-evidence factor');
  });
});

describe('validateRepairabilityAssessment — system isolation', () => {
  it('requires a flow for each selected system', () => {
    const ra = assessment(validRoofFlow());
    ra.systems = ['roof', 'siding'];
    const errors = validateRepairabilityAssessment(ra);
    expect(errors.join(' ')).toContain('Siding: flow must be completed');
  });

  it("rejects a flow for an unselected system — one system's evidence can't populate the other", () => {
    const ra = assessment(validRoofFlow());
    ra.systems = ['siding'];
    ra.siding = null;
    const errors = validateRepairabilityAssessment(ra);
    expect(errors.join(' ')).toContain("Roofing: flow present but system not selected");
  });

  it('accepts a complete single-system assessment', () => {
    expect(validateRepairabilityAssessment(assessment(validRoofFlow()))).toEqual([]);
  });
});

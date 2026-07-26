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

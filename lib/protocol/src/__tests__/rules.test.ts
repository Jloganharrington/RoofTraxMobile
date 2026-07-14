import { describe, expect, it } from 'vitest';

import { evaluate } from '../rules';
import type { InspectionProtocolState } from '../types';

function completeState(): InspectionProtocolState {
  return {
    overviewPhotoCaptured: true,
    elevations: {
      front: { widePhotoCaptured: true },
      right: { widePhotoCaptured: true },
      back: { widePhotoCaptured: true },
      left: { widePhotoCaptured: true },
    },
    roofAccessPhotoCaptured: true,
    slopes: [{ id: 'slope-1', widePhotoCaptured: true }],
    testSquares: [
      { id: 'ts-1', slopeId: 'slope-1', overviewPhotoCaptured: true, hitCount: 3 },
    ],
    inaccessibleSlopeIds: [],
    damageInstances: [
      { id: 'dmg-1', widePhotoCaptured: true, midPhotoCaptured: true, closePhotoCaptured: true },
    ],
    interiorPhotoCaptured: false,
    interiorObservationCount: 1,
    interiorClaimWaived: false,
    productIdentifications: [{ id: 'prod-1', unidentifiable: false }],
    measurements: [{ id: 'm-1', slopeId: 'slope-1' }],
    attestationRecorded: true,
    finalReviewConfirmed: true,
    observedIndicators: [],
  };
}

describe('evaluate', () => {
  it('returns zero deficiencies and zero soft flags for a fully complete state', () => {
    const result = evaluate(completeState());
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags).toEqual([]);
  });

  it('flags a missing overview photo (S0) as exactly one deficiency', () => {
    const state = completeState();
    state.overviewPhotoCaptured = false;
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({ stage: 'S0', code: 'MISSING_OVERVIEW_PHOTO' });
  });

  it('flags exactly one missing elevation (S1)', () => {
    const state = completeState();
    delete state.elevations.back;
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S1',
      code: 'MISSING_ELEVATION_PHOTO_BACK',
    });
  });

  it('flags all four missing elevations independently', () => {
    const state = completeState();
    state.elevations = {};
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(4);
    expect(result.deficiencies.map((d) => d.code).sort()).toEqual(
      [
        'MISSING_ELEVATION_PHOTO_FRONT',
        'MISSING_ELEVATION_PHOTO_RIGHT',
        'MISSING_ELEVATION_PHOTO_BACK',
        'MISSING_ELEVATION_PHOTO_LEFT',
      ].sort(),
    );
  });

  it('flags a missing roof access photo (S2) as exactly one deficiency', () => {
    const state = completeState();
    state.roofAccessPhotoCaptured = false;
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S2',
      code: 'MISSING_ROOF_ACCESS_PHOTO',
    });
  });

  it('flags zero slopes (S3) as exactly one deficiency', () => {
    const state = completeState();
    state.slopes = [];
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({ stage: 'S3', code: 'NO_SLOPES_CAPTURED' });
  });

  it('flags a slope missing its photo (S3) as exactly one deficiency', () => {
    const state = completeState();
    state.slopes = [{ id: 'slope-1', widePhotoCaptured: false }];
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S3',
      code: 'MISSING_SLOPE_PHOTO_slope-1',
    });
  });

  it('flags a slope with no test square (S4) as exactly one deficiency', () => {
    const state = completeState();
    state.testSquares = [];
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S4',
      code: 'MISSING_TEST_SQUARE_slope-1',
    });
  });

  it('flags a square whose overview photo was never captured (S4)', () => {
    const state = completeState();
    state.testSquares = [
      { id: 'ts-1', slopeId: 'slope-1', overviewPhotoCaptured: false, hitCount: 0 },
    ];
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S4',
      code: 'MISSING_TEST_SQUARE_slope-1',
    });
  });

  it('clears the S4 gate for a slope documented as inaccessible (D2), without a square', () => {
    const state = completeState();
    state.testSquares = [];
    state.inaccessibleSlopeIds = ['slope-1'];
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
  });

  it('flags only the accessible slope when one of two slopes is documented inaccessible', () => {
    const state = completeState();
    state.slopes = [
      { id: 'slope-1', widePhotoCaptured: true },
      { id: 'slope-2', widePhotoCaptured: true },
    ];
    state.testSquares = [];
    state.inaccessibleSlopeIds = ['slope-1'];
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S4',
      code: 'MISSING_TEST_SQUARE_slope-2',
    });
  });

  it('flags an incomplete damage triad (S5) as exactly one deficiency', () => {
    const state = completeState();
    state.damageInstances = [
      { id: 'dmg-1', widePhotoCaptured: true, midPhotoCaptured: false, closePhotoCaptured: true },
    ];
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S5',
      code: 'INCOMPLETE_DAMAGE_TRIAD_dmg-1',
    });
  });

  // Field-test C: skip a slope overview AND a damage close-up in one pass; the
  // gate engine must flag both independently and demand nothing from stages the
  // app hasn't built. buildProtocolState reports S0/S4/S6/S7/S8/S9 as complete
  // for stages the exterior-capture UI doesn't touch, so only S3 + S5 surface.
  it('flags a skipped slope overview (S3) and a skipped damage close-up (S5) together, without demanding unbuilt stages', () => {
    const state = completeState();
    state.slopes = [{ id: 'slope-1', widePhotoCaptured: false }];
    state.damageInstances = [
      { id: 'dmg-1', widePhotoCaptured: true, midPhotoCaptured: true, closePhotoCaptured: false },
    ];
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(2);
    expect(result.deficiencies.map((d) => `${d.stage}:${d.code}`).sort()).toEqual(
      ['S3:MISSING_SLOPE_PHOTO_slope-1', 'S5:INCOMPLETE_DAMAGE_TRIAD_dmg-1'].sort(),
    );
    // No S0/S4/S6/S7/S8/S9 demands leak through when those inputs are complete.
    expect(result.deficiencies.some((d) => ['S0', 'S4', 'S6', 'S7', 'S8', 'S9'].includes(d.stage))).toBe(
      false,
    );
  });

  it('flags zero measurements (S7) as exactly one deficiency', () => {
    const state = completeState();
    state.measurements = [];
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S7',
      code: 'NO_MEASUREMENTS_RECORDED',
    });
  });

  it('flags a missing attestation (S8) as exactly one deficiency', () => {
    const state = completeState();
    state.attestationRecorded = false;
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({ stage: 'S8', code: 'MISSING_ATTESTATION' });
  });

  it('flags an unconfirmed final review (S9) as exactly one deficiency', () => {
    const state = completeState();
    state.finalReviewConfirmed = false;
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S9',
      code: 'FINAL_REVIEW_NOT_CONFIRMED',
    });
  });

  it('soft-flags an interior leak reported without a photo, without blocking', () => {
    const state = completeState();
    state.observedIndicators = ['interior_leak_reported'];
    state.interiorPhotoCaptured = false;
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags).toHaveLength(1);
    expect(result.softFlags[0]).toMatchObject({
      stage: 'S6',
      code: 'INTERIOR_LEAK_REPORTED_WITHOUT_PHOTO',
    });
  });

  it('does not soft-flag an interior leak when a photo was captured', () => {
    const state = completeState();
    state.observedIndicators = ['interior_leak_reported'];
    state.interiorPhotoCaptured = true;
    const result = evaluate(state);
    expect(result.softFlags).toEqual([]);
  });

  it('soft-flags a zero-hit test square, without blocking', () => {
    const state = completeState();
    state.testSquares = [
      { id: 'ts-1', slopeId: 'slope-1', overviewPhotoCaptured: true, hitCount: 0 },
    ];
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags).toHaveLength(1);
    expect(result.softFlags[0]).toMatchObject({
      stage: 'S4',
      code: 'TEST_SQUARE_ZERO_HITS_ts-1',
    });
  });

  it('soft-flags an unidentifiable roofing product, without blocking', () => {
    const state = completeState();
    state.productIdentifications = [{ id: 'prod-1', unidentifiable: true }];
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags).toHaveLength(1);
    expect(result.softFlags[0]).toMatchObject({
      stage: 'S4',
      code: 'PRODUCT_UNIDENTIFIED_prod-1',
    });
  });

  it('does not soft-flag a field-identified roofing product', () => {
    const state = completeState();
    state.productIdentifications = [{ id: 'prod-1', unidentifiable: false }];
    const result = evaluate(state);
    expect(result.softFlags).toEqual([]);
  });

  // ---- E2: interior "satisfied-or-attested" soft flag (S6) ----------------

  it('soft-flags an inspection whose interior was neither documented nor waived', () => {
    const state = completeState();
    state.interiorObservationCount = 0;
    state.interiorClaimWaived = false;
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags).toHaveLength(1);
    expect(result.softFlags[0]).toMatchObject({ stage: 'S6', code: 'INTERIOR_NOT_ADDRESSED' });
  });

  it('clears the interior soft flag when observations were recorded', () => {
    const state = completeState();
    state.interiorObservationCount = 2;
    state.interiorClaimWaived = false;
    expect(evaluate(state).softFlags).toEqual([]);
  });

  it('clears the interior soft flag when the inspector waives the interior claim', () => {
    const state = completeState();
    state.interiorObservationCount = 0;
    state.interiorClaimWaived = true;
    expect(evaluate(state).softFlags).toEqual([]);
  });

  // ---- E1: measurement/slope cross-check soft flag (S7) -------------------

  it('soft-flags a measurement that references a slope not in the inventory', () => {
    const state = completeState();
    state.measurements = [
      { id: 'm-1', slopeId: 'slope-1' },
      { id: 'm-2', slopeId: 'slope-ghost' },
    ];
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags).toHaveLength(1);
    expect(result.softFlags[0]).toMatchObject({
      stage: 'S7',
      code: 'MEASUREMENT_SLOPE_MISMATCH_m-2',
    });
  });

  it('does not soft-flag whole-roof measurements (no slopeId) or matched slope measurements', () => {
    const state = completeState();
    state.measurements = [
      { id: 'm-1', slopeId: 'slope-1' },
      { id: 'm-2', slopeId: '' },
    ];
    expect(evaluate(state).softFlags).toEqual([]);
  });

  // ---- Gate-engine regression: 20+ single-deficiency fixtures -------------
  // Each fixture mutates exactly one thing out of a complete state and must
  // yield exactly one hard deficiency with the expected stage/code. This is
  // the "one deficiency in, one deficiency out" contract the readiness UI
  // depends on to deep-link every blocker to its fix screen.

  const SINGLE_DEFICIENCY_FIXTURES: Array<{
    name: string;
    mutate: (s: InspectionProtocolState) => void;
    stage: string;
    code: string;
  }> = [
    { name: 'S0 overview missing', mutate: (s) => { s.overviewPhotoCaptured = false; }, stage: 'S0', code: 'MISSING_OVERVIEW_PHOTO' },
    { name: 'S1 front deleted', mutate: (s) => { delete s.elevations.front; }, stage: 'S1', code: 'MISSING_ELEVATION_PHOTO_FRONT' },
    { name: 'S1 right deleted', mutate: (s) => { delete s.elevations.right; }, stage: 'S1', code: 'MISSING_ELEVATION_PHOTO_RIGHT' },
    { name: 'S1 back deleted', mutate: (s) => { delete s.elevations.back; }, stage: 'S1', code: 'MISSING_ELEVATION_PHOTO_BACK' },
    { name: 'S1 left deleted', mutate: (s) => { delete s.elevations.left; }, stage: 'S1', code: 'MISSING_ELEVATION_PHOTO_LEFT' },
    { name: 'S1 front wide false', mutate: (s) => { s.elevations.front = { widePhotoCaptured: false }; }, stage: 'S1', code: 'MISSING_ELEVATION_PHOTO_FRONT' },
    { name: 'S1 right wide false', mutate: (s) => { s.elevations.right = { widePhotoCaptured: false }; }, stage: 'S1', code: 'MISSING_ELEVATION_PHOTO_RIGHT' },
    { name: 'S2 roof access missing', mutate: (s) => { s.roofAccessPhotoCaptured = false; }, stage: 'S2', code: 'MISSING_ROOF_ACCESS_PHOTO' },
    { name: 'S3 no slopes', mutate: (s) => { s.slopes = []; s.testSquares = []; }, stage: 'S3', code: 'NO_SLOPES_CAPTURED' },
    { name: 'S3 slope photo missing', mutate: (s) => { s.slopes = [{ id: 'slope-1', widePhotoCaptured: false }]; }, stage: 'S3', code: 'MISSING_SLOPE_PHOTO_slope-1' },
    {
      name: 'S3 second slope photo missing',
      mutate: (s) => {
        s.slopes = [{ id: 'slope-1', widePhotoCaptured: true }, { id: 'slope-2', widePhotoCaptured: false }];
        s.testSquares = [
          { id: 'ts-1', slopeId: 'slope-1', overviewPhotoCaptured: true, hitCount: 3 },
          { id: 'ts-2', slopeId: 'slope-2', overviewPhotoCaptured: true, hitCount: 3 },
        ];
      },
      stage: 'S3',
      code: 'MISSING_SLOPE_PHOTO_slope-2',
    },
    { name: 'S4 no test square', mutate: (s) => { s.testSquares = []; }, stage: 'S4', code: 'MISSING_TEST_SQUARE_slope-1' },
    { name: 'S4 square overview missing', mutate: (s) => { s.testSquares = [{ id: 'ts-1', slopeId: 'slope-1', overviewPhotoCaptured: false, hitCount: 3 }]; }, stage: 'S4', code: 'MISSING_TEST_SQUARE_slope-1' },
    {
      name: 'S4 second slope no square',
      mutate: (s) => {
        s.slopes = [{ id: 'slope-1', widePhotoCaptured: true }, { id: 'slope-2', widePhotoCaptured: true }];
        s.testSquares = [{ id: 'ts-1', slopeId: 'slope-1', overviewPhotoCaptured: true, hitCount: 3 }];
      },
      stage: 'S4',
      code: 'MISSING_TEST_SQUARE_slope-2',
    },
    { name: 'S5 triad wide missing', mutate: (s) => { s.damageInstances = [{ id: 'dmg-1', widePhotoCaptured: false, midPhotoCaptured: true, closePhotoCaptured: true }]; }, stage: 'S5', code: 'INCOMPLETE_DAMAGE_TRIAD_dmg-1' },
    { name: 'S5 triad mid missing', mutate: (s) => { s.damageInstances = [{ id: 'dmg-1', widePhotoCaptured: true, midPhotoCaptured: false, closePhotoCaptured: true }]; }, stage: 'S5', code: 'INCOMPLETE_DAMAGE_TRIAD_dmg-1' },
    { name: 'S5 triad close missing', mutate: (s) => { s.damageInstances = [{ id: 'dmg-1', widePhotoCaptured: true, midPhotoCaptured: true, closePhotoCaptured: false }]; }, stage: 'S5', code: 'INCOMPLETE_DAMAGE_TRIAD_dmg-1' },
    {
      name: 'S5 second damage incomplete',
      mutate: (s) => {
        s.damageInstances = [
          { id: 'dmg-1', widePhotoCaptured: true, midPhotoCaptured: true, closePhotoCaptured: true },
          { id: 'dmg-2', widePhotoCaptured: true, midPhotoCaptured: false, closePhotoCaptured: false },
        ];
      },
      stage: 'S5',
      code: 'INCOMPLETE_DAMAGE_TRIAD_dmg-2',
    },
    { name: 'S7 no measurements', mutate: (s) => { s.measurements = []; }, stage: 'S7', code: 'NO_MEASUREMENTS_RECORDED' },
    { name: 'S8 attestation missing', mutate: (s) => { s.attestationRecorded = false; }, stage: 'S8', code: 'MISSING_ATTESTATION' },
    { name: 'S9 final review unconfirmed', mutate: (s) => { s.finalReviewConfirmed = false; }, stage: 'S9', code: 'FINAL_REVIEW_NOT_CONFIRMED' },
  ];

  it('exercises at least 20 distinct single-deficiency fixtures', () => {
    expect(SINGLE_DEFICIENCY_FIXTURES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(SINGLE_DEFICIENCY_FIXTURES)(
    'yields exactly one deficiency: $name',
    ({ mutate, stage, code }) => {
      const state = completeState();
      mutate(state);
      const result = evaluate(state);
      expect(result.deficiencies).toHaveLength(1);
      expect(result.deficiencies[0]).toMatchObject({ stage, code });
    },
  );

  // ---- Submission gate: allowed only at zero hard deficiencies -----------

  it('allows submission (zero hard deficiencies) for a complete inspection', () => {
    expect(evaluate(completeState()).deficiencies).toHaveLength(0);
  });

  it('blocks submission whenever any single hard deficiency remains', () => {
    for (const fixture of SINGLE_DEFICIENCY_FIXTURES) {
      const state = completeState();
      fixture.mutate(state);
      expect(evaluate(state).deficiencies.length).toBeGreaterThan(0);
    }
  });
});

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
    testSquares: [{ id: 'ts-1', slopeId: 'slope-1', hitCount: 3 }],
    damageInstances: [
      { id: 'dmg-1', widePhotoCaptured: true, midPhotoCaptured: true, closePhotoCaptured: true },
    ],
    interiorPhotoCaptured: false,
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

  it('flags zero test squares (S4) as exactly one deficiency', () => {
    const state = completeState();
    state.testSquares = [];
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'S4',
      code: 'NO_TEST_SQUARES_CAPTURED',
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
    state.testSquares = [{ id: 'ts-1', slopeId: 'slope-1', hitCount: 0 }];
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
});

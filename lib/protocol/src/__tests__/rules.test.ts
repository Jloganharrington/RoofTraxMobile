import { describe, expect, it } from 'vitest';

import { evaluate } from '../rules';
import { applicableSteps, stepApplies } from '../stages';
import type { InspectionProtocolState } from '../types';

// Protocol v2.1 — a state that satisfies every hard gate across all steps,
// with every damage surface selected so all conditional steps apply.
function completeState(): InspectionProtocolState {
  return {
    arrival: {
      skyLogged: true,
      windLogged: true,
      tempLogged: true,
      personnelRecorded: true,
      gpsPresent: true,
      timePresent: true,
    },
    elevations: {
      front: { widePhotoCaptured: true },
      right: { widePhotoCaptured: true },
      back: { widePhotoCaptured: true },
      left: { widePhotoCaptured: true },
    },
    damageFlags: {
      roofDamageFound: true,
      sidingDamageFound: true,
      collateralDamageFound: true,
    },
    facets: [
      {
        id: 'facet-1',
        label: 'F1',
        hasArea: true,
        hasMaterial: true,
        hasPitch: true,
        damagePresent: true,
        damageType: 'hail',
      },
    ],
    damageInstances: [{ id: 'dmg-1', slopeId: 'facet-1', photoCaptured: true }],
    wholeRoofLinearCount: 5,
    testSquares: [{ id: 'ts-1', slopeId: 'facet-1', photoCaptured: true, hitCount: 3 }],
    components: [{ id: 'comp-1', zone: 'eave_edge' }],
    componentZonePhotos: ['eave_edge'],
    penetrations: [{ id: 'pen-1', photoCaptured: true }],
    productIdentifications: [{ id: 'prod-1', unidentifiable: false }],
    sidingFacets: [
      {
        id: 'sf-1',
        label: 'S1',
        damaged: true,
        damageType: 'hail',
        componentCount: 2,
        facetPhotoCaptured: true,
        damagePhotoCount: 1,
        componentPhotoCount: 2,
      },
    ],
    sidingMeasurementReportUploaded: true,
    interiorPhotoCaptured: false,
    interiorObservationCount: 1,
    interiorClaimWaived: false,
    declarationSigned: true,
    finalReviewConfirmed: true,
    observedIndicators: [],
  };
}

describe('evaluate (protocol v2.1)', () => {
  it('returns zero deficiencies and zero soft flags for a fully complete state', () => {
    const result = evaluate(completeState());
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags).toEqual([]);
  });

  it('flags all four missing elevations independently', () => {
    const state = completeState();
    state.elevations = {};
    const result = evaluate(state);
    expect(result.deficiencies.filter((d) => d.stage === 'elevation_access')).toHaveLength(4);
  });

  it('hail-gates test squares: a wind-only facet needs no square', () => {
    const state = completeState();
    state.facets[0]!.damageType = 'wind';
    state.testSquares = [];
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
  });

  it('requires a test square for a hail_and_wind facet', () => {
    const state = completeState();
    state.facets[0]!.damageType = 'hail_and_wind';
    state.testSquares = [];
    const result = evaluate(state);
    expect(result.deficiencies.map((d) => d.code)).toContain('MISSING_TEST_SQUARE_facet-1');
  });

  it('a test square without its photo does not satisfy the hail gate', () => {
    const state = completeState();
    state.testSquares = [{ id: 'ts-1', slopeId: 'facet-1', photoCaptured: false, hitCount: 0 }];
    const result = evaluate(state);
    expect(result.deficiencies.map((d) => d.code)).toContain('MISSING_TEST_SQUARE_facet-1');
  });

  it('flags a damaged facet with zero damage records', () => {
    const state = completeState();
    state.damageInstances = [];
    const result = evaluate(state);
    expect(result.deficiencies.map((d) => d.code)).toContain(
      'MISSING_FACET_DAMAGE_RECORDS_facet-1',
    );
  });

  it('an undamaged facet demands no damage records or photos', () => {
    const state = completeState();
    state.facets[0]!.damagePresent = false;
    state.facets[0]!.damageType = 'none';
    state.damageInstances = [];
    state.testSquares = [];
    expect(evaluate(state).deficiencies).toEqual([]);
  });

  it('soft-flags zero documented components without blocking', () => {
    const state = completeState();
    state.components = [];
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags.map((f) => f.code)).toContain('NO_COMPONENTS_DOCUMENTED');
  });

  it('soft-flags an interior neither documented nor waived', () => {
    const state = completeState();
    state.interiorObservationCount = 0;
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags.map((f) => f.code)).toContain('INTERIOR_NOT_ADDRESSED');
  });

  it('clears the interior soft flag when waived', () => {
    const state = completeState();
    state.interiorObservationCount = 0;
    state.interiorClaimWaived = true;
    expect(evaluate(state).softFlags).toEqual([]);
  });

  it('soft-flags zero-hit squares and unidentifiable products without blocking', () => {
    const state = completeState();
    state.testSquares[0]!.hitCount = 0;
    state.productIdentifications = [{ id: 'prod-1', unidentifiable: true }];
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags.map((f) => f.code).sort()).toEqual([
      'PRODUCT_UNIDENTIFIED_prod-1',
      'TEST_SQUARE_ZERO_HITS_ts-1',
    ]);
  });

  it('aggregates earlier hard deficiencies onto the submit step', () => {
    const state = completeState();
    state.productIdentifications = [];
    const result = evaluate(state);
    const submit = result.deficiencies.filter((d) => d.stage === 'submit');
    expect(submit.map((d) => d.code)).toEqual(['HARD_DEFICIENCIES_REMAIN']);
  });

  // ---- v2.1 conditional applicability ---------------------------------------

  it('skips every roof gate when roofDamageFound is false', () => {
    const state = completeState();
    state.damageFlags.roofDamageFound = false;
    state.facets = [];
    state.damageInstances = [];
    state.testSquares = [];
    state.components = [];
    state.componentZonePhotos = [];
    state.penetrations = [];
    state.productIdentifications = [];
    state.wholeRoofLinearCount = 0;
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    // Roof soft flags (no components) must not fire either.
    expect(result.softFlags).toEqual([]);
  });

  it('skips the siding gate when sidingDamageFound is false', () => {
    const state = completeState();
    state.damageFlags.sidingDamageFound = false;
    state.sidingFacets = [];
    state.sidingMeasurementReportUploaded = false;
    const result = evaluate(state);
    expect(result.deficiencies).toEqual([]);
    expect(result.softFlags).toEqual([]);
  });

  it('hard-blocks submit with NO_DAMAGE_SURFACE_SELECTED when no flag is set', () => {
    const state = completeState();
    state.damageFlags = {
      roofDamageFound: false,
      sidingDamageFound: false,
      collateralDamageFound: false,
    };
    const result = evaluate(state);
    expect(result.deficiencies.map((d) => d.code)).toContain('NO_DAMAGE_SURFACE_SELECTED');
    expect(result.deficiencies.filter((d) => d.stage !== 'submit')).toEqual([]);
  });

  it('soft-flags a missing siding measurement report only when siding applies', () => {
    const state = completeState();
    state.sidingMeasurementReportUploaded = false;
    expect(evaluate(state).softFlags.map((f) => f.code)).toContain(
      'SIDING_MEASUREMENT_REPORT_MISSING',
    );
    state.damageFlags.sidingDamageFound = false;
    state.sidingFacets = [];
    expect(evaluate(state).softFlags).toEqual([]);
  });

  it('applicableSteps drops exactly the unselected surfaces', () => {
    const flags = {
      roofDamageFound: false,
      sidingDamageFound: true,
      collateralDamageFound: false,
    };
    const keys = applicableSteps(flags).map((s) => s.key);
    expect(keys).toEqual([
      'arrival',
      'elevation_access',
      'siding',
      'interior',
      'homeowner',
      'declaration',
      'submit',
    ]);
    expect(stepApplies('facets', flags)).toBe(false);
    expect(stepApplies('collateral', flags)).toBe(false);
  });

  // ---- Gate-engine regression: single-deficiency fixtures ------------------
  // Each fixture mutates exactly one thing out of a complete state and must
  // yield exactly one hard deficiency on its own step (plus the submit
  // aggregate). This is the "one deficiency in, one deficiency out" contract
  // the readiness UI depends on to deep-link every blocker to its fix screen.

  const SINGLE_DEFICIENCY_FIXTURES: Array<{
    name: string;
    mutate: (s: InspectionProtocolState) => void;
    stage: string;
    code: string;
  }> = [
    { name: 'arrival sky missing', mutate: (s) => { s.arrival.skyLogged = false; }, stage: 'arrival', code: 'MISSING_ARRIVAL_SKY' },
    { name: 'arrival wind missing', mutate: (s) => { s.arrival.windLogged = false; }, stage: 'arrival', code: 'MISSING_ARRIVAL_WIND' },
    { name: 'arrival temp missing', mutate: (s) => { s.arrival.tempLogged = false; }, stage: 'arrival', code: 'MISSING_ARRIVAL_TEMP' },
    { name: 'arrival personnel missing', mutate: (s) => { s.arrival.personnelRecorded = false; }, stage: 'arrival', code: 'MISSING_ARRIVAL_PERSONNEL' },
    { name: 'arrival gps missing', mutate: (s) => { s.arrival.gpsPresent = false; }, stage: 'arrival', code: 'MISSING_ARRIVAL_GPS' },
    { name: 'arrival time missing', mutate: (s) => { s.arrival.timePresent = false; }, stage: 'arrival', code: 'MISSING_ARRIVAL_TIME' },
    { name: 'elevation front deleted', mutate: (s) => { delete s.elevations.front; }, stage: 'elevation_access', code: 'MISSING_ELEVATION_PHOTO_FRONT' },
    { name: 'elevation right deleted', mutate: (s) => { delete s.elevations.right; }, stage: 'elevation_access', code: 'MISSING_ELEVATION_PHOTO_RIGHT' },
    { name: 'elevation back deleted', mutate: (s) => { delete s.elevations.back; }, stage: 'elevation_access', code: 'MISSING_ELEVATION_PHOTO_BACK' },
    { name: 'elevation left wide false', mutate: (s) => { s.elevations.left = { widePhotoCaptured: false }; }, stage: 'elevation_access', code: 'MISSING_ELEVATION_PHOTO_LEFT' },
    { name: 'no facets', mutate: (s) => { s.facets = []; s.damageInstances = []; s.testSquares = []; }, stage: 'facets', code: 'NO_FACETS_DOCUMENTED' },
    { name: 'facet area missing', mutate: (s) => { s.facets[0]!.hasArea = false; }, stage: 'facets', code: 'MISSING_FACET_AREA_facet-1' },
    { name: 'facet material missing', mutate: (s) => { s.facets[0]!.hasMaterial = false; }, stage: 'facets', code: 'MISSING_FACET_MATERIAL_facet-1' },
    { name: 'facet pitch missing', mutate: (s) => { s.facets[0]!.hasPitch = false; }, stage: 'facets', code: 'MISSING_FACET_PITCH_facet-1' },
    { name: 'damaged facet w/o damage records', mutate: (s) => { s.damageInstances = []; }, stage: 'facets', code: 'MISSING_FACET_DAMAGE_RECORDS_facet-1' },
    { name: 'damage record w/o photo', mutate: (s) => { s.damageInstances[0]!.photoCaptured = false; }, stage: 'facets', code: 'MISSING_DAMAGE_PHOTO_dmg-1' },
    // A record orphaned by a facet delete (slopeId nulled by the FK) must NOT
    // hard-block — it can no longer be resolved from the facet flow. See the
    // separate orphan test below for the zero-deficiency assertion.
    { name: 'no whole-roof linears', mutate: (s) => { s.wholeRoofLinearCount = 0; }, stage: 'facets', code: 'NO_WHOLE_ROOF_LINEARS' },
    { name: 'hail facet w/o test square', mutate: (s) => { s.testSquares = []; }, stage: 'test_squares', code: 'MISSING_TEST_SQUARE_facet-1' },
    { name: 'test square photo missing', mutate: (s) => { s.testSquares[0]!.photoCaptured = false; }, stage: 'test_squares', code: 'MISSING_TEST_SQUARE_facet-1' },
    { name: 'documented zone w/o zone photo', mutate: (s) => { s.componentZonePhotos = []; }, stage: 'components', code: 'MISSING_ZONE_PHOTO_eave_edge' },
    { name: 'ridge/hip component w/o zone photo', mutate: (s) => { s.components.push({ id: 'comp-2', zone: 'ridge_hip' }); }, stage: 'components', code: 'MISSING_ZONE_PHOTO_ridge_hip' },
    { name: 'penetration w/o photo', mutate: (s) => { s.penetrations[0]!.photoCaptured = false; }, stage: 'components', code: 'MISSING_PENETRATION_PHOTO_pen-1' },
    { name: 'no product record', mutate: (s) => { s.productIdentifications = []; }, stage: 'product', code: 'NO_PRODUCT_RECORD' },
    { name: 'siding damage found w/o siding facets', mutate: (s) => { s.sidingFacets = []; }, stage: 'siding', code: 'NO_SIDING_FACETS_DOCUMENTED' },
    { name: 'siding facet w/o facet photo', mutate: (s) => { s.sidingFacets[0]!.facetPhotoCaptured = false; }, stage: 'siding', code: 'MISSING_SIDING_FACET_PHOTO_sf-1' },
    { name: 'damaged siding facet w/o damage type', mutate: (s) => { s.sidingFacets[0]!.damageType = null; }, stage: 'siding', code: 'MISSING_SIDING_DAMAGE_TYPE_sf-1' },
    { name: 'damaged siding facet w/o damage photo', mutate: (s) => { s.sidingFacets[0]!.damagePhotoCount = 0; }, stage: 'siding', code: 'MISSING_SIDING_DAMAGE_PHOTO_sf-1' },
    { name: 'siding components not all photographed', mutate: (s) => { s.sidingFacets[0]!.componentPhotoCount = 1; }, stage: 'siding', code: 'MISSING_SIDING_COMPONENT_PHOTOS_sf-1' },
    { name: 'declaration missing', mutate: (s) => { s.declarationSigned = false; }, stage: 'declaration', code: 'MISSING_DECLARATION' },
  ];

  it('does not hard-block a damage record orphaned by a facet delete', () => {
    const state = completeState();
    // Simulate the FK nulling slopeId when its facet was deleted, plus a
    // record still pointing at a facet id that no longer exists.
    state.damageInstances.push(
      { id: 'dmg-orphan-null', slopeId: '', photoCaptured: false },
      { id: 'dmg-orphan-gone', slopeId: 'facet-deleted', photoCaptured: false },
    );
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(0);
  });

  it('an undamaged siding facet needs no damage type or damage photo', () => {
    const state = completeState();
    state.sidingFacets[0]!.damaged = false;
    state.sidingFacets[0]!.damageType = null;
    state.sidingFacets[0]!.damagePhotoCount = 0;
    expect(evaluate(state).deficiencies).toEqual([]);
  });

  it('exercises at least 20 distinct single-deficiency fixtures', () => {
    expect(SINGLE_DEFICIENCY_FIXTURES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(SINGLE_DEFICIENCY_FIXTURES)(
    'yields exactly one step deficiency plus the submit aggregate: $name',
    ({ mutate, stage, code }) => {
      const state = completeState();
      mutate(state);
      const result = evaluate(state);
      const own = result.deficiencies.filter((d) => d.stage !== 'submit');
      expect(own).toHaveLength(1);
      expect(own[0]).toMatchObject({ stage, code });
      // The submit aggregate reflects the outstanding blocker.
      expect(result.deficiencies.filter((d) => d.stage === 'submit').map((d) => d.code)).toEqual([
        'HARD_DEFICIENCIES_REMAIN',
      ]);
    },
  );

  it('flags only an unconfirmed final review on submit when all else passes', () => {
    const state = completeState();
    state.finalReviewConfirmed = false;
    const result = evaluate(state);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({
      stage: 'submit',
      code: 'FINAL_REVIEW_NOT_CONFIRMED',
    });
  });

  it('blocks submission whenever any single hard deficiency remains', () => {
    for (const fixture of SINGLE_DEFICIENCY_FIXTURES) {
      const state = completeState();
      fixture.mutate(state);
      expect(evaluate(state).deficiencies.length).toBeGreaterThan(0);
    }
  });
});

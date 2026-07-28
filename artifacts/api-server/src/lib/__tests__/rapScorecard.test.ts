import { describe, expect, it } from 'vitest';
import type { RepairAttemptProtocol } from '@workspace/db';
import {
  buildRapReportSection,
  computeRapScorecard,
  extractRap,
  rapScorecardBriefLines,
  selectRapReportPhotos,
} from '../rapScorecard';

const rap = (overrides: Partial<RepairAttemptProtocol> = {}): RepairAttemptProtocol => ({
  rap1PhotoId: 'ph-rap1',
  matTransfer: { shingle1: null, shingle2: null },
  damage: {},
  ...overrides,
});

const v2Assessment = (rapRecord: RepairAttemptProtocol | null) => ({
  version: 2,
  systems: ['roof'],
  roof: {
    roofMaterial: 'asphalt_shingle',
    rap: rapRecord,
    answers: {},
    determination: 'supported',
    basisFactors: [],
    nextStep: 'submit',
  },
  recordedAtUtc: '2026-07-28T00:00:00Z',
});

describe('extractRap', () => {
  it('returns null for null / legacy v1 / v2-without-rap assessments', () => {
    expect(extractRap(null)).toBeNull();
    expect(extractRap({ determination: 'repairable' })).toBeNull(); // legacy v1
    expect(extractRap(v2Assessment(null))).toBeNull();
    expect(extractRap({ version: 2, roof: { rap: { matTransfer: {} } } })).toBeNull(); // no damage map
  });

  it('returns the rap record from a v2 roof flow', () => {
    const r = rap();
    expect(extractRap(v2Assessment(r))).toEqual(r);
  });
});

describe('computeRapScorecard (mirrors the mobile screen math)', () => {
  it('counts 9 manipulated shingles always', () => {
    expect(computeRapScorecard(rap()).manipulatedShingles).toBe(9);
  });

  it('counts unique collateral shingles once across mat transfer and damage categories', () => {
    const sc = computeRapScorecard(
      rap({
        matTransfer: { shingle1: 'yes', shingle2: 'no' },
        damage: {
          delamination: { answer: 'yes', shingles: [3, 4] },
          creasing: { answer: 'yes', shingles: [4, 5] }, // 4 overlaps
          nailZone: { answer: 'no', shingles: [6] }, // "no" → ignored
        },
      }),
    );
    // Unique: {1, 3, 4, 5}
    expect(sc.newCollateralDamagedShingles).toBe(4);
    expect(sc.matTransferCount).toBe(1);
    expect(sc.categories).toEqual([
      { key: 'delamination', label: 'Delamination', count: 2 },
      { key: 'creasing', label: 'Creasing/cracking/fracture', count: 2 },
      { key: 'nailZone', label: 'Nail-zone damage', count: 0 },
      { key: 'puncture', label: 'Puncture/tear/gouge', count: 0 },
      { key: 'reseat', label: 'Reseating/seal-integration concerns', count: 0 },
    ]);
  });

  it('tolerates a missing matTransfer object', () => {
    const sc = computeRapScorecard({ damage: {} } as unknown as RepairAttemptProtocol);
    expect(sc.matTransferCount).toBe(0);
    expect(sc.newCollateralDamagedShingles).toBe(0);
  });
});

describe('selectRapReportPhotos (delamination > creasing priority)', () => {
  it('picks delamination + creasing when more than 2 categories have photos', () => {
    const picks = selectRapReportPhotos(
      rap({
        damage: {
          nailZone: { answer: 'yes', shingles: [3], photoId: 'ph-nail' },
          creasing: { answer: 'yes', shingles: [4], photoId: 'ph-crease' },
          puncture: { answer: 'yes', shingles: [5], photoId: 'ph-punct' },
          delamination: { answer: 'yes', shingles: [6], photoId: 'ph-delam' },
        },
      }),
    );
    expect(picks.rap1PhotoId).toBe('ph-rap1');
    expect(picks.examplePhotoIds).toEqual(['ph-delam', 'ph-crease']);
  });

  it('fills remaining slots in category order when priority categories lack photos', () => {
    const picks = selectRapReportPhotos(
      rap({
        rap1PhotoId: null,
        damage: {
          reseat: { answer: 'yes', shingles: [3], photoId: 'ph-reseat' },
          puncture: { answer: 'yes', shingles: [4], photoId: 'ph-punct' },
          nailZone: { answer: 'yes', shingles: [5], photoId: 'ph-nail' },
          // delamination answered yes but no photo captured
          delamination: { answer: 'yes', shingles: [6] },
        },
      }),
    );
    expect(picks.rap1PhotoId).toBeNull();
    expect(picks.examplePhotoIds).toEqual(['ph-nail', 'ph-punct']);
  });

  it('ignores photos on "no" answers and returns fewer than 2 when scarce', () => {
    const picks = selectRapReportPhotos(
      rap({
        damage: {
          delamination: { answer: 'no', shingles: [], photoId: 'ph-stale' },
          creasing: { answer: 'yes', shingles: [4], photoId: 'ph-crease' },
        },
      }),
    );
    expect(picks.examplePhotoIds).toEqual(['ph-crease']);
  });
});

describe('buildRapReportSection', () => {
  it('returns null for pre-RAP assessments', () => {
    expect(buildRapReportSection(null)).toBeNull();
    expect(buildRapReportSection({ determination: 'repairable' })).toBeNull();
    expect(buildRapReportSection(v2Assessment(null))).toBeNull();
  });

  it('builds scorecard + labeled example photos with notes', () => {
    const section = buildRapReportSection(
      v2Assessment(
        rap({
          matTransfer: { shingle1: 'yes', shingle2: 'yes' },
          damage: {
            delamination: { answer: 'yes', shingles: [3], photoId: 'ph-delam', note: 'edge lift' },
            creasing: { answer: 'yes', shingles: [4, 7], photoId: 'ph-crease', note: null },
            puncture: { answer: 'yes', shingles: [8], photoId: 'ph-punct' },
          },
        }),
      ),
    );
    expect(section).not.toBeNull();
    expect(section!.rap1PhotoId).toBe('ph-rap1');
    expect(section!.scorecard.newCollateralDamagedShingles).toBe(6); // {1,2,3,4,7,8}
    expect(section!.examplePhotos).toEqual([
      { photoId: 'ph-delam', categoryKey: 'delamination', label: 'Delamination', note: 'edge lift' },
      {
        photoId: 'ph-crease',
        categoryKey: 'creasing',
        label: 'Creasing/cracking/fracture',
        note: null,
      },
    ]);
  });
});

describe('rapScorecardBriefLines', () => {
  it('renders the same counts the report shows', () => {
    const lines = rapScorecardBriefLines(
      computeRapScorecard(
        rap({
          matTransfer: { shingle1: 'yes', shingle2: 'no' },
          damage: { creasing: { answer: 'yes', shingles: [3, 4, 5] } },
        }),
      ),
    );
    expect(lines).toContain('  Manipulated shingles: 9');
    expect(lines).toContain('  New collateral-damaged shingles (unique): 4');
    expect(lines).toContain('  Creasing/cracking/fracture: 3');
  });
});

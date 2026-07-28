import { describe, expect, it } from 'vitest';
import type { VinylAssessmentProtocol } from '@workspace/db';
import {
  buildVapReportSection,
  computeVapScorecard,
  extractVap,
  isVapArchiveOnlyPhoto,
  selectVapReportPhotos,
  vapScorecardBriefLines,
} from '../vapScorecard';

const vap = (overrides: Partial<VinylAssessmentProtocol> = {}): VinylAssessmentProtocol => ({
  vap1PhotoId: 'ph-vap1',
  damage: {},
  ...overrides,
});

const v3Assessment = (vapRecord: VinylAssessmentProtocol | null) => ({
  version: 3,
  warranted: 'yes',
  systems: ['siding'],
  sidingType: 'vinyl',
  vap: vapRecord,
  recordedAtUtc: '2026-07-28T00:00:00Z',
});

describe('extractVap', () => {
  it('returns null for null / legacy / non-vinyl assessments', () => {
    expect(extractVap(null)).toBeNull();
    expect(extractVap({ determination: 'repairable' })).toBeNull(); // legacy v1
    expect(extractVap({ version: 2, systems: ['siding'] })).toBeNull(); // v2 never carries vap
    expect(extractVap(v3Assessment(null))).toBeNull();
    expect(extractVap({ version: 3, vap: {} })).toBeNull(); // no damage map
  });

  it('returns the vap record from a v3 assessment', () => {
    const record = vap();
    expect(extractVap(v3Assessment(record))).toEqual(record);
  });
});

describe('computeVapScorecard', () => {
  it('counts unique components across questions, not damage labels', () => {
    const sc = computeVapScorecard(
      vap({
        panelsManipulated: 4,
        trimManipulated: 2,
        damage: {
          crackSplit: { answer: 'yes', components: ['1', '3'] },
          lockingEdge: { answer: 'yes', components: ['1', 'T1'] },
          nailHem: { answer: 'no', components: [] },
          reseat: { answer: 'yes', components: ['3'] },
        },
      }),
    );
    expect(sc.targetPanelsRemoved).toBe(1);
    expect(sc.panelsManipulated).toBe(4);
    expect(sc.trimManipulated).toBe(2);
    // Unique: {1, 3, T1}
    expect(sc.newCollateralDamagedComponents).toBe(3);
    expect(sc.categories.map((c) => [c.key, c.count])).toEqual([
      ['crackSplit', 2],
      ['lockingEdge', 2],
      ['nailHem', 0],
      ['trimInterface', 0],
      ['reseat', 1],
    ]);
  });

  it('renders zeros for an unanswered protocol', () => {
    const sc = computeVapScorecard(vap());
    expect(sc.panelsManipulated).toBe(0);
    expect(sc.trimManipulated).toBe(0);
    expect(sc.newCollateralDamagedComponents).toBe(0);
  });
});

describe('selectVapReportPhotos', () => {
  it('prioritizes locking edge, then crack/split, then nail-hem/trim', () => {
    const photos = selectVapReportPhotos(
      vap({
        damage: {
          crackSplit: { answer: 'yes', components: ['1'], photoId: 'ph-crack' },
          lockingEdge: { answer: 'yes', components: ['2'], photoId: 'ph-lock' },
          nailHem: { answer: 'yes', components: ['3'], photoId: 'ph-hem' },
          trimInterface: { answer: 'yes', components: ['T1'], photoId: 'ph-trim' },
        },
      }),
    );
    expect(photos.vap1PhotoId).toBe('ph-vap1');
    expect(photos.examplePhotoIds).toEqual(['ph-lock', 'ph-crack']);
  });

  it('fills from lower-priority categories when higher ones lack photos', () => {
    const photos = selectVapReportPhotos(
      vap({
        vap1PhotoId: null,
        damage: {
          nailHem: { answer: 'yes', components: ['3'], photoId: 'ph-hem' },
          reseat: { answer: 'yes', components: ['4'], photoId: 'ph-reseat' },
        },
      }),
    );
    expect(photos.vap1PhotoId).toBeNull();
    expect(photos.examplePhotoIds).toEqual(['ph-hem', 'ph-reseat']);
  });

  it('ignores yes answers without photos and no answers with photos', () => {
    const photos = selectVapReportPhotos(
      vap({
        damage: {
          lockingEdge: { answer: 'yes', components: ['2'] },
          crackSplit: { answer: 'no', components: [], photoId: 'ph-should-not-appear' },
        },
      }),
    );
    expect(photos.examplePhotoIds).toEqual([]);
  });
});

describe('buildVapReportSection', () => {
  it('returns null when there is no VAP record', () => {
    expect(buildVapReportSection(v3Assessment(null))).toBeNull();
    expect(buildVapReportSection(null)).toBeNull();
  });

  it('builds scorecard + priority photos with category labels and notes', () => {
    const section = buildVapReportSection(
      v3Assessment(
        vap({
          panelsManipulated: 3,
          damage: {
            lockingEdge: {
              answer: 'yes',
              components: ['1'],
              photoId: 'ph-lock',
              note: 'Bottom lock stretched',
            },
          },
        }),
      ),
    );
    expect(section).not.toBeNull();
    expect(section!.vap1PhotoId).toBe('ph-vap1');
    expect(section!.scorecard.panelsManipulated).toBe(3);
    expect(section!.examplePhotos).toEqual([
      {
        photoId: 'ph-lock',
        categoryKey: 'lockingEdge',
        label: 'Locking-edge / lap-joint failures',
        note: 'Bottom lock stretched',
      },
    ]);
  });
});

describe('isVapArchiveOnlyPhoto', () => {
  it('flags only the VAP final archive photo — never VAP1 or example photos', () => {
    const assessment = v3Assessment(
      vap({
        finalPhotoId: 'ph-final',
        damage: { lockingEdge: { answer: 'yes', components: ['1'], photoId: 'ph-lock' } },
      }),
    );
    expect(isVapArchiveOnlyPhoto(assessment, 'ph-final')).toBe(true);
    expect(isVapArchiveOnlyPhoto(assessment, 'ph-vap1')).toBe(false);
    expect(isVapArchiveOnlyPhoto(assessment, 'ph-lock')).toBe(false);
    // No VAP record → nothing is archive-only.
    expect(isVapArchiveOnlyPhoto(v3Assessment(null), 'ph-final')).toBe(false);
    expect(isVapArchiveOnlyPhoto(null, 'ph-final')).toBe(false);
    // Null finalPhotoId never matches.
    expect(isVapArchiveOnlyPhoto(v3Assessment(vap()), 'ph-anything')).toBe(false);
  });
});

describe('vapScorecardBriefLines', () => {
  it('renders all 9 scorecard rows', () => {
    const lines = vapScorecardBriefLines(computeVapScorecard(vap({ panelsManipulated: 2 })));
    expect(lines[0]).toMatch(/Vinyl Assessment Protocol/);
    expect(lines).toHaveLength(1 + 4 + 5);
    expect(lines.join('\n')).toContain('Target panels removed: 1');
    expect(lines.join('\n')).toContain('Panels manipulated: 2');
  });
});

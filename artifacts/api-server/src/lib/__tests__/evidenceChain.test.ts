// Pure evidence-chain helpers: linked-finding summaries, approved-only link
// extraction, server stamping/dedup, and appendix rendering (escaped output,
// omit-not-infer behavior).
import type { EstimateLineItem, EvidenceLink } from '@workspace/db';
import { describe, expect, it } from 'vitest';

import {
  buildEvidenceScopeIndexHtml,
  buildLinkedFindingSummary,
  collectApprovedScopeLinks,
  normalizeEvidenceLinks,
} from '../evidenceChain';

const damage = {
  id: 'dmg-11111111',
  slopeId: 'slope-1',
  elevationId: null,
  damageType: 'hail',
  severity: 'moderate',
  notes: 'circular bruising',
};
const lookups = {
  damageById: new Map([[damage.id, damage]]),
  slopeById: new Map([['slope-1', { id: 'slope-1', label: 'A' }]]),
};

describe('buildLinkedFindingSummary', () => {
  it('returns null without a subject link', () => {
    expect(buildLinkedFindingSummary({ subjectType: null, subjectId: null }, lookups)).toBeNull();
  });

  it('builds a rich summary for a damage instance with slope location', () => {
    const s = buildLinkedFindingSummary(
      { subjectType: 'damage_instance', subjectId: damage.id },
      lookups,
    );
    expect(s).toMatchObject({
      subjectType: 'damage_instance',
      subjectId: damage.id,
      location: 'Slope A',
    });
    expect(s!.displayRef).toContain('hail');
    expect(s!.observedCondition).toContain('moderate');
  });

  it('falls back to a stable reference for unknown subjects — never invents detail', () => {
    const s = buildLinkedFindingSummary(
      { subjectType: 'test_square', subjectId: 'ts-abcdef12345' },
      lookups,
    );
    expect(s!.displayRef).toBe('test square ts-abcde');
    expect(s!.location).toBeNull();
    expect(s!.observedCondition).toBeNull();
  });
});

describe('collectApprovedScopeLinks', () => {
  const mkLink = (over: Partial<EvidenceLink>): EvidenceLink => ({
    targetType: 'photo',
    targetId: 'p1',
    linkSource: 'inspector',
    reviewStatus: 'approved',
    reviewedBy: 'u1',
    reviewedAt: '2026-07-25T00:00:00Z',
    ...over,
  });
  const line = (links: EvidenceLink[]): EstimateLineItem => ({
    priceBookItemId: null,
    description: 'Replace shingles',
    unit: null,
    quantity: 1,
    unitPriceCents: 100,
    totalCents: 100,
    isAdder: false,
    evidenceLinks: links,
  });

  it('includes ONLY approved links — unreviewed/rejected (incl. AI) are excluded', () => {
    const out = collectApprovedScopeLinks([
      line([
        mkLink({}),
        mkLink({ targetId: 'p2', linkSource: 'ai_suggested', reviewStatus: 'unreviewed', reviewedBy: null, reviewedAt: null }),
        mkLink({ targetId: 'd1', targetType: 'damage_instance', reviewStatus: 'rejected' }),
      ]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].photoIds).toEqual(['p1']);
    expect(out[0].damageInstanceIds).toEqual([]);
    expect(out[0].linkSources).toEqual({ p1: 'inspector' });
  });

  it('returns empty for lines without approved links and preserves line index', () => {
    const out = collectApprovedScopeLinks([
      line([]),
      line([mkLink({ targetType: 'damage_instance', targetId: 'd9' })]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].scopeLineIndex).toBe(1);
    expect(out[0].damageInstanceIds).toEqual(['d9']);
  });
});

describe('normalizeEvidenceLinks', () => {
  const ctx = {
    validPhotoIds: new Set(['p1']),
    validDamageInstanceIds: new Set(['d1']),
    reviewerUserId: 'reviewer-1',
    now: '2026-07-25T12:00:00.000Z',
  };

  it('rejects dangling target ids', () => {
    const r = normalizeEvidenceLinks(
      [{ targetType: 'photo', targetId: 'nope', linkSource: 'inspector', reviewStatus: 'approved' }],
      ctx,
    );
    expect(r).toHaveProperty('error');
  });

  it('stamps reviewer server-side for approved links and nulls for unreviewed', () => {
    const r = normalizeEvidenceLinks(
      [
        { targetType: 'photo', targetId: 'p1', linkSource: 'inspector', reviewStatus: 'approved' },
        { targetType: 'damage_instance', targetId: 'd1', linkSource: 'ai_suggested', reviewStatus: 'unreviewed' },
      ],
      ctx,
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.links[0]).toMatchObject({ reviewedBy: 'reviewer-1', reviewedAt: ctx.now });
    expect(r.links[1]).toMatchObject({ reviewedBy: null, reviewedAt: null });
  });

  it('dedupes repeated targets and preserves prior stamps for unchanged decisions', () => {
    const prior = new Map<string, EvidenceLink>([
      [
        'photo:p1',
        {
          targetType: 'photo',
          targetId: 'p1',
          linkSource: 'inspector',
          reviewStatus: 'approved',
          reviewedBy: 'original-reviewer',
          reviewedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    ]);
    const r = normalizeEvidenceLinks(
      [
        { targetType: 'photo', targetId: 'p1', linkSource: 'inspector', reviewStatus: 'approved' },
        { targetType: 'photo', targetId: 'p1', linkSource: 'inspector', reviewStatus: 'approved' },
      ],
      { ...ctx, prior },
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.links).toHaveLength(1);
    expect(r.links[0].reviewedBy).toBe('original-reviewer');
    expect(r.links[0].reviewedAt).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('buildEvidenceScopeIndexHtml', () => {
  it('returns null with no approved links', () => {
    expect(
      buildEvidenceScopeIndexHtml({ approvedScopeLinks: [], manifestPhotos: [], findingDisplayById: new Map() }),
    ).toBeNull();
  });

  it('renders escaped rows and omits (never infers) missing finding links', () => {
    const html = buildEvidenceScopeIndexHtml({
      approvedScopeLinks: [
        {
          scopeLineIndex: 0,
          scopeDescription: 'Replace <b>shingles</b>',
          photoIds: ['p1'],
          damageInstanceIds: ['d1'],
          linkSources: { p1: 'inspector', d1: 'inspector' },
        },
      ],
      manifestPhotos: [
        { photoId: 'p1', stage: 'roof', subjectType: null, triadRole: null, zone: 'Slope A', linkedFinding: null },
      ],
      findingDisplayById: new Map([['d1', { displayRef: 'Finding d1 — hail', location: 'Slope A' }]]),
    });
    expect(html).toBeTruthy();
    expect(html).not.toContain('<b>shingles</b>'); // escaped
    expect(html).toContain('Replace &lt;b&gt;shingles&lt;/b&gt;');
    expect(html).toContain('Finding d1 — hail');
    // Photo p1 has no linked finding — cell is an em-dash, not an inference.
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('Approved');
  });
});

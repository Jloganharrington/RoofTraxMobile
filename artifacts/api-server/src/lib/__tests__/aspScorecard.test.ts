import { describe, expect, it } from 'vitest';
import type { AluminumSidingProtocol } from '@workspace/db';
import {
  aspScorecardBriefLines,
  buildAspReportSection,
  computeAspScorecard,
  extractAsp,
} from '../aspScorecard';
import {
  assembleSectionHtml,
  buildRepairabilityProtocolNarrativePrompt,
} from '../sectionGeneration';

const asp = (overrides: Partial<AluminumSidingProtocol> = {}): AluminumSidingProtocol => ({
  elevations: [{ elevation: 'north', accessible: true, rakingPhotoId: 'raking-north' }],
  testSquares: [{ elevation: 'north', impactCount: 2, photoId: 'square-north' }],
  findings: {},
  compatibility: {},
  ...overrides,
});

const assessment = (record: AluminumSidingProtocol | null) => ({
  version: 3,
  warranted: 'yes',
  systems: ['siding'],
  sidingType: 'aluminum',
  asp: record,
  recordedAtUtc: '2026-08-19T00:00:00Z',
});

describe('ASP scorecard', () => {
  it('only extracts a well-shaped v3 ASP record', () => {
    expect(extractAsp(null)).toBeNull();
    expect(extractAsp({ version: 2 })).toBeNull();
    expect(extractAsp({ version: 3, asp: {} })).toBeNull();
    expect(extractAsp(assessment(asp()))).toEqual(asp());
  });

  it('counts documented observations without inferring destructive test results', () => {
    const scorecard = computeAspScorecard(asp({
      elevations: [
        { elevation: 'north', accessible: true },
        { elevation: 'south', accessible: false, inaccessibleReason: 'Steep landscaped grade' },
      ],
      testSquares: [
        { elevation: 'north', impactCount: 3 },
        { elevation: 'north', impactCount: 1 },
      ],
      findings: {
        impactDeformation: { answer: 'yes', elevations: ['north'] },
        finishVariance: { answer: 'yes', elevations: ['north', 'south'] },
      },
      compatibility: { profileExposure: 'matched', gauge: 'not_matched' },
    }));
    expect(scorecard.surveyedElevations).toBe(2);
    expect(scorecard.accessibleElevations).toBe(1);
    expect(scorecard.documentedImpacts).toBe(4);
    expect(scorecard.affirmativeConditions).toBe(2);
    expect(scorecard.matchedCompatibilityCriteria).toBe(1);
    expect(scorecard.unmatchedCompatibilityCriteria).toBe(1);
    expect(scorecard.categories.find((c) => c.key === 'finishVariance')?.count).toBe(2);
  });

  it('builds a report section from unique, observed photo references', () => {
    const section = buildAspReportSection(assessment(asp({
      referencePhotoId: 'reference',
      elevations: [{ elevation: 'north', accessible: true, rakingPhotoId: 'raking' }],
      testSquares: [{ elevation: 'north', impactCount: 1, photoId: 'square' }],
      findings: {
        impactDeformation: { answer: 'yes', elevations: ['north'], photoId: 'damage', note: 'Visible shallow deformation' },
      },
      compatibility: { profileExposure: 'matched' },
      conclusion: 'repair_not_supported_product',
      conclusionBasis: 'Observed profile and finish do not match available product.',
    })));
    expect(section?.referencePhotoId).toBe('reference');
    expect(section?.rakingPhotoIds).toEqual(['raking']);
    expect(section?.testSquarePhotoIds).toEqual(['square']);
    expect(section?.examplePhotos).toEqual([
      { photoId: 'damage', label: 'Impact deformation', note: 'Visible shallow deformation' },
    ]);
    expect(aspScorecardBriefLines(section!.scorecard).join('\n')).toContain('non-destructive');
  });

  it('preserves zero-count test squares and states every observation limit', () => {
    const record = asp({
      assessmentConditions: { lightingTechnique: 'diffuse_only' },
      elevations: [{ elevation: 'north', accessible: true, wrb: 'absent' }],
      testSquares: [{ elevation: 'north', impactCount: 0 }],
      findings: {
        impactDeformation: { answer: 'yes', elevations: ['north'], photoId: 'impact' },
        coatingBreach: { answer: 'yes', elevations: ['north'], photoId: 'coating' },
        chalking: { answer: 'yes', elevations: ['north'], photoId: 'chalking' },
      },
    });
    const section = buildAspReportSection(assessment(record));
    const lines = aspScorecardBriefLines(section!.scorecard).join('\n');
    expect(section!.scorecard.documentedImpacts).toBe(0);
    expect(section!.scorecard.diffuseOnly).toBe(true);
    expect(section!.scorecard.deformationWithoutRakingPhoto).toEqual(['north']);
    expect(section!.examplePhotos.map((photo) => photo.photoId)).toEqual(['impact', 'coating']);
    expect(lines).toContain('Diffuse-light qualifier');
    expect(lines).toContain('Test-square scope');
    expect(lines).toContain('Missing raking-light frame');
    expect(lines).toContain('no manipulation was performed');
  });
});

describe('ASP narrative instruction', () => {
  it('keeps an ASP-only record out of RAP/simulated-repair framing', () => {
    const prompt = buildRepairabilityProtocolNarrativePrompt(
      'FIELD RECORD',
      null,
      ['Aluminum Siding Forensic Inspection Protocol (non-destructive) scorecard:'],
      { hasRap: false, hasVap: false, hasAsp: true },
    );
    expect(prompt).toContain('ASP-only');
    expect(prompt).toContain('non-destructive observations');
    expect(prompt).toContain('Do not name or describe a Repair Attempt Protocol');
  });

  it('keeps combined RAP and ASP records in separate protocol lanes', () => {
    const prompt = buildRepairabilityProtocolNarrativePrompt(
      'FIELD RECORD',
      'damaged_target',
      ['RAP scorecard', 'Aluminum Siding Forensic Inspection Protocol scorecard'],
      { hasRap: true, hasVap: false, hasAsp: true },
    );
    expect(prompt).toContain('both a RAP and an ASP');
    expect(prompt).toContain('separate, clearly labeled paragraphs');
    expect(prompt).toContain('Never transfer RAP manipulation language to ASP');
  });

  it('uses a protocol-neutral report heading and TOC for the retained section key', () => {
    const html = assembleSectionHtml([{
      sectionType: 'rap_narrative',
      contentHtml: '<p>ASP observations.</p>',
      lockedAt: null,
      lockedBy: null,
      libraryVersionSnapshot: null,
    }]);
    expect(html).toContain('Repairability Protocol Narrative');
    expect(html).not.toContain('Repair Attempt Protocol Narrative');
  });
});
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { composeAiSystemPrompt } from '../aiSummaryPrompt';
import {
  CARRIER_FACING_CONTENT_CLASSES,
  CONTENT_CLASSES,
  CONTRACTOR_LANE_POLICY,
  lintReportFragments,
  stripHtmlForLint,
} from '../contentPolicy';

// Contractor-lane content controls: shared prompt policy consumed by both
// generation models + server-side lint gate over all AI fragments.

describe('shared prompt policy', () => {
  it('Claude summary system prompt always includes the contractor-lane policy', () => {
    expect(composeAiSystemPrompt(null)).toContain(CONTRACTOR_LANE_POLICY);
    // Company additions append AFTER the policy — they can never displace it.
    const withCompany = composeAiSystemPrompt('Always mention our warranty.');
    expect(withCompany).toContain(CONTRACTOR_LANE_POLICY);
    expect(withCompany.indexOf(CONTRACTOR_LANE_POLICY)).toBeLessThan(
      withCompany.indexOf('Always mention our warranty.'),
    );
  });

  it('Gemini compile prompt is built from the same shared policy module', () => {
    // The compile route interpolates CONTRACTOR_LANE_POLICY directly into the
    // Gemini prompt template — assert against the source so a refactor that
    // drops the shared module (or forks the text) fails loudly.
    const source = readFileSync(join(__dirname, '../../routes/inspections.ts'), 'utf-8');
    expect(source).toContain('${CONTRACTOR_LANE_POLICY}');
    expect(source).toContain("from '../lib/contentPolicy'");
  });

  it('policy text prohibits the advocacy lanes by name', () => {
    for (const phrase of ['coverage determinations', 'Policy interpretation', 'bad faith', 'Legal conclusions']) {
      expect(CONTRACTOR_LANE_POLICY.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });
});

describe('content classes', () => {
  it('defines exactly the six required classes', () => {
    expect([...CONTENT_CLASSES].sort()).toEqual(
      [
        'attestation',
        'construction_fact',
        'inspection_methodology',
        'internal_metadata',
        'photo_narrative',
        'repairability_analysis',
      ].sort(),
    );
  });

  it('internal_metadata is never carrier-facing', () => {
    expect(CARRIER_FACING_CONTENT_CLASSES.has('internal_metadata')).toBe(false);
    expect(CARRIER_FACING_CONTENT_CLASSES.has('construction_fact')).toBe(true);
    expect(CARRIER_FACING_CONTENT_CLASSES.has('attestation')).toBe(true);
  });
});

const frag = (text: string, contentClass: 'construction_fact' | 'repairability_analysis' = 'construction_fact') =>
  [{ fragmentRef: 'forensicSummary', contentClass, text }];

describe('lintReportFragments — blocked lanes', () => {
  it.each([
    ['The insurer must pay for full replacement of the roof.', 'payment_demand'],
    ['We demand full settlement of this claim.', 'payment_demand'],
    ['The carrier acted in bad faith when reviewing this claim.', 'bad_faith_accusation'],
    ['This appears to be an improper denial of the claim.', 'bad_faith_accusation'],
    ['The damage is covered under the terms of the policy.', 'coverage_determination'],
    ['This is a covered loss.', 'coverage_determination'],
    ['Under the policy, matching shingles are required.', 'policy_interpretation'],
    ['The carrier is liable for the ensuing interior damage.', 'legal_conclusion'],
    ['On behalf of the insured we request immediate payment.', 'policyholder_representation'],
  ])('blocks: %s', (text, expectedRule) => {
    const result = lintReportFragments(frag(text));
    expect(result.lintStatus).toBe('blocked');
    expect(result.findings.map((f) => f.ruleId)).toContain(expectedRule);
    const finding = result.findings.find((f) => f.ruleId === expectedRule)!;
    expect(finding.fragmentRef).toBe('forensicSummary');
    expect(finding.severity).toBe('blocked');
    expect(text.toLowerCase()).toContain(finding.matchedText.toLowerCase().slice(0, 10));
  });
});

describe('lintReportFragments — technical construction language passes', () => {
  it.each([
    'The inspection documentation identifies hail impact fractures on the north slope.',
    'The ridge is covered with cap shingles showing granule loss consistent with hail impact.',
    'The observed condition is consistent with wind uplift along the eave course.',
    'Test square analysis recorded 12 impacts per square on the west-facing slope.',
    'The decking was covered by two layers of felt underlayment.',
    'The repairability assessment records brittle shingles that fractured during the lift test.',
  ])('passes: %s', (text) => {
    const result = lintReportFragments(frag(text));
    expect(result.lintStatus).toBe('passed');
    expect(result.findings).toHaveLength(0);
  });
});

describe('lintReportFragments — needs_review lane', () => {
  it('flags unattributed absolute claims without blocking', () => {
    const result = lintReportFragments(frag('The roof cannot be repaired and must be fully replaced.'));
    expect(result.lintStatus).toBe('needs_review');
    expect(result.findings.every((f) => f.severity === 'needs_review')).toBe(true);
  });

  it('a single blocked finding outranks needs_review findings', () => {
    const result = lintReportFragments(
      frag('The roof cannot be repaired. The insurer must pay for the replacement.'),
    );
    expect(result.lintStatus).toBe('blocked');
    expect(result.findings.some((f) => f.severity === 'needs_review')).toBe(true);
    expect(result.findings.some((f) => f.severity === 'blocked')).toBe(true);
  });
});

describe('lintReportFragments — mechanics', () => {
  it('strips HTML before matching', () => {
    expect(stripHtmlForLint('<p>The <strong>insurer</strong> must pay.</p>')).toBe('The insurer must pay.');
    const result = lintReportFragments([
      {
        fragmentRef: 'attestationHtml',
        contentClass: 'attestation',
        text: '<p>The insurer <em>must pay</em> this claim.</p>',
        isHtml: true,
      },
    ]);
    expect(result.lintStatus).toBe('blocked');
  });

  it('skips internal_metadata fragments', () => {
    const result = lintReportFragments([
      { fragmentRef: 'evidenceManifest', contentClass: 'internal_metadata', text: 'bad faith bad faith' },
    ]);
    expect(result.lintStatus).toBe('passed');
  });

  it('reports per-fragment refs across multiple fragments', () => {
    const result = lintReportFragments([
      { fragmentRef: 'forensicSummary', contentClass: 'construction_fact', text: 'Hail impacts documented.' },
      {
        fragmentRef: 'photoGroupings[1].narrative',
        contentClass: 'photo_narrative',
        text: 'This proves the carrier acted in bad faith.',
      },
    ]);
    expect(result.lintStatus).toBe('blocked');
    expect(result.findings.map((f) => f.fragmentRef)).toContain('photoGroupings[1].narrative');
    expect(result.findings.map((f) => f.fragmentRef)).not.toContain('forensicSummary');
  });
});

import { describe, expect, it } from 'vitest';

import {
  BASELINE_AI_SYSTEM_PROMPT,
  composeAiSystemPrompt,
  parseAiSummaryResponse,
} from '../aiSummaryPrompt';

describe('composeAiSystemPrompt', () => {
  it('returns the baseline verbatim when there are no company additions', () => {
    expect(composeAiSystemPrompt()).toBe(BASELINE_AI_SYSTEM_PROMPT);
    expect(composeAiSystemPrompt(null)).toBe(BASELINE_AI_SYSTEM_PROMPT);
    expect(composeAiSystemPrompt('   ')).toBe(BASELINE_AI_SYSTEM_PROMPT);
  });

  it('appends company additions after the full baseline, never replacing it', () => {
    const composed = composeAiSystemPrompt('Always mention the company name RoofTrax.');
    expect(composed.startsWith(BASELINE_AI_SYSTEM_PROMPT)).toBe(true);
    expect(composed).toContain('ADDITIONAL COMPANY INSTRUCTIONS');
    expect(composed).toContain('Always mention the company name RoofTrax.');
    expect(composed.indexOf('ADDITIONAL COMPANY INSTRUCTIONS')).toBeGreaterThan(
      BASELINE_AI_SYSTEM_PROMPT.length - 1,
    );
  });

  it('baseline contains the key sections of the supplied prompt verbatim', () => {
    expect(BASELINE_AI_SYSTEM_PROMPT).toContain('forensic property-inspection summary writer');
    expect(BASELINE_AI_SYSTEM_PROMPT).toContain('CORE OUTPUT REQUIREMENT');
    expect(BASELINE_AI_SYSTEM_PROMPT).toContain('"summary"');
    expect(BASELINE_AI_SYSTEM_PROMPT).toContain('missing_or_unverified_items');
    expect(BASELINE_AI_SYSTEM_PROMPT).toContain('CONFIDENCE DEFINITIONS');
  });
});

describe('parseAiSummaryResponse', () => {
  it('parses the new baseline output shape', () => {
    const raw = JSON.stringify({
      summary: 'Para one.\n\nPara two.',
      confidence: 'moderate',
      missing_or_unverified_items: ['Product identification remains incomplete.'],
      quality_flags: ['Storm data present but no causation opinion supplied.'],
    });
    const out = parseAiSummaryResponse(raw);
    expect(out.forensicSummary).toBe('Para one.\n\nPara two.');
    expect(out.repairabilityText).toBe('');
    expect(out.confidence).toBe('moderate');
    expect(out.missingOrUnverifiedItems).toEqual(['Product identification remains incomplete.']);
    expect(out.qualityFlags).toEqual(['Storm data present but no causation opinion supplied.']);
  });

  it('still accepts the legacy shape', () => {
    const raw = JSON.stringify({ forensicSummary: 'Legacy narrative.', repairabilityText: 'Repairable.' });
    const out = parseAiSummaryResponse(raw);
    expect(out.forensicSummary).toBe('Legacy narrative.');
    expect(out.repairabilityText).toBe('Repairable.');
    expect(out.confidence).toBeUndefined();
  });

  it('falls back to raw text on invalid JSON', () => {
    const out = parseAiSummaryResponse('Just plain prose, not JSON.');
    expect(out.forensicSummary).toBe('Just plain prose, not JSON.');
    expect(out.repairabilityText).toBe('');
  });

  it('ignores malformed confidence and empty arrays', () => {
    const raw = JSON.stringify({
      summary: 'S.',
      confidence: 'VERY HIGH',
      missing_or_unverified_items: [],
      quality_flags: [42],
    });
    const out = parseAiSummaryResponse(raw);
    expect(out.confidence).toBeUndefined();
    expect(out.missingOrUnverifiedItems).toBeUndefined();
    expect(out.qualityFlags).toBeUndefined();
  });

  it('uses the cleaned text (fences stripped) when provided', () => {
    const inner = JSON.stringify({ summary: 'Fenced.' });
    const out = parseAiSummaryResponse('```json\n' + inner + '\n```', inner);
    expect(out.forensicSummary).toBe('Fenced.');
  });
});

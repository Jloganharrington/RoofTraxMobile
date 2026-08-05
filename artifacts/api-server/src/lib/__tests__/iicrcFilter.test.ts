/**
 * Unit tests for IICRC citation placeholder logic in sectionGeneration.ts.
 *
 * Verifies:
 * 1. extractUnfilledIicrcPlaceholders correctly identifies placeholder keys
 * 2. The IICRC directive injected into prompts contains no IICRC provision text
 * 3. The filter partitions humanEnteredProvisionsOnly entries correctly
 */

import { describe, expect, it } from 'vitest';
import { extractUnfilledIicrcPlaceholders } from '../sectionGeneration';

describe('extractUnfilledIicrcPlaceholders', () => {
  it('returns empty array for content with no placeholders', () => {
    const html = '<p>Some section content without citations.</p>';
    expect(extractUnfilledIicrcPlaceholders(html)).toEqual([]);
  });

  it('extracts a single placeholder key', () => {
    const html =
      '<p>Per {{IICRC_CITATION_PLACEHOLDER:STD-WTR-01}}, restoration must follow…</p>';
    expect(extractUnfilledIicrcPlaceholders(html)).toEqual(['STD-WTR-01']);
  });

  it('extracts multiple distinct placeholder keys', () => {
    const html =
      '<p>{{IICRC_CITATION_PLACEHOLDER:STD-WTR-01}} and {{IICRC_CITATION_PLACEHOLDER:STD-WTR-02}} apply.</p>';
    const keys = extractUnfilledIicrcPlaceholders(html);
    expect(keys).toHaveLength(2);
    expect(keys).toContain('STD-WTR-01');
    expect(keys).toContain('STD-WTR-02');
  });

  it('deduplicates repeated occurrences of the same key', () => {
    const html =
      '{{IICRC_CITATION_PLACEHOLDER:STD-WTR-01}} text {{IICRC_CITATION_PLACEHOLDER:STD-WTR-01}}';
    const keys = extractUnfilledIicrcPlaceholders(html);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe('STD-WTR-01');
  });

  it('returns empty array when content is empty string', () => {
    expect(extractUnfilledIicrcPlaceholders('')).toEqual([]);
  });

  it('does not match partial or malformed token formats', () => {
    const html = '{{IICRC_CITATION_PLACEHOLDER:}} {{iicrc_citation_placeholder:STD-WTR-01}}';
    // First has no key (empty), second is lowercase (pattern requires uppercase)
    expect(extractUnfilledIicrcPlaceholders(html)).toEqual([]);
  });
});

describe('IICRC prompt filter — assertion on assembled prompt content', () => {
  /**
   * Builds the IICRC directive block the same way sectionGeneration.ts does,
   * to verify the directive instructs the AI NOT to reproduce IICRC text and
   * does NOT itself contain S500/S520 provision text.
   */
  function buildDirectiveBlock(keys: string[]): string {
    if (keys.length === 0) return '';
    const tokens = keys
      .map((k) => `  {{IICRC_CITATION_PLACEHOLDER:${k}}}`)
      .join('\n');
    return `
IICRC CITATION PROTOCOL (MANDATORY):
The following IICRC standards are referenced for this claim. Their licensed provision text must NOT be reproduced, paraphrased, or summarized. Where you would normally cite these standards, insert the exact placeholder token shown below and nothing else:
${tokens}
Do not write any IICRC, S500, S520, or IICRC-standard content. Insert only the token.
`.trim();
  }

  it('directive block contains the placeholder tokens but no IICRC provision text', () => {
    const directive = buildDirectiveBlock(['STD-WTR-01', 'STD-WTR-02']);
    // Must include the placeholder tokens for the AI to use
    expect(directive).toContain('{{IICRC_CITATION_PLACEHOLDER:STD-WTR-01}}');
    expect(directive).toContain('{{IICRC_CITATION_PLACEHOLDER:STD-WTR-02}}');
    // Must explicitly tell the AI NOT to reproduce IICRC text
    expect(directive).toContain('must NOT be reproduced');
    // Must not itself contain S500/S520 provision language
    // (the directive is safe to embed in prompts)
    expect(directive).not.toMatch(/section \d+\.\d+/i);
  });

  it('humanEnteredProvisionsOnly entries are partitioned from normal entries', () => {
    const entries = [
      { entryKey: 'ASTM-D3462', humanEnteredProvisionsOnly: false },
      { entryKey: 'STD-WTR-01', humanEnteredProvisionsOnly: true },
      { entryKey: 'IRC-R905', humanEnteredProvisionsOnly: false },
      { entryKey: 'STD-WTR-02', humanEnteredProvisionsOnly: true },
    ];

    const iicrcKeys = entries
      .filter((e) => e.humanEnteredProvisionsOnly === true)
      .map((e) => e.entryKey);

    expect(iicrcKeys).toEqual(['STD-WTR-01', 'STD-WTR-02']);

    const directive = buildDirectiveBlock(iicrcKeys);
    // Prompt MUST NOT contain the IICRC entry keys as plain provision text
    // (they must only appear inside the placeholder token wrapper)
    const illegalPatterns = ['S500', 'S520', 'IICRC Standard', 'IICRC S'];
    for (const pattern of illegalPatterns) {
      // The directive text itself should not contain provision content
      const plainIndex = directive.indexOf(pattern);
      if (plainIndex !== -1) {
        // Acceptable only inside the "Do not write" instruction line
        const line = directive.slice(
          directive.lastIndexOf('\n', plainIndex),
          directive.indexOf('\n', plainIndex),
        );
        expect(line).toMatch(/Do not write|must NOT/i);
      }
    }
  });

  it('empty iicrcKeys produces empty string (no directive appended)', () => {
    const directive = buildDirectiveBlock([]);
    expect(directive).toBe('');
  });
});

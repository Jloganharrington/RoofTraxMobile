/**
 * Parse a combined Markdown file into Standards + Detriment entries.
 *
 * Expected format
 * ───────────────
 * # Standards
 *
 * ## ASTM-D3161
 * Source Type: ASTM
 * Citation Text: Standard Test Method for Wind-Resistance of Steep-Slope Roofing Products
 * Authority Limit: Supports wind uplift claims for asphalt shingles rated to this standard
 * Locator Template: ASTM D3161
 * Verification Status: verified
 *
 * ## IRC-R902.1
 * Source Type: IRC
 * Citation Text: ...
 *
 * # Detriments
 *
 * ## DET-WIND-01
 * Applicability Conditions: wind_damage, tab_fracture
 * Statement: Wind uplift caused complete or partial tab separation along the rake edge.
 * Required Support: Pattern documentation showing directional separation consistent with wind
 * Limitation: Applies to 3-tab asphalt shingles only
 *
 * Rules
 * ─────
 * - Top-level `# Standards` and `# Detriments` section headers are case-insensitive.
 * - Each entry begins with `## ENTRY-KEY` (the key is everything after `## `, trimmed).
 * - Fields are `Field Name: value` lines; unknown field names are ignored.
 * - If a line does not match `Key: Value`, it is treated as a continuation of the
 *   previous field's value (useful for multi-line citation text etc.).
 * - Applicability Conditions are comma-separated on a single line.
 * - An entry with no Statement is skipped with a warning (detriments only).
 */

export interface ParsedStandard {
  entryKey: string;
  sourceType: string;
  citationText: string;
  authorityLimit: string;
  locatorTemplate: string;
  verificationStatus: 'verified' | 'verify_before_ship';
}

export interface ParsedDetriment {
  entryKey: string;
  applicabilityConditions: string[];
  statement: string;
  requiredSupport: string;
  limitation: string;
}

export interface ParsedMdLibrary {
  standards: ParsedStandard[];
  detriments: ParsedDetriment[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SectionType = 'standards' | 'detriments' | null;

// Normalise a field label for lookup.
const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

// Field-name aliases → canonical keys for Standards.
const STD_FIELDS: Record<string, keyof Omit<ParsedStandard, 'entryKey'>> = {
  'source type': 'sourceType',
  'citation text': 'citationText',
  'authority limit': 'authorityLimit',
  'locator template': 'locatorTemplate',
  'verification status': 'verificationStatus',
  verified: 'verificationStatus',
};

// Field-name aliases → canonical keys for Detriments.
const DET_FIELDS: Record<string, keyof Omit<ParsedDetriment, 'entryKey'>> = {
  'applicability conditions': 'applicabilityConditions',
  'conditions': 'applicabilityConditions',
  'applicable conditions': 'applicabilityConditions',
  'statement': 'statement',
  'required support': 'requiredSupport',
  'limitation': 'limitation',
};

function blankStd(key: string): ParsedStandard {
  return {
    entryKey: key,
    sourceType: '',
    citationText: '',
    authorityLimit: '',
    locatorTemplate: '',
    verificationStatus: 'verify_before_ship',
  };
}

function blankDet(key: string): ParsedDetriment {
  return {
    entryKey: key,
    applicabilityConditions: [],
    statement: '',
    requiredSupport: '',
    limitation: '',
  };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseMdLibrary(text: string): ParsedMdLibrary {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];
  const standards: ParsedStandard[] = [];
  const detriments: ParsedDetriment[] = [];

  let section: SectionType = null;
  let currentStd: ParsedStandard | null = null;
  let currentDet: ParsedDetriment | null = null;
  let lastFieldStd: keyof Omit<ParsedStandard, 'entryKey'> | null = null;
  let lastFieldDet: keyof Omit<ParsedDetriment, 'entryKey'> | null = null;

  function flushStd() {
    if (!currentStd) return;
    if (!currentStd.entryKey) { warnings.push('Skipped a standards entry with no key.'); return; }
    standards.push(currentStd);
    currentStd = null;
    lastFieldStd = null;
  }

  function flushDet() {
    if (!currentDet) return;
    if (!currentDet.entryKey) { warnings.push('Skipped a detriment entry with no key.'); return; }
    if (!currentDet.statement.trim()) {
      warnings.push(`Detriment "${currentDet.entryKey}" has no Statement — skipped.`);
      currentDet = null; lastFieldDet = null; return;
    }
    detriments.push(currentDet);
    currentDet = null;
    lastFieldDet = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // ── Top-level section header: # Standards / # Detriments ──────────────
    if (/^#\s+/u.test(line) && !/^##\s+/u.test(line)) {
      flushStd(); flushDet();
      const header = line.replace(/^#+\s+/, '').toLowerCase();
      if (header.includes('standard')) { section = 'standards'; }
      else if (header.includes('detriment')) { section = 'detriments'; }
      else { section = null; }
      continue;
    }

    // ── Entry header: ## ENTRY-KEY ─────────────────────────────────────────
    if (/^##\s+/u.test(line)) {
      flushStd(); flushDet();
      const key = line.replace(/^#{1,6}\s+/, '').trim();
      if (!key) continue;
      if (section === 'standards') { currentStd = blankStd(key); }
      else if (section === 'detriments') { currentDet = blankDet(key); }
      continue;
    }

    // ── Field line: Key: Value ─────────────────────────────────────────────
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const maybeKey = norm(line.slice(0, colonIdx));
      const value = line.slice(colonIdx + 1).trim();

      if (section === 'standards' && currentStd) {
        const field = STD_FIELDS[maybeKey];
        if (field) {
          if (field === 'verificationStatus') {
            currentStd.verificationStatus =
              value.toLowerCase() === 'verified' ? 'verified' : 'verify_before_ship';
          } else {
            (currentStd as Record<string, unknown>)[field] = value;
          }
          lastFieldStd = field;
          continue;
        }
      }

      if (section === 'detriments' && currentDet) {
        const field = DET_FIELDS[maybeKey];
        if (field) {
          if (field === 'applicabilityConditions') {
            currentDet.applicabilityConditions = value
              .split(',')
              .map((c) => c.trim().toLowerCase().replace(/\s+/g, '_'))
              .filter(Boolean);
          } else {
            (currentDet as Record<string, unknown>)[field] = value;
          }
          lastFieldDet = field;
          continue;
        }
      }
    }

    // ── Continuation line (no recognised Key: prefix) ──────────────────────
    const cont = line.trim();
    if (!cont) { lastFieldStd = null; lastFieldDet = null; continue; }

    if (section === 'standards' && currentStd && lastFieldStd && lastFieldStd !== 'verificationStatus') {
      const prev = (currentStd as Record<string, unknown>)[lastFieldStd] as string;
      (currentStd as Record<string, unknown>)[lastFieldStd] = prev + ' ' + cont;
    }
    if (section === 'detriments' && currentDet && lastFieldDet &&
        lastFieldDet !== 'applicabilityConditions') {
      const prev = (currentDet as Record<string, unknown>)[lastFieldDet] as string;
      (currentDet as Record<string, unknown>)[lastFieldDet] = prev + ' ' + cont;
    }
  }

  flushStd();
  flushDet();

  return { standards, detriments, warnings };
}

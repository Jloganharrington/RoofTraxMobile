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
// Boilerplate multi-section parser
// ---------------------------------------------------------------------------

/**
 * Maps a heading string to a known boilerplate section key.
 * Accepts both the human label ("Attestation Block A") and the raw key
 * ("attestation_block_a"), case-insensitive.
 */
const BP_LABEL_TO_KEY: Record<string, string> = {
  'opening statement': 'opening_statement',
  'inspection method': 'inspection_method',
  'caption patterns': 'caption_patterns',
  'rap field protocol': 'rap_field_protocol',
  'attestation block a': 'attestation_block_a',
  'attestation block b': 'attestation_block_b',
  'attestation block c': 'attestation_block_c',
  'uniform inspection procedure': 'uniform_inspection_procedure',
  'product id methodology': 'product_id_methodology',
  'scope block': 'scope_block',
  'std-rpr-01 source record': 'std_rpr_01_source_record',
  'std rpr 01 source record': 'std_rpr_01_source_record',
  // raw key aliases
  'opening_statement': 'opening_statement',
  'inspection_method': 'inspection_method',
  'caption_patterns': 'caption_patterns',
  'rap_field_protocol': 'rap_field_protocol',
  'attestation_block_a': 'attestation_block_a',
  'attestation_block_b': 'attestation_block_b',
  'attestation_block_c': 'attestation_block_c',
  'uniform_inspection_procedure': 'uniform_inspection_procedure',
  'product_id_methodology': 'product_id_methodology',
  'scope_block': 'scope_block',
  'std_rpr_01_source_record': 'std_rpr_01_source_record',
};

export interface ParsedBpSection {
  sectionKey: string;
  content: string;
}

export interface ParsedMdBoilerplate {
  sections: ParsedBpSection[];
  unrecognised: string[]; // heading texts that didn't match any known key
}

/**
 * Parse a `.md` file that contains multiple boilerplate sections separated
 * by top-level `#` headings. Each heading must match a known section label
 * or key. Content between headings is trimmed and stored verbatim.
 *
 * Example:
 *   # Attestation Block A
 *   ...content...
 *
 *   # Attestation Block B
 *   ...content...
 */
export function parseMdBoilerplate(text: string): ParsedMdBoilerplate {
  const sections: ParsedBpSection[] = [];
  const unrecognised: string[] = [];

  // Split the file at every top-level `#` heading (not `##` or deeper).
  // The regex captures the heading text and everything until the next heading.
  const chunks = text.split(/^(#\s+[^\n]+)/m);
  // chunks: ['preamble', '# Heading A', 'body A', '# Heading B', 'body B', ...]

  for (let i = 1; i < chunks.length; i += 2) {
    const headingRaw = chunks[i]!.replace(/^#+\s*/, '').trim();
    const body = (chunks[i + 1] ?? '').trim();
    const key = BP_LABEL_TO_KEY[headingRaw.toLowerCase()];
    if (key) {
      // Merge if the same key appears more than once (last write wins).
      const existing = sections.find((s) => s.sectionKey === key);
      if (existing) { existing.content = body; }
      else { sections.push({ sectionKey: key, content: body }); }
    } else {
      unrecognised.push(headingRaw);
    }
  }

  return { sections, unrecognised };
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
    // Skip blank category headings (no citation text, no source type)
    if (!currentStd.citationText.trim() && !currentStd.sourceType.trim()) {
      currentStd = null; lastFieldStd = null; return;
    }
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

    // ── Entry header: ## ENTRY-KEY or ### ENTRY-KEY (any depth ≥ 2) ──────────
    // Files may use ## for category groupers and ### for individual entries.
    // Matching any ##+ heading means category headings create a blank entry
    // that flushDet/flushStd silently skips (no statement / no citation text).
    if (/^#{2,}\s+/u.test(line)) {
      flushStd(); flushDet();
      const key = line.replace(/^#{2,}\s+/, '').trim();
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

    // ── Continuation / default body text ──────────────────────────────────
    // Unrecognised lines (no known Key: prefix) default to citationText for
    // standards and statement for detriments. This handles files where the
    // body text under ## ENTRY-KEY is plain prose rather than Key: Value pairs.
    const cont = line.trim();
    if (!cont) { lastFieldStd = null; lastFieldDet = null; continue; }

    if (section === 'standards' && currentStd) {
      const target = lastFieldStd ?? 'citationText';
      if (target !== 'verificationStatus') {
        const prev = (currentStd as Record<string, unknown>)[target] as string;
        (currentStd as Record<string, unknown>)[target] = prev ? prev + ' ' + cont : cont;
        lastFieldStd = target;
      }
    }
    if (section === 'detriments' && currentDet) {
      const target = lastFieldDet ?? 'statement';
      if (target !== 'applicabilityConditions') {
        const prev = (currentDet as Record<string, unknown>)[target] as string;
        (currentDet as Record<string, unknown>)[target] = prev ? prev + ' ' + cont : cont;
        lastFieldDet = target;
      }
    }
  }

  flushStd();
  flushDet();

  return { standards, detriments, warnings };
}

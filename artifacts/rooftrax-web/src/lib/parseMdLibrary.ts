/**
 * Parse library import files into Standards + Detriment entries.
 *
 * NEW format (=== ENTRY === delimited)
 * ─────────────────────────────────────
 * Lines starting with '#' are comments and are dropped.
 * Entries are separated by the literal line:  === ENTRY ===
 * Within each block, every line is parsed as:  Key: value
 * splitting on the FIRST ': ' occurrence.
 *
 * Standards keys: EntryKey, Title (ignored), SourceType, CitationText,
 *   AuthorityLimit, LocatorTemplate, VerificationAction, VerifiedAt,
 *   HumanEnteredProvisionsOnly
 *
 * Detriment keys: EntryKey, Statement, ApplicabilityConditions (comma-sep),
 *   RequiredSupport, Limitation
 *
 * LEGACY format (## heading based) — still accepted for the combined library
 * file that includes both Standards and Detriments in one pass.
 * ─────────────────────────────────────────────────────────────────────────────
 * # Standards
 *
 * ## ASTM-D3161
 * Source Type: ASTM
 * ...
 *
 * # Detriments
 *
 * ## DET-WIND-01
 * Statement: ...
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ParsedStandard {
  entryKey: string;
  sourceType: string;
  citationText: string;
  authorityLimit: string;
  locatorTemplate: string;
  verificationStatus: 'verified' | 'verify_before_ship';
  verifiedAt: string | null;
  humanEnteredProvisionsOnly: boolean;
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
// New format — per-entry result types
// ---------------------------------------------------------------------------

export interface StandardsRejection {
  blockIndex: number;
  entryKey?: string;
  missingKeys: string[];
}

export interface ParsedStandardsFile {
  entries: ParsedStandard[];
  rejected: StandardsRejection[];
  unknownKeys: string[];   // de-duplicated across all blocks
  warnings: string[];
}

export interface DetrimentRejection {
  blockIndex: number;
  entryKey?: string;
  missingKeys: string[];
}

export interface ParsedDetrimentFile {
  entries: ParsedDetriment[];
  rejected: DetrimentRejection[];
  unknownKeys: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Shared block splitter for the === ENTRY === format
// ---------------------------------------------------------------------------

/**
 * Normalize a raw key from the .md file to PascalCase so lookups are
 * robust regardless of how the author formatted the key:
 *   "SourceType"    → "SourceType"
 *   "Source Type"   → "SourceType"
 *   "source_type"   → "SourceType"
 *   "Authority limit" → "AuthorityLimit"
 */
function normKey(raw: string): string {
  return raw
    .trim()
    .replace(/[_\s]+(.)/g, (_, c: string) => c.toUpperCase()) // collapse separators
    .replace(/^[a-z]/, (c) => c.toUpperCase());                // ensure PascalCase
}

/**
 * Split a file into raw key→value maps, one per entry block.
 * Lines starting with '#' are dropped. Blocks delimited by '=== ENTRY ==='.
 * Each non-empty line within a block is split on the FIRST ': '.
 * Keys are normalised to PascalCase (see normKey) so "Source Type" and
 * "SourceType" both resolve to the same lookup key.
 */
function splitEntryBlocks(text: string): Array<Record<string, string>> {
  const cleaned = text
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');

  return cleaned
    .split(/^=== ENTRY ===/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const map: Record<string, string> = {};
      for (const line of block.split(/\r?\n/)) {
        const idx = line.indexOf(': ');
        if (idx > 0) {
          const key = normKey(line.slice(0, idx));
          const value = line.slice(idx + 2); // keep trailing content verbatim
          if (key) map[key] = value;
        }
      }
      return map;
    });
}

// ---------------------------------------------------------------------------
// Standards entry file parser (new === ENTRY === format)
// ---------------------------------------------------------------------------

const STANDARDS_KNOWN_KEYS = new Set([
  'EntryKey',
  'Title',
  'SourceType',
  'CitationText',
  'AuthorityLimit',
  'LocatorTemplate',
  'VerificationAction',
  'VerifiedAt',
  'HumanEnteredProvisionsOnly',
]);

const STANDARDS_REQUIRED_KEYS = [
  'EntryKey',
  'SourceType',
  'CitationText',
  'AuthorityLimit',
  'LocatorTemplate',
] as const;

/**
 * Parse a standards .md file in the === ENTRY === field format.
 * Returns valid entries, rejected blocks (with missing key info), and
 * a de-duplicated list of unrecognised keys found across all blocks.
 */
export function parseStandardsFile(text: string): ParsedStandardsFile {
  const blocks = splitEntryBlocks(text);
  const entries: ParsedStandard[] = [];
  const rejected: StandardsRejection[] = [];
  const allUnknownKeys = new Set<string>();
  const warnings: string[] = [];

  blocks.forEach((block, i) => {
    // Warn about unknown keys
    for (const key of Object.keys(block)) {
      if (!STANDARDS_KNOWN_KEYS.has(key)) {
        allUnknownKeys.add(key);
      }
    }

    // Validate required keys
    const missingKeys = STANDARDS_REQUIRED_KEYS.filter((k) => !block[k]?.trim());
    if (missingKeys.length > 0) {
      rejected.push({
        blockIndex: i + 1,
        entryKey: block['EntryKey'] ?? undefined,
        missingKeys,
      });
      return;
    }

    // Map VerificationAction → verificationStatus + verifiedAt
    const action = (block['VerificationAction'] ?? '').trim().toLowerCase();
    const verificationStatus: 'verified' | 'verify_before_ship' =
      action === 'mark_verified' ? 'verified' : 'verify_before_ship';
    const verifiedAt =
      verificationStatus === 'verified' ? (block['VerifiedAt']?.trim() ?? null) : null;

    const humanEnteredProvisionsOnly =
      (block['HumanEnteredProvisionsOnly'] ?? '').trim().toLowerCase() === 'true';

    entries.push({
      entryKey: block['EntryKey']!.trim(),
      sourceType: block['SourceType']!.trim(),
      citationText: block['CitationText']!.trim(),
      authorityLimit: block['AuthorityLimit']!.trim(),
      locatorTemplate: block['LocatorTemplate']!.trim(),
      verificationStatus,
      verifiedAt,
      humanEnteredProvisionsOnly,
    });
  });

  if (allUnknownKeys.size > 0) {
    warnings.push(
      `Unknown keys ignored: ${[...allUnknownKeys].join(', ')}`,
    );
  }

  return { entries, rejected, unknownKeys: [...allUnknownKeys], warnings };
}

// ---------------------------------------------------------------------------
// Detriment entry file parser (new === ENTRY === format)
// ---------------------------------------------------------------------------

const DETRIMENT_KNOWN_KEYS = new Set([
  'EntryKey',
  'Statement',
  'ApplicabilityConditions',
  'RequiredSupport',
  'Limitation',
]);

const DETRIMENT_REQUIRED_KEYS = ['EntryKey', 'Statement'] as const;

/**
 * Parse a detriment .md file in the === ENTRY === field format.
 */
export function parseDetrimentFile(text: string): ParsedDetrimentFile {
  const blocks = splitEntryBlocks(text);
  const entries: ParsedDetriment[] = [];
  const rejected: DetrimentRejection[] = [];
  const allUnknownKeys = new Set<string>();
  const warnings: string[] = [];

  blocks.forEach((block, i) => {
    for (const key of Object.keys(block)) {
      if (!DETRIMENT_KNOWN_KEYS.has(key)) {
        allUnknownKeys.add(key);
      }
    }

    const missingKeys = DETRIMENT_REQUIRED_KEYS.filter((k) => !block[k]?.trim());
    if (missingKeys.length > 0) {
      rejected.push({
        blockIndex: i + 1,
        entryKey: block['EntryKey'] ?? undefined,
        missingKeys,
      });
      return;
    }

    const applicabilityConditions = (block['ApplicabilityConditions'] ?? '')
      .split(',')
      .map((c) => c.trim().toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean);

    entries.push({
      entryKey: block['EntryKey']!.trim(),
      statement: block['Statement']!.trim(),
      applicabilityConditions,
      requiredSupport: block['RequiredSupport']?.trim() ?? '',
      limitation: block['Limitation']?.trim() ?? '',
    });
  });

  if (allUnknownKeys.size > 0) {
    warnings.push(`Unknown keys ignored: ${[...allUnknownKeys].join(', ')}`);
  }

  return { entries, rejected, unknownKeys: [...allUnknownKeys], warnings };
}

// ---------------------------------------------------------------------------
// Boilerplate multi-section parser (unchanged)
// ---------------------------------------------------------------------------

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
  opening_statement: 'opening_statement',
  inspection_method: 'inspection_method',
  caption_patterns: 'caption_patterns',
  rap_field_protocol: 'rap_field_protocol',
  attestation_block_a: 'attestation_block_a',
  attestation_block_b: 'attestation_block_b',
  attestation_block_c: 'attestation_block_c',
  uniform_inspection_procedure: 'uniform_inspection_procedure',
  product_id_methodology: 'product_id_methodology',
  scope_block: 'scope_block',
  std_rpr_01_source_record: 'std_rpr_01_source_record',
};

export interface ParsedBpSection {
  sectionKey: string;
  content: string;
}

export interface ParsedMdBoilerplate {
  sections: ParsedBpSection[];
  unrecognised: string[];
}

export function parseMdBoilerplate(text: string): ParsedMdBoilerplate {
  const sections: ParsedBpSection[] = [];
  const unrecognised: string[] = [];

  const chunks = text.split(/^(#\s+[^\n]+)/m);

  for (let i = 1; i < chunks.length; i += 2) {
    const headingRaw = chunks[i]!.replace(/^#+\s*/, '').trim();
    const body = (chunks[i + 1] ?? '').trim();
    const key = BP_LABEL_TO_KEY[headingRaw.toLowerCase()];
    if (key) {
      const existing = sections.find((s) => s.sectionKey === key);
      if (existing) {
        existing.content = body;
      } else {
        sections.push({ sectionKey: key, content: body });
      }
    } else {
      unrecognised.push(headingRaw);
    }
  }

  return { sections, unrecognised };
}

// ---------------------------------------------------------------------------
// Legacy combined parser (## heading format) — kept for backward compatibility
// ---------------------------------------------------------------------------

type LegacySectionType = 'standards' | 'detriments' | null;
const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

type StdMutableField = keyof Omit<ParsedStandard, 'entryKey' | 'verifiedAt' | 'humanEnteredProvisionsOnly'>;
const STD_FIELDS: Record<string, StdMutableField> = {
  'source type': 'sourceType',
  'citation text': 'citationText',
  'authority limit': 'authorityLimit',
  'locator template': 'locatorTemplate',
  'verification status': 'verificationStatus',
  verified: 'verificationStatus',
};

type DetMutableField = keyof Omit<ParsedDetriment, 'entryKey'>;
const DET_FIELDS: Record<string, DetMutableField> = {
  'applicability conditions': 'applicabilityConditions',
  conditions: 'applicabilityConditions',
  'applicable conditions': 'applicabilityConditions',
  statement: 'statement',
  'required support': 'requiredSupport',
  limitation: 'limitation',
};

function blankStd(key: string): ParsedStandard {
  return {
    entryKey: key,
    sourceType: '',
    citationText: '',
    authorityLimit: '',
    locatorTemplate: '',
    verificationStatus: 'verify_before_ship',
    verifiedAt: null,
    humanEnteredProvisionsOnly: false,
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

export function parseMdLibrary(text: string): ParsedMdLibrary {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];
  const standards: ParsedStandard[] = [];
  const detriments: ParsedDetriment[] = [];

  let section: LegacySectionType = null;
  let currentStd: ParsedStandard | null = null;
  let currentDet: ParsedDetriment | null = null;
  let lastFieldStd: keyof Omit<ParsedStandard, 'entryKey' | 'verifiedAt' | 'humanEnteredProvisionsOnly'> | null = null;
  let lastFieldDet: keyof Omit<ParsedDetriment, 'entryKey'> | null = null;

  function flushStd() {
    if (!currentStd) return;
    if (!currentStd.entryKey) { warnings.push('Skipped a standards entry with no key.'); return; }
    if (!currentStd.citationText.trim() && !currentStd.sourceType.trim()) {
      currentStd = null; lastFieldStd = null; return;
    }
    standards.push(currentStd);
    currentStd = null; lastFieldStd = null;
  }

  function flushDet() {
    if (!currentDet) return;
    if (!currentDet.entryKey) { warnings.push('Skipped a detriment entry with no key.'); return; }
    if (!currentDet.statement.trim()) {
      warnings.push(`Detriment "${currentDet.entryKey}" has no Statement — skipped.`);
      currentDet = null; lastFieldDet = null; return;
    }
    detriments.push(currentDet);
    currentDet = null; lastFieldDet = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^#\s+/u.test(line) && !/^##\s+/u.test(line)) {
      flushStd(); flushDet();
      const header = line.replace(/^#+\s+/, '').toLowerCase();
      if (header.includes('standard')) section = 'standards';
      else if (header.includes('detriment')) section = 'detriments';
      else section = null;
      continue;
    }

    if (/^#{2,}\s+/u.test(line)) {
      flushStd(); flushDet();
      const key = line.replace(/^#{2,}\s+/, '').trim();
      if (!key) continue;
      if (section === 'standards') currentStd = blankStd(key);
      else if (section === 'detriments') currentDet = blankDet(key);
      continue;
    }

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
            (currentStd as unknown as Record<string, string>)[field] = value;
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
            (currentDet as unknown as Record<string, string>)[field] = value;
          }
          lastFieldDet = field;
          continue;
        }
      }
    }

    const cont = line.trim();
    if (!cont) { lastFieldStd = null; lastFieldDet = null; continue; }

    if (section === 'standards' && currentStd) {
      const target: StdMutableField = lastFieldStd ?? 'citationText';
      if (target !== 'verificationStatus') {
        const rec = currentStd as unknown as Record<string, string>;
        rec[target] = rec[target] ? rec[target] + ' ' + cont : cont;
        lastFieldStd = target;
      }
    }
    if (section === 'detriments' && currentDet) {
      const target: DetMutableField = lastFieldDet ?? 'statement';
      if (target !== 'applicabilityConditions') {
        const rec = currentDet as unknown as Record<string, string>;
        rec[target] = rec[target] ? rec[target] + ' ' + cont : cont;
        lastFieldDet = target;
      }
    }
  }

  flushStd();
  flushDet();

  return { standards, detriments, warnings };
}

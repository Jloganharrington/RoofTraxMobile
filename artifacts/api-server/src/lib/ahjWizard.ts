/**
 * AHJ Wizard — extraction prompt, category definitions, Virginia golden-set
 * eval, and the per-category Gemini extraction driver.
 *
 * Architecture: ingest → extract → verify (human) → activate.
 * The wizard's output is NEVER a live pack. Every candidate is born draft;
 * a human confirms each citation against the source before it can enter an
 * ahj_packs version.
 */

import { ai as geminiAi } from '@workspace/integrations-gemini-ai';
import {
  lintReportFragments,
  CONTRACTOR_LANE_POLICY,
  type LintFragmentInput,
} from './contentPolicy';
import goldenSet from '../../fixtures/virginia-golden-set.json';

// ---------------------------------------------------------------------------
// Versioned extraction prompt
// ---------------------------------------------------------------------------

export const AHJ_WIZARD_PROMPT_VERSION = '1.0';

/**
 * The 14 categories the wizard sweeps. These map to chapters and provisions
 * that govern roofing WITHOUT explicitly mentioning "roofing" — the wizard
 * must surface these non-obvious cross-chapter requirements.
 */
export const AHJ_WIZARD_CATEGORIES = [
  'fire_separation',
  'structural_attachment',
  'ventilation',
  'energy_code',
  'underlayment',
  'ice_water_shield',
  'flashing',
  'deck_attachment',
  'valley_construction',
  'ridge_hip',
  'penetrations',
  'drip_edge_metal',
  'layering_tearoff',
  'permit_inspection',
] as const;

export type AhjWizardCategory = (typeof AHJ_WIZARD_CATEGORIES)[number];

const CATEGORY_DESCRIPTIONS: Record<AhjWizardCategory, string> = {
  fire_separation: 'Fire separation, compartmentation, and assembly ratings — chapters governing fire-rated assemblies that intersect with roof/attic/garage adjacency requirements',
  structural_attachment: 'Structural loading, wind uplift, and roof component attachment requirements — chapters on loads, connections, and anchorage not in the roofing chapter',
  ventilation: 'Attic and roof-space ventilation requirements — mechanical and passive ventilation chapters',
  energy_code: 'Energy code insulation, air barrier, and thermal envelope requirements that affect roofing assemblies',
  underlayment: 'Underlayment, felt, and water-resistive barrier requirements from roofing chapters and exterior envelope chapters',
  ice_water_shield: 'Ice-barrier and eave protection requirements — climate zone triggers and minimum coverage dimensions',
  flashing: 'Flashing, counterflashing, and wall-to-roof intersection sealing requirements',
  deck_attachment: 'Roof deck and sheathing thickness, span ratings, and fastening requirements from structural and floor/roof chapters',
  valley_construction: 'Valley construction methods — open, closed, and woven valley requirements',
  ridge_hip: 'Ridge and hip cap requirements, ridge vent specifications, and ridge attachment fastening',
  penetrations: 'Roof penetration sealing, curb heights, and pipe boot requirements from plumbing/mechanical chapters',
  drip_edge_metal: 'Drip edge, edge metal, and eave metal minimum dimensions and material requirements',
  layering_tearoff: 'Reroofing, layering limits, tear-off triggers, and recover provisions',
  permit_inspection: 'Permit requirements, inspection stages, and exemption thresholds for roofing work',
};

// The contractor-lane constraint applied to AHJ extraction output.
// Wizard-produced content describes code requirements; it must never drift
// into claims-side language.
const AHJ_WIZARD_LANE_CONSTRAINT = `AHJ CODE EXTRACTION LANE (MANDATORY)
This extraction produces a code-research document. Every cited provision describes what a building code requires for roofing construction, replacement, or repair. It is NOT an insurance advocacy or claims-support document.

PROHIBITED IN OUTPUT — never produce:
- Insurance coverage language ("covered", "covered loss", "policy requires")
- Claims-strategy language ("support the claim", "strengthen the position")
- Payment or settlement references of any kind
- Legal conclusions or liability determinations

REQUIRED PHRASING — state only what the code requires:
- "Section R302.2.2 requires…"
- "The code mandates…"
- "This provision applies when…"
- "The inspector must verify…"`;

/**
 * Build the versioned extraction prompt for a single category pass.
 * The model is instructed to sweep the provided section text and return
 * structured JSON (candidate items + gaps) for that category only.
 */
export function buildExtractionPrompt(opts: {
  category: AhjWizardCategory;
  jurisdiction: string;
  packType: 'ahj_roof' | 'ahj_siding';
  sectionText: string;
  edition?: string;
}): string {
  const { category, jurisdiction, packType, sectionText, edition } = opts;
  const categoryDesc = CATEGORY_DESCRIPTIONS[category];
  const packLabel = packType === 'ahj_roof' ? 'Roof Replacement/Repair' : 'Siding Replacement/Repair';

  return `${AHJ_WIZARD_LANE_CONSTRAINT}

You are an AHJ (Authority Having Jurisdiction) code research assistant. Your task is a SINGLE-CATEGORY extraction sweep over the provided code text.

JURISDICTION: ${jurisdiction}
CODE EDITION: ${edition ?? 'not specified'}
PACK TYPE: ${packLabel}
CATEGORY: ${category}
CATEGORY DESCRIPTION: ${categoryDesc}

PROMPT VERSION: ${AHJ_WIZARD_PROMPT_VERSION}

TASK: Read the provided code section text and extract ALL provisions relevant to the category "${category}" that apply to ${packLabel} work in ${jurisdiction}. Look for requirements that govern roofing/siding WITHOUT explicitly mentioning it — cross-chapter requirements (fire, structural, energy, etc.) are the primary target.

OUTPUT FORMAT: Return a single valid JSON object with two arrays:

{
  "candidates": [
    {
      "candidateKey": "<citation>_<category_slug>",
      "citation": "<section number e.g. R302.2.2>",
      "edition": "<code edition if determinable>",
      "provisionSummary": "<1-3 sentence factual summary of what the provision requires>",
      "classification": "${category}",
      "factualTrigger": {
        "condition": "<what condition or scope triggers this requirement>",
        "threshold": "<numeric threshold if any, else null>",
        "exampleScenario": "<one-sentence example of when this applies>"
      },
      "scopeConnection": "<why this applies to ${packLabel} work specifically>",
      "sourceLocator": {
        "section": "<section identifier>",
        "subsection": "<subsection if applicable, else null>"
      },
      "amendmentNote": "<Virginia amendment note if applicable, else null>",
      "confidence": <0.0-1.0 numeric confidence score>
    }
  ],
  "gaps": [
    {
      "description": "<description of a requirement expected in this category but not found or ambiguous>",
      "category": "${category}",
      "gapsContext": {
        "searched": "<what sections were searched>",
        "note": "<why this is a gap or requires manual verification>"
      }
    }
  ]
}

RULES:
1. Return ONLY valid JSON — no markdown fences, no preamble, no explanation outside the JSON.
2. If no candidates are found for this category, return { "candidates": [], "gaps": [...] } with at least one gap entry explaining what was searched and not found.
3. confidence must be 0.0–1.0. Use ≥0.8 only when the section text directly and unambiguously states the requirement. Use 0.4–0.79 for inferred or cross-referenced requirements. Use <0.4 for uncertain cases.
4. candidateKey must be unique within the response (citation + "_" + category slug).
5. provisionSummary and scopeConnection must stay in the AHJ code extraction lane — no coverage or claims language.
6. Do not fabricate citations. If you cannot find a relevant provision in the provided text, report a gap instead.

CODE SECTION TEXT:
---
${sectionText.slice(0, 12000)}
---`;
}

// ---------------------------------------------------------------------------
// Candidate item shape (from the AI response)
// ---------------------------------------------------------------------------

export interface ExtractedCandidate {
  candidateKey: string;
  citation: string | null;
  edition: string | null;
  provisionSummary: string | null;
  classification: string;
  factualTrigger: Record<string, unknown>;
  scopeConnection: string | null;
  sourceLocator: Record<string, unknown>;
  amendmentNote: string | null;
  confidence: number;
}

export interface ExtractedGap {
  description: string;
  category: string;
  gapsContext: Record<string, unknown>;
}

export interface ExtractionResult {
  category: AhjWizardCategory;
  candidates: ExtractedCandidate[];
  gaps: ExtractedGap[];
  rawResponse: string;
  parseError?: string;
}

/**
 * Run one Gemini extraction pass for a single category.
 * Returns structured candidates + gaps, or a parse error if the model
 * returns malformed JSON (items are still stored as draft with a note).
 */
export async function runCategoryExtraction(opts: {
  category: AhjWizardCategory;
  jurisdiction: string;
  packType: 'ahj_roof' | 'ahj_siding';
  sectionText: string;
  edition?: string;
}): Promise<ExtractionResult> {
  const prompt = buildExtractionPrompt(opts);

  const response = await geminiAi.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 4096, responseMimeType: 'application/json' },
  });

  const rawResponse = (response.text ?? '').trim();
  const result: ExtractionResult = {
    category: opts.category,
    candidates: [],
    gaps: [],
    rawResponse,
  };

  // Strip markdown fences if the model wraps in them despite instructions
  const cleaned = rawResponse
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      candidates?: unknown[];
      gaps?: unknown[];
    };

    result.candidates = (parsed.candidates ?? [])
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .map((c) => ({
        candidateKey: String(c.candidateKey ?? `${c.citation ?? 'unknown'}_${opts.category}`),
        citation: c.citation ? String(c.citation) : null,
        edition: c.edition ? String(c.edition) : null,
        provisionSummary: c.provisionSummary ? String(c.provisionSummary) : null,
        classification: String(c.classification ?? opts.category),
        factualTrigger: (c.factualTrigger as Record<string, unknown>) ?? {},
        scopeConnection: c.scopeConnection ? String(c.scopeConnection) : null,
        sourceLocator: (c.sourceLocator as Record<string, unknown>) ?? {},
        amendmentNote: c.amendmentNote ? String(c.amendmentNote) : null,
        confidence: typeof c.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 0.5,
      }));

    result.gaps = (parsed.gaps ?? [])
      .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null)
      .map((g) => ({
        description: String(g.description ?? 'Gap identified'),
        category: String(g.category ?? opts.category),
        gapsContext: (g.gapsContext as Record<string, unknown>) ?? {},
      }));
  } catch (err) {
    result.parseError = String(err);
    // One gap entry to flag the parse failure
    result.gaps.push({
      description: `Parse error in AI response for category ${opts.category}`,
      category: opts.category,
      gapsContext: { parseError: String(err), rawPreview: rawResponse.slice(0, 200) },
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Contractor-lane lint for candidate items
// ---------------------------------------------------------------------------

/**
 * Lint provisionSummary and scopeConnection for policy violations.
 * Returns a short lint note string, or null if the content passes.
 */
export function lintCandidateContent(candidate: ExtractedCandidate): string | null {
  const fragments: LintFragmentInput[] = [];
  if (candidate.provisionSummary) {
    fragments.push({
      fragmentRef: 'provisionSummary',
      contentClass: 'construction_fact',
      text: candidate.provisionSummary,
    });
  }
  if (candidate.scopeConnection) {
    fragments.push({
      fragmentRef: 'scopeConnection',
      contentClass: 'construction_fact',
      text: candidate.scopeConnection,
    });
  }
  if (fragments.length === 0) return null;
  const result = lintReportFragments(fragments);
  if (result.lintStatus === 'passed') return null;
  return result.findings.map((f) => `[${f.ruleId}] ${f.fragmentRef}: "${f.matchedText}"`).join('; ');
}

// ---------------------------------------------------------------------------
// Virginia golden-set eval
// ---------------------------------------------------------------------------

export interface GoldenEvalReport {
  jurisdiction: string;
  totalGolden: number;
  found: number;
  foundAsGap: number;
  missed: number;
  recall: number;
  passed: boolean;
  canaryFound: boolean;
  details: Array<{
    id: string;
    citation: string;
    result: 'found' | 'found_as_gap' | 'missed';
    matchedCandidateKey?: string;
    isCanary: boolean;
  }>;
  failureReasons: string[];
}

type GoldenItem = {
  id: string;
  citation: string;
  description: string;
  classification: string;
  isCanary: boolean;
};

/**
 * Score an extraction run's candidates + gaps against the Virginia golden set.
 * Acceptance: 100% recall (zero misses), R302.2.2 canary must be 'found' (not a gap).
 */
export function scoreVirginiaGoldenSet(
  candidates: Array<{ citation: string | null; candidateKey: string }>,
  gaps: Array<{ gapsContext: Record<string, unknown>; description: string }>,
): GoldenEvalReport {
  const golden = goldenSet.goldenItems as GoldenItem[];
  const canaryCitation = goldenSet.evalCriteria.canaryCitation;

  const details: GoldenEvalReport['details'] = [];
  const failureReasons: string[] = [];

  for (const item of golden) {
    // Normalize citation for matching: strip spaces, lowercase
    const norm = (s: string) => s.toLowerCase().replace(/[\s.-]/g, '');
    const goldenNorm = norm(item.citation);

    // Check candidates first
    const matchedCandidate = candidates.find(
      (c) => c.citation && norm(c.citation).includes(goldenNorm),
    );

    if (matchedCandidate) {
      details.push({
        id: item.id,
        citation: item.citation,
        result: 'found',
        matchedCandidateKey: matchedCandidate.candidateKey,
        isCanary: item.isCanary,
      });
      continue;
    }

    // Check gaps
    const inGap = gaps.some((g) => {
      const ctx = JSON.stringify(g.gapsContext) + g.description;
      return norm(ctx).includes(goldenNorm);
    });

    if (inGap) {
      details.push({
        id: item.id,
        citation: item.citation,
        result: 'found_as_gap',
        isCanary: item.isCanary,
      });
      if (item.isCanary) {
        failureReasons.push(
          `Canary citation ${item.citation} was found only as a gap — it must be a verified candidate item`,
        );
      }
      continue;
    }

    details.push({ id: item.id, citation: item.citation, result: 'missed', isCanary: item.isCanary });
    failureReasons.push(`Golden citation ${item.citation} was missed entirely`);
  }

  const found = details.filter((d) => d.result === 'found').length;
  const foundAsGap = details.filter((d) => d.result === 'found_as_gap').length;
  const missed = details.filter((d) => d.result === 'missed').length;
  const recall = golden.length > 0 ? found / golden.length : 1;

  const canaryDetail = details.find((d) => d.isCanary);
  const canaryFound = canaryDetail?.result === 'found';

  if (!canaryFound && canaryDetail?.result !== 'missed') {
    // found_as_gap already captured above
  } else if (!canaryFound && canaryDetail?.result === 'missed') {
    failureReasons.push(`Canary citation ${canaryCitation} was missed`);
  }

  const passed = missed === 0 && canaryFound;

  return {
    jurisdiction: goldenSet.jurisdiction,
    totalGolden: golden.length,
    found,
    foundAsGap,
    missed,
    recall,
    passed,
    canaryFound,
    details,
    failureReasons,
  };
}

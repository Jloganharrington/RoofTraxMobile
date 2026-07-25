// Contractor-lane content policy for the Phase 2 Forensic Inspection &
// Repairability Report ("Proof Package"). Structurally guarantees the report
// stays a construction document — no coverage determinations, policy
// interpretation, payment advocacy, legal conclusions, or public-adjusting
// language — via (1) a SHARED prompt policy consumed by BOTH generation
// models (Claude summary + Gemini compile) and (2) a server-side lint gate
// that runs over every AI-generated fragment before storage.
//
// AI content is never silently rewritten: the lint records findings and a
// status; `blocked` prevents finalization/export until a reviewer edits the
// content or explicitly resolves the finding.

// ---------------------------------------------------------------------------
// Content classes
// ---------------------------------------------------------------------------

// Every stored Phase 2 fragment carries one of these classes. There are
// deliberately NO policyholder-advocacy classes in the Phase 2 package.
// Future audience targeting can add a separate audience/visibility field —
// content class describes WHAT the fragment is, not WHO may see it.
export const CONTENT_CLASSES = [
  'construction_fact',
  'inspection_methodology',
  'repairability_analysis',
  'photo_narrative',
  'attestation',
  'internal_metadata',
] as const;
export type ContentClass = (typeof CONTENT_CLASSES)[number];

/** Classes that may render in the carrier-facing report body. Everything
 *  else (internal_metadata) is provenance/processing data, surfaced only in
 *  server-built appendices — never as narrative. */
export const CARRIER_FACING_CONTENT_CLASSES: ReadonlySet<ContentClass> = new Set([
  'construction_fact',
  'inspection_methodology',
  'repairability_analysis',
  'photo_narrative',
  'attestation',
]);

// ---------------------------------------------------------------------------
// Shared prompt policy — consumed by BOTH the Claude summary prompt and the
// Gemini compile prompt so the two models can never drift apart.
// ---------------------------------------------------------------------------

export const CONTRACTOR_LANE_POLICY = `CONTRACTOR CONSTRUCTION-DOCUMENT LANE (MANDATORY)
This document is a contractor construction document. It records construction facts, inspection methodology, repairability analysis, photo documentation, and inspector attestations. It is NOT an insurance advocacy document.

PROHIBITED CONTENT — never produce any of the following, in any wording:
- Insurance coverage determinations ("the damage is covered", "this loss is covered", "not covered")
- Policy interpretation ("the policy requires", "under the terms of the policy", "policy language provides")
- Payment or settlement demands ("the insurer must pay", "the carrier must pay", "payment is owed", "demand payment", "full settlement is required")
- Carrier-conduct accusations ("bad faith", "improper denial", "lowball", "underpayment strategy", "claim delay tactics")
- Legal conclusions ("negligent", "liable", "breach of contract", "violation of statute/regulation")
- Representing or negotiating for the policyholder ("on behalf of the insured we request", "we will pursue appraisal/litigation")
- Public-adjusting strategy or claim-negotiation guidance of any kind

REQUIRED ATTRIBUTABLE PHRASING — state only what the record documents:
- "The inspection documentation identifies…"
- "The observed condition is consistent with…"
- "Photographs in this package depict…"
- "The submitted materials document…"
- "The inspection record notes…"
- "The repairability assessment records…"
- "The available storm data identifies…"

The document may state what the package documents. It may not state what an insurer, policyholder, contractor, or other party must do, pay, or accept.`;

// ---------------------------------------------------------------------------
// Server-side lint — configurable forbidden-phrase rule set
// ---------------------------------------------------------------------------

export type LintSeverity = 'blocked' | 'needs_review';
export type LintStatus = 'passed' | 'needs_review' | 'blocked';

export interface ContentLintRule {
  id: string;
  description: string;
  severity: LintSeverity;
  /** Case-insensitive pattern; matched against tag-stripped fragment text.
   *  Prefer phrase-level patterns over single words so ordinary construction
   *  language ("ridge covered with cap shingles") never false-positives. */
  pattern: RegExp;
}

// Prompts alone are not a guarantee — this rule set is the enforcement
// layer. Context-aware where feasible: coverage rules require the insurance
// sense ("covered by the policy", "the damage is covered"), not the roofing
// sense of "covered".
export const CONTENT_LINT_RULES: ContentLintRule[] = [
  // — Payment / settlement demands: hard block —
  {
    id: 'payment_demand',
    description: 'Payment or settlement demand directed at the carrier',
    severity: 'blocked',
    pattern:
      /\b(?:insurer|carrier|insurance company)\b[^.!?]{0,60}\bmust\s+(?:pay|cover|settle|issue payment)\b|\bdemand(?:s|ed)?\s+(?:full\s+)?(?:payment|settlement)\b|\bpayment\s+is\s+owed\b/i,
  },
  // — Carrier-conduct accusations: hard block —
  {
    id: 'bad_faith_accusation',
    description: 'Bad-faith / carrier-misconduct accusation',
    severity: 'blocked',
    pattern:
      /\bbad[\s-]faith\b|\bimproper(?:ly)?\s+deni(?:al|ed)\b|\bwrongful(?:ly)?\s+deni(?:al|ed)\b|\blow[\s-]?ball(?:ing|ed)?\b|\bunderpayment\s+(?:strategy|tactic)|\bdelay\s+tactic/i,
  },
  // — Coverage determinations: hard block (insurance sense only) —
  {
    id: 'coverage_determination',
    description: 'Insurance coverage determination',
    severity: 'blocked',
    pattern:
      /\b(?:damage|loss|claim|repairs?|replacement)\s+(?:is|are|was|were)\s+(?:not\s+)?covered\b|\bcovered\s+(?:under|by)\s+the\s+policy\b|\bthis\s+is\s+(?:a\s+)?covered\s+(?:loss|claim|peril)\b/i,
  },
  // — Policy interpretation: hard block —
  {
    id: 'policy_interpretation',
    description: 'Insurance policy interpretation',
    severity: 'blocked',
    pattern:
      /\bpolicy\s+(?:requires|provides|obligates|entitles|language)\b|\bunder\s+the\s+(?:terms\s+of\s+the\s+)?policy\b|\bper\s+the\s+policy\b/i,
  },
  // — Legal conclusions: hard block —
  {
    id: 'legal_conclusion',
    description: 'Legal conclusion or liability determination',
    severity: 'blocked',
    pattern:
      /\bbreach\s+of\s+contract\b|\bnegligen(?:t|ce)\b|\b(?:is|are|was|were|be)\s+(?:held\s+)?liable\b|\bviolat(?:es|ed|ion)\s+(?:of\s+)?(?:state\s+|federal\s+)?(?:law|statute|regulation)/i,
  },
  // — Policyholder representation / negotiation: hard block —
  {
    id: 'policyholder_representation',
    description: 'Representing the policyholder in claim negotiation',
    severity: 'blocked',
    pattern:
      /\bon\s+behalf\s+of\s+the\s+(?:insured|policyholder|homeowner)\b[^.!?]{0,60}\b(?:request|demand|pursue)\b|\bwe\s+will\s+pursue\s+(?:appraisal|litigation|legal action)\b|\bpublic[\s-]adjust(?:er|ing)\s+strateg/i,
  },
  // — Softer advocacy signals: flag for reviewer, still exportable —
  {
    id: 'unattributed_causation',
    description: 'Unattributed absolute causation claim ("the storm caused")',
    severity: 'needs_review',
    pattern: /\bthe\s+storm\s+(?:caused|destroyed)\b|\bproves?\s+(?:that\s+)?(?:the\s+)?caus/i,
  },
  {
    id: 'absolute_scope_mandate',
    description: 'Absolute scope/repairability mandate without attributed source',
    severity: 'needs_review',
    pattern:
      /\bcannot\s+be\s+repaired\b|\bmust\s+be\s+(?:fully\s+)?replaced\b|\bfull\s+replacement\s+is\s+required\b|\brequired\s+by\s+code\b/i,
  },
  {
    id: 'claim_process_language',
    description: 'Claim-process/advocacy vocabulary (appraisal, litigation, legal rights)',
    severity: 'needs_review',
    pattern: /\bappraisal\s+(?:process|demand|clause)\b|\blitigation\b|\blegal\s+rights\b/i,
  },
];

export interface LintFinding {
  /** Which stored fragment the finding is in, e.g. "forensicSummary",
   *  "photoGroupings[2].narrative". */
  fragmentRef: string;
  ruleId: string;
  matchedText: string;
  severity: LintSeverity;
}

export interface LintResult {
  lintStatus: LintStatus;
  findings: LintFinding[];
}

/** Strip HTML tags/entities so rules match visible text, not markup. */
export function stripHtmlForLint(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface LintFragmentInput {
  fragmentRef: string;
  contentClass: ContentClass;
  text: string;
  /** True when the text is an HTML fragment (tags stripped before matching). */
  isHtml?: boolean;
}

/**
 * Run the contractor-lane lint over a set of AI-generated fragments.
 * Content is never modified — only classified. Overall status is the worst
 * severity found: any `blocked` finding → blocked; else any `needs_review`
 * finding → needs_review; else passed. `internal_metadata` fragments are
 * skipped (server-built provenance, not AI narrative).
 */
export function lintReportFragments(
  fragments: LintFragmentInput[],
  rules: ContentLintRule[] = CONTENT_LINT_RULES,
): LintResult {
  const findings: LintFinding[] = [];
  for (const fragment of fragments) {
    if (fragment.contentClass === 'internal_metadata') continue;
    const text = fragment.isHtml ? stripHtmlForLint(fragment.text) : fragment.text;
    if (!text) continue;
    for (const rule of rules) {
      // Fresh regex state per fragment (rules are case-insensitive, non-global).
      const match = rule.pattern.exec(text);
      if (match) {
        findings.push({
          fragmentRef: fragment.fragmentRef,
          ruleId: rule.id,
          matchedText: match[0].slice(0, 160),
          severity: rule.severity,
        });
      }
    }
  }
  const lintStatus: LintStatus = findings.some((f) => f.severity === 'blocked')
    ? 'blocked'
    : findings.length > 0
      ? 'needs_review'
      : 'passed';
  return { lintStatus, findings };
}

/**
 * Stage 0 readiness validation — Task #121.
 *
 * A pure(-ish) function: takes pre-fetched data and returns the ordered
 * 9-item checklist. Shared between:
 *  - GET /inspections/:id/readiness (response surface)
 *  - POST /inspections/:id/report/compile (server-side re-validation gate)
 *
 * No DB calls inside — all data is fetched by the caller.
 */

import { deriveClaimFlags, ClaimFlagValidationError } from './deriveClaimFlags';
import type { DeriveClaimFlagsInput } from './deriveClaimFlags';
import type { EvaluationResult } from '@workspace/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReadinessItem {
  key: string;
  label: string;
  state: 'pass' | 'fail' | 'warning';
  detail: string | null;
}

export interface ReadinessResult {
  inspectionId: string;
  overallPass: boolean;
  items: ReadinessItem[];
}

export interface ReadinessInput {
  inspectionId: string;

  inspection: DeriveClaimFlagsInput['inspection'] & {
    stormConfirmedRef?: unknown;
    measurementsReportUrl?: string | null;
    measurementsTable?: unknown;
    rapGateReason?: string | null;
    address?: string | null;
  };

  products: DeriveClaimFlagsInput['products'];
  slopes: DeriveClaimFlagsInput['slopes'];

  /** attestation rows for this inspection */
  attestations: Array<{ attestationType: string | null }>;

  /**
   * Result of evaluateServerInspection() — the single authoritative path for
   * all field-evidence facts. Readiness reads deficiency codes from this rather
   * than re-querying the same DB rows (eliminates Conflicts A and B from the
   * Step-1 reconciliation: product existence and test-square existence).
   */
  evaluationResult: EvaluationResult;

  /** number of damage instances (for forensic findings gate) */
  damageInstancesCount: number;

  company: {
    contractorLicenses?: unknown;
    qualificationsText?: string | null;
  };

  /** AHJ pack rows for this company (any jurisdiction) */
  ahjPacks: Array<{ packType: string; jurisdiction: string; state: string | null }>;

  /** Legacy jurisdiction pack state codes for this company (companyJurisdictionPacksTable) */
  legacyJurisdictionStates: string[];

  /**
   * Planned claim sections for this inspection.
   * Used to check whether any referenced standards entries are unverified.
   */
  claimSections: Array<{
    sectionType: string;
    libraryVersionSnapshot?: {
      standardsEntryKeys?: string[];
    } | null;
  }>;

  /** All standards entries for this company (used for unverified-standards check) */
  standardsEntries: Array<{
    entryKey: string;
    verificationStatus: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pass(key: string, label: string): ReadinessItem {
  return { key, label, state: 'pass', detail: null };
}
function fail(key: string, label: string, detail: string): ReadinessItem {
  return { key, label, state: 'fail', detail };
}
function warn(key: string, label: string, detail: string): ReadinessItem {
  return { key, label, state: 'warning', detail };
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const {
    inspectionId,
    inspection,
    products,
    slopes,
    attestations,
    evaluationResult,
    damageInstancesCount,
    company,
    ahjPacks,
    legacyJurisdictionStates,
    claimSections,
    standardsEntries,
  } = input;

  const items: ReadinessItem[] = [];

  // ── 1. Field record attested ───────────────────────────────────────────────
  // Variant A attestation: specifically `stage_signoff`. Other attestation
  // types (equipment, gps_override) are supporting records — they do not
  // satisfy the field-record sign-off requirement.
  const hasAttestation = attestations.some((a) => a.attestationType === 'stage_signoff');
  items.push(
    hasAttestation
      ? pass('field_record_attested', 'Field record attested')
      : fail(
          'field_record_attested',
          'Field record attested',
          'Field record has not been attested by the inspector.',
        ),
  );

  // ── 2. Forensic findings recorded ─────────────────────────────────────────
  const hasFindings =
    damageInstancesCount > 0 ||
    inspection.roofDamageFound ||
    inspection.sidingDamageFound;
  items.push(
    hasFindings
      ? pass('forensic_findings', 'Forensic findings recorded')
      : fail(
          'forensic_findings',
          'Forensic findings recorded',
          'No damage elevations or damage instances have been recorded.',
        ),
  );

  // ── 3. Product ID determination recorded ──────────────────────────────────
  // Passes when a product ID record exists with identificationMethod set to
  // 'field_identified' or 'itel_sample'. lab_recommended (itel_sample) is a
  // complete, valid determination — it does NOT fail this item.
  const validProducts = products.filter(
    (p) => p.identificationMethod === 'field_identified' || p.identificationMethod === 'itel_sample',
  );
  if (validProducts.length > 0) {
    items.push(pass('product_id', 'Product ID determination recorded'));
  } else if (products.length > 0) {
    items.push(
      warn(
        'product_id',
        'Product ID determination recorded',
        'Product recorded as unidentifiable — confirm lab submission if applicable.',
      ),
    );
  } else if (evaluationResult.deficiencies.some(d => d.code === 'NO_PRODUCT_RECORD')) {
    // Protocol engine confirmed no product records exist — trust its evaluation
    // rather than re-checking products.length (avoids Conflict A from Step-1).
    items.push(
      fail(
        'product_id',
        'Product ID determination recorded',
        'No product identification on record.',
      ),
    );
  } else {
    // No products, but the protocol step is not in scope for this inspection
    // (roof damage not selected) — pass.
    items.push(pass('product_id', 'Product ID determination recorded'));
  }

  // ── 4. RAP record or gate reason present ──────────────────────────────────
  // Passes when: test squares exist, OR a gate reason is on record.
  // Special case: not_warranted_discontinued is only valid with product_id_class='identified'.
  // Protocol evaluation is the single authoritative source for test-square
  // completeness (eliminates Conflict B from the Step-1 reconciliation). If
  // evaluate() emitted no MISSING_TEST_SQUARE_* deficiencies, the gate is
  // satisfied — either squares exist with photos, or the step does not apply
  // for this inspection's damage flags.
  const hasTestSquares = !evaluationResult.deficiencies.some(d => d.code.startsWith('MISSING_TEST_SQUARE_'));
  const gateReason = inspection.rapGateReason;

  // Also check legacy repairabilityAssessment.warranted for backward compat.
  const legacyAssessment = inspection.repairabilityAssessment as
    | { warranted?: string }
    | null
    | undefined;
  const legacyGateReason = legacyAssessment?.warranted;

  const resolvedGateReason = gateReason ?? legacyGateReason ?? null;

  const hasIdentifiedProduct = validProducts.some(
    (p) => p.identificationMethod === 'field_identified',
  );
  const hasLabProduct = validProducts.some((p) => p.identificationMethod === 'itel_sample');

  if (hasTestSquares) {
    items.push(pass('rap_record', 'RAP record present'));
  } else if (resolvedGateReason === 'not_warranted_discontinued') {
    if (!hasIdentifiedProduct && hasLabProduct) {
      // Configuration warning: not_warranted_discontinued is only valid for identified products.
      items.push(
        warn(
          'rap_record',
          'RAP: gate reason recorded — Not Warranted (Discontinued)',
          'Warning: "not_warranted_discontinued" gate reason requires an identified product ' +
            '(field_identified). Current product ID is lab_recommended — verify classification.',
        ),
      );
    } else {
      items.push(
        pass('rap_record', 'RAP: gate reason recorded — Not Warranted (Discontinued)'),
      );
    }
  } else if (resolvedGateReason === 'not_authorized') {
    items.push(pass('rap_record', 'RAP: gate reason recorded — Not Authorized'));
  } else {
    items.push(
      fail(
        'rap_record',
        'RAP record present',
        'No repairability assessment recorded and no gate reason on file.',
      ),
    );
  }

  // ── 5. Estimate has at least one line item ────────────────────────────────
  const estimateLines = inspection.estimate?.lines ?? [];
  items.push(
    estimateLines.length > 0
      ? pass('estimate_lines', 'Estimate has at least one line item')
      : fail(
          'estimate_lines',
          'Estimate has at least one line item',
          'The estimate is empty — add at least one line before generating.',
        ),
  );

  // ── 6. Trigger flag combinations legal ────────────────────────────────────
  try {
    deriveClaimFlags({ inspection, products, slopes });
    items.push(pass('trigger_flags_legal', 'Trigger flag combinations valid'));
  } catch (err) {
    const message = err instanceof ClaimFlagValidationError ? err.message : String(err);
    items.push(
      fail(
        'trigger_flags_legal',
        'Trigger flag combinations valid',
        `Validation error: ${message}`,
      ),
    );
  }

  // ── 7. Company settings complete ─────────────────────────────────────────
  const licenses = company.contractorLicenses;
  const hasLicenses =
    Array.isArray(licenses) ? licenses.length > 0 : (licenses != null && typeof licenses === 'object' && Object.keys(licenses as object).length > 0);
  const hasQualifications = typeof company.qualificationsText === 'string' && company.qualificationsText.trim().length > 0;
  if (hasLicenses && hasQualifications) {
    items.push(pass('company_settings', 'Company settings complete'));
  } else {
    const missing: string[] = [];
    if (!hasLicenses) missing.push('contractor licenses');
    if (!hasQualifications) missing.push('qualifications text');
    items.push(
      warn(
        'company_settings',
        'Company settings complete',
        `Company settings incomplete: missing ${missing.join(', ')}. Update in Settings → Company.`,
      ),
    );
  }

  // ── 8. AHJ pack present ───────────────────────────────────────────────────
  // Derive property state from the address (last two-letter segment) or
  // from the storm reference. We do a best-effort extract.
  const address = inspection.address ?? '';
  // US addresses end in: City, ST  XXXXX — try extracting state abbreviation.
  const stateMatch = address.match(/,\s*([A-Z]{2})\s*\d{5}/);
  const propertyState = stateMatch?.[1] ?? null;

  // Check new ahjPacksTable first; fall back to legacy jurisdiction packs.
  const roofInScope = inspection.roofDamageFound;
  const sidingInScope = inspection.sidingDamageFound;

  if (!propertyState) {
    // Cannot determine state — surface a warning rather than a false fail.
    items.push(
      warn(
        'ahj_pack',
        'AHJ pack present',
        'Cannot determine property state from address — verify AHJ pack manually.',
      ),
    );
  } else {
    const packsByType = new Map<string, boolean>();
    for (const pack of ahjPacks) {
      // Prefer the structured state column (migration 063+); fall back to
      // substring-matching the jurisdiction string for older rows where state
      // is null. The substring fallback is kept so pre-migration rows still
      // satisfy the check without a forced backfill.
      const matches = pack.state != null
        ? pack.state.toUpperCase() === propertyState
        : pack.jurisdiction.toUpperCase().includes(propertyState);
      if (matches) {
        packsByType.set(pack.packType, true);
      }
    }
    // Also accept legacy jurisdiction pack for this state.
    const hasLegacy = legacyJurisdictionStates.includes(propertyState);

    const missingPacks: string[] = [];
    if (roofInScope && !packsByType.get('ahj_roof') && !hasLegacy) {
      missingPacks.push('AHJ-Roof');
    }
    if (sidingInScope && !packsByType.get('ahj_siding') && !hasLegacy) {
      missingPacks.push('AHJ-Siding');
    }

    if (missingPacks.length === 0) {
      items.push(pass('ahj_pack', `AHJ pack present (${propertyState})`));
    } else {
      items.push(
        warn(
          'ahj_pack',
          'AHJ pack present',
          `Missing AHJ packs for ${propertyState}: ${missingPacks.join(', ')}. Add in Settings → Library → AHJ Packs.`,
        ),
      );
    }
  }

  // ── 9. No unverified standards ────────────────────────────────────────────
  // Collect all standards entry keys referenced by planned sections.
  const referencedKeys = new Set<string>();
  for (const section of claimSections) {
    const keys = section.libraryVersionSnapshot?.standardsEntryKeys ?? [];
    for (const k of keys) referencedKeys.add(k);
  }

  if (referencedKeys.size === 0) {
    // No sections have been generated yet — no standards references to verify.
    items.push(pass('standards_verified', 'No unverified standards entries'));
  } else {
    const unverified = standardsEntries.filter(
      (e) => referencedKeys.has(e.entryKey) && e.verificationStatus === 'verify_before_ship',
    );
    if (unverified.length === 0) {
      items.push(pass('standards_verified', 'No unverified standards entries'));
    } else {
      items.push(
        fail(
          'standards_verified',
          'No unverified standards entries',
          `${unverified.length} referenced standards ${unverified.length === 1 ? 'entry is' : 'entries are'} marked "verify before ship": ${unverified.map((e) => e.entryKey).join(', ')}.`,
        ),
      );
    }
  }

  const overallPass = items.every((i) => i.state !== 'fail');
  return { inspectionId, overallPass, items };
}

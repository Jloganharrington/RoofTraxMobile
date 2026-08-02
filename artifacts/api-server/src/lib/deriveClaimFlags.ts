/**
 * Deterministic trigger flag derivation — Task #121.
 *
 * This is a PURE FUNCTION: no DB access, no side effects. It can be called
 * from a unit test without any server infrastructure. The result is stored in
 * `inspections.triggerFlags` for audit purposes but should always be
 * RECOMPUTED from live data rather than trusted from storage.
 */

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface DeriveClaimFlagsInput {
  inspection: {
    claimNumber?: string | null;
    damageType?: string | null;
    roofDamageFound: boolean;
    sidingDamageFound: boolean;
    interiorDamageFound: boolean;
    rapGateReason?: string | null;
    estimate?: { lines?: Array<{ description?: string; categoryCode?: string }> } | null;
    repairabilityAssessment?: unknown;
    temporaryRepairs?: { performed?: boolean; openings?: boolean } | null;
    propertyProfile?: { structureType?: string; garageAttached?: boolean } | null;
  };
  /** All product records for the inspection (excluding unidentifiable). */
  products: Array<{
    identificationMethod: string; // 'field_identified' | 'itel_sample' | 'unidentifiable'
    discontinued?: string | null; // 'still_manufactured' | 'discontinued' | 'not_verified'
    ordinaryAvailability?: string | null; // 'available' | 'not_reasonably_available' | 'not_assessed'
  }>;
  /** All roof slope records (used to collect material_set). */
  slopes: Array<{ materialType?: string | null }>;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type ClaimPosture = 'pre_claim' | 'post_carrier_inspection' | 'post_partial_denial';
export type StructureAttachment = 'attached' | 'detached';
export type Peril = 'hail' | 'wind' | 'hail_and_wind' | 'other';
export type ProductIdClass = 'identified' | 'lab_recommended';

/**
 * `discontinued_status` derived flag — three valid values only.
 *
 * `not_applicable` means discontinued status is genuinely irrelevant to the
 * analysis (no product, or product is still_manufactured). It is NEVER a
 * substitute for an unknown/unverified status — use `discontinued_not_verified`
 * for the case where the determination has not yet been completed.
 *
 * A library lead that has not been desk-verified maps to
 * `discontinued_not_verified` — not "suspected" (that value does not exist).
 */
export type DiscontinuedStatus =
  | 'discontinued_verified'
  | 'discontinued_not_verified'
  | 'not_applicable';

export type CompatibilityStatus = 'compatibility_assessed' | 'compatibility_not_assessed';

export interface TriggerFlags {
  claim_posture: ClaimPosture;
  structure_attachment: StructureAttachment;
  created_opening: boolean;
  mitigation_performed: boolean;
  deck_replacement_in_scope: boolean;
  interior_scope_present: boolean;
  peril: Peril;
  material_set: string[];
  /** null only when no valid product ID record exists (idClass unresolvable). */
  product_id_class: ProductIdClass | null;
  discontinued_status: DiscontinuedStatus;
  compatibility: CompatibilityStatus;
}

// ---------------------------------------------------------------------------
// Validation error
// ---------------------------------------------------------------------------

export class ClaimFlagValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaimFlagValidationError';
  }
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derive trigger flags from the attested field record.
 *
 * Throws `ClaimFlagValidationError` if any validation rule is violated.
 * These same rules are checked in Stage 0 readiness item 6.
 */
export function deriveClaimFlags(input: DeriveClaimFlagsInput): TriggerFlags {
  const { inspection, products, slopes } = input;

  // ── claim_posture ──────────────────────────────────────────────────────────
  const claim_posture: ClaimPosture = inspection.claimNumber
    ? 'post_carrier_inspection'
    : 'pre_claim';

  // ── structure_attachment ───────────────────────────────────────────────────
  const garageAttached = inspection.propertyProfile?.garageAttached ?? false;
  const structure_attachment: StructureAttachment = garageAttached ? 'attached' : 'detached';

  // ── created_opening & mitigation_performed ─────────────────────────────────
  const temporaryRepairs = inspection.temporaryRepairs ?? null;
  const created_opening = temporaryRepairs?.openings ?? false;
  const mitigation_performed = temporaryRepairs?.performed ?? false;

  // ── deck_replacement_in_scope ──────────────────────────────────────────────
  // True when at least one estimate line has a deck-related category code, or
  // when the repairability assessment warrants deck replacement.
  const lines = inspection.estimate?.lines ?? [];
  const deckKeywords = ['deck', 'decking', 'sheathing'];
  const deck_replacement_in_scope = lines.some(
    (l) =>
      deckKeywords.some((k) => (l.description ?? '').toLowerCase().includes(k)) ||
      deckKeywords.some((k) => (l.categoryCode ?? '').toLowerCase().includes(k)),
  );

  // ── interior_scope_present ─────────────────────────────────────────────────
  const interior_scope_present = inspection.interiorDamageFound;

  // ── peril ──────────────────────────────────────────────────────────────────
  const rawDamage = (inspection.damageType ?? '').toLowerCase();
  let peril: Peril = 'other';
  if (rawDamage.includes('hail') && rawDamage.includes('wind')) {
    peril = 'hail_and_wind';
  } else if (rawDamage.includes('hail')) {
    peril = 'hail';
  } else if (rawDamage.includes('wind')) {
    peril = 'wind';
  }

  // ── material_set ───────────────────────────────────────────────────────────
  const materialSet = new Set<string>();
  for (const slope of slopes) {
    if (slope.materialType) materialSet.add(slope.materialType);
  }
  const material_set = Array.from(materialSet).sort();

  // ── product_id_class ───────────────────────────────────────────────────────
  // Priority: identified (field_identified) > lab_recommended (itel_sample).
  // Unidentifiable products are excluded; their presence does not yield a class.
  const validProducts = products.filter((p) => p.identificationMethod !== 'unidentifiable');
  let product_id_class: ProductIdClass | null = null;
  if (validProducts.some((p) => p.identificationMethod === 'field_identified')) {
    product_id_class = 'identified';
  } else if (validProducts.some((p) => p.identificationMethod === 'itel_sample')) {
    product_id_class = 'lab_recommended';
  }

  // ── discontinued_status & compatibility — with validation rules ────────────

  // Find the primary product record (first field_identified, else itel_sample).
  const primaryProduct =
    validProducts.find((p) => p.identificationMethod === 'field_identified') ??
    validProducts.find((p) => p.identificationMethod === 'itel_sample') ??
    null;

  const rawDiscontinued = primaryProduct?.discontinued ?? null;
  const rawAvailability = primaryProduct?.ordinaryAvailability ?? null;

  // VALIDATION RULE: `discontinued_verified` requires `product_id_class === 'identified'`.
  if (rawDiscontinued === 'discontinued' && product_id_class === 'lab_recommended') {
    throw new ClaimFlagValidationError(
      'A discontinued determination cannot be combined with lab_recommended product ID — ' +
        'a specific product must be identified (field_identified) before discontinued status ' +
        'can be verified.',
    );
  }

  // VALIDATION RULE: `lab_recommended` must never carry a product-specific
  // compatibility conclusion.
  if (rawAvailability === 'not_reasonably_available' && product_id_class === 'lab_recommended') {
    throw new ClaimFlagValidationError(
      'A compatibility (ordinary_availability) conclusion cannot be combined with ' +
        'lab_recommended product ID — compatibility requires an identified product.',
    );
  }

  // VALIDATION RULE: `compatibility_assessed` requires `product_id_class === 'identified'`.
  if (
    rawAvailability &&
    rawAvailability !== 'not_assessed' &&
    product_id_class !== 'identified'
  ) {
    throw new ClaimFlagValidationError(
      'compatibility_assessed requires product_id_class to be "identified". ' +
        'A lab-recommended or absent product cannot carry a compatibility conclusion.',
    );
  }

  let discontinued_status: DiscontinuedStatus;
  if (!primaryProduct) {
    // No product record at all — discontinued analysis genuinely does not apply.
    // This is the only correct use of not_applicable for a missing product;
    // readiness item 3 will surface the absence as a fail.
    discontinued_status = 'not_applicable';
  } else if (rawDiscontinued === 'still_manufactured') {
    // Confirmed still manufactured — discontinued analysis is genuinely irrelevant.
    // not_applicable MUST NOT be used for any other case. See rule below.
    discontinued_status = 'not_applicable';
  } else if (rawDiscontinued === 'discontinued' && product_id_class === 'identified') {
    discontinued_status = 'discontinued_verified';
  } else {
    // null (not yet assessed) or 'not_verified' — desk verification not complete.
    // A library lead that has not been desk-verified maps here, never "suspected".
    // A null rawDiscontinued on an existing product means unknown, not irrelevant —
    // not_applicable is NEVER a substitute for unknown/unverified status.
    discontinued_status = 'discontinued_not_verified';
  }

  const compatibility: CompatibilityStatus =
    rawAvailability && rawAvailability !== 'not_assessed'
      ? 'compatibility_assessed'
      : 'compatibility_not_assessed';

  return {
    claim_posture,
    structure_attachment,
    created_opening,
    mitigation_performed,
    deck_replacement_in_scope,
    interior_scope_present,
    peril,
    material_set,
    product_id_class,
    discontinued_status,
    compatibility,
  };
}

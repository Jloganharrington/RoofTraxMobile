/**
 * Pricing engine — per-claim graduated-band model.
 * Master Build Document v1.0, §2–3.
 *
 * Pure, table-driven calculations. No DB reads, no hardcoded amounts.
 * Change pricing by editing tables only.
 *
 * Non-negotiables enforced here:
 *  - Setup fees are never waived (annual = discounted, not free).
 *  - Credit: annual billing + Crew or above + within 90 days of first submission.
 *  - Credit applies to subscription line only — never setup.
 *  - Graduated bands: buying more claims never increases total price.
 */

import type { Plan, PricingBand, BillingTermRow, FeatureTier } from '@workspace/db';

export type { Plan, PricingBand, BillingTermRow, FeatureTier };

export class PricingRuleError extends Error {}

// ---------------------------------------------------------------------------
// Pod estimator
// ---------------------------------------------------------------------------

/**
 * Estimate annual claims from sales-pod headcount (spec §3.4).
 *  rep × 52 weeks + canvasser × 78 referrals
 */
export function estimateAnnualClaims(reps: number, canvassers: number): number {
  return Math.round(reps * 52 + canvassers * 78);
}

// ---------------------------------------------------------------------------
// Band function
// ---------------------------------------------------------------------------

/**
 * Graduated annual price in cents for a given claim volume.
 * Bands are evaluated in sort_order; each band's width is
 * (bandTo - bandFrom + 1) claims, or infinite for the last band (bandTo null).
 *
 * Unit-test fixtures (spec §3.4):
 *   150 → $7,500    400 → $20,000   500 → $25,000
 *   900 → $43,000  1500 → $70,000  2000 → $90,000
 *  3000 → $130,000 4000 → $165,000 6000 → $235,000
 */
export function annualCents(claims: number, bands: PricingBand[]): number {
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  let remaining = Math.max(0, Math.round(claims));
  let total = 0;
  for (const band of sorted) {
    if (remaining <= 0) break;
    const width =
      band.bandTo != null
        ? band.bandTo - band.bandFrom + 1
        : Number.POSITIVE_INFINITY;
    const take = Math.min(remaining, width);
    total += take * band.rateCents;
    remaining -= take;
  }
  return total;
}

/** Effective cents-per-claim at a given volume. */
export function effectiveRateCents(claims: number, bands: PricingBand[]): number {
  if (claims <= 0) return 0;
  return annualCents(claims, bands) / claims;
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export interface Quote {
  planKey: string;
  planDisplayName: string;
  billingTerm: string;
  committedClaims: number;
  /** Total annual commitment (multiplier applied). */
  subscriptionAnnualCents: number;
  /** Per-installment amount (= annual for annual billing). */
  installmentCents: number;
  installments: number;
  /** Feature-tier annual cost (0 for Standard). */
  featureTierAnnualCents: number;
  featureTierKey: string;
  featureTierDisplayName: string;
  /** One-time setup fee — always present, never zero. */
  setupCents: number;
  firstYearTotalCents: number;
  /** Effective cents per committed claim (based on plan's stated annual price). */
  effectiveCentsPerClaim: number;
}

export function quotePlan(
  plan: Plan,
  term: BillingTermRow,
  featureTier: FeatureTier,
): Quote {
  const multiplier = Number(term.multiplier);
  const annualSub = Math.round(plan.annualCents * multiplier);
  const installment =
    term.installments === 1
      ? annualSub
      : Math.round(annualSub / term.installments);
  const setup =
    term.termKey === 'annual'
      ? plan.setupAnnualCents
      : plan.setupInstallmentCents;
  const featureTierAnnual = featureTier.monthlyCents * 12;
  return {
    planKey: plan.planKey,
    planDisplayName: plan.displayName,
    billingTerm: term.termKey,
    committedClaims: plan.committedClaims,
    subscriptionAnnualCents: annualSub,
    installmentCents: installment,
    installments: term.installments,
    featureTierAnnualCents: featureTierAnnual,
    featureTierKey: featureTier.tierKey,
    featureTierDisplayName: featureTier.displayName,
    setupCents: setup,
    firstYearTotalCents: annualSub + featureTierAnnual + setup,
    effectiveCentsPerClaim:
      plan.committedClaims > 0
        ? Math.round(plan.annualCents / plan.committedClaims)
        : 0,
  };
}

// ---------------------------------------------------------------------------
// Plan recommendation
// ---------------------------------------------------------------------------

/**
 * Find the closest plan at or above the requested claim volume.
 * Returns the largest plan with oversize=true if volume exceeds all plans
 * (custom commitment needed).
 */
export function recommendPlan(
  claimsPerYear: number,
  plans: Plan[],
): { plan: Plan; oversize: boolean } {
  const active = [...plans]
    .filter((p) => p.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const fit = active.find((p) => p.committedClaims >= claimsPerYear);
  if (fit) return { plan: fit, oversize: false };
  return { plan: active[active.length - 1]!, oversize: true };
}

// ---------------------------------------------------------------------------
// Trial credit eligibility
// ---------------------------------------------------------------------------

export interface CreditInput {
  creditBalanceCents: number;
  /** Expiry timestamp anchored to first trial submission (not first payment). */
  creditExpiresAt: Date | null;
}

export type CreditVerdict =
  | { eligible: true; amountCents: number }
  | { eligible: false; reason: 'no_credit' | 'not_annual' | 'below_crew' | 'expired' };

/** Plans that qualify for trial-credit redemption (Crew and above). */
const CREDIT_ELIGIBLE_PLANS = new Set(['crew', 'team', 'fleet', 'regional']);

/**
 * Credit: annual billing + Crew or above + within 90 days of first submission.
 * Reduces subscription line only — callers must never apply it to setup.
 */
export function creditEligibility(
  planKey: string,
  billingTerm: string,
  credit: CreditInput,
  now: Date,
  subscriptionAnnualCents: number,
): CreditVerdict {
  if (credit.creditBalanceCents <= 0) return { eligible: false, reason: 'no_credit' };
  if (billingTerm !== 'annual') return { eligible: false, reason: 'not_annual' };
  if (!CREDIT_ELIGIBLE_PLANS.has(planKey)) return { eligible: false, reason: 'below_crew' };
  if (
    !credit.creditExpiresAt ||
    now.getTime() > credit.creditExpiresAt.getTime()
  ) {
    return { eligible: false, reason: 'expired' };
  }
  return {
    eligible: true,
    amountCents: Math.min(credit.creditBalanceCents, subscriptionAnnualCents),
  };
}

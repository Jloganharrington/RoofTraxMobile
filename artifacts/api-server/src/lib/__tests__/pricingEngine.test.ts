import { describe, it, expect } from 'vitest';
import {
  annualCents,
  effectiveRateCents,
  estimateAnnualClaims,
  quotePlan,
  recommendPlan,
  creditEligibility,
} from '../pricing/engine';
import type { Plan, PricingBand, BillingTermRow, FeatureTier } from '../pricing/engine';

// ---------------------------------------------------------------------------
// Fixtures matching spec §3.4 seed data
// ---------------------------------------------------------------------------

const BANDS: PricingBand[] = [
  { id: '1', bandFrom: 1,    bandTo: 500,  rateCents: 5000, sortOrder: 1 },
  { id: '2', bandFrom: 501,  bandTo: 1500, rateCents: 4500, sortOrder: 2 },
  { id: '3', bandFrom: 1501, bandTo: 3000, rateCents: 4000, sortOrder: 3 },
  { id: '4', bandFrom: 3001, bandTo: null, rateCents: 3500, sortOrder: 4 },
];

const PLANS: Plan[] = [
  { id: 'p1', planKey: 'solo',     displayName: 'Solo',     committedClaims: 150,  annualCents:   750000, setupAnnualCents:  49500, setupInstallmentCents:  79500, active: true, sortOrder: 1 },
  { id: 'p2', planKey: 'crew',     displayName: 'Crew',     committedClaims: 400,  annualCents:  2000000, setupAnnualCents: 149500, setupInstallmentCents: 229500, active: true, sortOrder: 2 },
  { id: 'p3', planKey: 'team',     displayName: 'Team',     committedClaims: 900,  annualCents:  4300000, setupAnnualCents: 299500, setupInstallmentCents: 449500, active: true, sortOrder: 3 },
  { id: 'p4', planKey: 'fleet',    displayName: 'Fleet',    committedClaims: 2000, annualCents:  9000000, setupAnnualCents: 599500, setupInstallmentCents: 899500, active: true, sortOrder: 4 },
  { id: 'p5', planKey: 'regional', displayName: 'Regional', committedClaims: 4000, annualCents: 16500000, setupAnnualCents: 999500, setupInstallmentCents:1499500, active: true, sortOrder: 5 },
];

const ANNUAL_TERM: BillingTermRow = { id: 't1', termKey: 'annual',    displayName: 'Annual prepaid', multiplier: '1.00', installments: 1 };
const QUARTERLY_TERM: BillingTermRow = { id: 't2', termKey: 'quarterly', displayName: 'Quarterly',     multiplier: '1.10', installments: 4 };
const MONTHLY_TERM: BillingTermRow  = { id: 't3', termKey: 'monthly',   displayName: 'Monthly',        multiplier: '1.25', installments: 12 };

const STANDARD: FeatureTier     = { id: 'f1', tierKey: 'standard',     displayName: 'Standard',     monthlyCents:     0, sortOrder: 1 };
const PROFESSIONAL: FeatureTier = { id: 'f2', tierKey: 'professional', displayName: 'Professional', monthlyCents: 24900, sortOrder: 2 };
const ENTERPRISE: FeatureTier   = { id: 'f3', tierKey: 'enterprise',   displayName: 'Enterprise',   monthlyCents: 99900, sortOrder: 3 };

// ---------------------------------------------------------------------------
// annualCents — band function fixtures from spec §3.4
// ---------------------------------------------------------------------------

describe('annualCents', () => {
  const cases: [number, number][] = [
    [150,    750000],
    [400,   2000000],
    [500,   2500000],
    [900,   4300000],
    [1500,  7000000],
    [2000,  9000000],
    [3000, 13000000],
    [4000, 16500000],
    [6000, 23500000],
  ];

  it.each(cases)('%i claims → $%i cents', (claims, expected) => {
    expect(annualCents(claims, BANDS)).toBe(expected);
  });

  it('zero claims → 0', () => {
    expect(annualCents(0, BANDS)).toBe(0);
  });

  it('graduated: buying more never raises unit price', () => {
    for (let c = 1; c < 6001; c += 50) {
      const rate = effectiveRateCents(c, BANDS);
      const rateNext = effectiveRateCents(c + 1, BANDS);
      expect(rateNext).toBeLessThanOrEqual(rate);
    }
  });

  it('handles out-of-order bands', () => {
    const reversed = [...BANDS].reverse();
    expect(annualCents(900, reversed)).toBe(4300000);
  });
});

// ---------------------------------------------------------------------------
// estimateAnnualClaims
// ---------------------------------------------------------------------------

describe('estimateAnnualClaims', () => {
  it('1 rep + 2 canvassers = 1×52 + 2×78 = 208', () => {
    expect(estimateAnnualClaims(1, 2)).toBe(208);
  });
  it('3 reps + 6 canvassers', () => {
    expect(estimateAnnualClaims(3, 6)).toBe(3 * 52 + 6 * 78);
  });
});

// ---------------------------------------------------------------------------
// recommendPlan
// ---------------------------------------------------------------------------

describe('recommendPlan', () => {
  it('150 claims → solo', () => {
    expect(recommendPlan(150, PLANS).plan.planKey).toBe('solo');
    expect(recommendPlan(150, PLANS).oversize).toBe(false);
  });
  it('151 claims → crew (next plan up)', () => {
    expect(recommendPlan(151, PLANS).plan.planKey).toBe('crew');
  });
  it('900 claims → team', () => {
    expect(recommendPlan(900, PLANS).plan.planKey).toBe('team');
  });
  it('5000 claims → regional + oversize', () => {
    const { plan, oversize } = recommendPlan(5000, PLANS);
    expect(plan.planKey).toBe('regional');
    expect(oversize).toBe(true);
  });
  it('ignores inactive plans', () => {
    const withInactive = PLANS.map((p) =>
      p.planKey === 'crew' ? { ...p, active: false } : p,
    );
    expect(recommendPlan(200, withInactive).plan.planKey).toBe('team');
  });
});

// ---------------------------------------------------------------------------
// quotePlan
// ---------------------------------------------------------------------------

describe('quotePlan', () => {
  it('solo annual standard — matches spec table', () => {
    const q = quotePlan(PLANS[0]!, ANNUAL_TERM, STANDARD);
    expect(q.subscriptionAnnualCents).toBe(750000);   // $7,500
    expect(q.installmentCents).toBe(750000);
    expect(q.installments).toBe(1);
    expect(q.featureTierAnnualCents).toBe(0);
    expect(q.setupCents).toBe(49500);                  // $495
    expect(q.firstYearTotalCents).toBe(750000 + 49500);
    expect(q.effectiveCentsPerClaim).toBe(5000);       // $50/claim
  });

  it('team annual professional', () => {
    const q = quotePlan(PLANS[2]!, ANNUAL_TERM, PROFESSIONAL);
    expect(q.subscriptionAnnualCents).toBe(4300000);
    expect(q.featureTierAnnualCents).toBe(24900 * 12);
    expect(q.setupCents).toBe(299500);
    expect(q.firstYearTotalCents).toBe(4300000 + 24900 * 12 + 299500);
  });

  it('crew quarterly — 1.10× multiplier, 4 installments', () => {
    const q = quotePlan(PLANS[1]!, QUARTERLY_TERM, STANDARD);
    expect(q.subscriptionAnnualCents).toBe(Math.round(2000000 * 1.10));
    expect(q.installments).toBe(4);
    expect(q.installmentCents).toBe(Math.round(Math.round(2000000 * 1.10) / 4));
    expect(q.setupCents).toBe(229500); // installment rate
  });

  it('crew monthly — 1.25× multiplier, 12 installments, installment setup', () => {
    const q = quotePlan(PLANS[1]!, MONTHLY_TERM, STANDARD);
    expect(q.subscriptionAnnualCents).toBe(Math.round(2000000 * 1.25));
    expect(q.installments).toBe(12);
    expect(q.setupCents).toBe(229500);
  });

  it('setup on annual is lower than on installment', () => {
    const annual = quotePlan(PLANS[2]!, ANNUAL_TERM, STANDARD);
    const monthly = quotePlan(PLANS[2]!, MONTHLY_TERM, STANDARD);
    expect(annual.setupCents).toBeLessThan(monthly.setupCents);
  });
});

// ---------------------------------------------------------------------------
// creditEligibility — spec §4.1 rules
// ---------------------------------------------------------------------------

const now = new Date('2026-06-01T12:00:00Z');
const FUTURE_EXPIRY = new Date('2026-09-01T00:00:00Z');  // within window
const PAST_EXPIRY   = new Date('2026-05-01T00:00:00Z');  // expired

describe('creditEligibility', () => {
  const balance = { creditBalanceCents: 10000, creditExpiresAt: FUTURE_EXPIRY };

  it('annual + crew → eligible', () => {
    const v = creditEligibility('crew', 'annual', balance, now, 2000000);
    expect(v.eligible).toBe(true);
    if (v.eligible) expect(v.amountCents).toBe(10000);
  });

  it('annual + team, fleet, regional → eligible', () => {
    for (const pk of ['team', 'fleet', 'regional']) {
      expect(creditEligibility(pk, 'annual', balance, now, 2000000).eligible).toBe(true);
    }
  });

  it('annual + solo → below_crew', () => {
    const v = creditEligibility('solo', 'annual', balance, now, 750000);
    expect(v.eligible).toBe(false);
    if (!v.eligible) expect(v.reason).toBe('below_crew');
  });

  it('quarterly + crew → not_annual', () => {
    const v = creditEligibility('crew', 'quarterly', balance, now, 2200000);
    expect(v.eligible).toBe(false);
    if (!v.eligible) expect(v.reason).toBe('not_annual');
  });

  it('monthly + crew → not_annual', () => {
    const v = creditEligibility('crew', 'monthly', balance, now, 2500000);
    expect(v.eligible).toBe(false);
    if (!v.eligible) expect(v.reason).toBe('not_annual');
  });

  it('zero balance → no_credit', () => {
    const v = creditEligibility('crew', 'annual', { creditBalanceCents: 0, creditExpiresAt: FUTURE_EXPIRY }, now, 2000000);
    expect(v.eligible).toBe(false);
    if (!v.eligible) expect(v.reason).toBe('no_credit');
  });

  it('expired window → expired', () => {
    const v = creditEligibility('crew', 'annual', { creditBalanceCents: 10000, creditExpiresAt: PAST_EXPIRY }, now, 2000000);
    expect(v.eligible).toBe(false);
    if (!v.eligible) expect(v.reason).toBe('expired');
  });

  it('credit capped at subscription amount', () => {
    const big = { creditBalanceCents: 9999999, creditExpiresAt: FUTURE_EXPIRY };
    const v = creditEligibility('crew', 'annual', big, now, 2000000);
    if (v.eligible) expect(v.amountCents).toBe(2000000);
  });
});

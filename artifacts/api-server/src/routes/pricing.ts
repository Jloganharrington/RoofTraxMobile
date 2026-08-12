/**
 * Pricing routes — per-claim graduated-band model.
 * Master Build Document v1.0, §2–3.
 *
 * GET  /pricing/config            — plans, terms, feature tiers, bands (public)
 * POST /pricing/quote             — compute a quote (public, rate-limited)
 * POST /pricing/checkout          — create Stripe Checkout (public, rate-limited)
 * POST /pricing/checkout/confirm  — verify paid session (public, rate-limited)
 *
 * Credit reservation model:
 *  - Credit is debited (reserved) inside the checkout transaction under a
 *    trial-account row lock and stored on the subscriptions row.
 *  - Activation NEVER touches the balance again — no double-spend.
 *  - Stripe session expiry releases the reservation back to the account.
 */

import { Router, type IRouter, type Request, type Response } from 'express';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  plans,
  billingTerms,
  featureTiers,
  pricingBands,
  subscriptions,
  trialAccounts,
  trialCreditLedger,
} from '@workspace/db';
import type { Plan, BillingTermRow, FeatureTier } from '@workspace/db';
import { quotePlan, recommendPlan, creditEligibility, PricingRuleError } from '../lib/pricing/engine';
import { resolveVerifiedPrice } from '../lib/trial/payments';
import { getUncachableStripeClient } from '../lib/stripe/stripeClient';
import { activatePlanFromSession, releaseCreditReservation } from '../lib/pricing/fulfillment';
import { RateLimiter } from '../lib/rateLimit';

const router: IRouter = Router();

const quoteLimiter    = new RateLimiter({ maxRequests: 60 });
const checkoutLimiter = new RateLimiter({ maxRequests: 10, message: 'Too many checkout attempts. Please wait a minute and try again.' });

/** Required display copy — both conditions always shown together (spec §6.2). */
export const CREDIT_COPY =
  'Trial package credit applies to annual plans, Crew and above, within 90 days of your first trial submission.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PricingData {
  plans: Plan[];
  terms: BillingTermRow[];
  featureTierRows: FeatureTier[];
  bandRows: import('@workspace/db').PricingBand[];
}

let _cache: PricingData | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadPricingData(): Promise<PricingData> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;
  const [planRows, termRows, ftRows, bandRows] = await Promise.all([
    db.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sortOrder)),
    db.select().from(billingTerms).orderBy(asc(billingTerms.installments)),
    db.select().from(featureTiers).orderBy(asc(featureTiers.sortOrder)),
    db.select().from(pricingBands).orderBy(asc(pricingBands.sortOrder)),
  ]);
  _cache = { plans: planRows, terms: termRows, featureTierRows: ftRows, bandRows };
  _cacheAt = now;
  return _cache;
}

/** Extract the trial account from the Bearer token header, if present (non-fatal). */
async function optionalTrialAccount(req: Request) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return null;
  const { getTrialAccountByToken } = await import('../lib/trial/session');
  return getTrialAccountByToken(token).catch(() => null);
}

function marketingBase(): string {
  const host = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.PRODUCTION_ORIGIN ?? '';
  return `${host}/rooftrax-web`;
}

class CreditIneligible extends Error {
  constructor(public readonly reason: string) { super(`credit ineligible: ${reason}`); }
}

// ---------------------------------------------------------------------------
// GET /pricing/config
// ---------------------------------------------------------------------------

router.get('/pricing/config', async (_req: Request, res: Response) => {
  const data = await loadPricingData();
  res.json({
    plans: data.plans,
    billingTerms: data.terms,
    featureTiers: data.featureTierRows,
    pricingBands: data.bandRows,
    creditCopy: CREDIT_COPY,
  });
});

// ---------------------------------------------------------------------------
// POST /pricing/quote
// ---------------------------------------------------------------------------

const QuoteBody = z.object({
  /** Pod-based input (spec §3.4 default). Mutually exclusive with claimsPerYear. */
  reps: z.number().int().nonnegative().optional(),
  canvassers: z.number().int().nonnegative().optional(),
  /** Direct claim input — overrides pod estimator when provided. */
  claimsPerYear: z.number().int().positive().optional(),
  billingTerm: z.string().default('annual'),
  featureTierKey: z.string().default('standard'),
});

router.post('/pricing/quote', quoteLimiter.middleware(), async (req: Request, res: Response) => {
  const parsed = QuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid quote request', issues: parsed.error.issues });
    return;
  }
  const { reps, canvassers, billingTerm, featureTierKey } = parsed.data;
  let claimsPerYear = parsed.data.claimsPerYear;

  if (claimsPerYear == null) {
    if (reps == null && canvassers == null) {
      res.status(422).json({ error: 'Provide claimsPerYear or reps/canvassers.' });
      return;
    }
    claimsPerYear = Math.round((reps ?? 0) * 52 + (canvassers ?? 0) * 78);
  }

  const data = await loadPricingData();
  const term = data.terms.find((t) => t.termKey === billingTerm) ?? data.terms[0]!;
  const featureTier = data.featureTierRows.find((f) => f.tierKey === featureTierKey)
    ?? data.featureTierRows[0]!;

  const { plan, oversize } = recommendPlan(claimsPerYear, data.plans);
  const quote = quotePlan(plan, term, featureTier);

  // Also compute quotes for all plans at the requested term + feature tier.
  const allQuotes = data.plans.map((p) => quotePlan(p, term, featureTier));

  res.json({
    claimsPerYear,
    recommended: quote,
    recommendedPlanKey: plan.planKey,
    oversize,
    allPlans: allQuotes,
    creditCopy: CREDIT_COPY,
  });
});

// ---------------------------------------------------------------------------
// POST /pricing/checkout
// ---------------------------------------------------------------------------

const CheckoutBody = z.object({
  planKey: z.string(),
  billingTerm: z.string(),
  featureTierKey: z.string().default('standard'),
  email: z.string().trim().email().max(255),
  companyName: z.string().trim().min(1).max(255),
  applyCredit: z.boolean().default(false),
});

router.post('/pricing/checkout', checkoutLimiter.middleware(), async (req: Request, res: Response) => {
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid checkout request', issues: parsed.error.issues });
    return;
  }
  const { planKey, billingTerm: termKey, featureTierKey, email, companyName, applyCredit } = parsed.data;

  const data = await loadPricingData();
  const plan = data.plans.find((p) => p.planKey === planKey);
  if (!plan) {
    res.status(422).json({ error: `Unknown plan: ${planKey}` });
    return;
  }
  const term = data.terms.find((t) => t.termKey === termKey);
  if (!term) {
    res.status(422).json({ error: `Unknown billing term: ${termKey}` });
    return;
  }
  const featureTier = data.featureTierRows.find((f) => f.tierKey === featureTierKey)
    ?? data.featureTierRows[0]!;

  let quote;
  try {
    quote = quotePlan(plan, term, featureTier);
  } catch (err) {
    if (err instanceof PricingRuleError) {
      res.status(422).json({ error: err.message, code: 'billing_not_available' });
      return;
    }
    throw err;
  }

  // Resolve trial account for optional credit application.
  let trialAccountId: string | null = null;
  if (applyCredit) {
    const account = await optionalTrialAccount(req);
    if (!account) {
      res.status(422).json({ error: 'Sign in to your trial account to apply credit.', code: 'credit_requires_trial_session' });
      return;
    }
    trialAccountId = account.id;
  }

  // Reserve credit atomically under a row lock — prevents double-spend.
  let creditCents = 0;
  let pending: typeof subscriptions.$inferSelect;
  try {
    pending = await db.transaction(async (tx) => {
      if (trialAccountId) {
        const [locked] = await tx.select().from(trialAccounts)
          .where(eq(trialAccounts.id, trialAccountId)).for('update');
        if (!locked) throw new CreditIneligible('no_account');
        const verdict = creditEligibility(
          plan.planKey, term.termKey,
          { creditBalanceCents: locked.creditBalanceCents, creditExpiresAt: locked.creditExpiresAt },
          new Date(), quote.subscriptionAnnualCents,
        );
        if (!verdict.eligible) throw new CreditIneligible((verdict as { reason: string }).reason);
        creditCents = verdict.amountCents;
        await tx.update(trialAccounts)
          .set({ creditBalanceCents: locked.creditBalanceCents - creditCents })
          .where(eq(trialAccounts.id, trialAccountId));
        await tx.insert(trialCreditLedger).values({
          accountId: trialAccountId,
          deltaCents: -creditCents,
          reason: `reserved for ${plan.planKey} ${term.termKey} checkout`,
        });
      }
      const ft = featureTier.tierKey !== 'standard' ? featureTier : null;
      const [row] = await tx.insert(subscriptions).values({
        email,
        companyName,
        trialAccountId,
        planId: plan.id,
        billingTerm: term.termKey,
        featureTierId: ft?.id ?? null,
        status: 'pending',
        committedClaims: plan.committedClaims,
        setupFeeCents: quote.setupCents,
        creditAppliedCents: creditCents,
      }).returning();
      return row!;
    });
  } catch (err) {
    if (err instanceof CreditIneligible) {
      res.status(422).json({ error: CREDIT_COPY, code: `credit_${err.reason}` });
      return;
    }
    throw err;
  }

  try {
    const stripe = await getUncachableStripeClient();

    // Lookup key conventions:
    //   plan_{planKey}_{termKey}         — recurring subscription price
    //   feature_{tierKey}_monthly        — feature tier monthly add-on
    //   setup_{planKey}_{annual|installment} — one-time setup fee
    const planLookupKey   = `plan_${plan.planKey}_${term.termKey}`;
    const setupLookupKey  = `setup_${plan.planKey}_${term.termKey === 'annual' ? 'annual' : 'installment'}`;

    // Verify amounts against DB — fails loudly if Stripe catalog is stale.
    const [planPriceId, setupPriceId] = await Promise.all([
      resolveVerifiedPrice(planLookupKey, quote.installmentCents),
      resolveVerifiedPrice(setupLookupKey, quote.setupCents),
    ]);

    // Build Stripe line items.
    const lineItems: Array<{ price: string; quantity: number }> = [
      { price: planPriceId, quantity: 1 },
      { price: setupPriceId, quantity: 1 },
    ];

    if (featureTier.tierKey !== 'standard') {
      const ftLookupKey = `feature_${featureTier.tierKey}_monthly`;
      const ftPriceId = await resolveVerifiedPrice(ftLookupKey, featureTier.monthlyCents);
      lineItems.push({ price: ftPriceId, quantity: 1 });
    }

    // Apply trial credit as a subscription-line-only coupon.
    const discounts: Array<{ coupon: string }> = [];
    if (creditCents > 0) {
      const planPrice = await stripe.prices.retrieve(planPriceId);
      const coupon = await stripe.coupons.create({
        amount_off: creditCents,
        currency: 'usd',
        duration: 'once',
        name: 'Trial package credit',
        applies_to: { products: [planPrice.product as string] },
      });
      discounts.push({ coupon: coupon.id });
    }

    const base = marketingBase();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems,
      ...(discounts.length > 0 ? { discounts } : {}),
      success_url: `${base}/pricing/success?subscription_id=${pending.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing`,
      customer_email: email,
      metadata: {
        kind: 'plan_subscription',
        subscriptionId: pending.id,
        creditCents: creditCents.toString(),
      },
    });

    await db.update(subscriptions)
      .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
      .where(eq(subscriptions.id, pending.id));

    res.json({ checkoutUrl: session.url, quote, creditCents });
  } catch (err) {
    req.log.error({ err }, 'pricing checkout failed');
    // Stripe failed after credit was reserved — release it.
    await releaseCreditReservation(pending.id, 'checkout session creation failed').catch(() => {});
    res.status(502).json({ error: 'Checkout is temporarily unavailable. Please try again shortly.' });
  }
});

// ---------------------------------------------------------------------------
// POST /pricing/checkout/confirm
// ---------------------------------------------------------------------------

const ConfirmBody = z.object({
  subscriptionId: z.string(),
  sessionId: z.string(),
});

router.post('/pricing/checkout/confirm', quoteLimiter.middleware(), async (req: Request, res: Response) => {
  const parsed = ConfirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid confirm request' });
    return;
  }
  const { subscriptionId, sessionId } = parsed.data;
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
  if (!sub || sub.stripeCheckoutSessionId !== sessionId) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }
  if (sub.status === 'active') {
    res.json({ status: 'active', planKey: sub.billingTerm, billingTerm: sub.billingTerm });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.subscriptionId !== sub.id || session.payment_status !== 'paid') {
      res.status(402).json({ error: 'Payment not completed', code: 'not_paid' });
      return;
    }
    // Credit already reserved at checkout — activation never debits again.
    await activatePlanFromSession(session);
    res.json({ status: 'active' });
  } catch (err) {
    req.log.error({ err }, 'pricing checkout confirm failed');
    res.status(500).json({ error: 'Could not verify payment' });
  }
});

export default router;

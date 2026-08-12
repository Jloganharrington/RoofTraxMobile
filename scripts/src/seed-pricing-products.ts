/**
 * Seed Stripe products and prices for the per-claim pricing model.
 * Idempotent — safe to re-run. Uses lookup keys so prices are never duplicated.
 * Run: pnpm --filter @workspace/scripts ts-node src/seed-pricing-products.ts
 *
 * Products created:
 *  • One product per plan (Solo → Regional): recurring subscription prices for
 *    annual / quarterly / monthly billing terms.
 *  • Feature tier add-ons: Professional and Enterprise (monthly recurring).
 *  • Setup fee product: one-time prices per plan × term (annual vs. installment).
 *  • Trial Proof Package: first ($100) and subsequent ($65) one-time prices.
 */

import { getUncachableStripeClient as getStripeClient } from './stripeClient';
import Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Plan / billing term definitions (must match DB seed in migration 056)
// ---------------------------------------------------------------------------

const PLANS = [
  { key: 'solo',     name: 'Solo',     annualCents:   750000, setupAnnualCents:  49500, setupInstallmentCents:  79500 },
  { key: 'crew',     name: 'Crew',     annualCents:  2000000, setupAnnualCents: 149500, setupInstallmentCents: 229500 },
  { key: 'team',     name: 'Team',     annualCents:  4300000, setupAnnualCents: 299500, setupInstallmentCents: 449500 },
  { key: 'fleet',    name: 'Fleet',    annualCents:  9000000, setupAnnualCents: 599500, setupInstallmentCents: 899500 },
  { key: 'regional', name: 'Regional', annualCents: 16500000, setupAnnualCents: 999500, setupInstallmentCents:1499500 },
] as const;

// Per-installment amounts for Stripe (rounded to nearest cent)
function installmentCents(annualCents: number, multiplier: number, installments: number): number {
  return Math.round(annualCents * multiplier / installments);
}

const BILLING = [
  { termKey: 'annual',    multiplier: 1.00, installments: 1,  interval: 'year'  as const, intervalCount: 1 },
  { termKey: 'quarterly', multiplier: 1.10, installments: 4,  interval: 'month' as const, intervalCount: 3 },
  { termKey: 'monthly',   multiplier: 1.25, installments: 12, interval: 'month' as const, intervalCount: 1 },
];

const FEATURE_TIERS = [
  { key: 'professional', name: 'Professional', monthlyCents: 24900 },
  { key: 'enterprise',   name: 'Enterprise',   monthlyCents: 99900 },
];

const TRIAL_PRICE_FIRST_CENTS      = Number(process.env.TRIAL_PRICE_FIRST_CENTS)      || 10000;
const TRIAL_PRICE_SUBSEQUENT_CENTS = Number(process.env.TRIAL_PRICE_SUBSEQUENT_CENTS) || 6500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertProduct(
  stripe: Stripe,
  name: string,
  metadata: Record<string, string> = {},
): Promise<string> {
  const list = await stripe.products.list({ limit: 100 });
  const existing = list.data.find((p) => p.name === name && p.active);
  if (existing) return existing.id;
  const created = await stripe.products.create({ name, metadata });
  console.log(`  ✚ created product: ${name}`);
  return created.id;
}

async function upsertRecurringPrice(
  stripe: Stripe,
  opts: {
    lookupKey: string;
    productId: string;
    amountCents: number;
    currency: string;
    interval: 'month' | 'year';
    intervalCount: number;
    nickname: string;
  },
): Promise<void> {
  const existing = await stripe.prices.list({ lookup_keys: [opts.lookupKey], expand: ['data.product'] });
  if (existing.data.length > 0) {
    const cur = existing.data[0]!;
    if (cur.unit_amount === opts.amountCents && cur.active) {
      console.log(`  ✓ price OK: ${opts.lookupKey}`);
      return;
    }
    // Amount changed — archive old price and create new with transferred lookup key.
    await stripe.prices.update(cur.id, { active: false, lookup_key: '', transfer_lookup_key: false } as never);
    console.log(`  ↺ archived stale price: ${opts.lookupKey}`);
  }
  await stripe.prices.create({
    product: opts.productId,
    unit_amount: opts.amountCents,
    currency: opts.currency,
    recurring: { interval: opts.interval, interval_count: opts.intervalCount },
    lookup_key: opts.lookupKey,
    transfer_lookup_key: true,
    nickname: opts.nickname,
  });
  console.log(`  ✚ created price: ${opts.lookupKey} = ${opts.amountCents} cents`);
}

async function upsertOneTimePrice(
  stripe: Stripe,
  opts: {
    lookupKey: string;
    productId: string;
    amountCents: number;
    currency: string;
    nickname: string;
  },
): Promise<void> {
  const existing = await stripe.prices.list({ lookup_keys: [opts.lookupKey] });
  if (existing.data.length > 0) {
    const cur = existing.data[0]!;
    if (cur.unit_amount === opts.amountCents && cur.active) {
      console.log(`  ✓ price OK: ${opts.lookupKey}`);
      return;
    }
    await stripe.prices.update(cur.id, { active: false, lookup_key: '', transfer_lookup_key: false } as never);
    console.log(`  ↺ archived stale price: ${opts.lookupKey}`);
  }
  await stripe.prices.create({
    product: opts.productId,
    unit_amount: opts.amountCents,
    currency: opts.currency,
    lookup_key: opts.lookupKey,
    transfer_lookup_key: true,
    nickname: opts.nickname,
  });
  console.log(`  ✚ created price: ${opts.lookupKey} = ${opts.amountCents} cents`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const stripe = await getStripeClient();
  console.log('Seeding Stripe pricing catalog (per-claim model)...\n');

  // ── Plan subscription products & prices ──────────────────────────────────
  console.log('=== Plan subscription prices ===');
  for (const plan of PLANS) {
    const productName = `RoofTrax ${plan.name}`;
    const productId = await upsertProduct(stripe, productName, { planKey: plan.key });
    for (const term of BILLING) {
      const amount = installmentCents(plan.annualCents, term.multiplier, term.installments);
      await upsertRecurringPrice(stripe, {
        lookupKey: `plan_${plan.key}_${term.termKey}`,
        productId,
        amountCents: amount,
        currency: 'usd',
        interval: term.interval,
        intervalCount: term.intervalCount,
        nickname: `${plan.name} — ${term.termKey}`,
      });
    }
  }

  // ── Feature tier add-on prices (monthly recurring) ───────────────────────
  console.log('\n=== Feature tier prices ===');
  for (const ft of FEATURE_TIERS) {
    const productName = `RoofTrax ${ft.name}`;
    const productId = await upsertProduct(stripe, productName, { featureTierKey: ft.key });
    await upsertRecurringPrice(stripe, {
      lookupKey: `feature_${ft.key}_monthly`,
      productId,
      amountCents: ft.monthlyCents,
      currency: 'usd',
      interval: 'month',
      intervalCount: 1,
      nickname: `${ft.name} add-on`,
    });
  }

  // ── Setup fee prices (one-time) ───────────────────────────────────────────
  console.log('\n=== Setup fee prices ===');
  const setupProductId = await upsertProduct(stripe, 'RoofTrax Setup & Onboarding', { type: 'setup' });
  for (const plan of PLANS) {
    await upsertOneTimePrice(stripe, {
      lookupKey: `setup_${plan.key}_annual`,
      productId: setupProductId,
      amountCents: plan.setupAnnualCents,
      currency: 'usd',
      nickname: `${plan.name} setup — annual`,
    });
    await upsertOneTimePrice(stripe, {
      lookupKey: `setup_${plan.key}_installment`,
      productId: setupProductId,
      amountCents: plan.setupInstallmentCents,
      currency: 'usd',
      nickname: `${plan.name} setup — installment`,
    });
  }

  // ── Trial Proof Package prices ────────────────────────────────────────────
  console.log('\n=== Trial Proof Package prices ===');
  const trialProductId = await upsertProduct(stripe, 'RoofTrax Trial Proof Package', { type: 'trial' });
  await upsertOneTimePrice(stripe, {
    lookupKey: 'trial_package_first',
    productId: trialProductId,
    amountCents: TRIAL_PRICE_FIRST_CENTS,
    currency: 'usd',
    nickname: 'Trial — first package',
  });
  await upsertOneTimePrice(stripe, {
    lookupKey: 'trial_package_subsequent',
    productId: trialProductId,
    amountCents: TRIAL_PRICE_SUBSEQUENT_CENTS,
    currency: 'usd',
    nickname: 'Trial — subsequent package',
  });

  console.log('\nDone.');
}

main().catch((err) => { console.error(err); process.exit(1); });

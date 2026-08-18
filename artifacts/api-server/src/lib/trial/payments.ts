/**
 * Payment provider for trial packages — Stripe Checkout.
 *
 * Prices live in Stripe (seeded by scripts/src/seed-pricing-products.ts) and
 * are resolved by lookup key. The unit amount is verified against the trial
 * config at checkout time so a stale seed fails loudly instead of charging
 * the wrong price.
 *
 * Fulfillment: the success URL returns to the status page, which calls
 * GET /trial/checkout/confirm?sessionId=... — that route verifies
 * payment_status with Stripe and invokes recordSuccessfulPayment() (the same
 * idempotent path the dev simulate-payment route uses).
 */
import { logger } from '../logger';
import { getUncachableStripeClient } from '../stripe/stripeClient';

export class PaymentsNotConfigured extends Error {
  constructor() {
    super('Payments are not configured yet');
  }
}

export const TRIAL_PRICE_LOOKUP_FIRST = 'trial_package_first';
export const TRIAL_PRICE_LOOKUP_SUBSEQUENT = 'trial_package_subsequent';

function marketingBase(): string {
  const host = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.PRODUCTION_ORIGIN ?? '';
  return `${host}/axiomrestore-web`;
}

/** Resolve an active Stripe price by lookup key, verifying its amount. */
export async function resolveVerifiedPrice(lookupKey: string, expectedCents: number): Promise<string> {
  const stripe = await getUncachableStripeClient();
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) {
    throw new Error(`Stripe price with lookup key "${lookupKey}" not found — run the seed-pricing-products script`);
  }
  if (price.unit_amount !== expectedCents) {
    throw new Error(
      `Stripe price ${lookupKey} amount ${price.unit_amount} does not match configured ${expectedCents} — re-run the seed-pricing-products script`,
    );
  }
  return price.id;
}

export async function createCheckout(opts: {
  submissionId: string;
  sequenceNum: number;
  amountCents: number;
  email: string;
}): Promise<{ url: string }> {
  const stripe = await getUncachableStripeClient();
  const lookupKey = opts.sequenceNum === 1 ? TRIAL_PRICE_LOOKUP_FIRST : TRIAL_PRICE_LOOKUP_SUBSEQUENT;
  const priceId = await resolveVerifiedPrice(lookupKey, opts.amountCents);

  const base = marketingBase();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: opts.email,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { kind: 'trial_package', submissionId: opts.submissionId },
    success_url: `${base}/proof-package/status/${opts.submissionId}?checkout_session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/proof-package/status/${opts.submissionId}?checkout=canceled`,
  });

  if (!session.url) {
    throw new Error('Stripe returned a checkout session without a URL');
  }
  return { url: session.url };
}

/**
 * Verify a checkout session with Stripe. Returns the payment id only when
 * Stripe confirms the session is paid AND it belongs to the submission.
 */
export async function verifyPaidCheckoutSession(
  sessionId: string,
  submissionId: string,
): Promise<{ paid: boolean; paymentId: string | null }> {
  const stripe = await getUncachableStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.metadata?.submissionId !== submissionId) {
    return { paid: false, paymentId: null };
  }
  if (session.payment_status !== 'paid') {
    return { paid: false, paymentId: null };
  }
  const paymentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? session.id;
  return { paid: true, paymentId };
}

export async function issueRefund(opts: {
  submissionId: string;
  stripePaymentId: string | null;
}): Promise<{ ok: boolean; detail: string }> {
  if (!opts.stripePaymentId || opts.stripePaymentId.startsWith('sim_')) {
    logger.warn({ submissionId: opts.submissionId }, 'trial refund: simulated payment — manual follow-up required');
    return { ok: false, detail: 'Simulated payment — no Stripe refund needed' };
  }
  try {
    const stripe = await getUncachableStripeClient();
    const refund = await stripe.refunds.create({ payment_intent: opts.stripePaymentId });
    return { ok: true, detail: `Refund ${refund.id} (${refund.status})` };
  } catch (err) {
    logger.error({ err, submissionId: opts.submissionId }, 'trial refund failed — issue manually');
    return { ok: false, detail: `Stripe refund failed: ${(err as Error).message} — issue manually` };
  }
}

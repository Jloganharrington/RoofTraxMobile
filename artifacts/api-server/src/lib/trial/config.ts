/**
 * Trial Proof Package configuration (spec §10).
 * All values environment-configurable, no redeploy.
 */

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const trialConfig = {
  get priceFirstCents() { return intEnv('TRIAL_PRICE_FIRST_CENTS', 10000); },
  get priceSubsequentCents() { return intEnv('TRIAL_PRICE_SUBSEQUENT_CENTS', 6500); },
  get maxPackages() { return intEnv('TRIAL_MAX_PACKAGES', 3); },
  get creditWindowDays() { return intEnv('TRIAL_CREDIT_WINDOW_DAYS', 90); },
  get creditMinTier() { return process.env.TRIAL_CREDIT_MIN_TIER || 'crew'; },
  get weeklyIntakeCap() { return intEnv('TRIAL_WEEKLY_INTAKE_CAP', 15); },
  get turnaroundBusinessDays() { return intEnv('TRIAL_TURNAROUND_BUSINESS_DAYS', 2); },
  get purgeAfterDays() { return intEnv('TRIAL_PURGE_AFTER_DAYS', 30); },
  get rejectedPurgeAfterDays() { return intEnv('TRIAL_REJECTED_PURGE_AFTER_DAYS', 7); },
  /** Service-area exclusion (GTM §2.4 unresolved) — mechanism built, list empty. */
  get excludedZips(): string[] {
    const raw = process.env.TRIAL_EXCLUDED_ZIPS || '';
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return raw.split(',').map((z) => z.trim()).filter(Boolean);
    }
  },
  /** Booking link used in the "ready" email (Calendly-style). */
  get bookingUrl() { return process.env.TRIAL_BOOKING_URL || ''; },
  /** Dev-only: allow simulating a successful payment without Stripe. */
  get devFakePayments() { return process.env.TRIAL_DEV_FAKE_PAYMENTS === '1'; },
};

export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com',
  'icloud.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
  'ymail.com', 'googlemail.com', 'me.com', 'mac.com',
]);

export function isFreeEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  return !domain || FREE_EMAIL_DOMAINS.has(domain);
}

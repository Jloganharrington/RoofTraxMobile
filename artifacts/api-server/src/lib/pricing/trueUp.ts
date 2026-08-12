/**
 * Annual subscription true-up — per-claim model.
 * Master Build Document v1.0 §2.4: annual, upward only.
 *
 * If a customer's claims consumed > committed at renewal, the new commitment
 * is the higher of committed and consumed. Billing for overages during the term
 * is handled via the claim_ledger (overage source rows) — this job only ratchets
 * the committed_claims floor for the next term and logs the event.
 */
import { eq, lt, and, isNull } from 'drizzle-orm';
import { db, subscriptions } from '@workspace/db';
import { logger } from '../logger';

export async function runAnnualTrueUp(): Promise<void> {
  const now = new Date();

  // Find active annual subscriptions whose term has ended.
  const expired = await db.select().from(subscriptions).where(
    and(
      eq(subscriptions.status, 'active'),
      eq(subscriptions.billingTerm, 'annual'),
      lt(subscriptions.termEnd!, now),
    ),
  );

  for (const sub of expired) {
    try {
      const newCommit = Math.max(sub.committedClaims, sub.claimsConsumed);
      const ratcheted = newCommit > sub.committedClaims;
      await db.update(subscriptions).set({
        committedClaims: newCommit,
        claimsConsumed: 0,
        claimsBanked: sub.claimsBanked + Math.max(0, sub.committedClaims - sub.claimsConsumed),
        updatedAt: now,
      }).where(eq(subscriptions.id, sub.id));
      if (ratcheted) {
        logger.info({ subscriptionId: sub.id, from: sub.committedClaims, to: newCommit }, 'annual true-up: commitment ratcheted');
      }
    } catch (err) {
      logger.error({ err, subscriptionId: sub.id }, 'annual true-up error');
    }
  }
}

export function startAnnualTrueUpJob(): NodeJS.Timeout {
  // Run once daily at ~2 AM.
  const MS_PER_DAY = 86_400_000;
  const now = new Date();
  const next2am = new Date(now);
  next2am.setHours(2, 0, 0, 0);
  if (next2am <= now) next2am.setTime(next2am.getTime() + MS_PER_DAY);
  const msUntil = next2am.getTime() - now.getTime();

  const timer = setTimeout(async () => {
    await runAnnualTrueUp().catch((err) => logger.error({ err }, 'annual true-up job failed'));
    setInterval(() => runAnnualTrueUp().catch((err) => logger.error({ err }, 'annual true-up job failed')), MS_PER_DAY);
  }, msUntil);

  logger.info({ nextRunMs: msUntil }, 'annual true-up job scheduled');
  return timer;
}

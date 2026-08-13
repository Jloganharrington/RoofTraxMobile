/**
 * Plan-subscription fulfillment shared by the Stripe webhook (authoritative)
 * and the browser-return confirm endpoint (fast path / reconciliation).
 *
 * Credit accounting: credit is reserved (debited) at checkout time under a
 * row lock; activation never touches the balance. Two concurrent checkouts
 * cannot spend the same balance. Reservations release on session expiry or
 * failed session creation.
 */
import { eq, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { companiesTable, db, plans, subscriptions, trialAccounts, trialCreditLedger } from '@workspace/db';
import { logger } from '../logger';

/** Idempotently mark a pending subscription active from a paid Stripe session. */
export async function activatePlanFromSession(
  session: Stripe.Checkout.Session,
): Promise<'activated' | 'already_active' | 'not_found' | 'not_paid'> {
  const subId = session.metadata?.subscriptionId;
  if (!subId) return 'not_found';
  if (session.payment_status !== 'paid') return 'not_paid';

  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
  const stripeSubId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null;

  const outcome = { value: 'not_found' as 'activated' | 'already_active' | 'not_found' };

  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(subscriptions)
      .where(eq(subscriptions.id, subId)).for('update');
    if (!locked) return;
    if (locked.status === 'active') { outcome.value = 'already_active'; return; }
    const now = new Date();
    const termDays = locked.billingTerm === 'annual' ? 365
      : locked.billingTerm === 'quarterly' ? 92
      : 31;
    await tx.update(subscriptions).set({
      status: 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubId,
      setupPaidAt: now,
      termStart: now,
      termEnd: new Date(now.getTime() + termDays * 86_400_000),
      updatedAt: now,
    }).where(eq(subscriptions.id, subId));

    // Promote the tenant company's subscription_level to the activated plan key.
    // tenantId is set post-provisioning; skip if still null (pre-onboarding purchase).
    if (locked.tenantId) {
      const [planRow] = await tx
        .select({ planKey: plans.planKey })
        .from(plans)
        .where(eq(plans.id, locked.planId));
      if (planRow?.planKey) {
        await tx
          .update(companiesTable)
          .set({ subscriptionLevel: planRow.planKey })
          .where(eq(companiesTable.id, locked.tenantId));
      }
    }

    outcome.value = 'activated';
  });

  if (outcome.value === 'activated') logger.info({ subId }, 'plan subscription activated');
  return outcome.value;
}

/**
 * Release a reserved trial credit back to the account and cancel the
 * pending subscription row. Safe to call repeatedly — only pending rows
 * with a non-zero credit reservation are touched.
 */
export async function releaseCreditReservation(
  subscriptionId: string,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId)).for('update');
    if (!locked || locked.status !== 'pending') return;
    const reserved = locked.creditAppliedCents ?? 0;
    if (reserved > 0 && locked.trialAccountId) {
      await tx.update(trialAccounts).set({
        creditBalanceCents: sql`${trialAccounts.creditBalanceCents} + ${reserved}`,
      }).where(eq(trialAccounts.id, locked.trialAccountId));
      await tx.insert(trialCreditLedger).values({
        accountId: locked.trialAccountId,
        deltaCents: reserved,
        reason: `reservation released: ${reason}`,
      });
    }
    await tx.update(subscriptions).set({
      status: 'canceled',
      creditAppliedCents: 0,
      updatedAt: new Date(),
    }).where(eq(subscriptions.id, subscriptionId));
  });
  logger.info({ subscriptionId, reason }, 'plan checkout reservation released');
}

/**
 * Business fulfillment for verified Stripe webhook events. Called after
 * stripe-replit-sync verifies the signature. All handlers are idempotent.
 *
 * checkout.session.completed:
 *   - plan_subscription → activatePlanFromSession
 *   - trial_package     → recordSuccessfulPayment
 * checkout.session.expired:
 *   - plan_subscription → releaseCreditReservation
 */
export async function handleStripeBusinessEvent(event: {
  type?: string;
  data?: { object?: Record<string, unknown> };
}): Promise<void> {
  const type = event?.type;

  // ── Subscription lifecycle revocation ─────────────────────────────────────
  // customer.subscription.deleted  → subscription ended; revoke entitlement.
  // customer.subscription.updated  → subscription status changed; revoke when
  //   the new status is canceled, unpaid, or past_due.
  if (type === 'customer.subscription.deleted' || type === 'customer.subscription.updated') {
    const sub = event.data?.object as unknown as Stripe.Subscription | undefined;
    if (!sub) return;
    const shouldRevoke =
      type === 'customer.subscription.deleted' ||
      ['canceled', 'unpaid', 'past_due'].includes(sub.status);
    // Reinstate when a past_due/unpaid subscription recovers to active.
    const shouldReinstate = !shouldRevoke && sub.status === 'active';
    if (!shouldRevoke && !shouldReinstate) return;

    // Find the company via subscription metadata (set at checkout time for
    // pp_crm_upgrade sessions via subscription_data.metadata).
    const companyId = sub.metadata?.companyId as string | undefined;
    if (companyId) {
      if (shouldReinstate) {
        const planKey = (sub.metadata?.planKey as string | undefined) ?? 'regional';
        await db.update(companiesTable)
          .set({ subscriptionLevel: planKey })
          .where(eq(companiesTable.id, companyId));
        logger.info({ companyId, subId: sub.id, planKey }, 'company subscription_level reinstated');
      } else {
        await db.update(companiesTable)
          .set({ subscriptionLevel: 'none' })
          .where(eq(companiesTable.id, companyId));
        logger.info({ companyId, subId: sub.id, status: sub.status }, 'company subscription_level revoked');
      }
      return;
    }

    // Fallback: look up via subscriptions.tenantId.  The plan_subscription
    // checkout flow is pre-provisioning (no company exists yet, no companyId in
    // metadata) so tenantId will typically be null and this branch is a no-op.
    // It activates only if the admin provisioning step sets tenantId after
    // onboarding, making revoke/reinstate work for that company going forward.
    const stripeSubId = sub.id;
    const [subRow] = await db
      .select({ tenantId: subscriptions.tenantId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
    if (subRow?.tenantId) {
      let newLevel = 'none';
      if (shouldReinstate) {
        // Resolve the actual plan key from the subscriptions → plans join so
        // Solo/Crew/Team/Fleet subscribers are not incorrectly reinstated as Regional.
        const [planRow] = await db
          .select({ planKey: plans.planKey })
          .from(subscriptions)
          .innerJoin(plans, eq(subscriptions.planId, plans.id))
          .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
        newLevel = planRow?.planKey ?? 'regional';
      }
      await db
        .update(companiesTable)
        .set({ subscriptionLevel: newLevel })
        .where(eq(companiesTable.id, subRow.tenantId));
      logger.info(
        { tenantId: subRow.tenantId, stripeSubId, newLevel, action: shouldReinstate ? 'reinstated' : 'revoked' },
        'company subscription_level updated via tenantId',
      );
    }
    return;
  }

  // ── Checkout session events ────────────────────────────────────────────────
  if (type !== 'checkout.session.completed' && type !== 'checkout.session.expired') return;
  const session = event.data?.object as unknown as Stripe.Checkout.Session | undefined;
  if (!session) return;
  const kind = session.metadata?.kind;

  if (type === 'checkout.session.completed') {
    if (kind === 'plan_subscription') {
      await activatePlanFromSession(session);
    } else if (kind === 'trial_package') {
      const submissionId = session.metadata?.submissionId;
      if (submissionId && session.payment_status === 'paid') {
        const { recordSuccessfulPayment } = await import('../../routes/trial');
        const paymentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? session.id;
        await recordSuccessfulPayment(submissionId, paymentId);
      }
    } else if (kind === 'pp_crm_upgrade') {
      const companyId = session.metadata?.companyId;
      if (companyId && session.payment_status === 'paid') {
        const { fulfillCRMUpgrade } = await import('../../lib/pp/upgrade');
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
        const stripeSubId =
          typeof session.subscription === 'string'
            ? session.subscription
            : (session.subscription as { id?: string } | null)?.id ?? null;
        const planKey = session.metadata?.planKey ?? null;
        await fulfillCRMUpgrade(companyId, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: stripeSubId,
          planKey,
        });
      }
    }
  } else if (type === 'checkout.session.expired') {
    if (kind === 'plan_subscription' && session.metadata?.subscriptionId) {
      await releaseCreditReservation(
        session.metadata.subscriptionId,
        'checkout session expired',
      );
    }
  }
}

/**
 * PP → CRM upgrade fulfillment.
 *
 * fulfillCRMUpgrade(companyId) is called by the Stripe webhook handler
 * (authoritative path) after a checkout.session.completed event with
 * kind = 'pp_crm_upgrade'. It is idempotent — safe to call more than once.
 */
import { eq } from 'drizzle-orm';
import { companiesTable, db, userProfilesTable, usersTable } from '@workspace/db';
import { logger } from '../logger';
import { sendPPEmail } from './mailer';

const SIGNOFF = '\n\n— The RoofTrax Team';

function crmUpgradeEmail(companyName: string, dashboardUrl: string) {
  return {
    subject: 'Welcome to RoofTrax CRM — your account is ready',
    text: [
      `Great news! ${companyName} has been upgraded to the full RoofTrax CRM.`,
      '',
      'You now have access to:',
      '  • Lead pipelines and insurance workflows',
      '  • Team management and rep tracking',
      '  • The full mobile field app',
      '  • All existing inspections and Proof Packages',
      '',
      `Log in to your dashboard: ${dashboardUrl}`,
      '',
      'If you have any questions, reply to this email.',
      SIGNOFF,
    ].join('\n'),
  };
}

/**
 * Atomically promote a PP-only company to the CRM tier.
 * Safe to call multiple times — already-CRM companies are a no-op.
 *
 * @returns 'upgraded' | 'already_crm' | 'not_found'
 */
export async function fulfillCRMUpgrade(
  companyId: string,
  opts: { stripeCustomerId?: string | null; stripeSubscriptionId?: string | null; planKey?: string | null } = {},
): Promise<'upgraded' | 'already_crm' | 'not_found'> {
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));

  if (!company) return 'not_found';
  if (company.ppTier === 'crm') return 'already_crm';

  // Atomically promote to CRM: set pp_tier = 'crm' and subscription_level to
  // the purchased plan key. Fall back to 'regional' only if no plan key is
  // provided (e.g. dev-bypass path) so the company always passes the gate.
  const subscriptionLevel = opts.planKey ?? 'regional';
  await db
    .update(companiesTable)
    .set({ ppTier: 'crm', subscriptionLevel })
    .where(eq(companiesTable.id, companyId));

  logger.info(
    { companyId, stripeCustomerId: opts.stripeCustomerId, stripeSubscriptionId: opts.stripeSubscriptionId },
    'pp company promoted to crm tier',
  );

  // Send confirmation email to the founder (fire-and-forget).
  const founder = company.founderUserId
    ? (
        await db
          .select({ email: usersTable.email, firstName: usersTable.firstName })
          .from(usersTable)
          .where(eq(usersTable.id, company.founderUserId))
      )[0]
    : null;

  if (founder?.email) {
    const origin = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}/rooftrax-web`
      : process.env.CANONICAL_ORIGIN ?? process.env.PRODUCTION_ORIGIN ?? '';
    const tmpl = crmUpgradeEmail(company.name, origin + '/');
    void sendPPEmail(founder.email, tmpl.subject, tmpl.text).catch(() => {});
  }

  return 'upgraded';
}

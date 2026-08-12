import { runMigrations } from 'stripe-replit-sync';
import { logger } from '../logger';
import { getStripeSync } from './stripeClient';

/**
 * Initialize the stripe schema, managed webhook, and data backfill.
 * Called on server startup. Failures are logged loudly but do not kill the
 * server — the API serves the whole product, not just billing; checkout
 * routes will surface their own errors if Stripe is unreachable.
 */
export async function initStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for Stripe integration');
  }

  logger.info('Initializing Stripe schema...');
  await runMigrations({ databaseUrl });

  const stripeSync = await getStripeSync();

  const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
  const webhookResult = await stripeSync.findOrCreateManagedWebhook(
    `${webhookBaseUrl}/api/stripe/webhook`,
  );
  logger.info({ url: webhookResult?.url }, 'Stripe managed webhook configured');

  stripeSync
    .syncBackfill()
    .then(() => logger.info('Stripe data synced'))
    .catch((err) => logger.error({ err }, 'Error syncing Stripe data'));
}

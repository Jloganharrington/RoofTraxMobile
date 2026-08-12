/**
 * Nightly trial data-retention job (spec §8) + lifecycle reminder emails (§7).
 *
 * Purge: for every submission with purge_after <= now and purged_at null:
 *   - delete all trial_uploads objects from storage (and rows)
 *   - null out claim fields: property_address, property_city, property_zip,
 *     carrier_name, claim_number_ref, scope_notes, date_of_loss
 *   - retain: property_state, county, ahj_jurisdiction, peril_type,
 *     roof_system, stories, timestamps, payment records
 *   - set purged_at, write trial_purge_audit row
 *
 * Reminders (sent once, on the matching day, delivered submissions only):
 *   - day 30 / day 60 after delivery: check-in + credit balance reminder
 *   - 7 days before credit expiry: credit expiring warning
 */
import { and, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import {
  db,
  trialAccounts,
  trialPurgeAudit,
  trialSubmissions,
  trialUploads,
} from '@workspace/db';
import { logger } from '../logger';
import { ObjectStorageService } from '../objectStorage';
import { sendTrialEmail, trialEmails } from './mailer';

const PURGED_FIELDS = [
  'property_address', 'property_city', 'property_zip',
  'carrier_name', 'claim_number_ref', 'scope_notes', 'date_of_loss',
] as const;

export async function runTrialPurge(): Promise<number> {
  const now = new Date();
  const due = await db
    .select()
    .from(trialSubmissions)
    .where(and(
      isNull(trialSubmissions.purgedAt),
      isNotNull(trialSubmissions.purgeAfter),
      lte(trialSubmissions.purgeAfter, now),
    ));

  const storage = new ObjectStorageService();
  let purged = 0;
  for (const sub of due) {
    try {
      const uploads = await db.select().from(trialUploads).where(eq(trialUploads.submissionId, sub.id));
      let deleted = 0;
      for (const up of uploads) {
        try {
          await storage.deleteObjectEntity(up.fileKey);
          deleted++;
        } catch (err) {
          logger.warn({ err, fileKey: up.fileKey }, 'trial purge: object delete failed (continuing)');
        }
      }
      await db.delete(trialUploads).where(eq(trialUploads.submissionId, sub.id));
      // The compiled deliverable also contains claim data — delete it too.
      // If its deletion fails, skip the submission (retry next run) rather
      // than marking it purged while the file survives.
      if (sub.deliverableFileKey) {
        await storage.deleteObjectEntity(sub.deliverableFileKey);
        deleted++;
      }
      // Logo is branding, but it lives in uploads storage keyed to the
      // submission — claim-adjacent files are gone; the logo file key is
      // nulled with the claim fields only if present in uploads. Branding
      // metadata (color, license display) is retained.
      await db.update(trialSubmissions).set({
        propertyAddress: null,
        propertyCity: null,
        propertyZip: null,
        carrierName: null,
        claimNumberRef: null,
        scopeNotes: null,
        dateOfLoss: null,
        deliverableFileKey: null,
        deliverableToken: null,
        purgedAt: now,
      }).where(eq(trialSubmissions.id, sub.id));
      await db.insert(trialPurgeAudit).values({
        submissionId: sub.id,
        uploadsDeleted: deleted,
        fieldsNulled: PURGED_FIELDS.join(','),
        detail: `status=${sub.status} purge_after=${sub.purgeAfter?.toISOString()}`,
      });
      purged++;
    } catch (err) {
      logger.error({ err, submissionId: sub.id }, 'trial purge failed for submission');
    }
  }
  if (purged > 0) logger.info({ purged }, 'trial purge complete');
  return purged;
}

function daysSince(d: Date, now: Date): number {
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

export async function runTrialReminders(): Promise<void> {
  const now = new Date();
  // Day 30 / 60 check-ins for delivered submissions.
  const delivered = await db
    .select({
      sub: trialSubmissions,
      account: trialAccounts,
    })
    .from(trialSubmissions)
    .innerJoin(trialAccounts, eq(trialSubmissions.accountId, trialAccounts.id))
    .where(and(eq(trialSubmissions.status, 'delivered'), isNotNull(trialSubmissions.deliveredAt)));

  for (const { sub, account } of delivered) {
    const day = daysSince(sub.deliveredAt!, now);
    if (day === 30 || day === 60) {
      const tmpl = trialEmails.checkIn(
        day,
        account.creditBalanceCents,
        account.creditExpiresAt ? account.creditExpiresAt.toISOString().slice(0, 10) : 'n/a',
      );
      void sendTrialEmail(account.email, tmpl.subject, tmpl.text).catch(() => {});
    }
  }

  // Credit expiry warning ~7 days out (spec: day 83 for a 90-day window).
  const accounts = await db
    .select()
    .from(trialAccounts)
    .where(and(isNotNull(trialAccounts.creditExpiresAt), sql`${trialAccounts.creditBalanceCents} > 0`));
  for (const account of accounts) {
    const daysLeft = Math.ceil((account.creditExpiresAt!.getTime() - now.getTime()) / 86_400_000);
    if (daysLeft === 7) {
      const tmpl = trialEmails.creditExpiring(account.creditBalanceCents, daysLeft);
      void sendTrialEmail(account.email, tmpl.subject, tmpl.text).catch(() => {});
    }
  }
}

let lastRunDate = '';

/**
 * Start the nightly scheduler. Checks hourly; runs the purge + reminders
 * once per UTC day. Exact-day matching in reminders keeps a same-day rerun
 * from double-sending only if the process restarts — acceptable for v1.
 */
export function startTrialNightlyJob(): void {
  const tick = async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (today === lastRunDate) return;
    lastRunDate = today;
    try {
      await runTrialPurge();
      await runTrialReminders();
    } catch (err) {
      logger.error({ err }, 'trial nightly job failed');
    }
  };
  setInterval(tick, 60 * 60 * 1000).unref();
  void tick();
}

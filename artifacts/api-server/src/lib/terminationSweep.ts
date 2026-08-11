/**
 * Nightly deactivation sweep.
 *
 * Runs at 02:00 every night. For each user deactivated but not yet PII-purged:
 *   7d  — send staff_inventory_reminder to direct manager or admins
 *   14d — send staff_inventory_reminder again
 *   21d — send staff_escalation_reminder to all managers/admins (escalate)
 *   30d — scrub PII from the user row and profile
 *
 * Every action (including blocked purge attempts) is written to
 * deactivation_sweep_log so nothing sits in limbo unnoticed.
 */

import { schedule } from 'node-cron';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  db,
  deactivationSweepLogTable,
  userProfilesTable,
  userPushTokensTable,
  usersTable,
} from '@workspace/db';
import { notify } from './notify';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SweepAction = 'alert_7d' | 'alert_14d' | 'escalate_21d' | 'purge_30d' | 'blocked';

// ---------------------------------------------------------------------------
// Core sweep function (exported for testing)
// ---------------------------------------------------------------------------

export async function runTerminationSweep(): Promise<void> {
  const now = new Date();
  logger.info('terminationSweep: starting');

  // All users deactivated but not yet PII-purged.
  const deactivatedUsers = await db
    .select({
      id:            usersTable.id,
      companyId:     usersTable.companyId,
      deactivatedAt: usersTable.deactivatedAt,
    })
    .from(usersTable)
    .where(
      and(
        isNotNull(usersTable.deactivatedAt),
        isNull(usersTable.piiPurgedAt),
      ),
    );

  if (deactivatedUsers.length === 0) {
    logger.info('terminationSweep: no eligible users');
    return;
  }

  // Load existing sweep log entries for exactly the users in this batch.
  const userIds = deactivatedUsers.map((u) => u.id);
  const existingLogs = await db
    .select({
      userId:      deactivationSweepLogTable.userId,
      actionTaken: deactivationSweepLogTable.actionTaken,
    })
    .from(deactivationSweepLogTable)
    .where(inArray(deactivationSweepLogTable.userId, userIds));

  // Build a set: `${userId}:${actionTaken}` → true
  const doneSet = new Set<string>();
  for (const row of existingLogs) {
    if (userIds.includes(row.userId)) {
      doneSet.add(`${row.userId}:${row.actionTaken}`);
    }
  }

  let processed = 0;
  let purged    = 0;
  let blocked   = 0;

  for (const user of deactivatedUsers) {
    try {
      const deactivatedAt = user.deactivatedAt!;
      const daysSince     = Math.floor((now.getTime() - deactivatedAt.getTime()) / 86_400_000);

      await processUser({
        userId:      user.id,
        companyId:   user.companyId,
        deactivatedAt,
        daysSince,
        doneSet,
        now,
      });

      processed++;
      if (doneSet.has(`${user.id}:purge_30d`)) purged++;
    } catch (err) {
      // One failure must not halt the rest.
      logger.error({ err, userId: user.id }, 'terminationSweep: unexpected error for user');
      blocked++;
    }
  }

  logger.info({ processed, purged, blocked }, 'terminationSweep: complete');
}

// ---------------------------------------------------------------------------
// Per-user processing
// ---------------------------------------------------------------------------

async function processUser({
  userId,
  companyId,
  deactivatedAt,
  daysSince,
  doneSet,
  now,
}: {
  userId:        string;
  companyId:     string;
  deactivatedAt: Date;
  daysSince:     number;
  doneSet:       Set<string>;
  now:           Date;
}): Promise<void> {
  // 30-day purge (highest priority — attempt before returning).
  // Retried every night until it succeeds (purge_30d log exists) — 'blocked'
  // entries are recorded for the report but do NOT gate future attempts.
  if (daysSince >= 30 && !doneSet.has(`${userId}:purge_30d`)) {
    await attemptPurge({ userId, companyId, deactivatedAt, daysSince, doneSet, now });
    return; // whether it succeeded or was blocked, we're done for this user today
  }

  // 21-day escalation.
  if (daysSince >= 21 && !doneSet.has(`${userId}:escalate_21d`)) {
    await writeLog({
      userId, companyId, deactivatedAt, daysSince,
      actionTaken: 'escalate_21d',
      processedAt: now,
    });
    doneSet.add(`${userId}:escalate_21d`);

    void notify({
      type:         'staff_escalation_reminder',
      companyId,
      targetUserId: userId,
      payload:      { daysSince },
    }).catch((err) =>
      logger.warn({ err, userId }, 'terminationSweep: escalation notify error'),
    );
  }

  // 14-day reminder.
  if (daysSince >= 14 && !doneSet.has(`${userId}:alert_14d`)) {
    await writeLog({
      userId, companyId, deactivatedAt, daysSince,
      actionTaken: 'alert_14d',
      processedAt: now,
    });
    doneSet.add(`${userId}:alert_14d`);

    void notify({
      type:         'staff_inventory_reminder',
      companyId,
      targetUserId: userId,
      payload:      { daysSince },
    }).catch((err) =>
      logger.warn({ err, userId }, 'terminationSweep: 14d notify error'),
    );
  }

  // 7-day reminder.
  if (daysSince >= 7 && !doneSet.has(`${userId}:alert_7d`)) {
    await writeLog({
      userId, companyId, deactivatedAt, daysSince,
      actionTaken: 'alert_7d',
      processedAt: now,
    });
    doneSet.add(`${userId}:alert_7d`);

    void notify({
      type:         'staff_inventory_reminder',
      companyId,
      targetUserId: userId,
      payload:      { daysSince },
    }).catch((err) =>
      logger.warn({ err, userId }, 'terminationSweep: 7d notify error'),
    );
  }
}

async function attemptPurge({
  userId,
  companyId,
  deactivatedAt,
  daysSince,
  doneSet,
  now,
}: {
  userId:        string;
  companyId:     string;
  deactivatedAt: Date;
  daysSince:     number;
  doneSet:       Set<string>;
  now:           Date;
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // Scrub PII from users row — name, email, and profile image URL.
      // profileImageUrl may point to a stored photo of the person; null it here.
      // The row itself is retained for FK integrity and audit purposes.
      await tx
        .update(usersTable)
        .set({
          firstName:       '[purged]',
          lastName:        '[purged]',
          email:           `purged-${userId}@purged.invalid`,
          profileImageUrl: null,
          piiPurgedAt:     now,
          updatedAt:       now,
        })
        .where(eq(usersTable.id, userId));

      // Null out all PII-bearing profile fields:
      //   phone, SMTP credentials, signature data (biometric), certifications.
      // signatureUrl points to a stored image of the person's handwritten
      // signature — a biometric asset that must be purged along with the name
      // and email. (Signed documents retain their own pre-rendered copies for
      // legal integrity; this only removes the on-file re-usable asset.)
      await tx
        .update(userProfilesTable)
        .set({
          phone:            null,
          smtpHost:         null,
          smtpPort:         null,
          smtpSecure:       null,
          smtpUsername:     null,
          smtpPasswordEnc:  null,
          smtpFromEmail:    null,
          signatureUrl:     null,
          signatureSha256:  null,
          signatureSignedAt:null,
          certifications:   null,
          updatedAt:        now,
        })
        .where(eq(userProfilesTable.userId, userId));

      // Delete push tokens (device identifiers).
      await tx
        .delete(userPushTokensTable)
        .where(eq(userPushTokensTable.userId, userId));
    });

    await writeLog({
      userId, companyId, deactivatedAt, daysSince,
      actionTaken: 'purge_30d',
      processedAt: now,
    });
    doneSet.add(`${userId}:purge_30d`);
    logger.info({ userId, daysSince }, 'terminationSweep: PII purged');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId }, 'terminationSweep: purge blocked');

    await writeLog({
      userId, companyId, deactivatedAt, daysSince,
      actionTaken:   'blocked',
      blockedReason: reason,
      processedAt:   now,
    }).catch((logErr) =>
      logger.error({ logErr, userId }, 'terminationSweep: failed to write blocked log'),
    );
    // NOTE: do NOT add blocked to doneSet — future sweep runs must retry
    // the purge until it succeeds. The blocked log row is recorded only for
    // the report; it does not gate next night's attempt.
  }
}

// ---------------------------------------------------------------------------
// Log helper
// ---------------------------------------------------------------------------

async function writeLog({
  userId,
  companyId,
  deactivatedAt,
  daysSince,
  actionTaken,
  blockedReason,
  processedAt,
}: {
  userId:        string;
  companyId:     string;
  deactivatedAt: Date;
  daysSince:     number;
  actionTaken:   SweepAction;
  blockedReason?: string;
  processedAt:   Date;
}): Promise<void> {
  await db.insert(deactivationSweepLogTable).values({
    userId,
    companyId,
    deactivatedAt,
    daysSince,
    actionTaken,
    blockedReason: blockedReason ?? null,
    processedAt,
  });
}

// ---------------------------------------------------------------------------
// Cron registration
// ---------------------------------------------------------------------------

export function startTerminationSweep(): void {
  // 02:00 every night, server local time.
  schedule('0 2 * * *', () => {
    runTerminationSweep().catch((err) =>
      logger.error({ err }, 'terminationSweep: top-level cron error'),
    );
  });
  logger.info('terminationSweep: cron registered (02:00 daily)');
}

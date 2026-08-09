/**
 * Push notification delivery via Expo's push service.
 *
 * Design contract (mirrors notify.ts):
 *   - sendPush() is fire-and-forget — it catches and logs all errors internally.
 *   - On a DeviceNotRegistered ticket or receipt, the dead token is deleted
 *     immediately so it never wastes quota again.
 *   - checkPushReceipts() is exposed for on-demand receipt checking (used by
 *     the check-receipts endpoint and callable from a scheduler in production).
 */

import Expo, { type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { inArray } from 'drizzle-orm';
import { db, userPushTokensTable } from '@workspace/db';
import { logger } from './logger';

const expo = new Expo();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushTarget {
  /** DB row id — used to delete dead tokens. */
  tokenId: string;
  /** ExponentPushToken[...] string. */
  token:   string;
  userId:  string;
}

export interface PushPayload {
  title: string;
  body:  string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public: send + immediate ticket check
// ---------------------------------------------------------------------------

/**
 * Send push notifications to a list of targets.
 * Invalid tokens are filtered out before sending.
 * Tickets with DeviceNotRegistered delete the dead token immediately.
 * Any successful ticket IDs are queued for receipt checking.
 *
 * Never throws.
 */
export async function sendPush(
  targets: PushTarget[],
  payload: PushPayload,
): Promise<void> {
  if (targets.length === 0) return;

  // Filter out malformed tokens — Expo rejects them before even reaching APNs/FCM.
  const valid = targets.filter((t) => Expo.isExpoPushToken(t.token));
  if (valid.length === 0) {
    logger.debug({ count: targets.length }, 'push: all tokens invalid, nothing to send');
    return;
  }

  const messages: ExpoPushMessage[] = valid.map((t) => ({
    to:    t.token,
    title: payload.title,
    body:  payload.body,
    data:  payload.data ?? {},
    sound: 'default',
  }));

  // Expo limits 100 messages per request — chunk automatically.
  const chunks = expo.chunkPushNotifications(messages);

  const deadTokenIds: string[]                                   = [];
  const receiptEntries: Array<{ ticketId: string; tokenId: string }> = [];

  let msgOffset = 0;
  for (const chunk of chunks) {
    let tickets: ExpoPushTicket[];
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      logger.warn({ err }, 'push: sendPushNotificationsAsync chunk failed');
      msgOffset += chunk.length;
      continue;
    }

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i]!;
      const target = valid[msgOffset + i]!;

      if (ticket.status === 'error') {
        const errCode = (ticket as { details?: { error?: string } }).details?.error;
        if (errCode === 'DeviceNotRegistered') {
          deadTokenIds.push(target.tokenId);
          logger.info({ tokenId: target.tokenId, userId: target.userId },
            'push: ticket DeviceNotRegistered — queuing token for deletion');
        } else {
          logger.warn({ ticket, tokenId: target.tokenId }, 'push: ticket error');
        }
      } else {
        // status === 'ok' — receipt ID available for later receipt check
        const ticketId = (ticket as { id?: string }).id;
        if (ticketId) receiptEntries.push({ ticketId, tokenId: target.tokenId });
      }
    }

    msgOffset += chunk.length;
  }

  // Delete dead tokens identified from tickets.
  if (deadTokenIds.length > 0) {
    try {
      await db
        .delete(userPushTokensTable)
        .where(inArray(userPushTokensTable.id, deadTokenIds));
      logger.info({ count: deadTokenIds.length }, 'push: deleted dead tokens (ticket-level)');
    } catch (err) {
      logger.warn({ err }, 'push: failed to delete dead tokens');
    }
  }

  // Store receipt entries for later checking.
  // In production, a background job should call checkPushReceipts() ~30min after delivery.
  if (receiptEntries.length > 0) {
    pendingReceipts.push(...receiptEntries);
  }
}

// ---------------------------------------------------------------------------
// Receipt handling
// ---------------------------------------------------------------------------

/**
 * In-process store of pending receipt entries.
 * A production deployment would use a persistent queue or DB table.
 * For the current scope (pre-scheduler), these are drained via the
 * POST /notifications/push-receipts endpoint.
 */
const pendingReceipts: Array<{ ticketId: string; tokenId: string }> = [];

/**
 * Returns and clears the current list of pending receipt entries.
 * Used by the check-receipts endpoint so the caller can drive receipt polling.
 */
export function drainPendingReceiptEntries(): Array<{ ticketId: string; tokenId: string }> {
  return pendingReceipts.splice(0);
}

/**
 * Check Expo push receipts for a batch of ticket IDs.
 * Deletes any tokens that Expo reports as DeviceNotRegistered.
 *
 * @param entries  ticket ID → DB token row ID mappings
 * Never throws.
 */
export async function checkPushReceipts(
  entries: Array<{ ticketId: string; tokenId: string }>,
): Promise<{ checked: number; deleted: number }> {
  if (entries.length === 0) return { checked: 0, deleted: 0 };

  const receiptIdToTokenId = new Map(entries.map((e) => [e.ticketId, e.tokenId]));
  const deadTokenIds: string[] = [];

  try {
    const chunks = expo.chunkPushNotificationReceiptIds([...receiptIdToTokenId.keys()]);

    for (const chunk of chunks) {
      let receipts: Awaited<ReturnType<typeof expo.getPushNotificationReceiptsAsync>>;
      try {
        receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      } catch (err) {
        logger.warn({ err }, 'push: getPushNotificationReceiptsAsync chunk failed');
        continue;
      }

      for (const [receiptId, receipt] of Object.entries(receipts)) {
        if (receipt.status === 'error') {
          const errCode = (receipt as { details?: { error?: string } }).details?.error;
          logger.info({ receiptId, error: errCode }, 'push: receipt error');
          if (errCode === 'DeviceNotRegistered') {
            const tokenId = receiptIdToTokenId.get(receiptId);
            if (tokenId) deadTokenIds.push(tokenId);
          }
        }
      }
    }

    if (deadTokenIds.length > 0) {
      await db
        .delete(userPushTokensTable)
        .where(inArray(userPushTokensTable.id, deadTokenIds));
      logger.info({ count: deadTokenIds.length }, 'push: deleted dead tokens (receipt-level)');
    }
  } catch (err) {
    logger.error({ err }, 'push: checkPushReceipts unexpected error');
  }

  return { checked: entries.length, deleted: deadTokenIds.length };
}

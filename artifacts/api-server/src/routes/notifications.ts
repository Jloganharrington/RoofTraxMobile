/**
 * Notification preferences — self-only read/write.
 *
 *   GET  /notifications/preferences
 *     Returns the catalog filtered to types the caller may receive (by role),
 *     merged with stored overrides. Absence of a row → catalog default.
 *
 *   PATCH /notifications/preferences
 *     Upsert one or many preference rows for the caller. Types the caller
 *     is not eligible to receive are rejected with 403. Self-only — any
 *     userId in the request body is silently ignored; always updates the
 *     caller's own rows.
 *
 * Design notes:
 * - Rows are written ONLY when a user changes something from the catalog
 *   default. Seeding a row per type per user would require backfilling every
 *   time a new notification type is added.
 * - frequency stores all four values (immediate | daily | weekly | off) but
 *   v1 dispatches only immediate and off. daily/weekly are accepted, stored,
 *   and honoured downstream once digest infrastructure exists.
 * - Never notify the actor about their own action — that is a dispatch-layer
 *   concern, not enforced here.
 */

import { z } from 'zod';
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db, notificationPreferencesTable, userProfilesTable, userPushTokensTable } from '@workspace/db';
import { catalogForRole, findNotificationEntry } from '@workspace/authz';
import type { Role } from '@workspace/authz';
import Expo from 'expo-server-sdk';
import { checkPushReceipts, drainPendingReceiptEntries } from '../lib/push';
import { isManagerOrAdmin } from '@workspace/authz';
import { requirePermission } from '../middlewares/requirePermission';

const router = Router();

// ── Shared: resolve merged preference list ────────────────────────────────────

async function buildPreferenceList(userId: string, role: Role) {
  const eligible = catalogForRole(role);

  const stored = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId));

  const storedMap = new Map(stored.map(r => [r.notificationType, r]));

  return eligible.map(entry => {
    const override = storedMap.get(entry.type);
    return {
      type:           entry.type,
      label:          entry.label,
      group:          entry.group,
      recipientRule:  entry.recipientRule,
      emailEnabled:   override !== undefined ? override.emailEnabled : entry.defaultEmail,
      pushEnabled:    override !== undefined ? override.pushEnabled  : entry.defaultPush,
      frequency:      override !== undefined ? override.frequency    : 'immediate',
      supportsDigest: entry.supportsDigest,
    };
  });
}

// ── Shared: resolve caller's role ─────────────────────────────────────────────

async function getCallerRole(userId: string): Promise<Role> {
  const [profile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  return (profile?.role ?? 'field_rep') as Role;
}

// ── GET /notifications/preferences ───────────────────────────────────────────

// notification.manage
router.get('/notifications/preferences', requirePermission('notification.manage'), async (req: Request, res: Response) => {

  const role = await getCallerRole(req.actorCtx!.actorId);
  const preferences = await buildPreferenceList(req.actorCtx!.actorId, role);

  res.json({ preferences });
});

// ── PATCH /notifications/preferences ─────────────────────────────────────────

const PatchBody = z.object({
  // Any extra keys (e.g. a userId field from a client bug) are silently
  // stripped by Zod's default passthrough behaviour — they never reach the
  // update logic. The handler always writes to req.actorCtx!.actorId.
  updates: z
    .array(
      z.object({
        type:         z.string(),
        emailEnabled: z.boolean().optional(),
        pushEnabled:  z.boolean().optional(),
        frequency:    z.enum(['immediate', 'daily', 'weekly', 'off']).optional(),
      }),
    )
    .min(1, 'updates must contain at least one item'),
});

// notification.manage
router.patch('/notifications/preferences', requirePermission('notification.manage'), async (req: Request, res: Response) => {

  const userId    = req.actorCtx!.actorId;
  const companyId = req.actorCtx!.companyId;

  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
    return;
  }

  const { updates } = parsed.data;
  const role = await getCallerRole(userId);
  const eligible = catalogForRole(role);
  const eligibleSet = new Set(eligible.map(e => e.type));

  // Validate all updates up-front before writing any row — fail atomically.
  for (const u of updates) {
    const entry = findNotificationEntry(u.type);
    if (!entry) {
      res.status(400).json({ error: `Unknown notification type: ${u.type}` });
      return;
    }
    if (!eligibleSet.has(u.type)) {
      res.status(403).json({
        error: `Not eligible to configure notification type: ${u.type}`,
      });
      return;
    }
  }

  // Upsert each update. On conflict (existing row), patch only the fields
  // that were provided; leave the rest unchanged.
  for (const u of updates) {
    const entry = findNotificationEntry(u.type)!;

    // Build the conflict-update set explicitly to avoid spreading falsy values.
    const conflictSet: Record<string, unknown> = { updatedAt: new Date() };
    if (u.emailEnabled !== undefined) conflictSet.emailEnabled = u.emailEnabled;
    if (u.pushEnabled  !== undefined) conflictSet.pushEnabled  = u.pushEnabled;
    if (u.frequency    !== undefined) conflictSet.frequency    = u.frequency;

    await db
      .insert(notificationPreferencesTable)
      .values({
        companyId,
        userId,
        notificationType: u.type,
        // On first insert, missing fields fall back to catalog defaults.
        emailEnabled: u.emailEnabled ?? entry.defaultEmail,
        pushEnabled:  u.pushEnabled  ?? entry.defaultPush,
        frequency:    u.frequency    ?? 'immediate',
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflictDoUpdate({
        target: [
          notificationPreferencesTable.userId,
          notificationPreferencesTable.notificationType,
        ],
        set: conflictSet as any,
      });
  }

  // Return the full updated list.
  const preferences = await buildPreferenceList(userId, role);
  res.json({ preferences });
});

// ── POST /notifications/push-tokens ───────────────────────────────────────────

const RegisterPushTokenBody = z.object({
  expoPushToken: z.string().min(1),
  deviceLabel:   z.string().nullable().optional(),
  platform:      z.enum(['ios', 'android']).nullable().optional(),
});

// notification.manage
router.post('/notifications/push-tokens', requirePermission('notification.manage'), async (req: Request, res: Response) => {

  const parsed = RegisterPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
    return;
  }

  const { expoPushToken, deviceLabel, platform } = parsed.data;

  // Validate token format before storing.
  if (!Expo.isExpoPushToken(expoPushToken)) {
    res.status(400).json({ error: 'Invalid Expo push token format' });
    return;
  }

  const [token] = await db
    .insert(userPushTokensTable)
    .values({
      companyId:     req.actorCtx!.companyId,
      userId:        req.actorCtx!.actorId,
      expoPushToken,
      deviceLabel:   deviceLabel ?? null,
      platform:      platform ?? null,
      lastSeenAt:    new Date(),
    })
    .onConflictDoUpdate({
      target: [userPushTokensTable.expoPushToken],
      set:    {
        userId:      req.actorCtx!.actorId,
        companyId:   req.actorCtx!.companyId,
        deviceLabel: deviceLabel ?? null,
        platform:    platform ?? null,
        lastSeenAt:  new Date(),
      },
    })
    .returning();

  res.json({ token });
});

// ── DELETE /notifications/push-tokens/:expoPushToken ──────────────────────────

// notification.manage
router.delete(
  '/notifications/push-tokens/:expoPushToken',
  requirePermission('notification.manage'),
  async (req: Request, res: Response) => {
  
    const expoPushToken = req.params.expoPushToken as string;

    // Delete only if the token belongs to the caller (no IDOR).
    await db
      .delete(userPushTokensTable)
      .where(
        and(
          eq(userPushTokensTable.expoPushToken, expoPushToken),
          eq(userPushTokensTable.userId, req.actorCtx!.actorId),
        ),
      );

    res.status(204).end();
  },
);

// ── POST /notifications/push-receipts ─────────────────────────────────────────
// Check Expo push receipts for a batch of ticket IDs. Deletes dead tokens.
// Also drains any pending receipts queued from recent sends.
// Manager+ only (or called internally by a scheduler).

const CheckPushReceiptsBody = z.object({
  ticketIds: z.array(z.string()).optional().default([]),
});

// notification.push_receipts
router.post('/notifications/push-receipts', requirePermission('notification.push_receipts'), async (req: Request, res: Response) => {

  const parsed = CheckPushReceiptsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  // Drain pending receipt entries queued from recent sends.
  const pending = drainPendingReceiptEntries();

  // Merge caller-supplied ticket IDs (mapped to token IDs by draining pending)
  // with any pending ones from the send queue.
  // For caller-supplied ticket IDs without a token mapping, we pass them raw
  // (receipt check can still detect DeviceNotRegistered via the Expo API).
  const callerEntries = parsed.data.ticketIds.map((id) => ({ ticketId: id, tokenId: id }));
  const allEntries    = [...pending, ...callerEntries];

  const result = await checkPushReceipts(allEntries);
  res.json(result);
});

export default router;

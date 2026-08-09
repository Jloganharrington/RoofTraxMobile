/**
 * Notification dispatch module.
 *
 * Every notification in the system goes through `notify()`. Never send email
 * or push directly from a route handler — that creates two maintenance paths.
 *
 * Design contract:
 *   - Call sites do `void notify(...).catch(() => {})` AFTER res.json().
 *     The route sends its response first; notify() runs in the background.
 *   - notify() catches and logs all internal errors — it never throws.
 *   - The actor is excluded from recipients (no self-notifications).
 *   - Recipients with no SMTP configured are skipped and logged.
 *   - Push channel is reserved here but wired in Step 4.
 */

import nodemailer from 'nodemailer';
import { and, eq, inArray } from 'drizzle-orm';
import {
  db,
  inspectionsTable,
  notificationPreferencesTable,
  pinsTable,
  userProfilesTable,
  userPushTokensTable,
  usersTable,
} from '@workspace/db';
import { findNotificationEntry } from '@workspace/authz';
import { logger } from './logger';
import { decryptSmtpPassword } from './smtpCrypto';
import { resolvePublicSmtpAddress } from './smtpGuard';
import { sendPush } from './push';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NotifyParams {
  /** Catalog key — must match a type in NOTIFICATION_CATALOG. */
  type:          string;
  companyId:     string;
  /** Determines lead_owner / assignee resolution. */
  pinId?:        string;
  inspectionId?: string;
  /** This user is removed from the recipient list (no self-notifications). */
  actorUserId?:  string;
  /** Extra context surfaced in the email body. */
  payload?:      Record<string, unknown>;
}

/**
 * Fire-and-forget dispatch.  Never throws.
 *
 * Usage at call sites (AFTER res.json):
 *   void notify({ ... });
 */
export async function notify(params: NotifyParams): Promise<void> {
  try {
    const { type, companyId, pinId, inspectionId, actorUserId, payload } = params;

    // 1. Look up catalog entry — unknown types are silently ignored.
    const entry = findNotificationEntry(type);
    if (!entry) {
      logger.warn({ type }, 'notify: unknown notification type, skipping');
      return;
    }

    // 2. Resolve recipient user IDs from the catalog's recipientRule.
    const recipientIds = await resolveRecipients({
      recipientRule: entry.recipientRule,
      companyId,
      pinId,
      inspectionId,
    });

    // 3. Remove the actor — no self-notifications.
    const targets = actorUserId
      ? recipientIds.filter((id) => id !== actorUserId)
      : recipientIds;

    if (targets.length === 0) return;

    // 4. Load pin address once for email building.
    const pinAddress = pinId ? await loadPinAddress(pinId) : null;

    // 5. Dispatch to each recipient independently; one failure must not block others.
    await Promise.allSettled(
      targets.map((userId) =>
        dispatchToRecipient({ userId, type, entry, pinAddress, pinId, inspectionId, payload }).catch((err) =>
          logger.warn({ err, userId, type }, 'notify: dispatch error for recipient'),
        ),
      ),
    );
  } catch (err) {
    logger.error({ err, params }, 'notify: unexpected top-level error');
  }
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

async function resolveRecipients({
  recipientRule,
  companyId,
  pinId,
  inspectionId,
}: {
  recipientRule: string;
  companyId:     string;
  pinId?:        string;
  inspectionId?: string;
}): Promise<string[]> {
  const ids = new Set<string>();

  if (recipientRule === 'assignee') {
    // inspections.inspector_user_id  /  pins.appointment_assigned_to
    if (inspectionId) {
      const [insp] = await db
        .select({ inspectorUserId: inspectionsTable.inspectorUserId })
        .from(inspectionsTable)
        .where(eq(inspectionsTable.id, inspectionId));
      if (insp?.inspectorUserId) ids.add(insp.inspectorUserId);
    }
    if (pinId) {
      const [pin] = await db
        .select({ appointmentAssignedTo: pinsTable.appointmentAssignedTo })
        .from(pinsTable)
        .where(eq(pinsTable.id, pinId));
      if (pin?.appointmentAssignedTo) ids.add(pin.appointmentAssignedTo);
    }
  }

  if (recipientRule === 'lead_owner' || recipientRule === 'lead_owner_and_managers') {
    if (pinId) {
      const [pin] = await db
        .select({ userId: pinsTable.userId })
        .from(pinsTable)
        .where(eq(pinsTable.id, pinId));
      if (pin?.userId) ids.add(pin.userId);
    }
  }

  if (recipientRule === 'managers' || recipientRule === 'lead_owner_and_managers') {
    const mgrs = await db
      .select({ userId: userProfilesTable.userId })
      .from(userProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, userProfilesTable.userId))
      .where(
        and(
          eq(usersTable.companyId, companyId),
          inArray(userProfilesTable.role, ['manager', 'admin', 'super_admin']),
        ),
      );
    for (const m of mgrs) ids.add(m.userId);
  }

  return [...ids];
}

async function loadPinAddress(pinId: string): Promise<string | null> {
  const [pin] = await db
    .select({ address: pinsTable.address })
    .from(pinsTable)
    .where(eq(pinsTable.id, pinId));
  return pin?.address ?? null;
}

// ---------------------------------------------------------------------------
// Per-recipient dispatch
// ---------------------------------------------------------------------------

async function dispatchToRecipient({
  userId,
  type,
  entry,
  pinAddress,
  pinId,
  inspectionId,
  payload,
}: {
  userId:        string;
  type:          string;
  entry:         NonNullable<ReturnType<typeof findNotificationEntry>>;
  pinAddress:    string | null;
  pinId?:        string;
  inspectionId?: string;
  payload?:      Record<string, unknown>;
}): Promise<void> {
  // Load stored preference, fall back to catalog defaults.
  const [stored] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(
      and(
        eq(notificationPreferencesTable.userId, userId),
        eq(notificationPreferencesTable.notificationType, type),
      ),
    );

  const emailEnabled = stored !== undefined ? stored.emailEnabled : entry.defaultEmail;
  const frequency    = stored?.frequency ?? 'immediate';

  // v1: daily/weekly stored but not dispatched — treated as immediate.
  const shouldEmail = emailEnabled && frequency !== 'off';

  if (shouldEmail) {
    await sendEmail({ userId, entry, pinAddress, payload });
  }

  // Push channel — all tokens for this user, same recipient/actor rules.
  const pushEnabled = stored !== undefined ? stored.pushEnabled : entry.defaultPush;
  if (pushEnabled) {
    const tokens = await db
      .select({ id: userPushTokensTable.id, expoPushToken: userPushTokensTable.expoPushToken })
      .from(userPushTokensTable)
      .where(eq(userPushTokensTable.userId, userId));

    if (tokens.length > 0) {
      await sendPush(
        tokens.map((t) => ({ tokenId: t.id, token: t.expoPushToken, userId })),
        {
          title: entry.label,
          body:  buildPushBody(entry.label, pinAddress, payload),
          // Structured data for client-side deep linking (5d).
          data: {
            type,
            ...(pinId        ? { pinId }        : {}),
            ...(inspectionId ? { inspectionId } : {}),
          },
        },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Email sending
// ---------------------------------------------------------------------------

async function sendEmail({
  userId,
  entry,
  pinAddress,
  payload,
}: {
  userId:     string;
  entry:      NonNullable<ReturnType<typeof findNotificationEntry>>;
  pinAddress: string | null;
  payload?:   Record<string, unknown>;
}): Promise<void> {
  // Load user's email + SMTP profile.
  const [profile] = await db
    .select({
      email:           usersTable.email,
      smtpHost:        userProfilesTable.smtpHost,
      smtpPort:        userProfilesTable.smtpPort,
      smtpSecure:      userProfilesTable.smtpSecure,
      smtpUsername:    userProfilesTable.smtpUsername,
      smtpPasswordEnc: userProfilesTable.smtpPasswordEnc,
      smtpFromEmail:   userProfilesTable.smtpFromEmail,
    })
    .from(usersTable)
    .innerJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
    .where(eq(usersTable.id, userId));

  if (!profile?.email) {
    logger.debug({ userId }, 'notify: no email address, skipping');
    return;
  }

  if (
    !profile.smtpHost ||
    !profile.smtpPort ||
    !profile.smtpUsername ||
    !profile.smtpPasswordEnc
  ) {
    logger.info({ userId, type: entry.type }, 'notify: no SMTP configured, skipping');
    return;
  }

  const password  = decryptSmtpPassword(profile.smtpPasswordEnc);
  const smtpAddr  = await resolvePublicSmtpAddress(profile.smtpHost);
  const transport = nodemailer.createTransport({
    host:              smtpAddr,
    port:              profile.smtpPort,
    secure:            profile.smtpSecure ?? profile.smtpPort === 465,
    name:              undefined,
    auth:              { user: profile.smtpUsername, pass: password },
    tls:               { servername: profile.smtpHost },
    connectionTimeout: 15_000,
    socketTimeout:     30_000,
  });

  const from     = profile.smtpFromEmail ?? profile.smtpUsername;
  const location = pinAddress ?? 'your lead';
  const subject  = `${entry.label} — ${location}`;
  const text     = buildEmailText(entry.label, location, payload);

  await transport.sendMail({ from, to: profile.email, subject, text });
  logger.info({ userId, type: entry.type }, 'notify: email sent');
}

function buildPushBody(
  label:     string,
  location:  string | null,
  payload?:  Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (location) parts.push(location);
  if (payload?.amountCents) parts.push(`$${(Number(payload.amountCents) / 100).toFixed(2)}`);
  if (payload?.toStatus)    parts.push(String(payload.toStatus));
  if (payload?.customerName) parts.push(String(payload.customerName));
  return parts.length > 0 ? parts.join(' · ') : label;
}

function buildEmailText(
  label:      string,
  location:   string,
  payload?:   Record<string, unknown>,
): string {
  const lines: string[] = [label, '', `Property: ${location}`];

  if (payload) {
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;

      // Format common payload keys into readable labels.
      const formatted = formatPayloadEntry(key, value);
      if (formatted) lines.push(formatted);
    }
  }

  lines.push('', 'Log in to RoofTrax to view the full details.');
  return lines.join('\n');
}

function formatPayloadEntry(key: string, value: unknown): string | null {
  switch (key) {
    case 'amountCents':
      return `Amount: $${((Number(value)) / 100).toFixed(2)}`;
    case 'paymentType':
      return `Type: ${value}`;
    case 'fromStatus':
      return `Previous Status: ${value ?? '(none)'}`;
    case 'toStatus':
      return `New Status: ${value ?? '(cleared)'}`;
    case 'customerName':
      return `Signed by: ${value}`;
    case 'totalCents':
      return `Contract Total: $${((Number(value)) / 100).toFixed(2)}`;
    case 'description':
      return `Description: ${value}`;
    default:
      return null;
  }
}

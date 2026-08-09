/**
 * Push token CRUD + dispatch integration tests.
 *
 * POST  /notifications/push-tokens       register / refresh
 * DELETE /notifications/push-tokens/:t   deregister
 * POST  /notifications/push-receipts     receipt-check endpoint
 *
 * Push send behaviour (mocked expo-server-sdk):
 *   - pushEnabled pref respected
 *   - no token → nothing sent
 *   - DeviceNotRegistered ticket → token deleted
 *   - sendPushNotificationsAsync throws → notify() still resolves
 */

import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  companiesTable,
  db,
  notificationPreferencesTable,
  pinsTable,
  userProfilesTable,
  userPushTokensTable,
  usersTable,
} from '@workspace/db';

// ── Expo mock — must be before importing anything that uses expo-server-sdk ──

const mockSendPushNotificationsAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ status: 'ok', id: 'ticket-abc-123' }]),
);

const mockIsExpoPushToken = vi.hoisted(() =>
  vi.fn((t: string) => t.startsWith('ExponentPushToken[')),
);

vi.mock('expo-server-sdk', () => {
  const MockExpo = vi.fn(() => ({
    chunkPushNotifications:             (msgs: unknown[]) => [msgs],
    sendPushNotificationsAsync:         mockSendPushNotificationsAsync,
    chunkPushNotificationReceiptIds:    (ids: unknown[]) => [ids],
    getPushNotificationReceiptsAsync:   vi.fn().mockResolvedValue({}),
  }));
  (MockExpo as unknown as { isExpoPushToken: typeof mockIsExpoPushToken }).isExpoPushToken = mockIsExpoPushToken;
  return { default: MockExpo };
});

import app from '../../app';
import { createSession } from '../../lib/auth';
import { notify } from '../../lib/notify';

// ── Test data ──────────────────────────────────────────────────────────────────

const RUN_ID    = `push-${Date.now().toString(36)}`;
const COMPANY_ID = `PUSH-TEST-${RUN_ID}`.toUpperCase().slice(0, 40);
const VALID_TOKEN = `ExponentPushToken[push-test-${RUN_ID}]`;
const DEAD_TOKEN  = `ExponentPushToken[dead-${RUN_ID}]`;

interface Ctx {
  repUserId:  string;
  mgrUserId:  string;
  repSid:     string;
  mgrSid:     string;
  pinId:      string;
}
let ctx: Ctx;

beforeAll(async () => {
  await db.insert(companiesTable).values({ id: COMPANY_ID, name: `PushTest ${RUN_ID}` });

  const repEmail = `push-rep-${RUN_ID}@test.invalid`;
  const [rep] = await db.insert(usersTable).values({ companyId: COMPANY_ID, email: repEmail }).returning();
  await db.insert(userProfilesTable).values({ userId: rep.id, role: 'field_rep' });

  const mgrEmail = `push-mgr-${RUN_ID}@test.invalid`;
  const [mgr] = await db.insert(usersTable).values({ companyId: COMPANY_ID, email: mgrEmail }).returning();
  await db.insert(userProfilesTable).values({ userId: mgr.id, role: 'manager' });

  const [pin] = await db
    .insert(pinsTable)
    .values({ companyId: COMPANY_ID, userId: rep.id, address: '99 Push Lane', latitude: 40, longitude: -74, workflow: 'retail' })
    .returning();

  const mkSid = (u: typeof rep) =>
    createSession({
      user: { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, profileImageUrl: u.profileImageUrl, companyId: COMPANY_ID },
      access_token: 'test-token',
    });

  ctx = {
    repUserId: rep.id,
    mgrUserId: mgr.id,
    repSid:    await mkSid(rep),
    mgrSid:    await mkSid(mgr),
    pinId:     pin.id,
  };
});

afterAll(async () => {
  await db.delete(notificationPreferencesTable).where(eq(notificationPreferencesTable.companyId, COMPANY_ID));
  await db.delete(userPushTokensTable).where(eq(userPushTokensTable.companyId, COMPANY_ID));
  await db.delete(pinsTable).where(eq(pinsTable.id, ctx.pinId));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, ctx.repUserId));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, ctx.mgrUserId));
  await db.delete(usersTable).where(eq(usersTable.companyId, COMPANY_ID));
  await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY_ID));
});

beforeEach(async () => {
  mockSendPushNotificationsAsync.mockClear();
  mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'ticket-abc-123' }]);
  mockIsExpoPushToken.mockImplementation((t: string) => t.startsWith('ExponentPushToken['));
  // Clean tokens between tests
  await db.delete(userPushTokensTable).where(eq(userPushTokensTable.companyId, COMPANY_ID));
  // Clean prefs between tests
  await db.delete(notificationPreferencesTable).where(eq(notificationPreferencesTable.companyId, COMPANY_ID));
});

const auth = (sid: string) => ({ Authorization: `Bearer ${sid}` });

// ── Token CRUD ─────────────────────────────────────────────────────────────────

describe('POST /notifications/push-tokens', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/notifications/push-tokens').send({ expoPushToken: VALID_TOKEN });
    expect(res.status).toBe(401);
  });

  it('registers a new token and returns it', async () => {
    const res = await request(app)
      .post('/api/notifications/push-tokens')
      .set(auth(ctx.repSid))
      .send({ expoPushToken: VALID_TOKEN, deviceLabel: 'Test iPhone', platform: 'ios' });

    expect(res.status).toBe(200);
    expect(res.body.token.expoPushToken).toBe(VALID_TOKEN);
    expect(res.body.token.userId).toBe(ctx.repUserId);
    expect(res.body.token.platform).toBe('ios');
  });

  it('refreshes an existing token (upsert updates lastSeenAt)', async () => {
    // First register
    await request(app)
      .post('/api/notifications/push-tokens')
      .set(auth(ctx.repSid))
      .send({ expoPushToken: VALID_TOKEN });

    // Second register — same token should upsert
    const res = await request(app)
      .post('/api/notifications/push-tokens')
      .set(auth(ctx.repSid))
      .send({ expoPushToken: VALID_TOKEN, deviceLabel: 'Updated Label' });

    expect(res.status).toBe(200);
    // Only one row should exist
    const rows = await db.select().from(userPushTokensTable).where(eq(userPushTokensTable.companyId, COMPANY_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deviceLabel).toBe('Updated Label');
  });

  it('rejects a malformed token', async () => {
    const res = await request(app)
      .post('/api/notifications/push-tokens')
      .set(auth(ctx.repSid))
      .send({ expoPushToken: 'not-a-real-expo-token' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /notifications/push-tokens/:token', () => {
  it('deregisters an existing token', async () => {
    // Register first
    await request(app)
      .post('/api/notifications/push-tokens')
      .set(auth(ctx.repSid))
      .send({ expoPushToken: VALID_TOKEN });

    const delRes = await request(app)
      .delete(`/api/notifications/push-tokens/${encodeURIComponent(VALID_TOKEN)}`)
      .set(auth(ctx.repSid));

    expect(delRes.status).toBe(204);
    const rows = await db.select().from(userPushTokensTable).where(eq(userPushTokensTable.companyId, COMPANY_ID));
    expect(rows).toHaveLength(0);
  });

  it('returns 204 idempotently when token does not exist', async () => {
    const res = await request(app)
      .delete(`/api/notifications/push-tokens/${encodeURIComponent(VALID_TOKEN)}`)
      .set(auth(ctx.repSid));
    expect(res.status).toBe(204);
  });

  it('cannot delete another user\'s token (returns 204 without deleting)', async () => {
    // Rep registers token
    await db.insert(userPushTokensTable).values({
      companyId: COMPANY_ID, userId: ctx.repUserId, expoPushToken: VALID_TOKEN,
    });

    // Manager tries to delete rep's token
    const res = await request(app)
      .delete(`/api/notifications/push-tokens/${encodeURIComponent(VALID_TOKEN)}`)
      .set(auth(ctx.mgrSid));

    expect(res.status).toBe(204);
    // Token should still exist
    const rows = await db.select().from(userPushTokensTable).where(eq(userPushTokensTable.expoPushToken, VALID_TOKEN));
    expect(rows).toHaveLength(1);
  });
});

// ── Push dispatch behaviour ───────────────────────────────────────────────────

describe('push dispatch via notify()', () => {
  it('sends to a registered token when push is enabled (catalog default)', async () => {
    // Register a push token for the manager (who would receive payment_recorded if pushEnabled)
    // payment_recorded has defaultPush: false — enable it explicitly
    await db.insert(notificationPreferencesTable).values({
      companyId: COMPANY_ID, userId: ctx.mgrUserId, notificationType: 'payment_recorded',
      emailEnabled: false, pushEnabled: true, frequency: 'immediate',
    });
    await db.insert(userPushTokensTable).values({
      companyId: COMPANY_ID, userId: ctx.mgrUserId, expoPushToken: VALID_TOKEN,
    });

    await notify({ type: 'payment_recorded', companyId: COMPANY_ID, pinId: ctx.pinId, actorUserId: ctx.repUserId });

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledOnce();
    // sendPushNotificationsAsync receives the whole chunk (array of messages)
    const chunk = mockSendPushNotificationsAsync.mock.calls[0]![0] as Array<{ to: string }>;
    expect(chunk[0]!.to).toBe(VALID_TOKEN);
  });

  it('does not send push when push is disabled for that type', async () => {
    await db.insert(notificationPreferencesTable).values({
      companyId: COMPANY_ID, userId: ctx.mgrUserId, notificationType: 'payment_recorded',
      emailEnabled: false, pushEnabled: false, frequency: 'immediate',
    });
    await db.insert(userPushTokensTable).values({
      companyId: COMPANY_ID, userId: ctx.mgrUserId, expoPushToken: VALID_TOKEN,
    });

    await notify({ type: 'payment_recorded', companyId: COMPANY_ID, pinId: ctx.pinId, actorUserId: ctx.repUserId });

    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('does not send when user has no registered token', async () => {
    await db.insert(notificationPreferencesTable).values({
      companyId: COMPANY_ID, userId: ctx.mgrUserId, notificationType: 'payment_recorded',
      emailEnabled: false, pushEnabled: true, frequency: 'immediate',
    });
    // No token inserted

    await notify({ type: 'payment_recorded', companyId: COMPANY_ID, pinId: ctx.pinId, actorUserId: ctx.repUserId });

    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('deletes the token when ticket returns DeviceNotRegistered', async () => {
    await db.insert(notificationPreferencesTable).values({
      companyId: COMPANY_ID, userId: ctx.mgrUserId, notificationType: 'payment_recorded',
      emailEnabled: false, pushEnabled: true, frequency: 'immediate',
    });
    const [tokenRow] = await db.insert(userPushTokensTable).values({
      companyId: COMPANY_ID, userId: ctx.mgrUserId, expoPushToken: DEAD_TOKEN,
    }).returning();

    // Expo returns DeviceNotRegistered for the dead token
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
    ]);

    await notify({ type: 'payment_recorded', companyId: COMPANY_ID, pinId: ctx.pinId, actorUserId: ctx.repUserId });

    // Token should be gone
    const rows = await db.select().from(userPushTokensTable).where(eq(userPushTokensTable.id, tokenRow.id));
    expect(rows).toHaveLength(0);
  });

  it('resolves without throwing when sendPushNotificationsAsync throws', async () => {
    await db.insert(notificationPreferencesTable).values({
      companyId: COMPANY_ID, userId: ctx.mgrUserId, notificationType: 'payment_recorded',
      emailEnabled: false, pushEnabled: true, frequency: 'immediate',
    });
    await db.insert(userPushTokensTable).values({
      companyId: COMPANY_ID, userId: ctx.mgrUserId, expoPushToken: VALID_TOKEN,
    });

    mockSendPushNotificationsAsync.mockRejectedValueOnce(new Error('Expo API unreachable'));

    await expect(
      notify({ type: 'payment_recorded', companyId: COMPANY_ID, pinId: ctx.pinId, actorUserId: ctx.repUserId }),
    ).resolves.toBeUndefined();
  });
});

// ── POST /notifications/push-receipts ─────────────────────────────────────────

describe('POST /notifications/push-receipts', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/notifications/push-receipts').send({ ticketIds: [] });
    expect(res.status).toBe(401);
  });

  it('returns 403 for field_rep', async () => {
    const res = await request(app)
      .post('/api/notifications/push-receipts')
      .set(auth(ctx.repSid))
      .send({ ticketIds: [] });
    expect(res.status).toBe(403);
  });

  it('manager can check receipts — returns checked/deleted counts', async () => {
    const res = await request(app)
      .post('/api/notifications/push-receipts')
      .set(auth(ctx.mgrSid))
      .send({ ticketIds: [] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checked: expect.any(Number), deleted: expect.any(Number) });
  });
});

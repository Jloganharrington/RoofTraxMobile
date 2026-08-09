/**
 * Unit tests for the notify() dispatch module.
 *
 * Vitest mocks nodemailer so no real SMTP connection is made.
 * The DB is real — test data is seeded and cleaned up per-run.
 *
 * Tests:
 *   1. payment_recorded → emails manager, NOT the actor.
 *   2. email disabled for that type → sendMail never called.
 *   3. no SMTP configured → skipped + logged; notify() resolves cleanly.
 *   4. sendMail throws → notify() still resolves (fire-and-forget safety).
 *   5. actorUserId = only manager → nobody emailed (actor excluded).
 *   6. recipientRule=managers → only managers receive, not the lead owner (rep).
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  companiesTable,
  db,
  notificationPreferencesTable,
  pinsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq } from 'drizzle-orm';

// ── Mocks — must be before importing the module under test ───────────────────

const mockSendMail = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: 'test-ok' }));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

vi.mock('../smtpCrypto', () => ({
  decryptSmtpPassword: () => 'test-smtp-password',
}));

vi.mock('../smtpGuard', () => ({
  resolvePublicSmtpAddress: async (host: string) => host,
}));

// Now import the module under test (after mocks are registered).
import { notify } from '../notify';

// ── Test data ─────────────────────────────────────────────────────────────────

const RUN_ID    = `notify-lib-${Date.now().toString(36)}`;
const COMPANY_ID = `NOTIFY-LIB-${RUN_ID}`.toUpperCase().slice(0, 40);

const SMTP_FIELDS = {
  smtpHost:        'smtp.test.invalid',
  smtpPort:        587,
  smtpSecure:      false,
  smtpUsername:    'sender@test.invalid',
  smtpPasswordEnc: 'encrypted-placeholder',
  smtpFromEmail:   'sender@test.invalid',
};

interface TestContext {
  repUserId:         string;
  mgrUserId:         string;
  mgrNoSmtpUserId:   string;
  pinId:             string;
  repEmail:          string;
  mgrEmail:          string;
}

let ctx: TestContext;

beforeAll(async () => {
  await db.insert(companiesTable).values({ id: COMPANY_ID, name: `NotifyLib ${RUN_ID}` });

  // Rep (lead owner — actor for most tests)
  const repEmail = `rep-${RUN_ID}@test.invalid`;
  const [rep] = await db
    .insert(usersTable)
    .values({ companyId: COMPANY_ID, email: repEmail })
    .returning();
  await db.insert(userProfilesTable).values({
    userId: rep.id,
    role:   'field_rep',
    ...SMTP_FIELDS,
    smtpFromEmail: repEmail,
  });

  // Manager with SMTP
  const mgrEmail = `mgr-${RUN_ID}@test.invalid`;
  const [mgr] = await db
    .insert(usersTable)
    .values({ companyId: COMPANY_ID, email: mgrEmail })
    .returning();
  await db.insert(userProfilesTable).values({
    userId: mgr.id,
    role:   'manager',
    ...SMTP_FIELDS,
    smtpFromEmail: mgrEmail,
    smtpUsername:  mgrEmail,
  });

  // Manager without SMTP (to test the "no SMTP" skip)
  const mgrNoSmtpEmail = `mgr-nosmtp-${RUN_ID}@test.invalid`;
  const [mgrNoSmtp] = await db
    .insert(usersTable)
    .values({ companyId: COMPANY_ID, email: mgrNoSmtpEmail })
    .returning();
  await db.insert(userProfilesTable).values({
    userId: mgrNoSmtp.id,
    role:   'manager',
    // no SMTP fields
  });

  // Pin owned by the rep
  const [pin] = await db
    .insert(pinsTable)
    .values({
      companyId: COMPANY_ID,
      userId:    rep.id,
      address:   '123 Notify Test Lane',
      latitude:  40.0,
      longitude: -74.0,
      workflow:  'retail',
    })
    .returning();

  ctx = {
    repUserId:       rep.id,
    mgrUserId:       mgr.id,
    mgrNoSmtpUserId: mgrNoSmtp.id,
    pinId:           pin.id,
    repEmail,
    mgrEmail,
  };
});

afterAll(async () => {
  await db.delete(notificationPreferencesTable).where(
    eq(notificationPreferencesTable.companyId, COMPANY_ID),
  );
  await db.delete(pinsTable).where(eq(pinsTable.id, ctx.pinId));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, ctx.repUserId));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, ctx.mgrUserId));
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, ctx.mgrNoSmtpUserId));
  await db.delete(usersTable).where(eq(usersTable.companyId, COMPANY_ID));
  await db.delete(companiesTable).where(eq(companiesTable.id, COMPANY_ID));
});

beforeEach(() => {
  mockSendMail.mockClear();
  mockSendMail.mockResolvedValue({ messageId: 'test-ok' });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('notify() — payment_recorded (recipientRule: managers)', () => {
  it('emails the manager, not the actor', async () => {
    await notify({
      type:         'payment_recorded',
      companyId:    COMPANY_ID,
      pinId:        ctx.pinId,
      actorUserId:  ctx.repUserId,          // rep records the payment
      payload:      { amountCents: 50000, paymentType: 'insurance_proceeds' },
    });

    // sendMail called at least once
    expect(mockSendMail).toHaveBeenCalled();

    const calls = mockSendMail.mock.calls.map((c) => c[0] as { to: string });

    // Manager's email in at least one call
    expect(calls.some((c) => c.to === ctx.mgrEmail)).toBe(true);
    // Rep (actor) NOT emailed
    expect(calls.some((c) => c.to === ctx.repEmail)).toBe(false);
  });

  it('skips the manager who has no SMTP configured (logs only)', async () => {
    // The no-SMTP manager should be resolved as a recipient but not emailed.
    // We confirm notify() still resolves and only the SMTP-configured manager
    // gets a sendMail call.
    await notify({
      type:        'payment_recorded',
      companyId:   COMPANY_ID,
      pinId:       ctx.pinId,
      actorUserId: ctx.repUserId,
    });

    // Only the SMTP-configured manager should have received mail.
    const tos = mockSendMail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(tos).toContain(ctx.mgrEmail);
    // No spurious sends (e.g. to the no-SMTP manager whose email is different)
    expect(tos.every((to) => to === ctx.mgrEmail)).toBe(true);
  });

  it('respects email-disabled preference — no sendMail call', async () => {
    // Disable email for manager
    await db
      .insert(notificationPreferencesTable)
      .values({
        companyId:        COMPANY_ID,
        userId:           ctx.mgrUserId,
        notificationType: 'payment_recorded',
        emailEnabled:     false,
        pushEnabled:      true,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferencesTable.userId,
          notificationPreferencesTable.notificationType,
        ],
        set: { emailEnabled: false },
      });

    await notify({
      type:        'payment_recorded',
      companyId:   COMPANY_ID,
      pinId:       ctx.pinId,
      actorUserId: ctx.repUserId,
    });

    expect(mockSendMail).not.toHaveBeenCalled();

    // Restore
    await db.delete(notificationPreferencesTable).where(
      eq(notificationPreferencesTable.userId, ctx.mgrUserId),
    );
  });

  it('resolves without throwing when sendMail throws (business action safe)', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));

    await expect(
      notify({
        type:        'payment_recorded',
        companyId:   COMPANY_ID,
        pinId:       ctx.pinId,
        actorUserId: ctx.repUserId,
      }),
    ).resolves.toBeUndefined();
  });

  it('emails nobody when the only manager is the actor', async () => {
    await notify({
      type:        'payment_recorded',
      companyId:   COMPANY_ID,
      pinId:       ctx.pinId,
      actorUserId: ctx.mgrUserId,   // manager is both recipient and actor
    });

    // Manager is excluded (they're the actor); no-SMTP manager gets nothing;
    // rep is not in 'managers' rule.
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('notify() — unknown type', () => {
  it('resolves cleanly without emailing', async () => {
    await expect(
      notify({ type: 'no_such_type', companyId: COMPANY_ID }),
    ).resolves.toBeUndefined();

    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('notify() — claim_status_changed (recipientRule: lead_owner_and_managers)', () => {
  it('emails both lead owner and managers (rep is lead owner, not actor here)', async () => {
    // actor = manager; recipients = lead_owner (rep) + managers
    // rep is NOT the actor here so rep should be emailed
    // manager IS the actor so manager should NOT be emailed
    await notify({
      type:        'claim_status_changed',
      companyId:   COMPANY_ID,
      pinId:       ctx.pinId,
      actorUserId: ctx.mgrUserId,    // manager records the status change
      payload:     { fromStatus: 'filed', toStatus: 'adjuster_meeting_scheduled' },
    });

    const tos = mockSendMail.mock.calls.map((c) => (c[0] as { to: string }).to);

    // Rep (lead owner) should be emailed
    expect(tos).toContain(ctx.repEmail);
    // Manager (actor) should NOT be emailed
    expect(tos).not.toContain(ctx.mgrEmail);
  });
});

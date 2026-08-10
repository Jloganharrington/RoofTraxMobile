/**
 * Unit tests for upsertUserOnLogin (lib/onboarding.ts)
 *
 * These exercise the OIDC callback path that all prior tests bypassed with
 * direct DB-insert sessions. They answer three questions:
 *
 *  Q1. First login for a company's first user (founder):
 *      → user created, companyId set, 'admin' profile seeded, founderUserId set.
 *
 *  Q2. Second user joins same company (non-founder):
 *      → user created, companyId set, NO profile row created (role is null).
 *
 *  Q3. Existing user logs in again:
 *      → email updated, firstName/lastName/profileImageUrl preserved if already
 *        set by the user (fill-only-when-null); companyId unchanged.
 *
 * What upsertUserOnLogin does NOT set: department, workflowAssignment.
 * Those are set exclusively by team management routes (PATCH /team/users/:userId).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  companiesTable,
  db,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { eq } from 'drizzle-orm';
import { upsertUserOnLogin } from '../../lib/onboarding';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN   = Math.random().toString(36).slice(2, 8).toUpperCase();
const CO_ID = `OBT-${RUN}`;

beforeAll(async () => {
  await db.insert(companiesTable).values({ id: CO_ID, name: `Onboarding Test ${RUN}` });
});

afterAll(async () => {
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, `sub-founder-${RUN}`)).catch(() => {});
  await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, `sub-second-${RUN}`)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, `sub-founder-${RUN}`)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, `sub-second-${RUN}`)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, CO_ID)).catch(() => {});
});

// ---------------------------------------------------------------------------
// Q1 — Founder (first user for a company)
// ---------------------------------------------------------------------------

describe('upsertUserOnLogin — Q1 founder (first user)', () => {
  const FOUNDER_SUB = `sub-founder-${RUN}`;

  it('creates user row with the correct companyId', async () => {
    const user = await upsertUserOnLogin(
      {
        sub:              FOUNDER_SUB,
        email:            `founder-${RUN}@t.invalid`,
        first_name:       'Alice',
        last_name:        'Founder',
        profile_image_url: null,
      },
      CO_ID,
    );

    expect(user.id).toBe(FOUNDER_SUB);
    expect(user.companyId).toBe(CO_ID);
    expect(user.email).toBe(`founder-${RUN}@t.invalid`);
    expect(user.firstName).toBe('Alice');
    expect(user.lastName).toBe('Founder');
  });

  it('seeds an admin profile row for the founder', async () => {
    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, FOUNDER_SUB));

    expect(profile).toBeDefined();
    expect(profile!.role).toBe('admin');
    // department and workflowAssignment are NOT set by login — only by team management.
    // They default to whatever the column default is (typically 'canvasser').
  });

  it('sets founderUserId on the company', async () => {
    const [company] = await db
      .select({ founderUserId: companiesTable.founderUserId })
      .from(companiesTable)
      .where(eq(companiesTable.id, CO_ID));

    expect(company!.founderUserId).toBe(FOUNDER_SUB);
  });
});

// ---------------------------------------------------------------------------
// Q2 — Non-founder (second user joins same company)
// ---------------------------------------------------------------------------

describe('upsertUserOnLogin — Q2 non-founder', () => {
  const SECOND_SUB = `sub-second-${RUN}`;

  it('creates user row but does NOT create a profile row', async () => {
    const user = await upsertUserOnLogin(
      {
        sub:   SECOND_SUB,
        email: `second-${RUN}@t.invalid`,
      },
      CO_ID,
    );

    expect(user.id).toBe(SECOND_SUB);
    expect(user.companyId).toBe(CO_ID);

    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, SECOND_SUB));

    // No profile row — role, department, workflow are all unset until a manager
    // edits them via PATCH /team/users/:userId.
    expect(profile).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Q3 — Re-login (existing user)
// ---------------------------------------------------------------------------

describe('upsertUserOnLogin — Q3 re-login (existing user)', () => {
  const FOUNDER_SUB = `sub-founder-${RUN}`;

  it('updates email to match identity provider', async () => {
    const user = await upsertUserOnLogin(
      {
        sub:   FOUNDER_SUB,
        email: `founder-new-email-${RUN}@t.invalid`, // email changed at IdP
        first_name: 'Alice',
        last_name:  'Founder',
      },
      // companyId is ignored on re-login
      'SOME-OTHER-COMPANY',
    );

    expect(user.email).toBe(`founder-new-email-${RUN}@t.invalid`);
    // companyId must NOT change even though a different one was passed.
    expect(user.companyId).toBe(CO_ID);
  });

  it('preserves firstName/lastName if user has already edited them', async () => {
    // Simulate user editing their own name via PATCH /profile/me.
    await db
      .update(usersTable)
      .set({ firstName: 'Alice-Edited', lastName: 'Founder-Edited' })
      .where(eq(usersTable.id, FOUNDER_SUB));

    // Login with different name claims from IdP.
    const user = await upsertUserOnLogin(
      {
        sub:        FOUNDER_SUB,
        email:      `founder-new-email-${RUN}@t.invalid`,
        first_name: 'Alice-From-IdP',   // IdP has different name
        last_name:  'Founder-From-IdP',
      },
    );

    // fill-only-when-null: existing non-null values are preserved.
    expect(user.firstName).toBe('Alice-Edited');
    expect(user.lastName).toBe('Founder-Edited');
  });

  it('fills firstName from IdP when user has NOT set their own name', async () => {
    // Clear name (simulate a user who has never edited their profile).
    await db
      .update(usersTable)
      .set({ firstName: null, lastName: null })
      .where(eq(usersTable.id, FOUNDER_SUB));

    const user = await upsertUserOnLogin(
      {
        sub:        FOUNDER_SUB,
        email:      `founder-new-email-${RUN}@t.invalid`,
        first_name: 'Alice-From-IdP',
        last_name:  'Founder-From-IdP',
      },
    );

    // When null, the IdP value fills in.
    expect(user.firstName).toBe('Alice-From-IdP');
    expect(user.lastName).toBe('Founder-From-IdP');
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('upsertUserOnLogin — error paths', () => {
  it('throws MissingCompanyError when no companyId and user does not exist', async () => {
    await expect(
      upsertUserOnLogin({ sub: `sub-no-company-${RUN}`, email: 'no-co@t.invalid' }),
    ).rejects.toThrow('companyId is required');
  });

  it('throws CompanyNotFoundError for a non-existent company', async () => {
    await expect(
      upsertUserOnLogin(
        { sub: `sub-bad-co-${RUN}`, email: 'bad-co@t.invalid' },
        'DOES-NOT-EXIST',
      ),
    ).rejects.toThrow('DOES-NOT-EXIST');
  });
});

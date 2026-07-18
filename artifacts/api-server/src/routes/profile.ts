import {
  GetMyProfileResponse,
  UpdateProfileSignatureBody,
  UpdateProfileSmtpBody,
} from '@workspace/api-zod';

import { encryptSmtpPassword } from '../lib/smtpCrypto';
import { db, userProfilesTable, usersTable, companiesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

const router: IRouter = Router();

// Serializes a profile row + its company into the API `Profile` shape. Kept in
// one place so the GET and the signature PATCH always return an identical
// envelope (both must include the signature-on-file fields — M-F / F0).
function toProfileEnvelope(
  profile: typeof userProfilesTable.$inferSelect,
  company: { companyId: string; companyName: string; betaBugReporting: boolean },
) {
  return GetMyProfileResponse.parse({
    profile: {
      userId: profile.userId,
      role: profile.role,
      workflowAssignment: profile.workflowAssignment,
      department: profile.department,
      companyId: company.companyId,
      companyName: company.companyName,
      signatureUrl: profile.signatureUrl ?? null,
      signatureSha256: profile.signatureSha256 ?? null,
      signatureSignedAt: profile.signatureSignedAt
        ? profile.signatureSignedAt.toISOString()
        : null,
      // SMTP: expose everything EXCEPT the password (write-only secret).
      smtpConfigured: Boolean(
        profile.smtpHost && profile.smtpPort && profile.smtpUsername && profile.smtpPasswordEnc,
      ),
      smtpHost: profile.smtpHost ?? null,
      smtpPort: profile.smtpPort ?? null,
      smtpSecure: profile.smtpSecure ?? null,
      smtpUsername: profile.smtpUsername ?? null,
      smtpFromEmail: profile.smtpFromEmail ?? null,
      // Beta instrument gate — company-level flag, surfaced here so the
      // mobile client can show/hide the bug-report button without another
      // request.
      betaBugReporting: company.betaBugReporting,
    },
  });
}

async function loadCompany(userId: string) {
  const [row] = await db
    .select({
      companyId: usersTable.companyId,
      companyName: companiesTable.name,
      betaBugReporting: companiesTable.betaBugReporting,
    })
    .from(usersTable)
    .innerJoin(companiesTable, eq(companiesTable.id, usersTable.companyId))
    .where(eq(usersTable.id, userId));
  return row;
}

async function loadOrCreateProfile(userId: string) {
  let [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  if (!profile) {
    [profile] = await db
      .insert(userProfilesTable)
      .values({ userId })
      .onConflictDoNothing()
      .returning();

    if (!profile) {
      [profile] = await db
        .select()
        .from(userProfilesTable)
        .where(eq(userProfilesTable.userId, userId));
    }
  }

  return profile;
}

router.get('/profile/me', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const userId = req.user.id;
  const profile = await loadOrCreateProfile(userId);
  const company = await loadCompany(userId);

  res.json(toProfileEnvelope(profile, company));
});

// M-F (F0) — Record the inspector's signature-on-file. The client uploads the
// signature image via the existing presigned-upload flow (which already records
// tenant-scoped object ownership, so read access is company-isolated), then
// sends the servable URL plus a SHA-256 of the exact bytes. We stamp signedAt
// server-side so it can't be back-dated by the client. This is a per-user
// write; there is no C0 inspection gate here — any authenticated user may set
// their own signature.
router.patch('/profile/signature', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = UpdateProfileSignatureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid signature payload' });
    return;
  }

  const userId = req.user.id;
  // Ensure the profile row exists (first-access users may not have one yet).
  await loadOrCreateProfile(userId);

  const [updated] = await db
    .update(userProfilesTable)
    .set({
      signatureUrl: parsed.data.signatureUrl,
      signatureSha256: parsed.data.signatureSha256,
      signatureSignedAt: new Date(),
    })
    .where(eq(userProfilesTable.userId, userId))
    .returning();

  const company = await loadCompany(userId);
  res.json(toProfileEnvelope(updated, company));
});

// Sets or clears the current user's outbound SMTP configuration, used by the
// server to email inspection reports on the rep's behalf. The password is
// encrypted at rest and never echoed back. Per-user write; no module gate.
router.patch('/profile/smtp', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = UpdateProfileSmtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid SMTP payload' });
    return;
  }

  const userId = req.user.id;
  await loadOrCreateProfile(userId);

  const data = parsed.data;
  let update: Partial<typeof userProfilesTable.$inferInsert>;
  if (data.clear) {
    update = {
      smtpHost: null,
      smtpPort: null,
      smtpSecure: null,
      smtpUsername: null,
      smtpPasswordEnc: null,
      smtpFromEmail: null,
    };
  } else {
    if (!data.host || !data.port || !data.username || !data.password) {
      res.status(400).json({
        error: 'host, port, username, and password are required to configure SMTP',
      });
      return;
    }
    update = {
      smtpHost: data.host,
      smtpPort: data.port,
      smtpSecure: data.secure ?? data.port === 465,
      smtpUsername: data.username,
      smtpPasswordEnc: encryptSmtpPassword(data.password),
      smtpFromEmail: data.fromEmail ?? null,
    };
  }

  const [updated] = await db
    .update(userProfilesTable)
    .set(update)
    .where(eq(userProfilesTable.userId, userId))
    .returning();

  const company = await loadCompany(userId);
  res.json(toProfileEnvelope(updated, company));
});

export default router;

import { GetMyProfileResponse, UpdateProfileSignatureBody } from '@workspace/api-zod';
import { db, userProfilesTable, usersTable, companiesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

const router: IRouter = Router();

// Serializes a profile row + its company into the API `Profile` shape. Kept in
// one place so the GET and the signature PATCH always return an identical
// envelope (both must include the signature-on-file fields — M-F / F0).
function toProfileEnvelope(
  profile: typeof userProfilesTable.$inferSelect,
  company: { companyId: string; companyName: string },
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
    },
  });
}

async function loadCompany(userId: string) {
  const [row] = await db
    .select({
      companyId: usersTable.companyId,
      companyName: companiesTable.name,
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

export default router;

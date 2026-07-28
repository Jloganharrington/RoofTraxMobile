import {
  GetMyProfileResponse,
  UpdateProfileCredentialsBody,
  UpdateProfileSignatureBody,
  UpdateProfileSmtpBody,
} from '@workspace/api-zod';

import { encryptSmtpPassword, decryptSmtpPassword } from '../lib/smtpCrypto';
import { resolvePublicSmtpAddress } from '../lib/smtpGuard';
import nodemailer from 'nodemailer';
import { db, userProfilesTable, usersTable, companiesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

const router: IRouter = Router();

// --- Rate limit for SMTP test emails: 5 / user / 10 minutes (in-memory
// sliding window; same approach as bug reports — fine for a single instance).
const smtpTestByUser = new Map<string, number[]>();
const SMTP_TEST_LIMIT = 5;
const SMTP_TEST_WINDOW_MS = 10 * 60 * 1000;

function checkSmtpTestRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = (smtpTestByUser.get(userId) ?? []).filter(
    (t) => now - t < SMTP_TEST_WINDOW_MS,
  );
  if (timestamps.length >= SMTP_TEST_LIMIT) {
    smtpTestByUser.set(userId, timestamps);
    return false;
  }
  timestamps.push(now);
  smtpTestByUser.set(userId, timestamps);
  return true;
}

// Serializes a profile row + its company into the API `Profile` shape. Kept in
// one place so the GET and the signature PATCH always return an identical
// envelope (both must include the signature-on-file fields — M-F / F0).
function toProfileEnvelope(
  profile: typeof userProfilesTable.$inferSelect,
  company: {
    companyId: string;
    companyName: string;
    companyLogoUrl?: string | null;
    betaBugReporting: boolean;
    contractorLegalName?: string | null;
    contractorAddress?: string | null;
    fipsaFeeCents?: number | null;
  },
) {
  return GetMyProfileResponse.parse({
    profile: {
      userId: profile.userId,
      role: profile.role,
      workflowAssignment: profile.workflowAssignment,
      department: profile.department,
      companyId: company.companyId,
      companyName: company.companyName,
      companyLogoUrl: company.companyLogoUrl ?? null,
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
      certifications: profile.certifications ?? null,
      yearsExperience: profile.yearsExperience ?? null,
      // FIPSA agreement settings — company-level, needed by the agreement
      // screen when rendering the FIPSA template.
      contractorLegalName: company.contractorLegalName ?? null,
      contractorAddress: company.contractorAddress ?? null,
      fipsaFeeCents: company.fipsaFeeCents ?? null,
    },
  });
}

async function loadCompany(userId: string) {
  const [row] = await db
    .select({
      companyId: usersTable.companyId,
      companyName: companiesTable.name,
      companyLogoUrl: companiesTable.logoUrl,
      betaBugReporting: companiesTable.betaBugReporting,
      contractorLegalName: companiesTable.contractorLegalName,
      contractorAddress: companiesTable.contractorAddress,
      fipsaFeeCents: companiesTable.fipsaFeeCents,
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

// REPORT_DATA v2 — the individual credential layer (certifications + years
// of experience). Feeds assessorCredentials on repairability assessments and
// rides along with every submission payload. Per-user write; no module gate.
router.patch('/profile/credentials', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = UpdateProfileCredentialsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid credentials payload' });
    return;
  }

  const userId = req.user.id;
  await loadOrCreateProfile(userId);

  const [updated] = await db
    .update(userProfilesTable)
    .set({
      ...(parsed.data.certifications !== undefined && {
        certifications: parsed.data.certifications,
      }),
      ...(parsed.data.yearsExperience !== undefined && {
        yearsExperience: parsed.data.yearsExperience,
      }),
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

// Sends a short test email through the user's stored SMTP settings, to their
// own account email, so they can verify the configuration works before relying
// on it for real report delivery. Mirrors the delivery path used by
// email-report (decrypt password, SSRF-guarded host resolution, TLS servername
// pinned to the original hostname).
router.post('/profile/smtp/test', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const userId = req.user.id;
  if (!checkSmtpTestRateLimit(userId)) {
    res.status(429).json({ error: 'Too many test emails — wait a few minutes and try again' });
    return;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  if (
    !profile?.smtpHost ||
    !profile.smtpPort ||
    !profile.smtpUsername ||
    !profile.smtpPasswordEnc
  ) {
    res.status(400).json({ error: 'SMTP is not configured on your profile' });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const recipient = user?.email;
  if (!recipient) {
    res.status(400).json({ error: 'Your account has no email address to send the test to' });
    return;
  }

  let password: string;
  try {
    password = decryptSmtpPassword(profile.smtpPasswordEnc);
  } catch {
    res.status(400).json({ error: 'Stored SMTP password could not be read; please re-enter it' });
    return;
  }

  let smtpAddress: string;
  try {
    smtpAddress = await resolvePublicSmtpAddress(profile.smtpHost);
  } catch {
    res.status(400).json({ error: 'SMTP host is not a valid public mail server' });
    return;
  }

  const transport = nodemailer.createTransport({
    host: smtpAddress,
    port: profile.smtpPort,
    secure: profile.smtpSecure ?? profile.smtpPort === 465,
    name: undefined,
    auth: { user: profile.smtpUsername, pass: password },
    tls: { servername: profile.smtpHost },
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });

  try {
    await transport.sendMail({
      from: profile.smtpFromEmail || profile.smtpUsername,
      to: recipient,
      subject: 'RoofTrax test email',
      text: 'Your email settings are working. Reports sent from RoofTrax will be delivered like this message.',
    });
  } catch (err) {
    req.log.warn({ err }, 'SMTP test email failed');
    res.status(502).json({
      error:
        'Test email could not be sent. Check your SMTP settings (host, port, username, password) and try again.',
    });
    return;
  }

  res.json({ sent: true });
});

export default router;

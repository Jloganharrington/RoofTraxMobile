/**
 * Trial Proof Package — public + trial-session routes (spec §§1,4,5).
 *
 * Public:
 *   GET  /trial/config                      — pricing, cap state, waitlist mode
 *   GET  /trial/coverage?state=&county=     — AHJ coverage lookup
 *   POST /trial/accounts                    — account creation (business email only)
 *   POST /trial/login                       — re-issue session via email link (magic link)
 *   GET  /trial/verify?token=               — email verification
 *   POST /trial/waitlist                    — out-of-coverage / capacity capture
 *
 * Trial-session (Bearer token from trial_sessions):
 *   GET    /trial/me
 *   POST   /trial/submissions               — create draft (cap + weekly-cap checked)
 *   GET    /trial/submissions/:id
 *   PATCH  /trial/submissions/:id           — autosave draft
 *   POST   /trial/submissions/:id/uploads/request-url
 *   POST   /trial/submissions/:id/uploads   — record completed upload
 *   DELETE /trial/uploads/:id
 *   POST   /trial/submissions/:id/checkout  — validate + Stripe checkout (stubbed)
 *   POST   /trial/submissions/:id/simulate-payment — dev only (TRIAL_DEV_FAKE_PAYMENTS=1)
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import {
  db,
  ahjCoverage,
  trialAccounts,
  trialCreditLedger,
  trialSubmissions,
  trialUploads,
  waitlistEntries,
  TRIAL_CLAIM_BANDS,
  TRIAL_COMPANY_SIZE_BANDS,
  TRIAL_PERIL_TYPES,
} from '@workspace/db';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { ObjectStorageService } from '../lib/objectStorage';
import { addBusinessDays } from '../lib/trial/businessDays';
import { isFreeEmailDomain, trialConfig } from '../lib/trial/config';
import { sendTrialEmail, trialEmails } from '../lib/trial/mailer';
import { createCheckout, PaymentsNotConfigured, verifyPaidCheckoutSession } from '../lib/trial/payments';
import { createTrialSession, requireTrialAuth } from '../lib/trial/session';

const router: IRouter = Router();
const storage = new ObjectStorageService();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function coverageFor(state: string, county: string) {
  const [row] = await db
    .select()
    .from(ahjCoverage)
    .where(and(
      eq(ahjCoverage.state, state.toUpperCase()),
      sql`lower(${ahjCoverage.county}) = ${county.toLowerCase().trim()}`,
    ));
  return row ?? null;
}

/** Paid-or-later submissions started this week (Mon 00:00 UTC). */
async function weeklyIntakeCount(): Promise<number> {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (monday.getUTCDay() + 6) % 7; // Mon=0
  monday.setUTCDate(monday.getUTCDate() - dow);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trialSubmissions)
    .where(and(
      ne(trialSubmissions.status, 'draft'),
      gte(trialSubmissions.submittedAt, monday),
    ));
  return row?.count ?? 0;
}

async function atWeeklyCapacity(): Promise<boolean> {
  return (await weeklyIntakeCount()) >= trialConfig.weeklyIntakeCap;
}

function publicAccount(a: typeof trialAccounts.$inferSelect) {
  return {
    id: a.id,
    companyName: a.companyName,
    contactName: a.contactName,
    email: a.email,
    emailVerified: Boolean(a.emailVerifiedAt),
    licenseNumber: a.licenseNumber,
    licenseState: a.licenseState,
    packagesPurchased: a.packagesPurchased,
    creditBalanceCents: a.creditBalanceCents,
    creditExpiresAt: a.creditExpiresAt,
    maxPackages: trialConfig.maxPackages,
  };
}

function publicSubmission(s: typeof trialSubmissions.$inferSelect) {
  const { adminNotes: _n, ...rest } = s;
  return rest;
}

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------

router.get('/trial/config', async (_req: Request, res: Response) => {
  const waitlistMode = await atWeeklyCapacity();
  res.json({
    priceFirstCents: trialConfig.priceFirstCents,
    priceSubsequentCents: trialConfig.priceSubsequentCents,
    maxPackages: trialConfig.maxPackages,
    creditWindowDays: trialConfig.creditWindowDays,
    turnaroundBusinessDays: trialConfig.turnaroundBusinessDays,
    waitlistMode,
  });
});

router.get('/trial/coverage', async (req: Request, res: Response) => {
  const state = String(req.query.state ?? '').toUpperCase();
  const county = String(req.query.county ?? '');
  if (state.length !== 2 || !county.trim()) {
    res.status(400).json({ error: 'state (2-letter) and county are required' });
    return;
  }
  const row = await coverageFor(state, county);
  res.json({ state, county: county.trim(), status: row?.status ?? 'none' });
});

const CreateAccountBody = z.object({
  companyName: z.string().min(1).max(255),
  contactName: z.string().min(1).max(255),
  email: z.string().email().max(255),
  phone: z.string().min(7).max(50),
  licenseNumber: z.string().min(1).max(100),
  licenseState: z.string().length(2),
  companySizeBand: z.enum(TRIAL_COMPANY_SIZE_BANDS),
  monthlyClaimBand: z.enum(TRIAL_CLAIM_BANDS),
  currentCrm: z.string().max(255).optional(),
});

router.post('/trial/accounts', async (req: Request, res: Response) => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid fields', detail: parsed.error.flatten().fieldErrors });
    return;
  }
  const body = parsed.data;
  if (isFreeEmailDomain(body.email)) {
    res.status(422).json({ error: 'Please use your company email address.' });
    return;
  }
  const email = body.email.toLowerCase().trim();
  const [existing] = await db.select().from(trialAccounts).where(eq(trialAccounts.email, email));
  if (existing) {
    // Existing account: send a fresh sign-in link instead of erroring hard.
    const token = randomBytes(24).toString('hex');
    await db.update(trialAccounts).set({ verifyToken: token }).where(eq(trialAccounts.id, existing.id));
    const link = buildVerifyLink(req, token);
    const tmpl = trialEmails.verify(link);
    void sendTrialEmail(email, tmpl.subject, tmpl.text).catch(() => {});
    res.status(409).json({ error: 'An account with this email already exists. We emailed you a sign-in link.' });
    return;
  }
  const verifyToken = randomBytes(24).toString('hex');
  const [account] = await db.insert(trialAccounts).values({
    companyName: body.companyName,
    contactName: body.contactName,
    email,
    phone: body.phone,
    licenseNumber: body.licenseNumber,
    licenseState: body.licenseState.toUpperCase(),
    companySizeBand: body.companySizeBand,
    monthlyClaimBand: body.monthlyClaimBand,
    currentCrm: body.currentCrm ?? null,
    verifyToken,
  }).returning();

  const sessionToken = await createTrialSession(account.id);
  const link = buildVerifyLink(req, verifyToken);
  const tmpl = trialEmails.verify(link);
  void sendTrialEmail(email, tmpl.subject, tmpl.text).catch(() => {});

  res.status(201).json({ token: sessionToken, account: publicAccount(account) });
});

function buildVerifyLink(req: Request, token: string): string {
  const host = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `${req.protocol}://${req.get('host')}`;
  return `${host}/api/trial/verify?token=${token}`;
}

router.get('/trial/verify', async (req: Request, res: Response) => {
  const token = String(req.query.token ?? '');
  if (!token) {
    res.status(400).send('Missing token');
    return;
  }
  const [account] = await db.select().from(trialAccounts).where(eq(trialAccounts.verifyToken, token));
  if (!account) {
    res.status(404).send('This verification link is no longer valid.');
    return;
  }
  await db.update(trialAccounts).set({
    emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
    verifyToken: null,
  }).where(eq(trialAccounts.id, account.id));
  const sessionToken = await createTrialSession(account.id);
  // Land on the wizard with the session token in the fragment (not query —
  // fragments don't hit server logs).
  res.redirect(`/axiomrestore-web/proof-package/submit#trial_token=${sessionToken}`);
});

// Public deliverable download. The email link points here; it stays valid for
// the 30-day retention window and mints a fresh short-lived signed URL per
// click (GCS signing caps at 7 days, so a long-lived signed URL can't work).
router.get('/trial/deliverable/:token', async (req: Request, res: Response) => {
  const token = req.params.token as string;
  if (!token || token.length < 32) {
    res.status(400).send('Invalid link');
    return;
  }
  const [sub] = await db.select().from(trialSubmissions)
    .where(eq(trialSubmissions.deliverableToken, token));
  if (!sub || !sub.deliverableFileKey || sub.purgedAt) {
    res.status(404).send('This download link is no longer available.');
    return;
  }
  const deliveredAt = sub.deliveredAt ?? sub.updatedAt;
  const windowMs = trialConfig.purgeAfterDays * 86_400_000;
  if (Date.now() - deliveredAt.getTime() > windowMs) {
    res.status(410).send('This download link has expired.');
    return;
  }
  const url = await storage.getSignedDownloadUrl(sub.deliverableFileKey, 15 * 60);
  res.redirect(url);
});

const WaitlistBody = z.object({
  companyName: z.string().min(1).max(255),
  email: z.string().email().max(255),
  phone: z.string().min(7).max(50),
  licenseNumber: z.string().max(100).optional(),
  state: z.string().length(2),
  county: z.string().max(255).optional(),
  reason: z.enum(['coverage', 'capacity']).optional(),
});

router.post('/trial/waitlist', async (req: Request, res: Response) => {
  const parsed = WaitlistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid fields' });
    return;
  }
  const b = parsed.data;
  await db.insert(waitlistEntries).values({
    companyName: b.companyName,
    email: b.email.toLowerCase().trim(),
    phone: b.phone,
    licenseNumber: b.licenseNumber ?? '',
    state: b.state.toUpperCase(),
    county: b.county ?? '',
    reason: b.reason ?? 'coverage',
  });
  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------------
// Trial-session routes
// ---------------------------------------------------------------------------

router.get('/trial/me', requireTrialAuth, async (req: Request, res: Response) => {
  const account = req.trialAccount!;
  const subs = await db
    .select()
    .from(trialSubmissions)
    .where(eq(trialSubmissions.accountId, account.id))
    .orderBy(desc(trialSubmissions.createdAt));
  res.json({ account: publicAccount(account), submissions: subs.map(publicSubmission) });
});

router.post('/trial/submissions', requireTrialAuth, async (req: Request, res: Response) => {
  const account = req.trialAccount!;
  if (account.packagesPurchased >= trialConfig.maxPackages) {
    res.status(422).json({
      error: `You've used all ${trialConfig.maxPackages} trial packages. The next step is a plan — here's what that looks like.`,
      code: 'cap_reached',
    });
    return;
  }
  // Reuse an existing draft rather than stacking drafts.
  const [draft] = await db
    .select()
    .from(trialSubmissions)
    .where(and(eq(trialSubmissions.accountId, account.id), eq(trialSubmissions.status, 'draft')));
  if (draft) {
    res.json({ submission: publicSubmission(draft) });
    return;
  }
  try {
    const [created] = await db.insert(trialSubmissions).values({
      accountId: account.id,
      sequenceNum: account.packagesPurchased + 1,
      status: 'draft',
    }).returning();
    res.status(201).json({ submission: publicSubmission(created) });
  } catch (err) {
    // Unique (account_id, sequence_num) — a concurrent request created the
    // draft first; return it instead of 500ing. pg code lives on .cause.
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code === '23505') {
      const [existing] = await db
        .select()
        .from(trialSubmissions)
        .where(and(eq(trialSubmissions.accountId, account.id), eq(trialSubmissions.status, 'draft')));
      if (existing) {
        res.json({ submission: publicSubmission(existing) });
        return;
      }
    }
    throw err;
  }
});

async function loadOwnSubmission(req: Request, res: Response) {
  const id = req.params.id as string;
  const [sub] = await db.select().from(trialSubmissions).where(eq(trialSubmissions.id, id));
  if (!sub || sub.accountId !== req.trialAccount!.id) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return sub;
}

router.get('/trial/submissions/:id', requireTrialAuth, async (req: Request, res: Response) => {
  const sub = await loadOwnSubmission(req, res);
  if (!sub) return;
  const uploads = await db.select().from(trialUploads).where(eq(trialUploads.submissionId, sub.id));
  let expectedDate: string | null = null;
  if (sub.approvedAt && !sub.deliveredAt) {
    expectedDate = addBusinessDays(sub.approvedAt, trialConfig.turnaroundBusinessDays).toISOString().slice(0, 10);
  }
  res.json({ submission: publicSubmission(sub), uploads, expectedDate });
});

const DraftPatchBody = z.object({
  propertyAddress: z.string().max(500).optional(),
  propertyCity: z.string().max(255).optional(),
  propertyState: z.string().length(2).optional(),
  propertyZip: z.string().max(10).optional(),
  county: z.string().max(255).optional(),
  dateOfLoss: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  perilType: z.enum(TRIAL_PERIL_TYPES).optional(),
  carrierName: z.string().max(255).optional(),
  claimNumberRef: z.string().max(100).optional(),
  roofSystem: z.string().max(255).optional(),
  stories: z.number().int().min(1).max(10).optional(),
  scopeNotes: z.string().max(2000).optional(),
  brandColorHex: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  licenseDisplay: z.string().max(255).optional(),
  logoFileKey: z.string().max(500).optional(),
}).strict();

router.patch('/trial/submissions/:id', requireTrialAuth, async (req: Request, res: Response) => {
  const sub = await loadOwnSubmission(req, res);
  if (!sub) return;
  if (sub.status !== 'draft') {
    res.status(409).json({ error: 'Submission is no longer editable' });
    return;
  }
  const parsed = DraftPatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid fields', detail: parsed.error.flatten().fieldErrors });
    return;
  }
  const b = parsed.data;

  // Service-area exclusion mechanism (spec §10 — list empty by default).
  if (b.propertyZip && trialConfig.excludedZips.includes(b.propertyZip)) {
    res.status(422).json({ error: 'This service area is not currently available.', code: 'excluded_zip' });
    return;
  }

  const patch: Record<string, unknown> = { ...b, updatedAt: new Date() };
  if (b.dateOfLoss) patch.dateOfLoss = new Date(b.dateOfLoss);
  if (b.propertyState) patch.propertyState = b.propertyState.toUpperCase();

  const [updated] = await db.update(trialSubmissions)
    .set(patch)
    .where(eq(trialSubmissions.id, sub.id))
    .returning();

  // Coverage gate feedback (spec §4): report coverage whenever state+county known.
  let coverage: string | null = null;
  const state = updated.propertyState;
  const county = updated.county;
  if (state && county) {
    const row = await coverageFor(state, county);
    coverage = row?.status ?? 'none';
  }
  res.json({ submission: publicSubmission(updated), coverage });
});

const UPLOAD_LIMITS: Record<string, { maxBytes: number; contentTypes: RegExp }> = {
  photo: { maxBytes: 15 * 1024 * 1024, contentTypes: /^image\/(jpe?g|png|heic|heif)$/i },
  measurement_report: { maxBytes: 25 * 1024 * 1024, contentTypes: /^application\/pdf$/i },
  carrier_estimate: { maxBytes: 25 * 1024 * 1024, contentTypes: /^(application\/pdf|application\/vnd\.(ms-excel|openxmlformats-officedocument\.spreadsheetml\.sheet))$/i },
  logo: { maxBytes: 5 * 1024 * 1024, contentTypes: /^image\/(png|svg\+xml)$/i },
  other: { maxBytes: 25 * 1024 * 1024, contentTypes: /.*/ },
};
const MAX_PHOTOS = 40;

const RequestUploadBody = z.object({
  fileName: z.string().min(1).max(255),
  fileType: z.enum(['photo', 'measurement_report', 'carrier_estimate', 'logo', 'other']),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

router.post('/trial/submissions/:id/uploads/request-url', requireTrialAuth, async (req: Request, res: Response) => {
  const sub = await loadOwnSubmission(req, res);
  if (!sub) return;
  if (sub.status !== 'draft') {
    res.status(409).json({ error: 'Submission is no longer editable' });
    return;
  }
  const parsed = RequestUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid fields' });
    return;
  }
  const { fileType, contentType, sizeBytes, fileName } = parsed.data;
  const limits = UPLOAD_LIMITS[fileType]!;
  if (sizeBytes > limits.maxBytes) {
    res.status(422).json({ error: `File too large (max ${Math.round(limits.maxBytes / 1024 / 1024)}MB)` });
    return;
  }
  if (!limits.contentTypes.test(contentType)) {
    res.status(422).json({ error: 'Unsupported file type' });
    return;
  }
  if (fileType === 'photo') {
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(trialUploads)
      .where(and(eq(trialUploads.submissionId, sub.id), eq(trialUploads.fileType, 'photo')));
    if ((row?.count ?? 0) >= MAX_PHOTOS) {
      res.status(422).json({ error: `Maximum ${MAX_PHOTOS} photos` });
      return;
    }
  }
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath, fileName });
  } catch (err) {
    req.log.error({ err }, 'trial upload url failed');
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

const RecordUploadBody = z.object({
  objectPath: z.string().min(1).max(500),
  fileName: z.string().min(1).max(255),
  fileType: z.enum(['photo', 'measurement_report', 'carrier_estimate', 'logo', 'other']),
  sizeBytes: z.number().int().positive(),
});

router.post('/trial/submissions/:id/uploads', requireTrialAuth, async (req: Request, res: Response) => {
  const sub = await loadOwnSubmission(req, res);
  if (!sub) return;
  if (sub.status !== 'draft') {
    res.status(409).json({ error: 'Submission is no longer editable' });
    return;
  }
  const parsed = RecordUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid fields' });
    return;
  }
  const b = parsed.data;
  if (!b.objectPath.startsWith('/objects/uploads/')) {
    res.status(422).json({ error: 'Invalid object path' });
    return;
  }
  const [created] = await db.insert(trialUploads).values({
    submissionId: sub.id,
    fileKey: b.objectPath,
    fileType: b.fileType,
    fileName: b.fileName,
    sizeBytes: b.sizeBytes,
  }).returning();
  if (b.fileType === 'logo') {
    await db.update(trialSubmissions).set({ logoFileKey: b.objectPath, updatedAt: new Date() })
      .where(eq(trialSubmissions.id, sub.id));
  }
  res.status(201).json({ upload: created });
});

router.delete('/trial/uploads/:id', requireTrialAuth, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [up] = await db.select().from(trialUploads).where(eq(trialUploads.id, id));
  if (!up) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const [sub] = await db.select().from(trialSubmissions).where(eq(trialSubmissions.id, up.submissionId));
  if (!sub || sub.accountId !== req.trialAccount!.id || sub.status !== 'draft') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    await storage.deleteObjectEntity(up.fileKey);
  } catch (err) {
    logger.warn({ err }, 'trial upload object delete failed');
  }
  await db.delete(trialUploads).where(eq(trialUploads.id, id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

const CheckoutBody = z.object({
  acceptAuthorized: z.literal(true),
  acceptReviewResponsibility: z.literal(true),
  acceptTerms: z.literal(true),
});

const REQUIRED_FOR_CHECKOUT = [
  'propertyAddress', 'propertyCity', 'propertyState', 'propertyZip', 'county',
  'dateOfLoss', 'perilType', 'carrierName', 'roofSystem', 'stories', 'licenseDisplay',
] as const;

router.post('/trial/submissions/:id/checkout', requireTrialAuth, async (req: Request, res: Response) => {
  const account = req.trialAccount!;
  const sub = await loadOwnSubmission(req, res);
  if (!sub) return;
  if (sub.status !== 'draft') {
    res.status(409).json({ error: 'This submission has already been paid.' });
    return;
  }
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'All three acknowledgements are required.' });
    return;
  }
  if (account.packagesPurchased >= trialConfig.maxPackages) {
    res.status(422).json({ error: `You've used all ${trialConfig.maxPackages} trial packages.`, code: 'cap_reached' });
    return;
  }
  const missing = REQUIRED_FOR_CHECKOUT.filter((k) => sub[k] == null || sub[k] === '');
  if (missing.length > 0) {
    res.status(422).json({ error: 'Submission is incomplete', missing });
    return;
  }
  // Coverage gate — out-of-coverage NEVER reaches checkout (spec hard rule).
  const cov = await coverageFor(sub.propertyState!, sub.county!);
  if (cov?.status !== 'covered') {
    res.status(422).json({ error: 'This jurisdiction is not covered yet.', code: 'not_covered' });
    return;
  }
  if (trialConfig.excludedZips.includes(sub.propertyZip!)) {
    res.status(422).json({ error: 'This service area is not currently available.', code: 'excluded_zip' });
    return;
  }
  if (await atWeeklyCapacity()) {
    res.status(422).json({ error: "We're at capacity this week. Join the list and we'll open your spot next week.", code: 'at_capacity' });
    return;
  }
  const amountCents = sub.sequenceNum === 1 ? trialConfig.priceFirstCents : trialConfig.priceSubsequentCents;
  try {
    const { url } = await createCheckout({ submissionId: sub.id, sequenceNum: sub.sequenceNum, amountCents, email: account.email });
    res.json({ checkoutUrl: url, amountCents });
  } catch (err) {
    if (err instanceof PaymentsNotConfigured) {
      res.status(503).json({
        error: 'Online payment is not available yet. We\'ll reach out to complete your order.',
        code: 'payments_not_configured',
        amountCents,
      });
      return;
    }
    req.log.error({ err }, 'trial checkout failed');
    res.status(500).json({ error: 'Checkout failed' });
  }
});

/**
 * Shared success path — what the Stripe payment_intent.succeeded webhook will
 * call once wired (spec §5): set status paid, increment packages_purchased,
 * credit ledger +amount, set credit_expires_at on first purchase.
 */
export async function recordSuccessfulPayment(submissionId: string, paymentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [sub] = await tx.select().from(trialSubmissions).where(eq(trialSubmissions.id, submissionId)).for('update');
    if (!sub || sub.status !== 'draft') return; // idempotent
    const amountCents = sub.sequenceNum === 1 ? trialConfig.priceFirstCents : trialConfig.priceSubsequentCents;
    const now = new Date();
    await tx.update(trialSubmissions).set({
      status: 'paid',
      amountPaidCents: amountCents,
      stripePaymentId: paymentId,
      submittedAt: now,
      updatedAt: now,
    }).where(eq(trialSubmissions.id, submissionId));
    const [account] = await tx.select().from(trialAccounts).where(eq(trialAccounts.id, sub.accountId)).for('update');
    if (!account) return;
    // Re-check the package cap under the account row lock — the checkout-time
    // check is advisory only and two concurrent payments could both pass it.
    if (account.packagesPurchased >= trialConfig.maxPackages) {
      logger.warn({ submissionId, accountId: account.id }, 'payment recorded past package cap — flagging, not crediting');
      throw new Error('package cap exceeded at payment time');
    }
    await tx.update(trialAccounts).set({
      packagesPurchased: account.packagesPurchased + 1,
      creditBalanceCents: account.creditBalanceCents + amountCents,
      creditExpiresAt: account.creditExpiresAt
        ?? new Date(now.getTime() + trialConfig.creditWindowDays * 86_400_000),
    }).where(eq(trialAccounts.id, account.id));
    await tx.insert(trialCreditLedger).values({
      accountId: account.id,
      deltaCents: amountCents,
      reason: `package ${sub.sequenceNum} purchase`,
    });
  });
  // Receipt email (fire-and-forget).
  const [sub] = await db.select().from(trialSubmissions).where(eq(trialSubmissions.id, submissionId));
  if (sub?.status === 'paid') {
    const [account] = await db.select().from(trialAccounts).where(eq(trialAccounts.id, sub.accountId));
    if (account) {
      const expected = addBusinessDays(new Date(), trialConfig.turnaroundBusinessDays).toISOString().slice(0, 10);
      const tmpl = trialEmails.paymentReceipt(sub.amountPaidCents ?? 0, expected);
      void sendTrialEmail(account.email, tmpl.subject, tmpl.text).catch(() => {});
    }
  }
}

/**
 * Post-checkout confirmation. The Stripe success URL returns the buyer to the
 * status page with ?checkout_session=...; the page calls this route, which
 * verifies payment with Stripe (never trusts the query param alone) and runs
 * the same idempotent recordSuccessfulPayment path as the webhook would.
 */
router.post('/trial/submissions/:id/checkout/confirm', requireTrialAuth, async (req: Request, res: Response) => {
  const sub = await loadOwnSubmission(req, res);
  if (!sub) return;
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  if (!sessionId) {
    res.status(422).json({ error: 'sessionId is required' });
    return;
  }
  if (sub.status !== 'draft') {
    // Already recorded (webhook race or repeat call) — idempotent success.
    res.json({ submission: publicSubmission(sub) });
    return;
  }
  try {
    const { paid, paymentId } = await verifyPaidCheckoutSession(sessionId, sub.id);
    if (!paid || !paymentId) {
      res.status(402).json({ error: 'Payment not completed', code: 'not_paid' });
      return;
    }
    await recordSuccessfulPayment(sub.id, paymentId);
  } catch (err) {
    req.log.error({ err }, 'trial checkout confirm failed');
    res.status(500).json({ error: 'Could not verify payment' });
    return;
  }
  const [updated] = await db.select().from(trialSubmissions).where(eq(trialSubmissions.id, sub.id));
  res.json({ submission: publicSubmission(updated!) });
});

router.post('/trial/submissions/:id/simulate-payment', requireTrialAuth, async (req: Request, res: Response) => {
  if (!trialConfig.devFakePayments) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const sub = await loadOwnSubmission(req, res);
  if (!sub) return;
  await recordSuccessfulPayment(sub.id, `sim_${randomBytes(8).toString('hex')}`);
  const [updated] = await db.select().from(trialSubmissions).where(eq(trialSubmissions.id, sub.id));
  res.json({ submission: publicSubmission(updated!) });
});

export default router;

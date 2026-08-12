/**
 * Trial Proof Package — admin review queue (spec §6). Admin-gated with the
 * same key as /admin/stats (team.view_stats — admin+).
 *
 *   GET  /admin/trial-queue                    — table (filter by status, sorted by age)
 *   GET  /admin/trial-queue/:id                — detail (intake, uploads, account history, coverage)
 *   POST /admin/trial-queue/:id/approve
 *   POST /admin/trial-queue/:id/reject         — { reason } + auto-refund attempt
 *   POST /admin/trial-queue/:id/status         — { status: building|ready|delivered }
 *   POST /admin/trial-queue/:id/notes          — { notes }
 *   POST /admin/trial-queue/:id/deliverable/request-url
 *   POST /admin/trial-queue/:id/deliverable    — record uploaded deliverable file
 *   POST /admin/trial-queue/:id/send-deliverable — post-call email w/ 30-day signed link
 *   GET  /admin/ahj-coverage                   — list coverage rows
 *   POST /admin/ahj-coverage                   — upsert { state, county, status, codeCycle }
 *   POST /admin/trial-purge/run                — manual purge trigger
 */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  db,
  ahjCoverage,
  trialAccounts,
  trialSubmissions,
  trialUploads,
  AHJ_COVERAGE_STATUSES,
  TRIAL_SUBMISSION_STATUSES,
} from '@workspace/db';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middlewares/requirePermission';
import { ObjectStorageService } from '../lib/objectStorage';
import { addBusinessDays } from '../lib/trial/businessDays';
import { trialConfig } from '../lib/trial/config';
import { sendTrialEmail, trialEmails } from '../lib/trial/mailer';
import { issueRefund } from '../lib/trial/payments';
import { runTrialPurge } from '../lib/trial/purge';

const router: IRouter = Router();
const storage = new ObjectStorageService();
const requireAdmin = requirePermission('team.view_stats');

async function loadSubmission(req: Request, res: Response) {
  const id = req.params.id as string;
  const [sub] = await db.select().from(trialSubmissions).where(eq(trialSubmissions.id, id));
  if (!sub) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return sub;
}

router.get('/admin/trial-queue', requireAdmin, async (req: Request, res: Response) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const where = status ? eq(trialSubmissions.status, status) : undefined;
  const rows = await db
    .select({
      submission: trialSubmissions,
      account: trialAccounts,
    })
    .from(trialSubmissions)
    .innerJoin(trialAccounts, eq(trialSubmissions.accountId, trialAccounts.id))
    .where(where)
    .orderBy(asc(trialSubmissions.submittedAt), asc(trialSubmissions.createdAt));
  res.json({
    items: rows.map(({ submission: s, account: a }) => ({
      id: s.id,
      company: a.companyName,
      email: a.email,
      state: s.propertyState,
      county: s.county,
      sequenceNum: s.sequenceNum,
      status: s.status,
      submittedAt: s.submittedAt,
      createdAt: s.createdAt,
      ageDays: s.submittedAt ? Math.floor((Date.now() - s.submittedAt.getTime()) / 86_400_000) : null,
    })),
  });
});

router.get('/admin/trial-queue/:id', requireAdmin, async (req: Request, res: Response) => {
  const sub = await loadSubmission(req, res);
  if (!sub) return;
  const [account] = await db.select().from(trialAccounts).where(eq(trialAccounts.id, sub.accountId));
  const uploads = await db.select().from(trialUploads).where(eq(trialUploads.submissionId, sub.id));
  const uploadsWithUrls = await Promise.all(uploads.map(async (u) => ({
    ...u,
    signedUrl: await storage.getSignedDownloadUrl(u.fileKey, 3600).catch(() => null),
  })));
  const history = account
    ? await db.select().from(trialSubmissions)
        .where(eq(trialSubmissions.accountId, account.id))
        .orderBy(desc(trialSubmissions.createdAt))
    : [];
  let coverage = null;
  if (sub.propertyState && sub.county) {
    const [row] = await db.select().from(ahjCoverage).where(and(
      eq(ahjCoverage.state, sub.propertyState),
      sql`lower(${ahjCoverage.county}) = ${sub.county.toLowerCase()}`,
    ));
    coverage = row ?? null;
  }
  res.json({
    submission: sub,
    account,
    uploads: uploadsWithUrls,
    accountHistory: history.map((h) => ({ id: h.id, sequenceNum: h.sequenceNum, status: h.status, createdAt: h.createdAt })),
    coverage,
    excludedZip: sub.propertyZip ? trialConfig.excludedZips.includes(sub.propertyZip) : false,
  });
});

router.post('/admin/trial-queue/:id/approve', requireAdmin, async (req: Request, res: Response) => {
  const sub = await loadSubmission(req, res);
  if (!sub) return;
  if (sub.status !== 'paid' && sub.status !== 'in_review') {
    res.status(409).json({ error: `Cannot approve from status "${sub.status}"` });
    return;
  }
  const now = new Date();
  const [updated] = await db.update(trialSubmissions)
    .set({ status: 'approved', approvedAt: now, updatedAt: now })
    .where(eq(trialSubmissions.id, sub.id)).returning();
  const [account] = await db.select().from(trialAccounts).where(eq(trialAccounts.id, sub.accountId));
  if (account) {
    const expected = addBusinessDays(now, trialConfig.turnaroundBusinessDays).toISOString().slice(0, 10);
    const tmpl = trialEmails.approved(expected);
    void sendTrialEmail(account.email, tmpl.subject, tmpl.text).catch(() => {});
  }
  res.json({ submission: updated });
});

const RejectBody = z.object({ reason: z.string().min(1).max(2000) });

router.post('/admin/trial-queue/:id/reject', requireAdmin, async (req: Request, res: Response) => {
  const sub = await loadSubmission(req, res);
  if (!sub) return;
  const parsed = RejectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'reason is required' });
    return;
  }
  if (['delivered', 'rejected'].includes(sub.status)) {
    res.status(409).json({ error: `Cannot reject from status "${sub.status}"` });
    return;
  }
  const now = new Date();
  const refund = await issueRefund({ submissionId: sub.id, stripePaymentId: sub.stripePaymentId });
  const [updated] = await db.update(trialSubmissions).set({
    status: 'rejected',
    rejectReason: parsed.data.reason,
    refundIssuedAt: refund.ok ? now : null,
    purgeAfter: new Date(now.getTime() + trialConfig.rejectedPurgeAfterDays * 86_400_000),
    updatedAt: now,
  }).where(eq(trialSubmissions.id, sub.id)).returning();
  const [account] = await db.select().from(trialAccounts).where(eq(trialAccounts.id, sub.accountId));
  if (account) {
    const refundNote = refund.ok
      ? 'Your payment has been refunded in full; expect it on your statement within 5–10 business days.'
      : 'Your refund is being processed and will be confirmed separately.';
    const tmpl = trialEmails.rejected(parsed.data.reason, refundNote);
    void sendTrialEmail(account.email, tmpl.subject, tmpl.text).catch(() => {});
  }
  res.json({ submission: updated, refund });
});

const StatusBody = z.object({ status: z.enum(['in_review', 'building', 'ready', 'delivered']) });

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  paid: ['in_review'],
  in_review: [],           // approve/reject use their own endpoints
  approved: ['building'],
  building: ['ready'],
  ready: ['delivered'],
};

router.post('/admin/trial-queue/:id/status', requireAdmin, async (req: Request, res: Response) => {
  const sub = await loadSubmission(req, res);
  if (!sub) return;
  const parsed = StatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `status must be one of: in_review, building, ready, delivered` });
    return;
  }
  const target = parsed.data.status;
  if (!(ALLOWED_TRANSITIONS[sub.status] ?? []).includes(target)) {
    res.status(409).json({ error: `Cannot move from "${sub.status}" to "${target}"` });
    return;
  }
  if (target === 'ready' && !sub.deliverableFileKey) {
    res.status(422).json({ error: 'Upload the deliverable before marking ready' });
    return;
  }
  const now = new Date();
  const patch: Record<string, unknown> = { status: target, updatedAt: now };
  if (target === 'delivered') {
    patch.deliveredAt = now;
    patch.purgeAfter = new Date(now.getTime() + trialConfig.purgeAfterDays * 86_400_000);
  }
  const [updated] = await db.update(trialSubmissions).set(patch)
    .where(eq(trialSubmissions.id, sub.id)).returning();

  if (target === 'ready') {
    // Booking link ONLY — package is never attached to the ready email (spec §7).
    const [account] = await db.select().from(trialAccounts).where(eq(trialAccounts.id, sub.accountId));
    if (account) {
      const tmpl = trialEmails.ready(trialConfig.bookingUrl);
      void sendTrialEmail(account.email, tmpl.subject, tmpl.text).catch(() => {});
    }
  }
  res.json({ submission: updated });
});

const NotesBody = z.object({ notes: z.string().max(10000) });

router.post('/admin/trial-queue/:id/notes', requireAdmin, async (req: Request, res: Response) => {
  const sub = await loadSubmission(req, res);
  if (!sub) return;
  const parsed = NotesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'notes required' });
    return;
  }
  const [updated] = await db.update(trialSubmissions)
    .set({ adminNotes: parsed.data.notes, updatedAt: new Date() })
    .where(eq(trialSubmissions.id, sub.id)).returning();
  res.json({ submission: updated });
});

router.post('/admin/trial-queue/:id/deliverable/request-url', requireAdmin, async (req: Request, res: Response) => {
  const sub = await loadSubmission(req, res);
  if (!sub) return;
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log.error({ err }, 'trial deliverable url failed');
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

const DeliverableBody = z.object({ objectPath: z.string().min(1).max(500) });

router.post('/admin/trial-queue/:id/deliverable', requireAdmin, async (req: Request, res: Response) => {
  const sub = await loadSubmission(req, res);
  if (!sub) return;
  const parsed = DeliverableBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.objectPath.startsWith('/objects/uploads/')) {
    res.status(400).json({ error: 'valid objectPath required' });
    return;
  }
  const [updated] = await db.update(trialSubmissions)
    .set({ deliverableFileKey: parsed.data.objectPath, updatedAt: new Date() })
    .where(eq(trialSubmissions.id, sub.id)).returning();
  res.json({ submission: updated });
});

router.post('/admin/trial-queue/:id/send-deliverable', requireAdmin, async (req: Request, res: Response) => {
  const sub = await loadSubmission(req, res);
  if (!sub) return;
  if (!sub.deliverableFileKey) {
    res.status(422).json({ error: 'No deliverable uploaded' });
    return;
  }
  if (sub.status !== 'ready' && sub.status !== 'delivered') {
    res.status(409).json({ error: 'Deliverable is sent after the walkthrough (ready → delivered)' });
    return;
  }
  const [account] = await db.select().from(trialAccounts).where(eq(trialAccounts.id, sub.accountId));
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  // GCS signing caps at 7 days, so a 30-day signed URL is impossible. Instead
  // we email a stable access link (/api/trial/deliverable/:token) that stays
  // valid for the 30-day window and mints a short-lived signed URL per click.
  const accessToken = sub.deliverableToken ?? randomBytes(32).toString('hex');
  const host = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `${req.protocol}://${req.get('host')}`;
  const link = `${host}/api/trial/deliverable/${accessToken}`;
  const tmpl = trialEmails.deliverable(link);
  await sendTrialEmail(account.email, tmpl.subject, tmpl.text);
  // Sending the deliverable implies delivery completed.
  const now = new Date();
  const patch: Record<string, unknown> = { updatedAt: now, deliverableToken: accessToken };
  if (sub.status === 'ready') {
    patch.status = 'delivered';
    patch.deliveredAt = now;
    patch.purgeAfter = new Date(now.getTime() + trialConfig.purgeAfterDays * 86_400_000);
  }
  const [updated] = await db.update(trialSubmissions).set(patch)
    .where(eq(trialSubmissions.id, sub.id)).returning();
  res.json({ submission: updated, emailed: true });
});

// ---------------------------------------------------------------------------
// AHJ coverage admin
// ---------------------------------------------------------------------------

router.get('/admin/ahj-coverage', requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db.select().from(ahjCoverage).orderBy(asc(ahjCoverage.state), asc(ahjCoverage.county));
  res.json({ items: rows });
});

const CoverageBody = z.object({
  state: z.string().length(2),
  county: z.string().min(1).max(255),
  status: z.enum(AHJ_COVERAGE_STATUSES),
  codeCycle: z.string().max(100).optional(),
});

router.post('/admin/ahj-coverage', requireAdmin, async (req: Request, res: Response) => {
  const parsed = CoverageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid fields' });
    return;
  }
  const b = parsed.data;
  const state = b.state.toUpperCase();
  const [existing] = await db.select().from(ahjCoverage).where(and(
    eq(ahjCoverage.state, state),
    sql`lower(${ahjCoverage.county}) = ${b.county.toLowerCase().trim()}`,
  ));
  if (existing) {
    const [updated] = await db.update(ahjCoverage)
      .set({ status: b.status, codeCycle: b.codeCycle ?? existing.codeCycle, updatedAt: new Date() })
      .where(eq(ahjCoverage.id, existing.id)).returning();
    res.json({ coverage: updated });
    return;
  }
  const [created] = await db.insert(ahjCoverage).values({
    state,
    county: b.county.trim(),
    status: b.status,
    codeCycle: b.codeCycle ?? null,
  }).returning();
  res.status(201).json({ coverage: created });
});

router.post('/admin/trial-purge/run', requireAdmin, async (_req: Request, res: Response) => {
  const purged = await runTrialPurge();
  res.json({ purged });
});

export default router;

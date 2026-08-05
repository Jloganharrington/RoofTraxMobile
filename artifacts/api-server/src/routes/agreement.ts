/**
 * Agreement routes — forensic inspection homeowner signing.
 *
 * POST /inspections/:id/agreement/sign
 *   Creates a signed agreement for the inspection. One active agreement per
 *   inspection — subsequent calls return 409 unless the prior agreement was
 *   voided. Requires rep+ access (same company + own inspection or manager+),
 *   inspection module access, and the inspection to be in the forensic phase.
 *   Locked inspections are allowed (signing happens after submission).
 *
 * GET /inspections/:id/agreement
 *   Returns the signed agreement record (if any) plus a short-lived presigned
 *   download URL for the PDF. Voided agreements are returned with voidedAt set.
 *
 * DELETE /inspections/:id/agreement
 *   Super-admin only. Soft-voids the active signed agreement so a replacement
 *   can be collected. Records voidedAt, voidedByUserId, and voidReason.
 */

import { randomUUID } from 'crypto';
import {
  db,
  objectOwnershipTable,
  signedAgreementsTable,
  userProfilesTable,
  inspectionsTable,
  usersTable,
} from '@workspace/db';
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';

import { canAccessInspectionModule, canWriteInspection } from '@workspace/authz';
import { ObjectStorageService, ObjectNotFoundError } from '../lib/objectStorage';
import { AGREEMENT_DOCUMENT_VERSION } from '../lib/agreementPdf';
import { decryptSmtpPassword } from '../lib/smtpCrypto';
import { resolvePublicSmtpAddress } from '../lib/smtpGuard';
import { runAhjCheck } from '../lib/ahjLookup';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// ── Shared auth helper ────────────────────────────────────────────────────────

async function requireAgreementActor(req: Request, res: Response) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user.id));

  const role = profile?.role ?? 'field_rep';
  const department = profile?.department ?? 'canvasser';

  if (!canAccessInspectionModule(role, department)) {
    res.status(403).json({ error: 'Inspection module not enabled for this user' });
    return null;
  }

  return {
    role,
    companyId: req.user.companyId,
    userId: req.user.id,
    profile,
  };
}

// ── POST /inspections/:id/agreement/sign ──────────────────────────────────────

const SignAgreementBody = z.object({
  signerName: z.string().min(1).max(200),
  /** Base64-encoded PDF generated on-device via expo-print from the FIPSA HTML template. */
  pdfBase64: z.string().min(100),
});

router.post(
  '/inspections/:id/agreement/sign',
  async (req: Request, res: Response) => {
    const actor = await requireAgreementActor(req, res);
    if (!actor) return;

    // Express params are always strings in practice; cast to satisfy strictness.
    const inspectionId = String(req.params.id);

    // Load inspection — must be same company
    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, inspectionId),
          eq(inspectionsTable.companyId, actor.companyId),
        ),
      );

    if (!inspection) {
      res.status(404).json({ error: 'Inspection not found' });
      return;
    }

    // Only the assigned inspector or a manager+ may sign
    if (!canWriteInspection(actor.role, actor.userId, inspection.inspectorUserId)) {
      res.status(403).json({ error: 'Not authorized to sign for this inspection' });
      return;
    }

    // Forensic phase only
    if (inspection.phase !== 'forensic') {
      res.status(409).json({
        error: 'Agreement signing is only available for forensic-phase inspections',
      });
      return;
    }

    // Idempotency — one *active* (non-voided) agreement per inspection.
    // Voided agreements are skipped so a replacement signing is allowed.
    const [existing] = await db
      .select({ id: signedAgreementsTable.id })
      .from(signedAgreementsTable)
      .where(
        and(
          eq(signedAgreementsTable.inspectionId, inspectionId),
          isNull(signedAgreementsTable.voidedAt),
        ),
      );

    if (existing) {
      res.status(409).json({ error: 'This inspection already has a signed agreement' });
      return;
    }

    // Validate body
    const parsed = SignAgreementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const { signerName, pdfBase64 } = parsed.data;

    // Validate the payload is actually a PDF (magic bytes %PDF).
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.slice(0, 4).toString('ascii').startsWith('%PDF')) {
      res.status(400).json({ error: 'pdfBase64 does not appear to be a valid PDF' });
      return;
    }

    const signedAt = new Date();

    // Upload the device-generated PDF to object storage.
    let documentObjectPath: string;
    try {
      documentObjectPath = await objectStorageService.uploadObjectBuffer(
        pdfBuffer,
        'application/pdf',
      );
    } catch (err) {
      req.log.error({ err }, 'Failed to upload agreement PDF to object storage');
      res.status(500).json({ error: 'Failed to store signed agreement' });
      return;
    }

    // Persist ownership + agreement record atomically.
    // The partial UNIQUE index on signed_agreements(inspection_id) WHERE
    // voided_at IS NULL is the hard guard against duplicates. We catch that
    // violation here and convert it to a 409 so concurrent double-submits
    // never return 500.
    let agreementRow: typeof signedAgreementsTable.$inferSelect;
    try {
      const rows = await db.transaction(async (tx) => {
        // Record ownership so the GET /storage/objects/*path route can serve it
        await tx.insert(objectOwnershipTable).values({
          objectPath: documentObjectPath,
          userId: actor.userId,
          companyId: actor.companyId,
        });

        return tx
          .insert(signedAgreementsTable)
          .values({
            id: randomUUID(),
            inspectionId,
            companyId: actor.companyId,
            signerName,
            documentVersion: AGREEMENT_DOCUMENT_VERSION,
            signedAt,
            auditMetadata: {
              inspectorUserId: actor.userId,
              appVersion: typeof req.headers['x-app-version'] === 'string'
                ? req.headers['x-app-version']
                : null,
              userAgent: req.headers['user-agent'] ?? null,
            },
            documentObjectPath,
          })
          .returning();
      });
      agreementRow = rows[0];
    } catch (err) {
      // Detect unique-constraint violation on inspectionId (Postgres code 23505)
      const isUniqueViolation =
        err instanceof Error &&
        ('code' in err ? (err as NodeJS.ErrnoException).code : '') === '23505';
      if (isUniqueViolation) {
        res.status(409).json({ error: 'Agreement already signed for this inspection' });
        return;
      }
      req.log.error({ err }, 'Failed to persist signed agreement record');
      res.status(500).json({ error: 'Failed to save signed agreement' });
      return;
    }

    req.log.info(
      { inspectionId, agreementId: agreementRow.id },
      'Agreement signed and PDF stored',
    );

    // ── Best-effort auto-email to rep + homeowner on sign ─────────────────────
    // Sends are non-blocking to the 201 response: failures are logged but do
    // not roll back the signing or prevent the response from going out.
    let repEmailed = false;
    let homeownerAutoEmailed = false;
    const repEmail = req.user?.email;
    const { smtpHost, smtpPort, smtpUsername, smtpPasswordEnc, smtpSecure, smtpFromEmail } =
      actor.profile ?? {};

    if (smtpHost && smtpPort && smtpUsername && smtpPasswordEnc) {
      try {
        const password = decryptSmtpPassword(smtpPasswordEnc);
        const smtpAddress = await resolvePublicSmtpAddress(smtpHost);
        const transport = nodemailer.createTransport({
          host: smtpAddress,
          port: smtpPort,
          secure: smtpSecure ?? smtpPort === 465,
          name: undefined,
          auth: { user: smtpUsername, pass: password },
          tls: { servername: smtpHost },
          connectionTimeout: 15_000,
          socketTimeout: 30_000,
        });

        const propertyLabel = inspection.address ?? 'your property';
        const mailText = [
          'A Forensic Inspection Purchase & Sale Agreement has been signed.',
          '',
          `Property: ${propertyLabel}`,
          `Signed by: ${signerName}`,
          `Date signed: ${signedAt.toLocaleString()}`,
          '',
          'A copy of the signed agreement is attached for your records.',
        ].join('\n');
        const attachment = {
          filename: 'Signed-Agreement.pdf',
          content: pdfBuffer,
          contentType: 'application/pdf' as const,
        };
        const from = smtpFromEmail || smtpUsername;

        const sends: Promise<unknown>[] = [];
        if (repEmail) {
          sends.push(
            transport
              .sendMail({
                from,
                to: repEmail,
                subject: `Signed Agreement — ${propertyLabel}`,
                text: mailText,
                attachments: [attachment],
              })
              .then(() => {
                repEmailed = true;
              }),
          );
        }
        const ownerEmailAddr = (inspection as { ownerEmail?: string | null }).ownerEmail;
        if (ownerEmailAddr && ownerEmailAddr !== repEmail) {
          sends.push(
            transport
              .sendMail({
                from,
                to: ownerEmailAddr,
                subject: `Forensic Inspection Purchase & Sale Agreement — ${propertyLabel}`,
                text: mailText,
                attachments: [attachment],
              })
              .then(() => {
                homeownerAutoEmailed = true;
              }),
          );
        }
        await Promise.allSettled(sends);
      } catch (err) {
        req.log.warn({ err }, 'Auto-email on sign — SMTP setup failed, skipping');
      }
    }

    // ── Non-blocking AHJ jurisdiction check ───────────────────────────────────
    // Fire after signing is persisted. Never awaited — failures are swallowed
    // inside runAhjCheck so the 201 response is never at risk.
    if (inspection.address) {
      void runAhjCheck(inspectionId, inspection.address, actor.companyId, req.log);
    }

    res.status(201).json({
      agreement: {
        id: agreementRow.id,
        inspectionId: agreementRow.inspectionId,
        signerName: agreementRow.signerName,
        documentVersion: agreementRow.documentVersion,
        signedAt: agreementRow.signedAt,
        documentObjectPath: agreementRow.documentObjectPath,
      },
      repEmailed,
      homeownerAutoEmailed,
    });
  },
);

// ── GET /inspections/:id/agreement ────────────────────────────────────────────

router.get(
  '/inspections/:id/agreement',
  async (req: Request, res: Response) => {
    const actor = await requireAgreementActor(req, res);
    if (!actor) return;

    const inspectionId = String(req.params.id);

    // Must be same company
    const [inspection] = await db
      .select({ id: inspectionsTable.id, companyId: inspectionsTable.companyId, phase: inspectionsTable.phase })
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, inspectionId),
          eq(inspectionsTable.companyId, actor.companyId),
        ),
      );

    if (!inspection) {
      res.status(404).json({ error: 'Inspection not found' });
      return;
    }

    // Return the most recent agreement for this inspection (voided or active).
    // The mobile client uses voidedAt to determine whether re-signing is needed.
    const [agreement] = await db
      .select()
      .from(signedAgreementsTable)
      .where(eq(signedAgreementsTable.inspectionId, inspectionId))
      .orderBy(desc(signedAgreementsTable.signedAt))
      .limit(1);

    if (!agreement) {
      res.json({ agreement: null, phase: inspection.phase });
      return;
    }

    // The mobile app serves PDFs through the authenticated storage proxy
    // (GET /storage/objects/*path) rather than presigned URLs, because GCS
    // signed URLs require a service-account client_email that is not available
    // in this environment. downloadUrl is kept in the response shape for
    // compatibility but is always null here.

    res.json({
      agreement: {
        id: agreement.id,
        inspectionId: agreement.inspectionId,
        signerName: agreement.signerName,
        documentVersion: agreement.documentVersion,
        signedAt: agreement.signedAt,
        documentObjectPath: agreement.documentObjectPath,
        downloadUrl: null,
        voidedAt: agreement.voidedAt ?? null,
        voidReason: agreement.voidReason ?? null,
        emailedAt: agreement.emailedAt ?? null,
      },
      phase: inspection.phase,
    });
  },
);

// ── DELETE /inspections/:id/agreement ─────────────────────────────────────────
// Super-admin only emergency escape hatch. Soft-voids the active signed
// agreement so the rep can collect a replacement signature. A full audit trail
// (who voided, when, why) is stored on the agreement row itself.

const VoidAgreementBody = z.object({
  /** Human-readable reason for voiding, required so the audit log is legible. */
  voidReason: z.string().min(5).max(1000),
});

router.delete(
  '/inspections/:id/agreement',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Super-admin gate — no other role may void an agreement.
    const [profile] = await db
      .select({ role: userProfilesTable.role })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, req.user.id));

    if (profile?.role !== 'super_admin') {
      res.status(403).json({ error: 'Only super_admin may void a signed agreement' });
      return;
    }

    const inspectionId = String(req.params.id);

    // Validate body
    const parsed = VoidAgreementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const { voidReason } = parsed.data;

    // Verify the inspection exists and belongs to the super_admin's company.
    // This prevents a super_admin from one tenant voiding another tenant's
    // agreement even if they obtain or guess the inspection ID.
    const [inspection] = await db
      .select({ id: inspectionsTable.id })
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, inspectionId),
          eq(inspectionsTable.companyId, req.user.companyId),
        ),
      );

    if (!inspection) {
      res.status(404).json({ error: 'Inspection not found' });
      return;
    }

    // Find the active (non-voided) agreement for this inspection, scoped to
    // the caller's company so the update predicate cannot touch another tenant.
    const [activeAgreement] = await db
      .select({ id: signedAgreementsTable.id, companyId: signedAgreementsTable.companyId })
      .from(signedAgreementsTable)
      .where(
        and(
          eq(signedAgreementsTable.inspectionId, inspectionId),
          eq(signedAgreementsTable.companyId, req.user.companyId),
          isNull(signedAgreementsTable.voidedAt),
        ),
      );

    if (!activeAgreement) {
      res.status(404).json({ error: 'No active signed agreement found for this inspection' });
      return;
    }

    // Void it — stamp voidedAt, voidedByUserId, voidReason atomically.
    // The WHERE clause pins both id and companyId so a race condition between
    // two concurrent void requests cannot cross tenant boundaries.
    const voidedAt = new Date();
    await db
      .update(signedAgreementsTable)
      .set({
        voidedAt,
        voidedByUserId: req.user.id,
        voidReason,
      })
      .where(
        and(
          eq(signedAgreementsTable.id, activeAgreement.id),
          eq(signedAgreementsTable.companyId, req.user.companyId),
        ),
      );

    req.log.info(
      { inspectionId, agreementId: activeAgreement.id, voidedByUserId: req.user.id },
      'Agreement voided by super_admin',
    );

    res.json({
      voided: true,
      agreementId: activeAgreement.id,
      voidedAt: voidedAt.toISOString(),
    });
  },
);

// ── POST /inspections/:id/agreement/email ─────────────────────────────────────
// Emails the stored signed agreement PDF to a homeowner using the rep's
// configured SMTP settings. If no SMTP is configured, returns { noSmtp: true }
// so the mobile client can fall back to the device mail composer.
// Stamps emailedAt on the agreement row when the server successfully delivers.

const EmailAgreementBody = z.object({
  recipient: z.string().min(1).max(320),
});

router.post(
  '/inspections/:id/agreement/email',
  async (req: Request, res: Response) => {
    const actor = await requireAgreementActor(req, res);
    if (!actor) return;

    const inspectionId = String(req.params.id);

    // Must be same company
    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, inspectionId),
          eq(inspectionsTable.companyId, actor.companyId),
        ),
      );

    if (!inspection) {
      res.status(404).json({ error: 'Inspection not found' });
      return;
    }

    // Write gate — only the assigned inspector or manager+ may trigger email
    if (!canWriteInspection(actor.role, actor.userId, inspection.inspectorUserId)) {
      res.status(403).json({ error: 'Not authorized to email the agreement for this inspection' });
      return;
    }

    // Validate body
    const parsed = EmailAgreementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const { recipient } = parsed.data;

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      res.status(400).json({ error: 'Invalid recipient email address' });
      return;
    }

    // Load the active (non-voided) agreement
    const [agreement] = await db
      .select()
      .from(signedAgreementsTable)
      .where(
        and(
          eq(signedAgreementsTable.inspectionId, inspectionId),
          eq(signedAgreementsTable.companyId, actor.companyId),
          isNull(signedAgreementsTable.voidedAt),
        ),
      );

    if (!agreement) {
      res.status(404).json({ error: 'No active signed agreement found for this inspection' });
      return;
    }

    // Load the rep's SMTP settings
    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, actor.userId));

    if (!profile?.smtpHost || !profile.smtpPort || !profile.smtpUsername || !profile.smtpPasswordEnc) {
      // No SMTP configured — signal to mobile so it can fall back to device
      // mail composer with the PDF attached locally.
      res.json({ noSmtp: true });
      return;
    }

    // Decrypt SMTP password
    let password: string;
    try {
      password = decryptSmtpPassword(profile.smtpPasswordEnc);
    } catch {
      res.status(400).json({ error: 'Stored SMTP password could not be read; please re-enter it' });
      return;
    }

    // SSRF guard: resolve and validate the SMTP host
    let smtpAddress: string;
    try {
      smtpAddress = await resolvePublicSmtpAddress(profile.smtpHost);
    } catch {
      res.status(400).json({ error: 'SMTP host is not a valid public mail server' });
      return;
    }

    // Download the PDF from object storage into a Buffer for the attachment
    let pdfBuffer: Buffer;
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        agreement.documentObjectPath,
      );
      const downloadResponse = await objectStorageService.downloadObject(objectFile);
      pdfBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: 'Agreement PDF not found in storage' });
        return;
      }
      req.log.error({ err }, 'Failed to download agreement PDF from object storage');
      res.status(500).json({ error: 'Could not retrieve the agreement PDF' });
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

    const propertyLabel = inspection.address ?? 'your property';
    try {
      await transport.sendMail({
        from: profile.smtpFromEmail || profile.smtpUsername,
        to: recipient,
        subject: `Forensic Inspection Purchase & Sale Agreement — ${propertyLabel}`,
        text: [
          'Thank you for signing the Forensic Inspection Purchase & Sale Agreement.',
          '',
          `Property: ${propertyLabel}`,
          `Signed by: ${agreement.signerName}`,
          `Date signed: ${agreement.signedAt.toLocaleString()}`,
          '',
          'A copy of the signed agreement is attached for your records.',
        ].join('\n'),
        attachments: [
          {
            filename: 'Signed-Agreement.pdf',
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });
    } catch (err) {
      req.log.warn({ err }, 'SMTP agreement delivery failed');
      res.status(502).json({
        error:
          'Email could not be sent. Check your SMTP settings (host, port, username, password) and try again.',
      });
      return;
    }

    // Also send a copy to the rep's own email address as a record copy.
    let repEmailed = false;
    const repEmail = req.user?.email;
    if (repEmail && repEmail !== recipient) {
      try {
        await transport.sendMail({
          from: profile.smtpFromEmail || profile.smtpUsername,
          to: repEmail,
          subject: `Your copy: Signed Agreement — ${propertyLabel}`,
          text: [
            'This is your copy of the signed agreement emailed to the homeowner.',
            '',
            `Property: ${propertyLabel}`,
            `Signed by: ${agreement.signerName}`,
            `Date signed: ${agreement.signedAt.toLocaleString()}`,
            '',
            'The signed agreement is attached for your records.',
          ].join('\n'),
          attachments: [
            {
              filename: 'Signed-Agreement.pdf',
              content: pdfBuffer,
              contentType: 'application/pdf',
            },
          ],
        });
        repEmailed = true;
      } catch (err) {
        req.log.warn({ err }, 'Failed to send rep copy of signed agreement');
      }
    }

    // Stamp emailedAt on the agreement row
    const emailedAt = new Date();
    await db
      .update(signedAgreementsTable)
      .set({ emailedAt })
      .where(
        and(
          eq(signedAgreementsTable.id, agreement.id),
          eq(signedAgreementsTable.companyId, actor.companyId),
        ),
      );

    req.log.info(
      { inspectionId, agreementId: agreement.id, recipient, repEmailed },
      'Agreement PDF emailed to homeowner',
    );

    res.json({ sent: true, emailedAt: emailedAt.toISOString(), repEmailed });
  },
);

// ── GET /documents ────────────────────────────────────────────────────────────
// Unified company-scoped document list: FIPSA agreements + Phase 1 preliminary
// reports + Phase 2 forensic reports. Field reps see only their own;
// managers/admins see the full company list. Optional ?q= searches address
// and homeowner name across all types. Returns up to 50 items per type sorted
// newest-first, then merged by date.

interface DocumentListItem {
  id: string;
  type: 'fipsa' | 'phase1' | 'phase2';
  inspectionId: string;
  propertyAddress: string | null;
  homeownerName: string | null;
  repName: string | null;
  /** ISO date string used for sorting (signedAt for FIPSA, createdAt for others). */
  date: string;
  /** Short-lived presigned URL — FIPSA only; null for report types. */
  downloadUrl: string | null;
  emailedAt: string | null;
  voidedAt: string | null;
  scheduledFor: string | null;
  /** Inspection status — useful for Phase 2 (submitted, package_ready, etc.). */
  status: string | null;
  /** FIPSA signer name, for passing to agreement-detail. */
  signerName: string | null;
}

router.get('/documents', async (req: Request, res: Response) => {
  const actor = await requireAgreementActor(req, res);
  if (!actor) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const isManager = ['manager', 'admin', 'super_admin'].includes(actor.role);

  const docs: DocumentListItem[] = [];

  // ── FIPSA agreements ────────────────────────────────────────────────────────
  {
    const conds: Parameters<typeof and>[0][] = [
      eq(signedAgreementsTable.companyId, actor.companyId),
    ];
    if (!isManager) conds.push(eq(inspectionsTable.inspectorUserId, actor.userId));
    if (q) {
      const p = `%${q}%`;
      conds.push(or(ilike(inspectionsTable.address, p), ilike(inspectionsTable.insuredName, p)));
    }
    const rows = await db
      .select({
        id: signedAgreementsTable.id,
        inspectionId: signedAgreementsTable.inspectionId,
        signerName: signedAgreementsTable.signerName,
        signedAt: signedAgreementsTable.signedAt,
        emailedAt: signedAgreementsTable.emailedAt,
        voidedAt: signedAgreementsTable.voidedAt,
        documentObjectPath: signedAgreementsTable.documentObjectPath,
        propertyAddress: inspectionsTable.address,
        homeownerName: inspectionsTable.insuredName,
        scheduledFor: inspectionsTable.scheduledFor,
        repFirstName: usersTable.firstName,
        repLastName: usersTable.lastName,
      })
      .from(signedAgreementsTable)
      .innerJoin(inspectionsTable, eq(signedAgreementsTable.inspectionId, inspectionsTable.id))
      .leftJoin(usersTable, eq(inspectionsTable.inspectorUserId, usersTable.id))
      .where(and(...conds))
      .orderBy(desc(signedAgreementsTable.signedAt))
      .limit(50);

    for (const row of rows) {
      docs.push({
        id: row.id,
        type: 'fipsa',
        inspectionId: row.inspectionId,
        propertyAddress: row.propertyAddress ?? null,
        homeownerName: row.homeownerName ?? null,
        repName: [row.repFirstName, row.repLastName].filter(Boolean).join(' ') || null,
        date: (row.signedAt as Date).toISOString(),
        downloadUrl: null,
        emailedAt: row.emailedAt ? (row.emailedAt as Date).toISOString() : null,
        voidedAt: row.voidedAt ? (row.voidedAt as Date).toISOString() : null,
        scheduledFor: row.scheduledFor ? (row.scheduledFor as Date).toISOString() : null,
        status: null,
        signerName: row.signerName,
      });
    }
  }

  // ── Helper: inspection rows by phase ────────────────────────────────────────
  const { companyId: actorCompanyId, userId: actorUserId } = actor;
  async function queryInspectionPhase(
    phase: 'preliminary' | 'forensic',
  ): Promise<DocumentListItem[]> {
    const conds: Parameters<typeof and>[0][] = [
      eq(inspectionsTable.companyId, actorCompanyId),
      eq(inspectionsTable.phase, phase),
    ];
    if (!isManager) conds.push(eq(inspectionsTable.inspectorUserId, actorUserId));
    if (q) {
      const p = `%${q}%`;
      conds.push(or(ilike(inspectionsTable.address, p), ilike(inspectionsTable.insuredName, p)));
    }
    const rows = await db
      .select({
        id: inspectionsTable.id,
        address: inspectionsTable.address,
        insuredName: inspectionsTable.insuredName,
        status: inspectionsTable.status,
        createdAt: inspectionsTable.createdAt,
        scheduledFor: inspectionsTable.scheduledFor,
        repFirstName: usersTable.firstName,
        repLastName: usersTable.lastName,
      })
      .from(inspectionsTable)
      .leftJoin(usersTable, eq(inspectionsTable.inspectorUserId, usersTable.id))
      .where(and(...conds))
      .orderBy(desc(inspectionsTable.createdAt))
      .limit(50);

    return rows.map((row) => ({
      id: row.id,
      type: phase === 'preliminary' ? ('phase1' as const) : ('phase2' as const),
      inspectionId: row.id,
      propertyAddress: row.address ?? null,
      homeownerName: row.insuredName ?? null,
      repName: [row.repFirstName, row.repLastName].filter(Boolean).join(' ') || null,
      date: row.createdAt ? (row.createdAt as Date).toISOString() : new Date(0).toISOString(),
      downloadUrl: null,
      emailedAt: null,
      voidedAt: null,
      scheduledFor: row.scheduledFor ? (row.scheduledFor as Date).toISOString() : null,
      status: row.status ?? null,
      signerName: null,
    }));
  }

  const [phase1, phase2] = await Promise.all([
    queryInspectionPhase('preliminary'),
    queryInspectionPhase('forensic'),
  ]);

  docs.push(...phase1, ...phase2);

  // Sort all types newest-first.
  docs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  res.json({ documents: docs });
});

// ── GET /agreements ───────────────────────────────────────────────────────────
// Company-scoped list of signed agreements. Managers and above see all reps'
// agreements; field reps see only their own. Optional ?q= search on address
// and homeowner name. Returns up to 100 rows, newest-first.

router.get('/agreements', async (req: Request, res: Response) => {
  const actor = await requireAgreementActor(req, res);
  if (!actor) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const isManager = ['manager', 'admin', 'super_admin'].includes(actor.role);

  // Build WHERE conditions — always company-scoped.
  const conditions: Parameters<typeof and>[0][] = [
    eq(signedAgreementsTable.companyId, actor.companyId),
  ];

  // Field reps see only their own inspection agreements.
  if (!isManager) {
    conditions.push(eq(inspectionsTable.inspectorUserId, actor.userId));
  }

  // Optional free-text search on property address or homeowner name.
  if (q) {
    const searchPattern = `%${q}%`;
    conditions.push(
      or(
        ilike(inspectionsTable.address, searchPattern),
        ilike(inspectionsTable.insuredName, searchPattern),
      ),
    );
  }

  const rows = await db
    .select({
      id: signedAgreementsTable.id,
      inspectionId: signedAgreementsTable.inspectionId,
      signerName: signedAgreementsTable.signerName,
      signedAt: signedAgreementsTable.signedAt,
      emailedAt: signedAgreementsTable.emailedAt,
      voidedAt: signedAgreementsTable.voidedAt,
      documentObjectPath: signedAgreementsTable.documentObjectPath,
      propertyAddress: inspectionsTable.address,
      homeownerName: inspectionsTable.insuredName,
      scheduledFor: inspectionsTable.scheduledFor,
      repFirstName: usersTable.firstName,
      repLastName: usersTable.lastName,
    })
    .from(signedAgreementsTable)
    .innerJoin(inspectionsTable, eq(signedAgreementsTable.inspectionId, inspectionsTable.id))
    .leftJoin(usersTable, eq(inspectionsTable.inspectorUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(signedAgreementsTable.signedAt))
    .limit(100);

  // PDFs are served through the authenticated storage proxy
  // (GET /storage/objects/*path). downloadUrl is always null here.
  const agreements = rows.map((row) => ({
    id: row.id,
    inspectionId: row.inspectionId,
    signerName: row.signerName,
    signedAt: row.signedAt,
    emailedAt: row.emailedAt ?? null,
    voidedAt: row.voidedAt ?? null,
    propertyAddress: row.propertyAddress ?? null,
    homeownerName: row.homeownerName ?? null,
    scheduledFor: row.scheduledFor ?? null,
    repName: [row.repFirstName, row.repLastName].filter(Boolean).join(' ') || null,
    downloadUrl: null,
  }));

  res.json({ agreements });
});

export default router;

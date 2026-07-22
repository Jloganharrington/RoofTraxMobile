/**
 * Agreement routes — forensic inspection homeowner signing.
 *
 * POST /inspections/:id/agreement/sign
 *   Creates a signed agreement for the inspection. One per inspection —
 *   subsequent calls return 409. Requires rep+ access (same company + own
 *   inspection or manager+), inspection module access, and the inspection to
 *   be in the forensic phase. Locked inspections are allowed (signing happens
 *   after submission).
 *
 * GET /inspections/:id/agreement
 *   Returns the signed agreement record (if any) plus a short-lived presigned
 *   download URL for the PDF.
 */

import { randomUUID } from 'crypto';
import {
  companiesTable,
  db,
  objectOwnershipTable,
  signedAgreementsTable,
  userProfilesTable,
  usersTable,
  inspectionsTable,
} from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';

import { canAccessInspectionModule, canWriteInspection } from '../lib/permissions';
import { ObjectStorageService } from '../lib/objectStorage';
import {
  AGREEMENT_DOCUMENT_VERSION,
  generateAgreementPdf,
} from '../lib/agreementPdf';

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
  /** Base64-encoded PNG of the drawn signature (no data: prefix). */
  signatureImageBase64: z.string().min(100),
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

    // Idempotency — one agreement per inspection
    const [existing] = await db
      .select({ id: signedAgreementsTable.id })
      .from(signedAgreementsTable)
      .where(eq(signedAgreementsTable.inspectionId, inspectionId));

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
    const { signerName, signatureImageBase64 } = parsed.data;

    // Look up inspector's name
    const [inspectorUser] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, inspection.inspectorUserId));

    const inspectorName =
      [inspectorUser?.firstName, inspectorUser?.lastName].filter(Boolean).join(' ')
      || inspection.inspectorUserId;

    // Company name for the agreement text
    let companyName = 'the inspection company';
    try {
      const [company] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, actor.companyId));
      if (company?.name) companyName = company.name;
    } catch {
      // Non-fatal — fallback stays
    }

    const signedAt = new Date();

    // Generate the PDF server-side
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateAgreementPdf({
        inspectionId,
        propertyAddress: inspection.address ?? 'Address not provided',
        homeownerName: signerName,
        inspectorName,
        companyName,
        signedAt,
        signatureImageBase64,
        inspectorUserId: actor.userId,
        userAgent: req.headers['user-agent'] ?? null,
      });
    } catch (err) {
      req.log.error({ err }, 'Failed to generate agreement PDF');
      res.status(500).json({ error: 'Failed to generate agreement PDF' });
      return;
    }

    // Upload PDF to object storage
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
    // The UNIQUE constraint on signed_agreements(inspection_id) is the hard
    // guard against duplicates. We catch that violation here and convert it to
    // a 409 so concurrent double-submits never return 500.
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

    res.status(201).json({
      agreement: {
        id: agreementRow.id,
        inspectionId: agreementRow.inspectionId,
        signerName: agreementRow.signerName,
        documentVersion: agreementRow.documentVersion,
        signedAt: agreementRow.signedAt,
        documentObjectPath: agreementRow.documentObjectPath,
      },
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

    const [agreement] = await db
      .select()
      .from(signedAgreementsTable)
      .where(eq(signedAgreementsTable.inspectionId, inspectionId));

    if (!agreement) {
      res.json({ agreement: null, phase: inspection.phase });
      return;
    }

    // Generate a short-lived presigned GET URL for the PDF so the mobile app
    // can open it directly in the browser without streaming through our server.
    let downloadUrl: string | null = null;
    try {
      downloadUrl = await objectStorageService.getSignedDownloadUrl(
        agreement.documentObjectPath,
        15 * 60, // 15 minutes
      );
    } catch (err) {
      req.log.warn({ err }, 'Could not generate signed download URL for agreement');
      // Non-fatal — client can still use the /storage/objects/* route
    }

    res.json({
      agreement: {
        id: agreement.id,
        inspectionId: agreement.inspectionId,
        signerName: agreement.signerName,
        documentVersion: agreement.documentVersion,
        signedAt: agreement.signedAt,
        documentObjectPath: agreement.documentObjectPath,
        downloadUrl,
      },
      phase: inspection.phase,
    });
  },
);

export default router;

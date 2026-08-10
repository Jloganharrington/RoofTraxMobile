/**
 * Completion Certificate routes
 *
 * POST   /leads/:leadId/completion-certificate/extract      AI extraction → draft
 * GET    /leads/:leadId/completion-certificate              list certs for pin
 * GET    /leads/:leadId/completion-certificate/:certId      get one cert
 * PATCH  /leads/:leadId/completion-certificate/:certId      update draft line_items
 * POST   /leads/:leadId/completion-certificate/:certId/void void a cert
 *
 * Signing (status draft → signed, PDF render, pipeline emit) is Phase C.
 */

import { Router, type Request, type Response } from 'express';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  db,
  pinsTable,
  completionCertificatesTable,
  contractsTable,
} from '@workspace/db';
import { isManagerOrAdmin } from '@workspace/authz';
import { ai as geminiAi } from '@workspace/integrations-gemini-ai';
import { ObjectStorageService } from '../lib/objectStorage';
import { getRole } from './pins';
import { logger } from '../lib/logger';
import {
  COC_EXTRACTION_SYSTEM_PROMPT,
  COC_EXTRACTION_PROMPT_VERSION,
} from '../lib/cocExtraction';

const router = Router();
const objectStorageService = new ObjectStorageService();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Fetch pin ensuring company scope; returns null if not found. */
async function fetchPin(leadId: string, companyId: string) {
  const [pin] = await db
    .select({
      id:                          pinsTable.id,
      userId:                      pinsTable.userId,
      pipelineStage:               pinsTable.pipelineStage,
      approvedEstimateObjectPath:  pinsTable.approvedEstimateObjectPath,
    })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, leadId), eq(pinsTable.companyId, companyId)))
    .limit(1);
  return pin ?? null;
}

/** Fetch cert ensuring company scope; returns null if not found. */
async function fetchCert(certId: string, companyId: string) {
  const [cert] = await db
    .select()
    .from(completionCertificatesTable)
    .where(
      and(
        eq(completionCertificatesTable.id, certId),
        eq(completionCertificatesTable.companyId, companyId),
      ),
    )
    .limit(1);
  return cert ?? null;
}

// ---------------------------------------------------------------------------
// Zod schemas for line-item structure
// ---------------------------------------------------------------------------

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity:    z.number().nullable().optional(),
  unit:        z.string().nullable().optional(),
  amountCents: z.number().int(),
});

const DroppedItemSchema = z.object({
  text:   z.string(),
  reason: z.string(),
});

const LineItemsSnapshotSchema = z.object({
  baseContract: z.array(LineItemSchema),
  pwi:          z.array(LineItemSchema),
  dropped:      z.array(DroppedItemSchema).default([]),
});

type LineItemsSnapshot = z.infer<typeof LineItemsSnapshotSchema>;

// ---------------------------------------------------------------------------
// POST /leads/:leadId/completion-certificate/extract
// ---------------------------------------------------------------------------
// Downloads the approved estimate, calls Gemini to extract line items, creates
// a draft completion_certificate row.
//
// Gate: pin must have an approved estimate on file (Phase A gate ensures this
// exists before claim_approved, but we guard here too for belt-and-suspenders).
// ---------------------------------------------------------------------------

router.post('/leads/:leadId/completion-certificate/extract', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  const leadId = req.params['leadId'] as string;
  const pin = await fetchPin(leadId, req.user.companyId);
  if (!pin) return void res.status(404).json({ error: 'Lead not found' });

  const callerRole = await getRole(req.user.id);
  if (pin.userId !== req.user.id && !isManagerOrAdmin(callerRole)) {
    return void res.status(403).json({ error: 'Forbidden' });
  }

  if (pin.pipelineStage !== 'claim_approved' && !isManagerOrAdmin(callerRole)) {
    return void res.status(422).json({
      error: 'Completion certificate extraction is only available for claim_approved pins.',
    });
  }

  if (!pin.approvedEstimateObjectPath) {
    return void res.status(422).json({
      error: 'No approved carrier estimate on file. Upload one via POST /leads/:id/approved-estimate.',
    });
  }

  // Download the approved estimate PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await objectStorageService.readObjectEntityBytes(pin.approvedEstimateObjectPath);
  } catch (err) {
    req.log.error({ err, objectPath: pin.approvedEstimateObjectPath }, 'Failed to download approved estimate');
    return void res.status(500).json({ error: 'Failed to retrieve approved estimate from storage' });
  }

  const pdfBase64 = pdfBuffer.toString('base64');

  // Find the most recently signed contract for this pin (for the contractId FK)
  const [contract] = await db
    .select({ id: contractsTable.id })
    .from(contractsTable)
    .where(
      and(
        eq(contractsTable.pinId, leadId),
        eq(contractsTable.companyId, req.user.companyId),
      ),
    )
    .orderBy(desc(contractsTable.createdAt))
    .limit(1);

  // Call Gemini with the PDF + system prompt
  let rawJson: string;
  try {
    const response = await geminiAi.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
            { text: COC_EXTRACTION_SYSTEM_PROMPT },
          ],
        },
      ],
      config: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
    });
    rawJson = response.text ?? '';
  } catch (err) {
    req.log.error({ err }, 'COC extraction: Gemini call failed');
    return void res.status(502).json({ error: 'AI extraction failed. Please try again.' });
  }

  // Parse and validate Gemini output
  let snapshot: LineItemsSnapshot;
  try {
    const cleaned = rawJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    snapshot = LineItemsSnapshotSchema.parse(parsed);
  } catch (err) {
    req.log.error({ err, rawJson: rawJson.slice(0, 500) }, 'COC extraction: AI response parse failed');
    return void res.status(502).json({
      error: 'AI extraction returned an unexpected format. Please try again.',
    });
  }

  // Create the draft completion_certificate row
  const certId = randomUUID();
  await db.insert(completionCertificatesTable).values({
    id:                certId,
    companyId:         req.user.companyId,
    pinId:             leadId,
    contractId:        contract?.id ?? null,
    status:            'draft',
    lineItems:         snapshot as Record<string, unknown>,
    createdByUserId:   req.user.id,
  });

  const [cert] = await db
    .select()
    .from(completionCertificatesTable)
    .where(eq(completionCertificatesTable.id, certId));

  logger.info(
    {
      certId,
      pinId: leadId,
      baseCount:   snapshot.baseContract.length,
      pwiCount:    snapshot.pwi.length,
      droppedCount: snapshot.dropped.length,
      promptVersion: COC_EXTRACTION_PROMPT_VERSION,
    },
    'COC extraction: draft created',
  );

  return void res.status(201).json({ certificate: cert, dropped: snapshot.dropped });
});

// ---------------------------------------------------------------------------
// GET /leads/:leadId/completion-certificate
// ---------------------------------------------------------------------------

router.get('/leads/:leadId/completion-certificate', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  const leadId = req.params['leadId'] as string;
  const pin = await fetchPin(leadId, req.user.companyId);
  if (!pin) return void res.status(404).json({ error: 'Lead not found' });

  const certs = await db
    .select()
    .from(completionCertificatesTable)
    .where(
      and(
        eq(completionCertificatesTable.pinId, leadId),
        eq(completionCertificatesTable.companyId, req.user.companyId),
      ),
    )
    .orderBy(desc(completionCertificatesTable.createdAt));

  return void res.json({ certificates: certs });
});

// ---------------------------------------------------------------------------
// GET /leads/:leadId/completion-certificate/:certId
// ---------------------------------------------------------------------------

router.get('/leads/:leadId/completion-certificate/:certId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  const leadId = req.params['leadId'] as string;
  const certId = req.params['certId'] as string;

  const cert = await fetchCert(certId, req.user.companyId);
  if (!cert || cert.pinId !== leadId) return void res.status(404).json({ error: 'Certificate not found' });

  return void res.json({ certificate: cert });
});

// ---------------------------------------------------------------------------
// PATCH /leads/:leadId/completion-certificate/:certId
// ---------------------------------------------------------------------------
// Update line_items on a draft certificate. Only works while status = 'draft'.
// Amounts are editable by the signer before signing; edits overwrite the
// snapshot. Signed or voided certificates are immutable.
// ---------------------------------------------------------------------------

const UpdateCertBody = z.object({
  lineItems: LineItemsSnapshotSchema,
});

router.patch('/leads/:leadId/completion-certificate/:certId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  const leadId = req.params['leadId'] as string;
  const certId = req.params['certId'] as string;

  const cert = await fetchCert(certId, req.user.companyId);
  if (!cert || cert.pinId !== leadId) return void res.status(404).json({ error: 'Certificate not found' });

  if (cert.status !== 'draft') {
    return void res.status(409).json({
      error: `Certificate is ${cert.status} and can no longer be edited. Void it and extract again to start a new draft.`,
    });
  }

  const callerRole = await getRole(req.user.id);
  if (!isManagerOrAdmin(callerRole)) {
    return void res.status(403).json({ error: 'Only managers and admins may update a completion certificate' });
  }

  const parsed = UpdateCertBody.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  await db
    .update(completionCertificatesTable)
    .set({
      lineItems:  parsed.data.lineItems as Record<string, unknown>,
      updatedAt:  new Date(),
    })
    .where(eq(completionCertificatesTable.id, certId));

  const [updated] = await db
    .select()
    .from(completionCertificatesTable)
    .where(eq(completionCertificatesTable.id, certId));

  return void res.json({ certificate: updated });
});

// ---------------------------------------------------------------------------
// POST /leads/:leadId/completion-certificate/:certId/void
// ---------------------------------------------------------------------------
// Manager+ only. Sets status to 'voided'. The original snapshot is preserved.
// Issue a new extraction to start a corrected draft.
// ---------------------------------------------------------------------------

router.post('/leads/:leadId/completion-certificate/:certId/void', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: 'Unauthorized' });

  const leadId = req.params['leadId'] as string;
  const certId = req.params['certId'] as string;

  const cert = await fetchCert(certId, req.user.companyId);
  if (!cert || cert.pinId !== leadId) return void res.status(404).json({ error: 'Certificate not found' });

  if (cert.status === 'voided') {
    return void res.status(409).json({ error: 'Certificate is already voided' });
  }

  const callerRole = await getRole(req.user.id);
  if (!isManagerOrAdmin(callerRole)) {
    return void res.status(403).json({ error: 'Only managers and admins may void a completion certificate' });
  }

  await db
    .update(completionCertificatesTable)
    .set({ status: 'voided', updatedAt: new Date() })
    .where(eq(completionCertificatesTable.id, certId));

  const [voided] = await db
    .select()
    .from(completionCertificatesTable)
    .where(eq(completionCertificatesTable.id, certId));

  return void res.json({ certificate: voided });
});

export default router;

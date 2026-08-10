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
import { randomUUID, createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import {
  db,
  pinsTable,
  completionCertificatesTable,
  contractsTable,
  usersTable,
  userProfilesTable,
  changeOrdersTable,
  companiesTable,
} from '@workspace/db';
import { isManagerOrAdmin, canSignCompletionCertificate } from '@workspace/authz';
import { requirePermission } from '../middlewares/requirePermission';
import { ai as geminiAi } from '@workspace/integrations-gemini-ai';
import { ObjectStorageService } from '../lib/objectStorage';
import { getRole } from './pins';
import { logger } from '../lib/logger';
import {
  COC_EXTRACTION_SYSTEM_PROMPT,
  COC_EXTRACTION_PROMPT_VERSION,
} from '../lib/cocExtraction';
import { emitPipelineEvent } from './pipelineEvents';

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

// coc.create
router.post('/leads/:leadId/completion-certificate/extract', requirePermission('coc.create'), async (req: Request, res: Response) => {

  const leadId = req.params['leadId'] as string;
  const pin = await fetchPin(leadId, req.actorCtx!.companyId);
  if (!pin) return void res.status(404).json({ error: 'Lead not found' });

  const callerRole = await getRole(req.actorCtx!.actorId);
  if (pin.userId !== req.actorCtx!.actorId && !isManagerOrAdmin(callerRole)) {
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
        eq(contractsTable.companyId, req.actorCtx!.companyId),
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
    companyId:         req.actorCtx!.companyId,
    pinId:             leadId,
    contractId:        contract?.id ?? null,
    status:            'draft',
    lineItems:         snapshot as Record<string, unknown>,
    createdByUserId:   req.actorCtx!.actorId,
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

// coc.read
router.get('/leads/:leadId/completion-certificate', requirePermission('coc.read'), async (req: Request, res: Response) => {

  const leadId = req.params['leadId'] as string;
  const pin = await fetchPin(leadId, req.actorCtx!.companyId);
  if (!pin) return void res.status(404).json({ error: 'Lead not found' });

  const certs = await db
    .select()
    .from(completionCertificatesTable)
    .where(
      and(
        eq(completionCertificatesTable.pinId, leadId),
        eq(completionCertificatesTable.companyId, req.actorCtx!.companyId),
      ),
    )
    .orderBy(desc(completionCertificatesTable.createdAt));

  return void res.json({ certificates: certs });
});

// ---------------------------------------------------------------------------
// GET /leads/:leadId/completion-certificate/:certId
// ---------------------------------------------------------------------------

// coc.read
router.get('/leads/:leadId/completion-certificate/:certId', requirePermission('coc.read'), async (req: Request, res: Response) => {

  const leadId = req.params['leadId'] as string;
  const certId = req.params['certId'] as string;

  const cert = await fetchCert(certId, req.actorCtx!.companyId);
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

// coc.create
router.patch('/leads/:leadId/completion-certificate/:certId', requirePermission('coc.create'), async (req: Request, res: Response) => {

  const leadId = req.params['leadId'] as string;
  const certId = req.params['certId'] as string;

  const cert = await fetchCert(certId, req.actorCtx!.companyId);
  if (!cert || cert.pinId !== leadId) return void res.status(404).json({ error: 'Certificate not found' });

  if (cert.status !== 'draft') {
    return void res.status(409).json({
      error: `Certificate is ${cert.status} and can no longer be edited. Void it and extract again to start a new draft.`,
    });
  }

  const callerRole = await getRole(req.actorCtx!.actorId);
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
// POST /leads/:leadId/completion-certificate/:certId/sign
// ---------------------------------------------------------------------------
// Locks the cert, generates the COC PDF, emits completion_package_generated.
//
// Gate: cert must be 'draft'.
// Gate: caller must have canSignCompletionCertificate (manager+ OR office dept).
//
// Accepts: { signerTitle?: string }
//   signerTitle  — overrides the caller's stored user_profiles.title for this
//                  specific signing. If omitted and no title is on file the
//                  line is left blank on the PDF.
// ---------------------------------------------------------------------------

const SignCertBody = z.object({
  signerTitle: z.string().max(120).optional(),
});

/** Format integer cents as "$1,234.56" */
function fmtCents(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface CocLineItem { description: string; quantity?: number | null; unit?: string | null; amountCents: number }

async function generateCocPdfBuffer(opts: {
  companyName: string;
  propertyAddress: string | null;
  ownerName: string;
  baseContract: CocLineItem[];
  carrierCos: Array<{ description: string; amountCents: number }>;
  pwi: CocLineItem[];
  signerFullName: string;
  signerTitle: string;
  signedAt: Date;
}): Promise<Buffer> {
  const { companyName, propertyAddress, ownerName, baseContract, carrierCos, pwi, signerFullName, signerTitle, signedAt } = opts;
  const dateStr = signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks: Uint8Array[] = [];
    doc.on('data', (c: Uint8Array) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 100;
    const L = 50;

    // ── Header ─────────────────────────────────────────────────────────────
    doc.fontSize(16).font('Helvetica-Bold').text(companyName, L, 50);
    doc.fontSize(9).font('Helvetica').text(`Date: ${dateStr}`, L, 54, { align: 'right', width: W });
    doc.moveDown(0.4);
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor('#999999').stroke().strokeColor('black');
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').text('COMPLETION CERTIFICATE', L, doc.y, { align: 'center', width: W });
    doc.moveDown(0.6);

    if (propertyAddress) {
      doc.fontSize(9).font('Helvetica-Bold').text('Property:', L, doc.y, { continued: true }).font('Helvetica').text(`  ${propertyAddress}`);
    }
    if (ownerName) {
      doc.fontSize(9).font('Helvetica-Bold').text('Owner:', L, doc.y, { continued: true }).font('Helvetica').text(`  ${ownerName}`);
    }
    doc.moveDown(0.8);

    const cols = [W * 0.50, W * 0.10, W * 0.10, W * 0.30];

    const renderSection = (title: string, items: CocLineItem[], subtotalLabel: string): number => {
      doc.fontSize(10).font('Helvetica-Bold').text(title, L);
      doc.moveDown(0.3);
      let hx = L;
      ['Description', 'Qty', 'Unit', 'Amount'].forEach((h, i) => {
        doc.fontSize(7.5).font('Helvetica-Bold').text(h, hx, doc.y, { width: cols[i], continued: i < 3, align: i === 3 ? 'right' : 'left' });
        hx += cols[i];
      });
      doc.moveDown(0.15);
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
      doc.moveDown(0.15);
      let total = 0;
      items.forEach(item => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(7.5);
        doc.text(item.description.slice(0, 80), L, y, { width: cols[0] });
        doc.text(item.quantity != null ? String(item.quantity) : '', L + cols[0], y, { width: cols[1], align: 'right' });
        doc.text(item.unit ?? '', L + cols[0] + cols[1], y, { width: cols[2] });
        doc.text(fmtCents(item.amountCents), L + cols[0] + cols[1] + cols[2], y, { width: cols[3], align: 'right' });
        total += item.amountCents;
        doc.moveDown(0.45);
      });
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
      doc.moveDown(0.15);
      doc.font('Helvetica-Bold').fontSize(8).text(`${subtotalLabel}: ${fmtCents(total)}`, L, doc.y, { align: 'right', width: W });
      doc.moveDown(0.7);
      return total;
    };

    const baseCents = renderSection('SECTION 1 — WORK COMPLETED (CARRIER-APPROVED SCOPE)', baseContract, 'RCV SUBTOTAL');

    let cosCents = 0;
    if (carrierCos.length > 0) {
      doc.fontSize(10).font('Helvetica-Bold').text('SECTION 2 — CARRIER-REIMBURSABLE CHANGE ORDERS', L);
      doc.moveDown(0.3);
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
      doc.moveDown(0.15);
      carrierCos.forEach(co => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(7.5);
        doc.text(co.description.slice(0, 80), L, y, { width: W * 0.70 });
        doc.text(fmtCents(co.amountCents), L + W * 0.70, y, { width: W * 0.30, align: 'right' });
        cosCents += co.amountCents;
        doc.moveDown(0.45);
      });
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
      doc.moveDown(0.15);
      doc.font('Helvetica-Bold').fontSize(8).text(`CHANGE ORDER SUBTOTAL: ${fmtCents(cosCents)}`, L, doc.y, { align: 'right', width: W });
      doc.moveDown(0.7);
    }

    const pwiCents = renderSection('SECTION 3 — PRIVATE WORK ITEMS (HOMEOWNER RESPONSIBILITY)', pwi, 'PWI SUBTOTAL');

    // Grand total
    const grandTotal = baseCents + cosCents + pwiCents;
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor('#333333').lineWidth(2).stroke().strokeColor('black').lineWidth(1);
    doc.moveDown(0.2);
    doc.fontSize(11).font('Helvetica-Bold').text(`GRAND TOTAL: ${fmtCents(grandTotal)}`, L, doc.y, { align: 'right', width: W });
    doc.moveDown(1);

    // Signature block
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor('#999999').stroke().strokeColor('black');
    doc.moveDown(0.4);
    doc.fontSize(9).font('Helvetica').text(`Completed and certified by: `, L, doc.y, { continued: true }).font('Helvetica-Bold').text(signerFullName);
    if (signerTitle) {
      doc.font('Helvetica').fontSize(9).text(`Title: ${signerTitle}`, L);
    }
    doc.font('Helvetica').fontSize(9).text(`Date: ${dateStr}`, L);
    doc.moveDown(0.8);
    doc.moveTo(L, doc.y).lineTo(L + 200, doc.y).strokeColor('#999999').stroke().strokeColor('black');
    doc.fontSize(8).font('Helvetica').text('Authorized Signature', L, doc.y + 3);

    doc.end();
  });
}

// coc.sign
router.post('/leads/:leadId/completion-certificate/:certId/sign', requirePermission('coc.sign'), async (req: Request, res: Response) => {

  const leadId = req.params['leadId'] as string;
  const certId = req.params['certId'] as string;

  const cert = await fetchCert(certId, req.actorCtx!.companyId);
  if (!cert || cert.pinId !== leadId) return void res.status(404).json({ error: 'Certificate not found' });

  if (cert.status !== 'draft') {
    return void res.status(409).json({
      error: `Certificate is ${cert.status} and can no longer be signed. Void it and extract again to start a new draft.`,
    });
  }

  // Capability gate
  const callerRole = await getRole(req.actorCtx!.actorId);
  const [callerProfile] = await db
    .select({ title: userProfilesTable.title, department: userProfilesTable.department })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.actorCtx!.actorId));

  if (!callerProfile || !canSignCompletionCertificate(callerRole, callerProfile.department)) {
    return void res.status(403).json({
      error: 'Only managers, admins, and office-department staff may sign a completion certificate',
    });
  }

  const parsed = SignCertBody.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  // Resolve signer title: body > profile > blank
  const signerTitle = parsed.data.signerTitle ?? callerProfile.title ?? '';

  // Fetch signer full name
  const [signerUser] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, req.actorCtx!.actorId));
  const signerFullName = [signerUser?.firstName, signerUser?.lastName].filter(Boolean).join(' ');

  // Fetch pin + company for PDF header
  const [pin] = await db
    .select({
      address: pinsTable.address,
      ownerFirstName: pinsTable.ownerFirstName,
      ownerLastName: pinsTable.ownerLastName,
      customerName: pinsTable.customerName,
      companyId: pinsTable.companyId,
    })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, leadId), eq(pinsTable.companyId, req.actorCtx!.companyId)));

  const [company] = await db
    .select({ name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, req.actorCtx!.companyId));

  // Fetch carrier-reimbursable approved change orders for this pin
  const carrierCos = await db
    .select({ description: changeOrdersTable.description, amountCents: changeOrdersTable.amountCents })
    .from(changeOrdersTable)
    .where(
      and(
        eq(changeOrdersTable.pinId, leadId),
        eq(changeOrdersTable.companyId, req.actorCtx!.companyId),
        eq(changeOrdersTable.carrierReimbursable, true),
        eq(changeOrdersTable.status, 'approved'),
      ),
    );

  // Extract line items from the cert snapshot
  const snapshot = cert.lineItems as { baseContract?: CocLineItem[]; pwi?: CocLineItem[] } | null;
  const baseContract: CocLineItem[] = snapshot?.baseContract ?? [];
  const pwi: CocLineItem[] = snapshot?.pwi ?? [];

  const ownerName = [pin?.ownerFirstName, pin?.ownerLastName].filter(Boolean).join(' ')
    || pin?.customerName
    || '';

  const signedAt = new Date();

  // Generate PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateCocPdfBuffer({
      companyName: company?.name ?? 'Completion Certificate',
      propertyAddress: pin?.address ?? null,
      ownerName,
      baseContract,
      carrierCos,
      pwi,
      signerFullName,
      signerTitle,
      signedAt,
    });
  } catch (err) {
    req.log.error({ err }, 'COC sign: PDF generation failed');
    return void res.status(500).json({ error: 'PDF generation failed. Please try again.' });
  }

  // sha256 + upload
  const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
  const objectPath = await objectStorageService.uploadObjectBuffer(pdfBuffer, 'application/pdf');

  // Stamp the cert as signed
  await db
    .update(completionCertificatesTable)
    .set({
      status:               'signed',
      documentObjectPath:   objectPath,
      documentSha256:       sha256,
      signedByUserId:       req.actorCtx!.actorId,
      signedAt:             signedAt,
      signerTitle:          signerTitle || null,
      updatedAt:            new Date(),
    })
    .where(eq(completionCertificatesTable.id, certId));

  const [signed] = await db
    .select()
    .from(completionCertificatesTable)
    .where(eq(completionCertificatesTable.id, certId));

  // Emit pipeline event — completion_package_generated auto-advances to 'complete'
  await emitPipelineEvent({
    companyId: req.actorCtx!.companyId,
    eventType: 'completion_package_generated',
    leadId,
  });

  logger.info({ certId, pinId: leadId, signerTitle, sha256 }, 'COC signed and pipeline event emitted');

  return void res.status(200).json({ certificate: signed });
});

// ---------------------------------------------------------------------------
// POST /leads/:leadId/completion-certificate/:certId/void
// ---------------------------------------------------------------------------
// Manager+ only. Sets status to 'voided'. The original snapshot is preserved.
// Issue a new extraction to start a corrected draft.
// ---------------------------------------------------------------------------

// coc.create
router.post('/leads/:leadId/completion-certificate/:certId/void', requirePermission('coc.create'), async (req: Request, res: Response) => {

  const leadId = req.params['leadId'] as string;
  const certId = req.params['certId'] as string;

  const cert = await fetchCert(certId, req.actorCtx!.companyId);
  if (!cert || cert.pinId !== leadId) return void res.status(404).json({ error: 'Certificate not found' });

  if (cert.status === 'voided') {
    return void res.status(409).json({ error: 'Certificate is already voided' });
  }

  const callerRole = await getRole(req.actorCtx!.actorId);
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

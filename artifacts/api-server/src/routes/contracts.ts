/**
 * Contract Builder — authenticated endpoints (migration 036).
 *
 *   GET    /pins/:pinId/contracts                    list all contracts for a pin
 *   POST   /pins/:pinId/contracts                    create draft (auto-generates access_code)
 *   GET    /contracts/:contractId                    full detail
 *   PATCH  /contracts/:contractId                    update draft/sent fields (signed = immutable)
 *   POST   /contracts/:contractId/scope-packages     add scope package (draft/sent only)
 *   PATCH  /contracts/:contractId/scope-packages/:pkgId   update package (draft/sent)
 *   DELETE /contracts/:contractId/scope-packages/:pkgId   remove package (draft only)
 *   POST   /contracts/:contractId/send               draft→sent; activates access code; emails homeowner
 *   POST   /contracts/:contractId/generate-document  generate/regenerate PDF
 *   POST   /contracts/:contractId/void               manager+; reason required; clears pin write-back
 *   GET    /pins/:pinId/inspection-estimate           latest inspection estimate total for prefill
 *
 * Security invariants:
 *   - company_id and pin_id are never client-settable on PATCH.
 *   - betterments_cents and total_contract_cents are DERIVED — never accepted from a client.
 *   - Signed contracts are IMMUTABLE: no edits, only void (manager+, reason required).
 *   - Void clears pins.contract_amount and pins.betterments_amount_cents if signed.
 */

import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { ObjectStorageService } from '../lib/objectStorage';
import { generatePortalAccessCode } from '../lib/portalAccess';
import { recomputeContractTotals } from '../lib/contractTotals';
import { generateContractPdf } from '../lib/contractPdf';
import { decryptSmtpPassword } from '../lib/smtpCrypto';
import { resolvePublicSmtpAddress } from '../lib/smtpGuard';
import {
  db,
  contractsTable,
  contractScopePackagesTable,
  contractSelectionsTable,
  selectionCategoriesTable,
  pinsTable,
  userProfilesTable,
  inspectionsTable,
} from '@workspace/db';
import { isManagerOrAdmin, type Role } from '@workspace/authz';
import { requirePermission } from '../middlewares/requirePermission';
import { notify } from '../lib/notify';

const objectStorage = new ObjectStorageService();
const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveContract(contractId: string, companyId: string) {
  const [row] = await db
    .select()
    .from(contractsTable)
    .where(and(eq(contractsTable.id, contractId), eq(contractsTable.companyId, companyId)));
  return row ?? null;
}

async function fetchPackages(contractId: string) {
  return db
    .select({ pkg: contractScopePackagesTable, categoryName: selectionCategoriesTable.name })
    .from(contractScopePackagesTable)
    .innerJoin(
      selectionCategoriesTable,
      eq(contractScopePackagesTable.categoryId, selectionCategoriesTable.id),
    )
    .where(eq(contractScopePackagesTable.contractId, contractId))
    .orderBy(asc(contractScopePackagesTable.sortOrder));
}

async function fetchSelections(contractId: string) {
  return db
    .select()
    .from(contractSelectionsTable)
    .where(eq(contractSelectionsTable.contractId, contractId));
}

function contractShape(
  c: typeof contractsTable.$inferSelect,
  packages: Awaited<ReturnType<typeof fetchPackages>>,
  selections: (typeof contractSelectionsTable.$inferSelect)[],
) {
  const selByPkg = new Map(selections.map((s) => [s.scopePackageId, s]));
  return {
    id:                     c.id,
    companyId:              c.companyId,
    pinId:                  c.pinId,
    // Only expose the access code once sent
    accessCode:             c.status === 'sent' ? c.accessCode : null,
    accessCodeExpiresAt:    c.accessCodeExpiresAt?.toISOString() ?? null,
    status:                 c.status,
    sentAt:                 c.sentAt?.toISOString() ?? null,
    coveredScopeCents:      c.coveredScopeCents,
    bettermentsCents:       c.bettermentsCents,
    deductibleCents:        c.deductibleCents,
    totalContractCents:     c.totalContractCents,
    scopeSummary:           c.scopeSummary ?? null,
    scopeSource:            c.scopeSource ?? null,
    templateId:             c.templateId ?? null,
    documentObjectPath:     c.documentObjectPath ?? null,
    documentSha256:         c.documentSha256 ?? null,
    customerSignedAt:       c.customerSignedAt?.toISOString() ?? null,
    customerPrintName:      c.customerPrintName ?? null,
    repSignedAt:            c.repSignedAt?.toISOString() ?? null,
    voidedAt:               c.voidedAt?.toISOString() ?? null,
    voidedByUserId:         c.voidedByUserId ?? null,
    voidReason:             c.voidReason ?? null,
    createdByUserId:        c.createdByUserId,
    createdAt:              c.createdAt.toISOString(),
    updatedAt:              c.updatedAt.toISOString(),
    scopePackages: packages.map(({ pkg, categoryName }) => ({
      id:                  pkg.id,
      categoryId:          pkg.categoryId,
      categoryName,
      quantity:            String(pkg.quantity),
      unit:                pkg.unit,
      coveredAmountCents:  pkg.coveredAmountCents,
      sortOrder:           pkg.sortOrder,
      selection:           selectionShape(selByPkg.get(pkg.id) ?? null),
    })),
  };
}

function selectionShape(s: typeof contractSelectionsTable.$inferSelect | null) {
  if (!s) return null;
  return {
    id:                  s.id,
    productId:           s.productId,
    optionId:            s.optionId ?? null,
    productName:         s.productName,
    brandName:           s.brandName,
    optionName:          s.optionName ?? null,
    unitDeltaCents:      s.unitDeltaCents,
    quantity:            String(s.quantity),
    extendedDeltaCents:  s.extendedDeltaCents,
    selectedBy:          s.selectedBy,
    selectedAt:          s.selectedAt.toISOString(),
  };
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateContractBody = z.object({
  coveredScopeCents: z.number().int().min(0).default(0),
  deductibleCents:   z.number().int().min(0).default(0),
  scopeSummary:      z.string().optional(),
  scopeSource:       z.enum(['estimate', 'manual']).optional(),
  templateId:        z.string().optional(),
}).strict();

const UpdateContractBody = z.object({
  coveredScopeCents: z.number().int().min(0).optional(),
  deductibleCents:   z.number().int().min(0).optional(),
  scopeSummary:      z.string().nullable().optional(),
  scopeSource:       z.enum(['estimate', 'manual']).nullable().optional(),
  templateId:        z.string().nullable().optional(),
}).strict();

const CreateScopePackageBody = z.object({
  categoryId:          z.string().min(1),
  quantity:            z.number().positive(),
  unit:                z.string().min(1),
  coveredAmountCents:  z.number().int().min(0).default(0),
  sortOrder:           z.number().int().default(0),
}).strict();

const UpdateScopePackageBody = z.object({
  quantity:            z.number().positive().optional(),
  unit:                z.string().min(1).optional(),
  coveredAmountCents:  z.number().int().min(0).optional(),
  sortOrder:           z.number().int().optional(),
}).strict();

const VoidContractBody = z.object({
  voidReason: z.string().min(1),
}).strict();

// ── GET /pins/:pinId/inspection-estimate ──────────────────────────────────────
// Returns the latest inspection estimate subtotalCents for the pin,
// for use as a prefill when creating a new contract.

// contract.read
router.get('/pins/:pinId/inspection-estimate', requirePermission('contract.read'), async (req: Request, res: Response) => {

  const pinId = req.params.pinId as string;

  // Verify pin belongs to this company
  const [pin] = await db
    .select({ id: pinsTable.id })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.actorCtx!.companyId)));
  if (!pin) { res.status(404).json({ error: 'Lead not found' }); return; }

  // Fetch the most recent inspection with a non-null estimate
  const [inspection] = await db
    .select({ estimate: inspectionsTable.estimate })
    .from(inspectionsTable)
    .where(eq(inspectionsTable.pinId, pinId))
    .orderBy(desc(inspectionsTable.createdAt))
    .limit(10); // Look at up to 10 inspections; pick first with an estimate below

  if (!inspection || !inspection.estimate) {
    res.json({ coveredScopeCents: null, source: null });
    return;
  }

  // The estimate jsonb has shape: { subtotalCents: number, ... }
  const est = inspection.estimate as { subtotalCents?: number } | null;
  const subtotalCents = typeof est?.subtotalCents === 'number' ? est.subtotalCents : null;

  res.json({ coveredScopeCents: subtotalCents, source: subtotalCents !== null ? 'estimate' : null });
});

// ── GET /pins/:pinId/contracts ────────────────────────────────────────────────

// contract.read
router.get('/pins/:pinId/contracts', requirePermission('contract.read'), async (req: Request, res: Response) => {

  const contracts = await db
    .select()
    .from(contractsTable)
    .where(
      and(
        eq(contractsTable.pinId, req.params.pinId as string),
        eq(contractsTable.companyId, req.actorCtx!.companyId),
      ),
    )
    .orderBy(asc(contractsTable.createdAt));

  const results = await Promise.all(
    contracts.map(async (c) => {
      const [pkgs, sels] = await Promise.all([fetchPackages(c.id), fetchSelections(c.id)]);
      return contractShape(c, pkgs, sels);
    }),
  );

  res.json({ contracts: results });
});

// ── POST /pins/:pinId/contracts ───────────────────────────────────────────────

// contract.create
router.post('/pins/:pinId/contracts', requirePermission('contract.create'), async (req: Request, res: Response) => {

  const parsed = CreateContractBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const pinId = req.params.pinId as string;

  // Verify pin belongs to this company
  const [pin] = await db
    .select({ id: pinsTable.id })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.actorCtx!.companyId)));
  if (!pin) { res.status(404).json({ error: 'Lead not found' }); return; }

  // Enforce one-active-per-pin (the unique index enforces this at DB level too)
  const [existing] = await db
    .select({ id: contractsTable.id })
    .from(contractsTable)
    .where(and(eq(contractsTable.pinId, pinId), isNull(contractsTable.voidedAt)));
  if (existing) {
    res.status(409).json({ error: 'A live contract already exists for this lead. Void it first to create a replacement.' });
    return;
  }

  const accessCode = generatePortalAccessCode();
  const [contract] = await db
    .insert(contractsTable)
    .values({
      companyId:         req.actorCtx!.companyId,
      pinId,
      accessCode,
      status:            'draft',
      coveredScopeCents: parsed.data.coveredScopeCents,
      deductibleCents:   parsed.data.deductibleCents,
      bettermentsCents:  0,
      totalContractCents: parsed.data.coveredScopeCents,
      scopeSummary:      parsed.data.scopeSummary ?? null,
      scopeSource:       parsed.data.scopeSource ?? null,
      templateId:        parsed.data.templateId ?? null,
      createdByUserId:   req.actorCtx!.actorId,
    })
    .returning();

  res.status(201).json({ contract: contractShape(contract!, [], []) });
});

// ── GET /contracts/:contractId ────────────────────────────────────────────────

// contract.read
router.get('/contracts/:contractId', requirePermission('contract.read'), async (req: Request, res: Response) => {

  const contract = await resolveContract(req.params.contractId as string, req.actorCtx!.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }

  const [pkgs, sels] = await Promise.all([fetchPackages(contract.id), fetchSelections(contract.id)]);
  res.json({ contract: contractShape(contract, pkgs, sels) });
});

// ── PATCH /contracts/:contractId ──────────────────────────────────────────────

// contract.select
router.patch('/contracts/:contractId', requirePermission('contract.select'), async (req: Request, res: Response) => {

  const contract = await resolveContract(req.params.contractId as string, req.actorCtx!.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
  if (contract.status === 'signed') { res.status(409).json({ error: 'Signed contracts are immutable; use the change-order flow' }); return; }
  if (contract.status === 'voided') { res.status(409).json({ error: 'Voided contracts cannot be edited' }); return; }

  const parsed = UpdateContractBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updates: Partial<typeof contractsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.coveredScopeCents !== undefined) updates.coveredScopeCents = parsed.data.coveredScopeCents;
  if (parsed.data.deductibleCents   !== undefined) updates.deductibleCents   = parsed.data.deductibleCents;
  if ('scopeSummary' in parsed.data) updates.scopeSummary = parsed.data.scopeSummary ?? null;
  if ('scopeSource'  in parsed.data) updates.scopeSource  = parsed.data.scopeSource  ?? null;
  if ('templateId'   in parsed.data) updates.templateId   = parsed.data.templateId   ?? null;

  // Recompute total if covered scope changed
  if (parsed.data.coveredScopeCents !== undefined) {
    updates.totalContractCents = parsed.data.coveredScopeCents + contract.bettermentsCents;
  }

  const [updated] = await db
    .update(contractsTable)
    .set(updates)
    .where(eq(contractsTable.id, contract.id))
    .returning();

  const [pkgs, sels] = await Promise.all([fetchPackages(contract.id), fetchSelections(contract.id)]);
  res.json({ contract: contractShape(updated!, pkgs, sels) });
});

// ── POST /contracts/:contractId/scope-packages ────────────────────────────────

// contract.select
router.post('/contracts/:contractId/scope-packages', requirePermission('contract.select'), async (req: Request, res: Response) => {

  const contract = await resolveContract(req.params.contractId as string, req.actorCtx!.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
  if (contract.status === 'signed') { res.status(409).json({ error: 'Signed contracts are immutable; use the change-order flow' }); return; }
  if (contract.status === 'voided') { res.status(409).json({ error: 'Cannot edit voided contract' }); return; }

  const parsed = CreateScopePackageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Verify category belongs to this company
  const [cat] = await db
    .select({ id: selectionCategoriesTable.id })
    .from(selectionCategoriesTable)
    .where(
      and(
        eq(selectionCategoriesTable.id, parsed.data.categoryId),
        eq(selectionCategoriesTable.companyId, req.actorCtx!.companyId),
      ),
    );
  if (!cat) { res.status(400).json({ error: 'Selection category not found' }); return; }

  const [pkg] = await db
    .insert(contractScopePackagesTable)
    .values({
      companyId:           req.actorCtx!.companyId,
      contractId:          contract.id,
      categoryId:          parsed.data.categoryId,
      quantity:            String(parsed.data.quantity),
      unit:                parsed.data.unit,
      coveredAmountCents:  parsed.data.coveredAmountCents,
      sortOrder:           parsed.data.sortOrder,
    })
    .returning();

  res.status(201).json({ scopePackage: { ...pkg!, categoryName: cat.id } });
});

// ── PATCH /contracts/:contractId/scope-packages/:pkgId ────────────────────────

// contract.select
router.patch(
  '/contracts/:contractId/scope-packages/:pkgId',
  requirePermission('contract.select'),
  async (req: Request, res: Response) => {
  
    const contract = await resolveContract(req.params.contractId as string, req.actorCtx!.companyId);
    if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
    if (contract.status === 'signed') { res.status(409).json({ error: 'Signed contracts are immutable; use the change-order flow' }); return; }
    if (contract.status === 'voided') { res.status(409).json({ error: 'Cannot edit voided contract' }); return; }

    const parsed = UpdateScopePackageBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

    const updates: Partial<typeof contractScopePackagesTable.$inferInsert> = {};
    if (parsed.data.quantity           !== undefined) updates.quantity           = String(parsed.data.quantity);
    if (parsed.data.unit               !== undefined) updates.unit               = parsed.data.unit;
    if (parsed.data.coveredAmountCents !== undefined) updates.coveredAmountCents = parsed.data.coveredAmountCents;
    if (parsed.data.sortOrder          !== undefined) updates.sortOrder          = parsed.data.sortOrder;

    const [updated] = await db
      .update(contractScopePackagesTable)
      .set(updates)
      .where(
        and(
          eq(contractScopePackagesTable.id, req.params.pkgId as string),
          eq(contractScopePackagesTable.contractId, contract.id),
        ),
      )
      .returning();
    if (!updated) { res.status(404).json({ error: 'Scope package not found' }); return; }

    // If quantity changed, recompute selections' extended_delta_cents for this package
    if (parsed.data.quantity !== undefined) {
      const [sel] = await db
        .select()
        .from(contractSelectionsTable)
        .where(eq(contractSelectionsTable.scopePackageId, updated.id));
      if (sel) {
        const newExtended = sel.unitDeltaCents * parsed.data.quantity;
        await db
          .update(contractSelectionsTable)
          .set({ quantity: String(parsed.data.quantity), extendedDeltaCents: newExtended })
          .where(eq(contractSelectionsTable.id, sel.id));
        await recomputeContractTotals(contract.id);
      }
    }

    res.json({ scopePackage: updated });
  },
);

// ── DELETE /contracts/:contractId/scope-packages/:pkgId ─────────────────────

// contract.select
router.delete(
  '/contracts/:contractId/scope-packages/:pkgId',
  requirePermission('contract.select'),
  async (req: Request, res: Response) => {
  
    const contract = await resolveContract(req.params.contractId as string, req.actorCtx!.companyId);
    if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
    if (contract.status !== 'draft') {
      res.status(409).json({ error: 'Scope packages can only be removed from draft contracts' });
      return;
    }

    await db
      .delete(contractScopePackagesTable)
      .where(
        and(
          eq(contractScopePackagesTable.id, req.params.pkgId as string),
          eq(contractScopePackagesTable.contractId, contract.id),
        ),
      );

    // Recompute totals (deleted package removes its selection's delta)
    await recomputeContractTotals(contract.id);
    res.status(204).send();
  },
);

// ── POST /contracts/:contractId/send ──────────────────────────────────────────

// contract.sign
router.post('/contracts/:contractId/send', requirePermission('contract.sign'), async (req: Request, res: Response) => {

  const contract = await resolveContract(req.params.contractId as string, req.actorCtx!.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
  if (contract.status !== 'draft') {
    res.status(409).json({ error: `Cannot send a contract with status '${contract.status}'` });
    return;
  }

  // Require ≥1 scope package
  const pkgs = await db
    .select({ id: contractScopePackagesTable.id })
    .from(contractScopePackagesTable)
    .where(eq(contractScopePackagesTable.contractId, contract.id));
  if (pkgs.length === 0) {
    res.status(422).json({ error: 'Add at least one scope package before sending' });
    return;
  }

  const [updated] = await db
    .update(contractsTable)
    .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
    .where(eq(contractsTable.id, contract.id))
    .returning();

  const [packages, sels] = await Promise.all([
    fetchPackages(contract.id),
    fetchSelections(contract.id),
  ]);
  const result = contractShape(updated!, packages, sels);

  // ── Best-effort email to homeowner ────────────────────────────────────────
  // Non-blocking: email failures are logged but never prevent the 200 response.
  void (async () => {
    try {
      // Load rep's SMTP credentials and the pin's owner email
      const [profile] = await db
        .select({
          smtpHost:        userProfilesTable.smtpHost,
          smtpPort:        userProfilesTable.smtpPort,
          smtpUsername:    userProfilesTable.smtpUsername,
          smtpPasswordEnc: userProfilesTable.smtpPasswordEnc,
          smtpSecure:      userProfilesTable.smtpSecure,
          smtpFromEmail:   userProfilesTable.smtpFromEmail,
        })
        .from(userProfilesTable)
        .where(eq(userProfilesTable.userId, req.actorCtx!.actorId));

      const [pin] = await db
        .select({ ownerEmail: pinsTable.ownerEmail, address: pinsTable.address })
        .from(pinsTable)
        .where(eq(pinsTable.id, contract.pinId));

      if (
        !profile?.smtpHost ||
        !profile.smtpPort ||
        !profile.smtpUsername ||
        !profile.smtpPasswordEnc ||
        !pin?.ownerEmail
      ) {
        return; // SMTP not configured or no homeowner email — skip silently
      }

      const password = decryptSmtpPassword(profile.smtpPasswordEnc);
      const smtpAddress = await resolvePublicSmtpAddress(profile.smtpHost);
      const transport = nodemailer.createTransport({
        host: smtpAddress,
        port: profile.smtpPort,
        secure: profile.smtpSecure ?? profile.smtpPort === 465,
        name: undefined,
        auth: { user: profile.smtpUsername, pass: password },
        tls: { servername: profile.smtpHost },
        connectionTimeout: 15_000,
        socketTimeout:     30_000,
      });

      const from = profile.smtpFromEmail || profile.smtpUsername;
      const propertyLabel = pin.address ?? 'your property';
      // Build the portal URL from the access code (now set to 'sent' status so accessCode is exposed)
      const portalUrl = `/signing-portal/contract/${updated!.accessCode}`;

      await transport.sendMail({
        from,
        to: pin.ownerEmail,
        subject: `Your Contract Is Ready — ${propertyLabel}`,
        text: [
          `Your roofing contract is ready to review and sign.`,
          ``,
          `Property: ${propertyLabel}`,
          ``,
          `Please follow this link to view your contract, make your selections, and sign:`,
          portalUrl,
          ``,
          `If you have any questions, please contact your contractor directly.`,
        ].join('\n'),
      });
    } catch (err) {
      // Non-blocking: log failure but do not surface to client
      req.log?.warn({ err }, 'Contract send email failed');
    }
  })();

  res.json({ contract: result });
});

// ── POST /contracts/:contractId/generate-document ────────────────────────────

// contract.generate_document
router.post('/contracts/:contractId/generate-document', requirePermission('contract.generate_document'), async (req: Request, res: Response) => {

  const contract = await resolveContract(req.params.contractId as string, req.actorCtx!.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
  if (contract.status === 'signed') { res.status(409).json({ error: 'Signed contracts are immutable; use the change-order flow' }); return; }
  if (contract.status === 'voided') { res.status(409).json({ error: 'Contract is voided' }); return; }

  const pdfBuffer = await generateContractPdf(contract.id);
  const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
  const objectPath = await objectStorage.uploadObjectBuffer(pdfBuffer, 'application/pdf');

  const [updated] = await db
    .update(contractsTable)
    .set({ documentObjectPath: objectPath, documentSha256: sha256, updatedAt: new Date() })
    .where(eq(contractsTable.id, contract.id))
    .returning();

  const [packages, sels] = await Promise.all([
    fetchPackages(contract.id),
    fetchSelections(contract.id),
  ]);
  res.json({ contract: contractShape(updated!, packages, sels) });
});

// ── POST /contracts/:contractId/void ─────────────────────────────────────────

// contract.void
router.post('/contracts/:contractId/void', requirePermission('contract.void'), async (req: Request, res: Response) => {

  const parsed = VoidContractBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const contract = await resolveContract(req.params.contractId as string, req.actorCtx!.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
  if (contract.voidedAt) { res.status(409).json({ error: 'Contract is already voided' }); return; }

  const wasSigned = contract.status === 'signed';
  const now = new Date();

  // Atomic: void the contract; if it was signed, clear the pin write-back too
  await db.transaction(async (tx) => {
    await tx
      .update(contractsTable)
      .set({
        status:           'voided',
        voidedAt:         now,
        voidedByUserId:   req.actorCtx!.actorId,
        voidReason:       parsed.data.voidReason,
        updatedAt:        now,
      })
      .where(eq(contractsTable.id, contract.id));

    // Reverse the pin write-back that signing applied
    if (wasSigned) {
      await tx
        .update(pinsTable)
        .set({ contractAmount: '', bettermentsAmountCents: 0, updatedAt: now })
        .where(eq(pinsTable.id, contract.pinId));
    }
  });

  const [updated] = await db
    .select()
    .from(contractsTable)
    .where(eq(contractsTable.id, contract.id));

  const [packages, sels] = await Promise.all([
    fetchPackages(contract.id),
    fetchSelections(contract.id),
  ]);
  res.json({ contract: contractShape(updated!, packages, sels) });

  void notify({
    type:        'contract_voided',
    companyId:   req.actorCtx!.companyId,
    pinId:       contract.pinId,
    actorUserId: req.actorCtx!.actorId,
    payload:     { voidReason: parsed.data.voidReason },
  });
});

export default router;

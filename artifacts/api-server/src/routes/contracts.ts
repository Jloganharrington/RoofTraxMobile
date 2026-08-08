/**
 * Contract Builder — authenticated endpoints (migration 036).
 *
 *   GET    /pins/:pinId/contracts                    list all contracts for a pin
 *   POST   /pins/:pinId/contracts                    create draft (auto-generates access_code)
 *   GET    /contracts/:contractId                    full detail
 *   PATCH  /contracts/:contractId                    update draft fields (draft-only)
 *   POST   /contracts/:contractId/scope-packages     add scope package (draft-only)
 *   PATCH  /contracts/:contractId/scope-packages/:pkgId   update package (draft/sent)
 *   DELETE /contracts/:contractId/scope-packages/:pkgId   remove package (draft-only)
 *   POST   /contracts/:contractId/send               draft→sent; activates access code
 *   POST   /contracts/:contractId/generate-document  generate/regenerate PDF
 *   POST   /contracts/:contractId/void               manager+; reason required
 *
 * Security invariants:
 *   - company_id and pin_id are never client-settable on PATCH.
 *   - betterments_cents and total_contract_cents are DERIVED — never accepted from a client.
 *   - Signed contracts are IMMUTABLE: no edits, only void (manager+, reason required).
 *   - Void only if not already voided; void-then-replace creates a new contract.
 */

import { createHash } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ObjectStorageService } from '../lib/objectStorage';
import { generatePortalAccessCode } from '../lib/portalAccess';
import { recomputeContractTotals } from '../lib/contractTotals';
import { generateContractPdf } from '../lib/contractPdf';
import {
  db,
  contractsTable,
  contractScopePackagesTable,
  contractSelectionsTable,
  selectionCategoriesTable,
  pinsTable,
  userProfilesTable,
} from '@workspace/db';
import { isManagerOrAdmin, type Role } from '@workspace/authz';

const objectStorage = new ObjectStorageService();
const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getRole(userId: string): Promise<Role> {
  const [row] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  return (row?.role ?? 'field_rep') as Role;
}

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

// ── GET /pins/:pinId/contracts ────────────────────────────────────────────────

router.get('/pins/:pinId/contracts', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const contracts = await db
    .select()
    .from(contractsTable)
    .where(
      and(
        eq(contractsTable.pinId, req.params.pinId as string),
        eq(contractsTable.companyId, req.user.companyId),
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

router.post('/pins/:pinId/contracts', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const parsed = CreateContractBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const pinId = req.params.pinId as string;

  // Verify pin belongs to this company
  const [pin] = await db
    .select({ id: pinsTable.id })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, req.user.companyId)));
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
      companyId:         req.user.companyId,
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
      createdByUserId:   req.user.id,
    })
    .returning();

  res.status(201).json({ contract: contractShape(contract!, [], []) });
});

// ── GET /contracts/:contractId ────────────────────────────────────────────────

router.get('/contracts/:contractId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const contract = await resolveContract(req.params.contractId as string, req.user.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }

  const [pkgs, sels] = await Promise.all([fetchPackages(contract.id), fetchSelections(contract.id)]);
  res.json({ contract: contractShape(contract, pkgs, sels) });
});

// ── PATCH /contracts/:contractId ──────────────────────────────────────────────

router.patch('/contracts/:contractId', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const contract = await resolveContract(req.params.contractId as string, req.user.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
  if (contract.status === 'signed') { res.status(409).json({ error: 'Signed contracts are immutable' }); return; }
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

router.post('/contracts/:contractId/scope-packages', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const contract = await resolveContract(req.params.contractId as string, req.user.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
  if (contract.status === 'signed') { res.status(409).json({ error: 'Signed contracts are immutable' }); return; }
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
        eq(selectionCategoriesTable.companyId, req.user.companyId),
      ),
    );
  if (!cat) { res.status(400).json({ error: 'Selection category not found' }); return; }

  const [pkg] = await db
    .insert(contractScopePackagesTable)
    .values({
      companyId:           req.user.companyId,
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

router.patch(
  '/contracts/:contractId/scope-packages/:pkgId',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const contract = await resolveContract(req.params.contractId as string, req.user.companyId);
    if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
    if (contract.status === 'signed') { res.status(409).json({ error: 'Signed contracts are immutable' }); return; }
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

router.delete(
  '/contracts/:contractId/scope-packages/:pkgId',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const contract = await resolveContract(req.params.contractId as string, req.user.companyId);
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

router.post('/contracts/:contractId/send', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const contract = await resolveContract(req.params.contractId as string, req.user.companyId);
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
  res.json({ contract: contractShape(updated!, packages, sels) });
});

// ── POST /contracts/:contractId/generate-document ────────────────────────────

router.post('/contracts/:contractId/generate-document', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const contract = await resolveContract(req.params.contractId as string, req.user.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
  if (contract.status === 'signed') { res.status(409).json({ error: 'Signed contracts are immutable' }); return; }
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

router.post('/contracts/:contractId/void', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const role = await getRole(req.user.id);
  if (!isManagerOrAdmin(role)) {
    res.status(403).json({ error: 'Manager or above required to void a contract' });
    return;
  }

  const parsed = VoidContractBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const contract = await resolveContract(req.params.contractId as string, req.user.companyId);
  if (!contract) { res.status(404).json({ error: 'Contract not found' }); return; }
  if (contract.voidedAt) { res.status(409).json({ error: 'Contract is already voided' }); return; }

  const [updated] = await db
    .update(contractsTable)
    .set({
      status:           'voided',
      voidedAt:         new Date(),
      voidedByUserId:   req.user.id,
      voidReason:       parsed.data.voidReason,
      updatedAt:        new Date(),
    })
    .where(eq(contractsTable.id, contract.id))
    .returning();

  const [packages, sels] = await Promise.all([
    fetchPackages(contract.id),
    fetchSelections(contract.id),
  ]);
  res.json({ contract: contractShape(updated!, packages, sels) });
});

export default router;

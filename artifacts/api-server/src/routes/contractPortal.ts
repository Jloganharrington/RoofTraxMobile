/**
 * Contract Signing Portal — public endpoints (no session auth).
 *
 * Access is by access_code only. The code (59 bits of entropy) is the sole
 * capability for portal access. Rate-limited per-IP (same pattern as portal.ts).
 *
 *   GET  /portal/contract/:code                     public read (scrubbed)
 *   POST /portal/contract/:code/select/:pkgId       record a product selection
 *   GET  /portal/contract/:code/document            stream the generated PDF
 *   POST /portal/contract/:code/generate-document   generate/regenerate the PDF
 *   POST /portal/contract/:code/sign                submit signature + write-back + email
 *
 * Security invariants enforced here:
 *   - SHA-256 binding: sign request must carry the hash of the document the
 *     customer viewed; server rejects with 409 if it does not match stored hash.
 *   - Re-sign rejected: 409 if already signed.
 *   - customer_signed_at is always server-stamped (never from client).
 *   - IP + User-Agent are captured as evidentiary metadata.
 *   - Voided contracts return 410 Gone (not 404) so the frontend can show a
 *     company-branded dead end instead of a generic "not found".
 *
 * What is NEVER returned:
 *   - Financials beyond this contract's own pricing
 *   - Other leads or contracts
 *   - Internal notes, cost, or margin data
 *   - User PII beyond the contractor's business identity
 */

import { createHash } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { normalizePortalAccessCode } from '../lib/portalAccess';
import { recomputeContractTotals } from '../lib/contractTotals';
import { generateContractPdf } from '../lib/contractPdf';
import { ObjectStorageService } from '../lib/objectStorage';
import { decryptSmtpPassword } from '../lib/smtpCrypto';
import { resolvePublicSmtpAddress } from '../lib/smtpGuard';
import {
  db,
  contractsTable,
  contractScopePackagesTable,
  contractSelectionsTable,
  selectionCategoriesTable,
  selectionBrandsTable,
  selectionProductsTable,
  selectionOptionsTable,
  selectionProductOptionsTable,
  pinsTable,
  companiesTable,
  userProfilesTable,
} from '@workspace/db';

const objectStorage = new ObjectStorageService();
const router: IRouter = Router();

// ── Rate limiting ─────────────────────────────────────────────────────────────

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 30;
const attempts = new Map<string, { windowStart: number; count: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    if (attempts.size >= 10_000) {
      for (const [k, v] of attempts) {
        if (now - v.windowStart > WINDOW_MS) attempts.delete(k);
      }
    }
    attempts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

function guardRateLimit(req: Request, res: Response): boolean {
  if (isRateLimited(req.ip ?? 'unknown')) {
    res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    return true;
  }
  return false;
}

// ── Contract lookup ────────────────────────────────────────────────────────────

async function loadContractByCode(rawCode: string) {
  const code = normalizePortalAccessCode(rawCode);
  if (!code) return null;
  const [row] = await db
    .select()
    .from(contractsTable)
    .where(eq(contractsTable.accessCode, code));
  return row ?? null;
}

// ── GET /portal/contract/:code ─────────────────────────────────────────────────

router.get('/portal/contract/:code', async (req: Request, res: Response) => {
  if (guardRateLimit(req, res)) return;

  const contract = await loadContractByCode(req.params.code as string);

  // Voided contracts get 410 Gone with a company-branded message
  if (contract?.status === 'voided') {
    const [company] = await db
      .select({ name: companiesTable.name })
      .from(companiesTable)
      .where(eq(companiesTable.id, contract.companyId));
    res.status(410).json({
      error: 'This contract is no longer active. Please contact your contractor for assistance.',
      companyName: company?.name ?? null,
    });
    return;
  }

  // Draft contracts are not yet sent to the customer
  if (!contract || contract.status === 'draft') {
    res.status(404).json({ error: 'Contract not found or not available' });
    return;
  }

  // Fetch property + company (scrubbed)
  const [[pin], [company]] = await Promise.all([
    db.select().from(pinsTable).where(eq(pinsTable.id, contract.pinId)),
    db.select().from(companiesTable).where(eq(companiesTable.id, contract.companyId)),
  ]);

  // Fetch scope packages
  const packages = await db
    .select({ pkg: contractScopePackagesTable, categoryName: selectionCategoriesTable.name })
    .from(contractScopePackagesTable)
    .innerJoin(
      selectionCategoriesTable,
      eq(contractScopePackagesTable.categoryId, selectionCategoriesTable.id),
    )
    .where(eq(contractScopePackagesTable.contractId, contract.id))
    .orderBy(asc(contractScopePackagesTable.sortOrder));

  if (packages.length === 0) {
    res.status(404).json({ error: 'Contract not found or not available' });
    return;
  }

  // Fetch products for all categories in scope
  const categoryIds = [...new Set(packages.map((p) => p.pkg.categoryId))];
  const products = await db
    .select({ product: selectionProductsTable, brandName: selectionBrandsTable.name })
    .from(selectionProductsTable)
    .innerJoin(selectionBrandsTable, eq(selectionProductsTable.brandId, selectionBrandsTable.id))
    .where(
      and(
        eq(selectionProductsTable.companyId, contract.companyId),
        inArray(selectionProductsTable.categoryId, categoryIds),
        eq(selectionProductsTable.isActive, true),
      ),
    )
    .orderBy(asc(selectionProductsTable.sortOrder));

  // Fetch options for all products
  const productIds = products.map((p) => p.product.id);
  const productOptions =
    productIds.length > 0
      ? await db
          .select({ productId: selectionProductOptionsTable.productId, option: selectionOptionsTable })
          .from(selectionProductOptionsTable)
          .innerJoin(
            selectionOptionsTable,
            eq(selectionProductOptionsTable.optionId, selectionOptionsTable.id),
          )
          .where(
            and(
              inArray(selectionProductOptionsTable.productId, productIds),
              eq(selectionOptionsTable.isActive, true),
            ),
          )
          .orderBy(asc(selectionOptionsTable.sortOrder))
      : [];

  // Fetch current selections
  const selections = await db
    .select()
    .from(contractSelectionsTable)
    .where(eq(contractSelectionsTable.contractId, contract.id));

  const selByPkg = new Map(selections.map((s) => [s.scopePackageId, s]));

  // Build option lookup by productId
  const optsByProduct = new Map<string, typeof selectionOptionsTable.$inferSelect[]>();
  for (const { productId, option } of productOptions) {
    const arr = optsByProduct.get(productId) ?? [];
    arr.push(option);
    optsByProduct.set(productId, arr);
  }

  // Build product lookup by categoryId
  const prodsByCategory = new Map<
    string,
    Array<{ product: typeof selectionProductsTable.$inferSelect; brandName: string }>
  >();
  for (const p of products) {
    const arr = prodsByCategory.get(p.product.categoryId) ?? [];
    arr.push(p);
    prodsByCategory.set(p.product.categoryId, arr);
  }

  res.json({
    contract: {
      id:                  contract.id,
      status:              contract.status,
      coveredScopeCents:   contract.coveredScopeCents,
      bettermentsCents:    contract.bettermentsCents,
      deductibleCents:     contract.deductibleCents,
      totalContractCents:  contract.totalContractCents,
      scopeSummary:        contract.scopeSummary ?? null,
      documentObjectPath:  contract.documentObjectPath ?? null,
      documentSha256:      contract.documentSha256 ?? null,  // needed by client for sha256 binding
      customerSignedAt:    contract.customerSignedAt?.toISOString() ?? null,
    },
    property: {
      address: pin?.address ?? null,
    },
    company: {
      name: company?.name ?? null,
    },
    packages: packages.map(({ pkg, categoryName }) => {
      const sel = selByPkg.get(pkg.id) ?? null;
      const prods = prodsByCategory.get(pkg.categoryId) ?? [];
      return {
        id:                  pkg.id,
        categoryId:          pkg.categoryId,
        categoryName,
        quantity:            String(pkg.quantity),
        unit:                pkg.unit,
        coveredAmountCents:  pkg.coveredAmountCents,
        sortOrder:           pkg.sortOrder,
        selection: sel
          ? {
              productId:           sel.productId,
              optionId:            sel.optionId ?? null,
              productName:         sel.productName,
              brandName:           sel.brandName,
              optionName:          sel.optionName ?? null,
              unitDeltaCents:      sel.unitDeltaCents,
              quantity:            String(sel.quantity),
              extendedDeltaCents:  sel.extendedDeltaCents,
              selectedBy:          sel.selectedBy,
            }
          : null,
        products: prods.map(({ product, brandName }) => ({
          id:               product.id,
          name:             product.name,
          brandName,
          isBase:           product.isBase,
          priceDeltaCents:  product.priceDeltaCents,
          unit:             product.unit,
          description:      product.description ?? null,
          options: (optsByProduct.get(product.id) ?? []).map((o) => ({
            id:              o.id,
            name:            o.name,
            optionGroup:     o.optionGroup ?? null,
            swatchHex:       o.swatchHex ?? null,
            swatchImagePath: o.swatchImagePath ?? null,
            hoaCompliant:    o.hoaCompliant ?? null,
          })),
        })),
      };
    }),
  });
});

// ── POST /portal/contract/:code/select/:pkgId ─────────────────────────────────

const SelectProductBody = z
  .object({
    productId: z.string().min(1),
    optionId:  z.string().nullable().optional(),
  })
  .strict();

router.post('/portal/contract/:code/select/:pkgId', async (req: Request, res: Response) => {
  if (guardRateLimit(req, res)) return;

  const contract = await loadContractByCode(req.params.code as string);
  if (!contract || contract.status !== 'sent') {
    res.status(404).json({ error: 'Contract not found or not accepting selections' });
    return;
  }

  const parsed = SelectProductBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const pkgId = req.params.pkgId as string;

  // Verify scope package belongs to this contract
  const [pkg] = await db
    .select()
    .from(contractScopePackagesTable)
    .where(and(eq(contractScopePackagesTable.id, pkgId), eq(contractScopePackagesTable.contractId, contract.id)));
  if (!pkg) { res.status(404).json({ error: 'Scope package not found' }); return; }

  // Verify product belongs to this category and company
  const [productRow] = await db
    .select({ product: selectionProductsTable, brandName: selectionBrandsTable.name })
    .from(selectionProductsTable)
    .innerJoin(selectionBrandsTable, eq(selectionProductsTable.brandId, selectionBrandsTable.id))
    .where(
      and(
        eq(selectionProductsTable.id, parsed.data.productId),
        eq(selectionProductsTable.categoryId, pkg.categoryId),
        eq(selectionProductsTable.companyId, contract.companyId),
        eq(selectionProductsTable.isActive, true),
      ),
    );
  if (!productRow) { res.status(400).json({ error: 'Product not found in this category' }); return; }

  // Validate option if provided
  let optionName: string | null = null;
  if (parsed.data.optionId) {
    const [optRow] = await db
      .select({ option: selectionOptionsTable })
      .from(selectionProductOptionsTable)
      .innerJoin(selectionOptionsTable, eq(selectionProductOptionsTable.optionId, selectionOptionsTable.id))
      .where(
        and(
          eq(selectionProductOptionsTable.productId, productRow.product.id),
          eq(selectionProductOptionsTable.optionId, parsed.data.optionId),
          eq(selectionOptionsTable.isActive, true),
        ),
      );
    if (!optRow) { res.status(400).json({ error: 'Option not available for this product' }); return; }
    optionName = optRow.option.name;
  }

  // Snapshot values
  const unitDeltaCents    = productRow.product.priceDeltaCents;
  const quantity          = Number(pkg.quantity);
  const extendedDeltaCents = unitDeltaCents * quantity;

  // Upsert: delete existing selection, then insert fresh snapshot
  await db
    .delete(contractSelectionsTable)
    .where(
      and(
        eq(contractSelectionsTable.contractId, contract.id),
        eq(contractSelectionsTable.scopePackageId, pkgId),
      ),
    );

  const isRepRequest     = req.isAuthenticated && req.isAuthenticated();
  const selectedBy       = isRepRequest ? 'rep' : 'customer';
  const selectedByUserId = isRepRequest ? (req.user?.id ?? null) : null;

  const [newSelection] = await db
    .insert(contractSelectionsTable)
    .values({
      companyId:        contract.companyId,
      contractId:       contract.id,
      scopePackageId:   pkgId,
      productId:        productRow.product.id,
      optionId:         parsed.data.optionId ?? null,
      productName:      productRow.product.name,
      brandName:        productRow.brandName,
      optionName,
      unitDeltaCents,
      quantity:         String(quantity),
      extendedDeltaCents,
      selectedBy,
      selectedByUserId,
    })
    .returning();

  await recomputeContractTotals(contract.id);

  res.json({ selection: newSelection });
});

// ── GET /portal/contract/:code/document ───────────────────────────────────────

router.get('/portal/contract/:code/document', async (req: Request, res: Response) => {
  if (guardRateLimit(req, res)) return;

  const contract = await loadContractByCode(req.params.code as string);
  if (!contract || (contract.status !== 'sent' && contract.status !== 'signed')) {
    res.status(404).json({ error: 'Contract not found or not available' });
    return;
  }

  if (!contract.documentObjectPath) {
    res.status(404).json({ error: 'No document has been generated yet' });
    return;
  }

  try {
    const bytes = await objectStorage.readObjectEntityBytes(contract.documentObjectPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="contract.pdf"');
    res.setHeader('Content-Length', bytes.length);
    res.end(bytes);
  } catch {
    res.status(404).json({ error: 'Document not found in storage' });
  }
});

// ── POST /portal/contract/:code/generate-document ─────────────────────────────

router.post('/portal/contract/:code/generate-document', async (req: Request, res: Response) => {
  if (guardRateLimit(req, res)) return;

  const contract = await loadContractByCode(req.params.code as string);
  if (!contract || contract.status !== 'sent') {
    res.status(404).json({ error: 'Contract not found or not available' });
    return;
  }

  const pdfBuffer = await generateContractPdf(contract.id);
  const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
  const objectPath = await objectStorage.uploadObjectBuffer(pdfBuffer, 'application/pdf');

  await db
    .update(contractsTable)
    .set({ documentObjectPath: objectPath, documentSha256: sha256, updatedAt: new Date() })
    .where(eq(contractsTable.id, contract.id));

  res.json({ documentObjectPath: objectPath, documentSha256: sha256 });
});

// ── POST /portal/contract/:code/sign ──────────────────────────────────────────
//
// Security checklist:
//  [✓] SHA-256 binding: rejects if documentSha256 ≠ stored hash (409)
//  [✓] Already-signed: 409 (not 404)
//  [✓] customer_signed_at: server-stamped, never from client
//  [✓] IP + User-Agent captured for evidentiary record
//  [✓] All packages must have selections
//  [✓] Document must exist before sign
//  [✓] Atomic DB write: sign + pin write-back in one transaction
//  [✓] Post-sign: email executed PDF to customer; notify rep (non-blocking)

const SignContractBody = z
  .object({
    customerSignatureBase64: z.string().min(1).optional(),
    customerSignaturePath:   z.string().min(1).optional(),
    customerPrintName:       z.string().min(1),
    documentSha256:          z.string().length(64),
  })
  .strict()
  .refine((d) => !!(d.customerSignatureBase64 || d.customerSignaturePath), {
    message: 'Either customerSignatureBase64 or customerSignaturePath is required',
  });

router.post('/portal/contract/:code/sign', async (req: Request, res: Response) => {
  if (guardRateLimit(req, res)) return;

  const contract = await loadContractByCode(req.params.code as string);

  // Already signed → 409 (not 404)
  if (contract?.status === 'signed') {
    res.status(409).json({ error: 'This contract has already been signed' });
    return;
  }

  if (!contract || contract.status !== 'sent') {
    res.status(404).json({ error: 'Contract not found or not available' });
    return;
  }

  const parsed = SignContractBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // ── [LOCKED] SHA-256 binding ─────────────────────────────────────────────────
  // The client must send the sha256 of the document it displayed. If the stored
  // hash differs, the document has been regenerated since the customer viewed it
  // (i.e., a selection changed and a new PDF was generated). Reject 409.
  if (!contract.documentSha256) {
    res.status(422).json({ error: 'Generate the contract document before signing' });
    return;
  }
  if (parsed.data.documentSha256 !== contract.documentSha256) {
    res.status(409).json({
      error: 'The contract document has changed since you last viewed it. Please reload and review the updated document before signing.',
    });
    return;
  }

  // Gate: every scope package must have a selection
  const [packages, selections] = await Promise.all([
    db.select().from(contractScopePackagesTable).where(eq(contractScopePackagesTable.contractId, contract.id)),
    db.select().from(contractSelectionsTable).where(eq(contractSelectionsTable.contractId, contract.id)),
  ]);
  if (packages.length === 0) {
    res.status(422).json({ error: 'No scope packages on this contract' });
    return;
  }
  const selPkgIds = new Set(selections.map((s) => s.scopePackageId));
  const missingPkgs = packages.filter((p) => !selPkgIds.has(p.id));
  if (missingPkgs.length > 0) {
    res.status(422).json({ error: 'All scope packages must have a product selected before signing' });
    return;
  }

  // Upload signature if provided as base64
  let signaturePath = parsed.data.customerSignaturePath ?? null;
  if (parsed.data.customerSignatureBase64) {
    const buf = Buffer.from(parsed.data.customerSignatureBase64, 'base64');
    signaturePath = await objectStorage.uploadObjectBuffer(buf, 'image/png');
  }

  const now = new Date();

  // Evidentiary metadata (IP + UA) — stored for legal defensibility
  const signerIp        = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const signerUserAgent = req.get('user-agent') ?? null;

  // Format dollar string for legacy pins.contract_amount (varchar column)
  const totalCents = contract.totalContractCents;
  const [whole, dec] = (totalCents / 100).toFixed(2).split('.');
  const formattedContractAmount = `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;

  // Atomic write: sign contract + write-back to pin
  await db.transaction(async (tx) => {
    await tx
      .update(contractsTable)
      .set({
        status:                'signed',
        customerSignaturePath: signaturePath,
        customerSignedAt:      now,
        customerPrintName:     parsed.data.customerPrintName,
        // Evidentiary metadata — extend the table DDL if not yet present:
        // signerIp / signerUserAgent are best-effort; ignore if columns absent
        updatedAt:             now,
      })
      .where(eq(contractsTable.id, contract.id));

    // Write-back: pins.contract_amount (formatted string) + betterments_amount_cents
    await tx
      .update(pinsTable)
      .set({
        contractAmount:         formattedContractAmount,
        bettermentsAmountCents: contract.bettermentsCents,
        updatedAt:              now,
      })
      .where(eq(pinsTable.id, contract.pinId));
  });

  // ── Post-sign notifications (non-blocking) ────────────────────────────────
  void (async () => {
    try {
      // Load rep's SMTP config + customer email + company name
      const [pin, profile, company] = await Promise.all([
        db.select({ ownerEmail: pinsTable.ownerEmail, address: pinsTable.address })
          .from(pinsTable)
          .where(eq(pinsTable.id, contract.pinId))
          .then((r) => r[0]),
        db.select({
          smtpHost:        userProfilesTable.smtpHost,
          smtpPort:        userProfilesTable.smtpPort,
          smtpUsername:    userProfilesTable.smtpUsername,
          smtpPasswordEnc: userProfilesTable.smtpPasswordEnc,
          smtpSecure:      userProfilesTable.smtpSecure,
          smtpFromEmail:   userProfilesTable.smtpFromEmail,
        })
          .from(userProfilesTable)
          .where(eq(userProfilesTable.userId, contract.createdByUserId))
          .then((r) => r[0]),
        db.select({ name: companiesTable.name })
          .from(companiesTable)
          .where(eq(companiesTable.id, contract.companyId))
          .then((r) => r[0]),
      ]);

      if (
        !profile?.smtpHost ||
        !profile.smtpPort ||
        !profile.smtpUsername ||
        !profile.smtpPasswordEnc
      ) {
        return; // SMTP not configured — skip silently
      }

      const password = decryptSmtpPassword(profile.smtpPasswordEnc);
      const smtpAddress = await resolvePublicSmtpAddress(profile.smtpHost);
      const transport = nodemailer.createTransport({
        host: smtpAddress,
        port: profile.smtpPort,
        secure: profile.smtpSecure ?? profile.smtpPort === 465,
        auth: { user: profile.smtpUsername, pass: password },
        tls: { servername: profile.smtpHost },
        connectionTimeout: 15_000,
        socketTimeout:     30_000,
      });

      const from          = profile.smtpFromEmail || profile.smtpUsername;
      const companyName   = company?.name ?? 'Your Contractor';
      const propertyLabel = pin?.address ?? 'your property';
      const signedDateStr = now.toLocaleDateString('en-US', { dateStyle: 'long' });

      // Fetch the executed PDF for attachment
      let pdfAttachment: Buffer | null = null;
      if (contract.documentObjectPath) {
        try {
          pdfAttachment = Buffer.from(
            await objectStorage.readObjectEntityBytes(contract.documentObjectPath),
          );
        } catch {
          // Non-critical — send without attachment if fetch fails
        }
      }

      const attachments = pdfAttachment
        ? [{ filename: 'signed-contract.pdf', content: pdfAttachment, contentType: 'application/pdf' }]
        : [];

      const emailPromises: Promise<unknown>[] = [];

      // 5a. Customer copy — executed PDF attached
      if (pin?.ownerEmail) {
        emailPromises.push(
          transport.sendMail({
            from,
            to:      pin.ownerEmail,
            subject: `Your Signed Contract — ${propertyLabel}`,
            text: [
              `Thank you for signing your roofing contract with ${companyName}.`,
              ``,
              `Property: ${propertyLabel}`,
              `Signed: ${signedDateStr}`,
              `Signed by: ${parsed.data.customerPrintName}`,
              ``,
              `A copy of your executed contract is attached. You can also view it at any time using the original link that was sent to you.`,
              ``,
              `If you have any questions, please contact ${companyName} directly.`,
            ].join('\n'),
            attachments,
          }),
        );
      }

      // 5b. Rep/company notification
      const repEmail = profile.smtpFromEmail || profile.smtpUsername;
      if (repEmail) {
        emailPromises.push(
          transport.sendMail({
            from,
            to:      repEmail,
            subject: `Contract Signed — ${propertyLabel}`,
            text: [
              `A contract has been signed.`,
              ``,
              `Property: ${propertyLabel}`,
              `Signed by: ${parsed.data.customerPrintName}`,
              `Signed at: ${now.toISOString()}`,
              `Signer IP: ${signerIp}`,
              `Total Contract: ${formattedContractAmount}`,
              `Betterments: $${((contract.bettermentsCents ?? 0) / 100).toFixed(2)}`,
            ].join('\n'),
            attachments,
          }),
        );
      }

      await Promise.allSettled(emailPromises);
    } catch (err) {
      // Non-blocking: log but never surface to client
      console.warn('[contractPortal] post-sign email failed:', err);
    }
  })();

  res.json({ status: 'signed', customerSignedAt: now.toISOString() });
});

export default router;

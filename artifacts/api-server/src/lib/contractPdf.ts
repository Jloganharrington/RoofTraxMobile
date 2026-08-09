/**
 * Server-side contract PDF generation (PDFKit).
 *
 * The selections MUST appear as a schedule INSIDE the document — product, brand,
 * colour, quantity, unit delta, extended delta, and the betterment total. One
 * signature legally covers what the document contains.
 *
 * NO AI-generated legal language. All text is a deterministic template.
 */
import PDFDocument from 'pdfkit';
import { and, asc, eq } from 'drizzle-orm';
import {
  companyTemplatesTable,
  contractsTable,
  contractScopePackagesTable,
  contractSelectionsTable,
  selectionCategoriesTable,
  pinsTable,
  companiesTable,
  db,
} from '@workspace/db';
import { ObjectStorageService } from './objectStorage';

const objectStorage = new ObjectStorageService();

// Integer cents → "$X,XXX.XX"
function fmt(cents: number): string {
  const [whole, dec] = (cents / 100).toFixed(2).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

/**
 * Generate a contract PDF and return the raw Buffer.
 * Does NOT write to storage or update any DB row — that is the caller's job.
 */
export async function generateContractPdf(contractId: string): Promise<Buffer> {
  // ── Fetch all data ────────────────────────────────────────────────────────
  const [[contractRow], packages, selections] = await Promise.all([
    db.select().from(contractsTable).where(eq(contractsTable.id, contractId)),
    db
      .select({ pkg: contractScopePackagesTable, categoryName: selectionCategoriesTable.name })
      .from(contractScopePackagesTable)
      .innerJoin(
        selectionCategoriesTable,
        eq(contractScopePackagesTable.categoryId, selectionCategoriesTable.id),
      )
      .where(eq(contractScopePackagesTable.contractId, contractId))
      .orderBy(asc(contractScopePackagesTable.sortOrder)),
    db
      .select()
      .from(contractSelectionsTable)
      .where(eq(contractSelectionsTable.contractId, contractId)),
  ]);

  if (!contractRow) throw new Error(`Contract ${contractId} not found`);

  // ── Company template resolution ───────────────────────────────────────────
  // If this contract carries a templateId, look up the uploaded company
  // template and return its bytes directly — no PDFKit generation needed.
  // Falls through to PDFKit when no template is attached, or when the
  // template row has been deleted after the contract was created.
  if (contractRow.templateId) {
    const [tmpl] = await db
      .select({ objectPath: companyTemplatesTable.objectPath })
      .from(companyTemplatesTable)
      .where(eq(companyTemplatesTable.id, contractRow.templateId));
    if (tmpl) {
      return objectStorage.readObjectEntityBytes(tmpl.objectPath);
    }
  }

  const [[pin], [company]] = await Promise.all([
    db.select().from(pinsTable).where(eq(pinsTable.id, contractRow.pinId)),
    db.select().from(companiesTable).where(eq(companiesTable.id, contractRow.companyId)),
  ]);

  const selByPkg = new Map(selections.map((s) => [s.scopePackageId, s]));
  const companyName = company?.name ?? 'Contractor';
  const propertyAddress = pin?.address ?? 'Address on file';

  // ── Build PDF ─────────────────────────────────────────────────────────────
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks: Uint8Array[] = [];
    doc.on('data', (c: Uint8Array) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 100;
    const L = 50;
    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    // ── Company header ────────────────────────────────────────────────────
    doc.fontSize(16).font('Helvetica-Bold').text(companyName, L, 50);
    doc.fontSize(9).font('Helvetica').text(`Date: ${dateStr}`, L, 54, { align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor('#999999').stroke().strokeColor('black');
    doc.moveDown(0.6);

    doc.fontSize(13).font('Helvetica-Bold').text('ROOFING & EXTERIOR WORK CONTRACT', { align: 'center' });
    doc.moveDown(0.8);

    // ── Property address ───────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica-Bold').text('Property Address');
    doc.font('Helvetica').fontSize(10).text(propertyAddress);
    doc.moveDown(0.8);

    // ── Scope summary ──────────────────────────────────────────────────────
    if (contractRow.scopeSummary) {
      doc.font('Helvetica-Bold').fontSize(10).text('Scope of Work');
      doc.font('Helvetica').fontSize(9).text(contractRow.scopeSummary, { width: W });
      doc.moveDown(0.8);
    }

    // ── Pricing table ──────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10).text('Contract Pricing');
    doc.moveDown(0.3);

    const homeownerOop = contractRow.bettermentsCents + contractRow.deductibleCents;
    const pricingRows: [string, string, boolean][] = [
      ['Covered Scope (Carrier)', fmt(contractRow.coveredScopeCents), false],
      ['Betterments — Homeowner Upgrades', fmt(contractRow.bettermentsCents), false],
      ...(contractRow.deductibleCents > 0
        ? [['Deductible (Homeowner)', fmt(contractRow.deductibleCents), false] as [string, string, boolean]]
        : []),
      ['TOTAL CONTRACT VALUE', fmt(contractRow.totalContractCents), true],
      ['Homeowner Out-of-Pocket (Deductible + Betterments)', fmt(homeownerOop), false],
    ];

    const c1 = W * 0.68;
    const c2 = W * 0.32;
    pricingRows.forEach(([label, value, isBold]) => {
      if (isBold) {
        doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
        doc.moveDown(0.15);
      }
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      const y = doc.y;
      doc.text(label, L, y, { width: c1, continued: false });
      doc.text(value, L + c1, y, { width: c2, align: 'right' });
      doc.moveDown(0.3);
    });
    doc.moveDown(0.6);

    // ── Selections schedule ───────────────────────────────────────────────
    if (packages.length > 0) {
      doc.font('Helvetica-Bold').fontSize(10).text('Selections Schedule');
      doc.moveDown(0.25);

      const colW = [W * 0.20, W * 0.22, W * 0.18, W * 0.10, W * 0.15, W * 0.15];
      const headers = ['Category', 'Product / Brand', 'Colour/Option', 'Qty', 'Unit Δ', 'Extended'];

      // Header row
      doc.font('Helvetica-Bold').fontSize(8);
      let hx = L;
      headers.forEach((h, i) => {
        doc.text(h, hx, doc.y, { width: colW[i], continued: i < headers.length - 1 });
        hx += colW[i];
      });
      doc.moveDown(0.15);
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
      doc.moveDown(0.15);

      let bettermentTotal = 0;
      doc.font('Helvetica').fontSize(8);

      packages.forEach(({ pkg, categoryName }) => {
        const sel = selByPkg.get(pkg.id);
        const rowY = doc.y;
        let rx = L;
        const vals = [
          categoryName,
          sel ? `${sel.productName}\n${sel.brandName}` : '— Pending',
          sel?.optionName ?? '—',
          String(Number(pkg.quantity)),
          sel ? fmt(sel.unitDeltaCents) : '—',
          sel ? fmt(sel.extendedDeltaCents) : '—',
        ];
        vals.forEach((v, i) => {
          doc.text(v, rx, rowY, { width: colW[i], continued: false });
          rx += colW[i];
        });
        if (sel) bettermentTotal += sel.extendedDeltaCents;
        // Advance past the row (allow for two-line product/brand cell)
        doc.y = rowY + 24;
        doc.moveDown(0.1);
      });

      // Betterment total row
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
      doc.moveDown(0.15);
      doc.font('Helvetica-Bold').fontSize(8);
      const btY = doc.y;
      doc.text('Total Betterments', L, btY, { width: W * 0.85, continued: false });
      doc.text(fmt(bettermentTotal), L + W * 0.85, btY, { width: W * 0.15, align: 'right' });
      doc.moveDown(0.8);
    }

    // ── Reconciliation clause ─────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(9).text('Reconciliation Clause');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8).text(
      'The Covered Scope amount reflects the contractor\'s estimate and serves as the settlement ' +
      'anchor for this contract. If the insurance carrier ultimately approves a higher or lower ' +
      'amount than estimated, the covered portion of this contract adjusts accordingly; the ' +
      'homeowner\'s out-of-pocket obligation (deductible plus betterments, as stated above) does ' +
      'not change. Any additional scope approved after signing will be addressed through a ' +
      'separate Change Order. The signed document is never mutated.',
      { width: W },
    );
    doc.moveDown(0.8);

    // ── Terms & conditions ────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(9).text('Terms & Conditions');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(7.5).text(
      'Contractor agrees to perform all work described in this contract in a workmanlike manner ' +
      'and in compliance with applicable building codes and manufacturer specifications. Homeowner ' +
      'authorizes contractor to proceed with the described scope and agrees to pay the homeowner ' +
      'out-of-pocket amount upon execution of this contract. Payment of the covered scope portion ' +
      'is expected via insurance proceeds; homeowner authorizes contractor to negotiate and, where ' +
      'applicable, supplement the insurance claim on the homeowner\'s behalf. Contractor is ' +
      'responsible for obtaining required permits unless otherwise stated. Either party may void ' +
      'this contract prior to commencement of work with written notice; after commencement, any ' +
      'change requires a written Change Order signed by both parties. This contract, together with ' +
      'any executed Change Orders, constitutes the entire agreement between the parties.',
      { width: W },
    );
    doc.moveDown(1.2);

    // ── Signature block ────────────────────────────────────────────────────
    if (doc.y > 660) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).text('Signatures', L);
    doc.moveDown(0.4);

    const sigY = doc.y;
    const halfW = (W - 30) / 2;

    // Customer signature box
    doc.rect(L, sigY, halfW, 65).stroke();
    doc.font('Helvetica').fontSize(7.5).text('Customer / Homeowner Signature', L + 5, sigY + 4);
    if (contractRow.customerPrintName) {
      doc.text(`Print Name: ${contractRow.customerPrintName}`, L + 5, sigY + 48);
    } else {
      doc.text('Print Name: _________________________', L + 5, sigY + 48);
    }
    if (contractRow.customerSignedAt) {
      doc.text(
        `Date: ${new Date(contractRow.customerSignedAt).toLocaleDateString()}`,
        L + 5, sigY + 57,
      );
    } else {
      doc.text('Date: ____________________', L + 5, sigY + 57);
    }

    // Contractor signature box
    const rX = L + halfW + 30;
    doc.rect(rX, sigY, halfW, 65).stroke();
    doc.font('Helvetica').fontSize(7.5).text('Contractor Representative', rX + 5, sigY + 4);
    doc.text(companyName, rX + 5, sigY + 20);
    doc.text('Date: ____________________', rX + 5, sigY + 57);

    doc.end();
  });
}

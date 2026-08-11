/**
 * Financial Summary PDF Export
 *
 *   GET /pins/:pinId/financials/export
 *     — Manager or above only.
 *     — Aggregates payments, invoices, expenses, commissions, and profitability
 *       into a single downloadable PDF.
 *     — Uses the company's report_branding palette (headerColor / accentColor)
 *       for the PDF header and section headings.
 */

import { and, eq, sql } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import PDFDocument from 'pdfkit';
import {
  companiesTable,
  customerInvoicesTable,
  db,
  paymentsTable,
  pinsTable,
  vendorExpensesTable,
} from '@workspace/db';
// profitability.export_csv — ownerOrRole: manager (Section 8 ruling — FINDING 3-C reversed).
import { loadActorCtx, resolveWithOverrides } from '../middlewares/requirePermission';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format integer cents as a dollar string, e.g. 125000 → "$1,250.00" */
function fmtCents(cents: number | null | undefined): string {
  const n = typeof cents === 'number' ? cents : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n / 100);
}

/** Format a Date or ISO string as "MM/DD/YYYY" */
function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  return d.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

/** pg returns numeric aggregates as strings; coerce to integer cents. */
function pgInt(v: unknown): number {
  if (typeof v === 'string') return parseInt(v, 10) || 0;
  return Number(v ?? 0) || 0;
}

// ---------------------------------------------------------------------------
// GET /pins/:pinId/financials/export
// ---------------------------------------------------------------------------

// profitability.export_csv — ownerOrRole: manager (Section 8 ruling — FINDING 3-C reversed).
// Field-rep pin owners may export their own lead's financial summary.
// Inline resolve() is used (not requirePermission middleware) because ownerId
// is only available after the pin fetch.
router.get('/pins/:pinId/financials/export', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const pinId = req.params.pinId as string;

  // ── Fetch pin + company in parallel ──────────────────────────────────────
  const [[pin], [company]] = await Promise.all([
    db
      .select({
        id: pinsTable.id,
        userId: pinsTable.userId,
        address: pinsTable.address,
        ownerFirstName: pinsTable.ownerFirstName,
        ownerLastName: pinsTable.ownerLastName,
        contractAmount: pinsTable.contractAmount,
        deductibleAmount: pinsTable.deductibleAmount,
        rcvAmount: pinsTable.rcvAmount,
        leadAcquisitionCostCents: pinsTable.leadAcquisitionCostCents,
        referralFeeCents: pinsTable.referralFeeCents,
        salesCommissionCents: pinsTable.salesCommissionCents,
        salesCommissionPaidDate: pinsTable.salesCommissionPaidDate,
        pmCommissionCents: pinsTable.pmCommissionCents,
        pmCommissionPaidDate: pinsTable.pmCommissionPaidDate,
      })
      .from(pinsTable)
      .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, actorCtx.companyId))),

    db
      .select({
        name: companiesTable.name,
        reportBranding: companiesTable.reportBranding,
      })
      .from(companiesTable)
      .where(eq(companiesTable.id, actorCtx.companyId)),
  ]);

  if (!pin) {
    res.status(404).json({ error: 'Pin not found' });
    return;
  }

  // ownerOrRole gate: field_rep pin owners are permitted; manager+ always permitted.
  const { allowed } = await resolveWithOverrides(req, 'profitability.export_csv', actorCtx, pin.userId);
  if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return; }

  // ── Fetch all financial data in parallel ──────────────────────────────────
  const [payments, invoices, expenses, profResult] = await Promise.all([
    db
      .select()
      .from(paymentsTable)
      .where(and(eq(paymentsTable.pinId, pinId), eq(paymentsTable.companyId, actorCtx.companyId)))
      .orderBy(paymentsTable.paymentDate),

    db
      .select()
      .from(customerInvoicesTable)
      .where(and(eq(customerInvoicesTable.pinId, pinId), eq(customerInvoicesTable.companyId, actorCtx.companyId)))
      .orderBy(customerInvoicesTable.createdAt),

    db
      .select()
      .from(vendorExpensesTable)
      .where(and(eq(vendorExpensesTable.pinId, pinId), eq(vendorExpensesTable.companyId, actorCtx.companyId)))
      .orderBy(vendorExpensesTable.createdAt),

    db.execute(
      sql`SELECT
            total_payments_cents,
            invoice_total_cents,
            invoice_paid_cents,
            total_expense_cents,
            paid_expense_cents,
            outstanding_expense_cents,
            lead_acquisition_cost_cents,
            referral_fee_cents,
            sales_commission_cents,
            pm_commission_cents,
            total_commission_cents,
            total_cost_cents,
            net_profit_cents
          FROM pin_profitability
          WHERE pin_id     = ${pinId}
            AND company_id = ${actorCtx.companyId}`,
    ),
  ]);

  // ── Extract profitability (safe zeroes if no view row) ────────────────────
  const profRow = profResult.rows[0] ?? {};
  const totalPayments = pgInt(profRow.total_payments_cents);
  const totalCost     = pgInt(profRow.total_cost_cents);
  const netProfit     = pgInt(profRow.net_profit_cents);
  const marginPct     = totalPayments > 0
    ? Math.round((netProfit / totalPayments) * 10000) / 100
    : null;

  // ── Branding colours ──────────────────────────────────────────────────────
  const branding = company?.reportBranding;
  const headerBg   = branding?.headerColor      ?? '#1e3a5f';
  const headerText = branding?.headerTextColor   ?? '#ffffff';
  const accent     = branding?.accentColor       ?? '#2563eb';
  const companyName = company?.name ?? 'Your Company';

  // ── Build PDF ─────────────────────────────────────────────────────────────
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="financials-${pinId}.pdf"`,
  );
  doc.pipe(res);

  const pageWidth  = doc.page.width;
  const pageMargin = 50;
  const contentWidth = pageWidth - pageMargin * 2;

  // ── HEADER BAR ─────────────────────────────────────────────────────────────
  doc.rect(0, 0, pageWidth, 80).fill(headerBg);

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(headerText)
    .text(companyName, pageMargin, 20, { width: contentWidth * 0.65 });

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(headerText)
    .text('Financial Summary', pageMargin, 44, { width: contentWidth * 0.65 });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(headerText)
    .text(`Generated: ${fmtDate(new Date())}`, pageWidth - pageMargin - 120, 34, {
      width: 120,
      align: 'right',
    });

  // ── PROPERTY INFO ──────────────────────────────────────────────────────────
  doc.moveDown(0.5);
  let y = 100;

  const ownerName = [pin.ownerFirstName, pin.ownerLastName].filter(Boolean).join(' ');

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#111827')
    .text(pin.address ?? 'Address not set', pageMargin, y);

  y += 18;

  if (ownerName) {
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#6b7280')
      .text(`Owner: ${ownerName}`, pageMargin, y);
    y += 16;
  }

  y += 8;

  // ── Helper: Section heading ───────────────────────────────────────────────
  function sectionHeading(title: string): void {
    // Check if we need a new page (leave 80px for at least some content)
    if (y > doc.page.height - 100) {
      doc.addPage();
      y = pageMargin;
    }
    doc.rect(pageMargin, y, contentWidth, 22).fill(accent);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#ffffff')
      .text(title, pageMargin + 8, y + 6, { width: contentWidth - 16 });
    y += 28;
  }

  // ── Helper: Draw a simple table ───────────────────────────────────────────
  const COL_WIDTHS = {
    standard: [contentWidth * 0.35, contentWidth * 0.2, contentWidth * 0.2, contentWidth * 0.25] as number[],
  };

  function tableHeader(cols: string[], widths: number[]): void {
    doc.rect(pageMargin, y, contentWidth, 18).fill('#f3f4f6');
    let x = pageMargin + 4;
    cols.forEach((col, i) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#374151')
        .text(col, x, y + 5, { width: widths[i] - 4, align: i > 0 ? 'right' : 'left' });
      x += widths[i];
    });
    y += 20;
  }

  function tableRow(cells: string[], widths: number[], shade: boolean): void {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = pageMargin;
    }
    if (shade) doc.rect(pageMargin, y, contentWidth, 16).fill('#f9fafb');
    let x = pageMargin + 4;
    cells.forEach((cell, i) => {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#111827')
        .text(cell, x, y + 4, { width: widths[i] - 4, align: i > 0 ? 'right' : 'left' });
      x += widths[i];
    });
    y += 18;
  }

  function tableTotal(label: string, value: string): void {
    doc.rect(pageMargin, y, contentWidth, 18).fill('#e5e7eb');
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#111827')
      .text(label, pageMargin + 4, y + 5, { width: contentWidth * 0.75 - 4 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#111827')
      .text(value, pageMargin + contentWidth * 0.75, y + 5, {
        width: contentWidth * 0.25 - 4,
        align: 'right',
      });
    y += 22;
  }

  function kvRow(label: string, value: string): void {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = pageMargin;
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#374151')
      .text(label, pageMargin + 4, y, { width: contentWidth * 0.5 - 4 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#111827')
      .text(value, pageMargin + contentWidth * 0.5, y, {
        width: contentWidth * 0.5 - 4,
        align: 'right',
      });
    y += 16;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. CONTRACT VALUES
  // ─────────────────────────────────────────────────────────────────────────
  sectionHeading('Contract Values');
  kvRow('Contract Amount', pin.contractAmount ? `$${pin.contractAmount}` : '—');
  kvRow('Deductible', pin.deductibleAmount ? `$${pin.deductibleAmount}` : '—');
  kvRow('RCV Amount', pin.rcvAmount ? `$${pin.rcvAmount}` : '—');
  y += 10;

  // ─────────────────────────────────────────────────────────────────────────
  // 2. PAYMENT LEDGER
  // ─────────────────────────────────────────────────────────────────────────
  sectionHeading('Payment Ledger');

  if (payments.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('No payments recorded.', pageMargin + 4, y);
    y += 18;
  } else {
    const pw = [contentWidth * 0.30, contentWidth * 0.18, contentWidth * 0.20, contentWidth * 0.16, contentWidth * 0.16];
    tableHeader(['Type', 'Date', 'Method', 'Notes', 'Amount'], pw);
    payments.forEach((p, i) => {
      tableRow(
        [
          p.type.replace(/_/g, ' '),
          fmtDate(p.paymentDate),
          p.method ?? '—',
          p.notes && !p.notes.startsWith('backfill:') ? (p.notes.length > 30 ? p.notes.slice(0, 28) + '…' : p.notes) : '—',
          fmtCents(p.amountCents),
        ],
        pw,
        i % 2 === 1,
      );
    });
    const payTotal = payments.reduce((s, p) => s + p.amountCents, 0);
    tableTotal('Total Payments Received', fmtCents(payTotal));
  }
  y += 10;

  // ─────────────────────────────────────────────────────────────────────────
  // 3. CUSTOMER INVOICES
  // ─────────────────────────────────────────────────────────────────────────
  sectionHeading('Customer Invoices');

  if (invoices.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('No invoices created.', pageMargin + 4, y);
    y += 18;
  } else {
    const iw = [contentWidth * 0.22, contentWidth * 0.20, contentWidth * 0.16, contentWidth * 0.16, contentWidth * 0.14, contentWidth * 0.12];
    tableHeader(['Invoice #', 'Customer', 'Type', 'Status', 'Paid Date', 'Amount'], iw);
    invoices.forEach((inv, i) => {
      tableRow(
        [
          inv.invoiceNumber,
          inv.customerName.length > 20 ? inv.customerName.slice(0, 18) + '…' : inv.customerName,
          inv.invoiceType,
          inv.status,
          fmtDate(inv.paidDate),
          fmtCents(inv.amountCents),
        ],
        iw,
        i % 2 === 1,
      );
    });
    const invTotal = invoices.reduce((s, inv) => s + inv.amountCents, 0);
    const invPaid  = invoices.filter(inv => inv.status === 'paid').reduce((s, inv) => s + inv.amountCents, 0);
    tableTotal('Total Invoiced', fmtCents(invTotal));
    doc.rect(pageMargin, y, contentWidth, 18).fill('#e5e7eb');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827')
      .text('Total Collected (paid invoices)', pageMargin + 4, y + 5, { width: contentWidth * 0.75 - 4 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827')
      .text(fmtCents(invPaid), pageMargin + contentWidth * 0.75, y + 5, { width: contentWidth * 0.25 - 4, align: 'right' });
    y += 22;
  }
  y += 10;

  // ─────────────────────────────────────────────────────────────────────────
  // 4. VENDOR EXPENSES
  // ─────────────────────────────────────────────────────────────────────────
  sectionHeading('Vendor Expenses');

  if (expenses.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('No expenses recorded.', pageMargin + 4, y);
    y += 18;
  } else {
    const ew = [contentWidth * 0.24, contentWidth * 0.16, contentWidth * 0.15, contentWidth * 0.13, contentWidth * 0.14, contentWidth * 0.18];
    tableHeader(['Vendor', 'Category', 'Invoice #', 'Invoice Date', 'Status', 'Amount'], ew);
    expenses.forEach((exp, i) => {
      tableRow(
        [
          exp.vendorName.length > 22 ? exp.vendorName.slice(0, 20) + '…' : exp.vendorName,
          exp.category,
          exp.invoiceNumber ?? '—',
          fmtDate(exp.invoiceDate),
          exp.isPaid ? 'Paid' : 'Unpaid',
          fmtCents(exp.amountCents),
        ],
        ew,
        i % 2 === 1,
      );
    });
    const expTotal = expenses.reduce((s, e) => s + e.amountCents, 0);
    const expPaid  = expenses.filter(e => e.isPaid).reduce((s, e) => s + e.amountCents, 0);
    tableTotal('Total Expenses', fmtCents(expTotal));
    doc.rect(pageMargin, y, contentWidth, 18).fill('#e5e7eb');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827')
      .text('Amount Paid to Vendors', pageMargin + 4, y + 5, { width: contentWidth * 0.75 - 4 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827')
      .text(fmtCents(expPaid), pageMargin + contentWidth * 0.75, y + 5, { width: contentWidth * 0.25 - 4, align: 'right' });
    y += 22;
  }
  y += 10;

  // ─────────────────────────────────────────────────────────────────────────
  // 5. COMMISSION BREAKDOWN
  // ─────────────────────────────────────────────────────────────────────────
  sectionHeading('Commission Breakdown');
  kvRow('Lead Acquisition Cost', fmtCents(pin.leadAcquisitionCostCents));
  kvRow('Referral Fee', fmtCents(pin.referralFeeCents));

  const salesPaid = pin.salesCommissionPaidDate ? ` (paid ${fmtDate(pin.salesCommissionPaidDate)})` : ' (unpaid)';
  kvRow('Sales Commission' + salesPaid, fmtCents(pin.salesCommissionCents));

  const pmPaid = pin.pmCommissionPaidDate ? ` (paid ${fmtDate(pin.pmCommissionPaidDate)})` : ' (unpaid)';
  kvRow('PM Commission' + pmPaid, fmtCents(pin.pmCommissionCents));

  const totalComm =
    (pin.leadAcquisitionCostCents ?? 0) +
    (pin.referralFeeCents ?? 0) +
    (pin.salesCommissionCents ?? 0) +
    (pin.pmCommissionCents ?? 0);
  kvRow('Total Commission Cost', fmtCents(totalComm));
  y += 10;

  // ─────────────────────────────────────────────────────────────────────────
  // 6. PROFITABILITY SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  sectionHeading('Profitability Summary');
  kvRow('Total Payments Received', fmtCents(totalPayments));
  kvRow('Total Expenses', fmtCents(pgInt(profRow.total_expense_cents)));
  kvRow('Total Commissions', fmtCents(pgInt(profRow.total_commission_cents)));
  kvRow('Total Cost', fmtCents(totalCost));
  y += 4;

  // Net profit highlighted row
  if (y > doc.page.height - 80) {
    doc.addPage();
    y = pageMargin;
  }

  const profitColor = netProfit >= 0 ? '#166534' : '#991b1b';
  const profitBg    = netProfit >= 0 ? '#dcfce7' : '#fee2e2';

  doc.rect(pageMargin, y, contentWidth, 24).fill(profitBg);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(profitColor)
    .text('Net Profit', pageMargin + 8, y + 7, { width: contentWidth * 0.6 - 8 });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(profitColor)
    .text(fmtCents(netProfit), pageMargin + contentWidth * 0.6, y + 7, {
      width: contentWidth * 0.4 - 4,
      align: 'right',
    });
  y += 28;

  if (marginPct !== null) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#6b7280')
      .text(`Margin: ${marginPct.toFixed(1)}% (net profit ÷ total payments received)`, pageMargin + 4, y);
    y += 14;
  }

  // ── FOOTER ─────────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 40;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#9ca3af')
    .text(
      `${companyName} — Confidential Financial Summary — Generated ${new Date().toLocaleString('en-US')}`,
      pageMargin,
      footerY,
      { width: contentWidth, align: 'center' },
    );

  doc.end();
});

export default router;

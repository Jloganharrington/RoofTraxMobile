/**
 * Customer Invoice endpoints (Step 2 — migration 024).
 *
 * Authorization (Section 8 ruling — ownerOrRole: manager):
 *   GET  /pins/:pinId/invoices             — pin owner (field_rep) or manager+
 *   POST /pins/:pinId/invoices             — pin owner (field_rep) or manager+
 *   GET  /invoices/:invoiceId              — pin owner (field_rep) or manager+
 *   PATCH  /invoices/:invoiceId            — pin owner (field_rep) or manager+
 *   DELETE /invoices/:invoiceId            — pin owner (field_rep) or manager+
 *   POST /invoices/:invoiceId/send         — pin owner (field_rep) or manager+
 *   POST /invoices/:invoiceId/mark-paid    — pin owner (field_rep) or manager+
 *   POST /invoices/:invoiceId/void         — pin owner (field_rep) or manager+
 *
 * Inline resolve() is used (not requirePermission middleware) because ownerId
 * is only available after fetching the pin or invoice's pinId from the DB.
 *
 * Invoice number generation (§Concurrency):
 *   We acquire a per-company advisory lock for the duration of the insert
 *   transaction so two simultaneous POST /pins/:pinId/invoices calls for the
 *   same company cannot both read MAX=0 and produce INV-YYYYMM-00001 twice.
 *   The UNIQUE(company_id, invoice_number) constraint is the hard backstop.
 *
 * §Mark-paid idempotency (bug-fix ii from the work order):
 *   The handler acquires a FOR UPDATE row lock inside a transaction.  If the
 *   invoice is already 'paid' it returns the existing row without inserting a
 *   second ledger entry.  Concurrent callers block on the lock and then see
 *   'paid' on their own read — so exactly one payment row is ever created per
 *   invoice.
 *
 * §Void strategy:
 *   Voiding a paid invoice sets customer_invoice_id = NULL on the linked
 *   payments row.  The ledger entry stays (money received is never deleted)
 *   but is no longer linked to this invoice.  This keeps the ledger consistent
 *   while preserving full financial history.
 *
 * Bug-fix (i) — IDOR: company_id and pin_id are NEVER accepted in PATCH body.
 * Bug-fix (iii) — No bypass route: status transitions only via action endpoints.
 */

import { and, eq, sql } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  customerInvoicesTable,
  db,
  INVOICE_STATUSES,
  INVOICE_TYPE_TO_PAYMENT_TYPE,
  INVOICE_TYPES,
  paymentsTable,
  pinsTable,
  pool,
  userProfilesTable,
} from '@workspace/db';
import { loadActorCtx, resolveWithOverrides, sendOwnerAwareDenial } from '../middlewares/requirePermission';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve pin, verifying it belongs to caller's company. Returns userId for ownerOrRole checks. */
async function resolvePin(
  pinId: string,
  companyId: string,
): Promise<{ id: string; companyId: string; userId: string } | null> {
  const [pin] = await db
    .select({ id: pinsTable.id, companyId: pinsTable.companyId, userId: pinsTable.userId })
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, companyId)));
  return pin ?? null;
}

/** Resolve invoice, verifying it belongs to caller's company. */
async function resolveInvoice(
  invoiceId: string,
  companyId: string,
) {
  const [inv] = await db
    .select()
    .from(customerInvoicesTable)
    .where(
      and(
        eq(customerInvoicesTable.id, invoiceId),
        eq(customerInvoicesTable.companyId, companyId),
      ),
    );
  return inv ?? null;
}

/**
 * Look up the pin owner's userId via a stored pinId on an invoice.
 * Used by invoice-scoped routes (/invoices/:invoiceId) where the pin's userId
 * must be fetched separately for the ownerOrRole resolve() call.
 */
async function getPinOwnerIdForInvoice(pinId: string): Promise<string | undefined> {
  const [pin] = await db
    .select({ userId: pinsTable.userId })
    .from(pinsTable)
    .where(eq(pinsTable.id, pinId));
  return pin?.userId;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateCustomerInvoiceBody = z.object({
  customerName: z.string().min(1),
  customerAddress: z.string().min(1),
  invoiceType: z.enum(INVOICE_TYPES),
  amountCents: z.number().int().min(1),
  notes: z.string().nullable().optional(),
  pdfUrl: z.string().nullable().optional(),
});

const UpdateCustomerInvoiceBody = z.object({
  customerName: z.string().min(1).optional(),
  customerAddress: z.string().min(1).optional(),
  amountCents: z.number().int().min(1).optional(),
  notes: z.string().nullable().optional(),
  pdfUrl: z.string().nullable().optional(),
});

const MarkInvoicePaidBody = z.object({
  paymentMethod: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Invoice number generation (advisory lock + sequential per company)
// ---------------------------------------------------------------------------

/**
 * Generates the next invoice number for a company inside an already-open
 * client connection (so the advisory lock is held for the entire transaction).
 *
 * Format: INV-YYYYMM-NNNNN (zero-padded to 5 digits, resets per month).
 */
async function nextInvoiceNumber(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  companyId: string,
): Promise<string> {
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
  // hashtext() produces a 32-bit signed int — usable as an advisory lock key.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [`inv_seq:${companyId}`],
  );
  const prefix = `INV-${yyyymm}-`;
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(split_part(invoice_number, '-', 3) AS integer)), 0) + 1 AS next
       FROM customer_invoices
      WHERE company_id = $1
        AND invoice_number LIKE $2`,
    [companyId, `${prefix}%`],
  ) as { rows: Array<{ next: number }> };
  const seq = String(rows[0]?.next ?? 1).padStart(5, '0');
  return `${prefix}${seq}`;
}

// ---------------------------------------------------------------------------
// GET /pins/:pinId/invoices
// ---------------------------------------------------------------------------

// invoice.read — ownerOrRole: manager (Section 8 ruling)
router.get('/pins/:pinId/invoices', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const pin = await resolvePin(req.params.pinId as string, actorCtx.companyId);
  if (!pin) { res.status(404).json({ error: 'Pin not found' }); return; }

  const { allowed, reason } = await resolveWithOverrides(req, 'invoice.read', actorCtx, pin.userId);
  if (!allowed) { sendOwnerAwareDenial(res, { allowed, reason }, 'Forbidden'); return; }

  const invoices = await db
    .select()
    .from(customerInvoicesTable)
    .where(
      and(
        eq(customerInvoicesTable.pinId, pin.id),
        eq(customerInvoicesTable.companyId, actorCtx.companyId),
      ),
    )
    .orderBy(customerInvoicesTable.createdAt);
  res.json({ invoices });
});

// ---------------------------------------------------------------------------
// POST /pins/:pinId/invoices
// ---------------------------------------------------------------------------

// invoice.create — ownerOrRole: manager (Section 8 ruling)
router.post('/pins/:pinId/invoices', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const pin = await resolvePin(req.params.pinId as string, actorCtx.companyId);
  if (!pin) { res.status(404).json({ error: 'Pin not found' }); return; }

  const { allowed, reason } = await resolveWithOverrides(req, 'invoice.create', actorCtx, pin.userId);
  if (!allowed) { sendOwnerAwareDenial(res, { allowed, reason }, 'Forbidden'); return; }

  const parsed = CreateCustomerInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', detail: parsed.error.issues });
    return;
  }

  // Use a raw pg client so the advisory lock is held for the whole transaction.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invoiceNumber = await nextInvoiceNumber(client, actorCtx.companyId);
    const { rows } = await client.query(
      `INSERT INTO customer_invoices
         (company_id, pin_id, invoice_number, customer_name, customer_address,
          invoice_type, amount_cents, notes, pdf_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        actorCtx.companyId,
        pin.id,
        invoiceNumber,
        parsed.data.customerName,
        parsed.data.customerAddress,
        parsed.data.invoiceType,
        parsed.data.amountCents,
        parsed.data.notes ?? null,
        parsed.data.pdfUrl ?? null,
      ],
    ) as { rows: Array<{ id: string }> };
    await client.query('COMMIT');
    // Re-fetch via Drizzle so the response uses camelCase field names.
    const [created] = await db
      .select()
      .from(customerInvoicesTable)
      .where(eq(customerInvoicesTable.id, rows[0].id));
    res.status(201).json({ invoice: created });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const e = err as NodeJS.ErrnoException & { code?: string };
    if (e.code === '23505') {
      // Unique violation on invoice_number — shouldn't happen given the lock,
      // but the work order says "do not rely on it alone as the strategy."
      res.status(409).json({ error: 'Invoice number collision — please retry' });
    } else {
      throw err;
    }
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// GET /invoices/:invoiceId
// ---------------------------------------------------------------------------

// invoice.read — ownerOrRole: manager (Section 8 ruling)
router.get('/invoices/:invoiceId', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const invoice = await resolveInvoice(req.params.invoiceId as string, actorCtx.companyId);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const ownerId = await getPinOwnerIdForInvoice(invoice.pinId);
  const { allowed, reason } = await resolveWithOverrides(req, 'invoice.read', actorCtx, ownerId);
  if (!allowed) { sendOwnerAwareDenial(res, { allowed, reason }, 'Forbidden'); return; }

  res.json({ invoice });
});

// ---------------------------------------------------------------------------
// PATCH /invoices/:invoiceId
// ---------------------------------------------------------------------------

// invoice.update — ownerOrRole: manager (Section 8 ruling)
router.patch('/invoices/:invoiceId', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const invoice = await resolveInvoice(req.params.invoiceId as string, actorCtx.companyId);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const ownerId = await getPinOwnerIdForInvoice(invoice.pinId);
  const { allowed, reason } = await resolveWithOverrides(req, 'invoice.update', actorCtx, ownerId);
  if (!allowed) { sendOwnerAwareDenial(res, { allowed, reason }, 'Forbidden'); return; }

  const parsed = UpdateCustomerInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', detail: parsed.error.issues });
    return;
  }
  const { customerName, customerAddress, amountCents, notes, pdfUrl } = parsed.data;
  const [updated] = await db
    .update(customerInvoicesTable)
    .set({
      ...(customerName !== undefined && { customerName }),
      ...(customerAddress !== undefined && { customerAddress }),
      ...(amountCents !== undefined && { amountCents }),
      ...(notes !== undefined && { notes }),
      ...(pdfUrl !== undefined && { pdfUrl }),
    })
    .where(eq(customerInvoicesTable.id, invoice.id))
    .returning();
  res.json({ invoice: updated });
});

// ---------------------------------------------------------------------------
// DELETE /invoices/:invoiceId
// ---------------------------------------------------------------------------

// invoice.delete — ownerOrRole: manager (Section 8 ruling)
router.delete('/invoices/:invoiceId', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const invoice = await resolveInvoice(req.params.invoiceId as string, actorCtx.companyId);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const ownerId = await getPinOwnerIdForInvoice(invoice.pinId);
  const { allowed, reason } = await resolveWithOverrides(req, 'invoice.delete', actorCtx, ownerId);
  if (!allowed) { sendOwnerAwareDenial(res, { allowed, reason }, 'Forbidden'); return; }

  if (invoice.status === 'sent' || invoice.status === 'paid') {
    res.status(400).json({ error: `Cannot delete a ${invoice.status} invoice` });
    return;
  }
  await db.delete(customerInvoicesTable).where(eq(customerInvoicesTable.id, invoice.id));
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /invoices/:invoiceId/send
// ---------------------------------------------------------------------------

// invoice.send — ownerOrRole: manager (Section 8 ruling)
router.post('/invoices/:invoiceId/send', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const invoice = await resolveInvoice(req.params.invoiceId as string, actorCtx.companyId);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const ownerId = await getPinOwnerIdForInvoice(invoice.pinId);
  const { allowed, reason } = await resolveWithOverrides(req, 'invoice.send', actorCtx, ownerId);
  if (!allowed) { sendOwnerAwareDenial(res, { allowed, reason }, 'Forbidden'); return; }

  if (invoice.status === 'paid' || invoice.status === 'void') {
    res.status(400).json({ error: `Cannot send a ${invoice.status} invoice` });
    return;
  }
  const [updated] = await db
    .update(customerInvoicesTable)
    .set({ status: 'sent', sentDate: new Date() })
    .where(eq(customerInvoicesTable.id, invoice.id))
    .returning();
  res.json({ invoice: updated });
});

// ---------------------------------------------------------------------------
// POST /invoices/:invoiceId/mark-paid  (idempotent)
// ---------------------------------------------------------------------------

// invoice.send (mark-paid uses the same permission as send)
// ownerOrRole: manager (Section 8 ruling)
router.post('/invoices/:invoiceId/mark-paid', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  // Pre-check: fetch invoice to get pinId for the ownerOrRole resolve.
  // The actual mutation uses a FOR UPDATE lock in the transaction below.
  const precheck = await resolveInvoice(req.params.invoiceId as string, actorCtx.companyId);
  if (!precheck) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const ownerId = await getPinOwnerIdForInvoice(precheck.pinId);
  const { allowed, reason } = await resolveWithOverrides(req, 'invoice.send', actorCtx, ownerId);
  if (!allowed) { sendOwnerAwareDenial(res, { allowed, reason }, 'Forbidden'); return; }

  const parsedBody = MarkInvoicePaidBody.safeParse(req.body ?? {});
  const extra = parsedBody.success ? parsedBody.data : {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Row-level lock prevents two concurrent mark-paid calls from both
    // reading status='open' and both inserting a payment row.
    const { rows: lockRows } = await client.query(
      `SELECT id, company_id, pin_id, invoice_type, amount_cents, status
         FROM customer_invoices
        WHERE id = $1 AND company_id = $2
        FOR UPDATE`,
      [req.params.invoiceId as string, actorCtx.companyId],
    ) as { rows: Array<{ id: string; company_id: string; pin_id: string; invoice_type: string; amount_cents: number; status: string }> };

    if (lockRows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const inv = lockRows[0];

    if (inv.status === 'void') {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Cannot mark a voided invoice as paid' });
      return;
    }

    if (inv.status === 'paid') {
      // Already paid — idempotent, return current state without a second ledger row.
      await client.query('ROLLBACK');
      const existing = await resolveInvoice(req.params.invoiceId as string, actorCtx.companyId);
      res.json({ invoice: existing });
      return;
    }

    // Determine payment type from invoice type.
    const paymentType =
      INVOICE_TYPE_TO_PAYMENT_TYPE[inv.invoice_type as keyof typeof INVOICE_TYPE_TO_PAYMENT_TYPE] ??
      'other';

    const paidDate = new Date();

    // Update invoice status.
    await client.query(
      `UPDATE customer_invoices
          SET status = 'paid',
              paid_date = $1,
              payment_method = $2,
              updated_at = now()
        WHERE id = $3
        RETURNING *`,
      [paidDate, extra.paymentMethod ?? null, inv.id],
    );

    // Insert matching payment ledger row linked back to this invoice.
    await client.query(
      `INSERT INTO payments
         (company_id, pin_id, type, amount_cents, method, payment_date,
          notes, customer_invoice_id, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        inv.company_id,
        inv.pin_id,
        paymentType,
        inv.amount_cents,
        extra.paymentMethod ?? null,
        paidDate,
        extra.notes ?? `Auto-created from invoice ${inv.id}`,
        inv.id,
        actorCtx.actorId,
      ],
    );

    await client.query('COMMIT');
    // Re-fetch via Drizzle so the response uses camelCase field names.
    const [paid] = await db
      .select()
      .from(customerInvoicesTable)
      .where(eq(customerInvoicesTable.id, inv.id));
    res.json({ invoice: paid });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /invoices/:invoiceId/void
// ---------------------------------------------------------------------------

// invoice.void — ownerOrRole: manager (Section 8 ruling)
router.post('/invoices/:invoiceId/void', async (req: Request, res: Response) => {
  const actorCtx = await loadActorCtx(req);
  if (!actorCtx) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const invoice = await resolveInvoice(req.params.invoiceId as string, actorCtx.companyId);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const ownerId = await getPinOwnerIdForInvoice(invoice.pinId);
  const { allowed, reason } = await resolveWithOverrides(req, 'invoice.void', actorCtx, ownerId);
  if (!allowed) { sendOwnerAwareDenial(res, { allowed, reason }, 'Forbidden'); return; }

  if (invoice.status === 'void') {
    // Already void — idempotent.
    res.json({ invoice });
    return;
  }

  // Unlink any linked payment row (set customer_invoice_id = NULL).
  // The payment ledger entry stays — money received is never deleted.
  if (invoice.status === 'paid') {
    await db
      .update(paymentsTable)
      .set({ customerInvoiceId: null })
      .where(eq(paymentsTable.customerInvoiceId, invoice.id));
  }

  const [updated] = await db
    .update(customerInvoicesTable)
    .set({ status: 'void' })
    .where(eq(customerInvoicesTable.id, invoice.id))
    .returning();
  res.json({ invoice: updated });
});

export default router;

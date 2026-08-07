/**
 * Change Orders + Overhead endpoints (migrations 028 + 030).
 *
 * Change Orders — per-lead document capturing additional or required scope:
 *   GET    /pins/:pinId/change-orders               — any authenticated member
 *   POST   /pins/:pinId/change-orders               — any authenticated member
 *                                                     (field reps capture on site)
 *   PATCH  /change-orders/:id                       — any authenticated member
 *                                                     (description + scope flag only)
 *   DELETE /change-orders/:id                       — manager+
 *
 * Change Order lifecycle (dedicated endpoints):
 *   POST   /change-orders/:id/sign                  — any authenticated member
 *   POST   /change-orders/:id/approve               — manager+ (gated by doc + sig)
 *   POST   /change-orders/:id/void                  — manager+
 *
 * Change Order Line Items (recompute CO.amount_cents on every write):
 *   POST   /change-orders/:id/line-items            — any authenticated member
 *   PATCH  /change-orders/:id/line-items/:itemId    — any authenticated member
 *   DELETE /change-orders/:id/line-items/:itemId    — any authenticated member
 *
 * Overhead amounts (per-lead single-value columns on pins):
 *   PATCH  /pins/:pinId/overhead                    — manager+; all five amounts
 *
 * Overhead mark-paid sub-endpoints (paid dates always set server-side):
 *   POST   /pins/:pinId/overhead/lead-acquisition/mark-paid
 *   POST   /pins/:pinId/overhead/referral/mark-paid
 *   POST   /pins/:pinId/overhead/sales/mark-paid
 *   POST   /pins/:pinId/overhead/canvassing/mark-paid
 *   POST   /pins/:pinId/overhead/pm/mark-paid
 *
 * Security invariants:
 *   - company_id and pin_id are NEVER client-settable via PATCH.
 *   - amount_cents is derived — never accepted from the client.
 *   - Overhead fields are NOT writable through the generic PATCH /pins/:pinId.
 *   - Paid dates are always server-stamped (NOW()), never client-supplied.
 *   - Approval is gated: document_object_path AND homeowner_signed_at must both
 *     be present before status can transition to 'approved'.
 */

import { and, eq, sum } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { ObjectStorageService } from '../lib/objectStorage';
import { decryptSmtpPassword } from '../lib/smtpCrypto';
import { resolvePublicSmtpAddress } from '../lib/smtpGuard';

const objectStorageService = new ObjectStorageService();
import {
  changeOrderLineItemsTable,
  changeOrdersTable,
  CHANGE_ORDER_STATUSES,
  db,
  pinsTable,
  userProfilesTable,
  usersTable,
} from '@workspace/db';
import { isManagerOrAdmin, type Role } from '@workspace/authz';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getRole(userId: string): Promise<Role> {
  const [row] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  return (row?.role ?? 'field_rep') as Role;
}

async function resolvePin(pinId: string, companyId: string) {
  const [pin] = await db
    .select()
    .from(pinsTable)
    .where(and(eq(pinsTable.id, pinId), eq(pinsTable.companyId, companyId)));
  return pin ?? null;
}

async function resolveChangeOrder(changeOrderId: string, companyId: string) {
  const [co] = await db
    .select()
    .from(changeOrdersTable)
    .where(
      and(
        eq(changeOrdersTable.id, changeOrderId),
        eq(changeOrdersTable.companyId, companyId),
      ),
    );
  return co ?? null;
}

async function resolveLineItem(itemId: string, changeOrderId: string) {
  const [item] = await db
    .select()
    .from(changeOrderLineItemsTable)
    .where(
      and(
        eq(changeOrderLineItemsTable.id, itemId),
        eq(changeOrderLineItemsTable.changeOrderId, changeOrderId),
      ),
    );
  return item ?? null;
}

/**
 * Recompute change_orders.amount_cents as the sum of its line items.
 * Called after every line-item create / update / delete.
 */
async function recomputeAmountCents(changeOrderId: string): Promise<number> {
  const [agg] = await db
    .select({ total: sum(changeOrderLineItemsTable.totalCents) })
    .from(changeOrderLineItemsTable)
    .where(eq(changeOrderLineItemsTable.changeOrderId, changeOrderId));
  const computed = Number(agg?.total ?? 0);
  await db
    .update(changeOrdersTable)
    .set({ amountCents: computed, updatedAt: new Date() })
    .where(eq(changeOrdersTable.id, changeOrderId));
  return computed;
}

/** Fetch all line items for a CO, ordered by sort_order then created_at. */
async function fetchLineItems(changeOrderId: string) {
  return db
    .select()
    .from(changeOrderLineItemsTable)
    .where(eq(changeOrderLineItemsTable.changeOrderId, changeOrderId))
    .orderBy(changeOrderLineItemsTable.sortOrder, changeOrderLineItemsTable.createdAt);
}

function lineItemShape(item: typeof changeOrderLineItemsTable.$inferSelect) {
  return {
    id:                item.id,
    changeOrderId:     item.changeOrderId,
    companyId:         item.companyId,
    description:       item.description,
    quantity:          String(item.quantity),
    unitPriceCents:    item.unitPriceCents,
    totalCents:        item.totalCents,
    priceBookItemId:   item.priceBookItemId ?? null,
    sortOrder:         item.sortOrder,
    createdAt:         item.createdAt.toISOString(),
    updatedAt:         item.updatedAt.toISOString(),
  };
}

function changeOrderShape(
  co: typeof changeOrdersTable.$inferSelect,
  lineItems: (typeof changeOrderLineItemsTable.$inferSelect)[],
) {
  return {
    id:                      co.id,
    companyId:               co.companyId,
    pinId:                   co.pinId,
    description:             co.description,
    amountCents:             co.amountCents,
    status:                  co.status,
    requiredToCompleteScope: co.requiredToCompleteScope,
    documentObjectPath:      co.documentObjectPath   ?? null,
    documentSha256:          co.documentSha256        ?? null,
    homeownerSignaturePath:  co.homeownerSignaturePath ?? null,
    homeownerSignedAt:       co.homeownerSignedAt?.toISOString() ?? null,
    repSignaturePath:        co.repSignaturePath      ?? null,
    repSignedAt:             co.repSignedAt?.toISOString()       ?? null,
    approvedAt:              co.approvedAt?.toISOString()        ?? null,
    voidedAt:                co.voidedAt?.toISOString()          ?? null,
    voidedByUserId:          co.voidedByUserId        ?? null,
    voidReason:              co.voidReason            ?? null,
    emailedAt:               co.emailedAt?.toISOString()         ?? null,
    createdByUserId:         co.createdByUserId,
    createdAt:               co.createdAt.toISOString(),
    updatedAt:               co.updatedAt.toISOString(),
    lineItems:               lineItems.map(lineItemShape),
  };
}

/** Shape the overhead response from a pin row. */
function overheadShape(pin: typeof pinsTable.$inferSelect) {
  return {
    leadAcquisitionCostCents:    pin.leadAcquisitionCostCents     ?? null,
    leadAcquisitionPaidDate:     pin.leadAcquisitionPaidDate?.toISOString()      ?? null,
    referralFeeCents:            pin.referralFeeCents              ?? null,
    referralFeePaidDate:         pin.referralFeePaidDate?.toISOString()          ?? null,
    salesCommissionCents:        pin.salesCommissionCents          ?? null,
    salesCommissionPaidDate:     pin.salesCommissionPaidDate?.toISOString()      ?? null,
    canvassingCommissionCents:   pin.canvassingCommissionCents     ?? null,
    canvassingCommissionPaidDate:pin.canvassingCommissionPaidDate?.toISOString() ?? null,
    pmCommissionCents:           pin.pmCommissionCents             ?? null,
    pmCommissionPaidDate:        pin.pmCommissionPaidDate?.toISOString()         ?? null,
  };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const LineItemInput = z.object({
  description:     z.string().min(1),
  quantity:        z.number().positive().default(1),
  unitPriceCents:  z.number().int(),
  priceBookItemId: z.string().optional(),
  sortOrder:       z.number().int().default(0),
});

const CreateChangeOrderBody = z.object({
  /** Client-generated UUID for offline idempotency — server uses it as the row id. */
  id:                      z.string().uuid().optional(),
  description:             z.string().min(1),
  requiredToCompleteScope: z.boolean().default(false),
  lineItems:               z.array(LineItemInput).default([]),
}).strict();

/** Like LineItemInput but also accepts a client-generated id for idempotent outbox replay. */
const CreateLineItemBody = LineItemInput.extend({
  id: z.string().uuid().optional(),
});

const UpdateChangeOrderBody = z.object({
  description:            z.string().min(1).optional(),
  requiredToCompleteScope: z.boolean().optional(),
}).strict();

const SignChangeOrderBody = z
  .object({
    // Mobile path: base64-encoded PDF generated on-device; server stores to object storage.
    pdfBase64:              z.string().min(1).optional(),
    sha256:                 z.string().optional(),
    // Legacy / CRM path: pre-uploaded object path accepted directly (no upload step).
    documentObjectPath:     z.string().min(1).optional(),
    documentSha256:         z.string().min(1).optional(),
    // Optional display names embedded in the audit record.
    homeownerName:          z.string().optional(),
    repName:                z.string().optional(),
    // Legacy signature image paths (kept for backward compat with direct-upload callers).
    homeownerSignaturePath: z.string().min(1).optional(),
    repSignaturePath:       z.string().optional(),
  })
  .strict()
  .refine((d) => !!(d.pdfBase64 || d.documentObjectPath), {
    message: 'Either pdfBase64 or documentObjectPath is required',
  });

const VoidChangeOrderBody = z.object({
  voidReason: z.string().min(1).optional(),
}).strict();

const UpdateLineItemBody = z.object({
  description:     z.string().min(1).optional(),
  quantity:        z.number().positive().optional(),
  unitPriceCents:  z.number().int().optional(),
  priceBookItemId: z.string().nullable().optional(),
  sortOrder:       z.number().int().optional(),
}).strict();

const UpdateOverheadBody = z.object({
  leadAcquisitionCostCents:  z.number().int().optional(),
  referralFeeCents:          z.number().int().optional(),
  salesCommissionCents:      z.number().int().optional(),
  canvassingCommissionCents: z.number().int().optional(),
  pmCommissionCents:         z.number().int().optional(),
}).strict();

// ---------------------------------------------------------------------------
// GET /pins/:pinId/change-orders
// ---------------------------------------------------------------------------

router.get(
  '/pins/:pinId/change-orders',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const pin = await resolvePin(req.params.pinId as string, req.user.companyId);
    if (!pin) {
      res.status(404).json({ error: 'Pin not found' });
      return;
    }
    const cos = await db
      .select()
      .from(changeOrdersTable)
      .where(
        and(
          eq(changeOrdersTable.pinId, pin.id),
          eq(changeOrdersTable.companyId, req.user.companyId),
        ),
      )
      .orderBy(changeOrdersTable.createdAt);

    const lineItemsByCoId = await (async () => {
      if (cos.length === 0) return new Map<string, typeof changeOrderLineItemsTable.$inferSelect[]>();
      const coIds = cos.map((c) => c.id);
      const allItems = await db
        .select()
        .from(changeOrderLineItemsTable)
        .where(
          and(
            eq(changeOrderLineItemsTable.companyId, req.user.companyId),
          ),
        );
      const filtered = allItems.filter((i) => coIds.includes(i.changeOrderId));
      const map = new Map<string, typeof changeOrderLineItemsTable.$inferSelect[]>();
      for (const item of filtered) {
        const arr = map.get(item.changeOrderId) ?? [];
        arr.push(item);
        map.set(item.changeOrderId, arr);
      }
      return map;
    })();

    res.json({
      changeOrders: cos.map((co) =>
        changeOrderShape(co, lineItemsByCoId.get(co.id) ?? []),
      ),
    });
  },
);

// ---------------------------------------------------------------------------
// POST /pins/:pinId/change-orders
// Any authenticated company member (field reps capture on site).
// ---------------------------------------------------------------------------

router.post(
  '/pins/:pinId/change-orders',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = CreateChangeOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const pin = await resolvePin(req.params.pinId as string, req.user.companyId);
    if (!pin) {
      res.status(404).json({ error: 'Pin not found' });
      return;
    }
    const { id: clientId, description, requiredToCompleteScope, lineItems } = parsed.data;

    // Compute the initial amount_cents from the provided line items.
    const initialAmount = lineItems.reduce(
      (acc, li) => acc + Math.round(li.quantity * li.unitPriceCents),
      0,
    );

    let co: typeof changeOrdersTable.$inferSelect;
    let items: (typeof changeOrderLineItemsTable.$inferSelect)[] = [];
    try {
      const [inserted] = await db
        .insert(changeOrdersTable)
        .values({
          ...(clientId ? { id: clientId } : {}),
          companyId:              req.user.companyId,
          pinId:                  pin.id,
          description,
          requiredToCompleteScope,
          amountCents:            initialAmount,
          createdByUserId:        req.user.id,
        })
        .returning();
      co = inserted!;

      // Insert line items if any.
      if (lineItems.length > 0) {
        items = await db
          .insert(changeOrderLineItemsTable)
          .values(
            lineItems.map((li) => ({
              companyId:       req.user.companyId,
              changeOrderId:   co.id,
              description:     li.description,
              quantity:        String(li.quantity),
              unitPriceCents:  li.unitPriceCents,
              totalCents:      Math.round(li.quantity * li.unitPriceCents),
              priceBookItemId: li.priceBookItemId ?? null,
              sortOrder:       li.sortOrder,
            })),
          )
          .returning();
      }
    } catch (err: unknown) {
      // 23505 = unique constraint violation: client id already exists on a replay.
      if ((err as { cause?: { code?: string } }).cause?.code === '23505') {
        res.status(409).json({ error: 'A change order with this ID already exists' });
        return;
      }
      throw err;
    }

    res.status(201).json({ changeOrder: changeOrderShape(co, items) });
  },
);

// ---------------------------------------------------------------------------
// PATCH /change-orders/:changeOrderId
// Mutable fields: description, requiredToCompleteScope.
// Any authenticated member (field reps may edit their own COs pre-signing).
// ---------------------------------------------------------------------------

router.patch(
  '/change-orders/:changeOrderId',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = UpdateChangeOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const co = await resolveChangeOrder(
      req.params.changeOrderId as string,
      req.user.companyId,
    );
    if (!co) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }

    const updates: Partial<typeof changeOrdersTable.$inferInsert> = {};
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.requiredToCompleteScope !== undefined) {
      updates.requiredToCompleteScope = parsed.data.requiredToCompleteScope;
    }
    // Always touch updatedAt so the Drizzle guard never fires with an empty set.
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(changeOrdersTable)
      .set(updates)
      .where(eq(changeOrdersTable.id, co.id))
      .returning();

    const items = await fetchLineItems(co.id);
    res.json({ changeOrder: changeOrderShape(updated!, items) });
  },
);

// ---------------------------------------------------------------------------
// DELETE /change-orders/:changeOrderId   — manager+
// ---------------------------------------------------------------------------

router.delete(
  '/change-orders/:changeOrderId',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const role = await getRole(req.user.id);
    if (!isManagerOrAdmin(role)) {
      res.status(403).json({ error: 'Manager or above required' });
      return;
    }
    const co = await resolveChangeOrder(
      req.params.changeOrderId as string,
      req.user.companyId,
    );
    if (!co) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }
    await db
      .delete(changeOrdersTable)
      .where(eq(changeOrdersTable.id, co.id));
    res.status(204).send();
  },
);

// ---------------------------------------------------------------------------
// POST /change-orders/:changeOrderId/sign
// Stamps homeownerSignedAt server-side; stores document paths + rep sig.
// Any authenticated member.
// ---------------------------------------------------------------------------

router.post(
  '/change-orders/:changeOrderId/sign',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = SignChangeOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const co = await resolveChangeOrder(
      req.params.changeOrderId as string,
      req.user.companyId,
    );
    if (!co) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }
    if (co.voidedAt) {
      res.status(409).json({ error: 'Cannot sign a voided change order' });
      return;
    }

    // Resolve document path: upload base64 PDF or accept a pre-uploaded path directly.
    let documentPath: string;
    let finalSha256: string | null = null;
    if (parsed.data.pdfBase64) {
      const buf = Buffer.from(parsed.data.pdfBase64, 'base64');
      documentPath = await objectStorageService.uploadObjectBuffer(buf, 'application/pdf');
      finalSha256 = parsed.data.sha256 ?? null;
    } else {
      documentPath = parsed.data.documentObjectPath!;
      finalSha256 = parsed.data.documentSha256 ?? null;
    }

    const now = new Date();
    const [updated] = await db
      .update(changeOrdersTable)
      .set({
        documentObjectPath:     documentPath,
        documentSha256:         finalSha256,
        homeownerSignaturePath: parsed.data.homeownerSignaturePath ?? null,
        homeownerSignedAt:      now,
        repSignaturePath:       parsed.data.repSignaturePath ?? null,
        // Always stamp repSignedAt — both parties sign via the PDF or signature paths.
        repSignedAt:            now,
        updatedAt:              now,
      })
      .where(eq(changeOrdersTable.id, co.id))
      .returning();

    const items = await fetchLineItems(co.id);
    res.json({ changeOrder: changeOrderShape(updated!, items) });
  },
);

// ---------------------------------------------------------------------------
// POST /change-orders/:changeOrderId/approve   — manager+
// Gate: document_object_path AND homeowner_signed_at must both be present.
// ---------------------------------------------------------------------------

router.post(
  '/change-orders/:changeOrderId/approve',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const role = await getRole(req.user.id);
    if (!isManagerOrAdmin(role)) {
      res.status(403).json({ error: 'Manager or above required' });
      return;
    }
    const co = await resolveChangeOrder(
      req.params.changeOrderId as string,
      req.user.companyId,
    );
    if (!co) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }
    if (co.voidedAt) {
      res.status(409).json({ error: 'Cannot approve a voided change order' });
      return;
    }
    if (!co.documentObjectPath || !co.homeownerSignedAt) {
      res.status(422).json({
        error:
          'Change order must be signed (document uploaded and homeowner signature captured) before it can be approved.',
      });
      return;
    }

    const [approved] = await db
      .update(changeOrdersTable)
      .set({ status: 'approved', approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(changeOrdersTable.id, co.id))
      .returning();

    // ── Best-effort email of the signed PDF on approval ──────────────────────
    // Mirrors the agreement.ts pattern: non-blocking, never rolls back the
    // approval, logged on failure. Sends to rep + owner if SMTP is configured.
    let finalEmailedAt: Date | null = null;
    if (approved!.documentObjectPath) {
      try {
        const [pin] = await db
          .select({ address: pinsTable.address, ownerEmail: pinsTable.ownerEmail })
          .from(pinsTable)
          .where(eq(pinsTable.id, co.pinId));

        const [actor] = await db
          .select({
            email:           usersTable.email,
            smtpHost:        userProfilesTable.smtpHost,
            smtpPort:        userProfilesTable.smtpPort,
            smtpSecure:      userProfilesTable.smtpSecure,
            smtpUsername:    userProfilesTable.smtpUsername,
            smtpPasswordEnc: userProfilesTable.smtpPasswordEnc,
            smtpFromEmail:   userProfilesTable.smtpFromEmail,
          })
          .from(userProfilesTable)
          .innerJoin(usersTable, eq(userProfilesTable.userId, usersTable.id))
          .where(eq(userProfilesTable.userId, req.user.id));

        if (actor?.smtpHost && actor.smtpPort && actor.smtpUsername && actor.smtpPasswordEnc) {
          const pdfBuffer  = await objectStorageService.readObjectEntityBytes(approved!.documentObjectPath);
          const password   = decryptSmtpPassword(actor.smtpPasswordEnc);
          const smtpAddr   = await resolvePublicSmtpAddress(actor.smtpHost);
          const transport  = nodemailer.createTransport({
            host:              smtpAddr,
            port:              actor.smtpPort,
            secure:            actor.smtpSecure ?? actor.smtpPort === 465,
            name:              undefined,
            auth:              { user: actor.smtpUsername, pass: password },
            tls:               { servername: actor.smtpHost },
            connectionTimeout: 15_000,
            socketTimeout:     30_000,
          });

          const propertyLabel = pin?.address ?? 'your property';
          const amountFmt     = `$${(approved!.amountCents / 100).toFixed(2)}`;
          const from          = actor.smtpFromEmail ?? actor.smtpUsername;
          const subject       = `Change Order Approved — ${propertyLabel}`;
          const text          = [
            'A change order has been approved.',
            '',
            `Property:  ${propertyLabel}`,
            `Amount:    ${amountFmt}`,
            `Approved:  ${new Date().toLocaleString()}`,
            '',
            'A copy of the signed change order document is attached for your records.',
          ].join('\n');
          const attachment = {
            filename:    'Change-Order.pdf',
            content:     pdfBuffer,
            contentType: 'application/pdf' as const,
          };

          const sends: Promise<unknown>[] = [];
          if (actor.email) {
            sends.push(transport.sendMail({ from, to: actor.email, subject, text, attachments: [attachment] }));
          }
          if (pin?.ownerEmail && pin.ownerEmail !== actor.email) {
            sends.push(transport.sendMail({ from, to: pin.ownerEmail, subject, text, attachments: [attachment] }));
          }
          await Promise.allSettled(sends);

          // Stamp emailedAt on the row.
          finalEmailedAt = new Date();
          await db
            .update(changeOrdersTable)
            .set({ emailedAt: finalEmailedAt, updatedAt: new Date() })
            .where(eq(changeOrdersTable.id, co.id));
        }
      } catch (err) {
        req.log?.warn({ err }, 'CO approval email — send failed, approval stands');
      }
    }

    const items = await fetchLineItems(co.id);
    res.json({
      changeOrder: changeOrderShape(
        { ...approved!, emailedAt: finalEmailedAt ?? approved!.emailedAt ?? null },
        items,
      ),
    });
  },
);

// ---------------------------------------------------------------------------
// POST /change-orders/:changeOrderId/void   — manager+
// Void in place; never hard-delete. A voided CO can be replaced with a new one.
// ---------------------------------------------------------------------------

router.post(
  '/change-orders/:changeOrderId/void',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const role = await getRole(req.user.id);
    if (!isManagerOrAdmin(role)) {
      res.status(403).json({ error: 'Manager or above required' });
      return;
    }
    const parsed = VoidChangeOrderBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const co = await resolveChangeOrder(
      req.params.changeOrderId as string,
      req.user.companyId,
    );
    if (!co) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }
    if (co.voidedAt) {
      res.status(409).json({ error: 'Change order is already voided' });
      return;
    }

    const [updated] = await db
      .update(changeOrdersTable)
      .set({
        voidedAt:        new Date(),
        voidedByUserId:  req.user.id,
        voidReason:      parsed.data.voidReason ?? null,
        // If it was approved, retract the approval so it leaves contract value.
        status:          co.status === 'approved' ? 'rejected' : co.status,
        approvedAt:      co.status === 'approved' ? null : co.approvedAt,
        updatedAt:       new Date(),
      })
      .where(eq(changeOrdersTable.id, co.id))
      .returning();

    const items = await fetchLineItems(co.id);
    res.json({ changeOrder: changeOrderShape(updated!, items) });
  },
);

// ---------------------------------------------------------------------------
// POST /change-orders/:changeOrderId/line-items
// Any authenticated member.
// ---------------------------------------------------------------------------

router.post(
  '/change-orders/:changeOrderId/line-items',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = CreateLineItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const co = await resolveChangeOrder(
      req.params.changeOrderId as string,
      req.user.companyId,
    );
    if (!co) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }
    if (co.voidedAt) {
      res.status(409).json({ error: 'Cannot modify a voided change order' });
      return;
    }

    const total = Math.round(parsed.data.quantity * parsed.data.unitPriceCents);
    let item: typeof changeOrderLineItemsTable.$inferSelect;
    try {
      const [inserted] = await db
        .insert(changeOrderLineItemsTable)
        .values({
          ...(parsed.data.id ? { id: parsed.data.id } : {}),
          companyId:       req.user.companyId,
          changeOrderId:   co.id,
          description:     parsed.data.description,
          quantity:        String(parsed.data.quantity),
          unitPriceCents:  parsed.data.unitPriceCents,
          totalCents:      total,
          priceBookItemId: parsed.data.priceBookItemId ?? null,
          sortOrder:       parsed.data.sortOrder,
        })
        .returning();
      item = inserted!;
    } catch (err: unknown) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505') {
        res.status(409).json({ error: 'A line item with this ID already exists' });
        return;
      }
      throw err;
    }

    await recomputeAmountCents(co.id);

    const items = await fetchLineItems(co.id);
    const [updatedCo] = await db
      .select()
      .from(changeOrdersTable)
      .where(eq(changeOrdersTable.id, co.id));

    res.status(201).json({
      lineItem:    lineItemShape(item!),
      changeOrder: changeOrderShape(updatedCo!, items),
    });
  },
);

// ---------------------------------------------------------------------------
// PATCH /change-orders/:changeOrderId/line-items/:lineItemId
// Any authenticated member.
// ---------------------------------------------------------------------------

router.patch(
  '/change-orders/:changeOrderId/line-items/:lineItemId',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = UpdateLineItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const co = await resolveChangeOrder(
      req.params.changeOrderId as string,
      req.user.companyId,
    );
    if (!co) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }
    if (co.voidedAt) {
      res.status(409).json({ error: 'Cannot modify a voided change order' });
      return;
    }
    const item = await resolveLineItem(req.params.lineItemId as string, co.id);
    if (!item) {
      res.status(404).json({ error: 'Line item not found' });
      return;
    }

    const updates: Partial<typeof changeOrderLineItemsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.description    !== undefined) updates.description    = parsed.data.description;
    if (parsed.data.sortOrder      !== undefined) updates.sortOrder      = parsed.data.sortOrder;
    if (parsed.data.priceBookItemId !== undefined) updates.priceBookItemId = parsed.data.priceBookItemId;

    // Recompute totalCents if quantity or unitPriceCents changed.
    const newQty   = parsed.data.quantity      ?? Number(item.quantity);
    const newPrice = parsed.data.unitPriceCents ?? item.unitPriceCents;
    if (parsed.data.quantity !== undefined) updates.quantity = String(parsed.data.quantity);
    if (parsed.data.unitPriceCents !== undefined) updates.unitPriceCents = parsed.data.unitPriceCents;
    updates.totalCents = Math.round(newQty * newPrice);

    const [updatedItem] = await db
      .update(changeOrderLineItemsTable)
      .set(updates)
      .where(eq(changeOrderLineItemsTable.id, item.id))
      .returning();

    await recomputeAmountCents(co.id);

    const items = await fetchLineItems(co.id);
    const [updatedCo] = await db
      .select()
      .from(changeOrdersTable)
      .where(eq(changeOrdersTable.id, co.id));

    res.json({
      lineItem:    lineItemShape(updatedItem!),
      changeOrder: changeOrderShape(updatedCo!, items),
    });
  },
);

// ---------------------------------------------------------------------------
// DELETE /change-orders/:changeOrderId/line-items/:lineItemId
// Any authenticated member.
// ---------------------------------------------------------------------------

router.delete(
  '/change-orders/:changeOrderId/line-items/:lineItemId',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const co = await resolveChangeOrder(
      req.params.changeOrderId as string,
      req.user.companyId,
    );
    if (!co) {
      res.status(404).json({ error: 'Change order not found' });
      return;
    }
    if (co.voidedAt) {
      res.status(409).json({ error: 'Cannot modify a voided change order' });
      return;
    }
    const item = await resolveLineItem(req.params.lineItemId as string, co.id);
    if (!item) {
      res.status(404).json({ error: 'Line item not found' });
      return;
    }

    await db
      .delete(changeOrderLineItemsTable)
      .where(eq(changeOrderLineItemsTable.id, item.id));

    await recomputeAmountCents(co.id);

    const items = await fetchLineItems(co.id);
    const [updatedCo] = await db
      .select()
      .from(changeOrdersTable)
      .where(eq(changeOrdersTable.id, co.id));

    res.json({ changeOrder: changeOrderShape(updatedCo!, items) });
  },
);

// ===========================================================================
// OVERHEAD endpoints (unchanged from migration 028 except unified here)
// ===========================================================================

// ---------------------------------------------------------------------------
// PATCH /pins/:pinId/overhead   — manager+
// ---------------------------------------------------------------------------

router.patch(
  '/pins/:pinId/overhead',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const role = await getRole(req.user.id);
    if (!isManagerOrAdmin(role)) {
      res.status(403).json({ error: 'Manager or above required' });
      return;
    }
    const parsed = UpdateOverheadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const pin = await resolvePin(req.params.pinId as string, req.user.companyId);
    if (!pin) {
      res.status(404).json({ error: 'Pin not found' });
      return;
    }

    const updates: Partial<typeof pinsTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.leadAcquisitionCostCents  !== undefined) updates.leadAcquisitionCostCents  = parsed.data.leadAcquisitionCostCents;
    if (parsed.data.referralFeeCents          !== undefined) updates.referralFeeCents          = parsed.data.referralFeeCents;
    if (parsed.data.salesCommissionCents      !== undefined) updates.salesCommissionCents      = parsed.data.salesCommissionCents;
    if (parsed.data.canvassingCommissionCents !== undefined) updates.canvassingCommissionCents = parsed.data.canvassingCommissionCents;
    if (parsed.data.pmCommissionCents         !== undefined) updates.pmCommissionCents         = parsed.data.pmCommissionCents;

    const [updated] = await db
      .update(pinsTable)
      .set(updates)
      .where(eq(pinsTable.id, pin.id))
      .returning();

    res.json({ overhead: overheadShape(updated!) });
  },
);

// ---------------------------------------------------------------------------
// Mark-paid sub-endpoints (always server-stamped)
// ---------------------------------------------------------------------------

// POST /pins/:pinId/overhead/lead-acquisition/mark-paid
router.post(
  '/pins/:pinId/overhead/lead-acquisition/mark-paid',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const role = await getRole(req.user.id);
    if (!isManagerOrAdmin(role)) { res.status(403).json({ error: 'Manager or above required' }); return; }
    const pin = await resolvePin(req.params.pinId as string, req.user.companyId);
    if (!pin) { res.status(404).json({ error: 'Pin not found' }); return; }
    if (!pin.leadAcquisitionCostCents) {
      res.status(400).json({ error: 'No lead acquisition cost is set — set it before marking paid' });
      return;
    }
    const [updated] = await db
      .update(pinsTable)
      .set({ leadAcquisitionPaidDate: new Date() })
      .where(eq(pinsTable.id, pin.id))
      .returning();
    res.json({ overhead: overheadShape(updated!) });
  },
);

// POST /pins/:pinId/overhead/referral/mark-paid
router.post(
  '/pins/:pinId/overhead/referral/mark-paid',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const role = await getRole(req.user.id);
    if (!isManagerOrAdmin(role)) { res.status(403).json({ error: 'Manager or above required' }); return; }
    const pin = await resolvePin(req.params.pinId as string, req.user.companyId);
    if (!pin) { res.status(404).json({ error: 'Pin not found' }); return; }
    if (!pin.referralFeeCents) {
      res.status(400).json({ error: 'No referral fee is set — set it before marking paid' });
      return;
    }
    const [updated] = await db
      .update(pinsTable)
      .set({ referralFeePaidDate: new Date() })
      .where(eq(pinsTable.id, pin.id))
      .returning();
    res.json({ overhead: overheadShape(updated!) });
  },
);

// POST /pins/:pinId/overhead/sales/mark-paid
// Mirrors /pins/:pinId/commissions/sales/mark-paid at the unified /overhead path.
router.post(
  '/pins/:pinId/overhead/sales/mark-paid',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const role = await getRole(req.user.id);
    if (!isManagerOrAdmin(role)) { res.status(403).json({ error: 'Manager or above required' }); return; }
    const pin = await resolvePin(req.params.pinId as string, req.user.companyId);
    if (!pin) { res.status(404).json({ error: 'Pin not found' }); return; }
    if (!pin.salesCommissionCents) {
      res.status(400).json({ error: 'No sales commission is set — set it before marking paid' });
      return;
    }
    const [updated] = await db
      .update(pinsTable)
      .set({ salesCommissionPaidDate: new Date() })
      .where(eq(pinsTable.id, pin.id))
      .returning();
    res.json({ overhead: overheadShape(updated!) });
  },
);

// POST /pins/:pinId/overhead/canvassing/mark-paid
router.post(
  '/pins/:pinId/overhead/canvassing/mark-paid',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const role = await getRole(req.user.id);
    if (!isManagerOrAdmin(role)) { res.status(403).json({ error: 'Manager or above required' }); return; }
    const pin = await resolvePin(req.params.pinId as string, req.user.companyId);
    if (!pin) { res.status(404).json({ error: 'Pin not found' }); return; }
    if (!pin.canvassingCommissionCents) {
      res.status(400).json({ error: 'No canvassing commission is set — set it before marking paid' });
      return;
    }
    const [updated] = await db
      .update(pinsTable)
      .set({ canvassingCommissionPaidDate: new Date() })
      .where(eq(pinsTable.id, pin.id))
      .returning();
    res.json({ overhead: overheadShape(updated!) });
  },
);

// POST /pins/:pinId/overhead/pm/mark-paid
// Mirrors /pins/:pinId/commissions/pm/mark-paid at the unified /overhead path.
router.post(
  '/pins/:pinId/overhead/pm/mark-paid',
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const role = await getRole(req.user.id);
    if (!isManagerOrAdmin(role)) { res.status(403).json({ error: 'Manager or above required' }); return; }
    const pin = await resolvePin(req.params.pinId as string, req.user.companyId);
    if (!pin) { res.status(404).json({ error: 'Pin not found' }); return; }
    if (!pin.pmCommissionCents) {
      res.status(400).json({ error: 'No PM commission amount is set — set it before marking paid' });
      return;
    }
    const [updated] = await db
      .update(pinsTable)
      .set({ pmCommissionPaidDate: new Date() })
      .where(eq(pinsTable.id, pin.id))
      .returning();
    res.json({ overhead: overheadShape(updated!) });
  },
);

export default router;

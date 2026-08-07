/**
 * Change order outbox enqueue helpers and React Query hooks.
 *
 * All writes are offline-first: they are enqueued to the SQLite outbox
 * and drained whenever connectivity is restored. Client-generated IDs
 * ensure replays are idempotent — see types.ts for the invariants.
 */
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { enqueueOutboxItemsBulk } from './outbox/queue';
import type {
  ChangeOrderCreateOutboxPayload,
  ChangeOrderLineItemOutboxPayload,
  ChangeOrderSignOutboxPayload,
} from './outbox/types';

// ── Types (mirroring server changeOrderShape) ─────────────────────────────────

export interface CoLineItem {
  id: string;
  changeOrderId: string;
  description: string;
  quantity: string;
  unitPriceCents: number;
  totalCents: number;
  priceBookItemId: string | null;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeOrder {
  id: string;
  pinId: string;
  status: 'pending' | 'approved' | 'rejected';
  description: string | null;
  requiredToCompleteScope: boolean;
  amountCents: number;
  documentObjectPath: string | null;
  documentSha256: string | null;
  homeownerSignedAt: string | null;
  repSignedAt: string | null;
  approvedAt: string | null;
  voidedAt: string | null;
  lineItems: CoLineItem[];
  createdAt: string;
  updatedAt: string;
}

// ── Query hooks ───────────────────────────────────────────────────────────────

export const getChangeOrdersQueryKey = (pinId: string) =>
  ['change-orders', pinId] as const;

export function useListChangeOrders(
  pinId: string,
  options?: Omit<UseQueryOptions<{ changeOrders: ChangeOrder[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getChangeOrdersQueryKey(pinId),
    queryFn: () =>
      customFetch<{ changeOrders: ChangeOrder[] }>(`/api/pins/${pinId}/change-orders`),
    enabled: !!pinId,
    staleTime: 30_000,
    ...options,
  });
}

// ── Outbox enqueue ────────────────────────────────────────────────────────────

export interface EnqueueChangeOrderInput {
  /** Client-generated UUID — used as the change order's server-side id. */
  clientId: string;
  pinId: string;
  description: string;
  requiredToCompleteScope: boolean;
  lineItems: Array<{
    /** Client-generated UUID for this line item. */
    clientId: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    priceBookItemId?: string | null;
    sortOrder?: number;
  }>;
  pdfBase64: string;
  sha256: string;
  homeownerName?: string;
  repName?: string;
}

/**
 * Atomically enqueue three outbox items for a complete change-order submission:
 *   1. change_order.create  — creates the CO (idempotent by clientId)
 *   2. change_order.line_item × N — creates each line item (idempotent by clientId)
 *   3. change_order.sign    — uploads signed PDF + SHA-256
 *
 * All items are enqueued in FIFO order. The outbox drainer processes them
 * oldest-first, so the create always lands before its line items, and
 * the sign lands after all line items exist server-side.
 *
 * Replaying the outbox twice will never duplicate a CO or line item because:
 *  - The server returns 409 on duplicate client-id inserts.
 *  - Each outbox handler catches 409 and treats it as success.
 */
/**
 * Atomically enqueue three outbox items for a complete change-order submission:
 *   1. change_order.create  — creates the CO (idempotent by clientId)
 *   2. change_order.line_item × N — creates each line item (idempotent by clientId)
 *   3. change_order.sign    — uploads signed PDF + SHA-256
 *
 * All items are enqueued in a single SQLite exclusive transaction so that a
 * process-kill between two inserts can never leave a partial (orphaned) sequence
 * in the outbox. The drain always sees either the full set or nothing.
 *
 * Replaying the outbox twice will never duplicate a CO or line item because:
 *  - The server returns 409 on duplicate client-id inserts.
 *  - Each outbox handler catches 409 and treats it as success.
 */
export async function enqueueChangeOrder(input: EnqueueChangeOrderInput): Promise<void> {
  const items: Array<{ kind: 'change_order.create' | 'change_order.line_item' | 'change_order.sign'; payload: ChangeOrderCreateOutboxPayload | ChangeOrderLineItemOutboxPayload | ChangeOrderSignOutboxPayload }> = [];

  // 1 — CO create
  const createPayload: ChangeOrderCreateOutboxPayload = {
    id: input.clientId,
    pinId: input.pinId,
    description: input.description,
    requiredToCompleteScope: input.requiredToCompleteScope,
  };
  items.push({ kind: 'change_order.create', payload: createPayload });

  // 2 — Line items (one per item, in order)
  for (const li of input.lineItems) {
    const liPayload: ChangeOrderLineItemOutboxPayload = {
      id: li.clientId,
      changeOrderId: input.clientId,
      description: li.description,
      quantity: li.quantity,
      unitPriceCents: li.unitPriceCents,
      priceBookItemId: li.priceBookItemId ?? null,
      sortOrder: li.sortOrder,
    };
    items.push({ kind: 'change_order.line_item', payload: liPayload });
  }

  // 3 — Sign (references the CO id created in step 1)
  const signPayload: ChangeOrderSignOutboxPayload = {
    changeOrderId: input.clientId,
    pdfBase64: input.pdfBase64,
    sha256: input.sha256,
    homeownerName: input.homeownerName,
    repName: input.repName,
  };
  items.push({ kind: 'change_order.sign', payload: signPayload });

  await enqueueOutboxItemsBulk(items);
}

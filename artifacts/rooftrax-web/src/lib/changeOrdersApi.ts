/**
 * Change-order API hooks for the web CRM.
 *
 * Uses React Query + customFetch directly (mirrors the pattern of
 * other hand-typed hooks in claimHubApi.ts).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

// ── Types (mirrors the server changeOrderShape) ───────────────────────────────

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
  homeownerSignaturePath: string | null;
  homeownerSignedAt: string | null;
  repSignaturePath: string | null;
  repSignedAt: string | null;
  approvedAt: string | null;
  voidedAt: string | null;
  voidedByUserId: string | null;
  voidReason: string | null;
  emailedAt: string | null;
  lineItems: CoLineItem[];
  createdAt: string;
  updatedAt: string;
}

// ── Query key ─────────────────────────────────────────────────────────────────

export const getChangeOrdersQueryKey = (pinId: string) =>
  ['change-orders', pinId] as const;

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useListPinChangeOrders(pinId: string) {
  return useQuery({
    queryKey: getChangeOrdersQueryKey(pinId),
    queryFn: () =>
      customFetch<{ changeOrders: ChangeOrder[] }>(
        `/api/pins/${pinId}/change-orders`,
      ),
    enabled: !!pinId,
    staleTime: 30_000,
  });
}

export function useApproveChangeOrder(pinId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changeOrderId: string) =>
      customFetch<{ changeOrder: ChangeOrder }>(
        `/api/change-orders/${changeOrderId}/approve`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getChangeOrdersQueryKey(pinId) });
      // Also invalidate profitability — revised contract value changes.
      void qc.invalidateQueries({ queryKey: ['pinProfitability', pinId] });
    },
  });
}

export function useVoidChangeOrder(pinId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ changeOrderId, voidReason }: { changeOrderId: string; voidReason?: string }) =>
      customFetch<{ changeOrder: ChangeOrder }>(
        `/api/change-orders/${changeOrderId}/void`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voidReason }),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getChangeOrdersQueryKey(pinId) });
      void qc.invalidateQueries({ queryKey: ['pinProfitability', pinId] });
    },
  });
}

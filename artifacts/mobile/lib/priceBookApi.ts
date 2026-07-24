/**
 * Price Book API hooks — kept local to the mobile app rather than going
 * through the shared api-client-react barrel, which has a TypeScript export
 * ordering issue with the generated orval file when new hand-written exports
 * are added alongside generated ones.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceBookItem {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number; // cents
  unit: string | null; // billing-unit label, e.g. "per square"
  createdAt: string;
  updatedAt: string;
}

export type InspectionCondition =
  | 'roof_damage'
  | 'siding_damage'
  | 'roof_and_siding_damage';

export interface PriceBookPackageItem {
  itemId: string;
  quantity: number;
}

export interface PriceBookPackage {
  id: string;
  name: string;
  inspectionCondition: InspectionCondition | null;
  items: PriceBookPackageItem[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const getPriceBookItemsQueryKey = () => ['price-book', 'items'] as const;
export const getPriceBookPackagesQueryKey = () => ['price-book', 'packages'] as const;

// ---------------------------------------------------------------------------
// Line item hooks
// ---------------------------------------------------------------------------

export function useListPriceBookItems(
  options?: Omit<UseQueryOptions<{ items: PriceBookItem[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getPriceBookItemsQueryKey(),
    queryFn: () => customFetch<{ items: PriceBookItem[] }>('/api/price-book/items'),
    ...options,
  });
}

export function useCreatePriceBookItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string | null;
      unitPrice: number;
      unit?: string | null;
    }) =>
      customFetch<{ item: PriceBookItem }>('/api/price-book/items', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getPriceBookItemsQueryKey() }),
  });
}

export function useUpdatePriceBookItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      description?: string | null;
      unitPrice?: number;
      unit?: string | null;
    }) =>
      customFetch<{ item: PriceBookItem }>(`/api/price-book/items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getPriceBookItemsQueryKey() }),
  });
}

export function useDeletePriceBookItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      customFetch<{ ok: boolean }>(`/api/price-book/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getPriceBookItemsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() });
    },
  });
}

/** AI-generate a reusable standard-scope description from name + unit. */
export function useGenerateItemDescription() {
  return useMutation({
    mutationFn: (data: { name: string; unit?: string | null }) =>
      customFetch<{ description: string }>('/api/price-book/generate-description', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

// ---------------------------------------------------------------------------
// Package hooks
// ---------------------------------------------------------------------------

export function useListPriceBookPackages(
  options?: Omit<UseQueryOptions<{ packages: PriceBookPackage[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getPriceBookPackagesQueryKey(),
    queryFn: () =>
      customFetch<{ packages: PriceBookPackage[] }>('/api/price-book/packages'),
    ...options,
  });
}

export function useCreatePriceBookPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      inspectionCondition?: InspectionCondition | null;
      itemAssignments?: PriceBookPackageItem[];
    }) =>
      customFetch<{ package: PriceBookPackage }>('/api/price-book/packages', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() }),
  });
}

export function useUpdatePriceBookPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      inspectionCondition?: InspectionCondition | null;
      itemAssignments?: PriceBookPackageItem[];
    }) =>
      customFetch<{ package: PriceBookPackage }>(`/api/price-book/packages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() }),
  });
}

export function useDeletePriceBookPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      customFetch<{ ok: boolean }>(`/api/price-book/packages/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() }),
  });
}

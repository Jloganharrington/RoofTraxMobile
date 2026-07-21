import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { customFetch } from './custom-fetch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceBookItem {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number; // stored in cents
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

export function useCreatePriceBookItem(
  options?: UseMutationOptions<
    { item: PriceBookItem },
    Error,
    { name: string; description?: string | null; unitPrice: number }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) =>
      customFetch<{ item: PriceBookItem }>('/api/price-book/items', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getPriceBookItemsQueryKey() }),
    ...options,
  });
}

export function useUpdatePriceBookItem(
  options?: UseMutationOptions<
    { item: PriceBookItem },
    Error,
    { id: string; name?: string; description?: string | null; unitPrice?: number }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) =>
      customFetch<{ item: PriceBookItem }>(`/api/price-book/items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getPriceBookItemsQueryKey() }),
    ...options,
  });
}

export function useDeletePriceBookItem(
  options?: UseMutationOptions<{ ok: boolean }, Error, string>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      customFetch<{ ok: boolean }>(`/api/price-book/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getPriceBookItemsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() });
    },
    ...options,
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
    queryFn: () => customFetch<{ packages: PriceBookPackage[] }>('/api/price-book/packages'),
    ...options,
  });
}

export function useCreatePriceBookPackage(
  options?: UseMutationOptions<
    { package: PriceBookPackage },
    Error,
    {
      name: string;
      inspectionCondition?: InspectionCondition | null;
      itemAssignments?: PriceBookPackageItem[];
    }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) =>
      customFetch<{ package: PriceBookPackage }>('/api/price-book/packages', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() }),
    ...options,
  });
}

export function useUpdatePriceBookPackage(
  options?: UseMutationOptions<
    { package: PriceBookPackage },
    Error,
    {
      id: string;
      name?: string;
      inspectionCondition?: InspectionCondition | null;
      itemAssignments?: PriceBookPackageItem[];
    }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) =>
      customFetch<{ package: PriceBookPackage }>(`/api/price-book/packages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() }),
    ...options,
  });
}

export function useDeletePriceBookPackage(
  options?: UseMutationOptions<{ ok: boolean }, Error, string>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      customFetch<{ ok: boolean }>(`/api/price-book/packages/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() }),
    ...options,
  });
}

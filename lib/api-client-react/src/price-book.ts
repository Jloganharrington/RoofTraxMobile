/**
 * Manual price-book hooks for Packages (not yet in the OpenAPI spec).
 * Item hooks (useListPriceBookItems, useCreatePriceBookItem, etc.) and
 * the PriceBookItem type are now generated — import them from the barrel.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { customFetch } from './custom-fetch';

// ---------------------------------------------------------------------------
// Types (packages only — PriceBookItem is now generated)
// ---------------------------------------------------------------------------

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

export const getPriceBookPackagesQueryKey = () => ['price-book', 'packages'] as const;

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

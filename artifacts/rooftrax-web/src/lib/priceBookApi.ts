/**
 * Price Book API hooks for packages and AI description generation.
 * These endpoints are not yet in the OpenAPI spec so we wire them up
 * manually via customFetch (same pattern the mobile app uses).
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

export const getPriceBookPackagesQueryKey = () =>
  ['price-book', 'packages'] as const;

// ---------------------------------------------------------------------------
// Package hooks
// ---------------------------------------------------------------------------

export function useListPriceBookPackages(
  options?: Omit<
    UseQueryOptions<{ packages: PriceBookPackage[] }>,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery({
    queryKey: getPriceBookPackagesQueryKey(),
    queryFn: () =>
      customFetch<{ packages: PriceBookPackage[] }>('/api/price-book/packages'),
    ...options,
  });
}

export function useCreatePriceBookPackage() {
  const qc = useQueryClient();
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
      qc.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() }),
  });
}

export function useUpdatePriceBookPackage() {
  const qc = useQueryClient();
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
      customFetch<{ package: PriceBookPackage }>(
        `/api/price-book/packages/${id}`,
        { method: 'PATCH', body: JSON.stringify(data) },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() }),
  });
}

export function useDeletePriceBookPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      customFetch<{ ok: boolean }>(`/api/price-book/packages/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() }),
  });
}

// ---------------------------------------------------------------------------
// AI description generation
// ---------------------------------------------------------------------------

export function useGenerateItemDescription() {
  return useMutation({
    mutationFn: (data: { name: string; unit?: string | null }) =>
      customFetch<{ description: string; assumptions: string[]; recommendedSeparateItems: string[]; warnings: string[] }>(
        '/api/price-book/generate-description',
        { method: 'POST', body: JSON.stringify(data) },
      ),
  });
}

// ---------------------------------------------------------------------------
// AI price analysis
// ---------------------------------------------------------------------------

export interface PriceAnalysisResult {
  targetPrice: number; // dollars
  raw: string;         // full model response text
}

export function useAnalyzeItemPrice() {
  return useMutation({
    mutationFn: (data: {
      name: string;
      description: string;
      unitPrice: number; // cents
      unit?: string | null;
    }) =>
      customFetch<PriceAnalysisResult>('/api/price-book/analyze-price', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

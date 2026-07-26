/**
 * Known Product Catalog (discontinued roofing products) API hooks — kept
 * local to the mobile app like priceBookApi (the shared api-client-react
 * barrel has an export-ordering issue with hand-written hooks).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export interface DiscontinuedProduct {
  id: string;
  name: string;
  photoPath: string | null;
  widthInches: number | null;
  exposureInches: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscontinuedProductInput {
  name: string;
  photoPath?: string | null;
  widthInches?: number | null;
  exposureInches?: number | null;
}

export const getDiscontinuedProductsQueryKey = () => ['discontinued-products'] as const;

export function useListDiscontinuedProducts(
  options?: Omit<UseQueryOptions<{ products: DiscontinuedProduct[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getDiscontinuedProductsQueryKey(),
    queryFn: () => customFetch<{ products: DiscontinuedProduct[] }>('/api/discontinued-products'),
    ...options,
  });
}

export function useCreateDiscontinuedProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DiscontinuedProductInput) =>
      customFetch<{ product: DiscontinuedProduct }>('/api/discontinued-products', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getDiscontinuedProductsQueryKey() }),
  });
}

export function useUpdateDiscontinuedProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<DiscontinuedProductInput>) =>
      customFetch<{ product: DiscontinuedProduct }>(`/api/discontinued-products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getDiscontinuedProductsQueryKey() }),
  });
}

export function useDeleteDiscontinuedProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      await customFetch<void>(`/api/discontinued-products/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getDiscontinuedProductsQueryKey() }),
  });
}

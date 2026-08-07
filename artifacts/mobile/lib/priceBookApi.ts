/**
 * Price book API hooks — read-only, offline-capable.
 *
 * Strategy:
 *  1. Try the network (customFetch → GET /api/price-book/items).
 *  2. On success, atomically replace the SQLite cache so the data survives
 *     the next cold start or airplane-mode session.
 *  3. On network failure, fall back to the SQLite cache. If the cache is
 *     also empty the error propagates so the UI can show a useful message.
 *
 * networkMode: 'always' makes React Query execute the queryFn even when the
 * device is offline — our queryFn handles the fallback internally instead of
 * letting React Query skip the call and show a stale/loading state.
 *
 * usePriceBookSync:
 *  Subscribes to NetInfo connectivity changes and invalidates the React Query
 *  cache whenever the device regains internet access. Mount this once near the
 *  top of the component tree (e.g. DashboardScreen) so the price book is
 *  always warm after login and after reconnects.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { customFetch } from '@workspace/api-client-react';
import {
  getPriceBookFromCache,
  savePriceBookToCache,
  type CachedPriceBookItem,
} from './priceBookCache';

export type PriceBookItem = CachedPriceBookItem;

export const getPriceBookQueryKey = () => ['price-book-items'] as const;

export function useListPriceBookItems(
  options?: Omit<UseQueryOptions<{ items: PriceBookItem[] }>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: getPriceBookQueryKey(),
    queryFn: async () => {
      try {
        const result = await customFetch<{ items: PriceBookItem[] }>('/api/price-book/items');
        // Side-effect: persist to SQLite — do not await so the UI unblocks
        // immediately; a write failure only affects the next cold-start.
        savePriceBookToCache(result.items).catch((err) =>
          console.warn('[priceBookCache] write failed:', err),
        );
        return result;
      } catch (networkErr) {
        // Network unavailable or server error — try the local SQLite cache.
        const cached = await getPriceBookFromCache();
        if (cached.length > 0) {
          return { items: cached };
        }
        // Cache empty (first ever launch with no connectivity): propagate.
        throw networkErr;
      }
    },
    // Always execute the queryFn so the offline fallback path runs.
    networkMode: 'always',
    // 5-minute freshness window — React Query refetches opportunistically
    // on focus/reconnect but won't thrash the server on every render.
    staleTime: 5 * 60_000,
    // One retry covers transient blips; the fallback handles sustained outages.
    retry: 1,
    ...options,
  });
}

/**
 * Mount once near the root of the authenticated screen tree.
 * Invalidates the price book query whenever the device regains internet access
 * so the cache is refreshed without requiring a manual pull-to-refresh.
 */
export function usePriceBookSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state: Network.NetworkState) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        queryClient.invalidateQueries({ queryKey: getPriceBookQueryKey() });
      }
    });
    return () => subscription.remove();
  }, [queryClient]);
}

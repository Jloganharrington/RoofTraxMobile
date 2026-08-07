/**
 * Price Book List screen.
 *
 * Dual purpose:
 *  1. Standalone — verifiable offline cache behavior (Checkpoint 2).
 *  2. Picker — used from the Change Order line-item flow (Step 3) via
 *     router.push('/price-book-list?mode=pick') so the caller gets
 *     the selected item back through router params / a shared store.
 *
 * Offline behavior:
 *  • First render while online: fetches from server, stores to SQLite.
 *  • Airplane mode: serves the last-known SQLite snapshot; banner shown.
 *  • Reconnect: React Query auto-refreshes (via usePriceBookSync).
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Network from 'expo-network';
import { useColors } from '@/hooks/useColors';
import { useListPriceBookItems, type PriceBookItem } from '@/lib/priceBookApi';

/** Tracks real-time connectivity so the offline banner is accurate. */
function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    Network.getNetworkStateAsync().then((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    const sub = Network.addNetworkStateListener((state: Network.NetworkState) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    return () => sub.remove();
  }, []);
  return online;
}

function centsToDisplay(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : '';
  return `${sign}$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface ItemRowProps {
  item: PriceBookItem;
  onSelect?: (item: PriceBookItem) => void;
  colors: ReturnType<typeof useColors>;
}

function ItemRow({ item, onSelect, colors }: ItemRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.border },
      ]}
      onPress={() => onSelect?.(item)}
      accessible
      accessibilityLabel={`${item.name}, ${centsToDisplay(item.unitPrice)}${item.unit ? ' ' + item.unit : ''}`}
    >
      <View style={styles.rowMain}>
        <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={1}>
          {item.name}
        </Text>
        {!!item.description && (
          <Text style={[styles.itemDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
            {item.description}
          </Text>
        )}
      </View>
      <View style={styles.rowPrice}>
        <Text style={[styles.priceText, { color: colors.foreground }]}>
          {centsToDisplay(item.unitPrice)}
        </Text>
        {!!item.unit && (
          <Text style={[styles.unitText, { color: colors.mutedForeground }]}>{item.unit}</Text>
        )}
      </View>
    </Pressable>
  );
}

export default function PriceBookListScreen() {
  const colors = useColors();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isPicker = mode === 'pick';

  const isOnline = useIsOnline();
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, isFetching, refetch } = useListPriceBookItems();

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q) ||
        (i.unit ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  function handleSelect(item: PriceBookItem) {
    if (isPicker) {
      // Pass the selection back using Expo Router's params.
      // Callers subscribe to router.setParams or use a shared store.
      router.setParams({
        selectedPriceBookItemId: item.id,
        selectedPriceBookItemName: item.name,
        selectedPriceBookItemUnitPrice: String(item.unitPrice),
        selectedPriceBookItemUnit: item.unit ?? '',
      });
      router.back();
    }
  }

  // Show the offline banner when: we have data to display but have no connectivity.
  // isFetching = true while React Query is retrying after reconnect, so we hide it then.
  const showOfflineBanner = !isOnline && !!data && !isFetching;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Offline notice — shown only when the device has no connectivity */}
      {showOfflineBanner && (
        <View style={[styles.offlineBanner, { backgroundColor: colors.muted }]}>
          <Text style={[styles.offlineText, { color: colors.mutedForeground }]}>
            Offline — showing cached price book
          </Text>
        </View>
      )}
      {isFetching && !!data && (
        <View style={[styles.offlineBanner, { backgroundColor: colors.muted }]}>
          <Text style={[styles.offlineText, { color: colors.mutedForeground }]}>Refreshing…</Text>
        </View>
      )}

      {/* Search bar */}
      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search items…"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading price book…
          </Text>
        </View>
      )}

      {isError && !data && (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive ?? '#ef4444' }]}>
            Unable to load price book.
          </Text>
          <Pressable onPress={() => void refetch()} style={styles.retryBtn}>
            <Text style={{ color: colors.primary }}>Try again</Text>
          </Pressable>
        </View>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {search ? 'No items match your search.' : 'No price book items yet.'}
          </Text>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <ItemRow item={item} onSelect={isPicker ? handleSelect : undefined} colors={colors} />
        )}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  offlineBanner: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  offlineText: { fontSize: 12 },
  searchBar: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: { fontSize: 15, height: 24 },
  list: { paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, marginRight: 12 },
  rowPrice: { alignItems: 'flex-end', minWidth: 70 },
  itemName: { fontSize: 15, fontWeight: '500', marginBottom: 2 },
  itemDesc: { fontSize: 13, lineHeight: 18 },
  priceText: { fontSize: 15, fontWeight: '600' },
  unitText: { fontSize: 12, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  loadingText: { fontSize: 14, marginTop: 8 },
  errorText: { fontSize: 14, textAlign: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },
  retryBtn: { padding: 8 },
});

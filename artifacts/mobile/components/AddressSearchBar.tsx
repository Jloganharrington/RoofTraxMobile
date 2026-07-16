import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '@/components/Icon';
import { getSearchAddressQueryKey, useSearchAddress } from '@workspace/api-client-react';
import type { GeocodeSearchResult } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export interface LocalAddressItem {
  address: string;
  latitude: number;
  longitude: number;
}

// Free-text address search. Matches the caller's own pins/records FIRST with an
// instant, case-insensitive substring match (no network) — that covers the
// common "find a property we already pinned" case. Only when nothing local
// matches does it fall back to the debounced /geocode/search worldwide lookup,
// which can be slow (public Nominatim). The caller decides what happens when a
// result is picked (recenter a real map, or offer to drop a pin, on platforms
// with no map to pan).
export function AddressSearchBar({
  onSelect,
  placeholder = 'Search an address…',
  variant = 'floating',
  localItems = [],
}: {
  onSelect: (result: GeocodeSearchResult) => void;
  placeholder?: string;
  // "floating" absolutely positions the bar over a map (native). "inline"
  // renders in normal document flow, for the web list fallback which has
  // no map to overlay.
  variant?: 'floating' | 'inline';
  // Already-loaded records (e.g. the map's pins) matched locally before any
  // network lookup happens.
  localItems?: LocalAddressItem[];
}) {
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(handle);
  }, [query]);

  // Instant local matching: plain case-insensitive substring over the caller's
  // records. Uses the live (undebounced) query so results update per keystroke.
  const trimmed = query.trim();
  const localMatches = useMemo(() => {
    if (trimmed.length < 2) return [];
    const needle = trimmed.toLowerCase();
    return localItems
      .filter((item) => item.address.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [localItems, trimmed]);

  // Only hit the (slow, external) geocoder when nothing local matches AND the
  // debounced query has caught up with what the user currently sees. Gating on
  // `debouncedQuery === trimmed` prevents a stale fetch (and stale results)
  // during the window where the user has edited the text but the debounce
  // hasn't fired yet — e.g. backspacing below 3 chars.
  const params = { q: debouncedQuery };
  const remoteEnabled =
    trimmed.length >= 3 && debouncedQuery === trimmed && localMatches.length === 0;
  const searchQuery = useSearchAddress(params, {
    query: {
      enabled: remoteEnabled,
      queryKey: getSearchAddressQueryKey(params),
    },
  });

  // Remote results render only while remote mode is genuinely active for the
  // current input; otherwise they'd flash stale content mid-typing.
  const results = remoteEnabled ? searchQuery.data?.results ?? [] : [];

  function handleSelect(result: GeocodeSearchResult) {
    setQuery(result.address);
    setOpen(false);
    onSelect(result);
  }

  function handleClear() {
    setQuery('');
    setDebouncedQuery('');
    setOpen(false);
  }

  return (
    <View style={variant === 'floating' ? styles.wrapper : styles.wrapperInline}>
      <View
        style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Icon name="map-pin" size={16} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground }]}
        />
        {remoteEnabled && searchQuery.isFetching ? (
          <ActivityIndicator size="small" />
        ) : query.length > 0 ? (
          <Pressable onPress={handleClear} hitSlop={8}>
            <Icon name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {open && (localMatches.length > 0 || trimmed.length >= 3) && (
        <View
          style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          {localMatches.length > 0 ? (
            localMatches.map((item, index) => (
              <Pressable
                key={`${item.latitude},${item.longitude},${index}`}
                onPress={() =>
                  handleSelect({
                    address: item.address,
                    latitude: item.latitude,
                    longitude: item.longitude,
                  })
                }
                style={[
                  styles.resultRow,
                  index < localMatches.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <Icon name="map-pin" size={14} color={colors.primary} />
                <Text
                  style={[styles.resultText, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {item.address}
                </Text>
                <Text style={[styles.tag, { color: colors.mutedForeground }]}>Pinned</Text>
              </Pressable>
            ))
          ) : !remoteEnabled || searchQuery.isFetching ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              Searching…
            </Text>
          ) : results.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No matches found
            </Text>
          ) : (
            results.map((result, index) => (
              <Pressable
                key={`${result.latitude},${result.longitude},${index}`}
                onPress={() => handleSelect(result)}
                style={[
                  styles.resultRow,
                  index < results.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <Icon name="map-pin" size={14} color={colors.mutedForeground} />
                <Text
                  style={[styles.resultText, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {result.address}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 16 : 60,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  wrapperInline: {
    marginHorizontal: 16,
    marginTop: 12,
    zIndex: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  input: { flex: 1, fontSize: 15 },
  dropdown: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resultText: { flex: 1, fontSize: 14 },
  tag: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { padding: 12, fontSize: 13, textAlign: 'center' },
});

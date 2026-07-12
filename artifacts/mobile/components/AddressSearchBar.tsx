import React, { useEffect, useState } from 'react';
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

// Debounced free-text address search, backed by /geocode/search. Lets a rep
// look up a specific address instead of only working off their current GPS
// position. Renders as a floating search bar with a results dropdown; the
// caller decides what happens when a result is picked (recenter a real map,
// or offer to drop a pin, on platforms with no map to pan).
export function AddressSearchBar({
  onSelect,
  placeholder = 'Search an address…',
  variant = 'floating',
}: {
  onSelect: (result: GeocodeSearchResult) => void;
  placeholder?: string;
  // "floating" absolutely positions the bar over a map (native). "inline"
  // renders in normal document flow, for the web list fallback which has
  // no map to overlay.
  variant?: 'floating' | 'inline';
}) {
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(handle);
  }, [query]);

  const params = { q: debouncedQuery };
  const searchQuery = useSearchAddress(params, {
    query: {
      enabled: debouncedQuery.length >= 3,
      queryKey: getSearchAddressQueryKey(params),
    },
  });

  const results = searchQuery.data?.results ?? [];

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
        {searchQuery.isFetching ? (
          <ActivityIndicator size="small" />
        ) : query.length > 0 ? (
          <Pressable onPress={handleClear} hitSlop={8}>
            <Icon name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {open && debouncedQuery.length >= 3 && (
        <View
          style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          {results.length === 0 && !searchQuery.isFetching ? (
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
  empty: { padding: 12, fontSize: 13, textAlign: 'center' },
});

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { getSearchAddressQueryKey, useSearchAddress } from '@workspace/api-client-react';
import type { GeocodeSearchResult } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

// A labeled address field with debounced autocomplete, backed by /geocode/search.
// It stays a CONTROLLED text input so manual entry always works (offline-first:
// if the geocoder is unreachable the rep can still type the address and submit).
// Picking a suggestion fills the address text and hands the caller the matched
// coordinates so the record is created with an accurate lat/long.
export function AddressAutocompleteField({
  label = 'Property address',
  value,
  onChangeText,
  onSelectResult,
  placeholder = '123 Main St',
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  onSelectResult: (result: GeocodeSearchResult) => void;
  placeholder?: string;
}) {
  const colors = useColors();
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  // The exact text last chosen from a suggestion. While the input still shows
  // that text we suppress the dropdown, so selecting a result doesn't instantly
  // re-open the list with the same query.
  const selectedRef = useRef<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value.trim()), 350);
    return () => clearTimeout(handle);
  }, [value]);

  const suppressed = selectedRef.current !== null && selectedRef.current === value.trim();
  const params = { q: debounced };
  const searchQuery = useSearchAddress(params, {
    query: {
      enabled: open && !suppressed && debounced.length >= 3,
      queryKey: getSearchAddressQueryKey(params),
    },
  });

  const results = searchQuery.data?.results ?? [];
  const showDropdown = open && !suppressed && debounced.length >= 3;

  function handleSelect(result: GeocodeSearchResult) {
    selectedRef.current = result.address;
    onChangeText(result.address);
    onSelectResult(result);
    setOpen(false);
  }

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Icon name="map-pin" size={16} color={colors.mutedForeground} />
        <TextInput
          value={value}
          onChangeText={(text) => {
            selectedRef.current = null;
            onChangeText(text);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="words"
          autoCorrect={false}
          style={[styles.input, { color: colors.foreground }]}
        />
        {searchQuery.isFetching ? <ActivityIndicator size="small" /> : null}
      </View>

      {showDropdown && (
        <View
          style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          {results.length === 0 && !searchQuery.isFetching ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No matches — you can enter the address manually
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
  // A high zIndex keeps the absolutely-positioned dropdown above the fields
  // rendered after this one in the form.
  field: { gap: 8, zIndex: 20, position: 'relative' },
  label: { fontSize: 13, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: { flex: 1, fontSize: 15 },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
    zIndex: 30,
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

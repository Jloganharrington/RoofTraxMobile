/**
 * Agreements tracker tab — signed FIPSA list for the rep's company.
 * Managers see all; field reps see only their own. Supports free-text search.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useListAgreements, type AgreementListItem } from '@/lib/agreementApi';

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function AgreementCard({
  item,
  colors,
  onPress,
}: {
  item: AgreementListItem;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
  onPress: () => void;
}) {
  const isScheduled = !!item.scheduledFor && !item.voidedAt;
  const isVoided = !!item.voidedAt;

  return (
    <Pressable
      onPress={onPress}
      disabled={!item.downloadUrl}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={styles.cardLeft}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + '18' }]}>
          <Icon name="file-text" size={20} color={colors.primary} />
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.address, { color: colors.foreground }]} numberOfLines={1}>
          {item.propertyAddress ?? 'Unknown address'}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.homeownerName ?? item.signerName}
        </Text>
        <Text style={[styles.date, { color: colors.mutedForeground }]}>
          Signed {formatDate(item.signedAt)}
        </Text>
      </View>
      <View style={styles.cardRight}>
        {isVoided && (
          <View style={[styles.badge, { backgroundColor: colors.destructive + '22' }]}>
            <Text style={[styles.badgeText, { color: colors.destructive }]}>Voided</Text>
          </View>
        )}
        {isScheduled && !isVoided && (
          <View style={[styles.badge, { backgroundColor: colors.insurance + '22' }]}>
            <Text style={[styles.badgeText, { color: colors.insurance }]}>Scheduled</Text>
          </View>
        )}
        {item.downloadUrl ? (
          <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
        ) : (
          <Icon name="shield" size={16} color={colors.mutedForeground} />
        )}
      </View>
    </Pressable>
  );
}

export default function AgreementsScreen() {
  const colors = useColors();
  const [searchText, setSearchText] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQ(searchText.trim()), 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchText]);

  const { data, isLoading, isRefetching, refetch } = useListAgreements(
    debouncedQ || undefined,
  );

  const agreements = data?.agreements ?? [];

  const handlePress = useCallback((item: AgreementListItem) => {
    if (!item.downloadUrl) return;
    router.push({
      pathname: '/agreement-detail',
      params: {
        downloadUrl: item.downloadUrl,
        propertyAddress: item.propertyAddress ?? '',
        signerName: item.signerName,
      },
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: AgreementListItem }) => (
      <AgreementCard item={item} colors={colors} onPress={() => handlePress(item)} />
    ),
    [colors, handlePress],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Search bar */}
      <View style={[styles.searchWrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Icon name="edit-3" size={16} color={colors.mutedForeground} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search by address or homeowner…"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {searchText.length > 0 && Platform.OS !== 'ios' && (
          <Pressable onPress={() => setSearchText('')} hitSlop={8}>
            <Icon name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={agreements}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Icon name="file-text" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {debouncedQ ? 'No matching agreements' : 'No agreements yet'}
              </Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                {debouncedQ
                  ? 'Try a different address or homeowner name.'
                  : 'Signed FIPSAs will appear here after they are collected in the field.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 2,
  },
  list: {
    padding: 16,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardLeft: { alignItems: 'center', justifyContent: 'center' },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 2 },
  address: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 13 },
  date: { fontSize: 12 },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});

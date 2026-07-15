import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import {
  getListInspectionsQueryKey,
  getListScheduledInspectionsQueryKey,
  useListInspections,
  useListScheduledInspections,
} from '@workspace/api-client-react';
import type { Inspection, InspectionStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';

const STATUS_LABEL: Record<InspectionStatus, string> = {
  scheduled: 'Scheduled',
  capturing: 'Capturing',
  validating: 'Validating',
  submitted: 'Submitted',
  package_ready: 'Package ready',
};

export default function InspectionsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();

  const scheduled = useListScheduledInspections({
    query: { queryKey: getListScheduledInspectionsQueryKey() },
  });
  const mine = useListInspections({
    query: { queryKey: getListInspectionsQueryKey() },
  });

  const scheduledItems = scheduled.data?.scheduled ?? [];
  const inspections = mine.data?.inspections ?? [];

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListScheduledInspectionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListInspectionsQueryKey() }),
    ]);
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={scheduled.isRefetching || mine.isRefetching}
          onRefresh={refresh}
          tintColor={colors.primary}
        />
      }
    >
      <Pressable
        onPress={() => router.push('/inspection-start')}
        style={[styles.startCta, { backgroundColor: colors.primary }]}
      >
        <Icon name="plus" size={20} color={colors.primaryForeground} />
        <Text style={[styles.startCtaText, { color: colors.primaryForeground }]}>
          Start an inspection
        </Text>
      </Pressable>

      <Text style={[styles.section, { color: colors.foreground }]}>Scheduled</Text>
      {scheduled.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
      ) : scheduledItems.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Icon name="calendar" size={20} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, flex: 1 }}>
            No scheduled inspections. Assignments from your CRM will appear here.
          </Text>
        </View>
      ) : (
        scheduledItems.map((item) => (
          <Pressable
            key={item.id}
            onPress={() =>
              router.push({
                pathname: '/inspection-intake',
                params: {
                  insuredName: item.insuredName ?? '',
                  address: item.propertyAddress ?? '',
                  carrierName: item.carrier ?? '',
                  policyNumber: item.policyNumber ?? '',
                  claimNumber: item.claimNumber ?? '',
                  dateOfLoss: item.dateOfLoss ?? '',
                  latitude: item.latitude != null ? String(item.latitude) : '',
                  longitude: item.longitude != null ? String(item.longitude) : '',
                },
              })
            }
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {item.insuredName ?? 'Scheduled inspection'}
              </Text>
              <Text style={{ color: colors.mutedForeground }} numberOfLines={1}>
                {item.propertyAddress ?? '—'}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ))
      )}

      <Text style={[styles.section, { color: colors.foreground }]}>My inspections</Text>
      {mine.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
      ) : inspections.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Icon name="clipboard" size={20} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, flex: 1 }}>
            You haven't started any inspections yet.
          </Text>
        </View>
      ) : (
        inspections.map((item: Inspection) => (
          <Pressable
            key={item.id}
            onPress={() => router.push({ pathname: '/inspection/[id]', params: { id: item.id } })}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {item.insuredName ?? item.address ?? 'Inspection'}
              </Text>
              <Text style={{ color: colors.mutedForeground }} numberOfLines={1}>
                {item.claimNumber ? `Claim ${item.claimNumber}` : item.address ?? '—'}
              </Text>
            </View>
            {item.phase === 'preliminary' ? (
              <View style={[styles.badge, { backgroundColor: colors.insurance }]}>
                <Text style={[styles.badgeText, { color: '#fff' }]}>Phase 1</Text>
              </View>
            ) : (
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.badgeText, { color: colors.accentForeground }]}>
                  {STATUS_LABEL[item.status]}
                </Text>
              </View>
            )}
          </Pressable>
        ))
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: Platform.OS === 'web' ? 24 : 12, gap: 10 },
  startCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    marginBottom: 4,
  },
  startCtaText: { fontSize: 16, fontWeight: '700' },
  section: { fontSize: 17, fontWeight: '700', marginTop: 10 },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700' },
});

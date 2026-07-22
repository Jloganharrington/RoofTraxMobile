import React from 'react';
import {
  ActivityIndicator,
  Alert,
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
  useDeleteInspection,
  useListInspections,
  useListScheduledInspections,
} from '@workspace/api-client-react';
import type { Inspection, InspectionStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';

const STATUS_LABEL: Record<InspectionStatus, string> = {
  scheduled: 'Scheduled',
  capturing: 'In progress',
  validating: 'Validating',
  submitted: 'Submitted',
  package_ready: 'Package ready',
};

export default function InspectionsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { role } = useProfile();
  const isSuperAdmin = role === 'super_admin';

  const scheduled = useListScheduledInspections({
    query: { queryKey: getListScheduledInspectionsQueryKey() },
  });
  const mine = useListInspections({
    query: { queryKey: getListInspectionsQueryKey() },
  });

  const deleteInspection = useDeleteInspection({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInspectionsQueryKey() });
      },
      onError: (error) => {
        const message =
          error instanceof Error ? error.message : 'Could not delete inspection. Try again.';
        Alert.alert('Delete failed', message);
      },
    },
  });

  const scheduledItems = scheduled.data?.scheduled ?? [];
  const inspections = mine.data?.inspections ?? [];

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListScheduledInspectionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListInspectionsQueryKey() }),
    ]);
  }

  function confirmDelete(item: Inspection) {
    const label = item.insuredName ?? item.address ?? 'this inspection';
    Alert.alert(
      'Delete inspection?',
      `"${label}" and all its captured data will be permanently removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteInspection.mutate({ inspectionId: item.id }),
        },
      ],
    );
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
            No scheduled appointments. Phase 2 inspections you book will appear here.
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
              {item.scheduledFor ? (
                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600', marginTop: 2 }}>
                  {new Date(item.scheduledFor).toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </Text>
              ) : null}
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
          <View
            key={item.id}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            {/* Main tap area — navigates to inspection */}
            <Pressable
              onPress={() => router.push({ pathname: '/inspection/[id]', params: { id: item.id } })}
              style={styles.cardBody}
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

            {/* Delete button — only visible to super admins */}
            {isSuperAdmin && (
              <Pressable
                onPress={() => confirmDelete(item)}
                disabled={deleteInspection.isPending}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.deleteBtn,
                  { borderLeftColor: colors.border },
                  pressed && { opacity: 0.5 },
                ]}
              >
                {deleteInspection.isPending ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <Icon name="trash-2" size={18} color={colors.destructive} />
                )}
              </Pressable>
            )}
          </View>
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
    alignItems: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  deleteBtn: {
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
  },
});

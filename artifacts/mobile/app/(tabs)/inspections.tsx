import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import {
  customFetch,
  getListInspectionsQueryKey,
  getListScheduledInspectionsQueryKey,
  useDeleteInspection,
  useListInspections,
  useListScheduledInspections,
} from '@workspace/api-client-react';
import type { Inspection, InspectionStatus, ScheduledInspection } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { CalendarPicker } from '@/components/CalendarPicker';

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

  // ── Reschedule modal state ─────────────────────────────────────────────────
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);
  const [rescheduleTarget, setRescheduleTarget] = useState<ScheduledInspection | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<Date>(tomorrow);
  const [rescheduling, setRescheduling] = useState(false);

  const scheduledItems = scheduled.data?.scheduled ?? [];
  const inspections = mine.data?.inspections ?? [];

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListScheduledInspectionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListInspectionsQueryKey() }),
    ]);
  }

  function invalidateScheduleQueries() {
    queryClient.invalidateQueries({ queryKey: getListScheduledInspectionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListInspectionsQueryKey() });
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

  // Long-press on a Scheduled card → action sheet with Reschedule / Cancel options.
  function onScheduledCardLongPress(item: ScheduledInspection) {
    const label = item.insuredName ?? item.propertyAddress ?? 'this appointment';
    Alert.alert(
      label,
      'What would you like to do with this appointment?',
      [
        {
          text: 'Reschedule',
          onPress: () => {
            // Pre-fill picker with existing date if available, else tomorrow.
            const existing = item.scheduledFor ? new Date(item.scheduledFor) : tomorrow;
            setRescheduleDate(existing < tomorrow ? tomorrow : existing);
            setRescheduleTarget(item);
          },
        },
        {
          text: 'Cancel Appointment',
          style: 'destructive',
          onPress: () => confirmCancelAppointment(item),
        },
        { text: 'Dismiss', style: 'cancel' },
      ],
    );
  }

  function confirmCancelAppointment(item: ScheduledInspection) {
    const label = item.insuredName ?? item.propertyAddress ?? 'this appointment';
    Alert.alert(
      'Cancel appointment?',
      `The scheduled date for "${label}" will be cleared and the inspection will return to active status.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Appointment',
          style: 'destructive',
          onPress: () => doCancelAppointment(item),
        },
      ],
    );
  }

  async function doCancelAppointment(item: ScheduledInspection) {
    try {
      await customFetch(`/api/inspections/${item.id}/schedule`, { method: 'DELETE' });
      invalidateScheduleQueries();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not cancel appointment. Try again.';
      Alert.alert('Cancel failed', message);
    }
  }

  async function doReschedule() {
    if (!rescheduleTarget || rescheduling) return;
    setRescheduling(true);
    try {
      await customFetch(`/api/inspections/${rescheduleTarget.id}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledFor: rescheduleDate.toISOString() }),
      });
      setRescheduleTarget(null);
      invalidateScheduleQueries();

      const dateLabel = rescheduleDate.toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      });
      Alert.alert('Rescheduled', `Appointment moved to ${dateLabel}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not reschedule. Try again.';
      Alert.alert('Reschedule failed', message);
    } finally {
      setRescheduling(false);
    }
  }

  return (
    <>
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
              onLongPress={() => onScheduledCardLongPress(item)}
              delayLongPress={400}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && { opacity: 0.75 },
              ]}
            >
              <View style={{ flex: 1, padding: 16 }}>
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
              <View style={styles.cardRight}>
                <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
                <Text style={[styles.holdHint, { color: colors.mutedForeground }]}>Hold to manage</Text>
              </View>
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

      {/* ── Reschedule modal ───────────────────────────────────────────────── */}
      <Modal
        visible={rescheduleTarget !== null}
        animationType="slide"
        transparent={false}
        onRequestClose={() => !rescheduling && setRescheduleTarget(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          {/* Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Pressable
              onPress={() => !rescheduling && setRescheduleTarget(null)}
              hitSlop={12}
              disabled={rescheduling}
            >
              <Icon name="x" size={22} color={colors.foreground} />
            </Pressable>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Reschedule</Text>
              {rescheduleTarget?.insuredName ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }} numberOfLines={1}>
                  {rescheduleTarget.insuredName}
                </Text>
              ) : null}
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>
              Select a new inspection date
            </Text>

            <View style={[styles.calendarCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <CalendarPicker
                selected={rescheduleDate}
                minDate={tomorrow}
                onSelect={setRescheduleDate}
              />
            </View>

            {/* Selected date badge */}
            <View style={[styles.dateBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Icon name="calendar" size={15} color={colors.primary} />
              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '600' }}>
                {rescheduleDate.toLocaleDateString(undefined, {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                })}
              </Text>
            </View>

            <Pressable
              onPress={doReschedule}
              disabled={rescheduling}
              style={[
                styles.confirmBtn,
                { backgroundColor: colors.primary, opacity: rescheduling ? 0.6 : 1 },
              ]}
            >
              {rescheduling ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.confirmBtnText, { color: colors.primaryForeground }]}>
                  Confirm Reschedule
                </Text>
              )}
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
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
  cardRight: {
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  holdHint: { fontSize: 9, fontWeight: '500' },
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

  // Reschedule modal
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalBody: { padding: 16, gap: 16 },
  modalLabel: { fontSize: 13, fontWeight: '500' },
  calendarCard: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  confirmBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { fontSize: 16, fontWeight: '700' },
});

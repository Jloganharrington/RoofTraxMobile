/**
 * Change Orders tab — lists the rep's active jobs (pins) and lets them
 * create new change orders on site.
 *
 * Step 3a [LOCKED]: replaces the Team tab.
 */
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useListPins, getListPinsQueryKey } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { UpgradeRequiredScreen } from '@/components/UpgradeRequiredScreen';

export default function ChangeOrdersScreen() {
  const colors = useColors();
  const { companyPpTier } = useProfile();

  // PP-only subscribers don't have access to CRM change-order management.
  if (companyPpTier === 'pp_only') {
    return <UpgradeRequiredScreen featureName="Change order management" />;
  }
  const pinsQuery = useListPins(undefined, {
    query: { queryKey: getListPinsQueryKey() },
  });

  type Pin = NonNullable<typeof pinsQuery.data>['pins'][number];

  const pins = useMemo(() => {
    const all = (pinsQuery.data?.pins ?? []) as Pin[];
    // Show active (non-voided) pins so reps can create COs for any live job.
    return all.filter((p) => !(p as { voidedAt?: unknown }).voidedAt);
  }, [pinsQuery.data]);

  function handlePinPress(pin: Pin) {
    router.push({ pathname: '/change-order-new' as any, params: { pinId: pin.id } });
  }

  function handleNewCo() {
    router.push('/change-order-new' as any);
  }

  function renderPin({ item: pin }: { item: Pin }) {
    const p = pin as {
      id: string;
      customerName?: string | null;
      address?: string | null;
      city?: string | null;
      state?: string | null;
    };
    const title = p.customerName || 'Unnamed Job';
    const subtitle = [p.address, p.city, p.state].filter(Boolean).join(', ') || 'No address';
    return (
      <Pressable
        style={({ pressed }) => [
          styles.pinRow,
          { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.border },
        ]}
        onPress={() => handlePinPress(pin)}
        accessible
        accessibilityLabel={`Create change order for ${title}`}
      >
        <View style={styles.pinInfo}>
          <Text style={[styles.pinTitle, { color: colors.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.pinSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.pinAction}>
          <Text style={[styles.actionLabel, { color: colors.primary }]}>New CO</Text>
          <Icon name="chevron-right" size={16} color={colors.primary} />
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Intro strip */}
      <View style={[styles.intro, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.introText, { color: colors.mutedForeground }]}>
          Tap a job to create a change order, or pick any job below.
        </Text>
      </View>

      {pinsQuery.isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!pinsQuery.isLoading && pins.length === 0 && (
        <View style={styles.center}>
          <Icon name="briefcase" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No active jobs</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Active jobs will appear here once pins are created in the CRM.
          </Text>
        </View>
      )}

      <FlatList
        data={pins}
        keyExtractor={(p) => (p as { id: string }).id}
        renderItem={renderPin}
        contentContainerStyle={styles.list}
      />

      {/* FAB — pick a job manually (pin picker step in the flow) */}
      <Pressable
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={handleNewCo}
        accessibilityLabel="New change order — pick job"
      >
        <Icon name="plus" size={26} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  intro: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  introText: { fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginTop: 8 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  list: { paddingBottom: 80 },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pinInfo: { flex: 1, marginRight: 12 },
  pinTitle: { fontSize: 15, fontWeight: '500' },
  pinSub: { fontSize: 13, marginTop: 2 },
  pinAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionLabel: { fontSize: 14, fontWeight: '500' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});

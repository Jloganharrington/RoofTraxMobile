import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '@/components/Icon';
import { router } from 'expo-router';
import { useListPins } from '@workspace/api-client-react';
import type { DamageType, DoorKnockResult, Pin, PinWorkflow } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';

const ROLE_LABELS: Record<string, string> = {
  field_rep: 'Field Rep',
  manager: 'Manager',
  admin: 'Admin',
};

const WORKFLOW_LABELS: Record<string, string> = {
  retail: 'Retail',
  insurance: 'Insurance',
  both: 'Both',
};

const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  roof: 'Roof',
  siding: 'Siding',
  roof_and_siding: 'Roof & siding',
};

const DOOR_KNOCK_LABELS: Record<DoorKnockResult, string> = {
  no_answer: 'No answer',
  no_appointment: 'No appointment',
  appointment: 'Appointment',
};

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function pinSubtitle(pin: Pin): string {
  if (pin.workflow === 'retail') {
    return pin.doorKnockResult ? DOOR_KNOCK_LABELS[pin.doorKnockResult] : 'Door knock';
  }
  return pin.damageType ? DAMAGE_TYPE_LABELS[pin.damageType] : 'Damage pin';
}

export default function ProfileScreen() {
  const colors = useColors();
  const { user, logout } = useAuth();
  const { role, workflowAssignment, companyId, companyName, isLoading: profileLoading } =
    useProfile();
  const pinsQuery = useListPins();
  const pins = pinsQuery.data?.pins ?? [];

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Field rep';

  const totalPins = pins.length;
  const insurancePins = pins.filter((p: Pin) => p.workflow === ('insurance' as PinWorkflow)).length;
  const retailPins = pins.filter((p: Pin) => p.workflow === ('retail' as PinWorkflow)).length;
  const activePins = pins.filter((p: Pin) => p.status === 'active').length;

  function handleLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {user?.profileImageUrl ? (
          <Image source={{ uri: user.profileImageUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: colors.secondary }]}>
            <Icon name="user" size={28} color="#ffffff" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]}>{name}</Text>
          {user?.email && (
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{user.email}</Text>
          )}
          {!profileLoading && (
            <View style={styles.chipRow}>
              <View style={[styles.chip, { backgroundColor: colors.secondary }]}>
                <Text style={styles.chipText}>{ROLE_LABELS[role] ?? role}</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: colors.muted }]}>
                <Text style={[styles.chipText, { color: colors.foreground }]}>
                  {WORKFLOW_LABELS[workflowAssignment] ?? workflowAssignment}
                </Text>
              </View>
            </View>
          )}
          {companyId && (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
              {companyName ? `${companyName} · ` : ''}Company ID: {companyId}
            </Text>
          )}
        </View>
      </View>

      <Pressable
        onPress={handleLogout}
        style={[styles.logoutButton, { borderColor: colors.destructive }]}
      >
        <Icon name="log-out" size={18} color={colors.destructive} />
        <Text style={{ color: colors.destructive, fontWeight: '600' }}>Log out</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My pins</Text>
      {pinsQuery.isLoading ? (
        <ActivityIndicator />
      ) : (
        <View style={styles.statsGrid}>
          <StatCard label="Total pins" value={totalPins} color={colors.foreground} />
          <StatCard label="Active" value={activePins} color={colors.success} />
          <StatCard label="Insurance" value={insurancePins} color={colors.insurance} />
          <StatCard label="Retail" value={retailPins} color={colors.retail} />
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 20 }]}>
        Recent activity
      </Text>
      {pinsQuery.isLoading ? (
        <ActivityIndicator />
      ) : pins.length === 0 ? (
        <Text style={{ color: colors.mutedForeground }}>You haven't dropped any pins yet.</Text>
      ) : (
        pins.map((pin: Pin) => (
          <Pressable
            key={pin.id}
            onPress={() => router.push({ pathname: '/pin-edit', params: { pin: JSON.stringify(pin) } })}
            style={[styles.pinCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.pinAddress, { color: colors.foreground }]} numberOfLines={1}>
                {pin.address ?? `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {pinSubtitle(pin)} · {new Date(pin.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <View
              style={[
                styles.workflowDot,
                { backgroundColor: pin.workflow === 'retail' ? colors.retail : colors.insurance },
              ]}
            />
            <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: 16,
    paddingTop: Platform.OS === 'web' ? 32 : 16,
    paddingBottom: Platform.OS === 'web' ? 100 : 40,
    gap: 8,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 17, fontWeight: '700' },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  logoutButton: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    flexBasis: '47%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  statValue: { fontSize: 26, fontWeight: '800' },
  statLabel: { fontSize: 13 },
  pinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  pinAddress: { fontSize: 14, fontWeight: '600' },
  workflowDot: { width: 10, height: 10, borderRadius: 5 },
});

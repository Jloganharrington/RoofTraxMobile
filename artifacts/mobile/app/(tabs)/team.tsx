import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  useGetAdminStats,
  useListTeamUsers,
  useListTeamLocations,
  useRemoveTeamUser,
  useUpdateTeamUser,
} from '@workspace/api-client-react';
import type { Role, WorkflowAssignment } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';

const ROLE_LABELS: Record<Role, string> = {
  field_rep: 'Field Rep',
  manager: 'Manager',
  admin: 'Admin',
};

const WORKFLOW_LABELS: Record<WorkflowAssignment, string> = {
  retail: 'Retail',
  insurance: 'Insurance',
  both: 'Both',
};

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export default function TeamScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const statsQuery = useGetAdminStats();
  const usersQuery = useListTeamUsers();
  const locationsQuery = useListTeamLocations();
  const updateUser = useUpdateTeamUser();
  const removeUser = useRemoveTeamUser();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const stats = statsQuery.data?.stats;
  const users = usersQuery.data?.users ?? [];
  const locations = locationsQuery.data?.locations ?? [];

  function cycleRole(userId: string, current: Role) {
    const order: Role[] = ['field_rep', 'manager', 'admin'];
    const next = order[(order.indexOf(current) + 1) % order.length];
    setBusyUserId(userId);
    updateUser.mutate(
      { userId, data: { role: next } },
      {
        onSettled: () => setBusyUserId(null),
        onError: () =>
          Alert.alert('Not allowed', 'You cannot make that role change.'),
      },
    );
  }

  function cycleWorkflow(userId: string, current: WorkflowAssignment) {
    const order: WorkflowAssignment[] = ['insurance', 'retail', 'both'];
    const next = order[(order.indexOf(current) + 1) % order.length];
    setBusyUserId(userId);
    updateUser.mutate(
      { userId, data: { workflowAssignment: next } },
      { onSettled: () => setBusyUserId(null) },
    );
  }

  function confirmRemove(userId: string, name: string) {
    Alert.alert('Remove team member', `Remove ${name} from the team?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setBusyUserId(userId);
          removeUser.mutate(
            { userId },
            {
              onSettled: () => setBusyUserId(null),
              onError: () =>
                Alert.alert('Not allowed', 'You cannot remove this user.'),
            },
          );
        },
      },
    ]);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        Overview
      </Text>
      {statsQuery.isLoading ? (
        <ActivityIndicator />
      ) : (
        <View style={styles.statsGrid}>
          <StatCard label="Total pins" value={stats?.totalPins ?? 0} color={colors.foreground} />
          <StatCard label="Insurance" value={stats?.insurancePins ?? 0} color={colors.insurance} />
          <StatCard label="Retail" value={stats?.retailPins ?? 0} color={colors.retail} />
          <StatCard label="Appointments" value={stats?.appointments ?? 0} color={colors.success} />
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>
        Team ({users.length})
      </Text>
      {usersQuery.isLoading ? (
        <ActivityIndicator />
      ) : (
        users.map((member) => {
          const location = locations.find((loc) => loc.userId === member.id);
          const isSelf = member.id === user?.id;
          const busy = busyUserId === member.id;
          const name =
            [member.firstName, member.lastName].filter(Boolean).join(' ') ||
            member.email ||
            'Unnamed';

          return (
            <View
              key={member.id}
              style={[styles.memberCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.memberHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.memberName, { color: colors.foreground }]}>
                    {name} {isSelf ? '(you)' : ''}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {member.pinCount} pins
                    {location ? ' · location shared' : ''}
                  </Text>
                </View>
                {!isSelf && (
                  <Pressable
                    onPress={() => confirmRemove(member.id, name)}
                    disabled={busy}
                    hitSlop={8}
                  >
                    <Feather name="trash-2" size={18} color={colors.destructive} />
                  </Pressable>
                )}
              </View>

              <View style={styles.chipRow}>
                <Pressable
                  disabled={isSelf || busy}
                  onPress={() => cycleRole(member.id, member.role)}
                  style={[
                    styles.chip,
                    { backgroundColor: colors.secondary, opacity: isSelf ? 0.5 : 1 },
                  ]}
                >
                  <Text style={styles.chipText}>{ROLE_LABELS[member.role]}</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => cycleWorkflow(member.id, member.workflowAssignment)}
                  style={[styles.chip, { backgroundColor: colors.muted }]}
                >
                  <Text style={[styles.chipText, { color: colors.foreground }]}>
                    {WORKFLOW_LABELS[member.workflowAssignment]}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })
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
  memberCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberName: { fontSize: 15, fontWeight: '600' },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});

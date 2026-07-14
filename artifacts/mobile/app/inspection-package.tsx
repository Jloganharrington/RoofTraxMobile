import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  getGetInspectionStatusQueryKey,
  useGetInspectionStatus,
} from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';

// M-F (F3) — Status & package receipt. Polls the server for this inspection's
// submission status and a clearly-labeled STUB receipt. The full package (the
// rendered deliverable) is produced by the standalone Brain, which is NOT built
// yet — so this screen shows only what intake verified (record + verified-photo
// counts), and says so plainly. It never fabricates a finished package.

const STATUS_LABELS: Record<string, string> = {
  capturing: 'Capturing evidence',
  submitted: 'Submitted — awaiting processing',
  package_ready: 'Package ready',
};

export default function InspectionPackageScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const statusQuery = useGetInspectionStatus(id, {
    query: {
      queryKey: getGetInspectionStatusQueryKey(id),
      // Poll while the package is in flight so the receipt appears without a
      // manual refresh once the server finishes intake.
      refetchInterval: 5000,
    },
  });
  const data = statusQuery.data;

  if (statusQuery.isLoading && !data) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Package status' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Package status' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>
          Status unavailable. Check your connection.
        </Text>
      </View>
    );
  }

  const receipt = data.receipt;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Package status' }} />

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.headerRow}>
          <Icon name="file-text" size={20} color={colors.foreground} />
          <Text style={[styles.title, { color: colors.foreground }]}>Submission status</Text>
        </View>
        <Text style={[styles.status, { color: colors.secondary }]}>
          {STATUS_LABELS[data.status] ?? data.status}
        </Text>
        {data.lockedAt ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            Locked {new Date(data.lockedAt).toLocaleString()} — the record is now immutable;
            corrections are filed as addenda.
          </Text>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            Not yet submitted. Once submitted, the record locks and a receipt appears here.
          </Text>
        )}
      </View>

      {receipt ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.headerRow}>
            <Icon name="check" size={20} color={colors.success} />
            <Text style={[styles.title, { color: colors.foreground }]}>{receipt.label}</Text>
            {receipt.isStub ? (
              <View style={[styles.stubBadge, { backgroundColor: colors.muted }]}>
                <Text style={[styles.stubText, { color: colors.foreground }]}>Preview</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            {receipt.message}
          </Text>
          <View style={styles.statRow}>
            <View style={[styles.statCell, { borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {receipt.recordCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Records received
              </Text>
            </View>
            <View style={[styles.statCell, { borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {receipt.verifiedPhotoCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Photos verified
              </Text>
            </View>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
            Receipt generated {new Date(receipt.generatedAtUtc).toLocaleString()}
          </Text>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            No receipt yet — the package receipt appears once the inspection is submitted and its
            evidence verified at intake.
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', flex: 1 },
  status: { fontSize: 16, fontWeight: '800' },
  stubBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  stubText: { fontSize: 11, fontWeight: '700' },
  statRow: { flexDirection: 'row', gap: 10 },
  statCell: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12 },
});

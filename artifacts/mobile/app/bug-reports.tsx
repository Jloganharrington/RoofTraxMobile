import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListBugReportsQueryKey,
  useListBugReports,
  useUpdateBugReport,
} from '@workspace/api-client-react';
import type { BugReport, BugReportStatus } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';

// Beta bug-report triage (admins only — server enforces the gate; this screen
// just mirrors it). Newest first; tap for full context + screenshot; status
// cycles new → triaged → fixed. For serious triage, use the CSV export.

const SEVERITY_LABEL: Record<string, string> = {
  blocks_me: 'Blocks me',
  annoying: 'Annoying',
  cosmetic: 'Cosmetic',
};
const SEVERITY_COLOR: Record<string, string> = {
  blocks_me: '#dc2626',
  annoying: '#d97706',
  cosmetic: '#6b7280',
};
const STATUSES: BugReportStatus[] = ['new', 'triaged', 'fixed'];

function screenName(route: string): string {
  const segment = route.split('/').filter(Boolean).pop() ?? 'Home';
  const cleaned = segment.replace(/[[\]()]/g, '').replace(/[-_]/g, ' ').trim();
  return cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Home';
}

export default function BugReportsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { role } = useProfile();
  const isAdmin = role === 'admin' || role === 'super_admin';

  const query = useListBugReports({ query: { enabled: isAdmin, queryKey: getListBugReportsQueryKey() } });
  const updateReport = useUpdateBugReport();
  const [selected, setSelected] = React.useState<BugReport | null>(null);

  if (!isAdmin) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Admin access required.</Text>
      </View>
    );
  }

  const reports = query.data?.bugReports ?? [];

  async function setStatus(report: BugReport, status: BugReportStatus) {
    try {
      await updateReport.mutateAsync({ bugReportId: report.id, data: { status } });
      await queryClient.invalidateQueries({ queryKey: getListBugReportsQueryKey() });
      setSelected((prev) => (prev && prev.id === report.id ? { ...prev, status } : prev));
    } catch {
      Alert.alert('Could not update', 'Check your connection and try again.');
    }
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {query.isLoading ? (
        <ActivityIndicator />
      ) : reports.length === 0 ? (
        <Text style={{ color: colors.mutedForeground }}>No bug reports yet.</Text>
      ) : (
        reports.map((report) => (
          <Pressable
            key={report.id}
            onPress={() => setSelected(report)}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.sevChip,
                  { backgroundColor: SEVERITY_COLOR[report.severity] ?? '#6b7280' },
                ]}
              >
                <Text style={styles.sevText}>{SEVERITY_LABEL[report.severity] ?? report.severity}</Text>
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, flex: 1 }}>
                {screenName(report.route)}
              </Text>
              <Text
                style={{
                  color: report.status === 'fixed' ? colors.success : colors.mutedForeground,
                  fontSize: 12,
                  fontWeight: '700',
                }}
              >
                {report.status.toUpperCase()}
              </Text>
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14 }} numberOfLines={2}>
              {report.description}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {report.reporterName ?? report.reporterEmail ?? report.userId} ·{' '}
              {new Date(report.createdAt).toLocaleString()}
              {report.screenshotUrl ? ' · 📎 screenshot' : ''}
            </Text>
          </Pressable>
        ))
      )}

      <Modal
        visible={selected != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.overlay}>
          <View style={[styles.detailCard, { backgroundColor: colors.background }]}>
            {selected && (
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                <View style={styles.cardHeader}>
                  <View
                    style={[
                      styles.sevChip,
                      { backgroundColor: SEVERITY_COLOR[selected.severity] ?? '#6b7280' },
                    ]}
                  >
                    <Text style={styles.sevText}>
                      {SEVERITY_LABEL[selected.severity] ?? selected.severity}
                    </Text>
                  </View>
                  <Text style={{ color: colors.foreground, fontWeight: '700', flex: 1 }}>
                    {screenName(selected.route)}
                  </Text>
                  <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                    <Icon name="x" size={20} color={colors.mutedForeground} />
                  </Pressable>
                </View>

                <Text style={{ color: colors.foreground, fontSize: 15 }}>
                  {selected.description}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {selected.reporterName ?? selected.reporterEmail ?? selected.userId} ·{' '}
                  {new Date(selected.createdAt).toLocaleString()}
                  {selected.appVersion ? ` · v${selected.appVersion}` : ''}
                  {selected.platform ? ` · ${selected.platform} ${selected.osVersion ?? ''}` : ''}
                </Text>

                {selected.screenshotUrl ? (
                  <Image
                    source={{ uri: selected.screenshotUrl }}
                    style={styles.screenshot}
                    resizeMode="contain"
                  />
                ) : null}

                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>
                  Captured context
                </Text>
                <View style={[styles.contextBox, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: 'monospace' as never }}>
                    {JSON.stringify(selected.context, null, 2)}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {STATUSES.map((status) => (
                    <Pressable
                      key={status}
                      onPress={() => setStatus(selected, status)}
                      style={[
                        styles.statusBtn,
                        {
                          backgroundColor:
                            selected.status === status ? colors.primary : colors.muted,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color:
                            selected.status === status
                              ? colors.primaryForeground
                              : colors.foreground,
                          fontSize: 12,
                          fontWeight: '700',
                        }}
                      >
                        {status.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sevChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  sevText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 },
  detailCard: { borderRadius: 16, padding: 16, maxHeight: '85%' },
  screenshot: { width: '100%', height: 260, borderRadius: 10, backgroundColor: '#00000010' },
  contextBox: { borderWidth: 1, borderRadius: 8, padding: 8 },
  statusBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
});

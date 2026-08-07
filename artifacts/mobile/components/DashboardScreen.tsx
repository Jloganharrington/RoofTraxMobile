import React, { useEffect, useMemo, useState } from 'react';
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
  getGetActivityStatsQueryKey,
  getGetCurrentCanvassingSessionQueryKey,
  useClockInCanvassing,
  useClockOutCanvassing,
  useGetActivityStats,
  useGetCurrentCanvassingSession,
} from '@workspace/api-client-react';
import type { ActivityScope, ActivityMetrics } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useMyPinUpdates, relativeTime, MY_PIN_UPDATES_KEY, type PinUpdate } from '@/lib/pinUpdates';
import type { IconName } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { usePriceBookSync } from '@/lib/priceBookApi';

/** Formats an ISO start time into an HH:MM:SS elapsed string, ticking live. */
function useElapsed(startedAt: string | null | undefined): string | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const SCOPE_TABS: { value: ActivityScope; label: string }[] = [
  { value: 'total', label: 'Team total' },
  { value: 'department', label: 'Department' },
];

function metricLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value);
}

export default function DashboardScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { role, companyName, department } = useProfile();
  const queryClient = useQueryClient();
  const isManager = role === 'manager' || role === 'admin' || role === 'super_admin';
  // Warm the price book cache on mount (= after login) and keep it fresh
  // whenever the device regains connectivity. Runs silently in the background.
  usePriceBookSync();
  const canSeeInspections = department === 'inspector_canvasser' || role === 'super_admin';

  const [scope, setScope] = useState<ActivityScope>('total');

  const activeScope: ActivityScope = isManager ? scope : 'own';
  const statsParams = { scope: activeScope };
  const stats = useGetActivityStats(statsParams, {
    query: { queryKey: getGetActivityStatsQueryKey(statsParams) },
  });

  const session = useGetCurrentCanvassingSession({
    query: { queryKey: getGetCurrentCanvassingSessionQueryKey() },
  });
  const clockIn = useClockInCanvassing();
  const clockOut = useClockOutCanvassing();

  const openSession = session.data?.session ?? null;
  const elapsed = useElapsed(openSession?.startedAt);

  const data = stats.data?.stats;
  const period = data?.period;
  const competitive = data?.competitive;

  const greeting = useMemo(() => {
    const first = user?.firstName?.trim();
    return first ? `Hi, ${first}` : 'Dashboard';
  }, [user?.firstName]);

  const pinUpdates = useMyPinUpdates();

  async function refreshAll() {
    await queryClient.invalidateQueries({ queryKey: getGetActivityStatsQueryKey(statsParams) });
    await queryClient.invalidateQueries({ queryKey: getGetCurrentCanvassingSessionQueryKey() });
    await queryClient.invalidateQueries({ queryKey: MY_PIN_UPDATES_KEY });
  }

  async function toggleClock() {
    try {
      if (openSession) {
        await clockOut.mutateAsync();
      } else {
        await clockIn.mutateAsync();
      }
    } catch {
      // Surface nothing destructive — the button just stays put. The most
      // common cause is being offline; the session query re-syncs on refresh.
    } finally {
      await queryClient.invalidateQueries({
        queryKey: getGetCurrentCanvassingSessionQueryKey(),
      });
    }
  }

  const clockBusy = clockIn.isPending || clockOut.isPending || session.isLoading;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={stats.isRefetching || session.isRefetching}
          onRefresh={refreshAll}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.header}>
        <Text style={[styles.greeting, { color: colors.foreground }]}>{greeting}</Text>
        {companyName ? (
          <Text style={[styles.company, { color: colors.mutedForeground }]}>{companyName}</Text>
        ) : null}
      </View>

      {/* Clock in/out (B2) */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderLeft}>
            <Icon name="clock" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Canvassing time</Text>
          </View>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: openSession ? colors.success : colors.mutedForeground },
            ]}
          />
        </View>
        <Text style={[styles.clockValue, { color: openSession ? colors.foreground : colors.mutedForeground }]}>
          {openSession ? elapsed ?? '00:00:00' : 'Clocked out'}
        </Text>
        <Pressable
          onPress={toggleClock}
          disabled={clockBusy}
          style={[
            styles.clockButton,
            {
              backgroundColor: openSession ? colors.destructive : colors.success,
              opacity: clockBusy ? 0.6 : 1,
            },
          ]}
        >
          {clockBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Icon name={openSession ? 'square' : 'play'} size={16} color="#fff" />
              <Text style={styles.clockButtonText}>{openSession ? 'Clock out' : 'Clock in'}</Text>
            </>
          )}
        </Pressable>
      </View>

      {/* Add pins CTA — the map now lives behind this action */}
      <Pressable
        onPress={() => router.push('/map')}
        style={[styles.primaryCta, { backgroundColor: colors.primary }]}
      >
        <Icon name="map-pin" size={20} color={colors.primaryForeground} />
        <Text style={[styles.primaryCtaText, { color: colors.primaryForeground }]}>Add pins</Text>
        <Icon name="chevron-right" size={20} color={colors.primaryForeground} />
      </Pressable>

      {canSeeInspections ? (
        <Pressable
          onPress={() => router.push('/(tabs)/inspections')}
          style={[styles.secondaryCta, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Icon name="clipboard" size={20} color={colors.secondary} />
          <Text style={[styles.secondaryCtaText, { color: colors.foreground }]}>Inspections</Text>
          <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>
      ) : null}

      {/* My Pin Updates */}
      {!isManager && (
        <PinUpdatesCard updates={pinUpdates.data?.updates ?? []} loading={pinUpdates.isLoading} colors={colors} />
      )}

      {/* Today's metrics (B1) */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Today</Text>
      {stats.isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : stats.isError ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.mutedForeground }}>
            Couldn't load your stats. Pull to refresh when you're back online.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.metricsGrid}>
            <MetricTile icon="map-pin" label="Pins dropped" value={metricLabel(period?.pinsDropped)} />
            <MetricTile icon="check" label="Appts set" value={metricLabel(period?.appointmentsSet)} />
            <MetricTile
              icon="calendar"
              label="Appts completed"
              value={metricLabel(period?.appointmentsCompleted)}
            />
            <MetricTile
              icon="clock"
              label="Hours tracked"
              value={period ? period.hoursTracked.toFixed(1) : '—'}
            />
          </View>

          {data?.myRank != null ? (
            <View style={[styles.rankCard, { backgroundColor: colors.secondary }]}>
              <Icon name="award" size={22} color={colors.primary} />
              <Text style={styles.rankText}>
                You're ranked <Text style={{ fontWeight: '800' }}>#{data.myRank}</Text> today
              </Text>
            </View>
          ) : null}
        </>
      )}

      {/* Leaderboard (managers+) */}
      {isManager && data?.canViewLeaderboard ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Leaderboard</Text>
          <View style={styles.scopeTabs}>
            {SCOPE_TABS.map((tab) => {
              const active = tab.value === scope;
              return (
                <Pressable
                  key={tab.value}
                  onPress={() => setScope(tab.value)}
                  style={[
                    styles.scopeTab,
                    {
                      backgroundColor: active ? colors.primary : colors.muted,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? colors.primaryForeground : colors.foreground,
                      fontWeight: '600',
                      fontSize: 13,
                    }}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 0, padding: 0 }]}>
            {data.leaderboard.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, padding: 16 }}>No activity yet today.</Text>
            ) : (
              data.leaderboard.map((entry, idx) => (
                <View
                  key={entry.userId}
                  style={[
                    styles.leaderRow,
                    { borderTopColor: colors.border, borderTopWidth: idx === 0 ? 0 : 1 },
                  ]}
                >
                  <Text style={[styles.leaderRank, { color: colors.primary }]}>#{entry.rank}</Text>
                  <Text style={[styles.leaderName, { color: colors.foreground }]} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  <View style={styles.leaderStats}>
                    <Text style={[styles.leaderStat, { color: colors.foreground }]}>
                      {entry.appointmentsSet}
                      <Text style={{ color: colors.mutedForeground }}> appts</Text>
                    </Text>
                    <Text style={[styles.leaderStat, { color: colors.mutedForeground }]}>
                      {entry.pinsDropped} pins
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      ) : null}

      {/* Competitive panel — trailing 30 days */}
      {competitive ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Last 30 days</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <CompareRow label="Pins dropped" me={competitive.me} team={competitive.teamTotal} field="pinsDropped" colors={colors} />
            <CompareRow label="Appts set" me={competitive.me} team={competitive.teamTotal} field="appointmentsSet" colors={colors} />
            <CompareRow label="Hours" me={competitive.me} team={competitive.teamTotal} field="hoursTracked" colors={colors} isFloat />
            <View style={[styles.compareFoot, { borderTopColor: colors.border }]}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {competitive.myRank != null
                  ? `Ranked #${competitive.myRank} of ${competitive.cohortSize}`
                  : `${competitive.cohortSize} reps in your company`}
              </Text>
            </View>
          </View>
        </>
      ) : null}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Stage-to-icon + colour mapping ──────────────────────────────────────────
const UPDATE_META: Record<string, { icon: IconName; color: string }> = {
  appt_scheduled:   { icon: 'calendar',  color: '#16a34a' }, // green
  appt_complete:    { icon: 'check',     color: '#2563eb' }, // blue
  phase1_scheduled: { icon: 'calendar',  color: '#16a34a' }, // green
  fipsa_signed:     { icon: 'file-text', color: '#7c3aed' }, // purple
};

function PinUpdatesCard({
  updates,
  loading,
  colors,
}: {
  updates: PinUpdate[];
  loading: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  if (loading) return null; // silent while loading — metrics fill the space
  if (updates.length === 0) return null; // nothing to show yet

  return (
    <>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My Pin Updates</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 0, padding: 0 }]}>
        {updates.slice(0, 5).map((u, idx) => {
          const meta = UPDATE_META[u.toStage] ?? { icon: 'bell' as IconName, color: colors.primary };
          const title = u.customerName?.trim() || u.address?.trim() || 'Unknown lead';
          const sub   = u.customerName?.trim() ? (u.address?.trim() ?? '') : '';
          return (
            <View
              key={u.id}
              style={[
                styles.updateRow,
                { borderTopColor: colors.border, borderTopWidth: idx === 0 ? 0 : 1 },
              ]}
            >
              <View style={[styles.updateIcon, { backgroundColor: meta.color + '20' }]}>
                <Icon name={meta.icon} size={15} color={meta.color} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.updateLabel, { color: colors.foreground }]} numberOfLines={1}>
                  {u.label}
                </Text>
                <Text style={[styles.updateTitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {title}{sub ? ` · ${sub}` : ''}
                </Text>
              </View>
              <Text style={[styles.updateTime, { color: colors.mutedForeground }]}>
                {relativeTime(u.createdAt)}
              </Text>
            </View>
          );
        })}
      </View>
    </>
  );
}

function MetricTile({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={[styles.metricTile, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Icon name={icon} size={18} color={colors.primary} />
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function CompareRow({
  label,
  me,
  team,
  field,
  colors,
  isFloat,
}: {
  label: string;
  me: ActivityMetrics;
  team: ActivityMetrics;
  field: keyof ActivityMetrics;
  colors: ReturnType<typeof useColors>;
  isFloat?: boolean;
}) {
  const meVal = me[field] ?? 0;
  const teamVal = team[field] ?? 0;
  const fmt = (n: number) => (isFloat ? n.toFixed(1) : String(n));
  return (
    <View style={styles.compareRow}>
      <Text style={[styles.compareLabel, { color: colors.foreground }]}>{label}</Text>
      <View style={styles.compareValues}>
        <Text style={[styles.compareMe, { color: colors.primary }]}>{fmt(meVal)}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}> / {fmt(teamVal)} team</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingTop: Platform.OS === 'web' ? 24 : 12,
    gap: 14,
  },
  header: { gap: 2 },
  greeting: { fontSize: 26, fontWeight: '800' },
  company: { fontSize: 14, fontWeight: '500' },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  clockValue: { fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: 1 },
  clockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
  },
  clockButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  primaryCtaText: { flex: 1, fontSize: 16, fontWeight: '700' },
  secondaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  secondaryCtaText: { flex: 1, fontSize: 15, fontWeight: '600' },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginTop: 4 },
  loadingBox: { padding: 24, alignItems: 'center' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricTile: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  metricValue: { fontSize: 26, fontWeight: '800' },
  metricLabel: { fontSize: 12, fontWeight: '500' },
  rankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
  },
  rankText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  scopeTabs: { flexDirection: 'row', gap: 8 },
  scopeTab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  leaderRank: { fontSize: 15, fontWeight: '800', width: 34 },
  leaderName: { flex: 1, fontSize: 15, fontWeight: '600' },
  leaderStats: { alignItems: 'flex-end' },
  leaderStat: { fontSize: 14, fontWeight: '600' },
  compareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  compareLabel: { fontSize: 15, fontWeight: '500' },
  compareValues: { flexDirection: 'row', alignItems: 'baseline' },
  compareMe: { fontSize: 17, fontWeight: '800' },
  compareFoot: { borderTopWidth: 1, paddingTop: 10, marginTop: 2 },
  updateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  updateIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  updateLabel: { fontSize: 13, fontWeight: '600' },
  updateTitle: { fontSize: 12, marginTop: 1 },
  updateTime: { fontSize: 12, flexShrink: 0 },
});

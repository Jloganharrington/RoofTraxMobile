import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { getGetWeatherEventsQueryKey, useGetWeatherEvents } from '@workspace/api-client-react';
import type { WeatherCandidate } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { patchInspection } from '@/lib/inspectionSync';

// Storm confirmation (B5). Shows the deterministic candidate storm events the
// server derived (no AI). The inspector picks the cause-of-loss event, which
// is snapshotted onto the inspection. This is a SOFT gate — "Skip for now"
// always lets the inspector proceed.
export default function InspectionStormScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id, location, dateOfLoss } = useLocalSearchParams<{
    id: string;
    location?: string;
    dateOfLoss?: string;
  }>();

  const hasLocation = !!location?.trim();
  const queryParams = {
    location: location ?? '',
    ...(dateOfLoss ? { dateOfLoss } : {}),
  };
  const weather = useGetWeatherEvents(queryParams, {
    query: { enabled: hasLocation, queryKey: getGetWeatherEventsQueryKey(queryParams) },
  });

  async function confirm(candidate: WeatherCandidate) {
    await patchInspection(queryClient, id, {
      stormConfirmedRef: {
        date: candidate.date,
        time: candidate.time ?? null,
        type: candidate.type,
        hailSize: candidate.hailSize,
        windSpeed: candidate.windSpeed,
        distance: null,
        description: candidate.description,
        queriedLocation: weather.data?.queriedLocation ?? location ?? '',
        dateOfLoss: weather.data?.dateOfLoss ?? dateOfLoss ?? null,
        confirmedAtUtc: new Date().toISOString(),
      },
    });
    router.back();
  }

  const candidates = weather.data?.candidates ?? [];
  const isForbidden = weather.error != null && String(weather.error).includes('403');

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      {!hasLocation ? (
        <Notice colors={colors} text="This inspection has no address or coordinates, so storm candidates can't be fetched. Add a location on intake first." />
      ) : weather.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
      ) : isForbidden ? (
        <Notice colors={colors} text="Storm lookup is only available to inspectors." />
      ) : weather.isError ? (
        <Notice colors={colors} text="Couldn't reach the weather service. You can confirm the storm later, or skip for now." />
      ) : candidates.length === 0 ? (
        <Notice colors={colors} text="No qualifying severe-weather events were found near this location and date of loss." />
      ) : (
        candidates.map((c, idx) => (
          <Pressable
            key={`${c.date}-${idx}`}
            onPress={() => confirm(c)}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.typeIcon, { backgroundColor: colors.accent }]}>
              <Icon name={c.type === 'wind' ? 'wind' : 'cloud'} size={18} color={colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {c.type.toUpperCase()} · {c.date}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }} numberOfLines={2}>
                {c.description ??
                  [
                    c.hailSize != null ? `${c.hailSize}" hail` : null,
                    c.windSpeed != null ? `${c.windSpeed} mph wind` : null,
                    c.tornado ? 'tornado' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
              </Text>
            </View>
            <View style={[styles.scorePill, { backgroundColor: colors.secondary }]}>
              <Text style={styles.scoreText}>{Math.round(c.severityScore)}</Text>
            </View>
          </Pressable>
        ))
      )}

      <Pressable onPress={() => router.back()} style={styles.skip}>
        <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>Skip for now</Text>
      </Pressable>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function Notice({ colors, text }: { colors: ReturnType<typeof useColors>; text: string }) {
  return (
    <View style={[styles.notice, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Icon name="alert-circle" size={20} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, flex: 1 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  typeIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  scorePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  scoreText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  skip: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
});

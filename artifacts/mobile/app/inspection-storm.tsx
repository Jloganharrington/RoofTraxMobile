import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

  // ---- Manual storm entry ----
  // Fallback when the derived candidates are stale/missing (e.g. a storm too
  // recent to appear in the source data). Snapshots the same shape as a
  // picked candidate, flagged in the description as inspector-entered.
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualDate, setManualDate] = React.useState('');
  const [manualDescription, setManualDescription] = React.useState('');
  const [manualType, setManualType] = React.useState<'hail' | 'wind' | 'tornado'>('hail');
  const [manualSaving, setManualSaving] = React.useState(false);
  const [manualError, setManualError] = React.useState<string | null>(null);

  // Strict calendar validation — JS Date normalizes impossible dates (e.g.
  // 2025-02-29 → Mar 1), so round-trip the parsed components instead.
  const manualDateValid = React.useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(manualDate.trim());
    if (!m) return false;
    const [, y, mo, d] = m;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    return (
      dt.getUTCFullYear() === Number(y) &&
      dt.getUTCMonth() === Number(mo) - 1 &&
      dt.getUTCDate() === Number(d)
    );
  }, [manualDate]);

  async function confirmManual() {
    if (manualSaving) return;
    if (!manualDateValid) {
      setManualError('Enter a valid calendar date as YYYY-MM-DD.');
      return;
    }
    if (!manualDescription.trim()) {
      setManualError('Enter a short description of the storm.');
      return;
    }
    setManualError(null);
    setManualSaving(true);
    try {
      await patchInspection(queryClient, id, {
        stormConfirmedRef: {
          date: manualDate.trim(),
          time: null,
          type: manualType,
          hailSize: null,
          windSpeed: null,
          distance: null,
          description: `[Manually entered] ${manualDescription.trim()}`,
          queriedLocation: weather.data?.queriedLocation ?? location ?? '',
          dateOfLoss: weather.data?.dateOfLoss ?? dateOfLoss ?? null,
          confirmedAtUtc: new Date().toISOString(),
        },
      });
      setManualOpen(false);
      router.back();
    } finally {
      setManualSaving(false);
    }
  }

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

      <Pressable
        onPress={() => {
          setManualError(null);
          setManualOpen(true);
        }}
        style={[styles.manualBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
      >
        <Icon name="upload" size={18} color={colors.secondary} />
        <Text style={{ color: colors.foreground, fontWeight: '700' }}>
          Manually Upload Storm Data
        </Text>
      </Pressable>

      <Pressable onPress={() => router.back()} style={styles.skip}>
        <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>Skip for now</Text>
      </Pressable>
      <View style={{ height: 40 }} />

      <Modal
        visible={manualOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setManualOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                Manually Upload Storm Data
              </Text>
              <Pressable onPress={() => setManualOpen(false)} hitSlop={8}>
                <Icon name="x" size={22} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Use this when the storm is too recent to appear in the candidate list. The entry is
              recorded as inspector-entered.
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Date of Storm</Text>
            <TextInput
              value={manualDate}
              onChangeText={setManualDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            />

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Storm Description</Text>
            <TextInput
              value={manualDescription}
              onChangeText={setManualDescription}
              placeholder="e.g. Large hail reported across the neighborhood around 6 PM"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.input,
                styles.inputMultiline,
                { borderColor: colors.border, color: colors.foreground },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Storm Type</Text>
            <View style={styles.typeRow}>
              {(['hail', 'wind', 'tornado'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setManualType(t)}
                  style={[
                    styles.typePill,
                    {
                      borderColor: manualType === t ? colors.secondary : colors.border,
                      backgroundColor: manualType === t ? colors.accent : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: manualType === t ? colors.secondary : colors.mutedForeground,
                      fontWeight: '700',
                      textTransform: 'capitalize',
                    }}
                  >
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>

            {manualError ? (
              <Text style={{ color: colors.destructive, fontSize: 13 }}>{manualError}</Text>
            ) : null}

            <Pressable
              onPress={confirmManual}
              disabled={manualSaving}
              style={[
                styles.confirmBtn,
                { backgroundColor: colors.secondary, opacity: manualSaving ? 0.6 : 1 },
              ]}
            >
              {manualSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
                  Confirm Storm
                </Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  manualBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 36,
    gap: 10,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  confirmBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 12,
    marginTop: 8,
  },
});

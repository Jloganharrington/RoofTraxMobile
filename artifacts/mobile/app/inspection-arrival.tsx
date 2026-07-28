import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_GPS_TOLERANCE_METERS,
  evaluateGpsTolerance,
  type GpsToleranceResult,
} from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { attestInspection, patchInspection } from '@/lib/inspectionSync';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';

// Step 1 · Arrival Log (protocol v2). Data-only — no photos here. Records sky
// / wind / temp via pickers, personnel present as a multi-select, and
// auto-captures device GPS + local time into the arrival block. GPS is also
// compared to the claim's geocoded coordinates; beyond tolerance the inspector
// must justify the mismatch with a GPS-override attestation before continuing.

const SKY_OPTIONS = ['Sunny', 'Partly Cloudy', 'Overcast', 'Rain', 'Other'] as const;
const PERSONNEL_OPTIONS = [
  'Homeowner',
  'Adjuster',
  'Public Adjuster',
  'Contractor Rep',
  'Other',
] as const;

export default function InspectionArrivalScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id, latitude, longitude } = useLocalSearchParams<{
    id: string;
    latitude?: string;
    longitude?: string;
  }>();
  useNextSectionHeader(id, 'arrival');

  const geoLat = latitude ? Number(latitude) : null;
  const geoLng = longitude ? Number(longitude) : null;
  const hasGeocode = geoLat != null && geoLng != null && !Number.isNaN(geoLat) && !Number.isNaN(geoLng);

  const [locating, setLocating] = useState(true);
  const [locError, setLocError] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState<GpsToleranceResult | null>(null);
  const [gps, setGps] = useState<{ latitude: number; longitude: number } | null>(null);

  const [sky, setSky] = useState<string | null>(null);
  const [wind, setWind] = useState('');
  const [temp, setTemp] = useState('');
  const [personnel, setPersonnel] = useState<Record<string, boolean>>({});
  const [overrideReason, setOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);

  const navigation = useNavigation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled) setLocError('Location permission is required to verify arrival.');
          return;
        }
        const pos = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        if (hasGeocode) {
          setTolerance(
            evaluateGpsTolerance(pos.coords.latitude, pos.coords.longitude, geoLat!, geoLng!),
          );
        }
      } catch {
        if (!cancelled) setLocError("Couldn't read your location. Check GPS and try again.");
      } finally {
        if (!cancelled) setLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outOfTolerance = tolerance != null && !tolerance.pass;
  const overrideNeeded = outOfTolerance && overrideReason.trim().length === 0;
  const personnelSelected = PERSONNEL_OPTIONS.filter((p) => personnel[p]);
  const canSave =
    !saving &&
    !overrideNeeded &&
    sky != null &&
    wind.trim().length > 0 &&
    temp.trim().length > 0 &&
    personnelSelected.length > 0;

  // Auto-save on back — only fires when all required fields are present.
  // Does NOT call handleConfirm (which also calls router.back()) to avoid
  // double navigation; patches the inspection directly.
  const autoSaveRef = useRef<() => void>(() => {});
  autoSaveRef.current = () => {
    if (!canSave || saving) return;
    const now = new Date();
    void (async () => {
      try {
        if (outOfTolerance) {
          await attestInspection(id, {
            stage: 'arrival',
            attestationType: 'gps_override',
            details: {
              distanceMeters: tolerance?.distanceMeters ?? null,
              toleranceMeters: tolerance?.toleranceMeters ?? DEFAULT_GPS_TOLERANCE_METERS,
              reason: overrideReason.trim(),
            },
          });
        }
        await patchInspection(queryClient, id, {
          arrivalConditions: {
            sky,
            windCondition: wind.trim(),
            temp: temp.trim(),
            personnelPresent: personnelSelected,
            timeLocal: now.toLocaleString(),
            gpsLatitude: gps?.latitude ?? null,
            gpsLongitude: gps?.longitude ?? null,
            recordedAtUtc: now.toISOString(),
          },
        });
      } catch { /* outbox will retry */ }
    })();
  };
  useEffect(() => {
    return navigation.addListener('beforeRemove', () => { autoSaveRef.current(); });
  }, [navigation]);

  async function handleConfirm() {
    setSaving(true);
    try {
      if (outOfTolerance) {
        await attestInspection(id, {
          stage: 'arrival',
          attestationType: 'gps_override',
          details: {
            distanceMeters: tolerance?.distanceMeters ?? null,
            toleranceMeters: tolerance?.toleranceMeters ?? DEFAULT_GPS_TOLERANCE_METERS,
            reason: overrideReason.trim(),
          },
        });
      }
      const now = new Date();
      await patchInspection(queryClient, id, {
        arrivalConditions: {
          sky,
          windCondition: wind.trim(),
          temp: temp.trim(),
          personnelPresent: personnelSelected,
          timeLocal: now.toLocaleString(),
          gpsLatitude: gps?.latitude ?? null,
          gpsLongitude: gps?.longitude ?? null,
          recordedAtUtc: now.toISOString(),
        },
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* GPS + time (auto-captured) */}
        {locating ? (
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground }}>Reading your location…</Text>
          </View>
        ) : locError ? (
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Icon name="alert-circle" size={20} color={colors.destructive} />
            <Text style={{ color: colors.foreground, flex: 1 }}>{locError}</Text>
          </View>
        ) : (
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Icon name="check" size={20} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                GPS &amp; time captured automatically
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {gps
                  ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`
                  : 'Position unavailable'}
                {tolerance
                  ? ` · ${Math.round(tolerance.distanceMeters)} m from claim address`
                  : ''}
              </Text>
            </View>
          </View>
        )}

        {outOfTolerance ? (
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.destructive }]}>
              GPS override reason (required)
            </Text>
            <TextInput
              value={overrideReason}
              onChangeText={setOverrideReason}
              placeholder="Why are you recording arrival from here?"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.input,
                { height: 80, textAlignVertical: 'top', backgroundColor: colors.card, borderColor: colors.destructive, color: colors.foreground },
              ]}
            />
          </View>
        ) : null}

        {/* Sky */}
        <Text style={[styles.section, { color: colors.foreground }]}>Sky</Text>
        <View style={styles.chipRow}>
          {SKY_OPTIONS.map((option) => {
            const selected = sky === option;
            return (
              <Pressable
                key={option}
                onPress={() => setSky(option)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontWeight: '600' }}>
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Field label="Wind" value={wind} onChange={setWind} placeholder="Calm, gusty, 10–15 mph…" colors={colors} />
        <Field label="Temperature" value={temp} onChange={setTemp} placeholder="e.g. 72°F" colors={colors} />

        {/* Personnel present */}
        <Text style={[styles.section, { color: colors.foreground }]}>Personnel present</Text>
        <View style={styles.chipRow}>
          {PERSONNEL_OPTIONS.map((option) => {
            const selected = Boolean(personnel[option]);
            return (
              <Pressable
                key={option}
                onPress={() => setPersonnel((prev) => ({ ...prev, [option]: !prev[option] }))}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontWeight: '600' }}>
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleConfirm}
          disabled={!canSave}
          style={[styles.submit, { backgroundColor: colors.primary, opacity: canSave ? 1 : 0.5 }]}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.submitText, { color: colors.primaryForeground }]}>Record arrival</Text>
          )}
        </Pressable>
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  section: { fontSize: 16, fontWeight: '700', marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  submit: { paddingVertical: 15, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  submitText: { fontSize: 16, fontWeight: '700' },
});

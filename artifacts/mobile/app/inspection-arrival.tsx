import React, { useEffect, useState } from 'react';
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

// Arrival flow (B6 / S1). Reads the device GPS, compares it to the claim's
// geocoded coordinates via the shared pure tolerance check, and records
// arrival conditions. Beyond tolerance, the inspector must justify the
// mismatch with a GPS-override attestation before continuing.
export default function InspectionArrivalScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id, latitude, longitude } = useLocalSearchParams<{
    id: string;
    latitude?: string;
    longitude?: string;
  }>();

  const geoLat = latitude ? Number(latitude) : null;
  const geoLng = longitude ? Number(longitude) : null;
  const hasGeocode = geoLat != null && geoLng != null && !Number.isNaN(geoLat) && !Number.isNaN(geoLng);

  const [locating, setLocating] = useState(true);
  const [locError, setLocError] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState<GpsToleranceResult | null>(null);

  const [sky, setSky] = useState('');
  const [wind, setWind] = useState('');
  const [temp, setTemp] = useState('');
  const [personnel, setPersonnel] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);

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

  async function handleConfirm() {
    setSaving(true);
    try {
      if (outOfTolerance) {
        await attestInspection(id, {
          stage: 'S1',
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
          sky: sky.trim() || null,
          wind: wind.trim() || null,
          temp: temp.trim() || null,
          personnelPresent: personnel.trim() || null,
          recordedAtUtc: new Date().toISOString(),
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
        {/* GPS status */}
        {locating ? (
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground }}>Checking your location…</Text>
          </View>
        ) : locError ? (
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Icon name="alert-circle" size={20} color={colors.destructive} />
            <Text style={{ color: colors.foreground, flex: 1 }}>{locError}</Text>
          </View>
        ) : !hasGeocode ? (
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Icon name="alert-circle" size={20} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, flex: 1 }}>
              No claim coordinates on file — arrival will be recorded without a distance check.
            </Text>
          </View>
        ) : tolerance ? (
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: tolerance.pass ? colors.card : '#fef2f2',
                borderColor: tolerance.pass ? colors.border : colors.destructive,
              },
            ]}
          >
            <Icon
              name={tolerance.pass ? 'check' : 'alert-circle'}
              size={22}
              color={tolerance.pass ? colors.success : colors.destructive}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                {tolerance.pass ? 'On-site confirmed' : 'Outside tolerance'}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {Math.round(tolerance.distanceMeters)} m from the claim address (limit{' '}
                {tolerance.toleranceMeters} m)
              </Text>
            </View>
          </View>
        ) : null}

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

        <Text style={[styles.section, { color: colors.foreground }]}>Arrival conditions</Text>
        <Field label="Sky" value={sky} onChange={setSky} placeholder="Clear, overcast…" colors={colors} />
        <Field label="Wind" value={wind} onChange={setWind} placeholder="Calm, gusty…" colors={colors} />
        <Field label="Temperature" value={temp} onChange={setTemp} placeholder="e.g. 72°F" colors={colors} />
        <Field
          label="Personnel present"
          value={personnel}
          onChange={setPersonnel}
          placeholder="Homeowner, adjuster…"
          colors={colors}
        />

        <Pressable
          onPress={handleConfirm}
          disabled={saving || overrideNeeded}
          style={[
            styles.submit,
            { backgroundColor: colors.primary, opacity: saving || overrideNeeded ? 0.5 : 1 },
          ]}
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

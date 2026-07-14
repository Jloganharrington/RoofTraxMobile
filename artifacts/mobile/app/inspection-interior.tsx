import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import type { InteriorObservationType } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { createInteriorObservation, markNoInteriorClaim } from '@/lib/inspectionSync';
import { buildProtocolState } from '@/lib/inspectionProtocolState';

// E2 / S6 — Interior / Ancillary. This stage is conditional, never a hard
// block: an inspection either records at least one interior/attic observation
// OR the inspector explicitly waives it with a "no interior claim" attestation.
// Doing neither raises a non-blocking soft flag (INTERIOR_NOT_ADDRESSED).

const OBSERVATION_TYPES: { value: InteriorObservationType; label: string }[] = [
  { value: 'ceiling_stain', label: 'Ceiling stain' },
  { value: 'wall_stain', label: 'Wall stain' },
  { value: 'moisture_reading', label: 'Moisture reading' },
  { value: 'attic_pass', label: 'Attic pass' },
  { value: 'other', label: 'Other' },
];

export default function InspectionInteriorScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [adding, setAdding] = React.useState(false);
  const [location, setLocation] = React.useState('');
  const [observationType, setObservationType] = React.useState<InteriorObservationType>('ceiling_stain');
  const [moisture, setMoisture] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [waiving, setWaiving] = React.useState(false);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Interior / Attic' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Interior / Attic' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const observations = inspection.interiorObservations ?? [];
  const state = buildProtocolState(inspection);
  const addressed = observations.length > 0 || state.interiorClaimWaived;

  function openAdd() {
    setLocation('');
    setObservationType('ceiling_stain');
    setMoisture('');
    setNotes('');
    setAdding(true);
  }

  const moistureValue = moisture.trim() ? Number(moisture) : null;
  const canSave =
    location.trim().length > 0 &&
    (observationType !== 'moisture_reading' ||
      (moistureValue !== null && Number.isFinite(moistureValue)));

  async function saveObservation() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await createInteriorObservation(queryClient, id, {
        location: location.trim(),
        observationType,
        moistureReading:
          moistureValue !== null && Number.isFinite(moistureValue) ? moistureValue : null,
        notes: notes.trim() || null,
      });
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  async function waive() {
    if (!user || waiving) return;
    setWaiving(true);
    try {
      await markNoInteriorClaim(queryClient, id, user.id, 'No interior damage claimed');
    } finally {
      setWaiving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Interior / Attic' }} />

      <View
        style={[
          styles.summary,
          {
            backgroundColor: addressed ? '#ecfdf5' : colors.card,
            borderColor: addressed ? colors.success : colors.border,
          },
        ]}
      >
        <Icon name={addressed ? 'check' : 'alert-circle'} size={22} color={addressed ? colors.success : colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
            {observations.length > 0
              ? `${observations.length} interior observation${observations.length === 1 ? '' : 's'}`
              : state.interiorClaimWaived
                ? 'No interior claim — waived'
                : 'Interior not yet addressed'}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            Record any interior/attic evidence, or waive it if there is no interior claim.
          </Text>
        </View>
      </View>

      {observations.map((obs) => (
        <View
          key={obs.id}
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.badge, { backgroundColor: colors.accent }]}>
            <Icon name="clipboard" size={18} color={colors.secondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>{obs.location}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              {OBSERVATION_TYPES.find((t) => t.value === obs.observationType)?.label ??
                obs.observationType}
              {obs.moistureReading != null ? ` · ${obs.moistureReading}% moisture` : ''}
            </Text>
          </View>
        </View>
      ))}

      <Pressable onPress={openAdd} style={[styles.addRow, { borderColor: colors.border }]}>
        <Icon name="plus" size={18} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '600' }}>Add interior observation</Text>
      </Pressable>

      {!state.interiorClaimWaived && observations.length === 0 ? (
        <Pressable
          onPress={waive}
          disabled={waiving}
          style={[styles.waiveBtn, { borderColor: colors.border, opacity: waiving ? 0.6 : 1 }]}
        >
          {waiving ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : (
            <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>
              No interior claim — waive this stage
            </Text>
          )}
        </Pressable>
      ) : null}

      <View style={{ height: 40 }} />

      <Modal visible={adding} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Interior observation</Text>
            <Field
              label="Location"
              value={location}
              onChange={setLocation}
              placeholder="e.g. Master bedroom ceiling"
              colors={colors}
            />
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Type</Text>
            <View style={styles.chipRow}>
              {OBSERVATION_TYPES.map((t) => {
                const on = observationType === t.value;
                return (
                  <Pressable
                    key={t.value}
                    onPress={() => setObservationType(t.value)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: on ? colors.primary : colors.card,
                        borderColor: on ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontSize: 13 }}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {observationType === 'moisture_reading' ? (
              <Field
                label="Moisture reading (%)"
                value={moisture}
                onChange={setMoisture}
                placeholder="e.g. 18.5"
                keyboardType="decimal-pad"
                colors={colors}
              />
            ) : null}
            <Field
              label="Notes (optional)"
              value={notes}
              onChange={setNotes}
              placeholder="Anything worth flagging"
              colors={colors}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setAdding(false)} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveObservation}
                disabled={!canSave || saving}
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: !canSave || saving ? 0.5 : 1 }]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Record</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
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
        keyboardType={keyboardType ?? 'default'}
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  summaryTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  waiveBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', borderRadius: 16, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  secondaryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
});

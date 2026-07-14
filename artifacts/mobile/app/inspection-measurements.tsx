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
import type { InspectionSubjectType } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { createMeasurement } from '@/lib/inspectionSync';
import { buildProtocolState, stageDeficiencies } from '@/lib/inspectionProtocolState';

// E1 / S7 — Measurements. The app records ONLY raw measured facts (a length, an
// area, a count with its unit). It never derives squares, waste factors, or
// pricing — that is the Brain's job downstream. The S7 hard gate simply
// requires at least one measurement; a per-slope measurement that references a
// slope not in the S3 inventory raises a non-blocking soft flag.

type Target = { subjectType: InspectionSubjectType; subjectId: string | null; label: string };

export default function InspectionMeasurementsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [target, setTarget] = React.useState<Target | null>(null);
  const [measurementType, setMeasurementType] = React.useState('');
  const [value, setValue] = React.useState('');
  const [unit, setUnit] = React.useState('ft');
  const [saving, setSaving] = React.useState(false);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Measurements' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Measurements' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const measurements = inspection.measurements ?? [];
  const slopes = inspection.slopes ?? [];
  const state = buildProtocolState(inspection);
  const slopeIds = new Set(state.slopes.map((s) => s.id));
  const s7Remaining = stageDeficiencies(inspection, 'S7').length;

  const groups: Target[] = [
    { subjectType: 'inspection', subjectId: null, label: 'Whole roof' },
    ...slopes.map((slope) => ({
      subjectType: 'slope' as InspectionSubjectType,
      subjectId: slope.id,
      label: slope.label,
    })),
  ];

  function openAdd(t: Target) {
    setTarget(t);
    setMeasurementType('');
    setValue('');
    setUnit('ft');
  }

  const numericValue = Number(value);
  const canSave =
    measurementType.trim().length > 0 && value.trim().length > 0 && Number.isFinite(numericValue);

  async function saveMeasurement() {
    if (!target || !canSave || saving) return;
    setSaving(true);
    try {
      await createMeasurement(queryClient, id, {
        subjectType: target.subjectType,
        subjectId: target.subjectId,
        measurementType: measurementType.trim(),
        value: numericValue,
        unit: unit.trim() || null,
      });
      setTarget(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Measurements' }} />

      <View
        style={[
          styles.summary,
          {
            backgroundColor: measurements.length > 0 && s7Remaining === 0 ? '#ecfdf5' : colors.card,
            borderColor: measurements.length > 0 && s7Remaining === 0 ? colors.success : colors.border,
          },
        ]}
      >
        <Icon name="clipboard" size={22} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
            {measurements.length === 0
              ? 'No measurements recorded yet'
              : `${measurements.length} measurement${measurements.length === 1 ? '' : 's'} recorded`}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            Record raw measured facts only — the report engine derives squares & waste.
          </Text>
        </View>
      </View>

      {groups.map((group) => {
        const own = measurements.filter((m) =>
          group.subjectId === null
            ? m.subjectType !== 'slope'
            : m.subjectType === 'slope' && m.subjectId === group.subjectId,
        );
        return (
          <View key={group.subjectId ?? 'whole-roof'} style={{ gap: 8 }}>
            <Text style={[styles.section, { color: colors.foreground }]}>{group.label}</Text>
            {own.map((m) => {
              const mismatch =
                m.subjectType === 'slope' && m.subjectId != null && !slopeIds.has(m.subjectId);
              return (
                <View
                  key={m.id}
                  style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                    <Icon name="check" size={18} color={colors.secondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                      {m.measurementType}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      {m.value}
                      {m.unit ? ` ${m.unit}` : ''}
                      {mismatch ? ' · references an undocumented slope' : ''}
                    </Text>
                  </View>
                </View>
              );
            })}
            <Pressable
              onPress={() => openAdd(group)}
              style={[styles.addRow, { borderColor: colors.border }]}
            >
              <Icon name="plus" size={18} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '600' }}>
                Add measurement · {group.label.toLowerCase()}
              </Text>
            </Pressable>
          </View>
        );
      })}

      <View style={{ height: 40 }} />

      <Modal visible={target !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              Measurement · {target?.label.toLowerCase()}
            </Text>
            <Field
              label="What was measured"
              value={measurementType}
              onChange={setMeasurementType}
              placeholder="e.g. Ridge length, eave length, slope area"
              colors={colors}
            />
            <View style={styles.pairRow}>
              <View style={{ flex: 2 }}>
                <Field
                  label="Value"
                  value={value}
                  onChange={setValue}
                  placeholder="e.g. 42"
                  keyboardType="decimal-pad"
                  colors={colors}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Unit" value={unit} onChange={setUnit} placeholder="ft" colors={colors} />
              </View>
            </View>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setTarget(null)} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveMeasurement}
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
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
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
  field: { gap: 6 },
  pairRow: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', borderRadius: 16, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  secondaryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
});

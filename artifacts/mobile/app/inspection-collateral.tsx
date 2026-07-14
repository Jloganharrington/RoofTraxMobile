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
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { type ElevationDirection } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { createDamageInstance } from '@/lib/inspectionSync';
import { buildProtocolState, stageDeficiencies } from '@/lib/inspectionProtocolState';

// C2 — Collateral sweep (S5). Works elevation-by-elevation. For each face the
// inspector records discrete damage instances; every instance must carry the
// full wide/mid/close triad (enforced by the shared capture screen) before it
// satisfies the S5 gate. Damage instances are always tied to an elevation so
// nothing is captured as an orphan photo.

const DIRECTION_LABELS: Record<ElevationDirection, string> = {
  front: 'Front',
  right: 'Right',
  back: 'Rear',
  left: 'Left',
};

export default function InspectionCollateralScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [target, setTarget] = React.useState<{ elevationId: string; label: string } | null>(null);
  const [damageType, setDamageType] = React.useState('');
  const [severity, setSeverity] = React.useState('');
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const state = buildProtocolState(inspection);
  const triadComplete = new Map(
    state.damageInstances.map((d) => [
      d.id,
      d.widePhotoCaptured && d.midPhotoCaptured && d.closePhotoCaptured,
    ]),
  );
  const elevations = inspection.elevations ?? [];
  const damage = inspection.damageInstances ?? [];
  const s5Remaining = stageDeficiencies(inspection, 'S5').length;

  function openAdd(elevationId: string, label: string) {
    setTarget({ elevationId, label });
    setDamageType('');
    setSeverity('');
    setNote('');
  }

  function capture(damageId: string, label: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'damage_instance',
        subjectId: damageId,
        roles: 'wide,mid,close',
        stage: 'S5',
        title: label,
      },
    });
  }

  async function saveDamage() {
    if (!target || !damageType.trim() || saving) return;
    setSaving(true);
    try {
      const damageId = await createDamageInstance(queryClient, id, {
        elevationId: target.elevationId,
        damageType: damageType.trim(),
        severity: severity.trim() || null,
        causationNote: note.trim() || null,
      });
      const label = damageType.trim();
      setTarget(null);
      capture(damageId, label);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      {elevations.length === 0 ? (
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Icon name="alert-circle" size={22} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
            Walk the elevations first (S1). Collateral damage is recorded per elevation.
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.summary,
            {
              backgroundColor: damage.length > 0 && s5Remaining === 0 ? '#ecfdf5' : colors.card,
              borderColor: damage.length > 0 && s5Remaining === 0 ? colors.success : colors.border,
            },
          ]}
        >
          <Icon name="clipboard" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
              {damage.length === 0
                ? 'No collateral damage recorded yet'
                : s5Remaining === 0
                  ? `${damage.length} instance${damage.length === 1 ? '' : 's'} — all triads complete`
                  : `${s5Remaining} instance${s5Remaining === 1 ? '' : 's'} missing wide/mid/close`}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Each instance needs a wide, mid, and close-up with scale.
            </Text>
          </View>
        </View>
      )}

      {elevations.map((elevation) => {
        const label = DIRECTION_LABELS[elevation.direction as ElevationDirection] ?? elevation.direction;
        const own = damage.filter((d) => d.elevationId === elevation.id);
        return (
          <View key={elevation.id} style={{ gap: 8 }}>
            <Text style={[styles.section, { color: colors.foreground }]}>{label} elevation</Text>
            {own.map((d) => {
              const done = triadComplete.get(d.id) ?? false;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => capture(d.id, d.damageType)}
                  style={[styles.row, { backgroundColor: colors.card, borderColor: done ? colors.success : colors.border }]}
                >
                  <View style={[styles.badge, { backgroundColor: done ? colors.success : colors.accent }]}>
                    <Icon name={done ? 'check' : 'camera'} size={18} color={done ? '#fff' : colors.secondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{d.damageType}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      {done ? 'Triad complete' : 'Tap to finish wide/mid/close'}
                      {d.severity ? ` · ${d.severity}` : ''}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => openAdd(elevation.id, label)}
              style={[styles.addRow, { borderColor: colors.border }]}
            >
              <Icon name="plus" size={18} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Add damage on {label.toLowerCase()}</Text>
            </Pressable>
          </View>
        );
      })}

      <View style={{ height: 40 }} />

      <Modal visible={target !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              Damage on {target?.label.toLowerCase()}
            </Text>
            <Field label="Damage type" value={damageType} onChange={setDamageType} placeholder="e.g. Hail bruising, wind tear" colors={colors} />
            <Field label="Severity (optional)" value={severity} onChange={setSeverity} placeholder="e.g. Moderate" colors={colors} />
            <Field label="Causation note (optional)" value={note} onChange={setNote} placeholder="What caused it?" colors={colors} />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setTarget(null)} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveDamage}
                disabled={!damageType.trim() || saving}
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: !damageType.trim() || saving ? 0.5 : 1 }]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Record & photograph</Text>
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
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', borderRadius: 16, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  secondaryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
});

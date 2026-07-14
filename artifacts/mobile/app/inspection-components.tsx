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
import { useQueryClient } from '@tanstack/react-query';
import {
  ComponentStatus,
  ComponentType,
  PenetrationType,
  getGetInspectionQueryKey,
  useGetInspection,
} from '@workspace/api-client-react';
import type { ComponentStatus as ComponentStatusValue } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { createComponent, createPenetration } from '@/lib/inspectionSync';

// C4 — Components documentation (grouped under the S3 slope/roof phase). Pure
// documentation, no protocol gate: the inspector records which existing roof
// components are present/absent (drip edge, ice & water, ventilation, decking,
// underlayment, flashing), photographs the shingle layer count at an exposed
// eave/rake edge, and builds a roof-penetration inventory. Every record is a
// raw fact — no derived quantities live here.

const CHECKLIST: Array<{ type: ComponentTypeValue; label: string; hint: string }> = [
  { type: ComponentType.drip_edge, label: 'Drip edge', hint: 'Metal edge at eaves & rakes' },
  {
    type: ComponentType.ice_and_water_shield,
    label: 'Ice & water shield',
    hint: 'Peel-and-stick membrane at eaves/valleys',
  },
  { type: ComponentType.ventilation, label: 'Ventilation', hint: 'Ridge / box / soffit vents' },
  { type: ComponentType.decking, label: 'Decking', hint: 'Sheathing beneath the covering' },
  { type: ComponentType.underlayment, label: 'Underlayment', hint: 'Felt / synthetic beneath shingles' },
  { type: ComponentType.flashing, label: 'Flashing', hint: 'Wall / chimney / valley metal' },
];

type ComponentTypeValue = (typeof ComponentType)[keyof typeof ComponentType];
type PenetrationTypeValue = (typeof PenetrationType)[keyof typeof PenetrationType];

const STATUS_LABELS: Record<ComponentStatusValue, string> = {
  present: 'Present',
  absent: 'Absent',
  not_determined: 'Not determined',
};

const PENETRATION_OPTIONS: Array<{ type: PenetrationTypeValue; label: string }> = [
  { type: PenetrationType.plumbing_vent, label: 'Plumbing vent' },
  { type: PenetrationType.pipe_boot, label: 'Pipe boot' },
  { type: PenetrationType.exhaust_vent, label: 'Exhaust vent' },
  { type: PenetrationType.chimney, label: 'Chimney' },
  { type: PenetrationType.skylight, label: 'Skylight' },
  { type: PenetrationType.satellite_mount, label: 'Satellite mount' },
  { type: PenetrationType.other, label: 'Other' },
];

export default function InspectionComponentsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [savingType, setSavingType] = React.useState<ComponentTypeValue | null>(null);
  const [layerCount, setLayerCount] = React.useState('');
  const [savingLayer, setSavingLayer] = React.useState(false);
  const [penetrationModal, setPenetrationModal] = React.useState(false);
  const [penType, setPenType] = React.useState<PenetrationTypeValue>(PenetrationType.plumbing_vent);
  const [flashing, setFlashing] = React.useState('');
  const [penNote, setPenNote] = React.useState('');
  const [savingPen, setSavingPen] = React.useState(false);

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

  const components = inspection.components ?? [];
  const penetrations = inspection.penetrations ?? [];
  const checklistRecords = new Map(
    components
      .filter((c) => c.componentType !== ComponentType.layer_count)
      .map((c) => [c.componentType, c]),
  );
  const layerRecord = components.find((c) => c.componentType === ComponentType.layer_count) ?? null;

  async function recordStatus(type: ComponentTypeValue, status: ComponentStatusValue) {
    if (savingType || checklistRecords.has(type)) return;
    setSavingType(type);
    try {
      await createComponent(queryClient, id, { componentType: type, status });
    } finally {
      setSavingType(null);
    }
  }

  async function recordLayerCount() {
    const count = Number(layerCount);
    if (savingLayer || layerRecord || !layerCount.trim() || Number.isNaN(count) || count < 1) return;
    setSavingLayer(true);
    try {
      const componentId = await createComponent(queryClient, id, {
        componentType: ComponentType.layer_count,
        layerCount: count,
      });
      setLayerCount('');
      capturePhoto('component', componentId, 'Layer count — exposed eave/rake edge');
    } finally {
      setSavingLayer(false);
    }
  }

  async function savePenetration() {
    if (savingPen) return;
    setSavingPen(true);
    try {
      const penetrationId = await createPenetration(queryClient, id, {
        penetrationType: penType,
        flashingCondition: flashing.trim() || null,
        notes: penNote.trim() || null,
      });
      const label = PENETRATION_OPTIONS.find((o) => o.type === penType)?.label ?? 'Penetration';
      setPenetrationModal(false);
      setFlashing('');
      setPenNote('');
      setPenType(PenetrationType.plumbing_vent);
      capturePhoto('penetration', penetrationId, label);
    } finally {
      setSavingPen(false);
    }
  }

  function capturePhoto(subjectType: 'component' | 'penetration', subjectId: string, title: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType,
        subjectId,
        roles: 'wide',
        stage: 'S3',
        title,
      },
    });
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Existing components checklist */}
        <Text style={[styles.section, { color: colors.foreground }]}>Existing components</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 2 }}>
          Record what the roof assembly already has. Each is captured once.
        </Text>
        {CHECKLIST.map((item) => {
          const record = checklistRecords.get(item.type);
          return (
            <View
              key={item.type}
              style={[styles.card, { backgroundColor: colors.card, borderColor: record ? colors.success : colors.border }]}
            >
              <View style={styles.cardHead}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>{item.label}</Text>
                {record ? <Icon name="check" size={18} color={colors.success} /> : null}
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>{item.hint}</Text>
              <View style={styles.statusRow}>
                {(Object.keys(STATUS_LABELS) as ComponentStatusValue[]).map((status) => {
                  const active = record?.status === status;
                  const disabled = !!record && !active;
                  return (
                    <Pressable
                      key={status}
                      onPress={() => recordStatus(item.type, status)}
                      disabled={!!record || savingType === item.type}
                      style={[
                        styles.statusChip,
                        {
                          backgroundColor: active ? colors.primary : 'transparent',
                          borderColor: active ? colors.primary : colors.border,
                          opacity: disabled ? 0.4 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: active ? colors.primaryForeground : colors.foreground,
                          fontSize: 13,
                          fontWeight: '600',
                        }}
                      >
                        {STATUS_LABELS[status]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}

        {/* Layer count */}
        <Text style={[styles.section, { color: colors.foreground }]}>Shingle layer count</Text>
        {layerRecord ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.success }]}>
            <View style={styles.cardHead}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {layerRecord.layerCount} layer{layerRecord.layerCount === 1 ? '' : 's'} recorded
              </Text>
              <Icon name="check" size={18} color={colors.success} />
            </View>
            <Pressable
              onPress={() => capturePhoto('component', layerRecord.id, 'Layer count — exposed eave/rake edge')}
              style={[styles.addRow, { borderColor: colors.border, marginTop: 8 }]}
            >
              <Icon name="camera" size={18} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Re-photograph the exposed edge</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 8 }}>
              Count the shingle layers at an exposed eave or rake edge, then photograph it.
            </Text>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Number of layers</Text>
              <TextInput
                value={layerCount}
                onChangeText={setLayerCount}
                placeholder="e.g. 2"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric"
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>
            <Pressable
              onPress={recordLayerCount}
              disabled={!layerCount.trim() || savingLayer}
              style={[styles.addBtn, { backgroundColor: colors.primary, opacity: !layerCount.trim() || savingLayer ? 0.5 : 1 }]}
            >
              {savingLayer ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.addText, { color: colors.primaryForeground }]}>Record & photograph</Text>
              )}
            </Pressable>
          </View>
        )}

        {/* Penetration inventory */}
        <Text style={[styles.section, { color: colors.foreground }]}>
          Penetrations {penetrations.length > 0 ? `(${penetrations.length})` : ''}
        </Text>
        {penetrations.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 4 }}>
            Inventory every roof penetration (vents, boots, chimney, skylights) with a photo.
          </Text>
        ) : (
          penetrations.map((pen) => {
            const label = PENETRATION_OPTIONS.find((o) => o.type === pen.penetrationType)?.label ?? pen.penetrationType;
            return (
              <Pressable
                key={pen.id}
                onPress={() => capturePhoto('penetration', pen.id, label)}
                style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                  <Icon name="camera" size={18} color={colors.secondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>{label}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    {pen.flashingCondition ? `Flashing: ${pen.flashingCondition}` : 'Tap to add another photo'}
                  </Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
              </Pressable>
            );
          })
        )}
        <Pressable
          onPress={() => setPenetrationModal(true)}
          style={[styles.addRow, { borderColor: colors.border }]}
        >
          <Icon name="plus" size={18} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Add penetration</Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={penetrationModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Add penetration</Text>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Type</Text>
            <View style={styles.typeGrid}>
              {PENETRATION_OPTIONS.map((option) => {
                const active = penType === option.type;
                return (
                  <Pressable
                    key={option.type}
                    onPress={() => setPenType(option.type)}
                    style={[
                      styles.typeChip,
                      {
                        backgroundColor: active ? colors.primary : 'transparent',
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Field label="Flashing condition (optional)" value={flashing} onChange={setFlashing} placeholder="e.g. Sealed, cracked boot" colors={colors} />
            <Field label="Notes (optional)" value={penNote} onChange={setPenNote} placeholder="Anything worth noting" colors={colors} />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setPenetrationModal(false)} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={savePenetration}
                disabled={savingPen}
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: savingPen ? 0.5 : 1 }]}
              >
                {savingPen ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Add & photograph</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  statusRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statusChip: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
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
  addBtn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  addText: { fontSize: 15, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', borderRadius: 16, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  secondaryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
});

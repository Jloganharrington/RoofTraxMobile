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
import { createComponent, createPenetration, deleteComponent, updateComponent } from '@/lib/inspectionSync';

// C4 — Components documentation (grouped under the S3 slope/roof phase). Pure
// documentation, no protocol gate: the inspector records which existing roof
// components are present/absent (drip edge, ice & water, ventilation, decking,
// underlayment, flashing), photographs the shingle layer count at an exposed
// eave/rake edge, and builds a roof-penetration inventory. Every record is a
// raw fact — no derived quantities live here.

// Checklist items are either a present/absent status observation or a
// pick-one detail selection (stored in `notes`, with a raw present/absent
// status derived from the option). Selections are editable: tapping a
// different chip changes the record, tapping the active chip clears it.
type ChecklistItem =
  | { kind: 'status'; type: ComponentTypeValue; label: string; hint: string }
  | {
      kind: 'options';
      type: ComponentTypeValue;
      label: string;
      hint: string;
      options: Array<{ label: string; status: ComponentStatusValue }>;
    };

// Zone-based capture: one shared zone photo evidences every component
// documented in that zone (a single eave shot shows the drip edge, gutter
// apron, starter, ice-&-water and decking layers at once). The gate needs a
// zone photo only for zones with ≥1 documented component.
type ComponentZoneValue = 'eave_edge' | 'ridge_hip';

interface ZoneGroup {
  zone: ComponentZoneValue;
  title: string;
  photoCaption: string;
  hint: string;
  items: ChecklistItem[];
  /** The eave zone hosts the numeric layer-count input. */
  hasLayerCount: boolean;
}

const ZONE_GROUPS: ZoneGroup[] = [
  {
    zone: 'eave_edge',
    title: 'Eave / Edge',
    photoCaption: 'Eave/Edge — components',
    hint: 'One eave shot evidences every edge component and the layer count.',
    hasLayerCount: true,
    items: [
      { kind: 'status', type: ComponentType.gutter_apron, label: 'Gutter apron', hint: 'Metal edge at the eaves over the gutter' },
      { kind: 'status', type: ComponentType.drip_edge, label: 'Drip edge', hint: 'Metal edge at eaves & rakes' },
      { kind: 'status', type: ComponentType.starter, label: 'Starter', hint: 'Starter strip at eaves & rakes' },
      {
        kind: 'status',
        type: ComponentType.ice_and_water_shield,
        label: 'Ice & water shield',
        hint: 'Peel-and-stick membrane at eaves/valleys',
      },
      { kind: 'status', type: ComponentType.underlayment, label: 'Underlayment', hint: 'Felt / synthetic beneath shingles' },
      {
        kind: 'options',
        type: ComponentType.decking,
        label: 'Decking',
        hint: 'Sheathing beneath the covering',
        options: [
          { label: 'Plywood 3/8"', status: ComponentStatus.present },
          { label: 'Plywood 1/2"+', status: ComponentStatus.present },
          { label: 'Spaced Decking', status: ComponentStatus.present },
        ],
      },
    ],
  },
  {
    zone: 'ridge_hip',
    title: 'Ridge / Hip',
    photoCaption: 'Ridge/Hip — components',
    hint: 'One ridge shot evidences the ventilation observation.',
    hasLayerCount: false,
    items: [
      {
        kind: 'options',
        type: ComponentType.ventilation,
        label: 'Ventilation',
        hint: 'Ridge / box / soffit vents',
        options: [
          { label: 'None', status: ComponentStatus.absent },
          { label: 'Box Vents', status: ComponentStatus.present },
          { label: 'Alum Ridge', status: ComponentStatus.present },
          { label: 'SOS Ridge', status: ComponentStatus.present },
        ],
      },
    ],
  },
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
  // Synchronous single-flight guard: React state alone can't stop a rapid
  // double-tap (the disabled prop only applies after a re-render), which
  // could enqueue conflicting create/update/delete ops for the same type.
  const inFlightTypes = React.useRef<Set<ComponentTypeValue>>(new Set());
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
  // Zones whose shared zone photo has been captured (subjectType 'component'
  // with a zone tag; includes optimistic offline captures).
  const photos = inspection.photos ?? [];
  const capturedZones = new Set(
    photos.filter((p) => p.subjectType === 'component' && p.zone).map((p) => p.zone),
  );

  // Tapping a chip creates the observation; tapping a different chip changes
  // it; tapping the active chip deselects (removes the record).
  async function tapStatus(type: ComponentTypeValue, status: ComponentStatusValue) {
    if (inFlightTypes.current.has(type)) return;
    inFlightTypes.current.add(type);
    const record = checklistRecords.get(type);
    setSavingType(type);
    try {
      if (!record) {
        await createComponent(queryClient, id, { componentType: type, status });
      } else if (record.status === status) {
        await deleteComponent(queryClient, id, record.id);
      } else {
        await updateComponent(queryClient, id, record.id, { status });
      }
    } finally {
      inFlightTypes.current.delete(type);
      setSavingType(null);
    }
  }

  async function tapOption(
    type: ComponentTypeValue,
    option: { label: string; status: ComponentStatusValue },
  ) {
    if (inFlightTypes.current.has(type)) return;
    inFlightTypes.current.add(type);
    const record = checklistRecords.get(type);
    setSavingType(type);
    try {
      if (!record) {
        await createComponent(queryClient, id, {
          componentType: type,
          status: option.status,
          notes: option.label,
        });
      } else if (record.notes === option.label) {
        await deleteComponent(queryClient, id, record.id);
      } else {
        await updateComponent(queryClient, id, record.id, {
          status: option.status,
          notes: option.label,
        });
      }
    } finally {
      inFlightTypes.current.delete(type);
      setSavingType(null);
    }
  }

  // Layer count is recorded as data only — the shared Eave/Edge zone photo
  // is its evidence, so no per-record photo capture is forced.
  async function recordLayerCount() {
    const count = Number(layerCount);
    if (savingLayer || layerRecord || !layerCount.trim() || Number.isNaN(count) || count < 1) return;
    setSavingLayer(true);
    try {
      await createComponent(queryClient, id, {
        componentType: ComponentType.layer_count,
        layerCount: count,
      });
      setLayerCount('');
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
        stage: 'components',
        title,
      },
    });
  }

  // Shared zone photo: subjectType 'component' with a zone tag and no
  // subjectId — one shot evidences every component documented in the zone.
  function captureZonePhoto(zone: ComponentZoneValue, caption: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'component',
        roles: 'wide',
        stage: 'components',
        title: caption,
        zone,
      },
    });
  }

  function renderChecklistItem(item: ChecklistItem) {
    const record = checklistRecords.get(item.type);
    const chips =
      item.kind === 'status'
        ? (Object.keys(STATUS_LABELS) as ComponentStatusValue[]).map((status) => ({
            key: status,
            label: STATUS_LABELS[status],
            active: record?.status === status,
            onPress: () => tapStatus(item.type, status),
          }))
        : item.options.map((option) => ({
            key: option.label,
            label: option.label,
            active: record?.notes === option.label,
            onPress: () => tapOption(item.type, option),
          }));
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
          {chips.map((chip) => (
            <Pressable
              key={chip.key}
              onPress={chip.onPress}
              disabled={savingType === item.type}
              style={[
                styles.statusChip,
                {
                  backgroundColor: chip.active ? colors.primary : 'transparent',
                  borderColor: chip.active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color: chip.active ? colors.primaryForeground : colors.foreground,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {chip.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // Layer count keeps its numeric input; the shared Eave/Edge zone photo is
  // its evidence — no per-record photo is required.
  function renderLayerCount() {
    if (layerRecord) {
      return (
        <View
          key="layer-count"
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.success }]}
        >
          <View style={styles.cardHead}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              {layerRecord.layerCount} shingle layer{layerRecord.layerCount === 1 ? '' : 's'} recorded
            </Text>
            <Icon name="check" size={18} color={colors.success} />
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            Evidenced by the Eave/Edge zone photo.
          </Text>
        </View>
      );
    }
    return (
      <View
        key="layer-count"
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>Shingle layer count</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
          Count the layers at an exposed eave or rake edge — the zone photo is the evidence.
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
            <Text style={[styles.addText, { color: colors.primaryForeground }]}>Record layer count</Text>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Existing components — zone-based capture */}
        <Text style={[styles.section, { color: colors.foreground }]}>Existing components</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 2 }}>
          Record what the roof assembly already has. Tap again to deselect. One shared photo per
          zone evidences everything documented in it.
        </Text>
        {ZONE_GROUPS.map((group) => {
          const zoneDocumented =
            group.items.some((item) => checklistRecords.has(item.type)) ||
            (group.hasLayerCount && layerRecord !== null);
          const zonePhotoCaptured = capturedZones.has(group.zone);
          return (
            <View key={group.zone} style={{ gap: 10 }}>
              <View style={[styles.cardHead, { marginTop: 8 }]}>
                <Text style={[styles.zoneTitle, { color: colors.foreground }]}>{group.title}</Text>
                {zonePhotoCaptured ? <Icon name="check" size={18} color={colors.success} /> : null}
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: -6 }}>
                {group.hint}
              </Text>
              <Pressable
                onPress={() => captureZonePhoto(group.zone, group.photoCaption)}
                style={[
                  styles.addRow,
                  {
                    borderColor:
                      zoneDocumented && !zonePhotoCaptured ? colors.primary : colors.border,
                  },
                ]}
              >
                <Icon name="camera" size={18} color={colors.primary} />
                <Text style={{ color: colors.primary, fontWeight: '600' }}>
                  {zonePhotoCaptured ? 'Add another zone photo' : `Photograph ${group.title} zone`}
                </Text>
              </Pressable>
              {zoneDocumented && !zonePhotoCaptured ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: -4 }}>
                  Components are documented in this zone — a zone photo is required.
                </Text>
              ) : null}
              {group.items.map((item) => renderChecklistItem(item))}
              {group.hasLayerCount ? renderLayerCount() : null}
            </View>
          );
        })}

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
  zoneTitle: { fontSize: 15, fontWeight: '700' },
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

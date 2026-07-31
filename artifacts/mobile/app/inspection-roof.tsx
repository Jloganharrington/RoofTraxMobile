import React from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  ComponentStatus,
  ComponentType,
  getGetInspectionQueryKey,
  useGetInspection,
} from '@workspace/api-client-react';
import type { ComponentStatus as ComponentStatusValue } from '@workspace/api-client-react';
import { WHOLE_ROOF_LINEAR_TYPES } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import {
  createComponent,
  createMeasurement,
  createSlope,
  deleteComponent,
  updateComponent,
} from '@/lib/inspectionSync';
import { buildProtocolState, stageDeficiencies } from '@/lib/inspectionProtocolState';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';
import { storagePhotoUri, useStorageAuthHeaders } from '@/components/DiscontinuedProductsModal';

// Step 3 · Roof Facets (protocol v2). The Eave/Edge component zone is
// documented here first (merged from Components), then the inspector counts
// facets and documents each plane. Whole-roof linears follow the facet list.

type ComponentTypeValue = (typeof ComponentType)[keyof typeof ComponentType];

const LINEAR_LABELS: Record<(typeof WHOLE_ROOF_LINEAR_TYPES)[number], string> = {
  ridge_lf: 'Ridge',
  hip_lf: 'Hip',
  valley_lf: 'Valley',
  eave_lf: 'Eave',
  rake_lf: 'Rake',
};

const STATUS_LABELS: Record<ComponentStatusValue, string> = {
  present: 'Present',
  absent: 'Absent',
  not_determined: 'Not determined',
};

// Eave/Edge checklist items (status observations).
const EAVE_STATUS_ITEMS: Array<{
  type: ComponentTypeValue;
  label: string;
  hint: string;
}> = [
  { type: ComponentType.gutter_apron, label: 'Gutter apron', hint: 'Metal edge at the eaves over the gutter' },
  { type: ComponentType.drip_edge, label: 'Drip edge', hint: 'Metal edge on Rakes' },
  { type: ComponentType.starter, label: 'Starter', hint: 'Starter strip at eaves & rakes' },
  { type: ComponentType.ice_and_water_shield, label: 'Ice & water shield', hint: 'Peel-and-stick membrane at eaves/valleys' },
  { type: ComponentType.underlayment, label: 'Underlayment', hint: 'Felt / synthetic beneath shingles' },
];

// Decking type+thickness options (all map to present status).
const DECKING_OPTIONS: Array<{ label: string; status: ComponentStatusValue }> = [
  { label: 'Plywood 3/8"', status: ComponentStatus.present },
  { label: 'Plywood 1/2"+', status: ComponentStatus.present },
  { label: 'Spaced Decking', status: ComponentStatus.present },
];

export default function InspectionRoofScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 44;
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  useNextSectionHeader(id, 'facets');

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const refetch = inspectionQuery.refetch;
  useFocusEffect(
    React.useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  // Facet list state
  const [facetCount, setFacetCount] = React.useState('');
  const [seeding, setSeeding] = React.useState(false);
  const [addingFacet, setAddingFacet] = React.useState(false);
  const [linearDrafts, setLinearDrafts] = React.useState<Record<string, string>>({});
  const [savingLinear, setSavingLinear] = React.useState<string | null>(null);

  // Eave/Edge component state
  const [savingComponentType, setSavingComponentType] = React.useState<ComponentTypeValue | null>(null);
  const inFlightTypes = React.useRef<Set<ComponentTypeValue>>(new Set());
  // Gate: "Can decking be determined at this time?" null=unanswered, yes/no
  const [deckingDeterminable, setDeckingDeterminable] = React.useState<'yes' | 'no' | null>(null);
  // Gate: "Can shingle layer count be determined at this time?" null=unanswered, yes/no
  const [layerDeterminable, setLayerDeterminable] = React.useState<'yes' | 'no' | null>(null);
  const [savingLayer, setSavingLayer] = React.useState(false);
  const [eaveEdgeSaved, setEaveEdgeSaved] = React.useState(false);
  const authHeaders = useStorageAuthHeaders();

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

  // ── Derived: facets ──────────────────────────────────────────────────────────
  const state = buildProtocolState(inspection);
  const facets = inspection.slopes ?? [];
  const facetById = new Map(state.facets.map((f) => [f.id, f]));
  const remaining = stageDeficiencies(inspection, 'facets').length;
  const measurements = inspection.measurements ?? [];
  const linearsByType = new Map(
    measurements
      .filter((m) => m.subjectType !== 'slope')
      .map((m) => [m.measurementType, m.value] as const),
  );

  // ── Derived: eave/edge components ───────────────────────────────────────────
  const components = inspection.components ?? [];
  const checklistRecords = new Map(
    components
      .filter((c) => c.componentType !== ComponentType.layer_count)
      .map((c) => [c.componentType, c]),
  );
  const layerRecord = components.find((c) => c.componentType === ComponentType.layer_count) ?? null;
  const deckingRecord = checklistRecords.get(ComponentType.decking) ?? null;
  const photos = inspection.photos ?? [];
  const eaveZonePhotos = photos.filter((p) => p.subjectType === 'component' && p.zone === 'eave_edge');
  const shingleGaugePhotos = photos.filter((p) => p.subjectType === 'component' && p.zone === 'shingle_gauge');
  const eaveZoneCaptured = eaveZonePhotos.length > 0;
  const shingleGaugeCaptured = shingleGaugePhotos.length > 0;

  // Gate: all eave/edge items must be answered before facets are accessible.
  const allStatusAnswered = EAVE_STATUS_ITEMS.every((item) => checklistRecords.has(item.type));
  const deckingAnswered = deckingRecord !== null || deckingDeterminable === 'no';
  const layerAnswered = layerRecord !== null || layerDeterminable === 'no';
  const eaveEdgeComplete = eaveZoneCaptured && allStatusAnswered && deckingAnswered && layerAnswered;

  // ── Facet helpers ─────────────────────────────────────────────────────────
  function nextFacetLabel(offset = 0): string {
    const max = facets.reduce((acc, facet) => {
      const match = /^F(\d+)$/.exec(facet.label);
      return match ? Math.max(acc, Number(match[1])) : acc;
    }, 0);
    return `F${max + 1 + offset}`;
  }

  async function seedFacets() {
    const count = Number(facetCount);
    if (!Number.isInteger(count) || count < 1 || count > 40 || seeding) return;
    setSeeding(true);
    try {
      for (let i = 0; i < count; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await createSlope(queryClient, id, { label: `F${i + 1}` });
      }
      setFacetCount('');
    } finally {
      setSeeding(false);
    }
  }

  async function addFacet() {
    if (addingFacet) return;
    setAddingFacet(true);
    try {
      const slopeId = await createSlope(queryClient, id, { label: nextFacetLabel() });
      router.push({ pathname: '/inspection-facet', params: { id, slopeId } });
    } finally {
      setAddingFacet(false);
    }
  }

  async function saveLinear(type: string) {
    const raw = (linearDrafts[type] ?? '').trim();
    const value = Number(raw);
    if (!raw || Number.isNaN(value) || value < 0 || savingLinear) return;
    setSavingLinear(type);
    try {
      await createMeasurement(queryClient, id, {
        subjectType: 'inspection',
        subjectId: null,
        measurementType: type,
        value,
        unit: 'lf',
      });
      setLinearDrafts((prev) => ({ ...prev, [type]: '' }));
    } finally {
      setSavingLinear(null);
    }
  }

  const facetComplete = (facetId: string): boolean => {
    const facet = facetById.get(facetId);
    if (!facet) return false;
    if (!(facet.hasArea && facet.hasMaterial && facet.hasPitch)) return false;
    if (!facet.damagePresent) return true;
    const records = state.damageInstances.filter((d) => d.slopeId === facetId);
    return records.length > 0 && records.every((d) => d.photoCaptured);
  };

  // ── Eave/Edge component helpers ────────────────────────────────────────────

  async function tapStatus(type: ComponentTypeValue, status: ComponentStatusValue) {
    if (inFlightTypes.current.has(type)) return;
    inFlightTypes.current.add(type);
    const record = checklistRecords.get(type);
    setSavingComponentType(type);
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
      setSavingComponentType(null);
    }
  }

  async function tapOption(
    type: ComponentTypeValue,
    option: { label: string; status: ComponentStatusValue },
  ) {
    if (inFlightTypes.current.has(type)) return;
    inFlightTypes.current.add(type);
    const record = checklistRecords.get(type);
    setSavingComponentType(type);
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
      setSavingComponentType(null);
    }
  }

  async function recordLayerCount(count: 1 | 2) {
    if (savingLayer || layerRecord) return;
    setSavingLayer(true);
    try {
      await createComponent(queryClient, id, {
        componentType: ComponentType.layer_count,
        layerCount: count,
      });
      if (count === 2) {
        // 2+ layers — capture photo evidence with an auto-set caption.
        router.push({
          pathname: '/inspection-photo-capture',
          params: {
            inspectionId: id,
            subjectType: 'component',
            roles: 'wide',
            stage: 'components',
            title: 'Shingle layer count — 2+',
            zone: 'eave_edge',
            caption: 'More than one layer of roofing surface identified',
          },
        });
      }
    } finally {
      setSavingLayer(false);
    }
  }

  function captureEaveZonePhoto() {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'component',
        roles: 'wide',
        stage: 'components',
        title: 'Eave/Edge — components',
        zone: 'eave_edge',
      },
    });
  }

  function captureShingleGaugePhoto() {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'component',
        roles: 'close',
        stage: 'components',
        title: 'Shingle Gauge',
        zone: 'shingle_gauge',
        caption: 'Place shingle gauge on a shingle and capture photo',
      },
    });
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderStatusItem(item: { type: ComponentTypeValue; label: string; hint: string }) {
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
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 6 }}>{item.hint}</Text>
        <View style={styles.chipRow}>
          {(Object.keys(STATUS_LABELS) as ComponentStatusValue[]).map((status) => {
            const active = record?.status === status;
            return (
              <Pressable
                key={status}
                onPress={() => tapStatus(item.type, status)}
                disabled={savingComponentType === item.type}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primary : 'transparent',
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>
                  {STATUS_LABELS[status]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  function renderDecking() {
    // Already has a record — show it in its settled state; tapping reopens options.
    if (deckingRecord) {
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.success }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Decking</Text>
            <Icon name="check" size={18} color={colors.success} />
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 6 }}>
            {deckingRecord.notes ?? deckingRecord.status}
          </Text>
          <View style={styles.chipRow}>
            {DECKING_OPTIONS.map((opt) => {
              const active = deckingRecord.notes === opt.label;
              return (
                <Pressable
                  key={opt.label}
                  onPress={() => tapOption(ComponentType.decking, opt)}
                  disabled={savingComponentType === ComponentType.decking}
                  style={[styles.chip, { backgroundColor: active ? colors.primary : 'transparent', borderColor: active ? colors.primary : colors.border }]}
                >
                  <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }

    // Gate question
    if (deckingDeterminable === null) {
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Decking</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
            Can decking type and thickness be determined at this time?
          </Text>
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => setDeckingDeterminable('yes')}
              style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>Yes</Text>
            </Pressable>
            <Pressable
              onPress={() => setDeckingDeterminable('no')}
              style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>No</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (deckingDeterminable === 'no') {
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Decking</Text>
            <Pressable onPress={() => setDeckingDeterminable(null)} hitSlop={8}>
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>Change</Text>
            </Pressable>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            Not determinable at this time.
          </Text>
        </View>
      );
    }

    // deckingDeterminable === 'yes' — show options
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHead}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Decking</Text>
          <Pressable onPress={() => setDeckingDeterminable(null)} hitSlop={8}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Not determinable</Text>
          </Pressable>
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 6 }}>
          Sheathing beneath the covering
        </Text>
        <View style={styles.chipRow}>
          {DECKING_OPTIONS.map((opt) => {
            const record = checklistRecords.get(ComponentType.decking);
            const active = record?.notes === opt.label;
            return (
              <Pressable
                key={opt.label}
                onPress={() => tapOption(ComponentType.decking, opt)}
                disabled={savingComponentType === ComponentType.decking}
                style={[styles.chip, { backgroundColor: active ? colors.primary : 'transparent', borderColor: active ? colors.primary : colors.border }]}
              >
                <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  function renderLayerCount() {
    // Already recorded — show settled state
    if (layerRecord) {
      const display = layerRecord.layerCount != null && layerRecord.layerCount >= 2 ? '2+' : '1';
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.success }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              Shingle layer count — {display}
            </Text>
            <Icon name="check" size={18} color={colors.success} />
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            {display === '2+' ? 'Photo evidence required — check Evidence Photos.' : 'Evidenced by the Eave/Edge zone photo.'}
          </Text>
        </View>
      );
    }

    // Gate question
    if (layerDeterminable === null) {
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Shingle layer count</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
            Can shingle layer count be determined at this time?
          </Text>
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => setLayerDeterminable('yes')}
              style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>Yes</Text>
            </Pressable>
            <Pressable
              onPress={() => setLayerDeterminable('no')}
              style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>No</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (layerDeterminable === 'no') {
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Shingle layer count</Text>
            <Pressable onPress={() => setLayerDeterminable(null)} hitSlop={8}>
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>Change</Text>
            </Pressable>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            Not determinable at this time.
          </Text>
        </View>
      );
    }

    // layerDeterminable === 'yes' — show 1 / 2+ chips
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHead}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Shingle layer count</Text>
          <Pressable onPress={() => setLayerDeterminable(null)} hitSlop={8}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Not determinable</Text>
          </Pressable>
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
          Count layers at an exposed eave or rake edge.
        </Text>
        <View style={styles.chipRow}>
          <Pressable
            onPress={() => recordLayerCount(1)}
            disabled={savingLayer}
            style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border, opacity: savingLayer ? 0.5 : 1 }]}
          >
            {savingLayer ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>1</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => recordLayerCount(2)}
            disabled={savingLayer}
            style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border, opacity: savingLayer ? 0.5 : 1 }]}
          >
            {savingLayer ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>2+</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Eave / Edge ─────────────────────────────────────────────────── */}
        <Text style={[styles.section, { color: colors.foreground, marginTop: 0 }]}>Eave / Edge</Text>

        {eaveEdgeSaved ? (
          /* ── Collapsed summary ── */
          <Pressable
            onPress={() => setEaveEdgeSaved(false)}
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.success }]}
          >
            <View style={[styles.badge, { backgroundColor: colors.success }]}>
              <Icon name="check" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Eave / Edge — Complete</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {eaveZonePhotos.length} eave photo{eaveZonePhotos.length === 1 ? '' : 's'} · {shingleGaugePhotos.length} gauge photo{shingleGaugePhotos.length === 1 ? '' : 's'} · all items answered
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          /* ── Expanded form ── */
          <>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 2 }}>
              One eave shot evidences every edge component and the layer count.
            </Text>

            {/* Eave / edge zone photo */}
            <View style={[styles.photoCapture, { borderColor: eaveZoneCaptured ? colors.success : colors.primary, backgroundColor: colors.card }]}>
              <Pressable onPress={captureEaveZonePhoto} style={styles.photoCaptureBtn}>
                <Icon name="camera" size={18} color={eaveZoneCaptured ? colors.success : colors.primary} />
                <Text style={{ color: eaveZoneCaptured ? colors.success : colors.primary, fontWeight: '600', flex: 1 }}>
                  {eaveZoneCaptured ? 'Eave / edge zone' : 'Photograph eave / edge zone'}
                </Text>
                {eaveZoneCaptured
                  ? <Icon name="check" size={16} color={colors.success} />
                  : <Icon name="chevron-right" size={16} color={colors.primary} />}
              </Pressable>
              {eaveZonePhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbStrip} contentContainerStyle={styles.thumbContent}>
                  {eaveZonePhotos.map((p) => (
                    <Image
                      key={p.id}
                      source={{ uri: storagePhotoUri(p.url), headers: authHeaders ?? undefined }}
                      style={styles.thumb}
                      resizeMode="cover"
                    />
                  ))}
                  <Pressable onPress={captureEaveZonePhoto} style={[styles.thumbAdd, { borderColor: colors.border }]}>
                    <Icon name="plus" size={20} color={colors.mutedForeground} />
                  </Pressable>
                </ScrollView>
              )}
            </View>

            {/* Shingle gauge photo */}
            <View style={[styles.photoCapture, { borderColor: shingleGaugeCaptured ? colors.success : colors.primary, backgroundColor: colors.card }]}>
              <Pressable onPress={captureShingleGaugePhoto} style={styles.photoCaptureBtn}>
                <Icon name="camera" size={18} color={shingleGaugeCaptured ? colors.success : colors.primary} />
                <Text style={{ color: shingleGaugeCaptured ? colors.success : colors.primary, fontWeight: '600', flex: 1 }}>
                  {shingleGaugeCaptured ? 'Shingle Gauge' : 'Shingle Gauge — capture photo'}
                </Text>
                {shingleGaugeCaptured
                  ? <Icon name="check" size={16} color={colors.success} />
                  : <Icon name="chevron-right" size={16} color={colors.primary} />}
              </Pressable>
              {shingleGaugePhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbStrip} contentContainerStyle={styles.thumbContent}>
                  {shingleGaugePhotos.map((p) => (
                    <Image
                      key={p.id}
                      source={{ uri: storagePhotoUri(p.url), headers: authHeaders ?? undefined }}
                      style={styles.thumb}
                      resizeMode="cover"
                    />
                  ))}
                  <Pressable onPress={captureShingleGaugePhoto} style={[styles.thumbAdd, { borderColor: colors.border }]}>
                    <Icon name="plus" size={20} color={colors.mutedForeground} />
                  </Pressable>
                </ScrollView>
              )}
            </View>

            {EAVE_STATUS_ITEMS.map((item) => renderStatusItem(item))}
            {renderDecking()}
            {renderLayerCount()}

            {/* Save button — only shown when section is complete */}
            {eaveEdgeComplete && (
              <Pressable
                onPress={() => setEaveEdgeSaved(true)}
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.addText, { color: colors.primaryForeground }]}>Save Eave / Edge</Text>
              </Pressable>
            )}
          </>
        )}

        {/* ── Facets ─────────────────────────────────────────────────────── */}
        <Text style={[styles.section, { color: colors.foreground }]}>Facets</Text>

        {!eaveEdgeComplete ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHead}>
              <Icon name="slash" size={18} color={colors.mutedForeground} />
              <Text style={[styles.rowTitle, { color: colors.mutedForeground, flex: 1, marginLeft: 8 }]}>
                Complete Eave / Edge first
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 2 }}>
              Photograph the eave/edge zone, answer all component status items, decking, and layer count before moving on to facets.
            </Text>
          </View>
        ) : facets.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              How many facets does this roof have?
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Every distinct roof plane is a facet. This seeds an F1…F{'{n}'} list you can edit —
              add or remove facets at any time.
            </Text>
            <TextInput
              value={facetCount}
              onChangeText={setFacetCount}
              placeholder="e.g. 4"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            />
            <Pressable
              onPress={seedFacets}
              disabled={seeding || !facetCount.trim()}
              style={[styles.addBtn, { backgroundColor: colors.primary, opacity: seeding || !facetCount.trim() ? 0.5 : 1 }]}
            >
              {seeding ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.addText, { color: colors.primaryForeground }]}>Create facet list</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <>
            {facets.map((facet) => {
              const done = facetComplete(facet.id);
              const info = facetById.get(facet.id);
              const missing: string[] = [];
              if (info && !info.hasArea) missing.push('area');
              if (info && !info.hasMaterial) missing.push('material');
              if (info && !info.hasPitch) missing.push('pitch');
              return (
                <Pressable
                  key={facet.id}
                  onPress={() =>
                    router.push({ pathname: '/inspection-facet', params: { id, slopeId: facet.id } })
                  }
                  style={[styles.row, { backgroundColor: colors.card, borderColor: done ? colors.success : colors.border }]}
                >
                  <View style={[styles.badge, { backgroundColor: done ? colors.success : colors.accent }]}>
                    <Icon name={done ? 'check' : 'clipboard'} size={18} color={done ? '#fff' : colors.secondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{facet.label}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      {done
                        ? `Documented${facet.damagePresent ? ` · ${facet.damageType ?? 'damage'}` : ' · no damage'}`
                        : missing.length > 0
                          ? `Needs ${missing.join(', ')}`
                          : facet.damagePresent
                            ? 'Damage documentation incomplete'
                            : 'Tap to document'}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
                </Pressable>
              );
            })}
            <Pressable
              onPress={addFacet}
              disabled={addingFacet}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, borderStyle: 'dashed' }]}
            >
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                {addingFacet ? (
                  <ActivityIndicator color={colors.secondary} />
                ) : (
                  <Icon name="plus" size={18} color={colors.secondary} />
                )}
              </View>
              <Text style={[styles.rowTitle, { color: colors.foreground, flex: 1 }]}>Add facet</Text>
            </Pressable>

            {/* Whole-roof linears */}
            <Text style={[styles.section, { color: colors.foreground }]}>Whole-roof linears (LF)</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Recorded once for the whole roof — at least one linear is required.
            </Text>
            {WHOLE_ROOF_LINEAR_TYPES.map((type) => {
              const saved = linearsByType.get(type);
              return (
                <View
                  key={type}
                  style={[styles.linearRow, { backgroundColor: colors.card, borderColor: saved != null ? colors.success : colors.border }]}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '600', width: 64 }}>
                    {LINEAR_LABELS[type]}
                  </Text>
                  {saved != null ? (
                    <Text style={{ color: colors.success, fontWeight: '700', flex: 1 }}>
                      {saved} lf recorded
                    </Text>
                  ) : (
                    <>
                      <TextInput
                        value={linearDrafts[type] ?? ''}
                        onChangeText={(v) => setLinearDrafts((prev) => ({ ...prev, [type]: v }))}
                        placeholder="0"
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="decimal-pad"
                        style={[styles.linearInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                      />
                      <Pressable
                        onPress={() => saveLinear(type)}
                        disabled={savingLinear === type}
                        style={[styles.linearSave, { backgroundColor: colors.primary, opacity: savingLinear === type ? 0.5 : 1 }]}
                      >
                        {savingLinear === type ? (
                          <ActivityIndicator color={colors.primaryForeground} size="small" />
                        ) : (
                          <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save</Text>
                        )}
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })}

            <Text style={{ color: remaining === 0 ? colors.success : colors.mutedForeground, fontSize: 13, marginTop: 4 }}>
              {remaining === 0
                ? 'Facet documentation complete.'
                : `${remaining} item${remaining === 1 ? '' : 's'} still required on this step.`}
            </Text>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
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
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  chip: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
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
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginTop: 4 },
  addBtn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  addText: { fontSize: 15, fontWeight: '700' },
  linearRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  linearInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  linearSave: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
  photoCapture: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  photoCaptureBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14 },
  thumbStrip: { height: 100, borderTopWidth: StyleSheet.hairlineWidth },
  thumbContent: { paddingHorizontal: 10, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 80, height: 80, borderRadius: 8 },
  thumbAdd: { width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
});

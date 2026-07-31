import React from 'react';
import {
  ActivityIndicator,
  Image,
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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  ComponentStatus,
  ComponentType,
  PenetrationType,
  ProductIdMethod,
  getGetInspectionQueryKey,
  useGetInspection,
} from '@workspace/api-client-react';
import type {
  ComponentStatus as ComponentStatusValue,
  TestSquareHitType,
} from '@workspace/api-client-react';
import { carriesHail, WHOLE_ROOF_LINEAR_TYPES } from '@workspace/protocol';
import type { FacetDamageType } from '@workspace/protocol';
import { Icon, type IconName } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import {
  createComponent,
  createMeasurement,
  createPenetration,
  createProduct,
  createSlope,
  createTestSquare,
  createTestSquareHit,
  deleteComponent,
  updateComponent,
} from '@/lib/inspectionSync';
import { type DiscontinuedProduct } from '@/lib/discontinuedProductsApi';
import {
  ProductMatchPickerModal,
  formatInches,
} from '@/components/DiscontinuedProductsModal';
import { buildProtocolState, stageDeficiencies } from '@/lib/inspectionProtocolState';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';
import { storagePhotoUri, useStorageAuthHeaders } from '@/components/DiscontinuedProductsModal';

// Step 3 · Roof Inspection (protocol v2). Eave/Edge components → Facets →
// Linears → Ridge/Hip + Ventilation + Penetrations → Test Squares → Product ID.
// Each section collapses to a summary row once saved.

type ComponentTypeValue = (typeof ComponentType)[keyof typeof ComponentType];
type PenetrationTypeValue = (typeof PenetrationType)[keyof typeof PenetrationType];

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

const EAVE_STATUS_ITEMS: Array<{ type: ComponentTypeValue; label: string; hint: string }> = [
  { type: ComponentType.gutter_apron, label: 'Gutter apron', hint: 'Metal edge at the eaves over the gutter' },
  { type: ComponentType.drip_edge, label: 'Drip edge', hint: 'Metal edge on Rakes' },
  { type: ComponentType.starter, label: 'Starter', hint: 'Starter strip at eaves & rakes' },
  { type: ComponentType.ice_and_water_shield, label: 'Ice & water shield', hint: 'Peel-and-stick membrane at eaves/valleys' },
  { type: ComponentType.underlayment, label: 'Underlayment', hint: 'Felt / synthetic beneath shingles' },
];

const DECKING_OPTIONS: Array<{ label: string; status: ComponentStatusValue }> = [
  { label: 'Plywood 3/8"', status: ComponentStatus.present },
  { label: 'Plywood 1/2"+', status: ComponentStatus.present },
  { label: 'Spaced Decking', status: ComponentStatus.present },
];

const VENTILATION_OPTIONS: Array<{ label: string; status: ComponentStatusValue }> = [
  { label: 'None', status: ComponentStatus.absent },
  { label: 'Box Vents', status: ComponentStatus.present },
  { label: 'Alum Ridge', status: ComponentStatus.present },
  { label: 'SOS Ridge', status: ComponentStatus.present },
];

const PENETRATION_OPTIONS: Array<{ type: PenetrationTypeValue; label: string }> = [
  { type: PenetrationType.plumbing_vent, label: 'Plumbing vent' },
  { type: PenetrationType.pipe_boot, label: 'Pipe boot' },
  { type: PenetrationType.exhaust_vent, label: 'Exhaust vent' },
  { type: PenetrationType.chimney, label: 'Chimney' },
  { type: PenetrationType.skylight, label: 'Skylight' },
  { type: PenetrationType.satellite_mount, label: 'Satellite mount' },
  { type: PenetrationType.other, label: 'Other' },
];

const HIT_TYPES: Array<{ value: TestSquareHitType; label: string; icon: IconName }> = [
  { value: 'hail_strike', label: 'Hail strike', icon: 'cloud' },
  { value: 'mechanical', label: 'Mechanical', icon: 'wind' },
  { value: 'blistering', label: 'Blistering', icon: 'square' },
  { value: 'foot_scuff', label: 'Foot scuff', icon: 'navigation' },
];

const PRODUCT_SHOTS: Array<{ key: string; role: 'wide' | 'mid' | 'close'; title: string }> = [
  { key: 'brand', role: 'close', title: 'Brand / profile close-up' },
  { key: 'exposure', role: 'close', title: 'Exposure with tape measure' },
  { key: 'granule', role: 'close', title: 'Granule / mat detail' },
  { key: 'accessories', role: 'wide', title: 'Accessories (hip/ridge, starter)' },
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

  // ── Section collapse state ────────────────────────────────────────────────
  const [eaveEdgeSaved, setEaveEdgeSaved] = React.useState(false);
  const [facetsSaved, setFacetsSaved] = React.useState(false);
  const [ridgeHipSaved, setRidgeHipSaved] = React.useState(false);
  const [testSquaresSaved, setTestSquaresSaved] = React.useState(false);
  const [productSaved, setProductSaved] = React.useState(false);

  // ── Facet state ──────────────────────────────────────────────────────────
  const [facetCount, setFacetCount] = React.useState('');
  const [seeding, setSeeding] = React.useState(false);
  const [addingFacet, setAddingFacet] = React.useState(false);
  const [linearDrafts, setLinearDrafts] = React.useState<Record<string, string>>({});
  const [savingLinear, setSavingLinear] = React.useState<string | null>(null);

  // ── Eave/Edge state ──────────────────────────────────────────────────────
  const [savingComponentType, setSavingComponentType] = React.useState<ComponentTypeValue | null>(null);
  const inFlightTypes = React.useRef<Set<ComponentTypeValue>>(new Set());
  const [deckingDeterminable, setDeckingDeterminable] = React.useState<'yes' | 'no' | null>(null);
  const [layerDeterminable, setLayerDeterminable] = React.useState<'yes' | 'no' | null>(null);
  const [savingLayer, setSavingLayer] = React.useState(false);
  const authHeaders = useStorageAuthHeaders();

  // ── Penetration modal state ───────────────────────────────────────────────
  const [penetrationModal, setPenetrationModal] = React.useState(false);
  const [penType, setPenType] = React.useState<PenetrationTypeValue>(PenetrationType.plumbing_vent);
  const [flashing, setFlashing] = React.useState('');
  const [penNote, setPenNote] = React.useState('');
  const [savingPen, setSavingPen] = React.useState(false);

  // ── Test Square state ────────────────────────────────────────────────────
  const [hitTarget, setHitTarget] = React.useState<{ squareId: string; label: string } | null>(null);
  const [squareBusy, setSquareBusy] = React.useState(false);

  // ── Product state ────────────────────────────────────────────────────────
  // null = unanswered, true = yes (recognised), false = no (lab recommended)
  const [productRecognized, setProductRecognized] = React.useState<boolean | null>(null);
  const [pickerVisible, setPickerVisible] = React.useState(false);
  const [selectedCatalogProduct, setSelectedCatalogProduct] = React.useState<DiscontinuedProduct | null>(null);
  const [confirmedExposure, setConfirmedExposure] = React.useState('');
  const [confirmedLength, setConfirmedLength] = React.useState('');
  const [savingProduct, setSavingProduct] = React.useState(false);

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

  // ── Derived: facets ───────────────────────────────────────────────────────
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

  // ── Derived: eave/edge components ────────────────────────────────────────
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

  // ── Derived: ridge/hip, ventilation, penetrations ────────────────────────
  const ridgeHipPhotos = photos.filter((p) => p.subjectType === 'component' && p.zone === 'ridge_hip');
  const ridgeHipCaptured = ridgeHipPhotos.length > 0;
  const ventilationRecord = checklistRecords.get(ComponentType.ventilation) ?? null;
  const penetrations = inspection.penetrations ?? [];

  // ── Derived: test squares ────────────────────────────────────────────────
  const squareBySlope = new Map(state.testSquares.map((sq) => [sq.slopeId, sq]));
  const remainingSquares = stageDeficiencies(inspection, 'test_squares').length;
  const hailFacets = facets.filter((slope) => {
    if (!slope.damagePresent) return false;
    return carriesHail((slope.damageType as FacetDamageType | null) ?? null);
  });

  // ── Derived: products ─────────────────────────────────────────────────────
  const products = inspection.products ?? [];

  // ── Gates ─────────────────────────────────────────────────────────────────
  const allStatusAnswered = EAVE_STATUS_ITEMS.every((item) => checklistRecords.has(item.type));
  const deckingAnswered = deckingRecord !== null || deckingDeterminable === 'no';
  const layerAnswered = layerRecord !== null || layerDeterminable === 'no';
  const eaveEdgeComplete = eaveZoneCaptured && allStatusAnswered && deckingAnswered && layerAnswered;
  const linearsRecorded = WHOLE_ROOF_LINEAR_TYPES.some((t) => linearsByType.has(t));
  const canSaveSelectedProduct = !savingProduct && selectedCatalogProduct !== null && confirmedExposure.trim() !== '' && confirmedLength.trim() !== '';

  // ── Facet helpers ──────────────────────────────────────────────────────────
  function nextFacetLabel(): string {
    const max = facets.reduce((acc, facet) => {
      const match = /^F(\d+)$/.exec(facet.label);
      return match ? Math.max(acc, Number(match[1])) : acc;
    }, 0);
    return `F${max + 1}`;
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

  // ── Eave/Edge helpers ──────────────────────────────────────────────────────
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
        await createComponent(queryClient, id, { componentType: type, status: option.status, notes: option.label });
      } else if (record.notes === option.label) {
        await deleteComponent(queryClient, id, record.id);
      } else {
        await updateComponent(queryClient, id, record.id, { status: option.status, notes: option.label });
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
      await createComponent(queryClient, id, { componentType: ComponentType.layer_count, layerCount: count });
      if (count === 2) {
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
      params: { inspectionId: id, subjectType: 'component', roles: 'wide', stage: 'components', title: 'Eave/Edge — components', zone: 'eave_edge' },
    });
  }

  function captureShingleGaugePhoto() {
    router.push({
      pathname: '/inspection-photo-capture',
      params: { inspectionId: id, subjectType: 'component', roles: 'close', stage: 'components', title: 'Shingle Gauge', zone: 'shingle_gauge', caption: 'Place shingle gauge on a shingle and capture photo' },
    });
  }

  // ── Ridge/Hip helpers ──────────────────────────────────────────────────────
  function captureRidgeHipPhoto() {
    router.push({
      pathname: '/inspection-photo-capture',
      params: { inspectionId: id, subjectType: 'component', roles: 'wide', stage: 'components', title: 'Ridge / Hip — components', zone: 'ridge_hip' },
    });
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
      router.push({
        pathname: '/inspection-photo-capture',
        params: { inspectionId: id, subjectType: 'penetration', subjectId: penetrationId, roles: 'wide', stage: 'components', title: label },
      });
    } finally {
      setSavingPen(false);
    }
  }

  // ── Test Square helpers ────────────────────────────────────────────────────
  function captureSquareOverview(squareId: string, label: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: { inspectionId: id, subjectType: 'test_square', subjectId: squareId, roles: 'wide', stage: 'test_squares', title: `${label} — chalked overview` },
    });
  }

  function captureHitCloseup(hitId: string, label: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: { inspectionId: id, subjectType: 'test_square_hit', subjectId: hitId, roles: 'close', stage: 'test_squares', title: `${label} — close-up with scale gauge` },
    });
  }

  async function addSquare(slopeId: string, label: string) {
    if (squareBusy) return;
    setSquareBusy(true);
    try {
      const squareId = await createTestSquare(queryClient, id, { slopeId, label: `${label} test square` });
      captureSquareOverview(squareId, label);
    } finally {
      setSquareBusy(false);
    }
  }

  async function recordHit(type: TestSquareHitType, typeLabel: string) {
    if (!hitTarget || squareBusy) return;
    setSquareBusy(true);
    try {
      const hitId = await createTestSquareHit(queryClient, id, hitTarget.squareId, { hitType: type });
      const label = hitTarget.label;
      setHitTarget(null);
      captureHitCloseup(hitId, `${label} · ${typeLabel}`);
    } finally {
      setSquareBusy(false);
    }
  }

  // ── Product helpers ────────────────────────────────────────────────────────
  function captureProductPhoto(productId: string, role: 'wide' | 'mid' | 'close', title: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: { inspectionId: id, subjectType: 'product', subjectId: productId, roles: role, stage: 'product', title },
    });
  }

  async function saveProduct() {
    if (!canSaveSelectedProduct || !selectedCatalogProduct) return;
    setSavingProduct(true);
    try {
      const productId = await createProduct(queryClient, id, {
        brand: selectedCatalogProduct.name,
        identificationMethod: ProductIdMethod.field_identified,
        notes: `Exposure: ${confirmedExposure.trim()}" · Length: ${confirmedLength.trim()}"`,
      });
      // Reset form for potential next product
      setSelectedCatalogProduct(null);
      setConfirmedExposure('');
      setConfirmedLength('');
      setProductRecognized(null);
      captureProductPhoto(productId, PRODUCT_SHOTS[0].role, PRODUCT_SHOTS[0].title);
    } finally {
      setSavingProduct(false);
    }
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
                style={[styles.chip, { backgroundColor: active ? colors.primary : 'transparent', borderColor: active ? colors.primary : colors.border }]}
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
    if (deckingRecord) {
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.success }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Decking</Text>
            <Icon name="check" size={18} color={colors.success} />
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 6 }}>{deckingRecord.notes ?? deckingRecord.status}</Text>
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
                  <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }
    if (deckingDeterminable === null) {
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Decking</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>Can decking type and thickness be determined at this time?</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setDeckingDeterminable('yes')} style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border }]}>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>Yes</Text>
            </Pressable>
            <Pressable onPress={() => setDeckingDeterminable('no')} style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border }]}>
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
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Not determinable at this time.</Text>
        </View>
      );
    }
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHead}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Decking</Text>
          <Pressable onPress={() => setDeckingDeterminable(null)} hitSlop={8}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Not determinable</Text>
          </Pressable>
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 6 }}>Sheathing beneath the covering</Text>
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
                <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  function renderLayerCount() {
    if (layerRecord) {
      const display = layerRecord.layerCount != null && layerRecord.layerCount >= 2 ? '2+' : '1';
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.success }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Shingle layer count — {display}</Text>
            <Icon name="check" size={18} color={colors.success} />
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            {display === '2+' ? 'Photo evidence required — check Evidence Photos.' : 'Evidenced by the Eave/Edge zone photo.'}
          </Text>
        </View>
      );
    }
    if (layerDeterminable === null) {
      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Shingle layer count</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>Can shingle layer count be determined at this time?</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setLayerDeterminable('yes')} style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border }]}>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>Yes</Text>
            </Pressable>
            <Pressable onPress={() => setLayerDeterminable('no')} style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border }]}>
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
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Not determinable at this time.</Text>
        </View>
      );
    }
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHead}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Shingle layer count</Text>
          <Pressable onPress={() => setLayerDeterminable(null)} hitSlop={8}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Not determinable</Text>
          </Pressable>
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>Count layers at an exposed eave or rake edge.</Text>
        <View style={styles.chipRow}>
          <Pressable
            onPress={() => recordLayerCount(1)}
            disabled={savingLayer}
            style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border, opacity: savingLayer ? 0.5 : 1 }]}
          >
            {savingLayer ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>1</Text>}
          </Pressable>
          <Pressable
            onPress={() => recordLayerCount(2)}
            disabled={savingLayer}
            style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border, opacity: savingLayer ? 0.5 : 1 }]}
          >
            {savingLayer ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>2+</Text>}
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

        {/* ── EAVE / EDGE ─────────────────────────────────────────────────── */}
        <Text style={[styles.section, { color: colors.foreground, marginTop: 0 }]}>Eave / Edge</Text>

        {eaveEdgeSaved ? (
          <Pressable onPress={() => setEaveEdgeSaved(false)} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.success }]}>
            <View style={[styles.badge, { backgroundColor: colors.success }]}>
              <Icon name="check" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Eave / Edge — Saved</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {eaveZonePhotos.length} eave photo{eaveZonePhotos.length === 1 ? '' : 's'} · {shingleGaugePhotos.length} gauge photo{shingleGaugePhotos.length === 1 ? '' : 's'} · all items answered
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 2 }}>
              One eave shot evidences every edge component and the layer count.
            </Text>

            <View style={[styles.photoCapture, { borderColor: eaveZoneCaptured ? colors.success : colors.primary, backgroundColor: colors.card }]}>
              <Pressable onPress={captureEaveZonePhoto} style={styles.photoCaptureBtn}>
                <Icon name="camera" size={18} color={eaveZoneCaptured ? colors.success : colors.primary} />
                <Text style={{ color: eaveZoneCaptured ? colors.success : colors.primary, fontWeight: '600', flex: 1 }}>
                  {eaveZoneCaptured ? 'Eave / edge zone' : 'Photograph eave / edge zone'}
                </Text>
                {eaveZoneCaptured ? <Icon name="check" size={16} color={colors.success} /> : <Icon name="chevron-right" size={16} color={colors.primary} />}
              </Pressable>
              {eaveZonePhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbStrip} contentContainerStyle={styles.thumbContent}>
                  {eaveZonePhotos.map((p) => (
                    <Image key={p.id} source={{ uri: storagePhotoUri(p.url), headers: authHeaders ?? undefined }} style={styles.thumb} resizeMode="cover" />
                  ))}
                  <Pressable onPress={captureEaveZonePhoto} style={[styles.thumbAdd, { borderColor: colors.border }]}>
                    <Icon name="plus" size={20} color={colors.mutedForeground} />
                  </Pressable>
                </ScrollView>
              )}
            </View>

            <View style={[styles.photoCapture, { borderColor: shingleGaugeCaptured ? colors.success : colors.primary, backgroundColor: colors.card }]}>
              <Pressable onPress={captureShingleGaugePhoto} style={styles.photoCaptureBtn}>
                <Icon name="camera" size={18} color={shingleGaugeCaptured ? colors.success : colors.primary} />
                <Text style={{ color: shingleGaugeCaptured ? colors.success : colors.primary, fontWeight: '600', flex: 1 }}>
                  {shingleGaugeCaptured ? 'Shingle Gauge' : 'Shingle Gauge — capture photo'}
                </Text>
                {shingleGaugeCaptured ? <Icon name="check" size={16} color={colors.success} /> : <Icon name="chevron-right" size={16} color={colors.primary} />}
              </Pressable>
              {shingleGaugePhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbStrip} contentContainerStyle={styles.thumbContent}>
                  {shingleGaugePhotos.map((p) => (
                    <Image key={p.id} source={{ uri: storagePhotoUri(p.url), headers: authHeaders ?? undefined }} style={styles.thumb} resizeMode="cover" />
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

            {eaveEdgeComplete && (
              <Pressable onPress={() => setEaveEdgeSaved(true)} style={[styles.saveBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Eave / Edge</Text>
              </Pressable>
            )}
          </>
        )}

        {/* ── FACETS ──────────────────────────────────────────────────────── */}
        <Text style={[styles.section, { color: colors.foreground }]}>Facets</Text>

        {!eaveEdgeComplete ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHead}>
              <Icon name="slash" size={18} color={colors.mutedForeground} />
              <Text style={[styles.rowTitle, { color: colors.mutedForeground, flex: 1, marginLeft: 8 }]}>Complete Eave / Edge first</Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 2 }}>
              Photograph the eave/edge zone, answer all component status items, decking, and layer count before moving on to facets.
            </Text>
          </View>
        ) : facetsSaved ? (
          <Pressable onPress={() => setFacetsSaved(false)} style={[styles.row, { backgroundColor: colors.card, borderColor: remaining === 0 ? colors.success : colors.border }]}>
            <View style={[styles.badge, { backgroundColor: remaining === 0 ? colors.success : colors.accent }]}>
              <Icon name={remaining === 0 ? 'check' : 'clipboard'} size={18} color={remaining === 0 ? '#fff' : colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                Facets — {facets.length} plane{facets.length === 1 ? '' : 's'}{remaining === 0 ? ' · Complete' : ` · ${remaining} remaining`}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {WHOLE_ROOF_LINEAR_TYPES.filter((t) => linearsByType.has(t)).length} of {WHOLE_ROOF_LINEAR_TYPES.length} linears recorded
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : facets.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>How many facets does this roof have?</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Every distinct roof plane is a facet. This seeds an F1…F{'{n}'} list you can edit — add or remove facets at any time.
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
              style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: seeding || !facetCount.trim() ? 0.5 : 1 }]}
            >
              {seeding ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Create facet list</Text>}
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
                  onPress={() => router.push({ pathname: '/inspection-facet', params: { id, slopeId: facet.id } })}
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
                        : missing.length > 0 ? `Needs ${missing.join(', ')}` : facet.damagePresent ? 'Damage documentation incomplete' : 'Tap to document'}
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
                {addingFacet ? <ActivityIndicator color={colors.secondary} /> : <Icon name="plus" size={18} color={colors.secondary} />}
              </View>
              <Text style={[styles.rowTitle, { color: colors.foreground, flex: 1 }]}>Add facet</Text>
            </Pressable>

            <Text style={[styles.section, { color: colors.foreground }]}>Whole-roof linears (LF)</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Recorded once for the whole roof — at least one linear is required.</Text>
            {WHOLE_ROOF_LINEAR_TYPES.map((type) => {
              const saved = linearsByType.get(type);
              return (
                <View key={type} style={[styles.linearRow, { backgroundColor: colors.card, borderColor: saved != null ? colors.success : colors.border }]}>
                  <Text style={{ color: colors.foreground, fontWeight: '600', width: 64 }}>{LINEAR_LABELS[type]}</Text>
                  {saved != null ? (
                    <Text style={{ color: colors.success, fontWeight: '700', flex: 1 }}>{saved} lf recorded</Text>
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
              {remaining === 0 ? 'Facet documentation complete.' : `${remaining} item${remaining === 1 ? '' : 's'} still required on this step.`}
            </Text>

            {linearsRecorded && (
              <Pressable onPress={() => setFacetsSaved(true)} style={[styles.saveBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Facets</Text>
              </Pressable>
            )}
          </>
        )}

        {/* ── RIDGE / HIP ──────────────────────────────────────────────────── */}
        <Text style={[styles.section, { color: colors.foreground }]}>Ridge / Hip</Text>

        {ridgeHipSaved ? (
          <Pressable onPress={() => setRidgeHipSaved(false)} style={[styles.row, { backgroundColor: colors.card, borderColor: ridgeHipCaptured && ventilationRecord ? colors.success : colors.border }]}>
            <View style={[styles.badge, { backgroundColor: ridgeHipCaptured ? colors.success : colors.accent }]}>
              <Icon name={ridgeHipCaptured ? 'check' : 'camera'} size={18} color={ridgeHipCaptured ? '#fff' : colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Ridge / Hip — Saved</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {ridgeHipCaptured ? `${ridgeHipPhotos.length} photo${ridgeHipPhotos.length === 1 ? '' : 's'}` : 'No photo'} · {ventilationRecord?.notes ?? 'Ventilation not set'} · {penetrations.length} penetration{penetrations.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <>
            {/* Ridge/Hip zone photo */}
            <View style={[styles.photoCapture, { borderColor: ridgeHipCaptured ? colors.success : colors.primary, backgroundColor: colors.card }]}>
              <Pressable onPress={captureRidgeHipPhoto} style={styles.photoCaptureBtn}>
                <Icon name="camera" size={18} color={ridgeHipCaptured ? colors.success : colors.primary} />
                <Text style={{ color: ridgeHipCaptured ? colors.success : colors.primary, fontWeight: '600', flex: 1 }}>
                  {ridgeHipCaptured ? 'Ridge / Hip zone' : 'Photograph ridge / hip zone'}
                </Text>
                {ridgeHipCaptured ? <Icon name="check" size={16} color={colors.success} /> : <Icon name="chevron-right" size={16} color={colors.primary} />}
              </Pressable>
              {ridgeHipPhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbStrip} contentContainerStyle={styles.thumbContent}>
                  {ridgeHipPhotos.map((p) => (
                    <Image key={p.id} source={{ uri: storagePhotoUri(p.url), headers: authHeaders ?? undefined }} style={styles.thumb} resizeMode="cover" />
                  ))}
                  <Pressable onPress={captureRidgeHipPhoto} style={[styles.thumbAdd, { borderColor: colors.border }]}>
                    <Icon name="plus" size={20} color={colors.mutedForeground} />
                  </Pressable>
                </ScrollView>
              )}
            </View>

            {/* Ventilation */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: ventilationRecord ? colors.success : colors.border }]}>
              <View style={styles.cardHead}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>Ventilation</Text>
                {ventilationRecord ? <Icon name="check" size={18} color={colors.success} /> : null}
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 6 }}>Ridge / box / soffit vents</Text>
              <View style={styles.chipRow}>
                {VENTILATION_OPTIONS.map((opt) => {
                  const active = ventilationRecord?.notes === opt.label;
                  return (
                    <Pressable
                      key={opt.label}
                      onPress={() => tapOption(ComponentType.ventilation, opt)}
                      disabled={savingComponentType === ComponentType.ventilation}
                      style={[styles.chip, { backgroundColor: active ? colors.primary : 'transparent', borderColor: active ? colors.primary : colors.border }]}
                    >
                      <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Penetrations */}
            <Text style={[styles.section, { color: colors.foreground }]}>
              Penetrations{penetrations.length > 0 ? ` (${penetrations.length})` : ''}
            </Text>
            {penetrations.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                Inventory every roof penetration — vents, boots, chimney, skylights — with a photo.
              </Text>
            ) : (
              penetrations.map((pen) => {
                const label = PENETRATION_OPTIONS.find((o) => o.type === pen.penetrationType)?.label ?? pen.penetrationType;
                return (
                  <Pressable
                    key={pen.id}
                    onPress={() => router.push({ pathname: '/inspection-photo-capture', params: { inspectionId: id, subjectType: 'penetration', subjectId: pen.id, roles: 'wide', stage: 'components', title: label } })}
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
            <Pressable onPress={() => setPenetrationModal(true)} style={[styles.addRow, { borderColor: colors.border }]}>
              <Icon name="plus" size={18} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Add penetration</Text>
            </Pressable>

            <Pressable onPress={() => setRidgeHipSaved(true)} style={[styles.saveBtn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Ridge / Hip</Text>
            </Pressable>
          </>
        )}

        {/* ── TEST SQUARES ─────────────────────────────────────────────────── */}
        <Text style={[styles.section, { color: colors.foreground }]}>Test Squares</Text>

        {testSquaresSaved ? (
          <Pressable onPress={() => setTestSquaresSaved(false)} style={[styles.row, { backgroundColor: colors.card, borderColor: hailFacets.length === 0 || remainingSquares === 0 ? colors.success : colors.border }]}>
            <View style={[styles.badge, { backgroundColor: hailFacets.length === 0 || remainingSquares === 0 ? colors.success : colors.accent }]}>
              <Icon name={hailFacets.length === 0 || remainingSquares === 0 ? 'check' : 'clipboard'} size={18} color={hailFacets.length === 0 || remainingSquares === 0 ? '#fff' : colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                Test Squares — {hailFacets.length === 0 ? 'No hail facets' : remainingSquares === 0 ? 'All documented' : `${hailFacets.length - remainingSquares} / ${hailFacets.length} done`}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {hailFacets.length === 0 ? 'Skipped — no hail damage' : 'Chalk overview + classify each hit with scale gauge'}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <>
            {hailFacets.length === 0 ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                <Icon name="clipboard" size={22} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
                  No facets with hail damage documented. Test squares are only required on facets whose damage type is Hail or Hail &amp; Wind (document facets first).
                </Text>
              </View>
            ) : (
              <View style={[styles.card, { backgroundColor: remainingSquares === 0 ? '#ecfdf5' : colors.card, borderColor: remainingSquares === 0 ? colors.success : colors.border, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                <Icon name="clipboard" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    {remainingSquares === 0 ? 'Every hail facet has its test square' : `${remainingSquares} hail facet${remainingSquares === 1 ? '' : 's'} still need a test square`}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    Chalk the square, shoot the overview, then classify each hit with a scale gauge.
                  </Text>
                </View>
              </View>
            )}

            {hailFacets.map((slope) => {
              const square = squareBySlope.get(slope.id);
              return (
                <View key={slope.id} style={{ gap: 8 }}>
                  <Text style={[styles.subsection, { color: colors.foreground }]}>{slope.label}</Text>
                  {square ? (
                    <>
                      <View style={[styles.row, { backgroundColor: colors.card, borderColor: square.photoCaptured ? colors.success : '#f59e0b' }]}>
                        <View style={[styles.badge, { backgroundColor: square.photoCaptured ? colors.success : colors.accent }]}>
                          <Icon name={square.photoCaptured ? 'check' : 'camera'} size={18} color={square.photoCaptured ? '#fff' : colors.secondary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.rowTitle, { color: colors.foreground }]}>{square.hitCount} hit{square.hitCount === 1 ? '' : 's'} recorded</Text>
                          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                            {square.photoCaptured
                              ? square.hitCount === 0 ? 'Zero-hit square is valid — confirm it was intentional.' : 'Overview captured. Add hits or move on.'
                              : 'Chalked overview photo required to satisfy this step.'}
                          </Text>
                        </View>
                      </View>
                      {!square.photoCaptured && (
                        <Pressable onPress={() => captureSquareOverview(square.id, slope.label)} style={[styles.actionRow, { backgroundColor: colors.primary }]}>
                          <Icon name="camera" size={18} color={colors.primaryForeground} />
                          <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Capture chalked overview</Text>
                        </Pressable>
                      )}
                      <Pressable onPress={() => setHitTarget({ squareId: square.id, label: slope.label })} style={[styles.addRow, { borderColor: colors.border }]}>
                        <Icon name="plus" size={18} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontWeight: '600' }}>Record a hit</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => addSquare(slope.id, slope.label)}
                      disabled={squareBusy}
                      style={[styles.actionRow, { backgroundColor: colors.primary, opacity: squareBusy ? 0.6 : 1 }]}
                    >
                      <Icon name="square" size={18} color={colors.primaryForeground} />
                      <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Mark test square</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}

            <Pressable onPress={() => setTestSquaresSaved(true)} style={[styles.saveBtn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Test Squares</Text>
            </Pressable>
          </>
        )}

        {/* ── ROOFING PRODUCT ID ───────────────────────────────────────────── */}
        <Text style={[styles.section, { color: colors.foreground }]}>Roofing Product ID</Text>

        {productSaved ? (
          /* Collapsed summary */
          <Pressable onPress={() => setProductSaved(false)} style={[styles.row, { backgroundColor: colors.card, borderColor: products.length > 0 ? colors.success : colors.border }]}>
            <View style={[styles.badge, { backgroundColor: products.length > 0 ? colors.success : colors.accent }]}>
              <Icon name={products.length > 0 ? 'check' : 'clipboard'} size={18} color={products.length > 0 ? '#fff' : colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                Product ID — {products.length === 0 ? 'Not started' : `${products.length} product${products.length === 1 ? '' : 's'} documented`}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {products.map((p) => p.brand ?? 'Unknown').join(' · ')}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <>
            {/* Previously recorded products */}
            {products.length > 0 && (
              <>
                <Text style={[styles.subsection, { color: colors.foreground }]}>Documented products ({products.length})</Text>
                {products.map((product) => (
                  <View key={product.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.cardHead}>
                      <Text style={[styles.rowTitle, { color: colors.foreground }]}>{product.brand ?? 'Unknown'}</Text>
                      {product.notes ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{product.notes}</Text> : null}
                    </View>
                    <View style={styles.shotRow}>
                      {PRODUCT_SHOTS.map((shot) => (
                        <Pressable key={shot.key} onPress={() => captureProductPhoto(product.id, shot.role, shot.title)} style={[styles.shotChip, { borderColor: colors.border }]}>
                          <Icon name="camera" size={14} color={colors.primary} />
                          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>{shot.title}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Recognition gate — step 1 */}
            {productRecognized === null && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  Do you recognize this roofing product with better than 50/50 confidence?
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    onPress={() => setProductRecognized(true)}
                    style={[styles.chip, { flex: 1, alignItems: 'center', borderColor: colors.primary }]}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15 }}>Yes</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setProductRecognized(false)}
                    style={[styles.chip, { flex: 1, alignItems: 'center', borderColor: colors.border }]}
                  >
                    <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 15 }}>No</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* No path — lab ID recommended */}
            {productRecognized === false && (
              <View style={[styles.card, { backgroundColor: '#fffbeb', borderColor: '#f59e0b', gap: 8 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="alert-circle" size={18} color="#b45309" />
                  <Text style={[styles.rowTitle, { color: '#92400e' }]}>Lab Identification Recommended</Text>
                </View>
                <Text style={{ color: '#92400e', fontSize: 13 }}>
                  Without confident product identification, bag a sample and submit it for ITEL lab matching. A lab ID gives you the strongest documentation for the estimate.
                </Text>
                <Pressable onPress={() => setProductRecognized(null)} hitSlop={8}>
                  <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600', marginTop: 4 }}>← Back</Text>
                </Pressable>
              </View>
            )}

            {/* Yes path — product picker → exposure → length */}
            {productRecognized === true && (
              <>
                {/* Step 1: pick from library */}
                {selectedCatalogProduct === null ? (
                  <>
                    <Pressable
                      onPress={() => setPickerVisible(true)}
                      style={[styles.actionRow, { backgroundColor: colors.primary }]}
                    >
                      <Icon name="search" size={18} color={colors.primaryForeground} />
                      <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Select from product library</Text>
                    </Pressable>
                    <Pressable onPress={() => setProductRecognized(null)} hitSlop={8}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>← Back</Text>
                    </Pressable>
                  </>
                ) : (
                  /* Step 2: confirm exposure & length */
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary, gap: 12 }]}>
                    {/* Selected product header */}
                    <View style={styles.cardHead}>
                      <Text style={[styles.rowTitle, { color: colors.foreground, flex: 1 }]}>{selectedCatalogProduct.name}</Text>
                      <Pressable onPress={() => { setSelectedCatalogProduct(null); setConfirmedExposure(''); setConfirmedLength(''); }} hitSlop={8}>
                        <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>Change</Text>
                      </Pressable>
                    </View>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                      Catalog: Exposure {formatInches(selectedCatalogProduct.exposureInches)} · Width {formatInches(selectedCatalogProduct.widthInches)}
                    </Text>

                    <RoofField
                      label="Confirm average exposure (inches)"
                      value={confirmedExposure}
                      onChange={setConfirmedExposure}
                      placeholder={selectedCatalogProduct.exposureInches != null ? String(selectedCatalogProduct.exposureInches) : 'e.g. 5.625'}
                      colors={colors}
                    />
                    <RoofField
                      label="Confirm product length (inches)"
                      value={confirmedLength}
                      onChange={setConfirmedLength}
                      placeholder={selectedCatalogProduct.widthInches != null ? String(selectedCatalogProduct.widthInches) : 'e.g. 39.375'}
                      colors={colors}
                    />

                    <Pressable
                      onPress={saveProduct}
                      disabled={!canSaveSelectedProduct}
                      style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: canSaveSelectedProduct ? 1 : 0.5 }]}
                    >
                      {savingProduct
                        ? <ActivityIndicator color={colors.primaryForeground} />
                        : <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Record & photograph</Text>}
                    </Pressable>
                  </View>
                )}
              </>
            )}

            {products.length > 0 && productRecognized === null && (
              <Pressable onPress={() => setProductSaved(true)} style={[styles.saveBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Product ID</Text>
              </Pressable>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Add Penetration modal ─────────────────────────────────────────── */}
      <Modal visible={penetrationModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Add penetration</Text>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Ventilation type</Text>
            <View style={styles.typeGrid}>
              {VENTILATION_OPTIONS.map((opt) => {
                const active = ventilationRecord?.notes === opt.label;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => tapOption(ComponentType.ventilation, opt)}
                    disabled={savingComponentType === ComponentType.ventilation}
                    style={[styles.typeChip, { backgroundColor: active ? colors.secondary : 'transparent', borderColor: active ? colors.secondary : colors.border }]}
                  >
                    <Text style={{ color: active ? '#fff' : colors.foreground, fontSize: 13, fontWeight: '600' }}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Penetration type</Text>
            <View style={styles.typeGrid}>
              {PENETRATION_OPTIONS.map((option) => {
                const active = penType === option.type;
                return (
                  <Pressable
                    key={option.type}
                    onPress={() => setPenType(option.type)}
                    style={[styles.typeChip, { backgroundColor: active ? colors.primary : 'transparent', borderColor: active ? colors.primary : colors.border }]}
                  >
                    <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: '600' }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <RoofField label="Flashing condition (optional)" value={flashing} onChange={setFlashing} placeholder="e.g. Sealed, cracked boot" colors={colors} />
            <RoofField label="Notes (optional)" value={penNote} onChange={setPenNote} placeholder="Anything worth noting" colors={colors} />

            <View style={styles.modalActions}>
              <Pressable onPress={() => setPenetrationModal(false)} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={savePenetration} disabled={savingPen} style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: savingPen ? 0.5 : 1 }]}>
                {savingPen ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Add & photograph</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Hit type picker modal ─────────────────────────────────────────── */}
      <Modal visible={hitTarget !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Classify this hit</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 4 }}>
              {hitTarget?.label} — pick what the mark is, then photograph it with a scale gauge.
            </Text>
            {HIT_TYPES.map((t) => (
              <Pressable
                key={t.value}
                onPress={() => recordHit(t.value, t.label)}
                disabled={squareBusy}
                style={[styles.pickRow, { borderColor: colors.border, opacity: squareBusy ? 0.6 : 1 }]}
              >
                <Icon name={t.icon} size={18} color={colors.primary} />
                <Text style={{ color: colors.foreground, fontWeight: '600', flex: 1 }}>{t.label}</Text>
                <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
            <Pressable onPress={() => setHitTarget(null)} style={[styles.secondaryBtn, { borderColor: colors.border, alignSelf: 'flex-end' }]}>
              <Text style={{ color: colors.foreground }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Product library picker */}
      <ProductMatchPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(product) => {
          setSelectedCatalogProduct(product);
          setConfirmedExposure(product.exposureInches != null ? String(product.exposureInches) : '');
          setConfirmedLength(product.widthInches != null ? String(product.widthInches) : '');
          setPickerVisible(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function RoofField({
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
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.mutedForeground }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={{ borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  subsection: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  chip: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed' },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginTop: 4 },
  saveBtn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  saveBtnText: { fontSize: 15, fontWeight: '700' },
  linearRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  linearInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  linearSave: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
  photoCapture: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  photoCaptureBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14 },
  thumbStrip: { height: 100, borderTopWidth: StyleSheet.hairlineWidth },
  thumbContent: { paddingHorizontal: 10, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 80, height: 80, borderRadius: 8 },
  thumbAdd: { width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  // Modal shared
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', borderRadius: 16, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  secondaryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  // Product
  shotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shotChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  warnBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
});

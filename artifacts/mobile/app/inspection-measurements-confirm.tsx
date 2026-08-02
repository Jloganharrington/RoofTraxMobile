import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey } from '@workspace/api-client-react';
import { MEASUREMENT_META, bearingToCardinal } from '@workspace/protocol';
import type {
  ParsedSlope,
  ParsedSidingFacet,
  InspectionLinearType,
  InspectionTotalType,
  InspectionAccessoryType,
} from '@workspace/protocol';
import { useColors } from '@/hooks/useColors';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';
import { getPendingMeasurements, setPendingMeasurements } from '@/lib/pendingMeasurements';
import { setOverviewImageUrl } from '@/lib/overviewImageStore';
import { Icon } from '@/components/Icon';

// ── Editable row shapes ───────────────────────────────────────────────────────

type EditableSlope = {
  label: string;
  areaSqft: string;
  pitchRise: string;
  pitchRun: string;
  materialType: string;
  compassBearing: number | null;
  enabled: boolean;
};

type EditableMeasurement = {
  key: string;
  label: string;
  value: string;
  unit: string;
  enabled: boolean;
};

type EditableSidingFacet = {
  label: string;
  areaSqft: string;
  enabled: boolean;
};

const MATERIAL_LABELS: Record<string, string> = {
  asphalt_shingle:      'Asphalt Shingle',
  cedar_shake:          'Cedar Shake',
  standing_seam_metal:  'Standing Seam Metal',
};

function numStr(v: number | null | undefined): string {
  if (v == null) return '';
  return String(v);
}

function confidenceColor(c: string, success: string, warning: string, muted: string): string {
  if (c === 'high')   return success;
  if (c === 'medium') return warning;
  return muted;
}

// These are module-level so they can be used in useState initialisers before
// any conditional return (React Rules of Hooks).
const LINEAR_KEYS:    readonly InspectionLinearType[]    = ['ridge_lf', 'hip_lf', 'valley_lf', 'eave_lf', 'rake_lf'];
const TOTAL_KEYS:     readonly InspectionTotalType[]     = ['total_area_sqft', 'total_squares', 'waste_factor_pct'];
const ACCESSORY_KEYS: readonly InspectionAccessoryType[] = ['drip_edge_lf', 'starter_lf', 'step_flashing_lf', 'counter_flashing_lf'];

function toMeasurementRows(
  obj: Partial<Record<string, number | null>>,
  allowedKeys: readonly string[],
): EditableMeasurement[] {
  return allowedKeys
    .filter(k => k in obj)
    .map(k => ({
      key:     k,
      label:   MEASUREMENT_META[k as keyof typeof MEASUREMENT_META]?.label ?? k,
      value:   numStr(obj[k]),
      unit:    MEASUREMENT_META[k as keyof typeof MEASUREMENT_META]?.unit ?? '',
      enabled: obj[k] != null,
    }));
}

// ── Measurement row ───────────────────────────────────────────────────────────

function MeasurementRow({
  item,
  onToggle,
  onChangeValue,
  colors,
}: {
  item: EditableMeasurement;
  onToggle: () => void;
  onChangeValue: (v: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[rowStyles.row, { opacity: item.enabled ? 1 : 0.45 }]}>
      <Switch
        value={item.enabled}
        onValueChange={onToggle}
        trackColor={{ true: colors.primary }}
        style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
      />
      <Text style={[rowStyles.label, { color: colors.foreground }]}>{item.label}</Text>
      <View style={[rowStyles.inputWrap, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <TextInput
          value={item.value}
          onChangeText={onChangeValue}
          keyboardType="decimal-pad"
          editable={item.enabled}
          style={[rowStyles.input, { color: colors.foreground }]}
          placeholderTextColor={colors.mutedForeground}
          placeholder="—"
        />
      </View>
      <Text style={[rowStyles.unit, { color: colors.mutedForeground }]}>{item.unit}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  label:     { flex: 1, fontSize: 14, fontWeight: '500' },
  inputWrap: { width: 80, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  input:     { fontSize: 14, textAlign: 'right' },
  unit:      { width: 38, fontSize: 12, textAlign: 'right' },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function InspectionMeasurementsConfirm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors  = useColors();
  const queryClient = useQueryClient();

  const pending = getPendingMeasurements();

  // ── ALL hooks must be declared before any conditional return (Rules of Hooks).
  // Previously router.back() was called synchronously during render when pending
  // was null, which caused:
  //   • "Rendered fewer hooks than expected" (useState calls below were skipped)
  //   • "Cannot update a component while rendering a different component"
  //   • "GO_BACK action not handled by any navigator"
  // Fix: hoist every hook above the null check; use useEffect for navigation.

  const [slopes, setSlopes] = useState<EditableSlope[]>(() =>
    (pending?.slopes ?? []).map(s => ({
      label:          s.label,
      areaSqft:       numStr(s.areaSqft),
      pitchRise:      numStr(s.pitchRise),
      pitchRun:       numStr(s.pitchRun),
      materialType:   s.materialType ?? '',
      compassBearing: s.compassBearing ?? null,
      enabled:        true,
    })),
  );

  const [linears,     setLinears]     = useState<EditableMeasurement[]>(
    () => toMeasurementRows(pending?.linears     ?? {}, LINEAR_KEYS),
  );
  const [totals,      setTotals]      = useState<EditableMeasurement[]>(
    () => toMeasurementRows(pending?.totals      ?? {}, TOTAL_KEYS),
  );
  const [accessories, setAccessories] = useState<EditableMeasurement[]>(
    () => toMeasurementRows(pending?.accessories ?? {}, ACCESSORY_KEYS),
  );

  const [sidingFacets, setSidingFacets] = useState<EditableSidingFacet[]>(() =>
    (pending?.sidingFacets ?? []).map(f => ({
      label:    f.label,
      areaSqft: numStr(f.areaSqft),
      enabled:  true,
    })),
  );

  const [applying, setApplying] = useState(false);
  // Index into `slopes` of the slope the inspector will enter first (F1).
  // Nothing is pre-assigned — the inspector must tap a slope before applying.
  const [entryIdx, setEntryIdx] = useState<number | null>(null);
  const [overviewModalOpen, setOverviewModalOpen] = useState(false);
  // Roof diagram: initialised from the analysis response; fetched on demand
  // via render-overview-image if absent (e.g. runs before the magick fix).
  const [overviewUrl, setOverviewUrl]       = useState<string | null>(getPendingMeasurements()?.overviewImageUrl ?? null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // ── ALL hooks must be declared before any conditional return ────────────────

  // Navigate back if there is no pending data to review.
  useEffect(() => {
    if (!pending) router.back();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Count enabled items (must be before null guard) ────────────────────────
  const enabledCount = useMemo(() =>
    slopes.filter(s => s.enabled).length
    + linears.filter(m => m.enabled).length
    + totals.filter(m => m.enabled).length
    + accessories.filter(m => m.enabled).length
    + sidingFacets.filter(f => f.enabled).length,
    [slopes, linears, totals, accessories, sidingFacets],
  );

  const enabledSlopeCount = useMemo(() => slopes.filter(s => s.enabled).length, [slopes]);

  // ── Auto-recalculate totals from selected slopes ───────────────────────────
  const derivedAreaSqft = useMemo(() => {
    const areas = slopes
      .filter(s => s.enabled && s.areaSqft.trim() !== '')
      .map(s => parseFloat(s.areaSqft))
      .filter(n => !isNaN(n) && n > 0);
    return areas.length > 0 ? areas.reduce((a, b) => a + b, 0) : null;
  }, [slopes]);

  useEffect(() => {
    if (derivedAreaSqft === null) return;
    setTotals(prev => prev.map(t => {
      if (t.key === 'total_area_sqft') return { ...t, value: derivedAreaSqft.toFixed(1) };
      if (t.key === 'total_squares')   return { ...t, value: (derivedAreaSqft / 100).toFixed(2) };
      return t;
    }));
  }, [derivedAreaSqft]);

  // Cache the overview URL by inspectionId so it survives pending clearance
  // and remains accessible from Facet Details.
  useEffect(() => {
    const url = getPendingMeasurements()?.overviewImageUrl;
    if (url) setOverviewImageUrl(id, url);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing to render while the navigator processes the back action.
  if (!pending) return null;

  // ── Overview image (lazy fetch) ────────────────────────────────────────────

  async function openOverview() {
    if (overviewUrl) { setOverviewModalOpen(true); return; }
    setOverviewLoading(true);
    try {
      const apiBase = getApiBaseUrl();
      const token   = await getToken('auth_session_token');
      const res = await fetch(`${apiBase}inspections/${id}/render-overview-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNumber: getPendingMeasurements()?.overviewPageNumber ?? 0 }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { url: string };
      setOverviewUrl(data.url);
      setOverviewImageUrl(id, data.url);
      setOverviewModalOpen(true);
    } catch {
      Alert.alert('Could not load diagram', 'The PDF page could not be rendered. Try again.');
    } finally {
      setOverviewLoading(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function updateMeasurementList(
    list: EditableMeasurement[],
    setter: React.Dispatch<React.SetStateAction<EditableMeasurement[]>>,
    idx: number,
    patch: Partial<EditableMeasurement>,
  ) {
    setter(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item));
  }

  function updateSlope(idx: number, patch: Partial<EditableSlope>) {
    setSlopes(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
    // If the inspector disables the slope they had set as entry, clear the selection.
    if (patch.enabled === false && idx === entryIdx) setEntryIdx(null);
  }

  function updateSiding(idx: number, patch: Partial<EditableSidingFacet>) {
    setSidingFacets(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  }

  // ── Apply ──────────────────────────────────────────────────────────────────

  async function handleApply() {
    if (applying || enabledCount === 0) return;
    setApplying(true);
    try {
      const apiBase = getApiBaseUrl();
      const token   = await getToken('auth_session_token');

      // Assign facet IDs: entry slope → F1, then sweep clockwise by compass
      // bearing from F1, so physically adjacent planes follow naturally.
      const enabledSlopes = slopes.filter(s => s.enabled);
      const entrySlope = (entryIdx !== null && slopes[entryIdx]?.enabled) ? slopes[entryIdx] : null;
      let orderedSlopes: EditableSlope[];
      if (entrySlope && entryIdx !== null) {
        const nonEntryIndices = slopes.reduce<number[]>(
          (acc, s, i) => { if (s.enabled && i !== entryIdx) acc.push(i); return acc; },
          [],
        );
        const sortedNonEntry = cwSortedAfterEntry(nonEntryIndices, entryIdx).map(i => slopes[i]);
        orderedSlopes = [entrySlope, ...sortedNonEntry];
      } else {
        orderedSlopes = enabledSlopes;
      }

      const payload = {
        slopes: orderedSlopes.map((s, i) => ({
            label:          `F${i + 1}`,
            areaSqft:       s.areaSqft    ? parseFloat(s.areaSqft)   : null,
            pitchRise:      s.pitchRise   ? parseInt(s.pitchRise, 10) : null,
            pitchRun:       s.pitchRun    ? parseInt(s.pitchRun, 10)  : null,
            materialType:   s.materialType || null,
            compassBearing: s.compassBearing,
          })),
        linears: Object.fromEntries(
          linears.filter(m => m.enabled).map(m => [m.key, m.value ? parseFloat(m.value) : null]),
        ),
        totals: Object.fromEntries(
          totals.filter(m => m.enabled).map(m => [m.key, m.value ? parseFloat(m.value) : null]),
        ),
        accessories: Object.fromEntries(
          accessories.filter(m => m.enabled).map(m => [m.key, m.value ? parseFloat(m.value) : null]),
        ),
        sidingFacets: sidingFacets
          .filter(f => f.enabled)
          .map(f => ({ label: f.label, areaSqft: f.areaSqft ? parseFloat(f.areaSqft) : null })),
      };

      const res = await fetch(`${apiBase}/inspections/${id}/apply-measurements`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        Alert.alert('Apply failed', body.error ?? 'Something went wrong. Please try again.');
        return;
      }

      // Clear pending and refresh the inspection.
      setPendingMeasurements(null);
      await queryClient.invalidateQueries({ queryKey: getGetInspectionQueryKey(id) });
      router.back();
    } catch {
      Alert.alert('Apply failed', 'Could not connect to the server. Please try again.');
    } finally {
      setApplying(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const sectionHeader = (title: string) => (
    <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>{title.toUpperCase()}</Text>
  );

  const card = (children: React.ReactNode) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {children}
    </View>
  );

  const divider = () => (
    <View style={[styles.divider, { backgroundColor: colors.border }]} />
  );

  // ── Slope card ─────────────────────────────────────────────────────────────

  // Sort slope indices in a clockwise bearing sweep starting from the entry
  // slope's compass bearing.  Slopes with no bearing fall back to their
  // current position (area-desc, the AI's original order).
  function cwSortedAfterEntry(nonEntryIndices: number[], entryI: number): number[] {
    const entryBearing = slopes[entryI]?.compassBearing;
    if (entryBearing == null) return nonEntryIndices; // no bearing → keep area order
    return [...nonEntryIndices].sort((a, b) => {
      const ba = slopes[a]?.compassBearing;
      const bb = slopes[b]?.compassBearing;
      if (ba == null && bb == null) return 0;
      if (ba == null) return 1;   // no-bearing slopes go last
      if (bb == null) return -1;
      const da = (ba - entryBearing + 360) % 360;
      const db = (bb - entryBearing + 360) % 360;
      return da - db;
    });
  }

  // Compute what facet label each slope will receive when applied.
  // Returns null when no entry has been selected yet (labels are not
  // pre-assigned — the inspector picks the ordering by choosing F1 first).
  function previewLabel(idx: number): string | null {
    if (entryIdx === null) return null;
    if (!slopes[idx]?.enabled) return null;
    const enabledIndices = slopes.reduce<number[]>((acc, s, i) => { if (s.enabled) acc.push(i); return acc; }, []);
    if (!enabledIndices.includes(entryIdx)) return null;
    const nonEntry = cwSortedAfterEntry(enabledIndices.filter(i => i !== entryIdx), entryIdx);
    const ordered  = [entryIdx, ...nonEntry];
    const pos = ordered.indexOf(idx);
    return pos >= 0 ? `F${pos + 1}` : null;
  }

  function SlopeCard({ slope, idx }: { slope: EditableSlope; idx: number }) {
    const isEntry = entryIdx === idx;
    const label   = previewLabel(idx);
    return (
      <View style={[styles.slopeCard, { backgroundColor: colors.card, borderColor: isEntry ? colors.primary : colors.border, borderWidth: isEntry ? 2 : 1, opacity: slope.enabled ? 1 : 0.45 }]}>
        <View style={styles.slopeHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Tap to designate as entry (F1). Shows preview label once set. */}
            <Pressable
              onPress={() => slope.enabled && setEntryIdx(prev => prev === idx ? null : idx)}
              hitSlop={8}
            >
              <View style={[styles.slopeBadge, { backgroundColor: isEntry ? colors.primary : label ? colors.secondary : colors.muted }]}>
                <Text style={{ color: isEntry || label ? '#fff' : colors.mutedForeground, fontWeight: '700', fontSize: 13 }}>
                  {isEntry ? '★ F1 · Entry' : label ?? 'Set as F1'}
                </Text>
              </View>
            </Pressable>
            {slope.compassBearing != null && (
              <View style={[styles.compassBadge, { backgroundColor: colors.accent }]}>
                <Text style={{ color: colors.secondary, fontWeight: '600', fontSize: 12 }}>
                  ↓ {bearingToCardinal(slope.compassBearing)}
                </Text>
              </View>
            )}
          </View>
          <Switch
            value={slope.enabled}
            onValueChange={() => updateSlope(idx, { enabled: !slope.enabled })}
            trackColor={{ true: colors.primary }}
            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
          />
        </View>

        <View style={styles.slopeFields}>
          {/* Area */}
          <View style={styles.slopeField}>
            <Text style={[styles.slopeFieldLabel, { color: colors.mutedForeground }]}>Area</Text>
            <View style={[styles.slopeInputWrap, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                value={slope.areaSqft}
                onChangeText={v => updateSlope(idx, { areaSqft: v })}
                keyboardType="decimal-pad"
                editable={slope.enabled}
                style={[styles.slopeInput, { color: colors.foreground }]}
                placeholder="—"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <Text style={[styles.slopeUnit, { color: colors.mutedForeground }]}>sqft</Text>
          </View>

          {/* Pitch */}
          <View style={styles.slopeField}>
            <Text style={[styles.slopeFieldLabel, { color: colors.mutedForeground }]}>Pitch</Text>
            <View style={[styles.slopeInputWrap, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                value={slope.pitchRise}
                onChangeText={v => updateSlope(idx, { pitchRise: v })}
                keyboardType="number-pad"
                editable={slope.enabled}
                style={[styles.slopeInput, { color: colors.foreground }]}
                placeholder="—"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <Text style={[styles.slopeUnit, { color: colors.mutedForeground }]}>/12</Text>
          </View>

          {/* Material */}
          <View style={[styles.slopeField, { flex: 2 }]}>
            <Text style={[styles.slopeFieldLabel, { color: colors.mutedForeground }]}>Material</Text>
            <Text
              style={[styles.materialLabel, { color: slope.materialType ? colors.foreground : colors.mutedForeground }]}
              numberOfLines={1}
            >
              {MATERIAL_LABELS[slope.materialType] ?? (slope.materialType || '—')}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const needsEntry = enabledSlopeCount > 0 && entryIdx === null;
  const canApply   = !needsEntry && enabledCount > 0;

  const confColor = confidenceColor(
    pending.confidence,
    colors.success,
    '#f59e0b',
    colors.mutedForeground,
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Confidence banner */}
        <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Icon name="zap" size={16} color={confColor} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.foreground }]}>
              Claude Opus analysis complete
            </Text>
            <Text style={[styles.bannerSub, { color: colors.mutedForeground }]}>
              Confidence: <Text style={{ color: confColor, fontWeight: '700' }}>{pending.confidence}</Text>
              {pending.notes ? `  ·  ${pending.notes}` : ''}
            </Text>
          </View>
        </View>

        {/* Instructions */}
        <Text style={[styles.instructions, { color: colors.mutedForeground }]}>
          {slopes.length > 0
            ? 'Use the roof diagram to identify each plane, then tap "Set as F1" on the slope you will access first. Toggle off any planes not in scope (e.g. EPDM flat sections).'
            : 'Review and edit values below. Toggle off any row you do not want applied.'}
        </Text>

        {/* ── Roof Diagram button — always visible; fetches the image on first tap ── */}
        <Pressable
          onPress={openOverview}
          disabled={overviewLoading}
          style={[styles.diagramBtn, { backgroundColor: colors.card, borderColor: colors.primary, opacity: overviewLoading ? 0.6 : 1 }]}
        >
          {overviewLoading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Icon name="image" size={16} color={colors.primary} />}
          <Text style={[styles.diagramBtnText, { color: colors.primary }]}>
            {overviewLoading ? 'Loading diagram…' : 'View Roof Diagram'}
          </Text>
        </Pressable>

        {/* ── Roof Facets ── */}
        {slopes.length > 0 && (
          <>
            {sectionHeader('Roof Facets')}
            {entryIdx === null ? (
              <Text style={[styles.entryHint, { color: '#f59e0b', fontWeight: '600' }]}>
                ⚠ Tap "Set as F1" on the slope you will access first. This is required before you can apply.
              </Text>
            ) : (
              <Text style={[styles.entryHint, { color: colors.mutedForeground }]}>
                Facet IDs are shown as a preview. Tap a different slope to change F1.
              </Text>
            )}
            {slopes.map((slope, i) => (
              <SlopeCard key={slope.label} slope={slope} idx={i} />
            ))}
          </>
        )}

        {/* ── Whole-roof Linears ── */}
        {linears.length > 0 && (
          <>
            {sectionHeader('Linears')}
            {card(
              linears.map((item, i) => (
                <React.Fragment key={item.key}>
                  {i > 0 && divider()}
                  <MeasurementRow
                    item={item}
                    onToggle={() => updateMeasurementList(linears, setLinears, i, { enabled: !item.enabled })}
                    onChangeValue={v => updateMeasurementList(linears, setLinears, i, { value: v })}
                    colors={colors}
                  />
                </React.Fragment>
              )),
            )}
          </>
        )}

        {/* ── Totals ── */}
        {totals.length > 0 && (
          <>
            {sectionHeader('Totals')}
            {slopes.length > 0 && (
              <Text style={[styles.recalcNote, { color: colors.mutedForeground }]}>
                Area and squares are recalculated from your selected slopes. Deselect any out-of-scope planes (e.g. EPDM, detached structures) above to update these figures.
              </Text>
            )}
            {card(
              totals.map((item, i) => (
                <React.Fragment key={item.key}>
                  {i > 0 && divider()}
                  <MeasurementRow
                    item={item}
                    onToggle={() => updateMeasurementList(totals, setTotals, i, { enabled: !item.enabled })}
                    onChangeValue={v => updateMeasurementList(totals, setTotals, i, { value: v })}
                    colors={colors}
                  />
                </React.Fragment>
              )),
            )}
          </>
        )}

        {/* ── Accessories ── */}
        {accessories.length > 0 && (
          <>
            {sectionHeader('Accessories')}
            {card(
              accessories.map((item, i) => (
                <React.Fragment key={item.key}>
                  {i > 0 && divider()}
                  <MeasurementRow
                    item={item}
                    onToggle={() => updateMeasurementList(accessories, setAccessories, i, { enabled: !item.enabled })}
                    onChangeValue={v => updateMeasurementList(accessories, setAccessories, i, { value: v })}
                    colors={colors}
                  />
                </React.Fragment>
              )),
            )}
          </>
        )}

        {/* ── Siding Facets ── */}
        {sidingFacets.length > 0 && (
          <>
            {sectionHeader('Siding Facets')}
            {card(
              sidingFacets.map((facet, i) => (
                <React.Fragment key={facet.label}>
                  {i > 0 && divider()}
                  <View style={[rowStyles.row, { opacity: facet.enabled ? 1 : 0.45 }]}>
                    <Switch
                      value={facet.enabled}
                      onValueChange={() => updateSiding(i, { enabled: !facet.enabled })}
                      trackColor={{ true: colors.primary }}
                      style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                    />
                    <Text style={[rowStyles.label, { color: colors.foreground }]}>{facet.label}</Text>
                    <View style={[rowStyles.inputWrap, { borderColor: colors.border, backgroundColor: colors.background }]}>
                      <TextInput
                        value={facet.areaSqft}
                        onChangeText={v => updateSiding(i, { areaSqft: v })}
                        keyboardType="decimal-pad"
                        editable={facet.enabled}
                        style={[rowStyles.input, { color: colors.foreground }]}
                        placeholder="—"
                        placeholderTextColor={colors.mutedForeground}
                      />
                    </View>
                    <Text style={[rowStyles.unit, { color: colors.mutedForeground }]}>sqft</Text>
                  </View>
                </React.Fragment>
              )),
            )}
          </>
        )}

        {/* spacer for bottom bar */}
        <View style={{ height: 96 }} />
      </ScrollView>

      {/* ── Roof overview image modal ── */}
      <Modal
        visible={overviewModalOpen && !!overviewUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setOverviewModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Roof Diagram</Text>
              <Pressable onPress={() => setOverviewModalOpen(false)} hitSlop={12}>
                <Icon name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {overviewUrl ? (
              <Image
                source={{ uri: overviewUrl }}
                style={styles.diagramImage}
                resizeMode="contain"
              />
            ) : null}
          </View>
        </View>
      </Modal>

      {/* ── Bottom action bar ── */}
      <View style={[styles.bottomBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <Pressable
          onPress={handleApply}
          disabled={applying || !canApply}
          style={[styles.applyBtn, { backgroundColor: canApply ? colors.primary : colors.muted, opacity: applying ? 0.7 : 1 }]}
        >
          {applying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.applyBtnText, { color: canApply ? colors.primaryForeground : colors.mutedForeground }]}>
              {needsEntry
                ? 'Select your entry point (F1) above'
                : enabledCount === 0
                  ? 'No measurements selected'
                  : `Apply ${enabledSlopeCount} slope${enabledSlopeCount === 1 ? '' : 's'} + measurements`}
            </Text>
          )}
        </Pressable>

        <Pressable onPress={() => router.back()} style={styles.discardBtn}>
          <Text style={[styles.discardText, { color: colors.mutedForeground }]}>Discard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1 },
  content:       { padding: 16, gap: 8 },
  banner:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1 },
  bannerTitle:   { fontWeight: '700', fontSize: 14 },
  bannerSub:     { fontSize: 13, marginTop: 2 },
  instructions:  { fontSize: 13, marginTop: 4, marginBottom: 4 },
  sectionHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: 12, marginBottom: 4 },
  card:          { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6 },
  divider:       { height: 1, marginVertical: 2 },
  slopeCard:     { borderRadius: 14, borderWidth: 1, padding: 12, gap: 10 },
  slopeHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slopeBadge:    { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  compassBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  diagramBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  diagramBtnText:{ fontWeight: '600', fontSize: 14 },
  entryHint:     { fontSize: 12, marginBottom: 4 },
  recalcNote:    { fontSize: 12, marginBottom: 8, lineHeight: 17 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 16 },
  modalCard:     { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  modalTitle:    { fontWeight: '700', fontSize: 16 },
  diagramImage:  { width: '100%', height: 480 },
  slopeFields:   { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  slopeField:    { flex: 1, gap: 4 },
  slopeFieldLabel:{ fontSize: 11, fontWeight: '600' },
  slopeInputWrap:{ borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  slopeInput:    { fontSize: 14, textAlign: 'right' },
  slopeUnit:     { fontSize: 11, textAlign: 'right' },
  materialLabel: { fontSize: 12, fontWeight: '500' },
  bottomBar:     { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, gap: 8, borderTopWidth: 1 },
  applyBtn:      { paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  applyBtnText:  { fontWeight: '700', fontSize: 15 },
  discardBtn:    { alignItems: 'center', paddingVertical: 6 },
  discardText:   { fontSize: 14 },
});

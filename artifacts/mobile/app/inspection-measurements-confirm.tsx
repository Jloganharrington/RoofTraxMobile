import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

  // Navigate back if there is no pending data to review. useEffect defers the
  // navigation until after the render is committed, satisfying React's constraint
  // that side-effects must not happen during the render phase.
  useEffect(() => {
    if (!pending) router.back();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing to render while the navigator processes the back action.
  if (!pending) return null;

  // ── Count enabled items ────────────────────────────────────────────────────

  const enabledCount = useMemo(() =>
    slopes.filter(s => s.enabled).length
    + linears.filter(m => m.enabled).length
    + totals.filter(m => m.enabled).length
    + accessories.filter(m => m.enabled).length
    + sidingFacets.filter(f => f.enabled).length,
    [slopes, linears, totals, accessories, sidingFacets],
  );

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

      // Build payload from enabled items only.
      const payload = {
        slopes: slopes
          .filter(s => s.enabled)
          .map(s => ({
            label:          s.label,
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

  function SlopeCard({ slope, idx }: { slope: EditableSlope; idx: number }) {
    return (
      <View style={[styles.slopeCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: slope.enabled ? 1 : 0.45 }]}>
        <View style={styles.slopeHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={[styles.slopeBadge, { backgroundColor: colors.secondary }]}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{slope.label}</Text>
            </View>
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
          Review and edit values below. Toggle off any row you do not want applied.
        </Text>

        {/* ── Roof Facets ── */}
        {slopes.length > 0 && (
          <>
            {sectionHeader('Roof Facets')}
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

      {/* ── Bottom action bar ── */}
      <View style={[styles.bottomBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <Pressable
          onPress={handleApply}
          disabled={applying || enabledCount === 0}
          style={[
            styles.applyBtn,
            {
              backgroundColor: enabledCount > 0 ? colors.primary : colors.muted,
              opacity: applying ? 0.7 : 1,
            },
          ]}
        >
          {applying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.applyBtnText, { color: enabledCount > 0 ? colors.primaryForeground : colors.mutedForeground }]}>
              {enabledCount === 0 ? 'No measurements selected' : `Apply ${enabledCount} measurement${enabledCount === 1 ? '' : 's'}`}
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

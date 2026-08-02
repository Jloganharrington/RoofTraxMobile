import React from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { FACET_DAMAGE_TYPES, type FacetDamageType, bearingToCardinal } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { ZoomableImage } from '@/components/ZoomableImage';
import { useColors } from '@/hooks/useColors';
import { createDamageInstance, deleteSlope, updateSlope, patchPhotoCaption } from '@/lib/inspectionSync';
import { buildProtocolState } from '@/lib/inspectionProtocolState';
import { DamageCaptionChips, DamageCaptionBadge } from '@/components/DamageCaptionChips';
import { getMeasurementPages, getMeasurementPageUrl, getCurrentPage, setCurrentPage, setMeasurementPages, addMeasurementPage } from '@/lib/overviewImageStore';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';

// Facet detail (Step 3 · Roof Facets, protocol v2). One roof plane: area,
// material, pitch (rise:run — a pitch steeper than 8/12 triggers the steep
// adder note), then damage documentation. When damage is present the
// inspector picks the damage type and records each damage instance with a
// photo captioned `F{n}-Damage {k}`. Facets are removable — the list is
// never fixed.

// Fixed roofing material options (dropdown — no free text).
const MATERIAL_OPTIONS = [
  'Asphalt - 3-Tab',
  'Asphalt - Laminate',
  'Cedar Shake',
  'Standing Seam Metal',
  'Bitumen',
] as const;

// The two independently toggleable tie-in flags (multi-select).
const TIE_IN_OPTIONS = ['valley', 'hip_ridge'] as const;
const TIE_IN_LABELS: Record<(typeof TIE_IN_OPTIONS)[number], string> = {
  valley: 'Valley',
  hip_ridge: 'Hip/Ridge',
};

// Chalk-marking instructions shown once, when the rep first selects a
// tie-in protocol on this facet.
const TIE_IN_INSTRUCTIONS: Record<(typeof TIE_IN_OPTIONS)[number], string[]> = {
  valley: [
    "Mark a 3' solid line down the center of the valley.",
    'Using your tape measurer, chalk dotted lines 18" parallel to the center line on both sides of the valley.',
  ],
  hip_ridge: [
    "Mark a solid line, 3' long at the center of the ridge/hip.",
    'Measure 6" from this line and mark a dotted line on each side of the ridge/hip.',
  ],
};

const DAMAGE_TYPE_LABELS: Record<FacetDamageType, string> = {
  hail: 'Hail',
  wind: 'Wind',
  hail_and_wind: 'Hail & Wind',
  none: 'None',
};

export default function InspectionFacetScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id, slopeId } = useLocalSearchParams<{ id: string; slopeId: string }>();

  const inspectionQuery = useGetInspection(id, {
    // A fresh-on-mount refetch can race the outbox drain right after "Add
    // facet": the optimistic slope is in the cache, but a server response
    // from before the sync completes would overwrite it and this screen
    // would flash "Facet not found". A short staleTime keeps the optimistic
    // cache authoritative across the navigation.
    query: { queryKey: getGetInspectionQueryKey(id), staleTime: 15_000 },
  });
  const inspection = inspectionQuery.data?.inspection;
  const facet = inspection?.slopes?.find((slope) => slope.id === slopeId);

  const [area, setArea] = React.useState<string | null>(null);
  const [material, setMaterial] = React.useState<string | null>(null);
  const [pitch, setPitch] = React.useState<string | null>(null);
  const [savingDetails, setSavingDetails] = React.useState(false);
  const [materialPickerOpen, setMaterialPickerOpen] = React.useState(false);
  // Built-in area calculator: standard rectangle (L × H) or triangle (L × H / 2).
  const [calcOpen, setCalcOpen] = React.useState(false);
  const [calcShape, setCalcShape] = React.useState<'standard' | 'triangle'>('standard');
  const [calcL, setCalcL] = React.useState('');
  const [calcH, setCalcH] = React.useState('');
  const [removing, setRemoving] = React.useState(false);
  // photoId of the photo currently having its caption saved, or null.
  const [savingCaption, setSavingCaption] = React.useState<string | null>(null);
  const [overviewModalOpen, setOverviewModalOpen] = React.useState(false);
  const [overviewLoading, setOverviewLoading]     = React.useState(false);
  const [overviewUrl, setOverviewUrl]             = React.useState<string | null>(null);
  const [overviewPage, setOverviewPage]           = React.useState(0);
  // Which tie-in option was just selected for the first time this session —
  // drives the one-time instructions + photo-capture prompt.
  const [tieInPrompt, setTieInPrompt] = React.useState<{ valley: boolean; hip_ridge: boolean }>({
    valley: false,
    hip_ridge: false,
  });


  // Roof diagram: seed from the page store (populated during AI analysis).
  // If the store is cold (app restart / URL expiry), fetch fresh signed URLs
  // from the server.  Must run before any conditional return so the hook
  // order stays invariant across renders.
  React.useEffect(() => {
    const pages = getMeasurementPages(id);
    if (pages.length > 0) {
      const pg  = getCurrentPage(id);
      const url = getMeasurementPageUrl(id, pg) ?? pages[0]!.url;
      setOverviewUrl(url);
      setOverviewPage(getMeasurementPageUrl(id, pg) !== null ? pg : pages[0]!.page);
      return;
    }
    // Store cold — fetch pages from the server.
    void (async () => {
      try {
        const apiBase = getApiBaseUrl();
        const token   = await getToken('auth_session_token');
        const res     = await fetch(`${apiBase}/inspections/${id}/measurement-pages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { pages: Array<{ page: number; url: string }> };
        if (data.pages?.length) {
          setMeasurementPages(id, data.pages, data.pages[0]!.page);
          setOverviewUrl(data.pages[0]!.url);
          setOverviewPage(data.pages[0]!.page);
        }
      } catch { /* non-fatal — openOverview falls back to render-overview-image */ }
    })();
  }, [id]);

  // Keep showing the spinner while a refetch is in flight and the facet
  // hasn't appeared yet (it may land with the next response) instead of
  // flashing "Facet not found".
  if ((inspectionQuery.isLoading || inspectionQuery.isFetching) && !facet) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection || !facet) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Facet not found.</Text>
      </View>
    );
  }

  // Roof-wide defaults: when this facet has no material/pitch of its own yet,
  // prefill from the first facet that does (usually F1). Purely a draft-level
  // default — it only persists when this facet is saved, and editing it never
  // touches the donor facet.
  const slopes = inspection.slopes ?? [];
  const defaultMaterial =
    slopes.find((s) => s.id !== slopeId && s.materialType)?.materialType ?? '';
  const defaultPitchRise = slopes.find((s) => s.id !== slopeId && s.pitchRise != null)?.pitchRise;

  // Draft values fall back to the stored row so reopening shows saved facts.
  const areaValue = area ?? (facet.areaSqft != null ? String(facet.areaSqft) : '');
  const materialValue = material ?? facet.materialType ?? defaultMaterial;
  // Pitch is always {rise}/12; stored run stays 12, only rise is edited.
  const pitchValue =
    pitch ??
    (facet.pitchRise != null
      ? String(facet.pitchRise)
      : defaultPitchRise != null
        ? String(defaultPitchRise)
        : '');
  const pitchNum = Number(pitchValue);
  const steep = pitchValue.trim() !== '' && !Number.isNaN(pitchNum) && pitchNum > 8;

  // Page bounds for the roof diagram navigator (store lookup — cheap).
  const _facetPages   = getMeasurementPages(id);
  const _facetMinPage = _facetPages[0]?.page ?? 0;
  const _facetMaxPage = _facetPages.length > 0 ? _facetPages[_facetPages.length - 1]!.page : 9;

  async function fetchOverviewPage(page: number) {
    if (!inspection?.measurementsReportUrl) return;
    setOverviewLoading(true);
    try {
      const apiBase = getApiBaseUrl();
      const token   = await getToken('auth_session_token');
      const res = await fetch(`${apiBase}/inspections/${id}/render-overview-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNumber: page }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { url: string };
      setOverviewUrl(data.url);
      setOverviewPage(page);
      addMeasurementPage(id, page, data.url);
      setOverviewModalOpen(true);
    } catch {
      Alert.alert('Could not load diagram', 'The PDF page could not be rendered. Try again.');
    } finally {
      setOverviewLoading(false);
    }
  }

  async function openOverview() {
    const pages = getMeasurementPages(id);
    if (pages.length > 0) {
      const pg  = getCurrentPage(id);
      const url = getMeasurementPageUrl(id, pg) ?? pages[0]!.url;
      setOverviewUrl(url);
      setOverviewPage(getMeasurementPageUrl(id, pg) !== null ? pg : pages[0]!.page);
      setOverviewModalOpen(true);
      return;
    }
    if (overviewUrl) { setOverviewModalOpen(true); return; }
    await fetchOverviewPage(0);
  }

  const state = buildProtocolState(inspection);
  const damageRecords = state.damageInstances.filter((d) => d.slopeId === slopeId);
  const damagePresent = Boolean(facet.damagePresent);
  const damageType = (facet.damageType as FacetDamageType | null) ?? null;

  const detailsDirty =
    areaValue !== (facet.areaSqft != null ? String(facet.areaSqft) : '') ||
    materialValue !== (facet.materialType ?? '') ||
    pitchValue !== (facet.pitchRise != null ? String(facet.pitchRise) : '');
  const detailsValid =
    (areaValue.trim() === '' || !Number.isNaN(Number(areaValue))) &&
    (pitchValue.trim() === '' || !Number.isNaN(pitchNum));

  async function saveDetails() {
    if (!detailsValid || savingDetails) return;
    setSavingDetails(true);
    try {
      await updateSlope(queryClient, id, slopeId, {
        areaSqft: areaValue.trim() ? Number(areaValue) : null,
        materialType: materialValue.trim() || null,
        pitchRise: pitchValue.trim() ? pitchNum : null,
        pitchRun: pitchValue.trim() ? 12 : null,
      });
    } finally {
      setSavingDetails(false);
    }
  }

  // Each button toggles its own boolean flag independently. Turning an
  // option ON surfaces its marking instructions + photo capture (first
  // selection only); turning it OFF dismisses them.
  async function toggleTieIn(option: (typeof TIE_IN_OPTIONS)[number]) {
    if (!facet) return;
    const turningOn = option === 'valley' ? !facet.tieInValley : !facet.tieInHipRidge;
    setTieInPrompt((prev) => ({ ...prev, [option]: turningOn }));
    await updateSlope(
      queryClient,
      id,
      slopeId,
      option === 'valley'
        ? { tieInValley: !facet.tieInValley }
        : { tieInHipRidge: !facet.tieInHipRidge },
    );
  }

  function captureTieInPhoto(option: (typeof TIE_IN_OPTIONS)[number]) {
    if (!facet) return;
    setTieInPrompt((prev) => ({ ...prev, [option]: false }));
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'slope',
        subjectId: slopeId,
        roles: 'wide',
        stage: 'facets',
        title: `${facet.label} Tie-In: ${TIE_IN_LABELS[option]}`,
      },
    });
  }

  async function setDamage(type: FacetDamageType) {
    await updateSlope(queryClient, id, slopeId, {
      damageType: type,
      damagePresent: type !== 'none',
    });
  }

  function addDamageRecord() {
    // The damage record is created inside the evidence photo screen once the
    // rep picks a causation (server requires a causation note on functional
    // damage) — we just hand over the facet context here.
    if (!damageType || damageType === 'none' || !facet) return;
    const k = damageRecords.length + 1;
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'damage_instance',
        roles: 'wide',
        stage: 'facets',
        title: `${facet.label} Damage ${k}`,
        damageSlopeId: slopeId,
        damageType,
      },
    });
  }

  // Saves any unsaved detail edits, then returns to the facet list so the
  // rep can proceed to the next facet. Photos and toggles are already
  // persisted as they happen — this is the explicit "done with this facet"
  // exit, so nothing is lost by leaving.
  async function handleCaptionChange(photoId: string, caption: string | null) {
    setSavingCaption(photoId);
    try {
      await patchPhotoCaption(queryClient, id, photoId, caption);
    } catch {
      // Optimistic update stays in cache; next refetch reconciles with server.
    } finally {
      setSavingCaption(null);
    }
  }

  async function saveFacetAndReturn() {
    if (savingDetails) return;
    if (detailsDirty && detailsValid) {
      await saveDetails();
    }
    router.back();
  }

  // Next-facet navigation: save pending edits, then replace the current screen
  // with the next facet so the back button always returns to the list rather
  // than cycling through individual facets.
  const currentIndex = slopes.findIndex((s) => s.id === slopeId);
  const nextFacet = currentIndex >= 0 && currentIndex < slopes.length - 1
    ? slopes[currentIndex + 1]
    : null;

  async function saveAndGoNext() {
    if (savingDetails || !nextFacet) return;
    if (detailsDirty && detailsValid) {
      await saveDetails();
    }
    router.replace({
      pathname: '/inspection-facet',
      params: { id, slopeId: nextFacet.id },
    });
  }

  function openAreaCalc() {
    setCalcL('');
    setCalcH('');
    setCalcShape('standard');
    setCalcOpen(true);
  }

  function confirmRemove() {
    Alert.alert('Remove facet', `Remove ${facet?.label}? Its damage records stay on file.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemoving(true);
          try {
            await deleteSlope(queryClient, id, slopeId);
            router.back();
          } finally {
            setRemoving(false);
          }
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headingRow}>
          <Text style={[styles.heading, { color: colors.foreground }]}>{facet.label}</Text>
          {facet.compassBearing != null && (
            <View style={[styles.compassBadge, { backgroundColor: colors.accent }]}>
              <Icon name="navigation" size={13} color={colors.secondary} />
              <Text style={{ color: colors.secondary, fontWeight: '600', fontSize: 13 }}>
                {bearingToCardinal(facet.compassBearing)}
              </Text>
            </View>
          )}
          {/* Diagram button — shown whenever the inspection has a PDF report */}
          {inspection.measurementsReportUrl && (
            <>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={openOverview}
                disabled={overviewLoading}
                hitSlop={8}
                style={[styles.diagramBtn, { backgroundColor: colors.card, borderColor: colors.primary, opacity: overviewLoading ? 0.6 : 1 }]}
              >
                {overviewLoading
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Icon name="image" size={15} color={colors.primary} />}
                <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>
                  {overviewLoading ? 'Loading…' : 'Roof Diagram'}
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Details */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.pitchRow}>
            <View style={{ flex: 1.2 }}>
              <View style={styles.field}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>Area (sq ft)</Text>
                  <Pressable onPress={openAreaCalc} hitSlop={8}>
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '700' }}>Calc</Text>
                  </Pressable>
                </View>
                <View style={[styles.inputWrap, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <TextInput
                    value={areaValue}
                    onChangeText={setArea}
                    placeholder="320"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    style={[styles.input, { color: colors.foreground }]}
                  />
                </View>
              </View>
            </View>
            <View style={{ flex: 1.4 }}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Material</Text>
                <Pressable
                  onPress={() => setMaterialPickerOpen(true)}
                  style={[
                    styles.inputWrap,
                    styles.dropdown,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, fontSize: 15, color: materialValue ? colors.foreground : colors.mutedForeground }}
                  >
                    {materialValue || 'Select'}
                  </Text>
                  <Icon name="chevron-down" size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Pitch (/12)" value={pitchValue} onChange={setPitch} placeholder="6" keyboardType="numeric" suffix="/12" colors={colors} />
            </View>
          </View>
          {steep ? (
            <View style={[styles.steepNote, { backgroundColor: colors.accent }]}>
              <Icon name="alert-circle" size={16} color={colors.secondary} />
              <Text style={{ color: colors.secondary, fontSize: 13, flex: 1 }}>
                Steeper than 8/12 — the steep adder applies to this facet.
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={saveDetails}
            disabled={!detailsDirty || !detailsValid || savingDetails}
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: !detailsDirty || !detailsValid || savingDetails ? 0.5 : 1 }]}
          >
            {savingDetails ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save details</Text>
            )}
          </Pressable>
        </View>

        {/* Tie-in protocol */}
        <Text style={[styles.section, { color: colors.foreground }]}>Tie-In Protocol</Text>
        <View style={styles.chipRow}>
          {TIE_IN_OPTIONS.map((protocol) => {
            const selected = protocol === 'valley' ? facet.tieInValley : facet.tieInHipRidge;
            return (
              <Pressable
                key={protocol}
                onPress={() => toggleTieIn(protocol)}
                style={[
                  styles.tieInBtn,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontWeight: '700' }}>
                  {TIE_IN_LABELS[protocol]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {TIE_IN_OPTIONS.map((option) => {
          const selected = option === 'valley' ? facet.tieInValley : facet.tieInHipRidge;
          if (!selected || !tieInPrompt[option]) return null;
          return (
            <View
              key={option}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                {TIE_IN_LABELS[option]} marking protocol
              </Text>
              {TIE_IN_INSTRUCTIONS[option].map((line, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ color: colors.mutedForeground }}>•</Text>
                  <Text style={{ color: colors.foreground, flex: 1, fontSize: 14 }}>{line}</Text>
                </View>
              ))}
              <Pressable
                onPress={() => captureTieInPhoto(option)}
                style={[styles.saveBtn, { backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 8 }]}
              >
                <Icon name="camera" size={18} color={colors.primaryForeground} />
                <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Capture Photo</Text>
              </Pressable>
            </View>
          );
        })}

        {/* Damage */}
        <Text style={[styles.section, { color: colors.foreground }]}>Damage on this facet</Text>
        <View style={styles.chipRow}>
          {FACET_DAMAGE_TYPES.map((type) => {
            const selected = damageType === type;
            return (
              <Pressable
                key={type}
                onPress={() => setDamage(type)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontWeight: '600' }}>
                  {DAMAGE_TYPE_LABELS[type]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {damagePresent ? (
          <>
            {damageRecords.map((record, index) => {
              const photo = (inspection.photos ?? []).find(
                (p) => p.subjectType === 'damage_instance' && p.subjectId === record.id,
              );
              const caption = photo?.overlayJson
                ? ((photo.overlayJson as Record<string, unknown>).caption as string | null) ?? null
                : null;
              return (
                <View key={record.id} style={[{ borderRadius: 14, borderWidth: 1, overflow: 'hidden' }, { borderColor: record.photoCaptured ? colors.success : colors.border }]}>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/inspection-photo-capture',
                        params: {
                          inspectionId: id,
                          subjectType: 'damage_instance',
                          subjectId: record.id,
                          roles: 'wide',
                          stage: 'facets',
                          title: `${facet.label} Damage ${index + 1}`,
                        },
                      })
                    }
                    style={[styles.row, { backgroundColor: colors.card, borderRadius: 0, borderWidth: 0 }]}
                  >
                    <View style={[styles.badge, { backgroundColor: record.photoCaptured ? colors.success : colors.accent }]}>
                      <Icon name={record.photoCaptured ? 'check' : 'camera'} size={18} color={record.photoCaptured ? '#fff' : colors.secondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                        {facet.label}-Damage {index + 1}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                          {record.photoCaptured ? 'Photo captured' : 'Photo required — tap to capture'}
                        </Text>
                        <DamageCaptionBadge caption={caption} />
                      </View>
                    </View>
                    <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
                  </Pressable>
                  {photo && record.photoCaptured ? (
                    <View style={{ backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <DamageCaptionChips
                        value={caption}
                        saving={savingCaption === photo.id}
                        onChange={(c) => handleCaptionChange(photo.id, c)}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
            <Pressable
              onPress={addDamageRecord}
              disabled={false}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, borderStyle: 'dashed' }]}
            >
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                <Icon name="plus" size={18} color={colors.secondary} />
              </View>
              <Text style={[styles.rowTitle, { color: colors.foreground, flex: 1 }]}>
                Add damage &amp; photograph
              </Text>
            </Pressable>
            {damageRecords.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                At least one photographed damage instance is required on a damaged facet.
              </Text>
            ) : null}
          </>
        ) : null}

        {/* Save / Next Facet actions */}
        <View style={[styles.actionRow, { marginTop: 16 }]}>
          <Pressable
            onPress={saveFacetAndReturn}
            disabled={savingDetails}
            style={[
              styles.saveBtn,
              nextFacet ? styles.actionSecondary : null,
              {
                flex: 1,
                backgroundColor: nextFacet ? 'transparent' : colors.primary,
                borderColor: nextFacet ? colors.border : undefined,
                borderWidth: nextFacet ? 1 : 0,
                opacity: savingDetails ? 0.5 : 1,
              },
            ]}
          >
            {savingDetails && !nextFacet ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={{ color: nextFacet ? colors.foreground : colors.primaryForeground, fontWeight: '700' }}>
                Save Facet
              </Text>
            )}
          </Pressable>

          {nextFacet && (
            <Pressable
              onPress={saveAndGoNext}
              disabled={savingDetails}
              style={[styles.saveBtn, { flex: 2, backgroundColor: colors.primary, opacity: savingDetails ? 0.5 : 1, flexDirection: 'row', gap: 8 }]}
            >
              {savingDetails ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
                    Next Facet
                    {nextFacet.label ? ` · ${nextFacet.label}` : ''}
                  </Text>
                  <Icon name="chevron-right" size={18} color={colors.primaryForeground} />
                </>
              )}
            </Pressable>
          )}
        </View>

        {/* Remove facet */}
        <Pressable
          onPress={confirmRemove}
          disabled={removing}
          style={[styles.removeBtn, { borderColor: colors.destructive, opacity: removing ? 0.5 : 1 }]}
        >
          {removing ? (
            <ActivityIndicator color={colors.destructive} />
          ) : (
            <Text style={{ color: colors.destructive, fontWeight: '700' }}>Remove this facet</Text>
          )}
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Area calculator */}
      <Modal
        visible={calcOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCalcOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCalcOpen(false)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border, gap: 10 }]}
            onPress={() => {}}
          >
            <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 16 }}>Area calculator</Text>
            <View style={styles.chipRow}>
              {(
                [
                  { key: 'standard', label: 'Standard (L × H)' },
                  { key: 'triangle', label: 'Triangle (L × H ÷ 2)' },
                ] as const
              ).map(({ key, label }) => {
                const selected = calcShape === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setCalcShape(key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? colors.primary : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontWeight: '600', fontSize: 13 }}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.pitchRow}>
              <View style={{ flex: 1 }}>
                <Field label="Length (ft)" value={calcL} onChange={setCalcL} placeholder="20" keyboardType="numeric" colors={colors} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Height (ft)" value={calcH} onChange={setCalcH} placeholder="16" keyboardType="numeric" colors={colors} />
              </View>
            </View>
            {(() => {
              const l = Number(calcL);
              const h = Number(calcH);
              const valid = calcL.trim() !== '' && calcH.trim() !== '' && !Number.isNaN(l) && !Number.isNaN(h) && l > 0 && h > 0;
              const result = valid ? (calcShape === 'triangle' ? (l * h) / 2 : l * h) : null;
              const rounded = result != null ? Math.round(result * 100) / 100 : null;
              return (
                <>
                  <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
                    {rounded != null ? `= ${rounded} sq ft` : 'Enter length and height.'}
                  </Text>
                  <Pressable
                    disabled={rounded == null}
                    onPress={() => {
                      setArea(String(rounded));
                      setCalcOpen(false);
                    }}
                    style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: rounded == null ? 0.5 : 1 }]}
                  >
                    <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Use as area</Text>
                  </Pressable>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Roof diagram modal */}
      <Modal
        visible={overviewModalOpen && !!overviewUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setOverviewModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border, padding: 16, gap: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 16 }}>Roof Diagram</Text>
              <Pressable onPress={() => setOverviewModalOpen(false)} hitSlop={12}>
                <Icon name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {overviewUrl ? (
              <ZoomableImage uri={overviewUrl} style={{ width: '100%', height: 480 }} />
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Pressable
                onPress={() => {
                  const newPage = overviewPage - 1;
                  const url = getMeasurementPageUrl(id, newPage);
                  if (url !== null) { setOverviewUrl(url); setOverviewPage(newPage); setCurrentPage(id, newPage); }
                  else { void fetchOverviewPage(newPage); }
                }}
                disabled={overviewLoading || overviewPage <= _facetMinPage}
                hitSlop={8}
                style={{ opacity: overviewLoading || overviewPage <= _facetMinPage ? 0.3 : 1 }}
              >
                <Icon name="chevron-left" size={24} color={colors.foreground} />
              </Pressable>
              {overviewLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  Page {overviewPage + 1} — wrong page? Use arrows
                </Text>
              )}
              <Pressable
                onPress={() => {
                  const newPage = overviewPage + 1;
                  const url = getMeasurementPageUrl(id, newPage);
                  if (url !== null) { setOverviewUrl(url); setOverviewPage(newPage); setCurrentPage(id, newPage); }
                  else { void fetchOverviewPage(newPage); }
                }}
                disabled={overviewLoading || overviewPage >= _facetMaxPage}
                hitSlop={8}
                style={{ opacity: overviewLoading || overviewPage >= _facetMaxPage ? 0.3 : 1 }}
              >
                <Icon name="chevron-right" size={24} color={colors.foreground} />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Material picker */}
      <Modal
        visible={materialPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMaterialPickerOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setMaterialPickerOpen(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.mutedForeground, marginBottom: 4 }]}>Material</Text>
            {MATERIAL_OPTIONS.map((option) => {
              const selected = materialValue === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => {
                    setMaterial(option);
                    setMaterialPickerOpen(false);
                  }}
                  style={[styles.modalOption, { backgroundColor: selected ? colors.accent : 'transparent' }]}
                >
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: selected ? '700' : '400', flex: 1 }}>
                    {option}
                  </Text>
                  {selected ? <Icon name="check" size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  suffix,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  suffix?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View
        style={[
          styles.inputWrap,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          keyboardType={keyboardType ?? 'default'}
          style={[styles.input, { color: colors.foreground }]}
        />
        {suffix ? (
          <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  headingRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  heading:      { fontSize: 20, fontWeight: '800' },
  compassBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  pitchRow: { flexDirection: 'row', gap: 12 },
  steepNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15 },
  tieInBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  saveBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionSecondary: { borderRadius: 12 },
  dropdown: { paddingVertical: 12, gap: 6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 2 },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  removeBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, marginTop: 12 },
  diagramBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
});

import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Alert } from 'react-native';
import * as Crypto from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import {
  appendOptimisticPhotos,
  createSidingFacet,
  deleteSidingFacet,
  patchInspection,
} from '@/lib/inspectionSync';
import {
  pickEvidencePhotoFromLibrary,
  captureEvidencePhoto,
  CameraPermissionDeniedError,
  MediaLibraryPermissionDeniedError,
  persistCapturedPhotoForOutbox,
} from '@/lib/inspectionPhoto';
import { drainOutbox } from '@/lib/outbox/drain';
import { enqueueOutboxItem } from '@/lib/outbox/queue';
import type { InspectionPhotoOutboxPayload } from '@/lib/outbox/types';
import { buildProtocolState, stageDeficiencies } from '@/lib/inspectionProtocolState';

// Siding Inspection (protocol v2.1, conditional on sidingDamageFound).
// S1 always exists — it is auto-seeded the first time this screen opens with
// no facets — and the rep adds/removes more with the (−) N (+) stepper as
// they walk the building. Each row opens the siding facet detail screen
// (damaged?, damage type, photos, components). The optional measurement
// report upload lives here — skipping it only raises a soft flag.

export default function InspectionSidingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 44;
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

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

  const [addingFacet, setAddingFacet] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [uploadingReport, setUploadingReport] = React.useState(false);

  // S1 always exists: seed it exactly once when the screen first sees an
  // inspection with no siding facets. The ref guards against re-entry while
  // the optimistic create is still landing in the cache.
  const seededRef = React.useRef(false);
  const hasInspection = Boolean(inspection);
  const facetCount = inspection?.sidingFacets?.length ?? 0;
  React.useEffect(() => {
    if (!hasInspection || facetCount > 0 || seededRef.current) return;
    seededRef.current = true;
    void createSidingFacet(queryClient, id, { label: 'S1' });
  }, [hasInspection, facetCount, queryClient, id]);

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
  const facets = inspection.sidingFacets ?? [];
  const facetById = new Map(state.sidingFacets.map((f) => [f.id, f]));
  const remaining = stageDeficiencies(inspection, 'siding').length;
  const reportUploaded = state.sidingMeasurementReportUploaded;
  // v2.2 — inspection-level WRB question, shown once any facet has damage.
  const anyFacetDamaged = (inspection.sidingFacets ?? []).some((f) => Boolean(f.damaged));
  const wrbPresent = (inspection.sidingWrbPresent as boolean | null) ?? null;

  async function setWrbPresent(value: boolean) {
    if (wrbPresent === value) return;
    await patchInspection(queryClient, id, { sidingWrbPresent: value });
  }

  // Next facet label: S{n} past the highest existing S-number.
  function nextFacetLabel(offset = 0): string {
    const max = facets.reduce((acc, facet) => {
      const match = /^S(\d+)$/.exec(facet.label);
      return match ? Math.max(acc, Number(match[1])) : acc;
    }, 0);
    return `S${max + 1 + offset}`;
  }

  // Adds the next S{n} to the list without navigating into it — the rep
  // stays on the list and opens facets when they're ready to document them.
  async function addFacet() {
    if (addingFacet || facets.length >= 40) return;
    setAddingFacet(true);
    try {
      await createSidingFacet(queryClient, id, { label: nextFacetLabel() });
    } finally {
      setAddingFacet(false);
    }
  }

  // Removes the highest-numbered facet. S1 is the floor — there is always at
  // least one siding facet while this branch is active.
  async function removeLastFacet() {
    if (removing || facets.length <= 1) return;
    const last = [...facets].sort((a, b) => {
      const an = Number(/^S(\d+)$/.exec(a.label)?.[1] ?? 0);
      const bn = Number(/^S(\d+)$/.exec(b.label)?.[1] ?? 0);
      return an - bn;
    })[facets.length - 1];
    setRemoving(true);
    try {
      await deleteSidingFacet(queryClient, id, last.id);
    } finally {
      setRemoving(false);
    }
  }

  // Optional measurement report: captured through the same evidence-photo
  // pipeline (subjectType 'inspection', stage 'siding'), then referenced on
  // the inspection by the photo's durable client id. Missing report is only
  // a soft flag — never a hard gate.
  async function attachReport(source: 'camera' | 'library') {
    if (uploadingReport) return;
    setUploadingReport(true);
    try {
      const shot =
        source === 'camera'
          ? await captureEvidencePhoto()
          : await pickEvidencePhotoFromLibrary();
      if (!shot) return;
      const persisted = await persistCapturedPhotoForOutbox(shot);
      const photoId = Crypto.randomUUID();
      const payload: InspectionPhotoOutboxPayload = {
        id: photoId,
        inspectionId: id,
        subjectType: 'inspection',
        subjectId: null,
        stage: 'siding',
        triadRole: 'wide',
        localFilePath: persisted.localFilePath,
        mimeType: shot.mimeType,
        sha256: persisted.sha256,
        exifJson: persisted.exifJson,
        overlayJson: { ...(persisted.overlayJson ?? {}), caption: 'Siding Measurement Report' },
        capturedAtUtc: persisted.capturedAtUtc,
        latitude: persisted.latitude,
        longitude: persisted.longitude,
      };
      await enqueueOutboxItem('inspection.photo', payload);
      appendOptimisticPhotos(queryClient, id, [
        {
          id: photoId,
          subjectType: 'inspection',
          subjectId: null,
          stage: 'siding',
          triadRole: 'wide',
          sha256: persisted.sha256,
        },
      ]);
      await patchInspection(queryClient, id, { sidingMeasurementReportRef: photoId });
      drainOutbox();
    } catch (err) {
      if (err instanceof CameraPermissionDeniedError) {
        Alert.alert(
          'Camera access needed',
          'RoofTrax needs camera access to capture the report. Enable it in Settings, then try again.',
        );
      } else if (err instanceof MediaLibraryPermissionDeniedError) {
        Alert.alert(
          'Photo access needed',
          'RoofTrax needs photo access to upload the report. Enable it in Settings, then try again.',
        );
      } else {
        Alert.alert('Upload failed', 'Could not attach the measurement report. Try again.');
      }
    } finally {
      setUploadingReport(false);
    }
  }

  function promptReportSource() {
    Alert.alert('Attach measurement report', undefined, [
      { text: 'Take photo', onPress: () => void attachReport('camera') },
      { text: 'Choose from library', onPress: () => void attachReport('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const facetComplete = (facetId: string): boolean => {
    const facet = facetById.get(facetId);
    if (!facet) return false;
    if (!facet.facetPhotoCaptured) return false;
    if (facet.damaged && (!facet.damageType || facet.damagePhotoCount < 1)) return false;
    return facet.components.every((c) => c.actionSelected && c.photoCaptured);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {facets.length === 0 ? (
          <View style={[styles.centered, { paddingVertical: 48 }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Setting up S1…</Text>
          </View>
        ) : (
          <>
            {/* Header: title + (−) N (+) stepper */}
            <View style={styles.headerRow}>
              <Text style={[styles.section, { color: colors.foreground, marginTop: 0 }]}>
                Siding Facets
              </Text>
              <View style={styles.stepper}>
                <Pressable
                  onPress={removeLastFacet}
                  disabled={removing || facets.length <= 1}
                  hitSlop={8}
                  style={[
                    styles.stepBtn,
                    { backgroundColor: colors.card, borderColor: colors.border, opacity: facets.length <= 1 ? 0.4 : 1 },
                  ]}
                >
                  {removing ? (
                    <ActivityIndicator size="small" color={colors.secondary} />
                  ) : (
                    <Icon name="minus" size={18} color={colors.foreground} />
                  )}
                </Pressable>
                <Text style={[styles.stepCount, { color: colors.foreground }]}>{facets.length}</Text>
                <Pressable
                  onPress={addFacet}
                  disabled={addingFacet}
                  hitSlop={8}
                  style={[styles.stepBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  {addingFacet ? (
                    <ActivityIndicator size="small" color={colors.secondary} />
                  ) : (
                    <Icon name="plus" size={18} color={colors.foreground} />
                  )}
                </Pressable>
              </View>
            </View>
            {facets.map((facet) => {
              const done = facetComplete(facet.id);
              const info = facetById.get(facet.id);
              const missing: string[] = [];
              if (info && !info.facetPhotoCaptured) missing.push('facet photo');
              if (info?.damaged && !info.damageType) missing.push('damage type');
              if (info?.damaged && info.damagePhotoCount < 1) missing.push('damage photo');
              if (info?.components.some((c) => !c.photoCaptured)) missing.push('component photos');
              if (info?.components.some((c) => !c.actionSelected))
                missing.push('component disposition');
              return (
                <Pressable
                  key={facet.id}
                  onPress={() =>
                    router.push({
                      pathname: '/inspection-siding-facet',
                      params: { id, sidingFacetId: facet.id },
                    })
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
                        ? `Documented${facet.damaged ? ` · ${facet.damageType ?? 'damage'}` : ' · no damage'}`
                        : missing.length > 0
                          ? `Needs ${missing.join(', ')}`
                          : 'Tap to document'}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
                </Pressable>
              );
            })}
            {/* v2.2 — Water-resistive barrier, asked ONCE per inspection.
                Only shown when at least one facet is marked damaged. */}
            {anyFacetDamaged && (
              <>
                <Text style={[styles.section, { color: colors.foreground }]}>
                  Does the home currently have water resistive barrier?
                </Text>
                <View style={styles.chipRow}>
                  {([true, false] as const).map((v) => {
                    const selected = wrbPresent === v;
                    return (
                      <Pressable
                        key={String(v)}
                        onPress={() => void setWrbPresent(v)}
                        style={[
                          styles.yesNo,
                          {
                            backgroundColor: selected ? colors.primary : colors.card,
                            borderColor: selected ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: selected ? colors.primaryForeground : colors.foreground,
                            fontWeight: '700',
                          }}
                        >
                          {v ? 'Yes' : 'No'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            {/* Optional measurement report — soft flag only when missing. */}
            <Text style={[styles.section, { color: colors.foreground }]}>Measurement report (optional)</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Attach a siding measurement report if one exists. Skipping this only flags the
              package for reviewer attention — it never blocks submission.
            </Text>
            <Pressable
              onPress={reportUploaded ? undefined : promptReportSource}
              disabled={uploadingReport}
              style={[styles.row, { backgroundColor: colors.card, borderColor: reportUploaded ? colors.success : colors.border }]}
            >
              <View style={[styles.badge, { backgroundColor: reportUploaded ? colors.success : colors.accent }]}>
                {uploadingReport ? (
                  <ActivityIndicator color={colors.secondary} />
                ) : (
                  <Icon name={reportUploaded ? 'check' : 'upload'} size={18} color={reportUploaded ? '#fff' : colors.secondary} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  {reportUploaded ? 'Measurement report attached' : 'Attach measurement report'}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  {reportUploaded ? 'On file with this inspection' : 'Photo or scan of the report'}
                </Text>
              </View>
              {!reportUploaded && (
                <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
              )}
            </Pressable>

            <Text style={{ color: remaining === 0 ? colors.success : colors.mutedForeground, fontSize: 13, marginTop: 4 }}>
              {remaining === 0
                ? 'Siding documentation complete.'
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepCount: { fontSize: 17, fontWeight: '800', minWidth: 24, textAlign: 'center' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  yesNo: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 28 },
});

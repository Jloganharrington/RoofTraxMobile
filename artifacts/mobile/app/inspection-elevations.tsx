import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ActivityIndicator,
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
import { ELEVATION_DIRECTIONS, type ElevationDirection } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import {
  createElevation,
  markNoCollateralDamage,
  patchInspection,
  patchPhotoCaption,
} from '@/lib/inspectionSync';
import { DamageCaptionChips, DamageCaptionBadge } from '@/components/DamageCaptionChips';
import {
  elevationWideCaptured,
  isCollateralWaived,
  stageDeficiencies,
} from '@/lib/inspectionProtocolState';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';

const GROUND_SUGGESTIONS = ['Window screens', 'Siding', 'AC condenser fins', 'Mailbox', 'Fence'];

// Elevation Walk (protocol v2.1). Walks the inspector around the structure in
// a fixed front -> right -> rear -> left order, capturing one wide overview
// photo per elevation, then records which damage surfaces were observed
// (roof / siding / collateral) — these flags decide which conditional steps
// apply downstream. The photo gate is derived from photo linkage, never
// asserted by this screen.

const DIRECTION_LABELS: Record<ElevationDirection, string> = {
  front: 'Front',
  right: 'Right',
  back: 'Rear',
  left: 'Left',
};

export default function InspectionElevationsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  useNextSectionHeader(id, 'elevation_access');

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const { user } = useAuth();
  const [busy, setBusy] = React.useState<ElevationDirection | null>(null);
  const [savingCaption, setSavingCaption] = React.useState<string | null>(null);
  const [waiving, setWaiving] = React.useState(false);
  const [groundLabelOpen, setGroundLabelOpen] = React.useState(false);
  const [groundLabel, setGroundLabel] = React.useState('');
  const [savingCollateralCaption, setSavingCollateralCaption] = React.useState<string | null>(null);

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

  const captured = elevationWideCaptured(inspection);
  const remaining = stageDeficiencies(inspection, 'elevation_access').length;
  const collateralPhotos = (inspection.photos ?? []).filter((p) => p.stage === 'collateral');
  const collateralWaived = isCollateralWaived(inspection);
  // Townhomes share side walls with the neighboring units — right/left
  // elevations are optional (the gate engine exempts them too).
  const isTownhome = inspection.propertyProfile?.propertyType === 'townhome';
  const requiredDirections: readonly ElevationDirection[] = isTownhome
    ? ELEVATION_DIRECTIONS.filter((d) => d !== 'right' && d !== 'left')
    : ELEVATION_DIRECTIONS;
  const doneCount = requiredDirections.filter((d) => captured[d]).length;
  // The current step is the first REQUIRED direction still missing its wide
  // photo (optional side elevations never block progression).
  const currentDirection = requiredDirections.find((d) => !captured[d]) ?? null;

  async function handleCaptionChange(photoId: string, caption: string | null) {
    setSavingCaption(photoId);
    try {
      await patchPhotoCaption(queryClient, id, photoId, caption);
    } catch {
      // Optimistic update stays; next refetch reconciles.
    } finally {
      setSavingCaption(null);
    }
  }

  async function handleCollateralCaptionChange(photoId: string, caption: string | null) {
    setSavingCollateralCaption(photoId);
    try {
      await patchPhotoCaption(queryClient, id, photoId, caption);
    } catch {
      // no-op
    } finally {
      setSavingCollateralCaption(null);
    }
  }

  async function markNoDamage() {
    if (!user || waiving) return;
    setWaiving(true);
    try {
      await markNoCollateralDamage(queryClient, id, user.id);
    } finally {
      setWaiving(false);
    }
  }

  function captureGround(photoLabel: string) {
    setGroundLabelOpen(false);
    setGroundLabel('');
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'inspection',
        roles: 'wide',
        stage: 'collateral',
        title: `Ground-level · ${photoLabel}`,
      },
    });
  }

  async function walk(direction: ElevationDirection) {
    if (!inspection) return;
    setBusy(direction);
    try {
      const existing = inspection.elevations?.find((e) => e.direction === direction);
      const elevationId = existing?.id ?? (await createElevation(queryClient, id, direction));
      router.push({
        pathname: '/inspection-photo-capture',
        params: {
          inspectionId: id,
          subjectType: 'elevation',
          subjectId: elevationId,
          roles: 'wide',
          stage: 'elevation_access',
          title: `${DIRECTION_LABELS[direction]} elevation`,
        },
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View
        style={[
          styles.summary,
          {
            backgroundColor: remaining === 0 ? '#ecfdf5' : colors.card,
            borderColor: remaining === 0 ? colors.success : colors.border,
          },
        ]}
      >
        <Icon
          name={remaining === 0 ? 'check' : 'home'}
          size={22}
          color={remaining === 0 ? colors.success : colors.primary}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
            {remaining === 0
              ? 'All required elevations captured'
              : `${doneCount} of ${requiredDirections.length} required elevations captured`}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            {isTownhome
              ? 'Townhome — right and left elevations are shared walls and optional.'
              : 'One wide overview photo per face, walked front → right → rear → left.'}
          </Text>
        </View>
      </View>

      {ELEVATION_DIRECTIONS.map((direction, index) => {
        const isDone = captured[direction];
        const isOptional = !requiredDirections.includes(direction);
        const isCurrent = direction === currentDirection;
        const isBusy = busy === direction;
        const elevation = (inspection.elevations ?? []).find((e) => e.direction === direction);
        const photo = elevation
          ? (inspection.photos ?? []).find(
              (p) => p.subjectType === 'elevation' && p.subjectId === elevation.id,
            )
          : null;
        const caption = photo?.overlayJson
          ? ((photo.overlayJson as Record<string, unknown>).caption as string | null) ?? null
          : null;
        return (
          <View
            key={direction}
            style={{
              borderRadius: 14,
              borderWidth: isCurrent ? 2 : 1,
              borderColor: isCurrent ? colors.primary : colors.border,
              overflow: 'hidden',
            }}
          >
            <Pressable
              onPress={() => walk(direction)}
              disabled={isBusy}
              style={[styles.row, { backgroundColor: colors.card, borderRadius: 0, borderWidth: 0 }]}
            >
              <View
                style={[
                  styles.badge,
                  { backgroundColor: isDone ? colors.success : isCurrent ? colors.primary : colors.accent },
                ]}
              >
                {isBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Icon
                    name={isDone ? 'check' : 'camera'}
                    size={18}
                    color={isDone || isCurrent ? '#fff' : colors.secondary}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  {index + 1}. {DIRECTION_LABELS[direction]} elevation
                  {isOptional ? ' (optional)' : ''}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    {isDone
                      ? 'Wide photo captured'
                      : isCurrent
                        ? 'Next — capture the wide photo'
                        : isOptional
                          ? 'Optional for townhomes — tap to capture if accessible'
                          : 'Tap to capture'}
                  </Text>
                  <DamageCaptionBadge caption={caption} />
                </View>
              </View>
              <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
            </Pressable>
            {photo && isDone ? (
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

      {/* v2.1 — Damage-surface flags. What the inspector observed on the walk
          decides which conditional capture steps apply. Submission requires at
          least one flag (or none-found is a hard stop server-side). */}
      <Text style={[styles.summaryTitle, { color: colors.foreground, marginTop: 8 }]}>
        Damage observed during the walk
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: -6 }}>
        Pre-filled from the Phase 1 damage surfaces — confirm what you observed on the walk. You
        can add a surface the ground look missed; removing one is recorded (a measurement report
        may already have been ordered on it).
      </Text>
      {(
        [
          { key: 'roofDamageFound', label: 'Roof damage found', icon: 'home' as const },
          { key: 'sidingDamageFound', label: 'Siding damage found', icon: 'grid' as const },
          {
            key: 'collateralDamageFound',
            label: 'Collateral damage found',
            icon: 'alert-circle' as const,
          },
          {
            key: 'interiorDamageFound',
            label: 'Interior damage found',
            icon: 'droplet' as const,
          },
        ] as const
      ).map(({ key, label, icon }) => {
        const on = Boolean(inspection[key]);
        return (
          <Pressable
            key={key}
            onPress={() => patchInspection(queryClient, id, { [key]: !on })}
            style={[
              styles.row,
              {
                backgroundColor: colors.card,
                borderColor: on ? colors.primary : colors.border,
                borderWidth: on ? 2 : 1,
              },
            ]}
          >
            <View style={[styles.badge, { backgroundColor: on ? colors.primary : colors.accent }]}>
              <Icon name={on ? 'check' : icon} size={18} color={on ? '#fff' : colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>{label}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {on ? 'Marked — capture steps unlocked' : 'Tap if observed'}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {/* ── Ground-Level Collateral ─────────────────────────────────────── */}
      <Text style={[styles.summaryTitle, { color: colors.foreground, marginTop: 8 }]}>
        Ground-level collateral evidence
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: -6 }}>
        Photograph any ground-level items showing storm damage — screens, siding, AC fins, mailbox, fence.
      </Text>

      {/* Captured collateral photos with caption editing */}
      {collateralPhotos.map((photo, index) => {
        const caption = photo.overlayJson
          ? ((photo.overlayJson as Record<string, unknown>).caption as string | null) ?? null
          : null;
        return (
          <View
            key={photo.id}
            style={[styles.photoRow, { backgroundColor: colors.card, borderColor: caption ? colors.success : colors.border }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
              <Icon name="image" size={18} color={colors.mutedForeground} />
              <Text style={{ color: colors.foreground, fontWeight: '600', flex: 1 }}>
                {`Ground-level photo ${index + 1}`}
              </Text>
              {caption ? (
                <View style={[styles.captionBadge, { backgroundColor: colors.primary }]}>
                  <Text style={{ color: colors.primaryForeground, fontSize: 10, fontWeight: '700' }}>
                    {caption.split(' – ')[1] ?? caption}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <DamageCaptionChips
                value={caption}
                saving={savingCollateralCaption === photo.id}
                onChange={(c) => handleCollateralCaptionChange(photo.id, c)}
              />
            </View>
          </View>
        );
      })}

      {/* Quick-pick suggestions */}
      <View style={styles.chipRow}>
        {GROUND_SUGGESTIONS.map((s) => (
          <Pressable
            key={s}
            onPress={() => captureGround(s)}
            style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Icon name="camera" size={14} color={colors.primary} />
            <Text style={{ color: colors.foreground, fontWeight: '600' }}>{s}</Text>
          </Pressable>
        ))}
      </View>

      {/* Custom label */}
      <Pressable
        onPress={() => { setGroundLabel(''); setGroundLabelOpen(true); }}
        style={[styles.addRow, { borderColor: colors.border }]}
      >
        <Icon name="plus" size={18} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '600' }}>Add additional ground-level photo</Text>
      </Pressable>

      {/* No-damage waive */}
      {!collateralWaived && collateralPhotos.length === 0 && (
        <Pressable
          onPress={markNoDamage}
          disabled={waiving}
          style={[styles.waiveBtn, { borderColor: colors.border, opacity: waiving ? 0.6 : 1 }]}
        >
          {waiving
            ? <ActivityIndicator color={colors.mutedForeground} />
            : <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>No Collateral Damage Found</Text>}
        </Pressable>
      )}
      {collateralWaived && (
        <View style={[styles.row, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
          <Icon name="check" size={18} color={colors.success} />
          <Text style={{ color: colors.foreground, fontWeight: '600' }}>No collateral damage — on file</Text>
        </View>
      )}

      <View style={{ height: 40 }} />

      {/* Custom ground-level label modal */}
      <Modal visible={groundLabelOpen} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
              Label this ground-level photo
            </Text>
            <TextInput
              value={groundLabel}
              onChangeText={setGroundLabel}
              placeholder="e.g. Dented AC fin"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setGroundLabelOpen(false)}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => groundLabel.trim() && captureGround(groundLabel.trim())}
                disabled={!groundLabel.trim()}
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: groundLabel.trim() ? 1 : 0.5 }]}
              >
                <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Capture</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  summaryTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  photoRow: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  captionBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed' },
  waiveBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', borderRadius: 16, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  secondaryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
});

import React from 'react';
import {
  KeyboardAvoidingView,
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
import { createElevation, patchInspection, patchPhotoCaption } from '@/lib/inspectionSync';
import { DamageCaptionChips, DamageCaptionBadge } from '@/components/DamageCaptionChips';
import {
  elevationWideCaptured,
  stageDeficiencies,
} from '@/lib/inspectionProtocolState';

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

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const [busy, setBusy] = React.useState<ElevationDirection | null>(null);
  const [savingCaption, setSavingCaption] = React.useState<string | null>(null);

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
  const doneCount = ELEVATION_DIRECTIONS.filter((d) => captured[d]).length;
  // The current step is the first direction still missing its wide photo.
  const currentDirection = ELEVATION_DIRECTIONS.find((d) => !captured[d]) ?? null;

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
              ? 'All elevations captured'
              : `${doneCount} of 4 elevations captured`}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            One wide overview photo per face, walked front → right → rear → left.
          </Text>
        </View>
      </View>

      {ELEVATION_DIRECTIONS.map((direction, index) => {
        const isDone = captured[direction];
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
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    {isDone ? 'Wide photo captured' : isCurrent ? 'Next — capture the wide photo' : 'Tap to capture'}
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

      {/* REPORT_DATA v2 §5 — Specialized property protection. Recorded here
          because the elevation walk is when the rep is looking at the whole
          property. Explicit flag — never inferred; ordinary tarping lives in
          Temporary Repairs instead. */}
      <ProtectionPlanSection inspection={inspection} inspectionId={id} colors={colors} />

      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const PROTECTED_FEATURES = [
  { value: 'pool_spa', label: 'Pool / spa' },
  { value: 'solar_panels', label: 'Solar panels' },
  { value: 'skylights', label: 'Skylights' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'satellite', label: 'Satellite' },
  { value: 'specimen_landscaping', label: 'Landscaping' },
  { value: 'detached_structure', label: 'Detached structure' },
  { value: 'driveway_hardscape', label: 'Driveway / hardscape' },
  { value: 'septic_field', label: 'Septic field' },
];

function ProtectionPlanSection({
  inspection,
  inspectionId,
  colors,
}: {
  inspection: { propertyProtectionPlan?: { specializedRequired: boolean; featureProtected?: string | null; whyOrdinaryTarpingInsufficient?: string | null; proposedEquipment?: string | null; setupMethod?: string | null } | null };
  inspectionId: string;
  colors: ReturnType<typeof useColors>;
}) {
  const queryClient = useQueryClient();
  const existing = inspection.propertyProtectionPlan ?? null;
  const [specializedRequired, setSpecializedRequired] = React.useState(false);
  const [featureProtected, setFeatureProtected] = React.useState<string | null>(null);
  const [why, setWhy] = React.useState('');
  const [equipment, setEquipment] = React.useState('');
  const [setupMethod, setSetupMethod] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (existing && !hydrated) {
      setSpecializedRequired(existing.specializedRequired);
      setFeatureProtected(existing.featureProtected ?? null);
      setWhy(existing.whyOrdinaryTarpingInsufficient ?? '');
      setEquipment(existing.proposedEquipment ?? '');
      setSetupMethod(existing.setupMethod ?? '');
      setHydrated(true);
    }
  }, [existing, hydrated]);

  async function save() {
    if (saving) return;
    setError(null);
    if (specializedRequired && !why.trim()) {
      setError('Explain why ordinary tarping is insufficient — required when flagged.');
      return;
    }
    setSaving(true);
    try {
      await patchInspection(queryClient, inspectionId, {
        propertyProtectionPlan: {
          specializedRequired,
          featureProtected: (featureProtected as never) ?? null,
          whyOrdinaryTarpingInsufficient: why.trim() || null,
          proposedEquipment: equipment.trim() || null,
          setupMethod: setupMethod.trim() || null,
          photoIds: [],
          recordedAtUtc: new Date().toISOString(),
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.summaryTitle, { color: colors.foreground, marginTop: 8 }]}>
        Specialized property protection
      </Text>
      <Pressable
        onPress={() => setSpecializedRequired((v) => !v)}
        style={[
          styles.row,
          {
            backgroundColor: colors.card,
            borderColor: specializedRequired ? colors.primary : colors.border,
            borderWidth: specializedRequired ? 2 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.badge,
            { backgroundColor: specializedRequired ? colors.primary : colors.accent },
          ]}
        >
          <Icon
            name={specializedRequired ? 'check' : 'shield'}
            size={18}
            color={specializedRequired ? '#fff' : colors.secondary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>
            Specialized protection required
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            {specializedRequired
              ? 'Flagged — describe the feature and why tarping isn’t enough'
              : 'Beyond ordinary tarping (scaffold, pool cover, panel protection…)'}
          </Text>
        </View>
      </Pressable>

      {specializedRequired ? (
        <>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, fontWeight: '600' }}>
            Feature being protected
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PROTECTED_FEATURES.map((feature) => {
              const on = featureProtected === feature.value;
              return (
                <Pressable
                  key={feature.value}
                  onPress={() => setFeatureProtected(on ? null : feature.value)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 20,
                    borderWidth: 1,
                    backgroundColor: on ? colors.primary : colors.card,
                    borderColor: on ? colors.primary : colors.border,
                  }}
                >
                  <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontWeight: '600' }}>
                    {feature.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <PlanInput
            label="Why ordinary tarping is insufficient (required)"
            value={why}
            onChange={setWhy}
            placeholder="e.g. Solar array can’t bear tarp anchors; wind uplift risk"
            colors={colors}
          />
          <PlanInput
            label="Proposed equipment"
            value={equipment}
            onChange={setEquipment}
            placeholder="e.g. Scaffold with debris netting"
            colors={colors}
          />
          <PlanInput
            label="Setup method"
            value={setupMethod}
            onChange={setSetupMethod}
            placeholder="e.g. Freestanding, no roof penetrations"
            colors={colors}
          />
        </>
      ) : null}

      {error ? <Text style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text> : null}

      {(specializedRequired || existing != null) && (
        <Pressable
          onPress={save}
          disabled={saving}
          style={{
            paddingVertical: 13,
            borderRadius: 12,
            alignItems: 'center',
            backgroundColor: colors.primary,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
              Save protection plan
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function PlanInput({
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
      <Text style={{ color: colors.mutedForeground, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline
        style={{
          borderWidth: 1,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          minHeight: 60,
          textAlignVertical: 'top',
          backgroundColor: colors.card,
          borderColor: colors.border,
          color: colors.foreground,
        }}
      />
    </View>
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
  },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
});

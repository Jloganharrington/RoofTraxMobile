import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { ELEVATION_DIRECTIONS, type ElevationDirection } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { createElevation, patchInspection } from '@/lib/inspectionSync';
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
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
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
        return (
          <Pressable
            key={direction}
            onPress={() => walk(direction)}
            disabled={isBusy}
            style={[
              styles.row,
              {
                backgroundColor: colors.card,
                borderColor: isCurrent ? colors.primary : colors.border,
                borderWidth: isCurrent ? 2 : 1,
              },
            ]}
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
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {isDone ? 'Wide photo captured' : isCurrent ? 'Next — capture the wide photo' : 'Tap to capture'}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
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

      <View style={{ height: 40 }} />
    </ScrollView>
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

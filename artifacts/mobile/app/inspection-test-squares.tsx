import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetInspectionQueryKey,
  useGetInspection,
  type TestSquareHitType,
} from '@workspace/api-client-react';
import { carriesHail, type FacetDamageType } from '@workspace/protocol';
import { Icon, type IconName } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { createTestSquare, createTestSquareHit } from '@/lib/inspectionSync';
import { buildProtocolState, stageDeficiencies } from '@/lib/inspectionProtocolState';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';

// Step 4 · Test Squares (protocol v2). Hail-gated checklist: every facet whose
// damage type carries hail (hail or hail_and_wind) needs one test square with
// a chalked overview photo. Wind-only and undamaged facets are exempt. Each
// hit is classified from the controlled vocabulary and photographed with a
// scale gauge. The app records raw facts only — the hit count is a plain
// tally, never a derived density/severity.

const HIT_TYPES: Array<{ value: TestSquareHitType; label: string; icon: IconName }> = [
  { value: 'hail_strike', label: 'Hail strike', icon: 'cloud' },
  { value: 'mechanical', label: 'Mechanical', icon: 'wind' },
  { value: 'blistering', label: 'Blistering', icon: 'square' },
  { value: 'foot_scuff', label: 'Foot scuff', icon: 'navigation' },
];

export default function InspectionTestSquaresScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  useNextSectionHeader(id, 'test_squares');

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [hitTarget, setHitTarget] = React.useState<{ squareId: string; label: string } | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);

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
  const squareBySlope = new Map(state.testSquares.map((sq) => [sq.slopeId, sq]));
  const remaining = stageDeficiencies(inspection, 'test_squares').length;
  // Only hail-carrying facets require a square (protocol v2 hail gate).
  const hailFacets = (inspection.slopes ?? []).filter((slope) => {
    if (!slope.damagePresent) return false;
    return carriesHail((slope.damageType as FacetDamageType | null) ?? null);
  });

  function captureOverview(squareId: string, label: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'test_square',
        subjectId: squareId,
        roles: 'wide',
        stage: 'test_squares',
        title: `${label} — chalked overview`,
      },
    });
  }

  function captureHitCloseup(hitId: string, label: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'test_square_hit',
        subjectId: hitId,
        roles: 'close',
        stage: 'test_squares',
        title: `${label} — close-up with scale gauge`,
      },
    });
  }

  async function addSquare(slopeId: string, label: string) {
    if (busy) return;
    setBusy(true);
    try {
      const squareId = await createTestSquare(queryClient, id, {
        slopeId,
        label: `${label} test square`,
      });
      captureOverview(squareId, label);
    } finally {
      setBusy(false);
    }
  }

  async function recordHit(type: TestSquareHitType, typeLabel: string) {
    if (!hitTarget || busy) return;
    setBusy(true);
    try {
      const hitId = await createTestSquareHit(queryClient, id, hitTarget.squareId, {
        hitType: type,
      });
      const label = hitTarget.label;
      setHitTarget(null);
      captureHitCloseup(hitId, `${label} · ${typeLabel}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      {hailFacets.length === 0 ? (
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Icon name="clipboard" size={22} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
            No facets with hail damage documented. Test squares are only required on facets whose
            damage type is Hail or Hail &amp; Wind (Step 3).
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.summary,
            {
              backgroundColor: remaining === 0 ? '#ecfdf5' : colors.card,
              borderColor: remaining === 0 ? colors.success : colors.border,
            },
          ]}
        >
          <Icon name="clipboard" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
              {remaining === 0
                ? 'Every hail facet has its test square'
                : `${remaining} hail facet${remaining === 1 ? '' : 's'} still need a test square`}
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
            <Text style={[styles.section, { color: colors.foreground }]}>{slope.label}</Text>

            {square ? (
              <>
                <View
                  style={[
                    styles.row,
                    {
                      backgroundColor: colors.card,
                      borderColor: square.photoCaptured ? colors.success : '#f59e0b',
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: square.photoCaptured ? colors.success : colors.accent },
                    ]}
                  >
                    <Icon
                      name={square.photoCaptured ? 'check' : 'camera'}
                      size={18}
                      color={square.photoCaptured ? '#fff' : colors.secondary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                      {square.hitCount} hit{square.hitCount === 1 ? '' : 's'} recorded
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      {square.photoCaptured
                        ? square.hitCount === 0
                          ? 'Zero-hit square is valid — confirm it was intentional.'
                          : 'Overview captured. Add hits or move on.'
                        : 'Chalked overview photo required to satisfy this step.'}
                    </Text>
                  </View>
                </View>

                {!square.photoCaptured && (
                  <Pressable
                    onPress={() => captureOverview(square.id, slope.label)}
                    style={[styles.actionRow, { backgroundColor: colors.primary }]}
                  >
                    <Icon name="camera" size={18} color={colors.primaryForeground} />
                    <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
                      Capture chalked overview
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  onPress={() => setHitTarget({ squareId: square.id, label: slope.label })}
                  style={[styles.addRow, { borderColor: colors.border }]}
                >
                  <Icon name="plus" size={18} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>Record a hit</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={() => addSquare(slope.id, slope.label)}
                disabled={busy}
                style={[styles.actionRow, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
              >
                <Icon name="square" size={18} color={colors.primaryForeground} />
                <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
                  Mark test square
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}

      <View style={{ height: 40 }} />

      {/* Per-hit classification picker. One tap classifies the hit and jumps
          straight to its scale-gauge close-up. */}
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
                disabled={busy}
                style={[styles.pickRow, { borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}
              >
                <Icon name={t.icon} size={18} color={colors.primary} />
                <Text style={{ color: colors.foreground, fontWeight: '600', flex: 1 }}>{t.label}</Text>
                <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
            <Pressable
              onPress={() => setHitTarget(null)}
              style={[styles.secondaryBtn, { borderColor: colors.border, alignSelf: 'flex-end' }]}
            >
              <Text style={{ color: colors.foreground }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  summaryTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
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
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', borderRadius: 16, padding: 20, gap: 12 },
  secondaryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
});

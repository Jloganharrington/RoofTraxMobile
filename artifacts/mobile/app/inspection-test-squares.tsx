import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetInspectionQueryKey,
  useGetInspection,
  type TestSquareHitType,
} from '@workspace/api-client-react';
import { Icon, type IconName } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import {
  createTestSquare,
  createTestSquareHit,
  markSlopeInaccessible,
} from '@/lib/inspectionSync';
import { buildProtocolState, stageDeficiencies } from '@/lib/inspectionProtocolState';

// D1/D2 — Test-square module (S4). One test square per directional slope: a
// chalked overview photo, then a per-hit close-up loop where each hit is
// classified from the controlled vocabulary. A slope that can't be walked is
// documented as inaccessible with a reason (D2) instead of a square, which
// clears its S4 gate while recording *why*. The app only records raw facts —
// the hit count is a plain tally, never a derived density/severity.

const HIT_TYPES: Array<{ value: TestSquareHitType; label: string; icon: IconName }> = [
  { value: 'hail_strike', label: 'Hail strike', icon: 'cloud' },
  { value: 'mechanical', label: 'Mechanical', icon: 'wind' },
  { value: 'blistering', label: 'Blistering', icon: 'square' },
  { value: 'foot_scuff', label: 'Foot scuff', icon: 'navigation' },
];

export default function InspectionTestSquaresScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [hitTarget, setHitTarget] = React.useState<{ squareId: string; label: string } | null>(
    null,
  );
  const [reasonTarget, setReasonTarget] = React.useState<{
    slopeId: string;
    label: string;
  } | null>(null);
  const [reason, setReason] = React.useState('');
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

  const slopes = inspection.slopes ?? [];
  const state = buildProtocolState(inspection);
  const squareBySlope = new Map(state.testSquares.map((sq) => [sq.slopeId, sq]));
  const inaccessible = new Set(state.inaccessibleSlopeIds);
  const s4Remaining = stageDeficiencies(inspection, 'S4').length;

  function captureOverview(squareId: string, label: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'test_square',
        subjectId: squareId,
        roles: 'wide',
        stage: 'S4',
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
        stage: 'S4',
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

  async function saveInaccessible() {
    if (!reasonTarget || !reason.trim() || busy || !user) return;
    setBusy(true);
    try {
      await markSlopeInaccessible(queryClient, id, reasonTarget.slopeId, reason.trim(), user.id);
      const slopeId = reasonTarget.slopeId;
      setReasonTarget(null);
      setReason('');
      // Optional constraint photo attaches to the slope (never an orphan).
      router.push({
        pathname: '/inspection-photo-capture',
        params: {
          inspectionId: id,
          subjectType: 'slope',
          subjectId: slopeId,
          roles: 'wide',
          stage: 'S4',
          title: 'Inaccessible slope — document the constraint',
        },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      {slopes.length === 0 ? (
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Icon name="alert-circle" size={22} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
            Document the roof slopes first (S3). One test square is required per accessible slope.
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.summary,
            {
              backgroundColor: s4Remaining === 0 ? '#ecfdf5' : colors.card,
              borderColor: s4Remaining === 0 ? colors.success : colors.border,
            },
          ]}
        >
          <Icon name="clipboard" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
              {s4Remaining === 0
                ? 'Every slope has a square or a documented reason'
                : `${s4Remaining} slope${s4Remaining === 1 ? '' : 's'} still need a test square`}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Chalk the square, shoot the overview, then classify each hit with a scale gauge.
            </Text>
          </View>
        </View>
      )}

      {slopes.map((slope) => {
        const square = squareBySlope.get(slope.id);
        const isInaccessible = inaccessible.has(slope.id);
        return (
          <View key={slope.id} style={{ gap: 8 }}>
            <Text style={[styles.section, { color: colors.foreground }]}>{slope.label}</Text>

            {isInaccessible ? (
              <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                  <Icon name="x" size={18} color={colors.secondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    Documented inaccessible
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    Reason on file — S4 satisfied for this slope.
                  </Text>
                </View>
              </View>
            ) : square ? (
              <>
                <View
                  style={[
                    styles.row,
                    {
                      backgroundColor: colors.card,
                      borderColor: square.overviewPhotoCaptured ? colors.success : '#f59e0b',
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: square.overviewPhotoCaptured ? colors.success : colors.accent },
                    ]}
                  >
                    <Icon
                      name={square.overviewPhotoCaptured ? 'check' : 'camera'}
                      size={18}
                      color={square.overviewPhotoCaptured ? '#fff' : colors.secondary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                      {square.hitCount} hit{square.hitCount === 1 ? '' : 's'} recorded
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      {square.overviewPhotoCaptured
                        ? square.hitCount === 0
                          ? 'Zero-hit square is valid — confirm it was intentional.'
                          : 'Overview captured. Add hits or move on.'
                        : 'Overview photo required to satisfy S4.'}
                    </Text>
                  </View>
                </View>

                {!square.overviewPhotoCaptured && (
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
              <>
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
                <Pressable
                  onPress={() => {
                    setReason('');
                    setReasonTarget({ slopeId: slope.id, label: slope.label });
                  }}
                  style={[styles.addRow, { borderColor: colors.border }]}
                >
                  <Icon name="x" size={18} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>
                    Slope inaccessible
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        );
      })}

      <View style={{ height: 40 }} />

      {/* Per-hit classification picker (D1). One tap classifies the hit and
          jumps straight to its scale-gauge close-up. */}
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

      {/* Inaccessible-slope reason (D2). */}
      <Modal visible={reasonTarget !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              Why is {reasonTarget?.label} inaccessible?
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Pitch too steep to walk safely, no anchor point"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.input,
                { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, minHeight: 80 },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setReasonTarget(null)}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveInaccessible}
                disabled={!reason.trim() || busy}
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: !reason.trim() || busy ? 0.5 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
                    Document & photograph
                  </Text>
                )}
              </Pressable>
            </View>
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
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', borderRadius: 16, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  secondaryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
});

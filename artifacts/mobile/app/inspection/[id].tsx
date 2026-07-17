import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { PROTOCOL_STEPS, stepLabel, type StepKey } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { PreliminaryHub } from '@/components/PreliminaryHub';
import { attestInspection } from '@/lib/inspectionSync';
import {
  buildProtocolState,
  evaluateInspection,
  stageDeficiencies,
} from '@/lib/inspectionProtocolState';

// Forensic hub (protocol v2). Renders the 11 ordered protocol steps from
// PROTOCOL_STEPS — the single source of step identity/order — plus the
// pre-inspection equipment attestation. Step completion is always derived
// from the gate engine (stageDeficiencies), never asserted locally.

const EQUIPMENT_ITEMS = [
  'Ladder',
  'Drone',
  'Chalk / crayon',
  'Moisture meter',
  'Camera / phone',
  'Fall protection',
  'Measuring tape',
  'Shingle gauge',
  'Pitch gauge',
];

const STEP_ICONS: Record<StepKey, IconName> = {
  arrival: 'navigation',
  elevation_access: 'home',
  facets: 'square',
  test_squares: 'square',
  components: 'clipboard',
  collateral: 'camera',
  product: 'camera',
  interior: 'home',
  homeowner: 'clipboard',
  declaration: 'check',
  submit: 'clipboard',
};

const STEP_ROUTES: Record<StepKey, string> = {
  arrival: '/inspection-arrival',
  elevation_access: '/inspection-elevations',
  facets: '/inspection-roof',
  test_squares: '/inspection-test-squares',
  components: '/inspection-components',
  collateral: '/inspection-collateral',
  product: '/inspection-product',
  interior: '/inspection-interior',
  homeowner: '/inspection-homeowner',
  declaration: '/inspection-declaration',
  submit: '/inspection-readiness',
};

export default function InspectionDetailScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [equipmentDone, setEquipmentDone] = useState(false);
  const [savingEquipment, setSavingEquipment] = useState(false);

  const allChecked = EQUIPMENT_ITEMS.every((item) => checked[item]);

  async function confirmEquipment() {
    setSavingEquipment(true);
    try {
      await attestInspection(id, {
        stage: 'arrival',
        attestationType: 'equipment',
        details: { items: checked, confirmedAllPresent: allChecked },
      });
      setEquipmentDone(true);
    } finally {
      setSavingEquipment(false);
    }
  }

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

  // Phase 1 records get the light preliminary hub instead of the full forensic
  // protocol dashboard. The record advances to forensic (this dashboard) only
  // at the P4 checkpoint inside the hub.
  if (inspection.phase === 'preliminary') {
    return <PreliminaryHub inspection={inspection} id={id} />;
  }

  const state = buildProtocolState(inspection);
  const gate = evaluateInspection(inspection);
  const submitted = inspection.status === 'submitted' || inspection.status === 'package_ready';
  const collateralCount = (inspection.photos ?? []).filter((p) => p.stage === 'collateral').length;
  const interiorAddressed =
    (inspection.interiorObservations?.length ?? 0) > 0 || state.interiorClaimWaived;
  const remaining = gate.deficiencies.length;

  // Per-step completion + subtitle, all derived from the gate engine.
  function stepStatus(key: StepKey): { done: boolean; subtitle: string } {
    const missing = stageDeficiencies(inspection!, key).length;
    switch (key) {
      case 'arrival':
        return {
          done: inspection!.arrivalConditions != null && missing === 0,
          subtitle:
            inspection!.arrivalConditions != null
              ? `Recorded ${new Date(inspection!.arrivalConditions.recordedAtUtc).toLocaleTimeString()}`
              : 'Sky, wind, temp, personnel — GPS & time auto-captured',
        };
      case 'elevation_access':
        return {
          done: missing === 0,
          subtitle:
            missing === 0
              ? 'Four elevations + roof access captured'
              : `${missing} photo${missing === 1 ? '' : 's'} outstanding`,
        };
      case 'facets': {
        const facetCount = inspection!.slopes?.length ?? 0;
        return {
          done: facetCount > 0 && missing === 0,
          subtitle:
            facetCount === 0
              ? 'How many facets? Seed and document F1…FN'
              : missing === 0
                ? `${facetCount} facet${facetCount === 1 ? '' : 's'} fully documented`
                : `${missing} item${missing === 1 ? '' : 's'} outstanding across facets`,
        };
      }
      case 'test_squares': {
        const squares = state.testSquares.length;
        return {
          done: missing === 0,
          subtitle:
            missing === 0
              ? squares === 0
                ? 'No hail facets — no squares required'
                : `${squares} square${squares === 1 ? '' : 's'} — hail facets covered`
              : `${missing} hail facet${missing === 1 ? '' : 's'} still need a square`,
        };
      }
      case 'components': {
        const count = inspection!.components?.length ?? 0;
        return {
          done: count > 0 && missing === 0,
          subtitle:
            count === 0
              ? 'Existing components, layer count, penetrations'
              : missing === 0
                ? `${count} component${count === 1 ? '' : 's'} documented`
                : `${missing} component photo${missing === 1 ? '' : 's'} missing`,
        };
      }
      case 'collateral':
        return {
          done: collateralCount > 0,
          subtitle:
            collateralCount === 0
              ? 'Roof- and ground-level labeled photos (optional)'
              : `${collateralCount} labeled photo${collateralCount === 1 ? '' : 's'} captured`,
        };
      case 'product': {
        const count = inspection!.products?.length ?? 0;
        const unidentified =
          inspection!.products?.filter((p) => p.identificationMethod === 'unidentifiable').length ?? 0;
        return {
          done: count > 0 && missing === 0,
          subtitle:
            count === 0
              ? 'Brand, exposure, granule & accessory close-ups'
              : unidentified > 0
                ? `${count} product${count === 1 ? '' : 's'} · ${unidentified} flagged for review`
                : `${count} product${count === 1 ? '' : 's'} identified`,
        };
      }
      case 'interior':
        return {
          done: interiorAddressed,
          subtitle:
            (inspection!.interiorObservations?.length ?? 0) > 0
              ? `${inspection!.interiorObservations!.length} observation${inspection!.interiorObservations!.length === 1 ? '' : 's'} recorded`
              : state.interiorClaimWaived
                ? 'No interior claim — waived'
                : 'Record interior evidence or waive',
        };
      case 'homeowner':
        return {
          done: inspection!.homeownerFacts != null,
          subtitle:
            inspection!.homeownerFacts != null
              ? 'Homeowner facts recorded'
              : 'What the homeowner reported (optional)',
        };
      case 'declaration':
        return {
          done: state.declarationSigned,
          subtitle: state.declarationSigned
            ? 'Methodology attestation signed'
            : 'Read & sign the inspector attestation',
        };
      case 'submit':
        return {
          done: submitted,
          subtitle: submitted
            ? 'Package submitted'
            : remaining === 0
              ? 'All gates satisfied — ready to submit'
              : `${remaining} gate${remaining === 1 ? '' : 's'} remaining before submit`,
        };
      default:
        return { done: false, subtitle: '' };
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.headerCard, { backgroundColor: colors.secondary }]}>
        <Text style={styles.headerTitle}>{inspection.insuredName ?? 'Inspection'}</Text>
        <Text style={styles.headerSub}>{inspection.address ?? 'No address on file'}</Text>
        <View style={styles.headerMetaRow}>
          {inspection.claimNumber ? (
            <Text style={styles.headerMeta}>Claim {inspection.claimNumber}</Text>
          ) : null}
          {inspection.dateOfLoss ? (
            <Text style={styles.headerMeta}>DOL {inspection.dateOfLoss}</Text>
          ) : null}
        </View>
      </View>

      {/* Pre-inspection equipment attestation (not a protocol step). */}
      <Text style={[styles.section, { color: colors.foreground }]}>Equipment check</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {equipmentDone ? (
          <View style={styles.doneRow}>
            <Icon name="check" size={18} color={colors.success} />
            <Text style={{ color: colors.foreground, fontWeight: '600' }}>
              Equipment attested{allChecked ? ' — all present' : ' — partial'}
            </Text>
          </View>
        ) : (
          <>
            {EQUIPMENT_ITEMS.map((item) => {
              const on = !!checked[item];
              return (
                <Pressable
                  key={item}
                  onPress={() => setChecked((prev) => ({ ...prev, [item]: !prev[item] }))}
                  style={styles.checkRow}
                >
                  <View
                    style={[
                      styles.checkbox,
                      {
                        backgroundColor: on ? colors.primary : 'transparent',
                        borderColor: on ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    {on ? <Icon name="check" size={14} color={colors.primaryForeground} /> : null}
                  </View>
                  <Text style={{ color: colors.foreground, fontSize: 15 }}>{item}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={confirmEquipment}
              disabled={savingEquipment}
              style={[styles.confirmBtn, { backgroundColor: colors.primary, opacity: savingEquipment ? 0.6 : 1 }]}
            >
              {savingEquipment ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.confirmText, { color: colors.primaryForeground }]}>
                  Attest equipment
                </Text>
              )}
            </Pressable>
          </>
        )}
      </View>

      {/* Protocol steps 1–11 */}
      <Text style={[styles.section, { color: colors.foreground }]}>Forensic protocol</Text>
      {gate.deficiencies.length > 0 ? (
        <View style={[styles.gateCard, { backgroundColor: '#fffbeb', borderColor: '#f59e0b' }]}>
          <Icon name="alert-circle" size={18} color="#b45309" />
          <Text style={{ color: '#92400e', fontSize: 13, flex: 1 }}>
            {gate.deficiencies.length} gate{gate.deficiencies.length === 1 ? '' : 's'} remaining
            before this inspection can be submitted.
          </Text>
        </View>
      ) : (
        <View style={[styles.gateCard, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
          <Icon name="check" size={18} color={colors.success} />
          <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>
            All hard gates satisfied.
          </Text>
        </View>
      )}

      {PROTOCOL_STEPS.map((step) => {
        const { done, subtitle } = stepStatus(step.key);
        const params: Record<string, string> =
          step.key === 'arrival'
            ? {
                id,
                latitude: inspection.latitude != null ? String(inspection.latitude) : '',
                longitude: inspection.longitude != null ? String(inspection.longitude) : '',
              }
            : { id };
        return (
          <StageCard
            key={step.key}
            icon={STEP_ICONS[step.key]}
            title={stepLabel(step.key)}
            subtitle={subtitle}
            done={done}
            onPress={() => router.push({ pathname: STEP_ROUTES[step.key] as never, params })}
            colors={colors}
          />
        );
      })}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function StageCard({
  icon,
  title,
  subtitle,
  done,
  onPress,
  colors,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  done: boolean;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const body = (
    <>
      <View
        style={[
          styles.stageIcon,
          { backgroundColor: done ? colors.success : colors.accent },
        ]}
      >
        <Icon name={done ? 'check' : icon} size={18} color={done ? '#fff' : colors.secondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.stageTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{subtitle}</Text>
      </View>
      {onPress ? <Icon name="chevron-right" size={20} color={colors.mutedForeground} /> : null}
    </>
  );
  const cardStyle = [
    styles.stageCard,
    { backgroundColor: colors.card, borderColor: colors.border },
  ];
  if (!onPress) {
    return <View style={cardStyle}>{body}</View>;
  }
  return (
    <Pressable onPress={onPress} style={cardStyle}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  headerCard: { borderRadius: 16, padding: 18, gap: 4 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  headerMetaRow: { flexDirection: 'row', gap: 14, marginTop: 6 },
  headerMeta: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' },
  section: { fontSize: 16, fontWeight: '700', marginTop: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  confirmText: { fontSize: 15, fontWeight: '700' },
  stageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  stageIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stageTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  gateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
});

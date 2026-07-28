import React, { useMemo, useState } from 'react';
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
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { applicableSteps, stepLabel, type StepKey } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { PreliminaryHub } from '@/components/PreliminaryHub';
import { attestInspection } from '@/lib/inspectionSync';
import { addBusinessDays } from '@/lib/fipsaTemplate';
import {
  buildProtocolState,
  evaluateInspection,
  isCollateralWaived,
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
  property_profile: 'home',
  repairability: 'tool',
  mitigation: 'shield',
  existing_conditions: 'alert-circle',
  elevation_access: 'home',
  facets: 'square',
  test_squares: 'square',
  components: 'clipboard',
  siding: 'grid',
  collateral: 'camera',
  product: 'camera',
  interior: 'home',
  homeowner: 'clipboard',
  declaration: 'check',
  summary: 'zap',
  estimate: 'dollar-sign',
  submit: 'clipboard',
};

// Shared with the header "Next" button so hub cards and Next never drift.
import { STEP_ROUTES } from '@/hooks/useNextSectionHeader';

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

  // FTC cooling-off gate — shown once per hub visit when the FIPSA was signed
  // fewer than 3 business days ago. The rep can still proceed, but must
  // acknowledge the warning.
  const coolingOffActive = useMemo(() => {
    const signedAt = inspection?.latestAgreement?.signedAt;
    if (!signedAt) return false;
    const deadline = addBusinessDays(new Date(signedAt), 3);
    return new Date() < deadline;
  }, [inspection?.latestAgreement?.signedAt]);
  const [coolingOffDismissed, setCoolingOffDismissed] = useState(false);

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

  // FIPSA gate — the agreement must be signed before any forensic work begins.
  // This can't be bypassed: latestAgreement is server-derived from the
  // signed_agreements table, not a client flag.
  if (!inspection.latestAgreement) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background, padding: 32 }]}>
        <View
          style={[
            styles.gateCard,
            {
              backgroundColor: '#fffbeb',
              borderColor: '#f59e0b',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              padding: 24,
            },
          ]}
        >
          <Icon name="file-text" size={36} color="#b45309" />
          <Text
            style={{ color: '#92400e', fontSize: 17, fontWeight: '800', textAlign: 'center' }}
          >
            Agreement Required
          </Text>
          <Text
            style={{ color: '#92400e', fontSize: 14, textAlign: 'center', lineHeight: 20 }}
          >
            The FIPSA agreement must be signed by the homeowner and rep before
            the forensic inspection can begin.
          </Text>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/inspection-agreement', params: { id } })
            }
            style={[
              styles.confirmBtn,
              { backgroundColor: '#b45309', alignSelf: 'stretch', marginTop: 4 },
            ]}
          >
            <Icon name="file-text" size={18} color="#fff" />
            <Text style={[styles.confirmText, { color: '#fff' }]}>Sign Agreement</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const state = buildProtocolState(inspection);
  const gate = evaluateInspection(inspection);
  const submitted = inspection.status === 'submitted' || inspection.status === 'package_ready';
  const collateralCount = (inspection.photos ?? []).filter((p) => p.stage === 'collateral').length;
  const collateralWaived = isCollateralWaived(inspection);
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
              ? 'Four elevations captured'
              : `${missing} item${missing === 1 ? '' : 's'} outstanding`,
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
      case 'siding': {
        const facetCount = inspection!.sidingFacets?.length ?? 0;
        return {
          done: facetCount > 0 && missing === 0,
          subtitle:
            facetCount === 0
              ? 'How many siding facets? Seed and document S1…SN'
              : missing === 0
                ? `${facetCount} facet${facetCount === 1 ? '' : 's'} fully documented`
                : `${missing} item${missing === 1 ? '' : 's'} outstanding across facets`,
        };
      }
      case 'collateral':
        return {
          done: collateralCount > 0 || collateralWaived,
          subtitle:
            collateralCount > 0
              ? `${collateralCount} labeled photo${collateralCount === 1 ? '' : 's'} captured`
              : collateralWaived
                ? 'No collateral damage found'
                : 'Roof- and ground-level labeled photos (optional)',
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
      case 'property_profile':
        return {
          done: inspection!.propertyProfile != null,
          subtitle:
            inspection!.propertyProfile != null
              ? 'Property & construction described'
              : 'Type, stories, roof age & basis, deck type',
        };
      case 'repairability': {
        const ra = inspection!.repairabilityAssessment as unknown as {
          version?: number;
          roof?: { determination?: string } | null;
          siding?: { determination?: string } | null;
          determination?: string;
        } | null;
        const detLabel = (d?: string) =>
          d === 'supported'
            ? 'spot repair supported'
            : d === 'conditionally_supported'
              ? 'conditionally supported'
              : d === 'not_supported'
                ? 'spot repair not supported'
                : d === 'indeterminate'
                  ? 'cannot yet be determined'
                  : (d ?? 'recorded');
        return {
          done: ra != null,
          subtitle:
            ra != null
              ? ra.version === 3
                ? (ra as { warranted?: string; systems?: string[] }).warranted === 'yes'
                  ? `Repair Attempt Protocol · ${((ra as { systems?: string[] }).systems ?? [])
                      .map((s) => (s === 'roof' ? 'Roof' : 'Siding'))
                      .join(' · ') || 'recorded'}`
                  : (ra as { warranted?: string }).warranted === 'not_authorized'
                    ? 'Not authorized'
                    : 'Not warranted — discontinued'
                : ra.version === 2
                  ? (['roof', 'siding'] as const)
                      .filter((s) => ra[s])
                      .map((s) => `${s === 'roof' ? 'Roof' : 'Siding'}: ${detLabel(ra[s]?.determination)}`)
                      .join(' · ') || 'Assessment recorded'
                  : `Determination: ${detLabel(ra.determination)}`
              : 'Structured repairability question flow (optional — omits if skipped)',
        };
      }
      case 'mitigation':
        return {
          done: inspection!.temporaryRepairs != null,
          subtitle:
            inspection!.temporaryRepairs != null
              ? inspection!.temporaryRepairs.performed
                ? 'Temporary repairs documented'
                : 'No temporary repairs performed'
              : 'Emergency tarping / mitigation (optional)',
        };
      case 'existing_conditions':
        return {
          done: inspection!.existingOrUnrelatedConditions != null,
          subtitle:
            inspection!.existingOrUnrelatedConditions != null
              ? `${inspection!.existingOrUnrelatedConditions.length} condition${inspection!.existingOrUnrelatedConditions.length === 1 ? '' : 's'} excluded from claim`
              : 'Pre-existing conditions excluded from the claim (optional)',
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
      case 'summary': {
        // Non-blocking advisory step — done when a summary has been generated.
        const generatedAt = inspection!.aiSummary?.generatedAt;
        return {
          done: Boolean(generatedAt),
          subtitle: generatedAt
            ? `Generated ${new Date(generatedAt).toLocaleDateString()}`
            : 'Optional — Claude drafts a forensic narrative for review',
        };
      }
      case 'estimate': {
        // Non-blocking advisory step — done when an estimate has been saved.
        const estimate = inspection!.estimate;
        return {
          done: Boolean(estimate && estimate.lines.length > 0),
          subtitle:
            estimate && estimate.lines.length > 0
              ? `${estimate.lines.length} line item${estimate.lines.length === 1 ? '' : 's'} — subtotal $${(estimate.subtotalCents / 100).toFixed(2)}`
              : 'Optional — price the job from the company price book',
        };
      }
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
    <>
      {/* FTC cooling-off gate — shown whenever the rep opens the hub within
          3 business days of the FIPSA being signed. They can still proceed,
          but must explicitly acknowledge the warning. */}
      <Modal
        visible={coolingOffActive && !coolingOffDismissed}
        animationType="fade"
        transparent
        onRequestClose={() => setCoolingOffDismissed(true)}
      >
        <View style={styles.coolingOverlay}>
          <View style={[styles.coolingCard, { backgroundColor: colors.card }]}>
            <View style={styles.coolingIconWrap}>
              <Icon name="alert-triangle" size={28} color="#b45309" />
            </View>
            <Text style={[styles.coolingTitle, { color: colors.foreground }]}>
              FTC Cooling-Off Period
            </Text>
            <Text style={[styles.coolingBody, { color: colors.foreground }]}>
              The FTC Cooling-Off Period of this document is{' '}
              <Text style={{ fontWeight: '700' }}>3 days from signing</Text>. You are
              attempting to complete the Forensic Inspection prior to the end of the
              Federal Trade Commission's Cooling-Off Period.
            </Text>
            <Text style={[styles.coolingBody, { color: colors.foreground }]}>
              The homeowner has the right to cancel this agreement within 3 business days
              of signing without penalty.
            </Text>
            <View style={styles.coolingBtnRow}>
              <Pressable
                onPress={() =>
                  router.replace({
                    pathname: '/inspection-agreement',
                    params: { id },
                  } as never)
                }
                style={[styles.coolingBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Icon name="calendar" size={15} color={colors.foreground} />
                <Text style={[styles.coolingBtnText, { color: colors.foreground }]}>Schedule</Text>
              </Pressable>
              <Pressable
                onPress={() => setCoolingOffDismissed(true)}
                style={[styles.coolingBtn, { borderColor: '#ef4444', backgroundColor: '#fef2f2' }]}
              >
                <Icon name="play" size={15} color="#dc2626" />
                <Text style={[styles.coolingBtnText, { color: '#dc2626' }]}>Proceed</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
        {(inspection as unknown as { scheduledFor?: string | null }).scheduledFor ? (
          <View style={[styles.headerMetaRow, { marginTop: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }]}>
            <Icon name="calendar" size={13} color="#ffffff" />
            <Text style={[styles.headerMeta, { fontWeight: '700' }]}>
              {'  Phase 2: '}
              {new Date((inspection as unknown as { scheduledFor: string }).scheduledFor).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
              })}
            </Text>
          </View>
        ) : null}
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

      {applicableSteps(state.damageFlags).map((step) => {
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
    </>
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
  coolingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  coolingCard: {
    borderRadius: 18,
    padding: 24,
    gap: 12,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  coolingIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fffbeb',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 4,
  },
  coolingTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  coolingBody: { fontSize: 14, lineHeight: 21 },
  coolingBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  coolingBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  coolingBtnText: { fontSize: 14, fontWeight: '700' },
});

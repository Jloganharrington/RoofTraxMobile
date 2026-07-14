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
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { attestInspection } from '@/lib/inspectionSync';
import { isStageComplete, stageDeficiencies } from '@/lib/inspectionProtocolState';

const EQUIPMENT_ITEMS = [
  'Ladder',
  'Drone',
  'Chalk / crayon',
  'Moisture meter',
  'Camera / phone',
  'Fall protection',
];

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
        stage: 'S0',
        attestationType: 'equipment',
        details: { items: checked, confirmedAllPresent: allChecked },
      });
      setEquipmentDone(true);
    } finally {
      setSavingEquipment(false);
    }
  }

  const location = inspection?.address
    ? inspection.address
    : inspection?.latitude != null && inspection?.longitude != null
      ? `${inspection.latitude},${inspection.longitude}`
      : '';

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

      {/* S0 — Equipment attestation (B4) */}
      <Text style={[styles.section, { color: colors.foreground }]}>S0 · Equipment check</Text>
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

      {/* B5 — Storm of record */}
      <Text style={[styles.section, { color: colors.foreground }]}>Storm of record</Text>
      <StageCard
        icon="cloud"
        title={inspection.stormConfirmedRef ? 'Storm confirmed' : 'Confirm the storm'}
        subtitle={
          inspection.stormConfirmedRef
            ? `${inspection.stormConfirmedRef.type} · ${inspection.stormConfirmedRef.date}`
            : 'Match the claim to a severe-weather event'
        }
        done={!!inspection.stormConfirmedRef}
        onPress={() =>
          router.push({
            pathname: '/inspection-storm',
            params: {
              id,
              location,
              dateOfLoss: inspection.dateOfLoss ?? '',
            },
          })
        }
        colors={colors}
      />

      {/* Arrival (B6) — a pre-inspection step, NOT a protocol capture stage.
          The protocol's S1 is Elevations (see the Exterior capture section
          below), so this header must not carry an "S1" tag. */}
      <Text style={[styles.section, { color: colors.foreground }]}>Arrival</Text>
      <StageCard
        icon="navigation"
        title={inspection.arrivalConditions ? 'Arrival logged' : 'Log arrival'}
        subtitle={
          inspection.arrivalConditions
            ? `Recorded ${new Date(inspection.arrivalConditions.recordedAtUtc).toLocaleTimeString()}`
            : 'Verify you are on-site and note conditions'
        }
        done={!!inspection.arrivalConditions}
        onPress={() =>
          router.push({
            pathname: '/inspection-arrival',
            params: {
              id,
              latitude: inspection.latitude != null ? String(inspection.latitude) : '',
              longitude: inspection.longitude != null ? String(inspection.longitude) : '',
            },
          })
        }
        colors={colors}
      />

      {/* Exterior capture (M-C) */}
      <Text style={[styles.section, { color: colors.foreground }]}>Exterior capture</Text>

      {(() => {
        const s1Missing = stageDeficiencies(inspection, 'S1').length;
        const s3Missing = stageDeficiencies(inspection, 'S3').length;
        const s5Missing = stageDeficiencies(inspection, 'S5').length;
        const slopeCount = inspection.slopes?.length ?? 0;
        const damageCount = inspection.damageInstances?.length ?? 0;
        const componentCount = inspection.components?.length ?? 0;
        const penetrationCount = inspection.penetrations?.length ?? 0;
        const productCount = inspection.products?.length ?? 0;
        const unidentifiedProducts =
          inspection.products?.filter((p) => p.identificationMethod === 'unidentifiable').length ?? 0;
        const roofSlopeDone = isStageComplete(inspection, 'S2') && isStageComplete(inspection, 'S3');
        const blockers = [
          ...stageDeficiencies(inspection, 'S1'),
          ...stageDeficiencies(inspection, 'S2'),
          ...stageDeficiencies(inspection, 'S3'),
          ...stageDeficiencies(inspection, 'S5'),
        ];
        return (
          <>
            {blockers.length > 0 ? (
              <View style={[styles.gateCard, { backgroundColor: '#fffbeb', borderColor: '#f59e0b' }]}>
                <Icon name="alert-circle" size={18} color="#b45309" />
                <Text style={{ color: '#92400e', fontSize: 13, flex: 1 }}>
                  {blockers.length} capture gate{blockers.length === 1 ? '' : 's'} remaining before this
                  inspection can advance.
                </Text>
              </View>
            ) : (
              <View style={[styles.gateCard, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
                <Icon name="check" size={18} color={colors.success} />
                <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>
                  Exterior capture gates satisfied.
                </Text>
              </View>
            )}

            <StageCard
              icon="home"
              title="S1 · Elevation walk"
              subtitle={
                s1Missing === 0
                  ? 'All four elevations captured'
                  : `${4 - s1Missing} of 4 elevations captured`
              }
              done={s1Missing === 0}
              onPress={() => router.push({ pathname: '/inspection-elevations', params: { id } })}
              colors={colors}
            />

            <StageCard
              icon="navigation"
              title="S2 · S3 · Roof & slopes"
              subtitle={
                roofSlopeDone
                  ? `Roof access + ${slopeCount} slope${slopeCount === 1 ? '' : 's'} documented`
                  : slopeCount === 0
                    ? 'Roof access photo + slope inventory'
                    : `${s3Missing} slope${s3Missing === 1 ? '' : 's'} / roof access outstanding`
              }
              done={roofSlopeDone}
              onPress={() => router.push({ pathname: '/inspection-roof', params: { id } })}
              colors={colors}
            />

            <StageCard
              icon="clipboard"
              title="S5 · Collateral sweep"
              subtitle={
                damageCount === 0
                  ? 'Record collateral damage per elevation'
                  : s5Missing === 0
                    ? `${damageCount} instance${damageCount === 1 ? '' : 's'} — triads complete`
                    : `${s5Missing} instance${s5Missing === 1 ? '' : 's'} missing wide/mid/close`
              }
              done={damageCount > 0 && s5Missing === 0}
              onPress={() => router.push({ pathname: '/inspection-collateral', params: { id } })}
              colors={colors}
            />

            <StageCard
              icon="clipboard"
              title="Components & penetrations"
              subtitle={
                componentCount === 0 && penetrationCount === 0
                  ? 'Existing components, layer count, penetrations'
                  : `${componentCount} component${componentCount === 1 ? '' : 's'} · ${penetrationCount} penetration${penetrationCount === 1 ? '' : 's'}`
              }
              done={componentCount > 0}
              onPress={() => router.push({ pathname: '/inspection-components', params: { id } })}
              colors={colors}
            />

            <StageCard
              icon="camera"
              title="Product identification"
              subtitle={
                productCount === 0
                  ? 'Brand, exposure, granule & accessory close-ups'
                  : unidentifiedProducts > 0
                    ? `${productCount} product${productCount === 1 ? '' : 's'} · ${unidentifiedProducts} flagged for review`
                    : `${productCount} product${productCount === 1 ? '' : 's'} identified`
              }
              done={productCount > 0 && unidentifiedProducts === 0}
              onPress={() => router.push({ pathname: '/inspection-product', params: { id } })}
              colors={colors}
            />
          </>
        );
      })()}

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
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.stageCard, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
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
      <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
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

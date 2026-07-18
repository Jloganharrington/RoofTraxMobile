import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Inspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { inspectionsListKey, patchInspection } from '@/lib/inspectionSync';
import { closeupRolesFor, preliminaryPhotoSlots, selectedSurfaces, DAMAGE_TYPE_LABEL } from '@/lib/preliminary';

// Phase 1 (preliminary) capture hub. A light top-of-funnel flow: confirm the
// property + damage type, capture the 4 single-shot photos, confirm the storm,
// generate a homeowner report, and reach the P4 checkpoint where the inspector
// either advances the SAME record to forensic (Phase 2) or leaves it at a
// resumable "preliminary complete" checkpoint. Everything is offline-first.
export function PreliminaryHub({ inspection, id }: { inspection: Inspection; id: string }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [markingDone, setMarkingDone] = useState(false);

  const photos = inspection.photos ?? [];
  const surfaces = selectedSurfaces(inspection);
  const slotCount = preliminaryPhotoSlots(surfaces).length;
  const frontDone = photos.some((p) => p.preliminaryRole === 'front_of_home');
  const roofDone = photos.some((p) => p.preliminaryRole === 'roof_overview');
  // Close-ups are surface-tagged: every selected surface needs at least one
  // matching close-up (roof also accepts the legacy generic role), and the
  // single-surface flow captures two of that surface (as before).
  const closeupCountFor = (surface: (typeof surfaces)[number]) =>
    photos.filter(
      (p) => p.preliminaryRole && (closeupRolesFor(surface) as string[]).includes(p.preliminaryRole),
    ).length;
  const closeupsRequired = slotCount - 2;
  const closeupsDone =
    surfaces.length > 0 &&
    surfaces.every((s) => closeupCountFor(s) >= 1) &&
    (surfaces.length > 1 || closeupCountFor(surfaces[0]) >= 2);
  const closeupCaptured = Math.min(
    surfaces.reduce((sum, s) => sum + closeupCountFor(s), 0),
    closeupsRequired,
  );
  const capturedCount = (frontDone ? 1 : 0) + (roofDone ? 1 : 0) + closeupCaptured;
  const photosDone = frontDone && roofDone && closeupsDone;

  const stormDone = !!inspection.stormConfirmedRef;
  const damageDone = !!inspection.damageType && surfaces.length > 0;
  const completed = !!inspection.preliminaryCompletedAt;

  const location = inspection.address
    ? inspection.address
    : inspection.latitude != null && inspection.longitude != null
      ? `${inspection.latitude},${inspection.longitude}`
      : '';

  // Phase 1 cannot complete (nor advance to Phase 2) with zero damage
  // surfaces — they drive which measurement report gets ordered between the
  // phases. The server enforces the same rule on preliminaryCompletedAt.
  function requireSurfaces(): boolean {
    if (surfaces.length > 0) return true;
    Alert.alert(
      'Damage surface required',
      'Select at least one damage surface (roof, siding, or collateral) on the intake step first.',
    );
    return false;
  }

  async function markPreliminaryComplete() {
    if (!requireSurfaces()) return;
    setMarkingDone(true);
    try {
      // Carry the surface flags alongside the completion timestamp: the
      // server gates preliminaryCompletedAt on >=1 surface after merging the
      // incoming patch, so a self-sufficient patch can never be rejected on
      // offline replay (a bare patch could race a stale server row and dead-
      // letter in the outbox).
      await patchInspection(queryClient, id, {
        preliminaryCompletedAt: new Date().toISOString(),
        roofDamageFound: !!inspection.roofDamageFound,
        sidingDamageFound: !!inspection.sidingDamageFound,
        collateralDamageFound: !!inspection.collateralDamageFound,
      });
      await queryClient.invalidateQueries({ queryKey: inspectionsListKey() });
    } finally {
      setMarkingDone(false);
    }
  }

  function proceedToPhase2() {
    if (!requireSurfaces()) return;
    // Advance the SAME record: hand the forensic claim-intake screen this
    // inspection's id so it patches phase -> forensic in place (P0/P4),
    // carrying the Phase 1 property/damage/storm/photos already on the row.
    router.push({
      pathname: '/inspection-intake',
      params: {
        id,
        address: inspection.address ?? '',
        // Prefer the confirmed storm's date as the date of loss: if Phase 1
        // matched a storm, that storm IS the loss event.
        dateOfLoss: inspection.stormConfirmedRef?.date ?? inspection.dateOfLoss ?? '',
      },
    });
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={[styles.headerCard, { backgroundColor: colors.secondary }]}>
        <View style={styles.phasePill}>
          <Text style={styles.phasePillText}>PHASE 1 · PRELIMINARY</Text>
        </View>
        <Text style={styles.headerTitle}>{inspection.address ?? 'Preliminary inspection'}</Text>
        <Text style={styles.headerSub}>
          {inspection.damageType ? DAMAGE_TYPE_LABEL[inspection.damageType] ?? inspection.damageType : 'No damage type yet'}
        </Text>
      </View>

      <Text style={[styles.section, { color: colors.foreground }]}>Capture</Text>

      <Card
        icon="clipboard"
        title="Damage type & surfaces"
        subtitle={
          damageDone
            ? `${DAMAGE_TYPE_LABEL[inspection.damageType!] ?? inspection.damageType!} · ${surfaces
                .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                .join(', ')}`
            : !inspection.damageType
              ? 'Set the damage type and surface(s) for this property'
              : 'Select the damage surface(s) — roof, siding, or collateral'
        }
        done={damageDone}
        onPress={() =>
          router.push({
            pathname: '/inspection-preliminary-intake',
            params: {
              id,
              address: inspection.address ?? '',
              latitude: inspection.latitude != null ? String(inspection.latitude) : '',
              longitude: inspection.longitude != null ? String(inspection.longitude) : '',
              damageType: inspection.damageType ?? '',
              surfaces: surfaces.join(','),
            },
          })
        }
        colors={colors}
      />

      <Card
        icon="camera"
        title="Phase 1 photos"
        subtitle={
          photosDone
            ? `All ${slotCount} single-shot photos captured`
            : surfaces.length === 0
              ? 'Select the damage surface(s) first to unlock the close-up slots'
              : `${capturedCount} of ${slotCount} captured — front, roof, plus surface close-ups`
        }
        done={photosDone}
        onPress={() => router.push({ pathname: '/inspection-preliminary-photos', params: { id } })}
        colors={colors}
      />

      <Card
        icon="cloud"
        title={stormDone ? 'Storm confirmed' : 'Confirm the storm'}
        subtitle={
          stormDone
            ? `${inspection.stormConfirmedRef!.type} · ${inspection.stormConfirmedRef!.date}`
            : 'Match the property to a severe-weather event'
        }
        done={stormDone}
        onPress={() =>
          router.push({
            pathname: '/inspection-storm',
            params: { id, location, dateOfLoss: inspection.dateOfLoss ?? '' },
          })
        }
        colors={colors}
      />

      <Text style={[styles.section, { color: colors.foreground }]}>Homeowner</Text>
      <Card
        icon="clipboard"
        title="Homeowner report"
        subtitle="Damage found, the storm, and next steps — shareable on-device"
        done={false}
        onPress={() => router.push({ pathname: '/inspection-report', params: { id } })}
        colors={colors}
      />

      <Text style={[styles.section, { color: colors.foreground }]}>Checkpoint</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {completed ? (
          <View style={styles.doneRow}>
            <Icon name="check" size={18} color={colors.success} />
            <Text style={{ color: colors.foreground, fontWeight: '600', flex: 1 }}>
              Preliminary complete — resume any time to advance to Phase 2.
            </Text>
          </View>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            When Phase 1 is done, advance this record to a full forensic inspection, or mark it
            complete and come back to it later. It stays one record either way.
          </Text>
        )}

        <Pressable
          onPress={proceedToPhase2}
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
            Proceed to Phase 2 (forensic)
          </Text>
        </Pressable>

        {!completed ? (
          <Pressable
            onPress={markPreliminaryComplete}
            disabled={markingDone}
            style={[styles.secondaryBtn, { borderColor: colors.border, opacity: markingDone ? 0.6 : 1 }]}
          >
            {markingDone ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <Text style={{ color: colors.foreground, fontWeight: '600' }}>
                Mark preliminary complete
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function Card({
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
      <View style={[styles.stageIcon, { backgroundColor: done ? colors.success : colors.accent }]}>
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
  headerCard: { borderRadius: 16, padding: 18, gap: 4 },
  phasePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 4,
  },
  phasePillText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { fontSize: 15, fontWeight: '700' },
  secondaryBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
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
});

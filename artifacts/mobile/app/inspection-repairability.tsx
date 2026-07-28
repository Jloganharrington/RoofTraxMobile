import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useGetInspection, getGetInspectionQueryKey } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Repairability screen — clean slate.
//
// The previous structured question flows (asphalt / cedar / metal roof and
// siding) were removed pending a redesigned assessment. Only the
// "Repairability assessed on" system selection remains. Saving is disabled
// until the new question set exists: the API server still enforces the old
// flow rules, so a systems-only record would be rejected.
//
// Server validation (artifacts/api-server/src/lib/repairabilityRules.ts) and
// previously saved assessments are intentionally untouched.
// ---------------------------------------------------------------------------

export default function InspectionRepairabilityScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const existing = inspection?.repairabilityAssessment ?? null;

  const [systems, setSystems] = React.useState<Array<'roof' | 'siding'>>([]);
  const [hydrated, setHydrated] = React.useState(false);

  // Existing record: show its systems selection.
  React.useEffect(() => {
    if (existing && !hydrated) {
      const ex = existing as unknown as { version?: number; systems?: Array<'roof' | 'siding'> };
      if (ex.version === 2) setSystems(ex.systems ?? []);
      setHydrated(true);
    }
  }, [existing, hydrated]);

  // New assessments: pre-select the systems that already have marked damage
  // in the Facets / elevation sections. Editable by the rep.
  const autoSystemsApplied = React.useRef(false);
  React.useEffect(() => {
    if (!inspection || existing || autoSystemsApplied.current) return;
    autoSystemsApplied.current = true;
    const auto: Array<'roof' | 'siding'> = [];
    if ((inspection.slopes ?? []).some((s) => s.damagePresent)) auto.push('roof');
    if ((inspection.sidingFacets ?? []).some((f) => f.damaged)) auto.push('siding');
    if (auto.length > 0) setSystems(auto);
  }, [inspection, existing]);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Repairability' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Repairability' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Repairability' }} />

      <Text style={[styles.qLabel, { color: colors.foreground }]}>Repairability assessed on</Text>
      <View style={styles.chipWrap}>
        {(['roof', 'siding'] as const).map((sys) => {
          const on = systems.includes(sys);
          return (
            <Pressable
              key={sys}
              onPress={() => setSystems((s) => (on ? s.filter((x) => x !== sys) : [...s, sys]))}
              style={[
                styles.sysToggle,
                {
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primary : colors.card,
                },
              ]}
            >
              <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontWeight: '700' }}>
                {sys === 'roof' ? 'Roof' : 'Siding'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Icon name="tool" size={22} color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
          The repairability assessment questions are being rebuilt. Recording an assessment is
          temporarily unavailable.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  qLabel: { fontSize: 14, fontWeight: '600' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sysToggle: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
});

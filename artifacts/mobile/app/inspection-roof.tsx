import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { WHOLE_ROOF_LINEAR_TYPES } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { createMeasurement, createSlope } from '@/lib/inspectionSync';
import { buildProtocolState, stageDeficiencies } from '@/lib/inspectionProtocolState';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';

// Step 3 · Roof Facets (protocol v2). Facet-first: the inspector answers
// "How many facets does this roof have?" once, which seeds an editable
// F1..FXX facet list. Each facet row opens the facet detail screen (area,
// material, pitch, damage documentation). Whole-roof linears (ridge / hip /
// valley / eave / rake LF) are recorded here against the inspection itself.

const LINEAR_LABELS: Record<(typeof WHOLE_ROOF_LINEAR_TYPES)[number], string> = {
  ridge_lf: 'Ridge',
  hip_lf: 'Hip',
  valley_lf: 'Valley',
  eave_lf: 'Eave',
  rake_lf: 'Rake',
};

export default function InspectionRoofScreen() {
  const colors = useColors();
  // Approximate the native-stack header height (status bar inset + 44pt bar
  // on iOS) — @react-navigation/elements' useHeaderHeight can't be imported
  // directly without breaking Metro's resolution of the tab bar package.
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 44;
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  useNextSectionHeader(id, 'facets');

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  // Returning from the facet detail screen must always show the current
  // facet list — refetch on focus so the list can never render stale.
  const refetch = inspectionQuery.refetch;
  useFocusEffect(
    React.useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const [facetCount, setFacetCount] = React.useState('');
  const [seeding, setSeeding] = React.useState(false);
  const [addingFacet, setAddingFacet] = React.useState(false);
  const [linearDrafts, setLinearDrafts] = React.useState<Record<string, string>>({});
  const [savingLinear, setSavingLinear] = React.useState<string | null>(null);

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
  const facets = inspection.slopes ?? [];
  const facetById = new Map(state.facets.map((f) => [f.id, f]));
  const remaining = stageDeficiencies(inspection, 'facets').length;
  const measurements = inspection.measurements ?? [];
  const linearsByType = new Map(
    measurements
      .filter((m) => m.subjectType !== 'slope')
      .map((m) => [m.measurementType, m.value] as const),
  );

  // Next facet label: F{n} past the highest existing F-number.
  function nextFacetLabel(offset = 0): string {
    const max = facets.reduce((acc, facet) => {
      const match = /^F(\d+)$/.exec(facet.label);
      return match ? Math.max(acc, Number(match[1])) : acc;
    }, 0);
    return `F${max + 1 + offset}`;
  }

  async function seedFacets() {
    const count = Number(facetCount);
    if (!Number.isInteger(count) || count < 1 || count > 40 || seeding) return;
    setSeeding(true);
    try {
      for (let i = 0; i < count; i += 1) {
        // Sequential (not parallel) so F-numbers assign deterministically.
        // eslint-disable-next-line no-await-in-loop
        await createSlope(queryClient, id, { label: `F${i + 1}` });
      }
      setFacetCount('');
    } finally {
      setSeeding(false);
    }
  }

  async function addFacet() {
    if (addingFacet) return;
    setAddingFacet(true);
    try {
      const slopeId = await createSlope(queryClient, id, { label: nextFacetLabel() });
      router.push({ pathname: '/inspection-facet', params: { id, slopeId } });
    } finally {
      setAddingFacet(false);
    }
  }

  async function saveLinear(type: string) {
    const raw = (linearDrafts[type] ?? '').trim();
    const value = Number(raw);
    // 0 is a legitimate whole-roof linear (e.g. a roof with no valleys) —
    // only empty, non-numeric, or negative entries are rejected.
    if (!raw || Number.isNaN(value) || value < 0 || savingLinear) return;
    setSavingLinear(type);
    try {
      await createMeasurement(queryClient, id, {
        subjectType: 'inspection',
        subjectId: null,
        measurementType: type,
        value,
        unit: 'lf',
      });
      setLinearDrafts((prev) => ({ ...prev, [type]: '' }));
    } finally {
      setSavingLinear(null);
    }
  }

  const facetComplete = (facetId: string): boolean => {
    const facet = facetById.get(facetId);
    if (!facet) return false;
    if (!(facet.hasArea && facet.hasMaterial && facet.hasPitch)) return false;
    if (!facet.damagePresent) return true;
    const records = state.damageInstances.filter((d) => d.slopeId === facetId);
    return records.length > 0 && records.every((d) => d.photoCaptured);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // Without this offset the avoiding view thinks the screen starts at the
      // very top of the display, so it under-shifts by exactly the height of
      // the navigation header and the focused input stays behind the keyboard.
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {facets.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              How many facets does this roof have?
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Every distinct roof plane is a facet. This seeds an F1…F{'{n}'} list you can edit —
              add or remove facets at any time.
            </Text>
            <TextInput
              value={facetCount}
              onChangeText={setFacetCount}
              placeholder="e.g. 4"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            />
            <Pressable
              onPress={seedFacets}
              disabled={seeding || !facetCount.trim()}
              style={[styles.addBtn, { backgroundColor: colors.primary, opacity: seeding || !facetCount.trim() ? 0.5 : 1 }]}
            >
              {seeding ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.addText, { color: colors.primaryForeground }]}>Create facet list</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={[styles.section, { color: colors.foreground }]}>
              Facets ({facets.length})
            </Text>
            {facets.map((facet) => {
              const done = facetComplete(facet.id);
              const info = facetById.get(facet.id);
              const missing: string[] = [];
              if (info && !info.hasArea) missing.push('area');
              if (info && !info.hasMaterial) missing.push('material');
              if (info && !info.hasPitch) missing.push('pitch');
              return (
                <Pressable
                  key={facet.id}
                  onPress={() =>
                    router.push({ pathname: '/inspection-facet', params: { id, slopeId: facet.id } })
                  }
                  style={[styles.row, { backgroundColor: colors.card, borderColor: done ? colors.success : colors.border }]}
                >
                  <View style={[styles.badge, { backgroundColor: done ? colors.success : colors.accent }]}>
                    <Icon name={done ? 'check' : 'clipboard'} size={18} color={done ? '#fff' : colors.secondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{facet.label}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      {done
                        ? `Documented${facet.damagePresent ? ` · ${facet.damageType ?? 'damage'}` : ' · no damage'}`
                        : missing.length > 0
                          ? `Needs ${missing.join(', ')}`
                          : facet.damagePresent
                            ? 'Damage documentation incomplete'
                            : 'Tap to document'}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
                </Pressable>
              );
            })}
            <Pressable
              onPress={addFacet}
              disabled={addingFacet}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, borderStyle: 'dashed' }]}
            >
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                {addingFacet ? (
                  <ActivityIndicator color={colors.secondary} />
                ) : (
                  <Icon name="plus" size={18} color={colors.secondary} />
                )}
              </View>
              <Text style={[styles.rowTitle, { color: colors.foreground, flex: 1 }]}>Add facet</Text>
            </Pressable>

            {/* Whole-roof linears */}
            <Text style={[styles.section, { color: colors.foreground }]}>Whole-roof linears (LF)</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Recorded once for the whole roof — at least one linear is required.
            </Text>
            {WHOLE_ROOF_LINEAR_TYPES.map((type) => {
              const saved = linearsByType.get(type);
              return (
                <View
                  key={type}
                  style={[styles.linearRow, { backgroundColor: colors.card, borderColor: saved != null ? colors.success : colors.border }]}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '600', width: 64 }}>
                    {LINEAR_LABELS[type]}
                  </Text>
                  {saved != null ? (
                    <Text style={{ color: colors.success, fontWeight: '700', flex: 1 }}>
                      {saved} lf recorded
                    </Text>
                  ) : (
                    <>
                      <TextInput
                        value={linearDrafts[type] ?? ''}
                        onChangeText={(v) => setLinearDrafts((prev) => ({ ...prev, [type]: v }))}
                        placeholder="0"
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="decimal-pad"
                        style={[styles.linearInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                      />
                      <Pressable
                        onPress={() => saveLinear(type)}
                        disabled={savingLinear === type}
                        style={[styles.linearSave, { backgroundColor: colors.primary, opacity: savingLinear === type ? 0.5 : 1 }]}
                      >
                        {savingLinear === type ? (
                          <ActivityIndicator color={colors.primaryForeground} size="small" />
                        ) : (
                          <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save</Text>
                        )}
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })}

            <Text style={{ color: remaining === 0 ? colors.success : colors.mutedForeground, fontSize: 13, marginTop: 4 }}>
              {remaining === 0
                ? 'Facet documentation complete.'
                : `${remaining} item${remaining === 1 ? '' : 's'} still required on this step.`}
            </Text>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10, marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  addBtn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  addText: { fontSize: 15, fontWeight: '700' },
  linearRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  linearInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  linearSave: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
});

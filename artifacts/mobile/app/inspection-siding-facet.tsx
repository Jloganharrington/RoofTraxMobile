import React from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import {
  SIDING_COMPONENT_ACTIONS,
  SIDING_DAMAGE_TYPES,
  type SidingComponentAction,
  type SidingDamageType,
} from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { deleteSidingFacet, updateSidingFacet } from '@/lib/inspectionSync';
import { buildProtocolState } from '@/lib/inspectionProtocolState';

// Siding facet detail (protocol v2.1). One siding surface:
// - "Is there damage?" Yes/No → damage type + damage photo(s) when Yes.
// - Facet overview photo — always required.
// - Components S{n}C1…S{n}Ck via a (−) N (+) stepper; each component needs
//   its own photo and a disposition (Detach & Reset / Remove & Replace).
// Photos route through the shared capture screen tagged subjectType
// 'siding_facet' + sidingRole (+ sidingComponentIndex for component shots)
// so the gate discriminates shots deterministically.

const DAMAGE_TYPE_LABELS: Record<SidingDamageType, string> = {
  wind: 'Wind',
  hail: 'Hail',
  tree: 'Tree',
};

const COMPONENT_ACTION_LABELS: Record<SidingComponentAction, string> = {
  detach_reset: 'Detach & Reset',
  remove_replace: 'Remove & Replace',
};

type FacetComponent = { action?: SidingComponentAction | null };

export default function InspectionSidingFacetScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id, sidingFacetId } = useLocalSearchParams<{ id: string; sidingFacetId: string }>();

  const inspectionQuery = useGetInspection(id, {
    // Same optimistic-cache race guard as the roof facet detail: a fresh
    // refetch right after "Add facet" could overwrite the optimistic row
    // before the outbox drains, flashing "Facet not found".
    query: { queryKey: getGetInspectionQueryKey(id), staleTime: 15_000 },
  });
  const inspection = inspectionQuery.data?.inspection;
  const facet = inspection?.sidingFacets?.find((f) => f.id === sidingFacetId);

  const [removing, setRemoving] = React.useState(false);
  const [componentBusy, setComponentBusy] = React.useState(false);

  // Pre-existing / excluded conditions local state — hydrated from the facet
  // row once, then kept in sync via immediate saves on add/remove.
  const [preExistingConditions, setPreExistingConditions] = React.useState<string[]>([]);
  const [preExistingHydrated, setPreExistingHydrated] = React.useState(false);

  React.useEffect(() => {
    if (facet && !preExistingHydrated) {
      const existing = (facet.preExistingConditions ?? []) as Array<{ note: string }>;
      setPreExistingConditions(existing.map((c) => c.note));
      setPreExistingHydrated(true);
    }
  }, [facet, preExistingHydrated]);

  if ((inspectionQuery.isLoading || inspectionQuery.isFetching) && !facet) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection || !facet) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Facet not found.</Text>
      </View>
    );
  }

  const state = buildProtocolState(inspection);
  const facetState = state.sidingFacets.find((f) => f.id === sidingFacetId);
  const damaged = Boolean(facet.damaged);
  const damageType = (facet.damageType as SidingDamageType | null) ?? null;
  const isolated = (facet.isolated as boolean | null) ?? null;
  const components = ((facet.components ?? []) as FacetComponent[]);

  const facetPhotoDone = facetState?.facetPhotoCaptured ?? false;
  const damagePhotoCount = facetState?.damagePhotoCount ?? 0;

  async function setDamaged(value: boolean) {
    if (!facet || damaged === value) return;
    // Answering "No" clears the type so the gate doesn't hold a stale
    // requirement against a facet marked undamaged.
    await updateSidingFacet(queryClient, id, sidingFacetId, {
      damaged: value,
      ...(value ? {} : { damageType: null }),
    });
  }

  async function setDamageType(type: SidingDamageType) {
    await updateSidingFacet(queryClient, id, sidingFacetId, { damageType: type });
  }

  async function setIsolated(value: boolean) {
    if (isolated === value) return;
    await updateSidingFacet(queryClient, id, sidingFacetId, { isolated: value });
  }

  async function setComponents(next: FacetComponent[]) {
    if (componentBusy) return;
    setComponentBusy(true);
    try {
      await updateSidingFacet(queryClient, id, sidingFacetId, {
        components: next.map((c) => ({ action: c.action ?? null })),
      });
    } finally {
      setComponentBusy(false);
    }
  }

  async function setComponentAction(index: number, action: SidingComponentAction) {
    const next = components.map((c, i) => (i === index ? { ...c, action } : c));
    await setComponents(next);
  }

  // Pre-existing conditions helpers
  function addCondition() {
    setPreExistingConditions((prev) => [...prev, '']);
  }

  function updateConditionText(index: number, text: string) {
    setPreExistingConditions((prev) => prev.map((n, i) => (i === index ? text : n)));
  }

  async function saveConditionsArray(notes: string[]) {
    const cleaned = notes.map((n) => n.trim()).filter((n) => n !== '');
    await updateSidingFacet(queryClient, id, sidingFacetId, {
      preExistingConditions: cleaned.map((note) => ({ note })),
    });
  }

  async function removeCondition(index: number) {
    const next = preExistingConditions.filter((_, i) => i !== index);
    setPreExistingConditions(next);
    await saveConditionsArray(next);
  }

  function capture(
    role: 'damage' | 'facet' | 'component',
    caption: string,
    title: string,
    componentIndex?: number,
  ) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'siding_facet',
        subjectId: sidingFacetId,
        roles: 'wide',
        stage: 'siding',
        sidingRole: role,
        ...(componentIndex ? { sidingComponentIndex: String(componentIndex) } : {}),
        caption,
        title,
      },
    });
  }

  function confirmRemove() {
    Alert.alert('Remove facet', `Remove ${facet?.label}? Its photos stay on file.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemoving(true);
          try {
            await deleteSidingFacet(queryClient, id, sidingFacetId);
            router.back();
          } finally {
            setRemoving(false);
          }
        },
      },
    ]);
  }

  function yesNoRow(
    value: boolean | null,
    onSelect: (v: boolean) => void,
  ): React.ReactElement {
    return (
      <View style={styles.chipRow}>
        {([true, false] as const).map((v) => {
          const selected = value === v;
          return (
            <Pressable
              key={String(v)}
              onPress={() => onSelect(v)}
              style={[
                styles.yesNo,
                {
                  backgroundColor: selected ? colors.primary : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color: selected ? colors.primaryForeground : colors.foreground,
                  fontWeight: '700',
                }}
              >
                {v ? 'Yes' : 'No'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.heading, { color: colors.foreground }]}>{facet.label}</Text>

      {/* Damage — explicit Yes/No question */}
      <Text style={[styles.section, { color: colors.foreground }]}>
        Is there damage to this facet?
      </Text>
      {yesNoRow(damaged, (v) => void setDamaged(v))}

      {damaged ? (
        <>
          <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Damage type</Text>
          <View style={styles.chipRow}>
            {SIDING_DAMAGE_TYPES.map((type) => {
              const selected = damageType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => void setDamageType(type)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontWeight: '600' }}>
                    {DAMAGE_TYPE_LABELS[type]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* Damage photos — multi-photo strip */}
          <View style={styles.photoSectionHeader}>
            <Text style={[styles.subLabel, { color: colors.mutedForeground, marginTop: 0 }]}>
              {`Damage photos${damagePhotoCount > 0 ? ` (${damagePhotoCount})` : ''}`}
            </Text>
            {damagePhotoCount === 0 && (
              <Text style={{ color: colors.destructive, fontSize: 12, fontWeight: '600' }}>Required</Text>
            )}
          </View>
          <View style={styles.photoStrip}>
            {Array.from({ length: damagePhotoCount }, (_, i) => (
              <View
                key={i}
                style={[styles.photoChip, { backgroundColor: colors.success, borderColor: colors.success }]}
              >
                <Icon name="check" size={13} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                  {`Photo ${i + 1}`}
                </Text>
              </View>
            ))}
            <Pressable
              onPress={() => capture('damage', `${facet.label} Damage`, `${facet.label} damage photo ${damagePhotoCount + 1}`)}
              style={[
                styles.photoChip,
                styles.photoChipAdd,
                { borderColor: damagePhotoCount === 0 ? colors.destructive : colors.primary },
              ]}
            >
              <Icon name="camera" size={13} color={damagePhotoCount === 0 ? colors.destructive : colors.primary} />
              <Text
                style={{
                  color: damagePhotoCount === 0 ? colors.destructive : colors.primary,
                  fontSize: 12,
                  fontWeight: '700',
                }}
              >
                {damagePhotoCount === 0 ? 'Add photo' : 'Add another'}
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* Isolated facet — Yes/No */}
      <Text style={[styles.section, { color: colors.foreground }]}>
        Is this an isolated Siding Facet?
      </Text>
      {yesNoRow(isolated, (v) => void setIsolated(v))}

      {/* Facet overview photo — always required */}
      <Text style={[styles.section, { color: colors.foreground }]}>Facet photo</Text>
      <Pressable
        onPress={() => capture('facet', `${facet.label} Facet`, `${facet.label} facet photo`)}
        style={[styles.row, { backgroundColor: colors.card, borderColor: facetPhotoDone ? colors.success : colors.border }]}
      >
        <View style={[styles.badge, { backgroundColor: facetPhotoDone ? colors.success : colors.accent }]}>
          <Icon name={facetPhotoDone ? 'check' : 'camera'} size={18} color={facetPhotoDone ? '#fff' : colors.secondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>Overview photo</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            {facetPhotoDone ? 'Captured — tap to retake' : 'One wide shot of the whole facet'}
          </Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
      </Pressable>

      {/* Components — (−) N (+) stepper, rows S{n}C1…S{n}Ck */}
      <View style={styles.headerRow}>
        <Text style={[styles.section, { color: colors.foreground, marginTop: 0 }]}>Components</Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => void setComponents(components.slice(0, -1))}
            disabled={componentBusy || components.length === 0}
            hitSlop={8}
            style={[
              styles.stepBtn,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: components.length === 0 ? 0.4 : 1 },
            ]}
          >
            <Icon name="minus" size={18} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.stepCount, { color: colors.foreground }]}>{components.length}</Text>
          <Pressable
            onPress={() => void setComponents([...components, { action: null }])}
            disabled={componentBusy || components.length >= 40}
            hitSlop={8}
            style={[styles.stepBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Icon name="plus" size={18} color={colors.foreground} />
          </Pressable>
        </View>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
        Shutters, light fixtures, vents, downspouts… Each component needs a photo and a
        disposition.
      </Text>

      {components.map((component, i) => {
        const index = i + 1;
        const label = `${facet.label}C${index}`;
        const compState = facetState?.components?.[i];
        const photoDone = compState?.photoCaptured ?? false;
        const action = component.action ?? null;
        return (
          <View
            key={index}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>{label}</Text>
            <View style={styles.chipRow}>
              {SIDING_COMPONENT_ACTIONS.map((a) => {
                const selected = action === a;
                return (
                  <Pressable
                    key={a}
                    onPress={() => void setComponentAction(i, a)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? colors.primary : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontWeight: '600', fontSize: 13 }}>
                      {COMPONENT_ACTION_LABELS[a]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => capture('component', `${label}`, `${label} photo`, index)}
              style={[styles.photoRow, { backgroundColor: colors.background, borderColor: photoDone ? colors.success : colors.border }]}
            >
              <View style={[styles.smallBadge, { backgroundColor: photoDone ? colors.success : colors.accent }]}>
                <Icon name={photoDone ? 'check' : 'camera'} size={16} color={photoDone ? '#fff' : colors.secondary} />
              </View>
              <Text style={{ color: colors.foreground, fontWeight: '600', flex: 1 }}>
                {photoDone ? 'Photo captured — tap to retake' : 'Photo required'}
              </Text>
              <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        );
      })}

      {/* Pre-existing / Excluded Conditions */}
      <Text style={[styles.section, { color: colors.foreground }]}>
        Pre-existing / Excluded Conditions
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
        Document anything on this facet you are NOT claiming — granule loss, old caulking, prior
        repairs. Showing what's excluded is what makes the rest of the claim credible.
      </Text>

      {preExistingConditions.map((note, i) => (
        <View key={i} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 13 }}>
              {`Condition ${i + 1}`}
            </Text>
            <Pressable onPress={() => void removeCondition(i)} hitSlop={8}>
              <Icon name="trash-2" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <TextInput
            value={note}
            onChangeText={(v) => updateConditionText(i, v)}
            onBlur={() => void saveConditionsArray(preExistingConditions)}
            placeholder="e.g. Granule loss near ridge — thermal, not impact"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[
              styles.conditionInput,
              { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
            ]}
          />
        </View>
      ))}

      <Pressable
        onPress={addCondition}
        style={[styles.addConditionBtn, { borderColor: colors.border }]}
      >
        <Icon name="plus" size={16} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 14 }}>Add condition</Text>
      </Pressable>

      {/* Remove */}
      <Pressable
        onPress={confirmRemove}
        disabled={removing}
        style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}
      >
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          {removing ? (
            <ActivityIndicator color={colors.destructive} />
          ) : (
            <Icon name="trash-2" size={18} color={colors.destructive} />
          )}
        </View>
        <Text style={[styles.rowTitle, { color: colors.destructive, flex: 1 }]}>Remove this facet</Text>
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  heading: { fontSize: 22, fontWeight: '800' },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  subLabel: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  smallBadge: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
  yesNo: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 28 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  photoSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  photoStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5 },
  photoChipAdd: { borderStyle: 'dashed' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepCount: { fontSize: 17, fontWeight: '800', minWidth: 24, textAlign: 'center' },
  conditionInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    minHeight: 68,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  addConditionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});

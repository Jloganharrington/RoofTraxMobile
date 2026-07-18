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
import { SIDING_DAMAGE_TYPES, type SidingDamageType } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { deleteSidingFacet, updateSidingFacet } from '@/lib/inspectionSync';
import { buildProtocolState } from '@/lib/inspectionProtocolState';

// Siding facet detail (protocol v2.1). One siding surface: damaged? → damage
// type + damage photo(s); a facet overview photo is always required; then a
// component count with one photo per component. Photos route through the
// shared capture screen tagged subjectType 'siding_facet' + a sidingRole so
// the gate discriminates damage/facet/component shots deterministically.

const DAMAGE_TYPE_LABELS: Record<SidingDamageType, string> = {
  wind: 'Wind',
  hail: 'Hail',
  tree: 'Tree',
};

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

  const [countDraft, setCountDraft] = React.useState<string | null>(null);
  const [savingCount, setSavingCount] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

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
  const componentCount = facet.componentCount ?? 0;
  const countValue = countDraft ?? (componentCount > 0 ? String(componentCount) : '');
  const countNum = Number(countValue);
  const countValid = countValue.trim() === '' || (Number.isInteger(countNum) && countNum >= 0);
  const countDirty = countValue !== (componentCount > 0 ? String(componentCount) : '');

  const facetPhotoDone = facetState?.facetPhotoCaptured ?? false;
  const damagePhotoCount = facetState?.damagePhotoCount ?? 0;
  const componentPhotoCount = facetState?.componentPhotoCount ?? 0;

  async function toggleDamaged() {
    if (!facet) return;
    // Turning damage off clears the type so the gate doesn't hold a stale
    // requirement against a facet marked undamaged.
    await updateSidingFacet(queryClient, id, sidingFacetId, {
      damaged: !damaged,
      ...(damaged ? { damageType: null } : {}),
    });
  }

  async function setDamageType(type: SidingDamageType) {
    await updateSidingFacet(queryClient, id, sidingFacetId, { damageType: type });
  }

  async function saveCount() {
    if (!countValid || savingCount) return;
    setSavingCount(true);
    try {
      await updateSidingFacet(queryClient, id, sidingFacetId, {
        componentCount: countValue.trim() ? countNum : 0,
      });
    } finally {
      setSavingCount(false);
    }
  }

  function capture(role: 'damage' | 'facet' | 'component', caption: string, title: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'siding_facet',
        subjectId: sidingFacetId,
        roles: 'wide',
        stage: 'siding',
        sidingRole: role,
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.heading, { color: colors.foreground }]}>{facet.label}</Text>

        {/* Damage */}
        <Text style={[styles.section, { color: colors.foreground }]}>Damage on this facet</Text>
        <Pressable
          onPress={toggleDamaged}
          style={[
            styles.row,
            {
              backgroundColor: colors.card,
              borderColor: damaged ? colors.primary : colors.border,
              borderWidth: damaged ? 2 : 1,
            },
          ]}
        >
          <View style={[styles.badge, { backgroundColor: damaged ? colors.primary : colors.accent }]}>
            <Icon name={damaged ? 'check' : 'alert-circle'} size={18} color={damaged ? '#fff' : colors.secondary} />
          </View>
          <Text style={[styles.rowTitle, { color: colors.foreground, flex: 1 }]}>
            {damaged ? 'Damage present' : 'No damage on this facet'}
          </Text>
        </Pressable>

        {damaged ? (
          <>
            <View style={styles.chipRow}>
              {SIDING_DAMAGE_TYPES.map((type) => {
                const selected = damageType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => setDamageType(type)}
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
            <Pressable
              onPress={() => capture('damage', `${facet.label} Damage`, `${facet.label} damage photo`)}
              style={[styles.row, { backgroundColor: colors.card, borderColor: damagePhotoCount > 0 ? colors.success : colors.border }]}
            >
              <View style={[styles.badge, { backgroundColor: damagePhotoCount > 0 ? colors.success : colors.accent }]}>
                <Icon name={damagePhotoCount > 0 ? 'check' : 'camera'} size={18} color={damagePhotoCount > 0 ? '#fff' : colors.secondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>Damage photos</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  {damagePhotoCount > 0
                    ? `${damagePhotoCount} captured — tap to add more`
                    : 'At least one damage close-up required'}
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
            </Pressable>
          </>
        ) : null}

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

        {/* Components */}
        <Text style={[styles.section, { color: colors.foreground }]}>Components</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
          Shutters, light fixtures, vents, downspouts… Each counted component needs its own photo.
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Component count</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={countValue}
              onChangeText={setCountDraft}
              placeholder="0"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, flex: 1 }]}
            />
            <Pressable
              onPress={saveCount}
              disabled={!countDirty || !countValid || savingCount}
              style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: !countDirty || !countValid || savingCount ? 0.5 : 1 }]}
            >
              {savingCount ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
        {componentCount > 0 ? (
          <Pressable
            onPress={() =>
              capture(
                'component',
                `${facet.label} Component ${Math.min(componentPhotoCount + 1, componentCount)}`,
                `${facet.label} component photo`,
              )
            }
            style={[styles.row, { backgroundColor: colors.card, borderColor: componentPhotoCount >= componentCount ? colors.success : colors.border }]}
          >
            <View style={[styles.badge, { backgroundColor: componentPhotoCount >= componentCount ? colors.success : colors.accent }]}>
              <Icon
                name={componentPhotoCount >= componentCount ? 'check' : 'camera'}
                size={18}
                color={componentPhotoCount >= componentCount ? '#fff' : colors.secondary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Component photos</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {componentPhotoCount >= componentCount
                  ? `All ${componentCount} captured`
                  : `${componentPhotoCount} of ${componentCount} captured — tap for the next`}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : null}

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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  saveBtn: { paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
});

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
import { FACET_DAMAGE_TYPES, type FacetDamageType } from '@workspace/protocol';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { createDamageInstance, deleteSlope, updateSlope } from '@/lib/inspectionSync';
import { buildProtocolState } from '@/lib/inspectionProtocolState';

// Facet detail (Step 3 · Roof Facets, protocol v2). One roof plane: area,
// material, pitch (rise:run — a pitch steeper than 8/12 triggers the steep
// adder note), then damage documentation. When damage is present the
// inspector picks the damage type and records each damage instance with a
// photo captioned `F{n}-Damage {k}`. Facets are removable — the list is
// never fixed.

// The two independently toggleable tie-in flags (multi-select).
const TIE_IN_OPTIONS = ['valley', 'hip_ridge'] as const;
const TIE_IN_LABELS: Record<(typeof TIE_IN_OPTIONS)[number], string> = {
  valley: 'Valley',
  hip_ridge: 'Hip/Ridge',
};

// Chalk-marking instructions shown once, when the rep first selects a
// tie-in protocol on this facet.
const TIE_IN_INSTRUCTIONS: Record<(typeof TIE_IN_OPTIONS)[number], string[]> = {
  valley: [
    "Mark a 3' solid line down the center of the valley.",
    'Using your tape measurer, chalk dotted lines 18" parallel to the center line on both sides of the valley.',
  ],
  hip_ridge: [
    "Mark a solid line, 3' long at the center of the ridge/hip.",
    'Measure 6" from this line and mark a dotted line on each side of the ridge/hip.',
  ],
};

const DAMAGE_TYPE_LABELS: Record<FacetDamageType, string> = {
  hail: 'Hail',
  wind: 'Wind',
  hail_and_wind: 'Hail & Wind',
  none: 'None',
};

export default function InspectionFacetScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id, slopeId } = useLocalSearchParams<{ id: string; slopeId: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const facet = inspection?.slopes?.find((slope) => slope.id === slopeId);

  const [area, setArea] = React.useState<string | null>(null);
  const [material, setMaterial] = React.useState<string | null>(null);
  const [pitch, setPitch] = React.useState<string | null>(null);
  const [savingDetails, setSavingDetails] = React.useState(false);
  const [addingDamage, setAddingDamage] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  // Which tie-in option was just selected for the first time this session —
  // drives the one-time instructions + photo-capture prompt.
  const [tieInPrompt, setTieInPrompt] = React.useState<{ valley: boolean; hip_ridge: boolean }>({
    valley: false,
    hip_ridge: false,
  });

  if (inspectionQuery.isLoading && !inspection) {
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

  // Draft values fall back to the stored row so reopening shows saved facts.
  const areaValue = area ?? (facet.areaSqft != null ? String(facet.areaSqft) : '');
  const materialValue = material ?? (facet.materialType ?? '');
  // Pitch is always {rise}/12; stored run stays 12, only rise is edited.
  const pitchValue = pitch ?? (facet.pitchRise != null ? String(facet.pitchRise) : '');
  const pitchNum = Number(pitchValue);
  const steep = pitchValue.trim() !== '' && !Number.isNaN(pitchNum) && pitchNum > 8;

  const state = buildProtocolState(inspection);
  const damageRecords = state.damageInstances.filter((d) => d.slopeId === slopeId);
  const damagePresent = Boolean(facet.damagePresent);
  const damageType = (facet.damageType as FacetDamageType | null) ?? null;

  const detailsDirty =
    areaValue !== (facet.areaSqft != null ? String(facet.areaSqft) : '') ||
    materialValue !== (facet.materialType ?? '') ||
    pitchValue !== (facet.pitchRise != null ? String(facet.pitchRise) : '');
  const detailsValid =
    (areaValue.trim() === '' || !Number.isNaN(Number(areaValue))) &&
    (pitchValue.trim() === '' || !Number.isNaN(pitchNum));

  async function saveDetails() {
    if (!detailsValid || savingDetails) return;
    setSavingDetails(true);
    try {
      await updateSlope(queryClient, id, slopeId, {
        areaSqft: areaValue.trim() ? Number(areaValue) : null,
        materialType: materialValue.trim() || null,
        pitchRise: pitchValue.trim() ? pitchNum : null,
        pitchRun: pitchValue.trim() ? 12 : null,
      });
    } finally {
      setSavingDetails(false);
    }
  }

  // Each button toggles its own boolean flag independently. Turning an
  // option ON surfaces its marking instructions + photo capture (first
  // selection only); turning it OFF dismisses them.
  async function toggleTieIn(option: (typeof TIE_IN_OPTIONS)[number]) {
    if (!facet) return;
    const turningOn = option === 'valley' ? !facet.tieInValley : !facet.tieInHipRidge;
    setTieInPrompt((prev) => ({ ...prev, [option]: turningOn }));
    await updateSlope(
      queryClient,
      id,
      slopeId,
      option === 'valley'
        ? { tieInValley: !facet.tieInValley }
        : { tieInHipRidge: !facet.tieInHipRidge },
    );
  }

  function captureTieInPhoto(option: (typeof TIE_IN_OPTIONS)[number]) {
    if (!facet) return;
    setTieInPrompt((prev) => ({ ...prev, [option]: false }));
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'slope',
        subjectId: slopeId,
        roles: 'wide',
        stage: 'facets',
        title: `${facet.label} Tie-In: ${TIE_IN_LABELS[option]}`,
      },
    });
  }

  async function setDamage(type: FacetDamageType) {
    await updateSlope(queryClient, id, slopeId, {
      damageType: type,
      damagePresent: type !== 'none',
    });
  }

  async function addDamageRecord() {
    if (addingDamage || !damageType || damageType === 'none' || !facet) return;
    setAddingDamage(true);
    try {
      const k = damageRecords.length + 1;
      const damageId = await createDamageInstance(queryClient, id, {
        slopeId,
        damageType,
      });
      router.push({
        pathname: '/inspection-photo-capture',
        params: {
          inspectionId: id,
          subjectType: 'damage_instance',
          subjectId: damageId,
          roles: 'wide',
          stage: 'facets',
          title: `${facet.label}-Damage ${k}`,
        },
      });
    } finally {
      setAddingDamage(false);
    }
  }

  // Saves any unsaved detail edits, then returns to the facet list so the
  // rep can proceed to the next facet. Photos and toggles are already
  // persisted as they happen — this is the explicit "done with this facet"
  // exit, so nothing is lost by leaving.
  async function saveFacetAndReturn() {
    if (savingDetails) return;
    if (detailsDirty && detailsValid) {
      await saveDetails();
    }
    router.back();
  }

  function confirmRemove() {
    Alert.alert('Remove facet', `Remove ${facet?.label}? Its damage records stay on file.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemoving(true);
          try {
            await deleteSlope(queryClient, id, slopeId);
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

        {/* Details */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.pitchRow}>
            <View style={{ flex: 1.2 }}>
              <Field label="Area (sq ft)" value={areaValue} onChange={setArea} placeholder="320" keyboardType="numeric" colors={colors} />
            </View>
            <View style={{ flex: 1.4 }}>
              <Field label="Material" value={materialValue} onChange={setMaterial} placeholder="Asphalt" colors={colors} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Pitch (/12)" value={pitchValue} onChange={setPitch} placeholder="6" keyboardType="numeric" suffix="/12" colors={colors} />
            </View>
          </View>
          {steep ? (
            <View style={[styles.steepNote, { backgroundColor: colors.accent }]}>
              <Icon name="alert-circle" size={16} color={colors.secondary} />
              <Text style={{ color: colors.secondary, fontSize: 13, flex: 1 }}>
                Steeper than 8/12 — the steep adder applies to this facet.
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={saveDetails}
            disabled={!detailsDirty || !detailsValid || savingDetails}
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: !detailsDirty || !detailsValid || savingDetails ? 0.5 : 1 }]}
          >
            {savingDetails ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save details</Text>
            )}
          </Pressable>
        </View>

        {/* Tie-in protocol */}
        <Text style={[styles.section, { color: colors.foreground }]}>Tie-In Protocol</Text>
        <View style={styles.chipRow}>
          {TIE_IN_OPTIONS.map((protocol) => {
            const selected = protocol === 'valley' ? facet.tieInValley : facet.tieInHipRidge;
            return (
              <Pressable
                key={protocol}
                onPress={() => toggleTieIn(protocol)}
                style={[
                  styles.tieInBtn,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontWeight: '700' }}>
                  {TIE_IN_LABELS[protocol]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {TIE_IN_OPTIONS.map((option) => {
          const selected = option === 'valley' ? facet.tieInValley : facet.tieInHipRidge;
          if (!selected || !tieInPrompt[option]) return null;
          return (
            <View
              key={option}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                {TIE_IN_LABELS[option]} marking protocol
              </Text>
              {TIE_IN_INSTRUCTIONS[option].map((line, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ color: colors.mutedForeground }}>•</Text>
                  <Text style={{ color: colors.foreground, flex: 1, fontSize: 14 }}>{line}</Text>
                </View>
              ))}
              <Pressable
                onPress={() => captureTieInPhoto(option)}
                style={[styles.saveBtn, { backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 8 }]}
              >
                <Icon name="camera" size={18} color={colors.primaryForeground} />
                <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Capture Photo</Text>
              </Pressable>
            </View>
          );
        })}

        {/* Damage */}
        <Text style={[styles.section, { color: colors.foreground }]}>Damage on this facet</Text>
        <View style={styles.chipRow}>
          {FACET_DAMAGE_TYPES.map((type) => {
            const selected = damageType === type;
            return (
              <Pressable
                key={type}
                onPress={() => setDamage(type)}
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

        {damagePresent ? (
          <>
            {damageRecords.map((record, index) => (
              <Pressable
                key={record.id}
                onPress={() =>
                  router.push({
                    pathname: '/inspection-photo-capture',
                    params: {
                      inspectionId: id,
                      subjectType: 'damage_instance',
                      subjectId: record.id,
                      roles: 'wide',
                      stage: 'facets',
                      title: `${facet.label}-Damage ${index + 1}`,
                    },
                  })
                }
                style={[styles.row, { backgroundColor: colors.card, borderColor: record.photoCaptured ? colors.success : colors.border }]}
              >
                <View style={[styles.badge, { backgroundColor: record.photoCaptured ? colors.success : colors.accent }]}>
                  <Icon name={record.photoCaptured ? 'check' : 'camera'} size={18} color={record.photoCaptured ? '#fff' : colors.secondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    {facet.label}-Damage {index + 1}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    {record.photoCaptured ? 'Photo captured' : 'Photo required — tap to capture'}
                  </Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
              </Pressable>
            ))}
            <Pressable
              onPress={addDamageRecord}
              disabled={addingDamage}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, borderStyle: 'dashed' }]}
            >
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                {addingDamage ? (
                  <ActivityIndicator color={colors.secondary} />
                ) : (
                  <Icon name="plus" size={18} color={colors.secondary} />
                )}
              </View>
              <Text style={[styles.rowTitle, { color: colors.foreground, flex: 1 }]}>
                Add damage &amp; photograph
              </Text>
            </Pressable>
            {damageRecords.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                At least one photographed damage instance is required on a damaged facet.
              </Text>
            ) : null}
          </>
        ) : null}

        {/* Save facet — persists pending edits and returns to the facet list */}
        <Pressable
          onPress={saveFacetAndReturn}
          disabled={savingDetails}
          style={[styles.saveBtn, { backgroundColor: colors.primary, marginTop: 16, opacity: savingDetails ? 0.5 : 1 }]}
        >
          {savingDetails ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save Facet</Text>
          )}
        </Pressable>

        {/* Remove facet */}
        <Pressable
          onPress={confirmRemove}
          disabled={removing}
          style={[styles.removeBtn, { borderColor: colors.destructive, opacity: removing ? 0.5 : 1 }]}
        >
          {removing ? (
            <ActivityIndicator color={colors.destructive} />
          ) : (
            <Text style={{ color: colors.destructive, fontWeight: '700' }}>Remove this facet</Text>
          )}
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  suffix,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  suffix?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View
        style={[
          styles.inputWrap,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          keyboardType={keyboardType ?? 'default'}
          style={[styles.input, { color: colors.foreground }]}
        />
        {suffix ? (
          <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  heading: { fontSize: 20, fontWeight: '800' },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  pitchRow: { flexDirection: 'row', gap: 12 },
  steepNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15 },
  tieInBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  saveBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  removeBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, marginTop: 12 },
});

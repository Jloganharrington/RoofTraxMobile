import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { patchInspection } from '@/lib/inspectionSync';

// REPORT_DATA v2 §4 — Temporary repairs & mitigation. Reachable from BOTH the
// Phase 1 hub (a tarp most often goes on at the first visit) and the Phase 2
// step list — one inspection record advances through phases, so whatever is
// recorded here carries forward. `performed` is explicit, never inferred.

export default function InspectionMitigationScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const existing = inspection?.temporaryRepairs ?? null;

  const [performed, setPerformed] = React.useState<boolean | null>(null);
  const [description, setDescription] = React.useState('');
  const [datePerformed, setDatePerformed] = React.useState('');
  const [materialsUsed, setMaterialsUsed] = React.useState('');
  const [crewAndEquipment, setCrewAndEquipment] = React.useState('');
  const [tarpInvoiceRef, setTarpInvoiceRef] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  const navigation = useNavigation();

  React.useEffect(() => {
    if (existing && !hydrated) {
      setPerformed(existing.performed);
      setDescription(existing.description ?? '');
      setDatePerformed(existing.datePerformed ?? '');
      setMaterialsUsed(existing.materialsUsed ?? '');
      setCrewAndEquipment(existing.crewAndEquipment ?? '');
      setTarpInvoiceRef(existing.tarpInvoiceRef ?? '');
      setHydrated(true);
    }
  }, [existing, hydrated]);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Temporary Repairs' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Temporary Repairs' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  // Auto-save on back — only fires if the required "performed" toggle is set.
  const autoSaveRef = React.useRef<() => void>(() => {});
  autoSaveRef.current = () => {
    if (saving || performed == null) return;
    void patchInspection(queryClient, id, {
      temporaryRepairs: {
        performed,
        tarpInvoiceRef: tarpInvoiceRef.trim() || null,
        description: description.trim() || null,
        datePerformed: datePerformed.trim() || null,
        materialsUsed: materialsUsed.trim() || null,
        crewAndEquipment: crewAndEquipment.trim() || null,
        beforeAfterPhotoIds: [],
        recordedAtUtc: new Date().toISOString(),
      },
    }).catch(() => {});
  };
  React.useEffect(() => {
    return navigation.addListener('beforeRemove', () => { autoSaveRef.current(); });
  }, [navigation]);

  async function save() {
    if (saving) return;
    setError(null);
    if (performed == null) {
      setError('Select whether temporary repairs were performed.');
      return;
    }
    setSaving(true);
    try {
      await patchInspection(queryClient, id, {
        temporaryRepairs: {
          performed,
          tarpInvoiceRef: tarpInvoiceRef.trim() || null,
          description: description.trim() || null,
          datePerformed: datePerformed.trim() || null,
          materialsUsed: materialsUsed.trim() || null,
          crewAndEquipment: crewAndEquipment.trim() || null,
          beforeAfterPhotoIds: [],
          recordedAtUtc: new Date().toISOString(),
        },
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Temporary Repairs' }} />

      <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Icon name="shield" size={22} color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
          Document emergency tarping or mitigation. Capture before &amp; after photos in the photo
          steps — they are the proof the mitigation invoice stands on.
        </Text>
      </View>

      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        Were temporary repairs performed?
      </Text>
      <View style={styles.toggleRow}>
        {[
          { label: 'Yes', value: true },
          { label: 'No', value: false },
        ].map((option) => {
          const on = performed === option.value;
          return (
            <Pressable
              key={option.label}
              onPress={() => setPerformed(option.value)}
              style={[
                styles.toggle,
                {
                  backgroundColor: on ? colors.primary : colors.card,
                  borderColor: on ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontWeight: '600' }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {performed ? (
        <>
          <Field
            label="What was done"
            value={description}
            onChange={setDescription}
            placeholder="e.g. 20x30 tarp over rear slope, ridge to eave"
            multiline
            colors={colors}
          />
          <Field
            label="Date performed"
            value={datePerformed}
            onChange={setDatePerformed}
            placeholder="e.g. 2026-07-14"
            colors={colors}
          />
          <Field
            label="Materials used"
            value={materialsUsed}
            onChange={setMaterialsUsed}
            placeholder="e.g. 6-mil poly tarp, 1x3 furring strips, cap nails"
            multiline
            colors={colors}
          />
          <Field
            label="Crew & equipment"
            value={crewAndEquipment}
            onChange={setCrewAndEquipment}
            placeholder="e.g. 2-man crew, 28' ladder, harness rig"
            multiline
            colors={colors}
          />
          <Field
            label="Tarp invoice reference"
            value={tarpInvoiceRef}
            onChange={setTarpInvoiceRef}
            placeholder="e.g. INV-2314"
            colors={colors}
          />
        </>
      ) : null}

      {error ? <Text style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text> : null}

      <Pressable
        onPress={save}
        disabled={saving}
        style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
      >
        {saving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={{ color: colors.primaryForeground, fontWeight: '700', fontSize: 15 }}>
            Save temporary repairs
          </Text>
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
  multiline,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        style={[
          styles.input,
          multiline ? styles.inputMultiline : null,
          { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggle: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  saveBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 6 },
});

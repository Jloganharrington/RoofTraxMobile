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
import { useNavigation } from 'expo-router';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { patchInspection } from '@/lib/inspectionSync';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';

// REPORT_DATA v2 §1 — Property Profile. Only non-derived fields are asked
// here; slope count, roof covering, interior areas inspected etc. are derived
// by the report from data the app already captures. Never ask twice.

const PROPERTY_TYPES = [
  { value: 'single_family', label: 'Single family' },
  { value: 'townhome', label: 'Townhome' },
  { value: 'condo', label: 'Condo' },
  { value: 'multi_family', label: 'Multi-family' },
  { value: 'commercial', label: 'Commercial' },
];
const STORIES = ['1', '1.5', '2', '2.5', '3+'];
const ROOF_GEOMETRIES = ['gable', 'hip', 'mansard', 'gambrel', 'flat', 'complex'];

export default function InspectionPropertyProfileScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  useNextSectionHeader(id, 'property_profile');

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const existing = inspection?.propertyProfile ?? null;

  const [propertyType, setPropertyType] = React.useState<string | null>(null);
  const [stories, setStories] = React.useState<string | null>(null);
  const [accessibilityNotes, setAccessibilityNotes] = React.useState('');
  const [roofGeometry, setRoofGeometry] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  const navigation = useNavigation();

  React.useEffect(() => {
    if (existing && !hydrated) {
      setPropertyType(existing.propertyType ?? null);
      setStories(existing.stories ?? null);
      setAccessibilityNotes(existing.accessibilityNotes ?? '');
      setRoofGeometry(existing.roofGeometry ?? []);
      setHydrated(true);
    }
  }, [existing, hydrated]);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Property Profile' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Property Profile' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  // Auto-save on back.
  const autoSaveRef = React.useRef<() => void>(() => {});
  autoSaveRef.current = () => {
    if (saving) return;
    void patchInspection(queryClient, id, {
      propertyProfile: {
        propertyType: (propertyType as never) ?? null,
        stories: (stories as never) ?? null,
        accessibilityNotes: accessibilityNotes.trim() || null,
        roofGeometry: roofGeometry as never,
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
    setSaving(true);
    try {
      await patchInspection(queryClient, id, {
        propertyProfile: {
          propertyType: (propertyType as never) ?? null,
          stories: (stories as never) ?? null,
          accessibilityNotes: accessibilityNotes.trim() || null,
          roofGeometry: roofGeometry as never,
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
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Stack.Screen options={{ title: 'Property Profile' }} />

        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Icon name="home" size={22} color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
            Describe the property and construction. Slope counts, roof covering and inspected areas
            are pulled from your capture automatically — no need to repeat them.
          </Text>
        </View>

        <ChipGroup label="Property type" options={PROPERTY_TYPES} value={propertyType} onChange={setPropertyType} colors={colors} />
        <ChipGroup
          label="Stories"
          options={STORIES.map((s) => ({ value: s, label: s }))}
          value={stories}
          onChange={setStories}
          colors={colors}
        />

        <Field
          label="Accessibility notes"
          value={accessibilityNotes}
          onChange={setAccessibilityNotes}
          placeholder="e.g. Rear slope only reachable by 32' ladder"
          multiline
          colors={colors}
        />

        <Text style={[styles.section, { color: colors.foreground }]}>Construction description</Text>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Roof geometry (select all that apply)</Text>
        <View style={styles.chipWrap}>
          {ROOF_GEOMETRIES.map((g) => {
            const on = roofGeometry.includes(g);
            return (
              <Pressable
                key={g}
                onPress={() =>
                  setRoofGeometry((prev) => (on ? prev.filter((x) => x !== g) : [...prev, g]))
                }
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? colors.primary : colors.card,
                    borderColor: on ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontWeight: '600', textTransform: 'capitalize' }}>
                  {g}
                </Text>
              </Pressable>
            );
          })}
        </View>

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
              Save property profile
            </Text>
          )}
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Chip group ───────────────────────────────────────────────────────────────

function ChipGroup({
  label,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string | null;
  onChange: (v: string | null) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.chipWrap}>
        {options.map((option) => {
          const on = value === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(on ? null : option.value)}
              style={[
                styles.chip,
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
    </View>
  );
}

// ─── Text field ───────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'numeric';
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
        keyboardType={keyboardType}
        style={[
          styles.input,
          multiline ? styles.inputMultiline : null,
          { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
        ]}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  saveBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 6 },
});

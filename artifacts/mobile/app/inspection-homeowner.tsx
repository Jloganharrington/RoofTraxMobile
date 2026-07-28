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
import { useNavigation } from 'expo-router';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { updateHomeownerFacts } from '@/lib/inspectionSync';

// E3 — Homeowner facts. Additive, no gate. The inspector records what the
// homeowner reported (date-of-loss awareness, prior repairs, prior claims) as
// plain facts for the package; the app never adjudicates them.

export default function InspectionHomeownerScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const existing = inspection?.homeownerFacts ?? null;

  const [awareOfDateOfLoss, setAwareOfDateOfLoss] = React.useState<boolean | null>(null);
  const [priorRepairs, setPriorRepairs] = React.useState('');
  const [priorClaims, setPriorClaims] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  const navigation = useNavigation();

  // Hydrate the form once from the stored facts (if any).
  React.useEffect(() => {
    if (existing && !hydrated) {
      setAwareOfDateOfLoss(existing.awareOfDateOfLoss);
      setPriorRepairs(existing.priorRepairs ?? '');
      setPriorClaims(existing.priorClaims ?? '');
      setHydrated(true);
    }
  }, [existing, hydrated]);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Homeowner' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Homeowner' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  // Auto-save on back navigation — uses a ref so the listener always reads
  // current state without needing to re-register on every state change.
  const autoSaveRef = React.useRef<() => void>(() => {});
  autoSaveRef.current = () => {
    if (saving || !hydrated) return;
    void updateHomeownerFacts(queryClient, id, {
      awareOfDateOfLoss,
      priorRepairs: priorRepairs.trim() || null,
      priorClaims: priorClaims.trim() || null,
      recordedAtUtc: new Date().toISOString(),
    }).catch(() => {});
  };
  React.useEffect(() => {
    return navigation.addListener('beforeRemove', () => { autoSaveRef.current(); });
  }, [navigation]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await updateHomeownerFacts(queryClient, id, {
        awareOfDateOfLoss,
        priorRepairs: priorRepairs.trim() || null,
        priorClaims: priorClaims.trim() || null,
        recordedAtUtc: new Date().toISOString(),
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
      <Stack.Screen options={{ title: 'Homeowner' }} />

      <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Icon name="clipboard" size={22} color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
          Record what the homeowner reported. These are facts for the package — not conclusions.
        </Text>
      </View>

      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        Is the homeowner aware of the date of loss?
      </Text>
      <View style={styles.toggleRow}>
        {[
          { label: 'Yes', value: true },
          { label: 'No', value: false },
          { label: 'Unsure', value: null },
        ].map((option) => {
          const on = awareOfDateOfLoss === option.value;
          return (
            <Pressable
              key={option.label}
              onPress={() => setAwareOfDateOfLoss(option.value)}
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

      <Field
        label="Prior repairs reported"
        value={priorRepairs}
        onChange={setPriorRepairs}
        placeholder="e.g. Roof patched near chimney in 2019"
        multiline
        colors={colors}
      />
      <Field
        label="Prior claims reported"
        value={priorClaims}
        onChange={setPriorClaims}
        placeholder="e.g. Wind claim in 2021, approved"
        multiline
        colors={colors}
      />

      <Pressable
        onPress={save}
        disabled={saving}
        style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
      >
        {saving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={{ color: colors.primaryForeground, fontWeight: '700', fontSize: 15 }}>
            Save homeowner facts
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

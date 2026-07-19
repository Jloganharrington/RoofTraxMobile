import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { patchInspection } from '@/lib/inspectionSync';

// REPORT_DATA v2 §3 — Existing / unrelated conditions. Documenting what you
// are NOT claiming is a credibility asset: it shows the inspector separated
// storm damage from wear, and it protects the claim from "they counted
// everything" attacks.

export default function InspectionExistingConditionsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const existing = inspection?.existingOrUnrelatedConditions ?? null;

  const [rows, setRows] = React.useState<Array<{ location: string; note: string }>>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (existing && !hydrated) {
      setRows(existing.map((c) => ({ location: c.location, note: c.note })));
      setHydrated(true);
    }
  }, [existing, hydrated]);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Existing Conditions' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Existing Conditions' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  function setRow(index: number, patch: Partial<{ location: string; note: string }>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    if (saving) return;
    setError(null);
    const cleaned = rows
      .map((row) => ({ location: row.location.trim(), note: row.note.trim() }))
      .filter((row) => row.location !== '' || row.note !== '');
    if (cleaned.some((row) => row.location === '' || row.note === '')) {
      setError('Each condition needs both a location and a note.');
      return;
    }
    setSaving(true);
    try {
      await patchInspection(queryClient, id, { existingOrUnrelatedConditions: cleaned });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Existing Conditions' }} />

      <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Icon name="alert-circle" size={22} color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
          Note anything pre-existing or unrelated that you are NOT claiming — nail pops, old
          repairs, wear. Showing what you excluded is what makes the rest of the report credible.
        </Text>
      </View>

      {rows.map((row, index) => (
        <View
          key={index}
          style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={styles.rowHeader}>
            <Text style={{ color: colors.foreground, fontWeight: '700' }}>
              Condition {index + 1}
            </Text>
            <Pressable onPress={() => setRows((prev) => prev.filter((_, i) => i !== index))}>
              <Icon name="trash-2" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <TextInput
            value={row.location}
            onChangeText={(v) => setRow(index, { location: v })}
            placeholder="Location (e.g. South slope near chimney)"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
            ]}
          />
          <TextInput
            value={row.note}
            onChangeText={(v) => setRow(index, { note: v })}
            placeholder="What it is and why it's excluded (e.g. blistering — thermal, not impact)"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[
              styles.input,
              styles.inputMultiline,
              { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
            ]}
          />
        </View>
      ))}

      <Pressable
        onPress={() => setRows((prev) => [...prev, { location: '', note: '' }])}
        style={[styles.addBtn, { borderColor: colors.border }]}
      >
        <Icon name="plus" size={18} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '600' }}>Add condition</Text>
      </Pressable>

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
            {rows.length === 0 ? 'Save — none observed' : 'Save excluded conditions'}
          </Text>
        )}
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  rowCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  saveBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 6 },
});

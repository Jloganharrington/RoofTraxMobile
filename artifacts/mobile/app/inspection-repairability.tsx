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
import { useNavigation } from '@react-navigation/native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { patchInspection } from '@/lib/inspectionSync';

// REPORT_DATA v2 §2 — Repairability Assessment. The crux of replace-vs-repair
// disputes. MUST be explicitly performed: nothing here is ever defaulted, and
// skipping the step leaves the record null (the report section omits).
// Assessor name/credentials are attached server-side from the profile.

const DEFAULT_QUESTION =
  'Can the damaged roofing/siding materials be repaired to pre-loss condition, or is replacement required?';

export default function InspectionRepairabilityScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const existing = inspection?.repairabilityAssessment ?? null;

  const [questionPresented, setQuestionPresented] = React.useState(DEFAULT_QUESTION);
  const [methodology, setMethodology] = React.useState('');
  const [materialsReviewed, setMaterialsReviewed] = React.useState('');
  const [repairAttemptMade, setRepairAttemptMade] = React.useState<boolean | null>(null);
  const [adjacentFractured, setAdjacentFractured] = React.useState<boolean | null>(null);
  const [matchingSourceable, setMatchingSourceable] = React.useState<boolean | null>(null);
  const [productDiscontinued, setProductDiscontinued] = React.useState<boolean | null>(null);
  const [findingNotes, setFindingNotes] = React.useState('');
  const [conditionScoring, setConditionScoring] = React.useState('');
  const [repairAttemptRisks, setRepairAttemptRisks] = React.useState('');
  const [determination, setDetermination] = React.useState<'repairable' | 'not_repairable' | null>(
    null,
  );
  const [recommendation, setRecommendation] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  const navigation = useNavigation();

  React.useEffect(() => {
    if (existing && !hydrated) {
      setQuestionPresented(existing.questionPresented);
      setMethodology(existing.methodology ?? '');
      setMaterialsReviewed(existing.materialsReviewed ?? '');
      setRepairAttemptMade(existing.fieldTestFindings.repairAttemptMade ?? null);
      setAdjacentFractured(existing.fieldTestFindings.adjacentShinglesFractured ?? null);
      setMatchingSourceable(existing.fieldTestFindings.matchingMaterialSourceable ?? null);
      setProductDiscontinued(existing.fieldTestFindings.productDiscontinued ?? null);
      setFindingNotes(existing.fieldTestFindings.notes ?? '');
      setConditionScoring(existing.conditionScoring ?? '');
      setRepairAttemptRisks(existing.repairAttemptRisks ?? '');
      setDetermination(existing.determination);
      setRecommendation(existing.recommendation ?? '');
      setHydrated(true);
    }
  }, [existing, hydrated]);

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

  // Auto-save on back — only fires when the required determination is set.
  const autoSaveRef = React.useRef<() => void>(() => {});
  autoSaveRef.current = () => {
    if (saving || !determination || !questionPresented.trim()) return;
    void patchInspection(queryClient, id, {
      repairabilityAssessment: {
        questionPresented: questionPresented.trim(),
        methodology: methodology.trim() || null,
        materialsReviewed: materialsReviewed.trim() || null,
        fieldTestFindings: {
          repairAttemptMade,
          adjacentShinglesFractured: adjacentFractured,
          matchingMaterialSourceable: matchingSourceable,
          productDiscontinued,
          notes: findingNotes.trim() || null,
        },
        conditionScoring: conditionScoring.trim() || null,
        repairAttemptRisks: repairAttemptRisks.trim() || null,
        determination,
        recommendation: recommendation.trim() || null,
        supportingPhotoIds: [],
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
    if (!questionPresented.trim()) {
      setError('The question presented is required.');
      return;
    }
    if (!determination) {
      setError('A determination (repairable / not repairable) is required to record this assessment.');
      return;
    }
    setSaving(true);
    try {
      await patchInspection(queryClient, id, {
        repairabilityAssessment: {
          questionPresented: questionPresented.trim(),
          methodology: methodology.trim() || null,
          materialsReviewed: materialsReviewed.trim() || null,
          fieldTestFindings: {
            repairAttemptMade,
            adjacentShinglesFractured: adjacentFractured,
            matchingMaterialSourceable: matchingSourceable,
            productDiscontinued,
            notes: findingNotes.trim() || null,
          },
          conditionScoring: conditionScoring.trim() || null,
          repairAttemptRisks: repairAttemptRisks.trim() || null,
          determination,
          recommendation: recommendation.trim() || null,
          supportingPhotoIds: [],
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
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Repairability' }} />

      <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Icon name="tool" size={22} color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
          Record your repair-vs-replace field determination. Your name and credentials are attached
          from your profile automatically. Skipping this step leaves it out of the report — nothing
          is ever assumed on your behalf.
        </Text>
      </View>

      <Field
        label="Question presented"
        value={questionPresented}
        onChange={setQuestionPresented}
        multiline
        colors={colors}
      />
      <Field
        label="Methodology"
        value={methodology}
        onChange={setMethodology}
        placeholder="e.g. HAAG-style brittleness test on adjacent shingles, lift test at 3 locations"
        multiline
        colors={colors}
      />
      <Field
        label="Materials reviewed"
        value={materialsReviewed}
        onChange={setMaterialsReviewed}
        placeholder="e.g. ITEL match report, manufacturer discontinuation notice"
        multiline
        colors={colors}
      />

      <Text style={[styles.section, { color: colors.foreground }]}>Field test findings</Text>
      <YesNoRow label="Repair attempt made on site?" value={repairAttemptMade} onChange={setRepairAttemptMade} colors={colors} />
      <YesNoRow label="Adjacent shingles fractured during test?" value={adjacentFractured} onChange={setAdjacentFractured} colors={colors} />
      <YesNoRow label="Matching material sourceable?" value={matchingSourceable} onChange={setMatchingSourceable} colors={colors} />
      <YesNoRow label="Product discontinued?" value={productDiscontinued} onChange={setProductDiscontinued} colors={colors} />
      <Field
        label="Finding notes"
        value={findingNotes}
        onChange={setFindingNotes}
        placeholder="What you observed during the tests"
        multiline
        colors={colors}
      />

      <Field
        label="Condition scoring"
        value={conditionScoring}
        onChange={setConditionScoring}
        placeholder="e.g. Granule loss moderate; mat exposure at 4 hits per square"
        multiline
        colors={colors}
      />
      <Field
        label="Risks of attempting repair"
        value={repairAttemptRisks}
        onChange={setRepairAttemptRisks}
        placeholder="e.g. Brittle shingles will fracture on lift; repair voids remaining warranty"
        multiline
        colors={colors}
      />

      <Text style={[styles.section, { color: colors.foreground }]}>Determination (required)</Text>
      <View style={styles.toggleRow}>
        {(
          [
            { value: 'repairable', label: 'Repairable' },
            { value: 'not_repairable', label: 'Not repairable' },
          ] as const
        ).map((option) => {
          const on = determination === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setDetermination(option.value)}
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
        label="Recommendation"
        value={recommendation}
        onChange={setRecommendation}
        placeholder="e.g. Full replacement of affected slopes"
        multiline
        colors={colors}
      />

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
            Record assessment
          </Text>
        )}
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function YesNoRow({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.yesNoRow}>
      <Text style={{ color: colors.foreground, flex: 1, fontSize: 14 }}>{label}</Text>
      {[
        { label: 'Yes', v: true },
        { label: 'No', v: false },
      ].map((option) => {
        const on = value === option.v;
        return (
          <Pressable
            key={option.label}
            onPress={() => onChange(on ? null : option.v)}
            style={[
              styles.yesNoBtn,
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
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggle: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  yesNoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yesNoBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  saveBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 6 },
});

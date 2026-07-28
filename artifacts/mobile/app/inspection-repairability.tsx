import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import {
  captureEvidencePhoto,
  CameraPermissionDeniedError,
  type CapturedEvidencePhoto,
} from '@/lib/inspectionPhoto';
import { useGetInspection, getGetInspectionQueryKey } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Repairability screen — rebuilt question set (in progress).
//
// Current flow: warranted/authorized gate → systems → roof type (asphalt
// shingle only for now) → Repair Attempt Protocol (RAP): marking
// instructions, RAP1 photo, pull procedure, mat-transfer checks on shingles
// 1–2, collateral-damage questions 1–5 over shingles 3–8, and a live
// scorecard of unique newly damaged shingles.
//
// Saving is still disabled: the API server enforces the OLD flow rules, so a
// record in this new shape would be rejected. Photos are captured locally
// only. Server validation (repairabilityRules.ts) and previously saved
// assessments are intentionally untouched.
// ---------------------------------------------------------------------------

type YesNo = 'yes' | 'no';
type ShingleNum = 3 | 4 | 5 | 6 | 7 | 8;
const SHINGLES_3_8: ShingleNum[] = [3, 4, 5, 6, 7, 8];

interface DamageQuestionDef {
  key: string;
  num: number;
  label: string;
  /** Scorecard line label for this damage category. */
  scoreLabel: string;
}

const DAMAGE_QUESTIONS: DamageQuestionDef[] = [
  {
    key: 'delamination',
    num: 1,
    label: 'Did any shingles sustain delamination?',
    scoreLabel: 'Delamination',
  },
  {
    key: 'creasing',
    num: 2,
    label: 'Did any shingles sustain creasing, cracking or fracturing?',
    scoreLabel: 'Creasing/cracking/fracture',
  },
  {
    key: 'nailZone',
    num: 3,
    label: 'Did any shingles sustain nail pull-through or nail-zone damage?',
    scoreLabel: 'Nail-zone damage',
  },
  {
    key: 'puncture',
    num: 4,
    label: 'Did any shingle sustain puncture, tearing or gouge while seals were being released?',
    scoreLabel: 'Puncture/tear/gouge',
  },
  {
    key: 'reseat',
    num: 5,
    label:
      'Did any manipulated shingle fail to re-seat flat or remain unable to be properly resecured after replacement of X?',
    scoreLabel: 'Reseating/seal-integration concerns',
  },
];

interface DamageAnswer {
  answer: YesNo | null;
  shingles: ShingleNum[];
  photo: CapturedEvidencePhoto | null;
  note: string;
}

const emptyDamageAnswer = (): DamageAnswer => ({
  answer: null,
  shingles: [],
  photo: null,
  note: '',
});

const MARKING_STEPS = [
  'Identify an already damaged field shingle to be pulled',
  'Mark the damaged shingle with an "X"',
  'Mark the shingles directly below "X" as 1 & 2',
  'Mark the shingles left and right as 3 & 4',
  'Mark the two shingles above "X" as 5 & 6',
  'Mark the shingles above 5 & 6 as 7 & 8',
];

const PULL_STEPS = [
  'Break all seals using a standard flat bar or 5-in-1 painters tool',
  'Locate and gently remove all nails fastening shingle "X"',
  'Pull shingle "X"',
];

const RESET_STEPS = [
  'Replace "X" back to its original location',
  'Without overlifting the shingles, properly re-nail all fasteners removed in new hole locations (straight and flush)',
  'Tap the surface of all manipulated shingles every 6 inches with your hand (Do not use any tool)',
];

export default function InspectionRepairabilityScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const existing = inspection?.repairabilityAssessment ?? null;

  // Gate question: the systems selection only opens when an assessment is
  // warranted and authorized.
  const [warranted, setWarranted] = React.useState<
    'yes' | 'not_warranted_discontinued' | 'not_authorized' | null
  >(null);
  const [systems, setSystems] = React.useState<Array<'roof' | 'siding'>>([]);
  // Type of roof — shown when Roof is selected. More types will be added later.
  const [roofType, setRoofType] = React.useState<'asphalt_shingle' | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  // RAP (Repair Attempt Protocol) state — asphalt shingle.
  const [rap1Photo, setRap1Photo] = React.useState<CapturedEvidencePhoto | null>(null);
  const [matTransfer, setMatTransfer] = React.useState<{ 1: YesNo | null; 2: YesNo | null }>({
    1: null,
    2: null,
  });
  const [damage, setDamage] = React.useState<Record<string, DamageAnswer>>(() =>
    Object.fromEntries(DAMAGE_QUESTIONS.map((q) => [q.key, emptyDamageAnswer()])),
  );
  const [capturing, setCapturing] = React.useState<string | null>(null);

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

  const takePhoto = async (slot: string, assign: (p: CapturedEvidencePhoto) => void) => {
    if (capturing) return;
    setCapturing(slot);
    try {
      const photo = await captureEvidencePhoto();
      if (photo) assign(photo);
    } catch (err) {
      if (err instanceof CameraPermissionDeniedError) {
        Alert.alert(
          'Camera access needed',
          'Enable camera access for RoofTrax in your device settings to take protocol photos.',
        );
      } else {
        Alert.alert('Photo failed', 'Could not capture the photo. Please try again.');
      }
    } finally {
      setCapturing(null);
    }
  };

  // ------ Scorecard math ------
  // A shingle counts once no matter how many damage types it recorded.
  const collateralSet = new Set<number>();
  if (matTransfer[1] === 'yes') collateralSet.add(1);
  if (matTransfer[2] === 'yes') collateralSet.add(2);
  for (const q of DAMAGE_QUESTIONS) {
    const a = damage[q.key];
    if (a.answer === 'yes') for (const s of a.shingles) collateralSet.add(s);
  }
  const matTransferCount = (matTransfer[1] === 'yes' ? 1 : 0) + (matTransfer[2] === 'yes' ? 1 : 0);
  const categoryCount = (key: string) =>
    damage[key].answer === 'yes' ? damage[key].shingles.length : 0;

  const chipStyle = (on: boolean) => [
    styles.sysToggle,
    {
      borderColor: on ? colors.primary : colors.border,
      backgroundColor: on ? colors.primary : colors.card,
    },
  ];
  const chipText = (on: boolean) => ({
    color: on ? colors.primaryForeground : colors.foreground,
    fontWeight: '700' as const,
  });

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

  const renderInstructionCard = (title: string, steps: string[]) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
      {steps.map((step, i) => (
        <View key={i} style={styles.stepRow}>
          <Icon name="chevron-right" size={16} color={colors.primary} />
          <Text style={{ color: colors.foreground, flex: 1, fontSize: 14, lineHeight: 20 }}>
            {step}
          </Text>
        </View>
      ))}
    </View>
  );

  const renderPhotoButton = (
    slot: string,
    photo: CapturedEvidencePhoto | null,
    assign: (p: CapturedEvidencePhoto) => void,
    label: string,
  ) => (
    <View style={styles.photoRow}>
      {photo ? (
        <Image source={{ uri: photo.localUri }} style={styles.photoThumb} />
      ) : null}
      <Pressable
        onPress={() => takePhoto(slot, assign)}
        style={[styles.photoBtn, { borderColor: colors.primary, backgroundColor: colors.card }]}
      >
        {capturing === slot ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Icon name="camera" size={18} color={colors.primary} />
        )}
        <Text style={{ color: colors.primary, fontWeight: '700' }}>
          {photo ? 'Retake' : label}
        </Text>
      </Pressable>
    </View>
  );

  const showRap = warranted === 'yes' && systems.includes('roof') && roofType === 'asphalt_shingle';

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Repairability' }} />

      <Text style={[styles.qLabel, { color: colors.foreground }]}>
        Is a Repairability Assessment warranted and authorized at this time?
      </Text>
      <View style={styles.chipWrap}>
        {(
          [
            { value: 'yes', label: 'Yes' },
            { value: 'not_warranted_discontinued', label: 'Not Warranted - Discontinued' },
            { value: 'not_authorized', label: 'Not Authorized' },
          ] as const
        ).map((opt) => {
          const on = warranted === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setWarranted(on ? null : opt.value)}
              style={chipStyle(on)}
            >
              <Text style={chipText(on)}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {warranted === 'yes' ? (
        <>
          <Text style={[styles.qLabel, { color: colors.foreground }]}>Repairability assessed on</Text>
          <View style={styles.chipWrap}>
            {(['roof', 'siding'] as const).map((sys) => {
              const on = systems.includes(sys);
              return (
                <Pressable
                  key={sys}
                  onPress={() => setSystems((s) => (on ? s.filter((x) => x !== sys) : [...s, sys]))}
                  style={chipStyle(on)}
                >
                  <Text style={chipText(on)}>{sys === 'roof' ? 'Roof' : 'Siding'}</Text>
                </Pressable>
              );
            })}
          </View>

          {systems.includes('roof') ? (
            <>
              <Text style={[styles.qLabel, { color: colors.foreground }]}>Type of Roof</Text>
              <View style={styles.chipWrap}>
                {([{ value: 'asphalt_shingle', label: 'Asphalt Shingle' }] as const).map((opt) => {
                  const on = roofType === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setRoofType(on ? null : opt.value)}
                      style={chipStyle(on)}
                    >
                      <Text style={chipText(on)}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
        </>
      ) : null}

      {showRap ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Repair Attempt Protocol
          </Text>

          {renderInstructionCard('Instructions — Marking', MARKING_STEPS)}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Take Photograph (RAP1)</Text>
            {renderPhotoButton('rap1', rap1Photo, setRap1Photo, 'Take RAP1 Photo')}
          </View>

          {renderInstructionCard('Instructions — Pull', PULL_STEPS)}

          {([1, 2] as const).map((n) => (
            <View key={n}>
              <Text style={[styles.qLabel, { color: colors.foreground }]}>
                Did Shingle {n} sustain Mat Transfer during the removal process?
              </Text>
              <View style={[styles.chipWrap, { marginTop: 8 }]}>
                {(['yes', 'no'] as const).map((v) => {
                  const on = matTransfer[n] === v;
                  return (
                    <Pressable
                      key={v}
                      onPress={() => setMatTransfer((m) => ({ ...m, [n]: on ? null : v }))}
                      style={chipStyle(on)}
                    >
                      <Text style={chipText(on)}>{v === 'yes' ? 'Yes' : 'No'}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {renderInstructionCard('Instructions — Replace & Re-secure', RESET_STEPS)}

          {DAMAGE_QUESTIONS.map((q) => {
            const a = damage[q.key];
            const setA = (patch: Partial<DamageAnswer>) =>
              setDamage((d) => ({ ...d, [q.key]: { ...d[q.key], ...patch } }));
            return (
              <View key={q.key} style={{ gap: 8 }}>
                <Text style={[styles.qLabel, { color: colors.foreground }]}>
                  {q.num}: {q.label}
                </Text>
                <View style={styles.chipWrap}>
                  {(['yes', 'no'] as const).map((v) => {
                    const on = a.answer === v;
                    return (
                      <Pressable
                        key={v}
                        onPress={() => setA({ answer: on ? null : v })}
                        style={chipStyle(on)}
                      >
                        <Text style={chipText(on)}>{v === 'yes' ? 'Yes' : 'No'}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {a.answer === 'yes' ? (
                  <View
                    style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                      {q.num}A: Select all affected shingles
                    </Text>
                    <View style={styles.chipWrap}>
                      {SHINGLES_3_8.map((s) => {
                        const on = a.shingles.includes(s);
                        return (
                          <Pressable
                            key={s}
                            onPress={() =>
                              setA({
                                shingles: on
                                  ? a.shingles.filter((x) => x !== s)
                                  : [...a.shingles, s].sort((x, y) => x - y),
                              })
                            }
                            style={chipStyle(on)}
                          >
                            <Text style={chipText(on)}>{s}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      Photograph one example with a note.
                    </Text>
                    {renderPhotoButton(
                      q.key,
                      a.photo,
                      (p) => setA({ photo: p }),
                      'Take Example Photo',
                    )}
                    <TextInput
                      value={a.note}
                      onChangeText={(t) => setA({ note: t })}
                      placeholder="Photo note (which shingle, what you see)…"
                      placeholderTextColor={colors.mutedForeground}
                      multiline
                      style={[
                        styles.noteInput,
                        {
                          color: colors.foreground,
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Scorecard</Text>
            {(
              [
                // X plus shingles 1–8 are all handled during the protocol.
                ['Manipulated shingles', 9],
                ['New collateral-damaged shingles', collateralSet.size],
                ['Mat-transfer findings on 1–2', matTransferCount],
                ['Delamination', categoryCount('delamination')],
                ['Creasing/cracking/fracture', categoryCount('creasing')],
                ['Nail-zone damage', categoryCount('nailZone')],
                ['Puncture/tear/gouge', categoryCount('puncture')],
                ['Reseating/seal-integration concerns', categoryCount('reseat')],
              ] as Array<[string, number]>
            ).map(([label, count]) => (
              <View key={label} style={styles.scoreRow}>
                <Text style={{ color: colors.foreground, flex: 1, fontSize: 14 }}>{label}</Text>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15 }}>
                  {count}
                </Text>
              </View>
            ))}
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
              This scorecard, the RAP1 photo, and up to 2 newly-damaged-shingle photos go to the
              report — priority to 1 delamination and 1 creased/cracked/fractured example.
            </Text>
          </View>
        </>
      ) : null}

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
  sectionTitle: { fontSize: 17, fontWeight: '800', marginTop: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sysToggle: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  photoThumb: { width: 56, height: 56, borderRadius: 8 },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
});

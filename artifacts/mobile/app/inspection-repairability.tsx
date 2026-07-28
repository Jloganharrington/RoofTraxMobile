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
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { getApiBaseUrl } from '@/lib/api';
import {
  captureEvidencePhoto,
  CameraPermissionDeniedError,
  persistCapturedPhotoForOutbox,
  type CapturedEvidencePhoto,
} from '@/lib/inspectionPhoto';
import { appendOptimisticPhotos, patchInspection } from '@/lib/inspectionSync';
import { drainOutbox } from '@/lib/outbox/drain';
import { enqueueOutboxItem } from '@/lib/outbox/queue';
import type { InspectionPhotoOutboxPayload } from '@/lib/outbox/types';
import { useGetInspection, getGetInspectionQueryKey } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Repairability screen — Repair Attempt Protocol (v3 assessment).
//
// Flow: warranted/authorized gate → systems → roof type (asphalt shingle
// only for now) → Repair Attempt Protocol (RAP): marking instructions, RAP1
// photo, pull procedure, mat-transfer checks on shingles 1–2,
// collateral-damage questions 1–5 over shingles 3–8, and a live scorecard of
// unique newly damaged shingles.
//
// Saving is offline-first: new photos are persisted locally and queued in
// the outbox (client-generated ids for idempotency) BEFORE the assessment
// update is queued, so the FIFO drain lands the photo rows first and the
// server's photo-id verification passes. Reopening the screen rehydrates
// the saved v3 record; saved photos render from the record's photo rows.
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

/** A protocol photo slot: a fresh local capture (pending upload) and/or the
 * saved inspection_photos row id from a previous save. A new capture
 * replaces the saved id on save. */
interface PhotoSlot {
  local: CapturedEvidencePhoto | null;
  photoId: string | null;
}

const emptyPhotoSlot = (): PhotoSlot => ({ local: null, photoId: null });

interface DamageAnswer {
  answer: YesNo | null;
  shingles: ShingleNum[];
  photo: PhotoSlot;
  note: string;
}

const emptyDamageAnswer = (): DamageAnswer => ({
  answer: null,
  shingles: [],
  photo: emptyPhotoSlot(),
  note: '',
});

const MARKING_STEPS = [
  'Identify an already damaged field shingle to be pulled',
  'Mark the damaged shingle with an "X"',
  'Mark the shingles directly below "X" as 1 & 2',
  'Mark the shingles left and right as 3 & 4',
  'Mark the two shingles above "X" as 5 & 6',
  'Mark the shingles above 5 & 6 as 7 & 8 (if needed)',
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

  // Repairability Assessment Protocol state — asphalt shingle.
  // Supplies the "Manipulated shingles" scorecard count.
  const [manipulatedCount, setManipulatedCount] = React.useState<6 | 7 | 8 | null>(null);
  const [rap1Photo, setRap1Photo] = React.useState<PhotoSlot>(emptyPhotoSlot());
  const [matTransfer, setMatTransfer] = React.useState<{ 1: YesNo | null; 2: YesNo | null }>({
    1: null,
    2: null,
  });
  const [damage, setDamage] = React.useState<Record<string, DamageAnswer>>(() =>
    Object.fromEntries(DAMAGE_QUESTIONS.map((q) => [q.key, emptyDamageAnswer()])),
  );
  const [capturing, setCapturing] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const queryClient = useQueryClient();

  // xA follow-ups only offer the shingles that were actually manipulated:
  // 3 through the answered manipulation count (e.g. 7 chosen → no 8).
  const selectableShingles = SHINGLES_3_8.filter((s) => s <= (manipulatedCount ?? 8));

  // If the count is lowered after selections were made, drop now-invalid picks.
  React.useEffect(() => {
    const max = manipulatedCount ?? 8;
    setDamage((d) => {
      let changed = false;
      const next: Record<string, DamageAnswer> = {};
      for (const [k, a] of Object.entries(d)) {
        const kept = a.shingles.filter((s) => s <= max);
        if (kept.length !== a.shingles.length) {
          changed = true;
          next[k] = { ...a, shingles: kept };
        } else {
          next[k] = a;
        }
      }
      return changed ? next : d;
    });
  }, [manipulatedCount]);

  // Existing record: rehydrate every answer so reopening never loses work.
  React.useEffect(() => {
    if (existing && !hydrated) {
      const ex = existing as unknown as {
        version?: number;
        systems?: Array<'roof' | 'siding'>;
        warranted?: 'yes' | 'not_warranted_discontinued' | 'not_authorized';
        roofType?: 'asphalt_shingle' | null;
        rap?: {
          manipulatedCount?: 6 | 7 | 8 | null;
          rap1PhotoId?: string | null;
          matTransfer?: { shingle1?: YesNo | null; shingle2?: YesNo | null };
          damage?: Record<
            string,
            { answer?: YesNo; shingles?: number[]; photoId?: string | null; note?: string | null }
          >;
        } | null;
      };
      if (ex.version === 3) {
        setWarranted(ex.warranted ?? null);
        setSystems(ex.systems ?? []);
        setRoofType(ex.roofType ?? null);
        const rap = ex.rap;
        if (rap) {
          setManipulatedCount(rap.manipulatedCount ?? null);
          setRap1Photo({ local: null, photoId: rap.rap1PhotoId ?? null });
          setMatTransfer({
            1: rap.matTransfer?.shingle1 ?? null,
            2: rap.matTransfer?.shingle2 ?? null,
          });
          setDamage(
            Object.fromEntries(
              DAMAGE_QUESTIONS.map((q) => {
                const f = rap.damage?.[q.key];
                return [
                  q.key,
                  f
                    ? {
                        answer: f.answer ?? null,
                        shingles: (f.shingles ?? []).filter(
                          (s): s is ShingleNum => s >= 3 && s <= 8,
                        ),
                        photo: { local: null, photoId: f.photoId ?? null },
                        note: f.note ?? '',
                      }
                    : emptyDamageAnswer(),
                ];
              }),
            ),
          );
        }
      } else if (ex.version === 2) {
        setSystems(ex.systems ?? []);
      }
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

  // Saved photos render from the record's photo rows (object-storage paths
  // are relative and served through the API's storage proxy).
  const photoUrlById = React.useMemo(() => {
    const map = new Map<string, string>();
    const apiBase = getApiBaseUrl().replace(/\/+$/, '');
    for (const p of inspection?.photos ?? []) {
      const url = (p as { url?: string | null }).url;
      if (!url) continue;
      map.set(p.id, url.startsWith('/objects/') ? `${apiBase}/storage${url}` : url);
    }
    return map;
  }, [inspection?.photos]);

  const slotUri = (slot: PhotoSlot): string | null =>
    slot.local?.localUri ?? (slot.photoId ? (photoUrlById.get(slot.photoId) ?? null) : null);

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
    photo: PhotoSlot,
    assign: (p: CapturedEvidencePhoto) => void,
    label: string,
  ) => {
    const uri = slotUri(photo);
    return (
      <View style={styles.photoRow}>
        {uri ? <Image source={{ uri }} style={styles.photoThumb} /> : null}
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
            {uri ? 'Retake' : label}
          </Text>
        </Pressable>
      </View>
    );
  };

  const showRap = warranted === 'yes' && systems.includes('roof') && roofType === 'asphalt_shingle';

  // Save gating: the gate question is always required; a warranted
  // assessment needs at least one system, and a roof selection needs its
  // type. Partial RAP answers are savable by design (never lose field work).
  const canSave =
    warranted != null &&
    (warranted !== 'yes' || (systems.length > 0 && (!systems.includes('roof') || roofType != null)));

  // Persist + queue one locally captured protocol photo, mirroring the
  // preliminary-photos path: durable local copy, client-generated id, outbox
  // enqueue, optimistic cache row. RAP photos are generic inspection photos
  // (no stage/roles) — the assessment references them by id.
  const queueProtocolPhoto = async (shot: CapturedEvidencePhoto): Promise<string> => {
    const persisted = await persistCapturedPhotoForOutbox(shot);
    const photoId = Crypto.randomUUID();
    const payload: InspectionPhotoOutboxPayload = {
      id: photoId,
      inspectionId: id,
      subjectType: 'inspection',
      subjectId: null,
      stage: null,
      triadRole: null,
      preliminaryRole: null,
      localFilePath: persisted.localFilePath,
      mimeType: shot.mimeType,
      sha256: persisted.sha256,
      exifJson: persisted.exifJson,
      overlayJson: persisted.overlayJson,
      capturedAtUtc: persisted.capturedAtUtc,
      latitude: persisted.latitude,
      longitude: persisted.longitude,
    };
    await enqueueOutboxItem('inspection.photo', payload);
    appendOptimisticPhotos(queryClient, id, [
      {
        id: photoId,
        subjectType: 'inspection',
        subjectId: null,
        stage: null,
        triadRole: null,
        preliminaryRole: null,
        sha256: persisted.sha256,
      },
    ]);
    return photoId;
  };

  const handleSave = async () => {
    if (!canSave || saving || !warranted) return;
    setSaving(true);
    try {
      const rapIncluded = showRap;

      // 1) Queue any NEW local captures first — the outbox drains FIFO, so
      //    the photo rows exist before the assessment update replays and the
      //    server verifies the referenced ids.
      let rap1PhotoId = rap1Photo.photoId;
      const damagePhotoIds: Record<string, string | null> = {};
      if (rapIncluded) {
        if (rap1Photo.local) {
          rap1PhotoId = await queueProtocolPhoto(rap1Photo.local);
          setRap1Photo({ local: null, photoId: rap1PhotoId });
        }
        for (const q of DAMAGE_QUESTIONS) {
          const a = damage[q.key];
          if (a.answer === 'yes' && a.photo.local) {
            const pid = await queueProtocolPhoto(a.photo.local);
            damagePhotoIds[q.key] = pid;
            setDamage((d) => ({
              ...d,
              [q.key]: { ...d[q.key], photo: { local: null, photoId: pid } },
            }));
          } else {
            damagePhotoIds[q.key] = a.photo.photoId;
          }
        }
      }

      // 2) Queue the assessment itself (v3 shape). Assessor identity is
      //    stamped server-side from the inspector's profile.
      const assessment =
        warranted === 'yes'
          ? {
              version: 3 as const,
              warranted,
              systems,
              roofType: systems.includes('roof') ? roofType : null,
              rap: rapIncluded
                ? {
                    manipulatedCount,
                    rap1PhotoId,
                    matTransfer: { shingle1: matTransfer[1], shingle2: matTransfer[2] },
                    damage: Object.fromEntries(
                      DAMAGE_QUESTIONS.filter((q) => damage[q.key].answer != null).map((q) => {
                        const a = damage[q.key];
                        const isYes = a.answer === 'yes';
                        return [
                          q.key,
                          {
                            answer: a.answer,
                            shingles: isYes ? a.shingles : [],
                            photoId: isYes ? damagePhotoIds[q.key] : null,
                            note: isYes && a.note.trim() ? a.note.trim() : null,
                          },
                        ];
                      }),
                    ),
                  }
                : null,
              recordedAtUtc: new Date().toISOString(),
            }
          : {
              version: 3 as const,
              warranted,
              systems: [],
              roofType: null,
              rap: null,
              recordedAtUtc: new Date().toISOString(),
            };

      await patchInspection(queryClient, id, {
        repairabilityAssessment: assessment,
      } as Parameters<typeof patchInspection>[2]);
      drainOutbox();
      router.back();
    } catch {
      Alert.alert('Could not save', 'Something went wrong saving the assessment. Try again.');
    } finally {
      setSaving(false);
    }
  };

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
            Repairability Assessment Protocol
          </Text>

          {renderInstructionCard('Instructions — Marking', MARKING_STEPS)}

          <Text style={[styles.qLabel, { color: colors.foreground }]}>
            How many shingles require manipulation to complete the protocol?
          </Text>
          <View style={styles.chipWrap}>
            {([6, 7, 8] as const).map((n) => {
              const on = manipulatedCount === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => setManipulatedCount(on ? null : n)}
                  style={chipStyle(on)}
                >
                  <Text style={chipText(on)}>{n}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Take Photograph (RAP1)</Text>
            {renderPhotoButton(
              'rap1',
              rap1Photo,
              (p) => setRap1Photo((prev) => ({ ...prev, local: p })),
              'Take RAP1 Photo',
            )}
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
                      {selectableShingles.map((s) => {
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
                      (p) => setA({ photo: { ...a.photo, local: p } }),
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
                // Supplied by the "How many shingles require manipulation" question.
                ['Manipulated shingles', manipulatedCount ?? 0],
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

      <Pressable
        onPress={handleSave}
        disabled={!canSave || saving}
        style={[
          styles.saveBtn,
          {
            backgroundColor: canSave && !saving ? colors.primary : colors.border,
          },
        ]}
      >
        {saving ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <Icon
            name="check"
            size={18}
            color={canSave ? colors.primaryForeground : colors.mutedForeground}
          />
        )}
        <Text
          style={{
            color: canSave && !saving ? colors.primaryForeground : colors.mutedForeground,
            fontWeight: '800',
            fontSize: 15,
          }}
        >
          Save Repairability Assessment
        </Text>
      </Pressable>
      {!canSave ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: 'center' }}>
          {warranted == null
            ? 'Answer whether an assessment is warranted and authorized to save.'
            : systems.length === 0
              ? 'Select at least one system to save.'
              : 'Select the type of roof to save.'}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
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
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 8,
  },
});

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { CaptureStage, InspectionSubjectType } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { appendOptimisticPhotos, createDamageInstance } from '@/lib/inspectionSync';
import {
  captureEvidencePhoto,
  pickEvidencePhotoFromLibrary,
  CameraPermissionDeniedError,
  MediaLibraryPermissionDeniedError,
  persistCapturedPhotoForOutbox,
  type CapturedEvidencePhoto,
  type PhotoAnnotation,
  type TriadRole,
} from '@/lib/inspectionPhoto';
import { drainOutbox } from '@/lib/outbox/drain';
import { enqueueOutboxItem } from '@/lib/outbox/queue';
import type { InspectionPhotoOutboxPayload } from '@/lib/outbox/types';

// Evidence-photo capture module (Phase M-A / A6): walks a field inspector
// through the wide -> mid -> close triad for one subject (a slope,
// elevation, or damage instance), extracting EXIF/GPS/UTC + a SHA-256 of
// the exact uploaded bytes, and letting the inspector drop point
// annotations that travel as a separate overlay JSON blob — never burned
// into the original image. Each shot uploads through the existing
// presigned storage pipeline unmodified, then the metadata + overlay is
// recorded via POST /inspections/:id/photos.
//
// This screen intentionally does not implement the rest of the S0-S9
// capture flow (stage sequencing, hard-gate validation, etc.) — that is
// lib/protocol's job and a later phase. It is a self-contained, reusable
// capture step that any calling screen can push with the right params.

const ALL_STEPS: Record<TriadRole, { role: TriadRole; title: string; hint: string }> = {
  wide: { role: 'wide', title: 'Wide shot', hint: 'Frame the entire subject area.' },
  mid: { role: 'mid', title: 'Mid shot', hint: 'Move closer to show the damage clearly.' },
  close: {
    role: 'close',
    title: 'Close-up with scale',
    hint: 'Place a coin or ruler next to the damage for scale before shooting.',
  },
};

const ROLE_ORDER: TriadRole[] = ['wide', 'mid', 'close'];

// Fixed causation vocabulary for functional damage evidence. The selection
// becomes the damage record's causation note and the photo's caption in the
// evidence output.
const CAUSATION_OPTIONS = [
  'Missing Shingle',
  'Wind Creased Shingle',
  'Wind Lifted Shingle',
  'Hail Damage',
  'Damage Excluded from Peril',
] as const;

// Parses the optional `roles` route param (e.g. "wide" for a single overview
// shot, or "wide,mid,close" for the full damage triad). Defaults to the full
// triad so existing callers keep their behaviour.
function parseRoles(raw: string | undefined): TriadRole[] {
  if (!raw) return [...ROLE_ORDER];
  const requested = raw
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is TriadRole => r === 'wide' || r === 'mid' || r === 'close');
  const ordered = ROLE_ORDER.filter((r) => requested.includes(r));
  return ordered.length > 0 ? ordered : [...ROLE_ORDER];
}

interface AnnotatedShot extends CapturedEvidencePhoto {}

export default function InspectionPhotoCaptureScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    inspectionId: string;
    subjectType: InspectionSubjectType;
    subjectId?: string;
    /** Which triad roles to require, comma-separated. Defaults to the full
     * wide,mid,close triad. Single-shot subjects (elevation/slope overview,
     * roof access) pass "wide". */
    roles?: string;
    /** Optional capture stage tag (e.g. "S2" for a roof-access photo). */
    stage?: CaptureStage;
    /** Optional header title override. */
    title?: string;
    /** When set (with `damageType`), this is a NEW functional damage capture:
     * the screen shows a causation selection and creates the damage record
     * itself once the first shot is saved — the server requires a causation
     * note on every slope-tagged damage instance. */
    damageSlopeId?: string;
    damageType?: string;
  }>();
  const steps = useMemo(() => parseRoles(params.roles).map((role) => ALL_STEPS[role]), [params.roles]);
  const [shots, setShots] = useState<Partial<Record<TriadRole, AnnotatedShot>>>({});
  // Roles already queued to the outbox this session (camera shots auto-save).
  const [savedRoles, setSavedRoles] = useState<Set<TriadRole>>(new Set());
  const [capturingRole, setCapturingRole] = useState<TriadRole | null>(null);
  const [uploadingRole, setUploadingRole] = useState<TriadRole | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [annotatingRole, setAnnotatingRole] = useState<TriadRole | null>(null);
  const [pendingAnnotation, setPendingAnnotation] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState('');

  // Causation selection for a new functional damage record. The selection is
  // stored as the damage instance's causation note AND travels as the photo
  // caption in the evidence output. Free to change until the first shot is
  // saved (the record is created lazily at that point).
  const isNewDamageCapture = Boolean(params.damageSlopeId && params.damageType);
  const [causation, setCausation] = useState<string | null>(null);
  const [damageId, setDamageId] = useState<string | null>(null);
  // Ref mirror of damageId: multi-shot save loops can re-enter queueShot
  // before the state update commits; the ref guarantees every shot in the
  // session reuses the single created damage record.
  const damageIdRef = React.useRef<string | null>(null);
  const causationLocked = damageId !== null;
  // Damage evidence shows the causation selection with just the capture
  // buttons below it — no "Wide shot" step label.
  const hideStepLabels = params.subjectType === 'damage_instance';
  const captureBlocked = isNewDamageCapture && !causation;

  const nextStep = useMemo(() => steps.find((step) => !shots[step.role]), [steps, shots]);
  const allCaptured = !nextStep;
  const unsavedSteps = steps.filter((step) => shots[step.role] && !savedRoles.has(step.role));

  // Auto-close once every required role has been saved (camera shots
  // auto-save, so a pure camera session finishes hands-free). Derived from
  // committed state so async save races can't skip the close.
  const allSaved = steps.length > 0 && steps.every((step) => savedRoles.has(step.role));
  const closedRef = React.useRef(false);
  React.useEffect(() => {
    if (allSaved && !closedRef.current) {
      closedRef.current = true;
      router.back();
    }
  }, [allSaved]);

  // Persists + queues one shot to the outbox and reflects it optimistically.
  // Returns true on success. Shared by the camera auto-save path and the
  // explicit save button for uploaded photos.
  async function queueShot(role: TriadRole, shot: AnnotatedShot): Promise<boolean> {
    const inspectionId = params.inspectionId;
    const subjectType = params.subjectType;
    if (!inspectionId || !subjectType) {
      Alert.alert('Missing context', 'This screen must be opened from an inspection subject.');
      return false;
    }
    if (isNewDamageCapture && !causation) {
      Alert.alert('Select a causation', 'Pick the causation before saving the photo.');
      return false;
    }
    setUploadingRole(role);
    try {
      // New damage capture: create the damage record (with the selected
      // causation as its required causation note) before the first photo is
      // queued, so the outbox replays the create ahead of its child photo.
      let subjectId = params.subjectId ?? damageIdRef.current;
      if (isNewDamageCapture && !subjectId) {
        subjectId = await createDamageInstance(queryClient, inspectionId, {
          slopeId: params.damageSlopeId,
          damageType: params.damageType as string,
          causationNote: causation,
        });
        damageIdRef.current = subjectId;
        setDamageId(subjectId);
      }
      const persisted = await persistCapturedPhotoForOutbox(shot);
      // The causation selection travels as the photo caption in the evidence
      // output, alongside any tap annotations.
      const overlayJson = causation
        ? { ...(persisted.overlayJson ?? {}), caption: causation }
        : persisted.overlayJson;
      const photoId = Crypto.randomUUID();
      const payload: InspectionPhotoOutboxPayload = {
        id: photoId,
        inspectionId,
        subjectType,
        subjectId: subjectId ?? null,
        stage: params.stage ?? null,
        triadRole: role,
        localFilePath: persisted.localFilePath,
        mimeType: shot.mimeType,
        sha256: persisted.sha256,
        exifJson: persisted.exifJson,
        overlayJson,
        capturedAtUtc: persisted.capturedAtUtc,
        latitude: persisted.latitude,
        longitude: persisted.longitude,
      };
      await enqueueOutboxItem('inspection.photo', payload);
      appendOptimisticPhotos(queryClient, inspectionId, [
        {
          id: photoId,
          subjectType,
          subjectId: subjectId ?? null,
          stage: params.stage ?? null,
          triadRole: role,
          sha256: persisted.sha256,
        },
      ]);
      setSavedRoles((prev) => new Set(prev).add(role));
      drainOutbox();
      return true;
    } catch {
      Alert.alert('Could not save photo', 'Something went wrong saving the photo locally. Try again.');
      return false;
    } finally {
      setUploadingRole(null);
    }
  }

  async function runPicker(
    role: TriadRole,
    pick: () => Promise<CapturedEvidencePhoto | null>,
    // Camera shots save immediately ("Use Photo" = done); the screen closes
    // itself once every required role has been saved. Uploads stay on screen
    // for review (Retake / Replace) until the save button is pressed.
    autoSave: boolean,
  ) {
    setCapturingRole(role);
    try {
      const captured = await pick();
      if (captured) {
        setShots((prev) => ({ ...prev, [role]: captured }));
        if (autoSave) await queueShot(role, captured);
        // Auto-close (once everything is saved) is handled by the effect
        // below, off committed state — not stale closure snapshots.
      }
    } catch (err) {
      if (err instanceof CameraPermissionDeniedError) {
        Alert.alert(
          'Camera access needed',
          'RoofTrax needs camera access to capture inspection photos. Enable it for RoofTrax in your device Settings, then try again.',
        );
      } else if (err instanceof MediaLibraryPermissionDeniedError) {
        Alert.alert(
          'Photo access needed',
          'RoofTrax needs access to your photos to upload an image. Enable it for RoofTrax in your device Settings, then try again.',
        );
      } else {
        console.warn('[photo-capture] photo failed', err);
        Alert.alert('Photo failed', 'Could not add the photo. Try again.');
      }
    } finally {
      setCapturingRole(null);
    }
  }

  const handleCapture = (role: TriadRole) => runPicker(role, captureEvidencePhoto, true);
  const handleUpload = (role: TriadRole) => runPicker(role, pickEvidencePhotoFromLibrary, false);
  // Retake: reshoot with the camera (auto-saves). Replace: pick a different
  // photo from the library (stays for review).
  const handleRetake = (role: TriadRole) => runPicker(role, captureEvidencePhoto, true);
  const handleReplace = (role: TriadRole) => runPicker(role, pickEvidencePhotoFromLibrary, false);

  function handlePreviewTap(role: TriadRole, event: GestureResponderEvent) {
    const { locationX, locationY } = event.nativeEvent;
    // Normalize against the fixed preview box size below so annotations
    // stay correctly positioned regardless of the source image's own
    // pixel dimensions.
    setPendingAnnotation({ x: locationX / PREVIEW_SIZE, y: locationY / PREVIEW_SIZE });
    setAnnotatingRole(role);
    setNoteText('');
  }

  function confirmAnnotation() {
    if (!annotatingRole || !pendingAnnotation) return;
    const annotation: PhotoAnnotation = { ...pendingAnnotation, note: noteText.trim() };
    setShots((prev) => {
      const shot = prev[annotatingRole];
      if (!shot) return prev;
      return { ...prev, [annotatingRole]: { ...shot, annotations: [...shot.annotations, annotation] } };
    });
    setAnnotatingRole(null);
    setPendingAnnotation(null);
    setNoteText('');
  }

  // Saves any remaining (uploaded, not-yet-saved) shots, then closes. Camera
  // shots were already queued the moment they were taken. Queueing is
  // local-first and network-independent: the outbox drainer uploads
  // immediately if online, or automatically once connectivity returns.
  async function handleSubmitAll() {
    setQueueing(true);
    try {
      for (const step of unsavedSteps) {
        const shot = shots[step.role];
        if (!shot) continue;
        const ok = await queueShot(step.role, shot);
        if (!ok) return; // queueShot already alerted
      }
    } finally {
      setQueueing(false);
    }
    // The all-saved effect closes the screen; no explicit back() here or the
    // navigator would pop twice.
  }

  const isBusy = capturingRole !== null || uploadingRole !== null || queueing;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>{params.title ?? 'Evidence photos'}</Text>
      {!hideStepLabels && (
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {(steps.length === 1
            ? 'Capture the overview shot.'
            : 'Capture a wide, mid, and close-up shot.') +
            ' Camera shots save automatically. Tap an uploaded photo to drop a note marker before saving.'}
        </Text>
      )}

      {isNewDamageCapture && (
        <View style={styles.stepBlock}>
          <Text style={[styles.stepTitle, { color: colors.foreground }]}>Causation Selection</Text>
          {CAUSATION_OPTIONS.map((option) => {
            const selected = causation === option;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  if (!causationLocked) setCausation(option);
                }}
                disabled={causationLocked && !selected}
                style={[
                  styles.causationOption,
                  {
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primary : colors.card,
                    opacity: causationLocked && !selected ? 0.4 : 1,
                  },
                ]}
              >
                <Text
                  style={{
                    color: selected ? colors.primaryForeground : colors.foreground,
                    fontWeight: selected ? '700' : '400',
                  }}
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {steps.map((step) => {
        const shot = shots[step.role];
        const isCapturingThis = capturingRole === step.role;
        const isUploadingThis = uploadingRole === step.role;
        const isSaved = savedRoles.has(step.role);

        return (
          <View key={step.role} style={styles.stepBlock}>
            {!hideStepLabels && (
              <>
                <Text style={[styles.stepTitle, { color: colors.foreground }]}>{step.title}</Text>
                <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>{step.hint}</Text>
              </>
            )}

            {shot ? (
              <View>
                <Pressable
                  onPress={isSaved ? undefined : (e) => handlePreviewTap(step.role, e)}
                  disabled={isSaved}
                >
                  <Image source={{ uri: shot.localUri }} style={styles.preview} />
                  {shot.annotations.map((a, idx) => (
                    <View
                      key={idx}
                      pointerEvents="none"
                      style={[
                        styles.marker,
                        { left: a.x * PREVIEW_SIZE - 6, top: a.y * PREVIEW_SIZE - 6, backgroundColor: colors.destructive },
                      ]}
                    />
                  ))}
                </Pressable>
                {shot.annotations.length > 0 && (
                  <Text style={[styles.annotationCount, { color: colors.mutedForeground }]}>
                    {shot.annotations.length} note{shot.annotations.length === 1 ? '' : 's'} added
                  </Text>
                )}
                {isSaved ? (
                  <View style={styles.savedRow}>
                    <Icon name="check" size={16} color={colors.success} />
                    <Text style={{ color: colors.foreground }}>Saved</Text>
                  </View>
                ) : (
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => handleRetake(step.role)}
                      style={[styles.secondaryButton, { borderColor: colors.border }]}
                      disabled={isBusy}
                    >
                      <Text style={{ color: colors.foreground }}>Retake</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleReplace(step.role)}
                      style={[styles.secondaryButton, { borderColor: colors.border }]}
                      disabled={isBusy}
                    >
                      <Text style={{ color: colors.foreground }}>Replace</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : isCapturingThis ? (
              <View style={[styles.captureButton, { borderColor: colors.border }]}>
                <ActivityIndicator />
              </View>
            ) : (
              <View style={[styles.captureRow, captureBlocked && { opacity: 0.4 }]}>
                <Pressable
                  onPress={() => handleCapture(step.role)}
                  style={[styles.captureButton, styles.captureHalf, { borderColor: colors.border }]}
                  disabled={isBusy || captureBlocked}
                >
                  <Icon name="camera" size={18} color={colors.foreground} />
                  <Text style={{ color: colors.foreground }}>Take photo</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleUpload(step.role)}
                  style={[styles.captureButton, styles.captureHalf, { borderColor: colors.border }]}
                  disabled={isBusy || captureBlocked}
                >
                  <Icon name="upload" size={18} color={colors.foreground} />
                  <Text style={{ color: colors.foreground }}>Upload</Text>
                </Pressable>
              </View>
            )}
            {isUploadingThis && (
              <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>Saving locally…</Text>
            )}
          </View>
        );
      })}

      {/* Camera shots save themselves (and the screen closes once every shot
          is in); this button only remains for saving reviewed uploads. */}
      {(!allCaptured || unsavedSteps.length > 0) && (
        <Pressable
          onPress={handleSubmitAll}
          disabled={!allCaptured || isBusy}
          style={[
            styles.submitButton,
            { backgroundColor: allCaptured && !isBusy ? colors.primary : colors.border },
          ]}
        >
          {isBusy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>
              {allCaptured
                ? 'Save photos'
                : steps.length === 1
                  ? 'Capture the shot to continue'
                  : 'Capture all shots to continue'}
            </Text>
          )}
        </Pressable>
      )}

      <Modal visible={annotatingRole !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>Add a note</Text>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="What's marked here? (optional)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setAnnotatingRole(null);
                  setPendingAnnotation(null);
                }}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmAnnotation}
                style={[styles.secondaryButton, { borderColor: colors.primary }]}
              >
                <Text style={{ color: colors.primary }}>Add marker</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const PREVIEW_SIZE = 260;

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 13 },
  stepBlock: { gap: 8 },
  stepTitle: { fontSize: 16, fontWeight: '600' },
  stepHint: { fontSize: 12 },
  preview: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: 8 },
  marker: { position: 'absolute', width: 12, height: 12, borderRadius: 6 },
  annotationCount: { fontSize: 12 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 14,
    width: PREVIEW_SIZE,
  },
  captureRow: { flexDirection: 'row', gap: 8, width: PREVIEW_SIZE },
  captureHalf: { flex: 1, width: undefined },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  submitButton: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14 },
  causationOption: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    width: PREVIEW_SIZE,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '85%', borderRadius: 12, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});

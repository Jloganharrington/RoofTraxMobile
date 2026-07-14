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
import { appendOptimisticPhotos } from '@/lib/inspectionSync';
import {
  captureEvidencePhoto,
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
  }>();
  const steps = useMemo(() => parseRoles(params.roles).map((role) => ALL_STEPS[role]), [params.roles]);
  const [shots, setShots] = useState<Partial<Record<TriadRole, AnnotatedShot>>>({});
  const [capturingRole, setCapturingRole] = useState<TriadRole | null>(null);
  const [uploadingRole, setUploadingRole] = useState<TriadRole | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [annotatingRole, setAnnotatingRole] = useState<TriadRole | null>(null);
  const [pendingAnnotation, setPendingAnnotation] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState('');

  const nextStep = useMemo(() => steps.find((step) => !shots[step.role]), [steps, shots]);
  const allCaptured = !nextStep;

  async function handleCapture(role: TriadRole) {
    setCapturingRole(role);
    try {
      const captured = await captureEvidencePhoto(role);
      if (captured) {
        setShots((prev) => ({ ...prev, [role]: captured }));
      }
    } catch {
      Alert.alert('Capture failed', 'Could not take the photo. Try again.');
    } finally {
      setCapturingRole(null);
    }
  }

  function handleRetake(role: TriadRole) {
    setShots((prev) => {
      const next = { ...prev };
      delete next[role];
      return next;
    });
  }

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

  async function handleSubmitAll() {
    const inspectionId = params.inspectionId;
    const subjectType = params.subjectType;
    if (!inspectionId || !subjectType) {
      Alert.alert('Missing context', 'This screen must be opened from an inspection subject.');
      return;
    }

    // Queueing is local-first and network-independent: each shot is
    // copied to durable storage and hashed on-device, then handed to the
    // outbox. The outbox's own drainer uploads and posts it — immediately
    // if online, automatically once connectivity returns if not. That
    // means this screen can finish (and the inspector can move on) even in
    // airplane mode.
    setQueueing(true);
    const queued: Array<{ id: string; triadRole: TriadRole; sha256: string }> = [];
    try {
      for (const step of steps) {
        const shot = shots[step.role];
        if (!shot) continue;

        setUploadingRole(step.role);
        const persisted = await persistCapturedPhotoForOutbox(shot);
        const photoId = Crypto.randomUUID();
        const payload: InspectionPhotoOutboxPayload = {
          id: photoId,
          inspectionId,
          subjectType,
          subjectId: params.subjectId ?? null,
          stage: params.stage ?? null,
          triadRole: step.role,
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
        queued.push({ id: photoId, triadRole: step.role, sha256: persisted.sha256 });
      }
    } catch {
      setQueueing(false);
      setUploadingRole(null);
      Alert.alert('Could not queue photos', 'Something went wrong saving the photos locally. Try again.');
      return;
    }
    setUploadingRole(null);
    setQueueing(false);

    // Reflect the captures in the cached inspection detail immediately so
    // gate progress updates even before (or without) a sync.
    appendOptimisticPhotos(
      queryClient,
      inspectionId,
      queued.map((q) => ({
        id: q.id,
        subjectType,
        subjectId: params.subjectId ?? null,
        stage: params.stage ?? null,
        triadRole: q.triadRole,
        sha256: q.sha256,
      })),
    );

    // Fire-and-forget: attempt an immediate sync if online, but don't make
    // the inspector wait on it — the periodic/connectivity-triggered drain
    // will retry regardless of whether this attempt succeeds.
    drainOutbox();

    Alert.alert('Photos queued', 'They will upload automatically once you have a connection.');
    router.back();
  }

  const isBusy = capturingRole !== null || uploadingRole !== null || queueing;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>{params.title ?? 'Evidence photos'}</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {steps.length === 1
          ? 'Capture the overview shot. Tap the photo afterward to drop a note marker.'
          : 'Capture a wide, mid, and close-up shot. Tap a photo afterward to drop a note marker.'}
      </Text>

      {steps.map((step) => {
        const shot = shots[step.role];
        const isCapturingThis = capturingRole === step.role;
        const isUploadingThis = uploadingRole === step.role;

        return (
          <View key={step.role} style={styles.stepBlock}>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>{step.title}</Text>
            <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>{step.hint}</Text>

            {shot ? (
              <View>
                <Pressable onPress={(e) => handlePreviewTap(step.role, e)}>
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
                <Pressable
                  onPress={() => handleRetake(step.role)}
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  disabled={isBusy}
                >
                  <Text style={{ color: colors.foreground }}>Retake</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => handleCapture(step.role)}
                style={[styles.captureButton, { borderColor: colors.border }]}
                disabled={isBusy}
              >
                {isCapturingThis ? (
                  <ActivityIndicator />
                ) : (
                  <>
                    <Icon name="camera" size={18} color={colors.foreground} />
                    <Text style={{ color: colors.foreground }}>Take photo</Text>
                  </>
                )}
              </Pressable>
            )}
            {isUploadingThis && (
              <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>Saving locally…</Text>
            )}
          </View>
        );
      })}

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
            {allCaptured ? 'Save all photos' : 'Capture all three shots to continue'}
          </Text>
        )}
      </Pressable>

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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '85%', borderRadius: 12, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});

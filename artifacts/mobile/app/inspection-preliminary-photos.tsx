import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { appendOptimisticPhotos } from '@/lib/inspectionSync';
import {
  captureEvidencePhoto,
  pickEvidencePhotoFromLibrary,
  CameraPermissionDeniedError,
  MediaLibraryPermissionDeniedError,
  persistCapturedPhotoForOutbox,
  type CapturedEvidencePhoto,
} from '@/lib/inspectionPhoto';
import { drainOutbox } from '@/lib/outbox/drain';
import { enqueueOutboxItem } from '@/lib/outbox/queue';
import type { InspectionPhotoOutboxPayload } from '@/lib/outbox/types';
import { PRELIMINARY_PHOTO_SLOTS } from '@/lib/preliminary';

// Phase 1 single-shot capture (P2). Walks the 4 preliminary evidence slots
// (front of home, roof overview, 2 damage close-ups) using the SAME evidence
// module as the forensic triad — hashed + GPS/EXIF-stamped — but one shot per
// slot, tagged with a preliminaryRole instead of a triadRole. Offline-first:
// every shot is copied to durable storage and queued in the outbox, so capture
// finishes even in airplane mode.
export default function PreliminaryPhotosScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, { query: { queryKey: getGetInspectionQueryKey(id) } });
  const existingPhotos = inspectionQuery.data?.inspection.photos ?? [];

  const [shots, setShots] = useState<Record<string, CapturedEvidencePhoto>>({});
  const [capturingKey, setCapturingKey] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  // Whether anything was saved this session — the auto-close effect only
  // fires after a save, never on merely opening a fully-captured screen.
  const [savedThisSession, setSavedThisSession] = useState(false);

  // A slot is already satisfied if a photo for its role is on the record. Both
  // close-up slots share the `damage_closeup` role, so once 2 are on the record
  // both are considered captured.
  function alreadyCaptured(slotIndex: number): boolean {
    const slot = PRELIMINARY_PHOTO_SLOTS[slotIndex];
    const onRecord = existingPhotos.filter((p) => p.preliminaryRole === slot.role).length;
    if (slot.role === 'damage_closeup') {
      const closeupSlotsBeforeInclusive = PRELIMINARY_PHOTO_SLOTS.slice(0, slotIndex + 1).filter(
        (s) => s.role === 'damage_closeup',
      ).length;
      return onRecord >= closeupSlotsBeforeInclusive;
    }
    return onRecord > 0;
  }

  // Persists + queues one shot to the outbox and reflects it optimistically in
  // the inspection cache (which flips the slot to "Captured"). Returns true on
  // success. Shared by the camera auto-save path and the save button.
  async function queueShot(
    slotKey: string,
    shot: CapturedEvidencePhoto,
  ): Promise<boolean> {
    const slot = PRELIMINARY_PHOTO_SLOTS.find((s) => s.key === slotKey);
    if (!id || !slot) {
      Alert.alert('Missing context', 'This screen must be opened from an inspection.');
      return false;
    }
    try {
      const persisted = await persistCapturedPhotoForOutbox(shot);
      const photoId = Crypto.randomUUID();
      const payload: InspectionPhotoOutboxPayload = {
        id: photoId,
        inspectionId: id,
        subjectType: 'inspection',
        subjectId: null,
        stage: null,
        triadRole: null,
        preliminaryRole: slot.role,
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
          preliminaryRole: slot.role,
          sha256: persisted.sha256,
        },
      ]);
      // The optimistic cache row now marks the slot captured; drop the local
      // pending shot so the UI reads from the record.
      setShots((prev) => {
        const next = { ...prev };
        delete next[slotKey];
        return next;
      });
      setSavedThisSession(true);
      drainOutbox();
      return true;
    } catch {
      Alert.alert('Could not save photo', 'Something went wrong saving locally. Try again.');
      return false;
    }
  }

  async function runPicker(
    key: string,
    pick: () => Promise<CapturedEvidencePhoto | null>,
    // Camera shots save immediately ("Use Photo" = done); the screen closes
    // once every slot is captured. Uploads stay for review (Retake / Replace)
    // until the save button is pressed.
    autoSave: boolean,
  ) {
    setCapturingKey(key);
    try {
      const captured = await pick();
      if (captured) {
        setShots((prev) => ({ ...prev, [key]: captured }));
        if (autoSave) await queueShot(key, captured);
        // Auto-close (once every slot is captured) is handled by the effect
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
        console.warn('[preliminary-photos] photo failed', err);
        Alert.alert('Photo failed', 'Could not add the photo. Try again.');
      }
    } finally {
      setCapturingKey(null);
    }
  }

  const handleCapture = (key: string) => runPicker(key, captureEvidencePhoto, true);
  const handleUpload = (key: string) => runPicker(key, pickEvidencePhotoFromLibrary, false);
  // Retake: reshoot with the camera (auto-saves). Replace: pick a different
  // photo from the library (stays for review).
  const handleRetake = (key: string) => runPicker(key, captureEvidencePhoto, true);
  const handleReplace = (key: string) => runPicker(key, pickEvidencePhotoFromLibrary, false);

  // Which slots still need a shot this session (not on the record, not queued).
  const pendingSlots = PRELIMINARY_PHOTO_SLOTS.filter(
    (slot, idx) => !alreadyCaptured(idx) && !shots[slot.key],
  );
  const readyToSave = PRELIMINARY_PHOTO_SLOTS.some((slot) => shots[slot.key]);
  const allDone = pendingSlots.length === 0 && !readyToSave;

  // Saves any uploaded, not-yet-saved shots, then closes. Camera shots were
  // already queued the moment they were taken; the outbox drainer uploads in
  // the background (immediately if online, later if not) with no popup.
  async function handleSaveAll() {
    setQueueing(true);
    try {
      for (const slot of PRELIMINARY_PHOTO_SLOTS) {
        const shot = shots[slot.key];
        if (!shot) continue;
        const ok = await queueShot(slot.key, shot);
        if (!ok) return; // queueShot already alerted
      }
    } finally {
      setQueueing(false);
    }
    // The auto-close effect pops the screen once everything is captured; no
    // explicit back() here or the navigator would pop twice.
  }

  const isBusy = capturingKey !== null || queueing;

  // Auto-close once every slot is on the record (optimistic rows included)
  // and nothing uploaded is still awaiting review. Derived from committed
  // state so async save races can't skip the close; gated on a save having
  // happened this session so merely opening a completed screen never pops.
  const closedRef = React.useRef(false);
  React.useEffect(() => {
    if (
      savedThisSession &&
      allDone &&
      !closedRef.current
    ) {
      closedRef.current = true;
      router.back();
    }
  }, [savedThisSession, allDone]);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text style={[styles.title, { color: colors.foreground }]}>Phase 1 photos</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Four single-shot photos. Each is hashed and GPS-stamped like forensic evidence.
      </Text>

      {PRELIMINARY_PHOTO_SLOTS.map((slot, idx) => {
        const shot = shots[slot.key];
        const onRecord = alreadyCaptured(idx);
        const isCapturingThis = capturingKey === slot.key;

        return (
          <View key={slot.key} style={styles.stepBlock}>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>{slot.title}</Text>
            <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>{slot.hint}</Text>

            {onRecord && !shot ? (
              <View style={styles.doneRow}>
                <Icon name="check" size={16} color={colors.success} />
                <Text style={{ color: colors.foreground }}>Captured</Text>
              </View>
            ) : shot ? (
              <View>
                <Image source={{ uri: shot.localUri }} style={styles.preview} />
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={() => handleRetake(slot.key)}
                    style={[styles.secondaryButton, { borderColor: colors.border }]}
                    disabled={isBusy}
                  >
                    <Text style={{ color: colors.foreground }}>Retake</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleReplace(slot.key)}
                    style={[styles.secondaryButton, { borderColor: colors.border }]}
                    disabled={isBusy}
                  >
                    <Text style={{ color: colors.foreground }}>Replace</Text>
                  </Pressable>
                </View>
              </View>
            ) : isCapturingThis ? (
              <View style={[styles.captureButton, { borderColor: colors.border }]}>
                <ActivityIndicator />
              </View>
            ) : (
              <View style={styles.captureRow}>
                <Pressable
                  onPress={() => handleCapture(slot.key)}
                  style={[styles.captureButton, styles.captureHalf, { borderColor: colors.border }]}
                  disabled={isBusy}
                >
                  <Icon name="camera" size={18} color={colors.foreground} />
                  <Text style={{ color: colors.foreground }}>Take photo</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleUpload(slot.key)}
                  style={[styles.captureButton, styles.captureHalf, { borderColor: colors.border }]}
                  disabled={isBusy}
                >
                  <Icon name="upload" size={18} color={colors.foreground} />
                  <Text style={{ color: colors.foreground }}>Upload</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      <Pressable
        onPress={handleSaveAll}
        disabled={!readyToSave || isBusy}
        style={[
          styles.submitButton,
          { backgroundColor: readyToSave && !isBusy ? colors.primary : colors.border },
        ]}
      >
        {queueing ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>
            {allDone ? 'All photos captured' : readyToSave ? 'Save photos' : 'Capture a photo to continue'}
          </Text>
        )}
      </Pressable>
      <View style={{ height: 40 }} />
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
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: 8 },
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
  actionRow: { flexDirection: 'row', gap: 8 },
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
});

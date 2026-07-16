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
  CameraPermissionDeniedError,
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

  async function handleCapture(key: string) {
    setCapturingKey(key);
    try {
      const captured = await captureEvidencePhoto();
      if (captured) setShots((prev) => ({ ...prev, [key]: captured }));
    } catch (err) {
      if (err instanceof CameraPermissionDeniedError) {
        Alert.alert(
          'Camera access needed',
          'RoofTrax needs camera access to capture inspection photos. Enable it for RoofTrax in your device Settings, then try again.',
        );
      } else {
        console.warn('[preliminary-photos] capture failed', err);
        Alert.alert('Capture failed', 'Could not take the photo. Try again.');
      }
    } finally {
      setCapturingKey(null);
    }
  }

  function handleRetake(key: string) {
    setShots((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // Which slots still need a shot this session (not on the record, not queued).
  const pendingSlots = PRELIMINARY_PHOTO_SLOTS.filter(
    (slot, idx) => !alreadyCaptured(idx) && !shots[slot.key],
  );
  const readyToSave = PRELIMINARY_PHOTO_SLOTS.some((slot) => shots[slot.key]);
  const allDone = pendingSlots.length === 0 && !readyToSave;

  async function handleSaveAll() {
    if (!id) {
      Alert.alert('Missing context', 'This screen must be opened from an inspection.');
      return;
    }
    setQueueing(true);
    const queued: Array<{
      id: string;
      preliminaryRole: (typeof PRELIMINARY_PHOTO_SLOTS)[number]['role'];
      sha256: string;
    }> = [];
    try {
      for (const slot of PRELIMINARY_PHOTO_SLOTS) {
        const shot = shots[slot.key];
        if (!shot) continue;
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
        queued.push({ id: photoId, preliminaryRole: slot.role, sha256: persisted.sha256 });
      }
    } catch {
      setQueueing(false);
      Alert.alert('Could not queue photos', 'Something went wrong saving locally. Try again.');
      return;
    }
    setQueueing(false);

    appendOptimisticPhotos(
      queryClient,
      id,
      queued.map((q) => ({
        id: q.id,
        subjectType: 'inspection',
        subjectId: null,
        stage: null,
        triadRole: null,
        preliminaryRole: q.preliminaryRole,
        sha256: q.sha256,
      })),
    );
    drainOutbox();
    Alert.alert('Photos queued', 'They will upload automatically once you have a connection.');
    router.back();
  }

  const isBusy = capturingKey !== null || queueing;

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
                <Pressable
                  onPress={() => handleRetake(slot.key)}
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  disabled={isBusy}
                >
                  <Text style={{ color: colors.foreground }}>Retake</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => handleCapture(slot.key)}
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

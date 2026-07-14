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
import { router, useLocalSearchParams } from 'expo-router';
import { useCreateInspectionPhoto } from '@workspace/api-client-react';
import type { InspectionSubjectType } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import {
  captureEvidencePhoto,
  uploadEvidencePhoto,
  type CapturedEvidencePhoto,
  type PhotoAnnotation,
  type TriadRole,
} from '@/lib/inspectionPhoto';

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

const TRIAD_STEPS: { role: TriadRole; title: string; hint: string }[] = [
  { role: 'wide', title: 'Wide shot', hint: 'Frame the entire subject area.' },
  { role: 'mid', title: 'Mid shot', hint: 'Move closer to show the damage clearly.' },
  {
    role: 'close',
    title: 'Close-up with scale',
    hint: 'Place a coin or ruler next to the damage for scale before shooting.',
  },
];

interface AnnotatedShot extends CapturedEvidencePhoto {}

export default function InspectionPhotoCaptureScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{
    inspectionId: string;
    subjectType: InspectionSubjectType;
    subjectId?: string;
  }>();
  const createPhoto = useCreateInspectionPhoto();

  const [shots, setShots] = useState<Partial<Record<TriadRole, AnnotatedShot>>>({});
  const [capturingRole, setCapturingRole] = useState<TriadRole | null>(null);
  const [uploadingRole, setUploadingRole] = useState<TriadRole | null>(null);
  const [annotatingRole, setAnnotatingRole] = useState<TriadRole | null>(null);
  const [pendingAnnotation, setPendingAnnotation] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState('');

  const nextStep = useMemo(() => TRIAD_STEPS.find((step) => !shots[step.role]), [shots]);
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

    for (const step of TRIAD_STEPS) {
      const shot = shots[step.role];
      if (!shot) continue;

      setUploadingRole(step.role);
      try {
        const uploaded = await uploadEvidencePhoto(shot);
        await createPhoto.mutateAsync({
          inspectionId,
          data: {
            subjectType,
            subjectId: params.subjectId ?? undefined,
            triadRole: step.role,
            url: uploaded.url,
            sha256: uploaded.sha256,
            exifJson: uploaded.exifJson,
            overlayJson: uploaded.overlayJson,
            capturedAtUtc: uploaded.capturedAtUtc,
            latitude: uploaded.latitude,
            longitude: uploaded.longitude,
          },
        });
      } catch {
        setUploadingRole(null);
        Alert.alert('Upload failed', `Could not save the ${step.title.toLowerCase()}. Try again.`);
        return;
      }
    }
    setUploadingRole(null);
    router.back();
  }

  const isBusy = capturingRole !== null || uploadingRole !== null || createPhoto.isPending;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Evidence photos</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Capture a wide, mid, and close-up shot. Tap a photo afterward to drop a note marker.
      </Text>

      {TRIAD_STEPS.map((step) => {
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
              <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>Uploading…</Text>
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

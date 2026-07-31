import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { patchPhotoCaption } from '@/lib/inspectionSync';
import { DamageCaptionChips } from '@/components/DamageCaptionChips';
import { isCollateralWaived } from '@/lib/inspectionProtocolState';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';

// Collateral review (protocol v2). Ground-level evidence is now captured
// during the Elevation Walk. This screen shows all captured collateral photos
// for caption review, and lets the rep mark no collateral damage found.

export default function InspectionCollateralScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  useNextSectionHeader(id, 'collateral');
  const [savingCaption, setSavingCaption] = React.useState<string | null>(null);

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Collateral & Ground' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Collateral & Ground' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const collateralPhotos = (inspection.photos ?? []).filter((p) => p.stage === 'collateral');
  const waived = isCollateralWaived(inspection);
  const addressed = collateralPhotos.length > 0 || waived;

  async function handleCaptionChange(photoId: string, caption: string | null) {
    setSavingCaption(photoId);
    try {
      await patchPhotoCaption(queryClient, id, photoId, caption);
    } catch {
      // Optimistic update stays; next refetch reconciles.
    } finally {
      setSavingCaption(null);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Collateral & Ground' }} />

      <View
        style={[
          styles.summary,
          {
            backgroundColor: addressed ? '#ecfdf5' : colors.card,
            borderColor: addressed ? colors.success : colors.border,
          },
        ]}
      >
        <Icon
          name={addressed ? 'check' : 'camera'}
          size={22}
          color={addressed ? colors.success : colors.primary}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
            {collateralPhotos.length > 0
              ? `${collateralPhotos.length} collateral photo${collateralPhotos.length === 1 ? '' : 's'} captured`
              : waived
                ? 'No collateral damage found'
                : 'No collateral photos yet'}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            Ground-level evidence captured during the elevation walk. Label each photo below.
          </Text>
        </View>
      </View>

      {/* Per-photo caption chips — shown for every captured collateral photo. */}
      {collateralPhotos.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={[styles.section, { color: colors.foreground }]}>Caption each photo</Text>
          {collateralPhotos.map((photo, index) => {
            const caption = photo.overlayJson
              ? ((photo.overlayJson as Record<string, unknown>).caption as string | null) ?? null
              : null;
            return (
              <View
                key={photo.id}
                style={[
                  styles.photoRow,
                  { backgroundColor: colors.card, borderColor: caption ? colors.success : colors.border },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
                  <Icon name="image" size={18} color={colors.mutedForeground} />
                  <Text style={{ color: colors.foreground, fontWeight: '600', flex: 1 }}>
                    Collateral photo {index + 1}
                  </Text>
                  {caption ? (
                    <View style={[styles.captionBadge, { backgroundColor: colors.primary }]}>
                      <Text style={{ color: colors.primaryForeground, fontSize: 10, fontWeight: '700' }}>
                        {caption.split(' – ')[1] ?? caption}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                  <DamageCaptionChips
                    value={caption}
                    saving={savingCaption === photo.id}
                    onChange={(c) => handleCaptionChange(photo.id, c)}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  summaryTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 6 },
  photoRow: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  captionBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
});

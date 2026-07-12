import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '@/components/Icon';
import { router } from 'expo-router';
import { useBulkCreatePins } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { uploadFile } from '@/lib/upload';

interface DroneAsset {
  uri: string;
  mimeType: string;
  latitude: number;
  longitude: number;
}

// EXIF GPS tags follow the standard GPSLatitude/GPSLongitude (decimal
// degrees, already sign-adjusted by expo-image-picker) or the
// Ref-suffixed variants that require applying N/S/E/W sign manually.
function extractGps(exif: Record<string, any> | null | undefined) {
  if (!exif) return null;

  let lat = exif.GPSLatitude ?? exif.gpsLatitude;
  let lng = exif.GPSLongitude ?? exif.gpsLongitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const latRef = exif.GPSLatitudeRef;
  const lngRef = exif.GPSLongitudeRef;
  if (latRef === 'S' && lat > 0) lat = -lat;
  if (lngRef === 'W' && lng > 0) lng = -lng;

  return { latitude: lat, longitude: lng };
}

export default function BulkUploadScreen() {
  const colors = useColors();
  const bulkCreate = useBulkCreatePins();
  const [assets, setAssets] = useState<DroneAsset[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  async function handlePickPhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      exif: true,
      quality: 0.7,
    });
    if (result.canceled) return;

    const withGps: DroneAsset[] = [];
    let skipped = 0;

    for (const asset of result.assets) {
      const gps = extractGps((asset as any).exif);
      if (gps) {
        withGps.push({
          uri: asset.uri,
          mimeType: asset.mimeType ?? 'image/jpeg',
          ...gps,
        });
      } else {
        skipped += 1;
      }
    }

    setAssets(withGps);
    setSkippedCount(skipped);
  }

  async function handleUploadAll() {
    if (assets.length === 0) return;
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const pins: { latitude: number; longitude: number; photoUrl: string }[] = [];
      for (const asset of assets) {
        const photoUrl = await uploadFile(asset.uri, asset.mimeType);
        pins.push({ latitude: asset.latitude, longitude: asset.longitude, photoUrl });
        setUploadProgress((p) => p + 1);
      }

      bulkCreate.mutate(
        { data: { pins } },
        {
          onSuccess: () => router.back(),
          onError: () => Alert.alert('Error', 'Could not save the pins.'),
          onSettled: () => setIsUploading(false),
        },
      );
    } catch {
      setIsUploading(false);
      Alert.alert('Upload failed', 'One of the photos could not be uploaded.');
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.intro, { color: colors.mutedForeground }]}>
        Select geotagged drone photos. Pins are dropped automatically using
        each photo's embedded GPS location.
      </Text>

      <Pressable
        onPress={handlePickPhotos}
        style={[styles.pickButton, { borderColor: colors.border }]}
      >
        <Icon name="image" size={18} color={colors.foreground} />
        <Text style={{ color: colors.foreground, fontWeight: '600' }}>
          Choose photos
        </Text>
      </Pressable>

      {skippedCount > 0 && (
        <Text style={{ color: colors.destructive, fontSize: 13 }}>
          {skippedCount} photo(s) had no GPS data and were skipped.
        </Text>
      )}

      <FlatList
        data={assets}
        keyExtractor={(item) => item.uri}
        numColumns={3}
        contentContainerStyle={{ gap: 8, paddingVertical: 12 }}
        columnWrapperStyle={{ gap: 8 }}
        renderItem={({ item }) => (
          <Image source={{ uri: item.uri }} style={styles.thumb} />
        )}
      />

      {assets.length > 0 && (
        <Pressable
          onPress={handleUploadAll}
          disabled={isUploading}
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
        >
          {isUploading ? (
            <View style={styles.uploadingRow}>
              <ActivityIndicator color={colors.primaryForeground} />
              <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
                Uploading {uploadProgress}/{assets.length}
              </Text>
            </View>
          ) : (
            <Text style={{ color: colors.primaryForeground, fontWeight: '700', fontSize: 16 }}>
              Drop {assets.length} pin{assets.length === 1 ? '' : 's'}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingTop: Platform.OS === 'web' ? 32 : 16,
    gap: 12,
  },
  intro: { fontSize: 14, lineHeight: 20 },
  pickButton: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
  },
  thumb: { width: 100, height: 100, borderRadius: 8 },
  saveButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  uploadingRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});

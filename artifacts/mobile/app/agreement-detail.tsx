/**
 * Full-screen PDF viewer for a signed FIPSA agreement.
 * Receives a short-lived presigned download URL from the agreements list
 * and renders it in a WebView.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';

export default function AgreementDetailScreen() {
  const colors = useColors();
  const { downloadUrl, propertyAddress, signerName } =
    useLocalSearchParams<{
      downloadUrl: string;
      propertyAddress?: string;
      signerName?: string;
    }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const title = propertyAddress || 'Signed Agreement';

  async function handleShare() {
    if (!downloadUrl) return;
    try {
      await Share.share({
        message: `Signed agreement for ${title}${signerName ? ` — signed by ${signerName}` : ''}\n\n${downloadUrl}`,
        url: downloadUrl,
        title: `Signed Agreement — ${title}`,
      });
    } catch {
      // User cancelled or platform doesn't support URL share — ignore
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: 'Agreement',
          headerStyle: { backgroundColor: colors.secondary },
          headerTintColor: '#ffffff',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginLeft: 4 }}>
              <Icon name="chevron-left" size={22} color="#ffffff" />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={handleShare} hitSlop={12} style={{ marginRight: 4 }}>
              <Icon name="send" size={20} color="#ffffff" />
            </Pressable>
          ),
        }}
      />

      {/* Property label bar */}
      <View style={[styles.labelBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Icon name="file-text" size={16} color={colors.primary} />
        <Text style={[styles.labelText, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {!downloadUrl ? (
        <View style={styles.centered}>
          <Icon name="alert-circle" size={36} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            PDF link unavailable
          </Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Icon name="alert-circle" size={36} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Could not load the PDF. The link may have expired.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Go back</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {loading && (
            <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                Loading agreement…
              </Text>
            </View>
          )}
          <WebView
            source={{ uri: downloadUrl }}
            style={{ flex: 1 }}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true); }}
            onHttpError={() => { setLoading(false); setError(true); }}
            startInLoadingState={false}
            allowsInlineMediaPlayback
            scalesPageToFit
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  labelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  labelText: { flex: 1, fontSize: 14, fontWeight: '600' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 40,
  },
  errorText: { fontSize: 15, textAlign: 'center', fontWeight: '600' },
  backBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 14 },
});

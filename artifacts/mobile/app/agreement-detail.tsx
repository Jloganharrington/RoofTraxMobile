/**
 * Full-screen PDF viewer for a signed FIPSA agreement.
 *
 * Fetches a fresh agreement record on mount via GET /inspections/:id/agreement,
 * then serves the PDF through the authenticated storage proxy
 * (GET /storage/objects/*path) with a Bearer token header — avoids GCS
 * presigned URLs entirely, which require a service-account client_email that
 * isn't available in this environment.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useGetAgreement } from '@/lib/agreementApi';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';

export default function AgreementDetailScreen() {
  const colors = useColors();
  const { inspectionId, propertyAddress, signerName } =
    useLocalSearchParams<{
      inspectionId: string;
      propertyAddress?: string;
      signerName?: string;
    }>();

  // Always fetch a fresh agreement record — never rely on a cached list URL.
  const { data, isLoading: agreementLoading, isError: agreementError } =
    useGetAgreement(inspectionId ?? '');

  const documentObjectPath = data?.agreement?.documentObjectPath ?? null;

  // Build a WebView source with Bearer auth once we have the object path.
  const [webviewSource, setWebviewSource] = useState<{
    uri: string;
    headers: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    if (!documentObjectPath) return;
    void getToken('auth_session_token').then((token) => {
      setWebviewSource({
        uri: `${getApiBaseUrl()}/storage${documentObjectPath}`,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    });
  }, [documentObjectPath]);

  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState(false);

  const title = propertyAddress || 'Signed Agreement';

  // ── Derived display state ────────────────────────────────────────────────

  // Still waiting on the agreement fetch or token load.
  const isLoading = agreementLoading || (!webviewSource && !!documentObjectPath);

  // Agreement fetched, not voided, but something still went wrong.
  const noPdf =
    !agreementLoading &&
    !agreementError &&
    !documentObjectPath;

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
        }}
      />

      {/* Property label bar */}
      <View style={[styles.labelBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Icon name="file-text" size={16} color={colors.primary} />
        <Text style={[styles.labelText, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading agreement…
          </Text>
        </View>
      ) : agreementError ? (
        <View style={styles.centered}>
          <Icon name="alert-circle" size={36} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Could not reach the server. Check your connection and try again.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Go back</Text>
          </Pressable>
        </View>
      ) : noPdf ? (
        <View style={styles.centered}>
          <Icon name="alert-circle" size={36} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            No signed agreement found for this inspection.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Go back</Text>
          </Pressable>
        </View>
      ) : webError ? (
        <View style={styles.centered}>
          <Icon name="alert-circle" size={36} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Could not load the PDF. Try going back and opening it again.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Go back</Text>
          </Pressable>
        </View>
      ) : webviewSource ? (
        <>
          {webLoading && (
            <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                Loading PDF…
              </Text>
            </View>
          )}
          <WebView
            source={webviewSource}
            style={{ flex: 1 }}
            onLoadEnd={() => setWebLoading(false)}
            onError={() => { setWebLoading(false); setWebError(true); }}
            onHttpError={() => { setWebLoading(false); setWebError(true); }}
            startInLoadingState={false}
            allowsInlineMediaPlayback
            scalesPageToFit
          />
        </>
      ) : null}
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

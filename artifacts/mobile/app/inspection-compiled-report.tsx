import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';
import { useProfile } from '@/hooks/useProfile';

// The Gemini-compiled HTML forensic report in a full-screen WebView.
// Fetches a short-lived signed URL from GET /inspections/:id/report/preview-url,
// then renders the HTML in a WebView — the same pattern used by the homeowner
// report and the FIPSA agreement viewer.

export default function InspectionCompiledReportScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role } = useProfile();
  const isReviewer = role === 'manager' || role === 'admin' || role === 'super_admin';

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The server returns the full HTML string (not a signed URL), so photo URLs
  // are always fresh — they're re-signed at the time of this fetch, not at
  // compile time. The WebView renders the HTML string directly via source.html.
  const [html, setHtml] = useState<string | null>(null);

  const fetchHtml = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken('auth_session_token');
      // review=1: managers/admins may open a blocked version for review; the
      // server enforces the role check, so the flag is inert for field reps.
      // Export/consumer fetches without the flag stay gated until resolved.
      const reviewParam = isReviewer ? '?review=1' : '';
      const res = await fetch(`${getApiBaseUrl()}/inspections/${id}/report/preview-url${reviewParam}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      const data = (await res.json()) as { html: string };
      setHtml(data.html);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [id, isReviewer]);

  useEffect(() => { void fetchHtml(); }, [fetchHtml]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: 'Forensic Report',
          headerRight: () =>
            loading ? <ActivityIndicator color={colors.primary} /> : null,
        }}
      />

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={{ color: colors.mutedForeground, marginTop: 12, fontSize: 14 }}>
            Loading report…
          </Text>
        </View>
      )}

      {error && !loading && (
        <View style={styles.centered}>
          <Icon name="alert-circle" size={32} color={colors.destructive} />
          <Text style={{ color: colors.destructive, marginTop: 12, fontSize: 14, textAlign: 'center' }}>
            {error}
          </Text>
          <Pressable onPress={fetchHtml} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Icon name="refresh-cw" size={14} color={colors.primaryForeground} />
            <Text style={{ color: colors.primaryForeground, fontWeight: '700', fontSize: 14 }}>
              Retry
            </Text>
          </Pressable>
        </View>
      )}

      {html && !loading && (
        <WebView
          source={{ html, baseUrl: '' }}
          style={{ flex: 1 }}
          // The report is a static HTML document — JavaScript is disabled to
          // prevent any model-generated script from executing in-app.
          javaScriptEnabled={false}
          // Block all navigation out of the local document.
          onShouldStartLoadWithRequest={(request) => {
            // Allow the initial about:blank or data: load only.
            return request.url === 'about:blank' || request.url.startsWith('data:');
          }}
          onError={(e) =>
            Alert.alert('Load error', e.nativeEvent.description ?? 'Could not render report')
          }
          startInLoadingState
          renderLoading={() => (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          )}
          originWhitelist={['about:*', 'data:*']}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 8,
  },
});

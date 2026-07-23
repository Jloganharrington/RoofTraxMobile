import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as Network from 'expo-network';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getGetInspectionQueryKey } from '@workspace/api-client-react';
import type { InspectionEnvelope } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { buildProtocolState } from '@/lib/inspectionProtocolState';
import { persistScreenshotForOutbox } from '@/lib/bugReportScreenshot';
import { enqueueOutboxItem, listAllOutboxItems } from '@/lib/outbox/queue';
import { drainOutbox } from '@/lib/outbox/drain';
import type { BugReportOutboxPayload } from '@/lib/outbox/types';

// Temporary beta instrument (flag-gated via companies.betaBugReporting → the
// profile envelope). One floating pill mounted once in the root layout — the
// current screen is DERIVED from the router, never wired per-screen. The
// deliverable is the auto-captured context: a roofer types one sentence; the
// screen, app version, inspection state, and outbox health ride along.

type Severity = BugReportOutboxPayload['severity'];

const SEVERITIES: Array<{ value: Severity; label: string }> = [
  { value: 'blocks_me', label: 'Blocks me' },
  { value: 'annoying', label: 'Annoying' },
  { value: 'cosmetic', label: 'Cosmetic' },
];

/** "/inspection-photo-capture" → "Inspection Photo Capture" */
function humanizeRoute(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean).pop() ?? 'Home';
  const cleaned = segment.replace(/[[\]()]/g, '').replace(/[-_]/g, ' ').trim();
  if (!cleaned) return 'Home';
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Screens whose primary CTA / shutter sits at the bottom of the screen: the
// pill floats higher there so it never covers the capture or submit action.
const RAISED_ROUTES = ['inspection-photo-capture', 'inspection-readiness'];

export function BugReportButton() {
  const colors = useColors();
  const pathname = usePathname();
  const params = useGlobalSearchParams<Record<string, string | string[]>>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { betaBugReporting, role, department } = useProfile();

  const [open, setOpen] = React.useState(false);
  const [description, setDescription] = React.useState('');
  const [severity, setSeverity] = React.useState<Severity>('annoying');
  const [screenshotUri, setScreenshotUri] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState<{
    route: string;
    routeParams: Record<string, unknown> | null;
    context: Record<string, unknown>;
  } | null>(null);

  const [toastVisible, setToastVisible] = React.useState(false);
  const toastOpacity = React.useRef(new Animated.Value(0)).current;

  if (!betaBugReporting) return null;

  // Snapshot the context at open time — the whole point of the feature.
  async function handleOpen() {
    const route = pathname;
    const routeParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params ?? {})) routeParams[k] = v;

    const context: Record<string, unknown> = {
      route,
      routeParams,
      userId: user?.id ?? null,
      companyId: user?.companyId ?? null,
      role,
      department,
      appVersion: Constants.expoConfig?.version ?? null,
      buildNumber:
        Constants.expoConfig?.ios?.buildNumber ??
        Constants.expoConfig?.android?.versionCode?.toString() ??
        null,
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      capturedAt: new Date().toISOString(),
    };

    // Outbox health — distinguishes "app broke" from "sync backed up".
    try {
      const items = await listAllOutboxItems();
      const unsynced = items.filter((i) => i.status !== 'done');
      context.pendingOutboxCount = unsynced.length;
      context.deadOutboxCount = items.filter((i) => i.status === 'dead').length;
      context.lastSyncError =
        [...items].reverse().find((i) => i.lastError != null)?.lastError ?? null;
    } catch {
      context.outboxReadError = true;
    }

    try {
      const net = await Network.getNetworkStateAsync();
      context.isOnline = Boolean(net.isConnected && net.isInternetReachable !== false);
    } catch {
      context.isOnline = null;
    }

    // Mid-inspection context, read from the query cache (offline-safe: no
    // fetch — if the record isn't cached, we simply record less).
    const inspectionId =
      typeof routeParams.id === 'string' && route.includes('inspection') ? routeParams.id : null;
    if (inspectionId) {
      context.inspectionId = inspectionId;
      const cached = queryClient.getQueryData<InspectionEnvelope>(
        getGetInspectionQueryKey(inspectionId),
      );
      const inspection = cached?.inspection;
      if (inspection) {
        context.inspectionPhase = (inspection as { phase?: string }).phase ?? null;
        try {
          const state = buildProtocolState(inspection);
          context.damageFlags = state.damageFlags;
        } catch {
          // Protocol mapping failure is itself useful signal; don't block.
          context.protocolStateError = true;
        }
      }
    }
    // The screen the reporter is on doubles as the current step.
    context.currentStep = humanizeRoute(route);

    setSnapshot({ route, routeParams, context });
    setDescription('');
    setSeverity('annoying');
    setScreenshotUri(null);
    setOpen(true);
  }

  async function handleAttachScreenshot() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photos access needed', 'Allow photo access to attach a screenshot.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) setScreenshotUri(result.assets[0].uri);
    } catch {
      Alert.alert('Could not attach', 'The screenshot could not be attached. Try again.');
    }
  }

  function showToast() {
    setToastVisible(true);
    Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(
        () => setToastVisible(false),
      );
    }, 3500);
  }

  // Submit = enqueue locally, close, toast. NEVER blocks on the network — the
  // report drains with the outbox exactly like inspection captures.
  async function handleSubmit() {
    if (!snapshot || submitting) return;
    const trimmed = description.trim();
    if (!trimmed) {
      Alert.alert('Describe the problem', 'A sentence is enough — the context rides along.');
      return;
    }
    setSubmitting(true);
    try {
      // Copy the screenshot into stable app storage first (local-only, works
      // offline) so the OS can't evict the picker cache before it uploads.
      let screenshotLocalPath: string | null = null;
      let screenshotMimeType: string | null = null;
      if (screenshotUri) {
        const persisted = await persistScreenshotForOutbox(screenshotUri);
        screenshotLocalPath = persisted.localFilePath;
        screenshotMimeType = persisted.mimeType;
      }

      const payload: BugReportOutboxPayload = {
        id: Crypto.randomUUID(),
        route: snapshot.route,
        routeParams: snapshot.routeParams,
        severity,
        description: trimmed,
        context: snapshot.context,
        screenshotLocalPath,
        screenshotMimeType,
        appVersion: (snapshot.context.appVersion as string | null) ?? null,
        platform: Platform.OS,
        osVersion: String(Platform.Version),
        capturedAt: (snapshot.context.capturedAt as string) ?? new Date().toISOString(),
      };
      await enqueueOutboxItem('bug_report', payload);
      setOpen(false);
      showToast();
      // Opportunistic drain; failure is fine — the sync loop will retry.
      void drainOutbox().catch(() => {});
    } catch {
      Alert.alert('Could not save report', 'Something went wrong saving the report. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const raised = RAISED_ROUTES.some((r) => pathname.includes(r));

  return (
    <>
      <Pressable
        onPress={handleOpen}
        style={[
          styles.fab,
          { backgroundColor: colors.card, borderColor: colors.border, bottom: raised ? 170 : 96 },
        ]}
        accessibilityLabel="Report a bug"
      >
        <Icon name="alert-circle" size={14} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontWeight: '600' }}>Bug?</Text>
      </Pressable>

      {toastVisible && (
        <Animated.View
          pointerEvents="none"
          style={[styles.toast, { backgroundColor: colors.foreground, opacity: toastOpacity }]}
        >
          <Text style={{ color: colors.background, fontSize: 13, fontWeight: '600' }}>
            Thanks — sent. Logan can reach you at the number on your profile.
          </Text>
        </Animated.View>
      )}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!submitting) setOpen(false);
        }}
      >
        <View style={styles.overlay}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.card, { backgroundColor: colors.background }]}>
              <Text style={[styles.title, { color: colors.foreground }]}>Report a bug</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                Reporting from: {snapshot ? humanizeRoute(snapshot.route) : ''}
              </Text>

              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What went wrong?"
                placeholderTextColor={colors.mutedForeground}
                multiline
                autoFocus
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border, minHeight: 90 },
                ]}
              />

              <View style={{ flexDirection: 'row', gap: 8 }}>
                {SEVERITIES.map((s) => (
                  <Pressable
                    key={s.value}
                    onPress={() => setSeverity(s.value)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: severity === s.value ? colors.primary : colors.muted,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: severity === s.value ? colors.primaryForeground : colors.foreground,
                        fontSize: 12,
                        fontWeight: '600',
                      }}
                    >
                      {s.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {screenshotUri ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Image source={{ uri: screenshotUri }} style={styles.thumb} />
                  <Pressable onPress={() => setScreenshotUri(null)}>
                    <Text style={{ color: colors.destructive, fontWeight: '600', fontSize: 13 }}>
                      Remove screenshot
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={handleAttachScreenshot}
                  style={[styles.attachBtn, { borderColor: colors.border }]}
                >
                  <Icon name="image" size={16} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    Attach screenshot (optional)
                  </Text>
                </Pressable>
              )}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => setOpen(false)}
                  disabled={submitting}
                  style={[styles.btn, { borderColor: colors.border, borderWidth: 1 }]}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSubmit}
                  disabled={submitting}
                  style={[
                    styles.btn,
                    { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
                      Submit
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.75,
    // Above screen content but below modals.
    zIndex: 40,
    elevation: 4,
  },
  toast: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    padding: 14,
    borderRadius: 12,
    zIndex: 60,
    elevation: 8,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { borderRadius: 16, padding: 16, gap: 12 },
  title: { fontSize: 16, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    padding: 12,
    justifyContent: 'center',
  },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

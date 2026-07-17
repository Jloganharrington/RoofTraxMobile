import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '@/components/Icon';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import {
  getGetMyProfileQueryKey,
  useListPins,
  useUpdateProfileSignature,
} from '@workspace/api-client-react';
import type { DamageType, DoorKnockResult, Pin, PinWorkflow } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { saveSignatureFromDataUrl } from '@/lib/profileSignature';

const ROLE_LABELS: Record<string, string> = {
  field_rep: 'Field Rep',
  manager: 'Manager',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

const WORKFLOW_LABELS: Record<string, string> = {
  retail: 'Retail',
  insurance_retail: 'Insurance + Retail',
};

const DEPARTMENT_LABELS: Record<string, string> = {
  canvasser: 'Canvasser',
  inspector_canvasser: 'Inspector Canvasser',
};

const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  roof: 'Roof',
  siding: 'Siding',
  roof_and_siding: 'Roof & siding',
};

const DOOR_KNOCK_LABELS: Record<DoorKnockResult, string> = {
  no_answer: 'No answer',
  no_appointment: 'No appointment',
  appointment: 'Appointment',
};

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function pinSubtitle(pin: Pin): string {
  if (pin.workflow === 'retail') {
    return pin.doorKnockResult ? DOOR_KNOCK_LABELS[pin.doorKnockResult] : 'Door knock';
  }
  return pin.damageType ? DAMAGE_TYPE_LABELS[pin.damageType] : 'Damage pin';
}

export default function ProfileScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const {
    role,
    workflowAssignment,
    department,
    companyId,
    companyName,
    signatureUrl,
    signatureSignedAt,
    isLoading: profileLoading,
  } = useProfile();
  const pinsQuery = useListPins();
  const pins = pinsQuery.data?.pins ?? [];

  // Set when another screen (e.g. the inspection declaration) sent the user
  // here specifically to capture a signature: auto-open the pad, and return
  // to where they came from once it's saved so they don't lose their place
  // mid-inspection.
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const cameToCapture = returnTo === '1';

  const signatureRef = React.useRef<SignatureViewRef>(null);
  const [capturing, setCapturing] = React.useState(cameToCapture);
  React.useEffect(() => {
    if (cameToCapture) setCapturing(true);
  }, [cameToCapture]);
  const [savingSignature, setSavingSignature] = React.useState(false);
  const updateSignature = useUpdateProfileSignature();

  // Uploads the drawn signature to object storage and records it on the
  // profile. Requires connectivity (unlike field captures) — signatures are set
  // up once, not in the field.
  async function handleSignature(dataUrl: string) {
    if (savingSignature) return;
    setSavingSignature(true);
    try {
      const { signatureUrl: url, signatureSha256 } = await saveSignatureFromDataUrl(dataUrl);
      await updateSignature.mutateAsync({
        data: { signatureUrl: url, signatureSha256 },
      });
      await queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      setCapturing(false);
      if (cameToCapture && router.canGoBack()) {
        // Return to the screen that sent us here (the inspection declaration),
        // so the rep can finish signing without hunting for their inspection.
        router.back();
      }
    } catch {
      Alert.alert(
        'Could not save signature',
        'Check your connection and try again. A signature must be saved before you can submit an inspection.',
      );
    } finally {
      setSavingSignature(false);
    }
  }

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Field rep';

  const totalPins = pins.length;
  const insurancePins = pins.filter((p: Pin) => p.workflow === ('insurance' as PinWorkflow)).length;
  const retailPins = pins.filter((p: Pin) => p.workflow === ('retail' as PinWorkflow)).length;
  const activePins = pins.filter((p: Pin) => p.status === 'active').length;

  function handleLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {user?.profileImageUrl ? (
          <Image source={{ uri: user.profileImageUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: colors.secondary }]}>
            <Icon name="user" size={28} color="#ffffff" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]}>{name}</Text>
          {user?.email && (
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{user.email}</Text>
          )}
          {!profileLoading && (
            <View style={styles.chipRow}>
              <View style={[styles.chip, { backgroundColor: colors.secondary }]}>
                <Text style={styles.chipText}>{ROLE_LABELS[role] ?? role}</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: colors.muted }]}>
                <Text style={[styles.chipText, { color: colors.foreground }]}>
                  {WORKFLOW_LABELS[workflowAssignment] ?? workflowAssignment}
                </Text>
              </View>
              <View style={[styles.chip, { backgroundColor: colors.muted }]}>
                <Text style={[styles.chipText, { color: colors.foreground }]}>
                  {DEPARTMENT_LABELS[department] ?? department}
                </Text>
              </View>
            </View>
          )}
          {companyId && (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
              {companyName ? `${companyName} · ` : ''}Company ID: {companyId}
            </Text>
          )}
        </View>
      </View>

      <View style={[styles.sigCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sigHeader}>
          <Icon name="edit-3" size={18} color={colors.foreground} />
          <Text style={[styles.sigTitle, { color: colors.foreground }]}>Signature on file</Text>
          {signatureUrl ? (
            <View style={[styles.sigBadge, { backgroundColor: '#ecfdf5' }]}>
              <Text style={[styles.sigBadgeText, { color: colors.success }]}>On file</Text>
            </View>
          ) : (
            <View style={[styles.sigBadge, { backgroundColor: '#fffbeb' }]}>
              <Text style={[styles.sigBadgeText, { color: '#b45309' }]}>Required</Text>
            </View>
          )}
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
          {signatureUrl
            ? `Your signature is applied to inspection declarations.${
                signatureSignedAt
                  ? ` Captured ${new Date(signatureSignedAt).toLocaleDateString()}.`
                  : ''
              }`
            : 'Capture your signature once here. It is applied to every inspection declaration you sign — you cannot submit an inspection without it.'}
        </Text>

        {signatureUrl && !capturing ? (
          <Image
            source={{ uri: signatureUrl }}
            style={styles.sigPreview}
            resizeMode="contain"
          />
        ) : null}

        <Pressable
          onPress={() => setCapturing(true)}
          style={[styles.sigButton, { backgroundColor: colors.secondary }]}
        >
          <Text style={styles.sigButtonText}>
            {signatureUrl ? 'Replace signature' : 'Capture signature'}
          </Text>
        </Pressable>
      </View>

      {/* Signature capture lives in a fixed modal (not inline in the
          ScrollView) so drawing strokes never fight the scroll gesture and
          the pad stays put on screen. */}
      <Modal
        visible={capturing}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!savingSignature) setCapturing(false);
        }}
      >
        <View style={styles.sigModalOverlay}>
          <View style={[styles.sigModalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.sigTitle, { color: colors.foreground }]}>
              Draw your signature
            </Text>
            <View style={[styles.sigPadWrap, { borderColor: colors.border }]}>
              <SignatureScreen
                ref={signatureRef}
                onOK={handleSignature}
                descriptionText=""
                clearText="Clear"
                confirmText="Save signature"
                webStyle={SIGNATURE_WEB_STYLE}
              />
            </View>
            {savingSignature ? (
              <View style={styles.sigSavingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.mutedForeground }}>Saving signature…</Text>
              </View>
            ) : (
              <>
                <View style={styles.sigModalActions}>
                  <Pressable
                    onPress={() => signatureRef.current?.clearSignature()}
                    style={[styles.sigModalBtn, { borderColor: colors.border, borderWidth: 1 }]}
                  >
                    <Text style={{ color: colors.foreground, fontWeight: '600' }}>Clear</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => signatureRef.current?.readSignature()}
                    style={[styles.sigModalBtn, { backgroundColor: colors.primary }]}
                  >
                    <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
                      Save signature
                    </Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => setCapturing(false)} style={styles.sigCancel}>
                  <Text style={{ color: colors.mutedForeground, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Pressable
        onPress={handleLogout}
        style={[styles.logoutButton, { borderColor: colors.destructive }]}
      >
        <Icon name="log-out" size={18} color={colors.destructive} />
        <Text style={{ color: colors.destructive, fontWeight: '600' }}>Log out</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My pins</Text>
      {pinsQuery.isLoading ? (
        <ActivityIndicator />
      ) : (
        <View style={styles.statsGrid}>
          <StatCard label="Total pins" value={totalPins} color={colors.foreground} />
          <StatCard label="Active" value={activePins} color={colors.success} />
          <StatCard label="Insurance" value={insurancePins} color={colors.insurance} />
          <StatCard label="Retail" value={retailPins} color={colors.retail} />
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 20 }]}>
        Recent activity
      </Text>
      {pinsQuery.isLoading ? (
        <ActivityIndicator />
      ) : pins.length === 0 ? (
        <Text style={{ color: colors.mutedForeground }}>You haven't dropped any pins yet.</Text>
      ) : (
        pins.map((pin: Pin) => (
          <Pressable
            key={pin.id}
            onPress={() => router.push({ pathname: '/pin-edit', params: { pin: JSON.stringify(pin) } })}
            style={[styles.pinCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.pinAddress, { color: colors.foreground }]} numberOfLines={1}>
                {pin.address ?? `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {pinSubtitle(pin)} · {new Date(pin.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <View
              style={[
                styles.workflowDot,
                { backgroundColor: pin.workflow === 'retail' ? colors.retail : colors.insurance },
              ]}
            />
            <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

// Trims the signature pad's WebView chrome so only the canvas + buttons show.
const SIGNATURE_WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: none; margin: 0; }
  .m-signature-pad--body { border: none; }
  .m-signature-pad--footer { display: none; }
  body, html { height: 100%; margin: 0; }
`;

const styles = StyleSheet.create({
  container: { flex: 1 },
  sigCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    marginBottom: 12,
  },
  sigHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sigTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  sigBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  sigBadgeText: { fontSize: 12, fontWeight: '700' },
  sigPreview: { width: '100%', height: 90, backgroundColor: '#fff', borderRadius: 8 },
  sigPadWrap: { height: 220, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  sigModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  sigModalCard: { borderRadius: 16, padding: 16, gap: 12 },
  sigModalActions: { flexDirection: 'row', gap: 10 },
  sigModalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sigSavingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  sigCancel: { alignItems: 'center', paddingVertical: 8 },
  sigButton: { paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  sigButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  content: {
    padding: 16,
    paddingTop: Platform.OS === 'web' ? 32 : 16,
    paddingBottom: Platform.OS === 'web' ? 100 : 40,
    gap: 8,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 17, fontWeight: '700' },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  logoutButton: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    flexBasis: '47%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  statValue: { fontSize: 26, fontWeight: '800' },
  statLabel: { fontSize: 13 },
  pinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  pinAddress: { fontSize: 14, fontWeight: '600' },
  workflowDot: { width: 10, height: 10, borderRadius: 5 },
});

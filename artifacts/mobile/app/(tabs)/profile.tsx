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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '@/components/Icon';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import {
  getGetMyProfileQueryKey,
  useListPins,
  useUpdateProfileCredentials,
  useUpdateProfileSignature,
  useUpdateProfileSmtp,
  useTestProfileSmtp,
} from '@workspace/api-client-react';
import type { DamageType, DoorKnockResult, Pin, PinWorkflow } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { PriceBookModal } from '@/components/PriceBookModal';
import { saveSignatureFromDataUrl } from '@/lib/profileSignature';
import { uploadFile } from '@/lib/upload';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

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
    profile,
    role,
    workflowAssignment,
    department,
    companyId,
    companyName,
    companyLogoUrl,
    signatureUrl,
    signatureSignedAt,
    isLoading: profileLoading,
  } = useProfile();

  // ── Company logo ────────────────────────────────────────────────────────────
  const canManageLogo = role === 'manager' || role === 'admin' || role === 'super_admin';
  const [logoUploading, setLogoUploading] = React.useState(false);
  const [logoDataUri, setLogoDataUri] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!companyLogoUrl) { setLogoDataUri(null); return; }
    let active = true;
    (async () => {
      try {
        const token = await getToken('auth_session_token');
        const dest = (FileSystem.cacheDirectory ?? '') + 'company-logo-profile.jpg';
        const dl = await FileSystem.downloadAsync(companyLogoUrl, dest, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!active || dl.status !== 200) return;
        const b64 = await FileSystem.readAsStringAsync(dl.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (active) setLogoDataUri(`data:image/jpeg;base64,${b64}`);
      } catch { /* ignore — logo preview is non-critical */ }
    })();
    return () => { active = false; };
  }, [companyLogoUrl]);

  async function handleUploadLogo() {
    if (logoUploading) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to upload a logo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    setLogoUploading(true);
    try {
      const objectPath = await uploadFile(result.assets[0].uri, 'image/jpeg');
      const fullUrl = `${getApiBaseUrl()}/storage${objectPath}`;
      const token = await getToken('auth_session_token');
      const resp = await fetch(`${getApiBaseUrl()}/companies/${companyId}/logo`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ logoUrl: fullUrl }),
      });
      if (!resp.ok) throw new Error('Server error');
      await queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      Alert.alert('Logo updated', 'The new logo will appear on FIPSA agreements.');
    } catch {
      Alert.alert('Upload failed', 'Check your connection and try again.');
    } finally {
      setLogoUploading(false);
    }
  }
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

  // Outbound email (SMTP) settings — lets the server email reports on the
  // rep's behalf so no mail app is needed on the device. Password is
  // write-only: it is stored encrypted server-side and never shown again.
  const smtpConfigured = profile?.smtpConfigured ?? false;
  const updateSmtp = useUpdateProfileSmtp();
  const testSmtp = useTestProfileSmtp();
  const [smtpTesting, setSmtpTesting] = React.useState(false);

  async function handleTestSmtp() {
    if (smtpTesting) return;
    setSmtpTesting(true);
    try {
      await testSmtp.mutateAsync();
      Alert.alert(
        'Test email sent',
        `Check ${user?.email ?? 'your inbox'} — if it arrives, your email settings work.`,
      );
    } catch (err: any) {
      const message =
        err?.data?.error ??
        'Test email could not be sent. Check your SMTP settings and try again.';
      Alert.alert('Test failed', message);
    } finally {
      setSmtpTesting(false);
    }
  }
  const [smtpOpen, setSmtpOpen] = React.useState(false);
  const [priceBookOpen, setPriceBookOpen] = React.useState(false);
  const canManagePriceBook = role === 'admin' || role === 'super_admin';
  const [smtpSaving, setSmtpSaving] = React.useState(false);
  const [smtpHost, setSmtpHost] = React.useState('');
  const [smtpPort, setSmtpPort] = React.useState('587');
  const [smtpSecure, setSmtpSecure] = React.useState(false);
  const [smtpUsername, setSmtpUsername] = React.useState('');
  const [smtpPassword, setSmtpPassword] = React.useState('');
  const [smtpFromEmail, setSmtpFromEmail] = React.useState('');

  function openSmtpForm() {
    // Pre-fill from the saved (non-secret) values so edits don't start blank.
    setSmtpHost(profile?.smtpHost ?? '');
    setSmtpPort(profile?.smtpPort != null ? String(profile.smtpPort) : '587');
    setSmtpSecure(profile?.smtpSecure ?? false);
    setSmtpUsername(profile?.smtpUsername ?? '');
    setSmtpPassword('');
    setSmtpFromEmail(profile?.smtpFromEmail ?? '');
    setSmtpOpen(true);
  }

  async function handleSaveSmtp() {
    if (smtpSaving) return;
    const port = Number(smtpPort.trim());
    if (!smtpHost.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
      Alert.alert('Check settings', 'Enter a valid SMTP server and port (e.g. 587 or 465).');
      return;
    }
    if (!smtpUsername.trim() || !smtpPassword) {
      Alert.alert('Check settings', 'Username and password are required.');
      return;
    }
    setSmtpSaving(true);
    try {
      await updateSmtp.mutateAsync({
        data: {
          host: smtpHost.trim(),
          port,
          secure: smtpSecure,
          username: smtpUsername.trim(),
          password: smtpPassword,
          ...(smtpFromEmail.trim() ? { fromEmail: smtpFromEmail.trim() } : {}),
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      setSmtpOpen(false);
      Alert.alert('Saved', 'Email sending is set up. Reports can now be emailed directly.');
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again.');
    } finally {
      setSmtpSaving(false);
    }
  }

  function handleClearSmtp() {
    Alert.alert('Remove email settings?', 'Reports will fall back to the device mail app.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await updateSmtp.mutateAsync({ data: { clear: true } });
            await queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
          } catch {
            Alert.alert('Could not remove', 'Check your connection and try again.');
          }
        },
      },
    ]);
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

      {canManageLogo && (
        <View style={[styles.sigCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sigHeader}>
            <Icon name="image" size={18} color={colors.foreground} />
            <Text style={[styles.sigTitle, { color: colors.foreground }]}>Company logo</Text>
            {companyLogoUrl ? (
              <View style={[styles.sigBadge, { backgroundColor: '#ecfdf5' }]}>
                <Text style={[styles.sigBadgeText, { color: colors.success }]}>Uploaded</Text>
              </View>
            ) : (
              <View style={[styles.sigBadge, { backgroundColor: colors.muted }]}>
                <Text style={[styles.sigBadgeText, { color: colors.mutedForeground }]}>Optional</Text>
              </View>
            )}
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            {companyLogoUrl
              ? 'Your logo appears at the top of FIPSA agreements. Tap below to replace it.'
              : 'Upload your company logo to appear at the top of FIPSA agreements instead of a blank header.'}
          </Text>
          {logoDataUri ? (
            <Image
              source={{ uri: logoDataUri }}
              style={{ height: 60, width: '100%', marginTop: 12 }}
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            onPress={handleUploadLogo}
            disabled={logoUploading}
            style={[styles.sigButton, { backgroundColor: colors.secondary, opacity: logoUploading ? 0.6 : 1 }]}
          >
            <Text style={styles.sigButtonText}>
              {logoUploading ? 'Uploading…' : companyLogoUrl ? 'Replace logo' : 'Upload logo'}
            </Text>
          </Pressable>
        </View>
      )}

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

      <View style={[styles.sigCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sigHeader}>
          <Icon name="mail" size={18} color={colors.foreground} />
          <Text style={[styles.sigTitle, { color: colors.foreground }]}>Report email (SMTP)</Text>
          {smtpConfigured ? (
            <View style={[styles.sigBadge, { backgroundColor: '#ecfdf5' }]}>
              <Text style={[styles.sigBadgeText, { color: colors.success }]}>Configured</Text>
            </View>
          ) : (
            <View style={[styles.sigBadge, { backgroundColor: colors.muted }]}>
              <Text style={[styles.sigBadgeText, { color: colors.mutedForeground }]}>Optional</Text>
            </View>
          )}
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
          {smtpConfigured
            ? `Reports are emailed directly through ${profile?.smtpHost ?? 'your mail server'} as ${
                profile?.smtpFromEmail || profile?.smtpUsername || 'you'
              }.`
            : 'Add your email provider\u2019s SMTP settings to send homeowner reports straight from the app \u2014 no mail app needed. For Gmail, use smtp.gmail.com with an app password.'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={openSmtpForm}
            style={[styles.sigButton, { backgroundColor: colors.secondary, flex: 1 }]}
          >
            <Text style={styles.sigButtonText}>
              {smtpConfigured ? 'Edit settings' : 'Set up email sending'}
            </Text>
          </Pressable>
          {smtpConfigured && (
            <Pressable
              onPress={handleTestSmtp}
              disabled={smtpTesting}
              style={[
                styles.sigButton,
                {
                  borderColor: colors.border,
                  borderWidth: 1,
                  paddingHorizontal: 16,
                  opacity: smtpTesting ? 0.6 : 1,
                },
              ]}
            >
              <Text style={[styles.sigButtonText, { color: colors.foreground }]}>
                {smtpTesting ? 'Sending…' : 'Send test'}
              </Text>
            </Pressable>
          )}
          {smtpConfigured && (
            <Pressable
              onPress={handleClearSmtp}
              style={[
                styles.sigButton,
                { borderColor: colors.destructive, borderWidth: 1, paddingHorizontal: 16 },
              ]}
            >
              <Text style={{ color: colors.destructive, fontWeight: '700', fontSize: 14 }}>
                Remove
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* REPORT_DATA v2 §6 — inspector credentials. These ride along with
          every submission and back the repairability assessor line. */}
      <CredentialsCard colors={colors} profile={profile} />

      {canManagePriceBook && (
        <View style={[styles.sigCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sigHeader}>
            <Icon name="book-open" size={18} color={colors.foreground} />
            <Text style={[styles.sigTitle, { color: colors.foreground }]}>Price Book</Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            Manage line items and packages. Group items into packages and set inspection conditions so the right package is suggested at the end of each inspection.
          </Text>
          <Pressable
            onPress={() => setPriceBookOpen(true)}
            style={[styles.sigButton, { backgroundColor: colors.secondary }]}
          >
            <Text style={styles.sigButtonText}>Manage Price Book</Text>
          </Pressable>
        </View>
      )}

      <PriceBookModal visible={priceBookOpen} onClose={() => setPriceBookOpen(false)} />

      <Modal
        visible={smtpOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!smtpSaving) setSmtpOpen(false);
        }}
      >
        <View style={styles.sigModalOverlay}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.sigModalCard, { backgroundColor: colors.background }]}>
              <Text style={[styles.sigTitle, { color: colors.foreground }]}>Email sending setup</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                Your password is stored encrypted and only used to send reports. It is never shown
                again.
              </Text>
              <TextInput
                value={smtpHost}
                onChangeText={setSmtpHost}
                placeholder="SMTP server (e.g. smtp.gmail.com)"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.smtpInput, { color: colors.foreground, borderColor: colors.border }]}
              />
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <TextInput
                  value={smtpPort}
                  onChangeText={setSmtpPort}
                  placeholder="Port"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                  style={[
                    styles.smtpInput,
                    { color: colors.foreground, borderColor: colors.border, flex: 1 },
                  ]}
                />
                <Text style={{ color: colors.foreground, fontSize: 13 }}>SSL</Text>
                <Switch value={smtpSecure} onValueChange={setSmtpSecure} />
              </View>
              <TextInput
                value={smtpUsername}
                onChangeText={setSmtpUsername}
                placeholder="Username (usually your email)"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.smtpInput, { color: colors.foreground, borderColor: colors.border }]}
              />
              <TextInput
                value={smtpPassword}
                onChangeText={setSmtpPassword}
                placeholder={smtpConfigured ? 'Password (re-enter to save)' : 'Password'}
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.smtpInput, { color: colors.foreground, borderColor: colors.border }]}
              />
              <TextInput
                value={smtpFromEmail}
                onChangeText={setSmtpFromEmail}
                placeholder="From address (optional)"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.smtpInput, { color: colors.foreground, borderColor: colors.border }]}
              />
              <View style={styles.sigModalActions}>
                <Pressable
                  onPress={() => setSmtpOpen(false)}
                  disabled={smtpSaving}
                  style={[styles.sigModalBtn, { borderColor: colors.border, borderWidth: 1 }]}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveSmtp}
                  disabled={smtpSaving}
                  style={[
                    styles.sigModalBtn,
                    { backgroundColor: colors.primary, opacity: smtpSaving ? 0.6 : 1 },
                  ]}
                >
                  {smtpSaving ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

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

// REPORT_DATA v2 §6 — certifications + years of experience editor. Simple
// whole-list save: the list is small and the profile is edited at a desk,
// not in the field.
function CredentialsCard({
  colors,
  profile,
}: {
  colors: ReturnType<typeof useColors>;
  profile:
    | {
        certifications?: Array<{
          name: string;
          issuingBody?: string | null;
          number?: string | null;
          expiry?: string | null;
        }> | null;
        yearsExperience?: number | null;
      }
    | null
    | undefined;
}) {
  const queryClient = useQueryClient();
  const updateCredentials = useUpdateProfileCredentials();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [years, setYears] = React.useState('');
  const [certs, setCerts] = React.useState<
    Array<{ name: string; issuingBody: string; number: string; expiry: string }>
  >([]);

  const storedCerts = profile?.certifications ?? [];
  const storedYears = profile?.yearsExperience ?? null;

  function openEditor() {
    setYears(storedYears != null ? String(storedYears) : '');
    setCerts(
      storedCerts.map((c) => ({
        name: c.name,
        issuingBody: c.issuingBody ?? '',
        number: c.number ?? '',
        expiry: c.expiry ?? '',
      })),
    );
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    const cleaned = certs
      .map((c) => ({
        name: c.name.trim(),
        issuingBody: c.issuingBody.trim() || null,
        number: c.number.trim() || null,
        expiry: c.expiry.trim() || null,
      }))
      .filter((c) => c.name !== '');
    const yearsNum = years.trim() === '' ? null : Number(years.trim());
    if (yearsNum != null && (!Number.isFinite(yearsNum) || yearsNum < 0)) {
      Alert.alert('Invalid value', 'Years of experience must be a number.');
      return;
    }
    setSaving(true);
    try {
      await updateCredentials.mutateAsync({
        data: { certifications: cleaned, yearsExperience: yearsNum },
      });
      await queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      setEditing(false);
    } catch {
      Alert.alert('Save failed', 'Could not save credentials. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.sigCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.sigHeader}>
        <Icon name="award" size={18} color={colors.foreground} />
        <Text style={[styles.sigTitle, { color: colors.foreground }]}>Inspector credentials</Text>
        {storedCerts.length > 0 || storedYears != null ? (
          <View style={[styles.sigBadge, { backgroundColor: '#ecfdf5' }]}>
            <Text style={[styles.sigBadgeText, { color: colors.success }]}>On file</Text>
          </View>
        ) : (
          <View style={[styles.sigBadge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.sigBadgeText, { color: colors.mutedForeground }]}>Not set</Text>
          </View>
        )}
      </View>

      {!editing ? (
        <>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            {storedCerts.length > 0 || storedYears != null
              ? [
                  storedYears != null ? `${storedYears} years experience` : null,
                  ...storedCerts.map((c) =>
                    c.issuingBody ? `${c.name} (${c.issuingBody})` : c.name,
                  ),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Certifications and years of experience are attached to every inspection package and back your repairability determinations.'}
          </Text>
          <Pressable onPress={openEditor} style={[styles.sigButton, { backgroundColor: colors.secondary }]}>
            <Text style={styles.sigButtonText}>
              {storedCerts.length > 0 || storedYears != null ? 'Edit credentials' : 'Add credentials'}
            </Text>
          </Pressable>
        </>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, fontWeight: '600' }}>
            Years of experience
          </Text>
          <TextInput
            value={years}
            onChangeText={setYears}
            keyboardType="numeric"
            placeholder="e.g. 8"
            placeholderTextColor={colors.mutedForeground}
            style={{
              borderWidth: 1,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: colors.background,
              borderColor: colors.border,
              color: colors.foreground,
            }}
          />
          {certs.map((cert, index) => (
            <View
              key={index}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 10,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                  Certification {index + 1}
                </Text>
                <Pressable onPress={() => setCerts((prev) => prev.filter((_, i) => i !== index))}>
                  <Icon name="trash-2" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
              {(
                [
                  ['name', 'Name (e.g. HAAG Certified Inspector)'],
                  ['issuingBody', 'Issuing body'],
                  ['number', 'Certificate number'],
                  ['expiry', 'Expiry (YYYY-MM-DD)'],
                ] as const
              ).map(([field, placeholder]) => (
                <TextInput
                  key={field}
                  value={cert[field]}
                  onChangeText={(v) =>
                    setCerts((prev) =>
                      prev.map((c, i) => (i === index ? { ...c, [field]: v } : c)),
                    )
                  }
                  placeholder={placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  style={{
                    borderWidth: 1,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                  }}
                />
              ))}
            </View>
          ))}
          <Pressable
            onPress={() =>
              setCerts((prev) => [...prev, { name: '', issuingBody: '', number: '', expiry: '' }])
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: colors.border,
            }}
          >
            <Icon name="plus" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Add certification</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={save}
              disabled={saving}
              style={[styles.sigButton, { backgroundColor: colors.secondary, flex: 1, opacity: saving ? 0.6 : 1 }]}
            >
              <Text style={styles.sigButtonText}>{saving ? 'Saving…' : 'Save credentials'}</Text>
            </Pressable>
            <Pressable
              onPress={() => setEditing(false)}
              style={[styles.sigButton, { borderColor: colors.border, borderWidth: 1, paddingHorizontal: 16 }]}
            >
              <Text style={[styles.sigButtonText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

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
  sigButton: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  smtpInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
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

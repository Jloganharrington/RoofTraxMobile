import React from 'react';
import {
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  Image,
  LayoutAnimation,
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
import { WebView } from 'react-native-webview';
import {
  getGetCompanyFipsaSettingsQueryKey,
  getGetMyProfileQueryKey,
  useGetCompanyFipsaSettings,
  useListPins,
  useUpdateCompanyFipsaSettings,
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
import { DiscontinuedProductsModal } from '@/components/DiscontinuedProductsModal';
import { saveSignatureFromDataUrl } from '@/lib/profileSignature';
import { uploadFile } from '@/lib/upload';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';
import * as ImagePicker from 'expo-image-picker';

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
        const resp = await fetch(companyLogoUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!active || !resp.ok) return;
        const contentType = resp.headers.get('content-type') ?? 'image/jpeg';
        const buffer = await resp.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        if (active) setLogoDataUri(`data:${contentType};base64,${b64}`);
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
  const [productCatalogOpen, setProductCatalogOpen] = React.useState(false);
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

  // ── Accordion state — "activity" open by default ────────────────────────────
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>({
    activity: true,
    myProfile: false,
    company: false,
    email: false,
    account: false,
  });

  function toggleSection(key: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  }

  const showCompanySection = canManageLogo || canManagePriceBook;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Identity card — always visible ───────────────────────────────────── */}
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

      {/* ── 1. Activity (default open) ───────────────────────────────────────── */}
      <AccordionSection
        title="My Pins & Activity"
        iconName="map-pin"
        open={openSections.activity}
        onToggle={() => toggleSection('activity')}
        colors={colors}
      >
        {pinsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
        ) : (
          <>
            <View style={styles.statsGrid}>
              <StatCard label="Total pins" value={totalPins} color={colors.foreground} />
              <StatCard label="Active" value={activePins} color={colors.success} />
              <StatCard label="Insurance" value={insurancePins} color={colors.insurance} />
              <StatCard label="Retail" value={retailPins} color={colors.retail} />
            </View>

            <Text style={[styles.subsectionTitle, { color: colors.mutedForeground }]}>
              Recent activity
            </Text>

            {pins.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                You haven't dropped any pins yet.
              </Text>
            ) : (
              pins.map((pin: Pin) => (
                <Pressable
                  key={pin.id}
                  onPress={() => router.push({ pathname: '/pin-edit', params: { pin: JSON.stringify(pin) } })}
                  style={[styles.pinCard, { backgroundColor: colors.background, borderColor: colors.border }]}
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
          </>
        )}
      </AccordionSection>

      {/* ── 2. My Profile ───────────────────────────────────────────────────── */}
      <AccordionSection
        title="My Profile"
        iconName="edit-3"
        open={openSections.myProfile}
        onToggle={() => toggleSection('myProfile')}
        colors={colors}
        badge={!signatureUrl ? { label: 'Action needed', variant: 'warn' } : undefined}
      >
        {/* Signature */}
        <View style={[styles.innerCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.sigHeader}>
            <Icon name="edit-3" size={16} color={colors.foreground} />
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
              ? `Applied to inspection field attestations.${signatureSignedAt ? ` Captured ${new Date(signatureSignedAt).toLocaleDateString()}.` : ''}`
              : 'Required before you can submit an inspection.'}
          </Text>
          {signatureUrl && !capturing && (
            <Image source={{ uri: signatureUrl }} style={styles.sigPreview} resizeMode="contain" />
          )}
          <Pressable onPress={() => setCapturing(true)} style={[styles.sigButton, { backgroundColor: colors.secondary }]}>
            <Text style={styles.sigButtonText}>{signatureUrl ? 'Replace signature' : 'Capture signature'}</Text>
          </Pressable>
        </View>

        {/* Credentials */}
        <CredentialsCard colors={colors} profile={profile} />
      </AccordionSection>

      {/* ── 3. Company (role-gated) ──────────────────────────────────────────── */}
      {showCompanySection && (
        <AccordionSection
          title="Company"
          iconName="briefcase"
          open={openSections.company}
          onToggle={() => toggleSection('company')}
          colors={colors}
        >
          {canManageLogo && (
            <View style={[styles.innerCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.sigHeader}>
                <Icon name="image" size={16} color={colors.foreground} />
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
                  ? 'Appears at the top of FIPSA agreements. Tap below to replace it.'
                  : 'Appears at the top of FIPSA agreements instead of a blank header.'}
              </Text>
              {logoDataUri && (
                <Image source={{ uri: logoDataUri }} style={{ height: 54, width: '100%' }} resizeMode="contain" />
              )}
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

          {canManagePriceBook && (
            <View style={[styles.innerCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.sigHeader}>
                <Icon name="book-open" size={16} color={colors.foreground} />
                <Text style={[styles.sigTitle, { color: colors.foreground }]}>Price Book</Text>
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                Manage line items and packages. Set inspection conditions so the right package is suggested automatically.
              </Text>
              <Pressable onPress={() => setPriceBookOpen(true)} style={[styles.sigButton, { backgroundColor: colors.secondary }]}>
                <Text style={styles.sigButtonText}>Manage Price Book</Text>
              </Pressable>
            </View>
          )}

          {canManagePriceBook && (
            <View style={[styles.innerCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.sigHeader}>
                <Icon name="archive" size={16} color={colors.foreground} />
                <Text style={[styles.sigTitle, { color: colors.foreground }]}>Known Product Catalog</Text>
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                Known discontinued roofing products with photo, width, and exposure. Reps match
                against this catalog during repairability assessments.
              </Text>
              <Pressable onPress={() => setProductCatalogOpen(true)} style={[styles.sigButton, { backgroundColor: colors.secondary }]}>
                <Text style={styles.sigButtonText}>Manage Product Catalog</Text>
              </Pressable>
            </View>
          )}

          {/* AI Summary Settings — manager+ only */}
          {canManageLogo && (
            <AiSettingsCard companyId={companyId ?? ''} colors={colors} />
          )}

          {/* Report Branding — super admin only */}
          {role === 'super_admin' && (
            <ReportBrandingCard companyId={companyId ?? ''} colors={colors} />
          )}

          {/* FIPSA Agreement Settings — super admin only */}
          {role === 'super_admin' && (
            <FipsaSettingsCard companyId={companyId ?? ''} colors={colors} />
          )}

          {/* Proof Package Settings — super admin only */}
          {role === 'super_admin' && (
            <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, marginTop: 6 }}>
              <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 14 }}>
                Proof Package Settings
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                Licenses, qualifications, and state legal content printed in every Proof Package.
              </Text>
              <Pressable
                onPress={() => router.push('/proof-package-settings')}
                style={[styles.sigButton, { backgroundColor: colors.secondary, marginTop: 4 }]}
              >
                <Text style={styles.sigButtonText}>Manage Proof Package</Text>
              </Pressable>
            </View>
          )}
        </AccordionSection>
      )}

      {/* ── 4. Email Sending ─────────────────────────────────────────────────── */}
      <AccordionSection
        title="Email Sending"
        iconName="mail"
        open={openSections.email}
        onToggle={() => toggleSection('email')}
        colors={colors}
        badge={smtpConfigured ? { label: 'Configured', variant: 'success' } : undefined}
      >
        <View style={[styles.innerCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.sigHeader}>
            <Icon name="mail" size={16} color={colors.foreground} />
            <Text style={[styles.sigTitle, { color: colors.foreground }]}>SMTP settings</Text>
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
              ? `Reports sent through ${profile?.smtpHost ?? 'your mail server'} as ${profile?.smtpFromEmail || profile?.smtpUsername || 'you'}.`
              : 'Send homeowner reports straight from the app — no mail app needed.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={openSmtpForm} style={[styles.sigButton, { backgroundColor: colors.secondary, flex: 1 }]}>
              <Text style={styles.sigButtonText}>{smtpConfigured ? 'Edit settings' : 'Set up email'}</Text>
            </Pressable>
            {smtpConfigured && (
              <Pressable
                onPress={handleTestSmtp}
                disabled={smtpTesting}
                style={[styles.sigButton, { borderColor: colors.border, borderWidth: 1, paddingHorizontal: 16, opacity: smtpTesting ? 0.6 : 1 }]}
              >
                <Text style={[styles.sigButtonText, { color: colors.foreground }]}>
                  {smtpTesting ? 'Sending…' : 'Test'}
                </Text>
              </Pressable>
            )}
            {smtpConfigured && (
              <Pressable
                onPress={handleClearSmtp}
                style={[styles.sigButton, { borderColor: colors.destructive, borderWidth: 1, paddingHorizontal: 16 }]}
              >
                <Text style={{ color: colors.destructive, fontWeight: '700', fontSize: 14 }}>Remove</Text>
              </Pressable>
            )}
          </View>
        </View>
      </AccordionSection>

      {/* ── 5. Account ───────────────────────────────────────────────────────── */}
      <AccordionSection
        title="Account"
        iconName="settings"
        open={openSections.account}
        onToggle={() => toggleSection('account')}
        colors={colors}
      >
        <Pressable
          onPress={handleLogout}
          style={[styles.logoutButton, { borderColor: colors.destructive }]}
        >
          <Icon name="log-out" size={18} color={colors.destructive} />
          <Text style={{ color: colors.destructive, fontWeight: '600' }}>Log out</Text>
        </Pressable>
      </AccordionSection>

      {/* ── Modals (unchanged) ───────────────────────────────────────────────── */}
      <PriceBookModal visible={priceBookOpen} onClose={() => setPriceBookOpen(false)} />
      <DiscontinuedProductsModal visible={productCatalogOpen} onClose={() => setProductCatalogOpen(false)} />

      <Modal
        visible={smtpOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!smtpSaving) setSmtpOpen(false); }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sigModalOverlay}
        >
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
            <View style={[styles.sigModalCard, { backgroundColor: colors.background }]}>
              <Text style={[styles.sigTitle, { color: colors.foreground }]}>Email sending setup</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                Your password is stored encrypted and only used to send reports. It is never shown again.
              </Text>
              <TextInput value={smtpHost} onChangeText={setSmtpHost} placeholder="SMTP server (e.g. smtp.gmail.com)" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoCorrect={false} style={[styles.smtpInput, { color: colors.foreground, borderColor: colors.border }]} />
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <TextInput value={smtpPort} onChangeText={setSmtpPort} placeholder="Port" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" style={[styles.smtpInput, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                <Text style={{ color: colors.foreground, fontSize: 13 }}>SSL</Text>
                <Switch value={smtpSecure} onValueChange={setSmtpSecure} />
              </View>
              <TextInput value={smtpUsername} onChangeText={setSmtpUsername} placeholder="Username (usually your email)" placeholderTextColor={colors.mutedForeground} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={[styles.smtpInput, { color: colors.foreground, borderColor: colors.border }]} />
              <TextInput value={smtpPassword} onChangeText={setSmtpPassword} placeholder={smtpConfigured ? 'Password (re-enter to save)' : 'Password'} placeholderTextColor={colors.mutedForeground} secureTextEntry autoCapitalize="none" autoCorrect={false} style={[styles.smtpInput, { color: colors.foreground, borderColor: colors.border }]} />
              <TextInput value={smtpFromEmail} onChangeText={setSmtpFromEmail} placeholder="From address (optional)" placeholderTextColor={colors.mutedForeground} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={[styles.smtpInput, { color: colors.foreground, borderColor: colors.border }]} />
              <View style={styles.sigModalActions}>
                <Pressable onPress={() => setSmtpOpen(false)} disabled={smtpSaving} style={[styles.sigModalBtn, { borderColor: colors.border, borderWidth: 1 }]}>
                  <Text style={{ color: colors.foreground, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSaveSmtp} disabled={smtpSaving} style={[styles.sigModalBtn, { backgroundColor: colors.primary, opacity: smtpSaving ? 0.6 : 1 }]}>
                  {smtpSaving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save</Text>}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={capturing} transparent animationType="fade" onRequestClose={() => { if (!savingSignature) setCapturing(false); }}>
        <View style={styles.sigModalOverlay}>
          <View style={[styles.sigModalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.sigTitle, { color: colors.foreground }]}>Draw your signature</Text>
            <View style={[styles.sigPadWrap, { borderColor: colors.border }]}>
              <SignatureScreen ref={signatureRef} onOK={handleSignature} descriptionText="" clearText="Clear" confirmText="Save signature" webStyle={SIGNATURE_WEB_STYLE} />
            </View>
            {savingSignature ? (
              <View style={styles.sigSavingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.mutedForeground }}>Saving signature…</Text>
              </View>
            ) : (
              <>
                <View style={styles.sigModalActions}>
                  <Pressable onPress={() => signatureRef.current?.clearSignature()} style={[styles.sigModalBtn, { borderColor: colors.border, borderWidth: 1 }]}>
                    <Text style={{ color: colors.foreground, fontWeight: '600' }}>Clear</Text>
                  </Pressable>
                  <Pressable onPress={() => signatureRef.current?.readSignature()} style={[styles.sigModalBtn, { backgroundColor: colors.primary }]}>
                    <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save signature</Text>
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
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Accordion section ─────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warn' | 'muted';

// Manager-only card for configuring the AI summary system prompt.
function AiSettingsCard({
  companyId,
  colors,
}: {
  companyId: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [loaded, setLoaded] = React.useState(false);
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Load the current setting once on mount (when companyId is known).
  React.useEffect(() => {
    if (!companyId) return;
    let active = true;
    (async () => {
      try {
        const token = await getToken('auth_session_token');
        const resp = await fetch(`${getApiBaseUrl()}/companies/${companyId}/ai-settings`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!active || !resp.ok) return;
        const data = (await resp.json()) as { settings: { systemPrompt: string | null } };
        if (active) setSystemPrompt(data.settings.systemPrompt ?? '');
      } catch { /* non-critical */ } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [companyId]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const token = await getToken('auth_session_token');
      const resp = await fetch(`${getApiBaseUrl()}/companies/${companyId}/ai-settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ systemPrompt: systemPrompt.trim() || null }),
      });
      if (!resp.ok) throw new Error('Server error');
      setEditing(false);
      Alert.alert('Saved', 'AI summary settings updated.');
    } catch {
      Alert.alert('Save failed', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  const hasCustomPrompt = systemPrompt.trim().length > 0;

  return (
    <View style={[styles.innerCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.sigHeader}>
        <Icon name="zap" size={16} color={colors.foreground} />
        <Text style={[styles.sigTitle, { color: colors.foreground }]}>AI Summary Settings</Text>
        <View
          style={[
            styles.sigBadge,
            { backgroundColor: hasCustomPrompt ? '#ecfdf5' : colors.muted },
          ]}
        >
          <Text
            style={[
              styles.sigBadgeText,
              { color: hasCustomPrompt ? colors.success : colors.mutedForeground },
            ]}
          >
            {hasCustomPrompt ? 'Custom additions' : 'Baseline only'}
          </Text>
        </View>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
        {hasCustomPrompt
          ? 'Additional instructions are active. They are layered on top of the standard baseline prompt when generating inspection summaries.'
          : 'Using the standard baseline prompt. Add company instructions to tailor the AI narrative style — they are applied on top of the baseline, never in place of it.'}
      </Text>
      {!editing ? (
        <Pressable
          onPress={() => { setEditing(true); }}
          style={[styles.sigButton, { backgroundColor: colors.secondary }]}
        >
          <Text style={styles.sigButtonText}>
            {loaded ? (hasCustomPrompt ? 'Edit additional instructions' : 'Add company instructions') : 'Loading…'}
          </Text>
        </Pressable>
      ) : (
        <>
          <TextInput
            style={[
              styles.smtpInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
                minHeight: 120,
                textAlignVertical: 'top',
              },
            ]}
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            placeholder="Company instructions added on top of the standard baseline prompt (leave blank to use the baseline only)…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={5}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => setEditing(false)}
              style={[
                styles.sigButton,
                { flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 14 }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={saving}
              style={[styles.sigButton, { flex: 1, backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
            >
              <Text style={[styles.sigButtonText, { color: colors.primaryForeground }]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ── Report Branding (super admin only) ─────────────────────────────────────
// Company-wide color palette for the compiled forensic report. Applied at
// preview time server-side, so changes affect all reports immediately.

const REPORT_BRANDING_DEFAULT = {
  headerColor: '#1a2744',
  headerTextColor: '#ffffff',
  accentColor: '#3b82f6',
};

// FIPSA agreement settings — contractor legal identity + Documentation Fee
// printed on every generated FIPSA agreement (multi-tenant template).
function FipsaSettingsCard({
  companyId,
  colors,
}: {
  companyId: string;
  colors: ReturnType<typeof useColors>;
}) {
  const queryClient = useQueryClient();
  const settingsQuery = useGetCompanyFipsaSettings(companyId, {
    query: {
      enabled: !!companyId,
      queryKey: getGetCompanyFipsaSettingsQueryKey(companyId),
    },
  });
  const update = useUpdateCompanyFipsaSettings();

  const [legalName, setLegalName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [feeText, setFeeText] = React.useState('');
  const [seeded, setSeeded] = React.useState(false);

  React.useEffect(() => {
    const s = settingsQuery.data?.settings;
    if (s && !seeded) {
      setLegalName(s.contractorLegalName ?? '');
      setAddress(s.contractorAddress ?? '');
      setFeeText(s.fipsaFeeCents != null ? (s.fipsaFeeCents / 100).toFixed(2) : '');
      setSeeded(true);
    }
  }, [settingsQuery.data, seeded]);

  // "750", "750.5", "$1,000.00" → integer cents; null = blank; NaN = invalid.
  function parseFeeCents(raw: string): number | null | undefined {
    const t = raw.trim().replace(/[$,\s]/g, '');
    if (!t) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
    return Math.round(parseFloat(t) * 100);
  }

  const feeCents = parseFeeCents(feeText);
  const feeValid = feeCents !== undefined;

  async function save() {
    if (update.isPending) return;
    if (!feeValid) {
      Alert.alert('Invalid fee', 'Enter the FIPSA fee as a dollar amount, e.g. 750 or 750.00.');
      return;
    }
    try {
      await update.mutateAsync({
        companyId,
        data: {
          settings: {
            contractorLegalName: legalName.trim() || null,
            contractorAddress: address.trim() || null,
            fipsaFeeCents: feeCents ?? null,
          },
        },
      });
      // Agreement screen reads these from the profile fetch.
      await queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      Alert.alert('Saved', 'FIPSA agreement settings updated. New agreements will use them.');
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Check your connection and try again.');
    }
  }

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.foreground,
  } as const;

  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, marginTop: 6 }}>
      <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 14 }}>
        FIPSA Agreement Settings
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
        Printed on every FIPSA agreement: the contractor line on page 1, the Notice of
        Cancellation on page 2, and the Documentation Fee in clause 3.
      </Text>

      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
        Contractor Company Legal Name
      </Text>
      <TextInput
        value={legalName}
        onChangeText={setLegalName}
        placeholder="e.g. NuHome Exteriors, Inc."
        placeholderTextColor={colors.mutedForeground}
        style={inputStyle}
      />

      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Contractor Address</Text>
      <TextInput
        value={address}
        onChangeText={setAddress}
        placeholder="e.g. 3615-A Chain Bridge Rd, Fairfax, VA 20131"
        placeholderTextColor={colors.mutedForeground}
        style={inputStyle}
      />

      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>FIPSA Fee (USD)</Text>
      <TextInput
        value={feeText}
        onChangeText={setFeeText}
        placeholder="750.00"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="decimal-pad"
        style={[inputStyle, !feeValid && { borderColor: colors.destructive }]}
      />

      <Pressable
        onPress={save}
        disabled={update.isPending || settingsQuery.isLoading}
        style={[styles.sigButton, { backgroundColor: colors.secondary, opacity: update.isPending ? 0.6 : 1, marginTop: 4 }]}
      >
        {update.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.sigButtonText}>Save FIPSA Settings</Text>
        )}
      </Pressable>
    </View>
  );
}

const REPORT_BRANDING_PRESETS: Array<{ name: string; headerColor: string; headerTextColor: string; accentColor: string }> = [
  { name: 'Classic Navy', ...REPORT_BRANDING_DEFAULT },
  { name: 'Slate', headerColor: '#1f2937', headerTextColor: '#ffffff', accentColor: '#f59e0b' },
  { name: 'Forest', headerColor: '#14532d', headerTextColor: '#ffffff', accentColor: '#22c55e' },
  { name: 'Burgundy', headerColor: '#5f1a1a', headerTextColor: '#ffffff', accentColor: '#ef4444' },
  { name: 'Charcoal', headerColor: '#111111', headerTextColor: '#ffffff', accentColor: '#9ca3af' },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function ReportBrandingCard({
  companyId,
  colors,
}: {
  companyId: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [isCustom, setIsCustom] = React.useState(false); // true when a stored palette exists
  const [headerColor, setHeaderColor] = React.useState(REPORT_BRANDING_DEFAULT.headerColor);
  const [headerTextColor, setHeaderTextColor] = React.useState(REPORT_BRANDING_DEFAULT.headerTextColor);
  const [accentColor, setAccentColor] = React.useState(REPORT_BRANDING_DEFAULT.accentColor);
  const [previewVisible, setPreviewVisible] = React.useState(false);
  const [previewHtml, setPreviewHtml] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  // Fetch a server-rendered sample report using the CURRENT (possibly
  // unsaved) colors so admins see exactly what a compiled report will look
  // like — including the signed company logo.
  async function openPreview() {
    if (previewLoading) return;
    setPreviewLoading(true);
    try {
      const token = await getToken('auth_session_token');
      const qs = new URLSearchParams({ headerColor, headerTextColor, accentColor }).toString();
      const resp = await fetch(
        `${getApiBaseUrl()}/companies/${companyId}/report-branding/preview?${qs}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Server error');
      }
      const data = (await resp.json()) as { html: string };
      setPreviewHtml(data.html);
      setPreviewVisible(true);
    } catch (err) {
      Alert.alert('Preview failed', err instanceof Error ? err.message : 'Check your connection and try again.');
    } finally {
      setPreviewLoading(false);
    }
  }

  React.useEffect(() => {
    if (!companyId) return;
    let active = true;
    (async () => {
      try {
        const token = await getToken('auth_session_token');
        const resp = await fetch(`${getApiBaseUrl()}/companies/${companyId}/report-branding`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!active || !resp.ok) return;
        const data = (await resp.json()) as {
          branding: { headerColor: string; headerTextColor: string; accentColor: string } | null;
        };
        if (active && data.branding) {
          setHeaderColor(data.branding.headerColor);
          setHeaderTextColor(data.branding.headerTextColor);
          setAccentColor(data.branding.accentColor);
          setIsCustom(true);
        }
      } catch { /* non-critical */ } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [companyId]);

  const allValid = HEX_RE.test(headerColor) && HEX_RE.test(headerTextColor) && HEX_RE.test(accentColor);

  async function persist(
    branding: { headerColor: string; headerTextColor: string; accentColor: string } | null,
  ) {
    if (saving) return;
    setSaving(true);
    try {
      const token = await getToken('auth_session_token');
      const resp = await fetch(`${getApiBaseUrl()}/companies/${companyId}/report-branding`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ branding }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Server error');
      }
      if (branding) {
        setIsCustom(true);
      } else {
        setHeaderColor(REPORT_BRANDING_DEFAULT.headerColor);
        setHeaderTextColor(REPORT_BRANDING_DEFAULT.headerTextColor);
        setAccentColor(REPORT_BRANDING_DEFAULT.accentColor);
        setIsCustom(false);
      }
      Alert.alert('Saved', 'Report colors updated. All report previews now use this palette.');
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  const colorRow = (
    label: string,
    value: string,
    setValue: (v: string) => void,
  ) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, width: 92 }}>{label}</Text>
      <View
        style={{
          width: 26, height: 26, borderRadius: 6,
          backgroundColor: HEX_RE.test(value) ? value : colors.muted,
          borderWidth: 1, borderColor: colors.border,
        }}
      />
      <TextInput
        style={[
          styles.smtpInput,
          {
            flex: 1, color: colors.foreground, borderColor: HEX_RE.test(value) ? colors.border : colors.destructive,
            backgroundColor: colors.card, paddingVertical: 6, fontSize: 13,
          },
        ]}
        value={value}
        onChangeText={(t) => setValue(t.trim())}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="#RRGGBB"
        placeholderTextColor={colors.mutedForeground}
      />
    </View>
  );

  return (
    <View style={[styles.innerCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.sigHeader}>
        <Icon name="droplet" size={16} color={colors.foreground} />
        <Text style={[styles.sigTitle, { color: colors.foreground }]}>Report Branding</Text>
        <View style={[styles.sigBadge, { backgroundColor: isCustom ? '#ecfdf5' : colors.muted }]}>
          <Text style={[styles.sigBadgeText, { color: isCustom ? colors.success : colors.mutedForeground }]}>
            {isCustom ? 'Custom palette' : 'Default'}
          </Text>
        </View>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
        Color palette for compiled forensic reports. Changes apply immediately to every report preview,
        including reports compiled earlier.
      </Text>

      {/* Live preview swatch — mimics the report cover + section title */}
      <View style={{ borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
        <View style={{ backgroundColor: HEX_RE.test(headerColor) ? headerColor : REPORT_BRANDING_DEFAULT.headerColor, padding: 12 }}>
          <Text style={{ color: HEX_RE.test(headerTextColor) ? headerTextColor : '#ffffff', fontWeight: '800', fontSize: 13 }}>
            Forensic Inspection &amp; Repairability Report
          </Text>
        </View>
        <View style={{ backgroundColor: '#ffffff', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 4, height: 16, backgroundColor: HEX_RE.test(accentColor) ? accentColor : REPORT_BRANDING_DEFAULT.accentColor }} />
          <Text style={{ color: HEX_RE.test(headerColor) ? headerColor : REPORT_BRANDING_DEFAULT.headerColor, fontWeight: '800', fontSize: 11, letterSpacing: 0.7 }}>
            1 — FORENSIC INSPECTION SUMMARY
          </Text>
        </View>
      </View>

      {/* Presets */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {REPORT_BRANDING_PRESETS.map((p) => {
          const selected =
            p.headerColor === headerColor && p.headerTextColor === headerTextColor && p.accentColor === accentColor;
          return (
            <Pressable
              key={p.name}
              onPress={() => {
                setHeaderColor(p.headerColor);
                setHeaderTextColor(p.headerTextColor);
                setAccentColor(p.accentColor);
              }}
              style={{
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? colors.primary : colors.border,
                borderRadius: 8, padding: 8, alignItems: 'center', gap: 4, minWidth: 76,
                backgroundColor: colors.card,
              }}
            >
              <View style={{ flexDirection: 'row', gap: 3 }}>
                <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: p.headerColor }} />
                <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: p.accentColor }} />
              </View>
              <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: '600' }}>{p.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Per-color overrides */}
      {colorRow('Header', headerColor, setHeaderColor)}
      {colorRow('Header text', headerTextColor, setHeaderTextColor)}
      {colorRow('Accent', accentColor, setAccentColor)}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={() => persist(null)}
          disabled={saving || !loaded || !isCustom}
          style={[
            styles.sigButton,
            {
              flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
              opacity: saving || !isCustom ? 0.5 : 1,
            },
          ]}
        >
          <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 14 }}>Reset to default</Text>
        </Pressable>
        <Pressable
          onPress={() => persist({ headerColor, headerTextColor, accentColor })}
          disabled={saving || !loaded || !allValid}
          style={[
            styles.sigButton,
            { flex: 1, backgroundColor: colors.primary, opacity: saving || !allValid ? 0.5 : 1 },
          ]}
        >
          <Text style={[styles.sigButtonText, { color: colors.primaryForeground }]}>
            {saving ? 'Saving…' : 'Save palette'}
          </Text>
        </Pressable>
      </View>
      {!allValid && (
        <Text style={{ color: colors.destructive, fontSize: 12 }}>
          Colors must be #RRGGBB hex values.
        </Text>
      )}

      {/* Sample report preview — server-rendered with current colors + logo */}
      <Pressable
        onPress={openPreview}
        disabled={previewLoading || !loaded || !allValid}
        style={[
          styles.sigButton,
          {
            backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
            opacity: previewLoading || !allValid ? 0.5 : 1,
            flexDirection: 'row', gap: 6, justifyContent: 'center',
          },
        ]}
      >
        <Icon name="file-text" size={15} color={colors.foreground} />
        <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 14 }}>
          {previewLoading ? 'Loading preview…' : 'Preview sample report'}
        </Text>
      </Pressable>

      <Modal
        visible={previewVisible}
        animationType="slide"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 12,
              borderBottomWidth: 1, borderBottomColor: colors.border,
            }}
          >
            <Text style={{ color: colors.foreground, fontWeight: '800', fontSize: 16 }}>
              Sample Report Preview
            </Text>
            <Pressable onPress={() => setPreviewVisible(false)} hitSlop={12}>
              <Icon name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          {previewHtml ? (
            <WebView
              originWhitelist={['*']}
              source={{ html: previewHtml }}
              style={{ flex: 1 }}
              startInLoadingState
              renderLoading={() => (
                <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              )}
            />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

function AccordionSection({
  title,
  iconName,
  open,
  onToggle,
  children,
  badge,
  colors,
}: {
  title: string;
  iconName: Parameters<typeof Icon>[0]['name'];
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: { label: string; variant: BadgeVariant };
  colors: ReturnType<typeof useColors>;
}) {
  const badgeBg: Record<BadgeVariant, string> = {
    success: '#ecfdf5',
    warn: '#fffbeb',
    muted: colors.muted,
  };
  const badgeColor: Record<BadgeVariant, string> = {
    success: colors.success,
    warn: '#b45309',
    muted: colors.mutedForeground,
  };

  return (
    <View style={[styles.accordion, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        onPress={onToggle}
        style={styles.accordionHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={[styles.accordionIconWrap, { backgroundColor: colors.muted }]}>
          <Icon name={iconName} size={16} color={colors.foreground} />
        </View>
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>{title}</Text>
        {badge && (
          <View style={[styles.sigBadge, { backgroundColor: badgeBg[badge.variant] }]}>
            <Text style={[styles.sigBadgeText, { color: badgeColor[badge.variant] }]}>
              {badge.label}
            </Text>
          </View>
        )}
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.mutedForeground}
        />
      </Pressable>
      {open && <View style={styles.accordionBody}>{children}</View>}
    </View>
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
  // ── Accordion ──────────────────────────────────────────────────────────────
  accordion: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 10,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  accordionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accordionTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  accordionBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  innerCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  subsectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 6,
    marginBottom: 2,
  },
  // ── Stats ──────────────────────────────────────────────────────────────────
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

import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  getGetCurrentAuthUserQueryKey,
  getGetCompanyReportSettingsQueryKey,
  getGetInspectionQueryKey,
  useGetCurrentAuthUser,
  useGetCompanyReportSettings,
  useGetInspection,
} from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/hooks/useProfile';
import { recordSignatureAttestation } from '@/lib/inspectionSync';
import { buildProtocolState } from '@/lib/inspectionProtocolState';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';

// E5 / S8 — Field Attestation. The inspector reads the Uniform Inspection
// Procedure attestation (populated with inspection-specific details) and
// attests to it by applying their signature-on-file (M-F / F0). The S8 proof
// recorded is a SHA-256 of the full rendered attestation text (body + footer)
// at the moment of signing; the on-file signature is recorded by reference.

/** Build the two parts of the Field Attestation at render time. */
function buildAttestation(opts: {
  address: string | null | undefined;
  dateOfLoss: string | null | undefined;
  companyName: string | null | undefined;
  inspectorName: string;
  licenseLine: string;
  signatureDate: string;
}) {
  const addr = opts.address?.trim() || 'this property';
  const inspDate = opts.dateOfLoss
    ? new Date(opts.dateOfLoss).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'the date of inspection';
  const company = opts.companyName?.trim() || 'my company';

  const body =
    `I attest that the inspection of the property at ${addr} on ${inspDate} ` +
    `was performed by me under ${company}'s Uniform Inspection Procedure; ` +
    `that the photographs, measurements, and observations in this inspection ` +
    `record were captured by me at the property on that date; that conditions ` +
    `I observed to be pre-existing or unrelated to the reported event are ` +
    `identified as such in the record; and that the findings recorded here are ` +
    `stated to my professional judgment within a reasonable degree of certainty.`;

  const licPart = opts.licenseLine ? ` — ${opts.licenseLine}` : '';
  const footer =
    `Inspector: ${opts.inspectorName}, Company: ${company}${licPart} ` +
    `Date of Attestation: ${opts.signatureDate}`;

  return { body, footer, full: `${body}\n\n${footer}` };
}

function formatLicenses(
  licenses: Array<{ state: string; number: string }>,
): string {
  if (!licenses.length) return '';
  return licenses.map((l) => `Lic. ${l.number} (${l.state})`).join(', ');
}

export default function InspectionDeclarationScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  useNextSectionHeader(id, 'declaration');

  const { signatureUrl, signatureSha256, signatureSignedAt, companyName, companyId, isLoading: profileLoading } =
    useProfile();

  const authQuery = useGetCurrentAuthUser({
    query: { queryKey: getGetCurrentAuthUserQueryKey() },
  });
  const authUser = authQuery.data?.user;

  const reportSettingsQuery = useGetCompanyReportSettings(companyId ?? '', {
    query: {
      enabled: !!companyId,
      queryKey: getGetCompanyReportSettingsQueryKey(companyId ?? ''),
    },
  });

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [agreed, setAgreed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const isLoading =
    (inspectionQuery.isLoading && !inspection) ||
    profileLoading ||
    authQuery.isLoading;

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Field Attestation' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Field Attestation' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const state = buildProtocolState(inspection);
  const alreadySigned = state.declarationSigned;
  const hasSignatureOnFile = !!signatureUrl && !!signatureSha256;

  const inspectorName = [authUser?.firstName, authUser?.lastName]
    .filter(Boolean)
    .join(' ') || (user?.email ?? 'Inspector');
  const licenseLine = formatLicenses(reportSettingsQuery.data?.settings?.licenses ?? []);
  const todayFormatted = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const attestation = buildAttestation({
    address: inspection.address,
    dateOfLoss: inspection.dateOfLoss,
    companyName: companyName,
    inspectorName,
    licenseLine,
    signatureDate: todayFormatted,
  });

  // Applies the on-file signature to this inspection. Hashes the full
  // rendered attestation text (body + footer with today's date) as the S8
  // proof — the hash is tied to these specific inspection details.
  async function handleApplySignature() {
    if (!user || saving || !hasSignatureOnFile) return;
    setSaving(true);
    try {
      // Recompute with the exact signing timestamp so the hash is reproducible.
      const signingDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const signingAttestation = buildAttestation({
        address: inspection!.address,
        dateOfLoss: inspection!.dateOfLoss,
        companyName: companyName,
        inspectorName,
        licenseLine,
        signatureDate: signingDate,
      });
      const declarationHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        signingAttestation.full,
      );
      await recordSignatureAttestation(queryClient, id, user.id, {
        declarationHash,
        signatureUrl: signatureUrl as string,
        signatureSha256: signatureSha256 as string,
        signedAt: signatureSignedAt ?? null,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  if (alreadySigned) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
      >
        <Stack.Screen options={{ title: 'Field Attestation' }} />
        <View style={[styles.banner, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
          <Icon name="check" size={22} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.foreground }]}>
              Field Attestation signed
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              The S8 attestation is recorded for this inspection.
            </Text>
          </View>
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
            {attestation.body}
          </Text>
          <View style={[styles.footerBar, { borderTopColor: colors.border }]}>
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              {attestation.footer}
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Field Attestation' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.section, { color: colors.foreground }]}>Field Attestation</Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          Rendered at Stage 10 of the Uniform Inspection Procedure — becomes part of the attested field record.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.bodyText, { color: colors.foreground }]}>
            {attestation.body}
          </Text>
          <View style={[styles.footerBar, { borderTopColor: colors.border }]}>
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              {attestation.footer}
            </Text>
          </View>
        </View>

        {!hasSignatureOnFile ? (
          <View style={[styles.banner, { backgroundColor: '#fffbeb', borderColor: '#f59e0b' }]}>
            <Icon name="alert-circle" size={22} color="#b45309" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: '#92400e' }]}>No signature on file</Text>
              <Text style={{ color: '#92400e', fontSize: 13 }}>
                Capture your signature on your profile once — it will be applied to this and every
                future field attestation.
              </Text>
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/(tabs)/profile', params: { returnTo: '1' } })
                }
                style={[styles.actionBtn, { backgroundColor: colors.secondary, marginTop: 10 }]}
              >
                <Text style={styles.actionText}>Set up my signature</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Pressable onPress={() => setAgreed((prev) => !prev)} style={styles.agreeRow}>
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: agreed ? colors.primary : 'transparent',
                    borderColor: agreed ? colors.primary : colors.border,
                  },
                ]}
              >
                {agreed ? <Icon name="check" size={14} color={colors.primaryForeground} /> : null}
              </View>
              <Text style={{ color: colors.foreground, flex: 1, fontSize: 14 }}>
                I have read and agree to the statement above.
              </Text>
            </Pressable>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              Your signature on file
            </Text>
            <View style={[styles.sigPreviewWrap, { borderColor: colors.border }]}>
              <Image
                source={{ uri: signatureUrl as string }}
                style={styles.sigPreview}
                resizeMode="contain"
              />
            </View>

            <Pressable
              onPress={handleApplySignature}
              disabled={!agreed || saving}
              style={[
                styles.actionBtn,
                { backgroundColor: colors.primary, opacity: !agreed || saving ? 0.5 : 1 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.actionText, { color: colors.primaryForeground }]}>
                  Apply my signature & attest
                </Text>
              )}
            </Pressable>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  bannerTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  section: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 12, lineHeight: 18, marginTop: -4 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  bodyText: { fontSize: 14, lineHeight: 22, padding: 16 },
  footerBar: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  footerText: { fontSize: 12, lineHeight: 18 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, fontWeight: '600' },
  sigPreviewWrap: { borderWidth: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff' },
  sigPreview: { width: '100%', height: 120 },
  actionBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  actionText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

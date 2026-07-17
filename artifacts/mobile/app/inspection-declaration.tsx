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
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/hooks/useProfile';
import { recordSignatureAttestation } from '@/lib/inspectionSync';
import { buildProtocolState } from '@/lib/inspectionProtocolState';

// E5 / S8 — Attestation & signature. The inspector reads the methodology
// declaration and attests to it by applying their signature-on-file (M-F / F0):
// they capture their signature once on their profile, and here they apply it to
// this specific inspection. The S8 proof recorded is a SHA-256 of the exact
// declaration text signed; the on-file signature is recorded by reference (its
// storage URL + hash), never re-drawn per inspection. Without a signature on
// file, S8 cannot be cleared — the screen routes the inspector to set one up.

const DECLARATION_TEXT =
  'I attest that I personally performed this inspection, that the captured ' +
  'evidence accurately and completely represents the conditions observed at ' +
  'the property on the date of inspection, and that I followed the required ' +
  'capture protocol for every documented slope, elevation, and damage ' +
  'instance. I have not omitted, altered, or staged any evidence.';

export default function InspectionDeclarationScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signatureUrl, signatureSha256, signatureSignedAt, isLoading: profileLoading } =
    useProfile();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [agreed, setAgreed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  if ((inspectionQuery.isLoading && !inspection) || profileLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Declaration' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Declaration' }} />
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const state = buildProtocolState(inspection);
  const alreadySigned = state.declarationSigned;
  const hasSignatureOnFile = !!signatureUrl && !!signatureSha256;

  // Applies the on-file signature to this inspection. We hash the exact
  // declaration text as the S8 proof and record the on-file signature by
  // reference — the raw image never re-enters the client payload.
  async function handleApplySignature() {
    if (!user || saving || !hasSignatureOnFile) return;
    setSaving(true);
    try {
      const declarationHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        DECLARATION_TEXT,
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
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: 'Declaration' }} />
        <View style={[styles.banner, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
          <Icon name="check" size={22} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.foreground }]}>Declaration signed</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              The S8 attestation is recorded for this inspection.
            </Text>
          </View>
        </View>
        <Text style={[styles.declaration, { color: colors.mutedForeground }]}>{DECLARATION_TEXT}</Text>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Declaration' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.section, { color: colors.foreground }]}>Inspector attestation</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.declaration, { color: colors.foreground }]}>{DECLARATION_TEXT}</Text>
        </View>

        {!hasSignatureOnFile ? (
          <View style={[styles.banner, { backgroundColor: '#fffbeb', borderColor: '#f59e0b' }]}>
            <Icon name="alert-circle" size={22} color="#b45309" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: '#92400e' }]}>No signature on file</Text>
              <Text style={{ color: '#92400e', fontSize: 13 }}>
                Capture your signature on your profile once — it will be applied to this and every
                future inspection declaration.
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
                  Apply my signature & sign
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
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
  bannerTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  section: { fontSize: 16, fontWeight: '700' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16 },
  declaration: { fontSize: 14, lineHeight: 21 },
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

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import { getGetInspectionQueryKey, useGetInspection } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { recordSignatureAttestation } from '@/lib/inspectionSync';
import { buildProtocolState } from '@/lib/inspectionProtocolState';

// E5 / S8 — Attestation & signature. The inspector reads the methodology
// declaration and signs. We never store the raw signature image: it is hashed
// (SHA-256) on-device with expo-crypto, and only the hash — alongside a hash of
// the exact declaration text signed — is persisted as the S8 stage_signoff
// attestation. That clears the S8 hard gate while keeping biometric-adjacent
// data off the wire.

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
  const signatureRef = React.useRef<SignatureViewRef>(null);

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [agreed, setAgreed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  if (inspectionQuery.isLoading && !inspection) {
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
  const alreadySigned = state.attestationRecorded;

  // Fired by the signature pad's confirm button with the signature as a
  // base64 data URL. We hash it (never store the image) and persist the S8
  // attestation.
  async function handleSignature(signature: string) {
    if (!user || saving) return;
    setSaving(true);
    try {
      const signatureHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        signature,
      );
      const declarationHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        DECLARATION_TEXT,
      );
      await recordSignatureAttestation(queryClient, id, user.id, signatureHash, declarationHash);
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

        {agreed ? (
          <>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              Sign below, then tap Confirm
            </Text>
            <View style={[styles.padWrap, { borderColor: colors.border }]}>
              <SignatureScreen
                ref={signatureRef}
                onOK={handleSignature}
                descriptionText=""
                clearText="Clear"
                confirmText="Confirm & sign"
                webStyle={SIGNATURE_WEB_STYLE}
              />
            </View>
            {saving ? (
              <View style={styles.savingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.mutedForeground }}>Recording attestation…</Text>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// The signature pad renders inside a WebView; this trims its chrome so only the
// canvas + Clear/Confirm buttons show.
const SIGNATURE_WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: none; margin: 0; }
  .m-signature-pad--body { border: none; }
  .m-signature-pad--footer { margin: 8px 0; }
  body, html { height: 100%; margin: 0; }
`;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
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
  padWrap: { height: 240, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
});

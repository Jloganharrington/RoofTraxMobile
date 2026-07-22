/**
 * Forensic agreement signing screen.
 *
 * Shows the full Forensic Inspection Purchase & Sale Agreement text,
 * pre-filled with property and inspector details. A signature canvas
 * is presented at the bottom. The "Confirm & Sign" button stays disabled
 * until the homeowner has scrolled to the bottom AND drawn a signature.
 *
 * On confirm, the signature image and signer name are sent to
 * POST /inspections/:id/agreement/sign. The server generates the PDF,
 * stores it in object storage, and returns the signed agreement record.
 */

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import {
  getGetInspectionQueryKey,
  useGetInspection,
} from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useSignAgreement } from '@/lib/agreementApi';

const AGREEMENT_VERSION = '1.0';

function buildAgreementText(params: {
  address: string;
  companyName: string;
  inspectorName: string;
  today: string;
  inspectionId: string;
}): string {
  const { address, companyName, inspectorName, today, inspectionId } = params;
  return `FORENSIC INSPECTION PURCHASE & SALE AGREEMENT
Document version ${AGREEMENT_VERSION} · Inspection ID: ${inspectionId}

This Forensic Inspection Purchase & Sale Agreement ("Agreement") is entered into on ${today} by and between the Property Owner / Authorized Representative identified below ("Homeowner") and ${companyName} ("Company"), represented on-site by Inspector: ${inspectorName}.

Property Address: ${address}

─────────────────────────────────────────

1. SCOPE OF SERVICES
The Homeowner hereby authorizes ${companyName} to conduct a full forensic roof and exterior inspection of the above-referenced property. The inspection shall document all observable storm-related or weather-related damage to the roof system, siding, gutters, windows, collateral structures, and any affected interior areas. The inspection findings will be compiled into a documented, photo-backed proof package.

2. AUTHORIZATION
The Homeowner confirms they are the owner of the property or have lawful authority to authorize this inspection on behalf of the owner. By signing below, the Homeowner grants ${companyName} personnel permission to access the property, including the roof, exterior, and interior spaces (where applicable), for the purpose of conducting the forensic inspection.

3. PURPOSE OF INSPECTION
The forensic inspection is conducted to document existing conditions and storm-related damage. The findings are compiled to support an insurance claim process. This Agreement and the resulting inspection report do not constitute a guarantee of insurance coverage, a repair estimate, or a warranty of any kind.

4. PHOTO DOCUMENTATION
The Homeowner consents to photo and video documentation of the property during the inspection. All documentation is used solely for the purpose of compiling the forensic proof package and supporting any related insurance claim or legal proceeding.

5. ACCURACY OF INFORMATION
The Homeowner acknowledges that all information provided to ${companyName} regarding the property, prior claims, prior repairs, and date of loss is accurate and complete to the best of their knowledge.

6. NO LEGAL OR FINANCIAL ADVICE
Nothing in this Agreement or the resulting inspection report constitutes legal advice, financial advice, or a determination of insurance coverage. The Homeowner is advised to consult with their insurance carrier and independent legal counsel as needed.

7. ELECTRONIC SIGNATURE
The parties agree that an electronic or digital signature applied to this document is legally binding and has the same force and effect as a handwritten signature under the Electronic Signatures in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. § 7001 et seq.) and the Uniform Electronic Transactions Act (UETA), as applicable.

─────────────────────────────────────────

By signing below, the Homeowner agrees to all terms above and authorizes the forensic inspection described herein.`;
}

export default function InspectionAgreementScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, companyName } = useProfile();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const signatureRef = useRef<SignatureViewRef>(null);

  const [signerName, setSignerName] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [sigCleared, setSigCleared] = useState(false);

  const signAgreement = useSignAgreement();

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Profile doesn't expose first/last name; the server stamps the real
  // inspector name on the PDF via the users table. Use company name here.
  const inspectorDisplayName = companyName ? `${companyName} inspector` : 'Inspector';

  const agreementText = inspection
    ? buildAgreementText({
        address: inspection.address ?? 'Address not provided',
        companyName: companyName ?? 'the inspection company',
        inspectorName: inspectorDisplayName,
        today,
        inspectionId: id,
      })
    : '';

  const canSign =
    hasScrolledToBottom &&
    !!signatureData &&
    signerName.trim().length >= 2 &&
    !signAgreement.isPending;

  function handleScrollEnd(event: {
    nativeEvent: {
      layoutMeasurement: { height: number };
      contentOffset: { y: number };
      contentSize: { height: number };
    };
  }) {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
    if (isNearBottom) setHasScrolledToBottom(true);
  }

  // SignatureScreen only calls onOK when readSignature() is explicitly invoked.
  // Trigger it after every stroke so signatureData stays in sync without
  // requiring the user or code to tap a separate "capture" button.
  function handleStrokeEnd() {
    signatureRef.current?.readSignature();
  }

  function handleSignatureOK(sig: string) {
    // sig is a data URI: "data:image/png;base64,..."
    // Strip the prefix to get the raw base64.
    const base64 = sig.replace(/^data:image\/png;base64,/, '');
    setSignatureData(base64);
  }

  function handleClear() {
    signatureRef.current?.clearSignature();
    setSignatureData(null);
    setSigCleared((prev) => !prev); // force re-render of canvas
  }

  async function handleConfirm() {
    if (!canSign || !signatureData) return;

    const name = signerName.trim();

    Alert.alert(
      'Confirm & Sign',
      `By tapping "Sign Now", ${name} agrees to the Forensic Inspection Purchase & Sale Agreement. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Now',
          style: 'default',
          onPress: async () => {
            try {
              await signAgreement.mutateAsync({
                inspectionId: id,
                signerName: name,
                signatureImageBase64: signatureData,
              });
              Alert.alert(
                'Agreement Signed',
                'The agreement has been signed and saved. A PDF has been generated and stored.',
                [{ text: 'OK', onPress: () => router.back() }],
              );
            } catch (err) {
              const message =
                err instanceof Error ? err.message : 'Something went wrong. Please try again.';
              Alert.alert('Could not sign', message);
            }
          },
        },
      ],
    );
  }

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Get Signature' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Stack.Screen options={{ title: 'Get Homeowner Signature' }} />

      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={handleScrollEnd}
        scrollEventThrottle={200}
      >
        {/* Agreement text */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.headerRow}>
            <Icon name="file-text" size={20} color={colors.foreground} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Forensic Inspection Purchase &amp; Sale Agreement
            </Text>
          </View>
          <Text style={[styles.agreementText, { color: colors.foreground }]}>
            {agreementText}
          </Text>
        </View>

        {/* Scroll prompt */}
        {!hasScrolledToBottom ? (
          <View
            style={[
              styles.scrollPrompt,
              { backgroundColor: '#fffbeb', borderColor: '#f59e0b' },
            ]}
          >
            <Icon name="chevron-down" size={16} color="#b45309" />
            <Text style={{ color: '#92400e', fontSize: 13, flex: 1 }}>
              Scroll to the bottom to review the full agreement before signing.
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.scrollPrompt,
              { backgroundColor: '#ecfdf5', borderColor: colors.success },
            ]}
          >
            <Icon name="check" size={16} color={colors.success} />
            <Text style={{ color: colors.success, fontSize: 13, flex: 1 }}>
              Agreement reviewed — please have the homeowner sign below.
            </Text>
          </View>
        )}

        {/* Signer name */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            Homeowner's full name
          </Text>
          <TextInput
            value={signerName}
            onChangeText={setSignerName}
            placeholder="Full legal name"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            autoCorrect={false}
            style={[
              styles.textInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />
        </View>

        {/* Signature canvas */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.headerRow}>
            <Icon name="edit-3" size={18} color={colors.foreground} />
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              Homeowner signature
            </Text>
            <Pressable onPress={handleClear} hitSlop={8}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Clear</Text>
            </Pressable>
          </View>

          <View
            style={[
              styles.signatureBorder,
              {
                borderColor: signatureData ? colors.success : colors.border,
                backgroundColor: '#ffffff',
              },
            ]}
          >
            <SignatureScreen
              key={String(sigCleared)}
              ref={signatureRef}
              onOK={handleSignatureOK}
              onEmpty={() => setSignatureData(null)}
              minWidth={1.5}
              maxWidth={4}
              penColor="#0f2942"
              webStyle={`
                .m-signature-pad { box-shadow: none; border: none; }
                .m-signature-pad--body { border: none; }
                .m-signature-pad--footer { display: none; }
                body { background-color: #ffffff; }
              `}
              style={styles.signatureCanvas}
              // onEnd fires after each stroke; readSignature() triggers onOK with
              // the current canvas data URI so signatureData stays in sync.
              onEnd={handleStrokeEnd}
              autoClear={false}
              dataURL=""
            />
          </View>

          {signatureData ? (
            <View style={[styles.sigStatus, { backgroundColor: '#ecfdf5' }]}>
              <Icon name="check" size={14} color={colors.success} />
              <Text style={{ color: colors.success, fontSize: 12 }}>Signature captured</Text>
            </View>
          ) : (
            <View style={[styles.sigStatus, { backgroundColor: colors.muted }]}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                Have the homeowner draw their signature above
              </Text>
            </View>
          )}
        </View>

        {/* Confirm button */}
        <Pressable
          onPress={handleConfirm}
          disabled={!canSign}
          style={[
            styles.confirmBtn,
            {
              backgroundColor: colors.primary,
              opacity: canSign ? 1 : 0.45,
            },
          ]}
        >
          {signAgreement.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Icon name="check" size={18} color={colors.primaryForeground} />
              <Text style={[styles.confirmText, { color: colors.primaryForeground }]}>
                Confirm &amp; Sign
              </Text>
            </>
          )}
        </Pressable>

        {!hasScrolledToBottom && (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: 'center' }}>
            Scroll through the agreement to enable signing.
          </Text>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  fieldLabel: { fontSize: 14, fontWeight: '600' },
  agreementText: { fontSize: 12, lineHeight: 20, fontFamily: 'monospace' },
  scrollPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  signatureBorder: {
    borderWidth: 1.5,
    borderRadius: 10,
    overflow: 'hidden',
    height: 200,
  },
  signatureCanvas: { flex: 1, height: 200 },
  sigStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 4,
  },
  confirmText: { fontSize: 16, fontWeight: '800' },
});

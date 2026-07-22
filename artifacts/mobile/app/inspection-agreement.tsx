/**
 * Forensic agreement signing screen — immediately follows Phase 1 completion.
 *
 * Flow:
 *   1. Owner name pre-filled from insuredName (Phase 1). If missing → modal.
 *   2. WebView shows the real FIPSA HTML pre-filled with property + date.
 *   3. Rep scrolls homeowner through both pages; scroll-to-bottom gate unlocks signing.
 *   4. Homeowner draws signature on canvas below.
 *   5. Confirm → expo-print generates signed PDF on-device → uploaded to server.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import {
  getGetInspectionQueryKey,
  useGetInspection,
} from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useSignAgreement } from '@/lib/agreementApi';
import {
  addBusinessDays,
  buildFipsaHtml,
  buildPreviewHtml,
  formatMDY,
} from '@/lib/fipsaTemplate';

// Injected into the preview WebView to fire a message when scrolled to end.
const SCROLL_DETECT_JS = `
(function(){
  var done=false;
  function chk(){
    if(done)return;
    if(window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-60){
      done=true;
      if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage('bottom');
    }
  }
  window.addEventListener('scroll',chk,{passive:true});
  setTimeout(chk,700);
})();
true;
`;

export default function InspectionAgreementScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { companyName } = useProfile();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const signatureRef = useRef<SignatureViewRef>(null);

  const [signerName, setSignerName] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [sigCleared, setSigCleared] = useState(false);

  // Owner-name modal — shown when Phase 1 didn't capture insuredName
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameModalDraft, setNameModalDraft] = useState('');

  const signAgreement = useSignAgreement();

  const today = new Date();
  const todayMDY = formatMDY(today);
  const cancelDeadlineMDY = formatMDY(addBusinessDays(today, 3));

  // Pre-fill from Phase 1 data once loaded; open modal if missing.
  useEffect(() => {
    if (!inspection) return;
    const name = inspection.insuredName?.trim() ?? '';
    if (name.length >= 2) {
      setSignerName(name);
    } else {
      setNameModalVisible(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection?.id]);

  // Pre-filled FIPSA HTML for the reading WebView (no signature image yet).
  const previewHtml = useMemo(() => {
    return buildPreviewHtml({
      ownerNames: signerName || '___________________________',
      agreementDate: todayMDY,
      propertyAddress: inspection?.address ?? '',
      owner: { signatureImage: '', printName: signerName, signDate: todayMDY },
      contractorRep: {
        signatureImage: '',
        printName: companyName ?? 'NuHome Exteriors',
        signDate: todayMDY,
      },
      cancellation: {
        transactionDate: todayMDY,
        cancelDeadline: cancelDeadlineMDY,
        buyerDate: '',
        buyerSignatureImage: '',
      },
    });
  }, [signerName, inspection?.address, todayMDY, cancelDeadlineMDY, companyName]);

  const canSign =
    hasScrolledToBottom &&
    !!signatureData &&
    signerName.trim().length >= 2 &&
    !signAgreement.isPending;

  function handleStrokeEnd() {
    signatureRef.current?.readSignature();
  }

  function handleSignatureOK(sig: string) {
    const base64 = sig.replace(/^data:image\/png;base64,/, '');
    setSignatureData(base64);
  }

  function handleClear() {
    signatureRef.current?.clearSignature();
    setSignatureData(null);
    setSigCleared((prev) => !prev);
  }

  async function handleConfirm() {
    if (!canSign || !signatureData || !inspection) return;

    const name = signerName.trim();

    Alert.alert(
      'Confirm & Sign',
      `By tapping "Sign Now", ${name} agrees to the Forensic Inspection & Preconstruction Services Agreement. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Now',
          style: 'default',
          onPress: async () => {
            try {
              // 1. Build fully filled FIPSA HTML with embedded signature.
              const signedHtml = buildFipsaHtml({
                ownerNames: name,
                agreementDate: todayMDY,
                propertyAddress: inspection.address ?? '',
                owner: {
                  signatureImage: `data:image/png;base64,${signatureData}`,
                  printName: name,
                  signDate: todayMDY,
                },
                contractorRep: {
                  signatureImage: '',
                  printName: companyName ?? 'NuHome Exteriors',
                  signDate: todayMDY,
                },
                cancellation: {
                  transactionDate: todayMDY,
                  cancelDeadline: cancelDeadlineMDY,
                  buyerDate: '',
                  buyerSignatureImage: '',
                },
              });

              // 2. Render to PDF on-device via expo-print.
              const { uri } = await Print.printToFileAsync({ html: signedHtml });

              // 3. Read as base64 for upload.
              // EncodingType enum was removed in expo-file-system v19; use the string literal.
              const pdfBase64 = await FileSystem.readAsStringAsync(uri, {
                encoding: 'base64' as const,
              });

              // 4. Clean up temp file.
              await FileSystem.deleteAsync(uri, { idempotent: true });

              // 5. Upload to server — stores in object storage + writes audit record.
              await signAgreement.mutateAsync({
                inspectionId: id,
                signerName: name,
                pdfBase64,
              });

              Alert.alert(
                'Agreement Signed',
                'The signed agreement has been saved.',
                [{ text: 'Done', onPress: () => router.back() }],
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

      {/* ── Owner-name modal ─────────────────────────────────────────────── */}
      <Modal
        visible={nameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (nameModalDraft.trim().length >= 2) {
            setSignerName(nameModalDraft.trim());
            setNameModalVisible(false);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Owner's Name
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              The owner's name was not captured in Phase 1. Please enter it now to continue.
            </Text>
            <TextInput
              value={nameModalDraft}
              onChangeText={setNameModalDraft}
              placeholder="Full legal name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              style={[
                styles.textInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
            <Pressable
              onPress={() => {
                const name = nameModalDraft.trim();
                if (name.length < 2) return;
                setSignerName(name);
                setNameModalVisible(false);
              }}
              disabled={nameModalDraft.trim().length < 2}
              style={[
                styles.modalBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: nameModalDraft.trim().length >= 2 ? 1 : 0.45,
                },
              ]}
            >
              <Text style={[styles.modalBtnText, { color: colors.primaryForeground }]}>
                Continue
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.content}>

        {/* ── Agreement viewer ─────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.headerRow}>
            <Icon name="file-text" size={18} color={colors.foreground} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Agreement — scroll to read both pages
            </Text>
          </View>

          <View style={[styles.webviewWrap, { borderColor: colors.border }]}>
            <WebView
              source={{ html: previewHtml }}
              injectedJavaScript={SCROLL_DETECT_JS}
              onMessage={(e) => {
                if (e.nativeEvent.data === 'bottom') setHasScrolledToBottom(true);
              }}
              scrollEnabled
              nestedScrollEnabled
              showsVerticalScrollIndicator
              originWhitelist={['*']}
              style={styles.webview}
            />
          </View>
        </View>

        {/* ── Scroll status ─────────────────────────────────────────────────── */}
        {!hasScrolledToBottom ? (
          <View style={[styles.banner, { backgroundColor: '#fffbeb', borderColor: '#f59e0b' }]}>
            <Icon name="chevron-down" size={16} color="#b45309" />
            <Text style={{ color: '#92400e', fontSize: 13, flex: 1 }}>
              Scroll through both pages to enable signing.
            </Text>
          </View>
        ) : (
          <View style={[styles.banner, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
            <Icon name="check" size={16} color={colors.success} />
            <Text style={{ color: colors.success, fontSize: 13, flex: 1 }}>
              Agreement reviewed — have the homeowner sign below.
            </Text>
          </View>
        )}

        {/* ── Signer name (editable for corrections) ────────────────────────── */}
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

        {/* ── Signature canvas ─────────────────────────────────────────────── */}
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

        {/* ── Confirm button ───────────────────────────────────────────────── */}
        <Pressable
          onPress={handleConfirm}
          disabled={!canSign}
          style={[
            styles.confirmBtn,
            { backgroundColor: colors.primary, opacity: canSign ? 1 : 0.45 },
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
  cardTitle: { fontSize: 14, fontWeight: '700', flex: 1 },
  fieldLabel: { fontSize: 14, fontWeight: '600' },

  webviewWrap: { borderWidth: 1, borderRadius: 10, overflow: 'hidden', height: 520 },
  webview: { flex: 1 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  textInput: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  signatureBorder: { borderWidth: 1.5, borderRadius: 10, overflow: 'hidden', height: 200 },
  signatureCanvas: { flex: 1, height: 200 },
  sigStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 14, marginTop: 4,
  },
  confirmText: { fontSize: 16, fontWeight: '800' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 420, borderRadius: 18,
    padding: 24, gap: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalBody: { fontSize: 14, lineHeight: 20 },
  modalBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  modalBtnText: { fontSize: 16, fontWeight: '700' },
});

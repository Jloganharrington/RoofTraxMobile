/**
 * Forensic agreement signing screen — immediately follows Phase 1 completion.
 *
 * Flow:
 *   1. Owner name pre-filled from insuredName (Phase 1). If missing → modal.
 *   2. WebView shows the real FIPSA HTML pre-filled with property + date.
 *   3. Rep scrolls homeowner through both pages; scroll-to-bottom gate appears.
 *   4. Two buttons — "Owner's Signature" and "Rep Signature" — each open a
 *      full-screen signature modal so the screen stays locked while signing.
 *   5. Rep modal includes a printed-name field (rep's own name, not company).
 *   6. Confirm → expo-print generates signed PDF on-device → uploaded to server.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
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

type ActiveModal = 'owner' | 'rep' | 'ownerName' | null;

export default function InspectionAgreementScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { companyName, profile } = useProfile();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  // ── Owner signature ─────────────────────────────────────────────────────────
  const ownerSigRef = useRef<SignatureViewRef>(null);
  const [ownerSigData, setOwnerSigData] = useState<string | null>(null);
  const [ownerSigKey, setOwnerSigKey] = useState(0);

  // ── Rep signature ───────────────────────────────────────────────────────────
  const repSigRef = useRef<SignatureViewRef>(null);
  const [repSigData, setRepSigData] = useState<string | null>(null);
  const [repSigKey, setRepSigKey] = useState(0);
  const [repPrintName, setRepPrintName] = useState('');

  // ── Shared modal state ──────────────────────────────────────────────────────
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  // ── Owner name (pre-filled from Phase 1) ───────────────────────────────────
  const [signerName, setSignerName] = useState('');
  const [ownerNameDraft, setOwnerNameDraft] = useState('');

  // ── Scroll gate ─────────────────────────────────────────────────────────────
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  const signAgreement = useSignAgreement();

  const today = new Date();
  const todayMDY = formatMDY(today);
  const cancelDeadlineMDY = formatMDY(addBusinessDays(today, 3));

  // Pre-fill from Phase 1 and profile once loaded.
  useEffect(() => {
    if (!inspection) return;
    const name = inspection.insuredName?.trim() ?? '';
    if (name.length >= 2) {
      setSignerName(name);
    } else {
      setActiveModal('ownerName');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection?.id]);

  useEffect(() => {
    // Pre-fill rep's printed name from their profile.
    const name = (profile as { name?: string } | undefined)?.name?.trim() ?? '';
    if (name.length >= 2) setRepPrintName(name);
  }, [profile]);

  // Preview HTML — no signature images yet, just the filled-in text.
  const previewHtml = useMemo(() => {
    return buildPreviewHtml({
      ownerNames: signerName || '___________________________',
      agreementDate: todayMDY,
      propertyAddress: inspection?.address ?? '',
      owner: { signatureImage: '', printName: signerName, signDate: todayMDY },
      contractorRep: {
        signatureImage: '',
        printName: repPrintName || companyName || 'NuHome Exteriors',
        signDate: todayMDY,
      },
      cancellation: {
        transactionDate: todayMDY,
        cancelDeadline: cancelDeadlineMDY,
        buyerDate: '',
        buyerSignatureImage: '',
      },
    });
  }, [signerName, repPrintName, inspection?.address, todayMDY, cancelDeadlineMDY, companyName]);

  const canSign =
    hasScrolledToBottom &&
    !!ownerSigData &&
    !!repSigData &&
    signerName.trim().length >= 2 &&
    repPrintName.trim().length >= 2 &&
    !signAgreement.isPending;

  // ── Owner signature modal handlers ──────────────────────────────────────────
  function clearOwnerSig() {
    ownerSigRef.current?.clearSignature();
    setOwnerSigData(null);
    setOwnerSigKey((k) => k + 1);
  }

  function confirmOwnerSig() {
    ownerSigRef.current?.readSignature();
  }

  // ── Rep signature modal handlers ────────────────────────────────────────────
  function clearRepSig() {
    repSigRef.current?.clearSignature();
    setRepSigData(null);
    setRepSigKey((k) => k + 1);
  }

  function confirmRepSig() {
    repSigRef.current?.readSignature();
  }

  // ── Final confirm ────────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!canSign || !ownerSigData || !repSigData || !inspection) return;

    const ownerName = signerName.trim();
    const repName = repPrintName.trim();

    Alert.alert(
      'Confirm & Sign',
      `By tapping "Sign Now", ${ownerName} and ${repName} agree to the Forensic Inspection & Preconstruction Services Agreement. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Now',
          style: 'default',
          onPress: async () => {
            try {
              const signedHtml = buildFipsaHtml({
                ownerNames: ownerName,
                agreementDate: todayMDY,
                propertyAddress: inspection.address ?? '',
                owner: {
                  signatureImage: `data:image/png;base64,${ownerSigData}`,
                  printName: ownerName,
                  signDate: todayMDY,
                },
                contractorRep: {
                  signatureImage: `data:image/png;base64,${repSigData}`,
                  printName: repName,
                  signDate: todayMDY,
                },
                cancellation: {
                  transactionDate: todayMDY,
                  cancelDeadline: cancelDeadlineMDY,
                  buyerDate: '',
                  buyerSignatureImage: '',
                },
              });

              const { uri } = await Print.printToFileAsync({ html: signedHtml });

              // expo-file-system v19: readAsStringAsync is gone; use File.bytes()
              interface UsableFile { bytes(): Promise<Uint8Array>; delete(): Promise<void>; }
              const pdfFile = new (FileSystem as unknown as { File: new (u: string) => UsableFile }).File(uri);
              const bytes = await pdfFile.bytes();
              // safe chunked base64 — avoid call-stack limit on large PDFs
              let binary = '';
              const CHUNK = 8192;
              for (let i = 0; i < bytes.length; i += CHUNK) {
                binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
              }
              const pdfBase64 = btoa(binary);
              await pdfFile.delete();

              await signAgreement.mutateAsync({
                inspectionId: id,
                signerName: ownerName,
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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: 'Agreement Signing' }} />

      {/* ── Owner name modal ────────────────────────────────────────────────── */}
      <Modal
        visible={activeModal === 'ownerName'}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (ownerNameDraft.trim().length >= 2) {
            setSignerName(ownerNameDraft.trim());
            setActiveModal(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.sheetCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Owner's Name
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              The owner's name was not captured in Phase 1. Enter it to continue.
            </Text>
            <TextInput
              value={ownerNameDraft}
              onChangeText={setOwnerNameDraft}
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
                const name = ownerNameDraft.trim();
                if (name.length < 2) return;
                setSignerName(name);
                setActiveModal(null);
              }}
              disabled={ownerNameDraft.trim().length < 2}
              style={[
                styles.modalBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: ownerNameDraft.trim().length >= 2 ? 1 : 0.45,
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

      {/* ── Owner signature modal ────────────────────────────────────────────── */}
      <Modal
        visible={activeModal === 'owner'}
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <SafeAreaView style={[styles.sigModal, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[styles.sigModalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setActiveModal(null)} hitSlop={12}>
              <Icon name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.sigModalTitle, { color: colors.foreground }]}>
              Owner's Signature
            </Text>
            <Text style={[styles.sigModalSubtitle, { color: colors.mutedForeground }]}>
              {signerName}
            </Text>
          </View>

          {/* Canvas */}
          <View style={[styles.sigCanvasWrap, { backgroundColor: '#ffffff' }]}>
            <SignatureScreen
              key={`owner-${ownerSigKey}`}
              ref={ownerSigRef}
              onOK={(sig) => {
                const base64 = sig.replace(/^data:image\/png;base64,/, '');
                setOwnerSigData(base64);
                setActiveModal(null);
              }}
              onEmpty={() => setOwnerSigData(null)}
              onEnd={() => ownerSigRef.current?.readSignature()}
              minWidth={1.5}
              maxWidth={4}
              penColor="#0f2942"
              webStyle={SIG_WEB_STYLE}
              style={{ flex: 1 }}
              autoClear={false}
              dataURL=""
            />
          </View>

          {/* Footer */}
          <View style={[styles.sigModalFooter, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            <Pressable onPress={clearOwnerSig} style={styles.clearBtn}>
              <Icon name="refresh-cw" size={16} color={colors.mutedForeground} />
              <Text style={[styles.clearBtnText, { color: colors.mutedForeground }]}>Clear</Text>
            </Pressable>
            <Pressable
              onPress={confirmOwnerSig}
              style={[styles.doneBtn, { backgroundColor: colors.primary }]}
            >
              <Icon name="check" size={18} color={colors.primaryForeground} />
              <Text style={[styles.doneBtnText, { color: colors.primaryForeground }]}>
                Done
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Rep signature modal ──────────────────────────────────────────────── */}
      <Modal
        visible={activeModal === 'rep'}
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <SafeAreaView style={[styles.sigModal, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[styles.sigModalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setActiveModal(null)} hitSlop={12}>
              <Icon name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.sigModalTitle, { color: colors.foreground }]}>
              Rep's Signature
            </Text>
            <Text style={[styles.sigModalSubtitle, { color: colors.mutedForeground }]}>
              {companyName}
            </Text>
          </View>

          {/* Printed name input */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 6 }}
          >
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              Printed name
            </Text>
            <TextInput
              value={repPrintName}
              onChangeText={setRepPrintName}
              placeholder="Rep's full name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              style={[
                styles.textInput,
                {
                  color: colors.foreground,
                  borderColor: repPrintName.trim().length >= 2 ? colors.primary : colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
          </KeyboardAvoidingView>

          {/* Canvas */}
          <View style={[styles.sigCanvasWrap, { backgroundColor: '#ffffff' }]}>
            <SignatureScreen
              key={`rep-${repSigKey}`}
              ref={repSigRef}
              onOK={(sig) => {
                const base64 = sig.replace(/^data:image\/png;base64,/, '');
                setRepSigData(base64);
                setActiveModal(null);
              }}
              onEmpty={() => setRepSigData(null)}
              onEnd={() => repSigRef.current?.readSignature()}
              minWidth={1.5}
              maxWidth={4}
              penColor="#0f2942"
              webStyle={SIG_WEB_STYLE}
              style={{ flex: 1 }}
              autoClear={false}
              dataURL=""
            />
          </View>

          {/* Footer */}
          <View style={[styles.sigModalFooter, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            <Pressable onPress={clearRepSig} style={styles.clearBtn}>
              <Icon name="refresh-cw" size={16} color={colors.mutedForeground} />
              <Text style={[styles.clearBtnText, { color: colors.mutedForeground }]}>Clear</Text>
            </Pressable>
            <Pressable
              disabled={repPrintName.trim().length < 2}
              onPress={confirmRepSig}
              style={[
                styles.doneBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: repPrintName.trim().length >= 2 ? 1 : 0.45,
                },
              ]}
            >
              <Icon name="check" size={18} color={colors.primaryForeground} />
              <Text style={[styles.doneBtnText, { color: colors.primaryForeground }]}>
                Done
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Top controls (compact, no scroll) ──────────────────────────────── */}
      <View style={[styles.topControls, { borderBottomColor: colors.border }]}>

        {/* Homeowner name — single inline row */}
        <View style={styles.nameRow}>
          <Text style={[styles.nameLabel, { color: colors.mutedForeground }]}>
            Homeowner
          </Text>
          <TextInput
            value={signerName}
            onChangeText={setSignerName}
            placeholder="Full legal name"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            autoCorrect={false}
            style={[
              styles.nameInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />
        </View>

        {/* Signature buttons */}
        <View style={styles.sigButtonRow}>
          <SigButton
            label="Owner's Signature"
            signed={!!ownerSigData}
            onPress={() => setActiveModal('owner')}
            colors={colors}
          />
          <SigButton
            label="Rep Signature"
            signed={!!repSigData}
            onPress={() => setActiveModal('rep')}
            colors={colors}
          />
        </View>

        {/* Scroll gate status */}
        {!hasScrolledToBottom ? (
          <View style={[styles.banner, { backgroundColor: '#fffbeb', borderColor: '#f59e0b' }]}>
            <Icon name="chevron-down" size={14} color="#b45309" />
            <Text style={{ color: '#92400e', fontSize: 12, flex: 1 }}>
              Scroll through both pages to enable signing.
            </Text>
          </View>
        ) : (
          <View style={[styles.banner, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
            <Icon name="check" size={14} color={colors.success} />
            <Text style={{ color: colors.success, fontSize: 12, flex: 1 }}>
              Agreement reviewed — collect both signatures.
            </Text>
          </View>
        )}
      </View>

      {/* ── Document viewer — fills remaining space ──────────────────────────── */}
      <WebView
        source={{ html: previewHtml }}
        injectedJavaScript={SCROLL_DETECT_JS}
        onMessage={(e) => {
          if (e.nativeEvent.data === 'bottom') setHasScrolledToBottom(true);
        }}
        scrollEnabled
        showsVerticalScrollIndicator
        originWhitelist={['*']}
        style={styles.webview}
      />

      {/* ── Bottom confirm bar ───────────────────────────────────────────────── */}
      <View style={[styles.bottomBar, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
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
      </View>
    </View>
  );
}

// ── Sig button chip ────────────────────────────────────────────────────────────
function SigButton({
  label,
  signed,
  onPress,
  colors,
}: {
  label: string;
  signed: boolean;
  onPress: () => void;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.sigBtn,
        {
          backgroundColor: signed ? '#ecfdf5' : colors.card,
          borderColor: signed ? colors.success : colors.border,
        },
      ]}
    >
      <Icon
        name={signed ? 'check' : 'clipboard'}
        size={20}
        color={signed ? colors.success : colors.mutedForeground}
      />
      <Text
        style={[
          styles.sigBtnLabel,
          { color: signed ? colors.success : colors.foreground },
        ]}
      >
        {label}
      </Text>
      {signed && (
        <Text style={{ fontSize: 11, color: colors.success, fontWeight: '600' }}>
          ✓ Signed
        </Text>
      )}
    </Pressable>
  );
}

// ── Shared signature pad CSS ───────────────────────────────────────────────────
const SIG_WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: none; }
  .m-signature-pad--body { border: none; }
  .m-signature-pad--footer { display: none; }
  body { background-color: #ffffff; margin: 0; }
`;

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },

  // Signature button row
  sigButtonRow: { flexDirection: 'row', gap: 10 },
  sigBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  sigBtnLabel: { fontSize: 13, fontWeight: '700', textAlign: 'center' },

  // Top controls panel
  topControls: {
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
    gap: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameLabel: { fontSize: 13, fontWeight: '600', width: 80 },
  nameInput: {
    flex: 1, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, fontSize: 14,
  },

  // Shared inputs / labels (used inside modals)
  fieldLabel: { fontSize: 14, fontWeight: '600' },
  textInput: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },

  // Document WebView — fills remaining flex space
  webview: { flex: 1 },

  // Banner
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
  },

  // Bottom confirm bar
  bottomBar: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14,
  },
  confirmText: { fontSize: 16, fontWeight: '800' },

  // Owner-name modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  sheetCard: {
    width: '100%', maxWidth: 420, borderRadius: 18,
    padding: 24, gap: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalBody: { fontSize: 14, lineHeight: 20 },
  modalBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  modalBtnText: { fontSize: 16, fontWeight: '700' },

  // Full-screen signature modal
  sigModal: { flex: 1 },
  sigModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sigModalTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  sigModalSubtitle: { fontSize: 13 },
  sigCanvasWrap: { flex: 1 },
  sigModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10 },
  clearBtnText: { fontSize: 15 },
  doneBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  doneBtnText: { fontSize: 16, fontWeight: '700' },
});

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
  getListInspectionsQueryKey,
  getListScheduledInspectionsQueryKey,
  useGetInspection,
  customFetch,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { useSignAgreement, useEmailAgreement } from '@/lib/agreementApi';
import { useAuth } from '@/lib/auth';
import { getToken } from '@/lib/tokenStorage';
import {
  addBusinessDays,
  buildFipsaHtml,
  buildPreviewHtml,
  buildReadableHtml,
  formatMDY,
} from '@/lib/fipsaTemplate';
import { CalendarPicker } from '@/components/CalendarPicker';

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

// CalendarPicker lives in components/CalendarPicker.tsx (shared with inspections screen).

type ActiveModal = 'owner' | 'rep' | 'ownerName' | null;

export default function InspectionAgreementScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { companyName, companyLogoUrl } = useProfile();
  const { user } = useAuth();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  // ── Company logo — resolved to a data URI so it embeds cleanly in WebView HTML.
  // Uses fetch() with a Bearer header (same pattern as all other authenticated
  // API calls) rather than FileSystem.downloadAsync, which is unreliable for
  // authenticated requests in Expo SDK 54. Content-type is read from the
  // response header so PNG and JPEG both encode correctly.
  const [logoDataUri, setLogoDataUri] = useState<string | null>(null);
  useEffect(() => {
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
      } catch { /* logo is non-critical — template renders without it */ }
    })();
    return () => { active = false; };
  }, [companyLogoUrl]);

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

  const queryClient = useQueryClient();
  const signAgreement = useSignAgreement();
  const emailAgreement = useEmailAgreement();
  const [scheduling, setScheduling] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');

  // ── Readable review modal ────────────────────────────────────────────────────
  const [showReadModal, setShowReadModal] = useState(false);

  // ── Post-signing flow state ──────────────────────────────────────────────────
  const [signedDocHtml, setSignedDocHtml] = useState<string | null>(null);
  const [showDocPreview, setShowDocPreview] = useState(false);
  const [showNextSteps, setShowNextSteps] = useState(false);
  const [showFtcWarning, setShowFtcWarning] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [emailSentAt, setEmailSentAt] = useState<string | null>(null);
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; }, []);
  const [scheduledDate, setScheduledDate] = useState<Date>(tomorrow);

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
    // Pre-fill owner email if already saved on this inspection.
    const email = (inspection as { ownerEmail?: string | null }).ownerEmail?.trim() ?? '';
    if (email) setOwnerEmail(email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection?.id]);

  useEffect(() => {
    // Pre-fill rep's printed name from the authenticated user record.
    const first = user?.firstName?.trim() ?? '';
    const last = user?.lastName?.trim() ?? '';
    const name = [first, last].filter(Boolean).join(' ');
    if (name.length >= 2) setRepPrintName(name);
  }, [user]);

  // Preview HTML — no signature images yet, just the filled-in text.
  const previewHtml = useMemo(() => {
    return buildPreviewHtml({
      ownerNames: signerName || '___________________________',
      agreementDate: todayMDY,
      propertyAddress: inspection?.address ?? '',
      logoUrl: logoDataUri ?? undefined,
      owner: { signatureImage: '', printName: signerName, signDate: todayMDY },
      contractorRep: {
        signatureImage: '',
        printName: repPrintName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || companyName || '',
        signDate: todayMDY,
      },
      cancellation: {
        transactionDate: todayMDY,
        cancelDeadline: cancelDeadlineMDY,
        buyerDate: '',
        buyerSignatureImage: '',
      },
    });
  }, [signerName, repPrintName, inspection?.address, todayMDY, cancelDeadlineMDY, companyName, logoDataUri]);

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
                logoUrl: logoDataUri ?? undefined,
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

              // Store the signed HTML so the doc-preview modal can render it
              setSignedDocHtml(signedHtml);
              setShowDocPreview(true);
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
          <View style={[styles.ownerNameCard, { backgroundColor: colors.card }]}>
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
                Accept
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
                Accept
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

        {/* Scroll gate status + Review button */}
        <View style={styles.bannerRow}>
          {!hasScrolledToBottom ? (
            <View style={[styles.banner, { backgroundColor: '#fffbeb', borderColor: '#f59e0b', flex: 1 }]}>
              <Icon name="chevron-down" size={14} color="#b45309" />
              <Text style={{ color: '#92400e', fontSize: 12, flex: 1 }}>
                Scroll through both pages to enable signing.
              </Text>
            </View>
          ) : (
            <View style={[styles.banner, { backgroundColor: '#ecfdf5', borderColor: colors.success, flex: 1 }]}>
              <Icon name="check" size={14} color={colors.success} />
              <Text style={{ color: colors.success, fontSize: 12, flex: 1 }}>
                Agreement reviewed — collect both signatures.
              </Text>
            </View>
          )}
          <Pressable
            onPress={() => setShowReadModal(true)}
            style={[styles.reviewBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            hitSlop={8}
          >
            <Icon name="zoom-in" size={14} color={colors.foreground} />
            <Text style={[styles.reviewBtnText, { color: colors.foreground }]}>Review</Text>
          </Pressable>
        </View>
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

      {/* ── Readable review modal ────────────────────────────────────────────── */}
      <Modal
        visible={showReadModal}
        animationType="slide"
        onRequestClose={() => setShowReadModal(false)}
      >
        <SafeAreaView style={[styles.sigModal, { backgroundColor: colors.background }]}>
          <View style={[styles.sigModalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowReadModal(false)} hitSlop={12}>
              <Icon name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.sigModalTitle, { color: colors.foreground }]}>
              Review Agreement
            </Text>
            <Icon name="zoom-in" size={20} color={colors.mutedForeground} />
          </View>
          <WebView
            source={{
              html: buildReadableHtml({
                ownerNames: signerName || '___________________________',
                agreementDate: todayMDY,
                propertyAddress: inspection?.address ?? '',
                logoUrl: logoDataUri ?? undefined,
                owner: { signatureImage: '', printName: signerName, signDate: todayMDY },
                contractorRep: {
                  signatureImage: '',
                  printName: repPrintName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || companyName || '',
                  signDate: todayMDY,
                },
                cancellation: {
                  transactionDate: todayMDY,
                  cancelDeadline: cancelDeadlineMDY,
                  buyerDate: '',
                  buyerSignatureImage: '',
                },
              }),
            }}
            scrollEnabled
            showsVerticalScrollIndicator
            originWhitelist={['*']}
            style={{ flex: 1 }}
          />
        </SafeAreaView>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          POST-SIGNING FLOW — four modals in sequence
          ══════════════════════════════════════════════════════════════════════ */}

      {/* 1. Document preview + email */}
      <Modal visible={showDocPreview} animationType="slide" onRequestClose={() => setShowDocPreview(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
        <SafeAreaView style={[{ flex: 1 }, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[styles.flowModalHeader, { borderBottomColor: colors.border }]}>
            <Icon name="file-text" size={20} color={colors.foreground} />
            <Text style={[styles.flowModalTitle, { color: colors.foreground }]}>Signed Agreement</Text>
            <Pressable onPress={() => setShowDocPreview(false)} hitSlop={12}>
              <Icon name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>

          {/* Signed document preview */}
          <WebView
            source={{ html: signedDocHtml ?? '' }}
            scrollEnabled
            showsVerticalScrollIndicator
            originWhitelist={['*']}
            style={{ flex: 1 }}
          />

          {/* Email + continue panel */}
          <View style={[styles.flowPanel, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            <Text style={[styles.panelLabel, { color: colors.foreground }]}>Email to homeowner</Text>
            <View style={styles.emailRow}>
              <TextInput
                value={recipientEmail}
                onChangeText={setRecipientEmail}
                placeholder="homeowner@email.com"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.emailInput,
                  { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
                ]}
              />
              <Pressable
                onPress={async () => {
                  if (!recipientEmail.trim()) return;
                  try {
                    const result = await emailAgreement.mutateAsync({ inspectionId: id, recipient: recipientEmail.trim() });
                    if (result.noSmtp) {
                      Alert.alert('No Email Configured', 'Configure SMTP in your profile settings to send emails directly from the app.');
                    } else {
                      setEmailSentAt(result.emailedAt ?? new Date().toISOString());
                      if (result.repEmailed) {
                        Alert.alert('Agreement Sent', `A copy was sent to ${recipientEmail.trim()} and to you.`);
                      }
                    }
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Could not send email.';
                    Alert.alert('Send Failed', msg);
                  }
                }}
                disabled={emailAgreement.isPending || !recipientEmail.trim()}
                style={[
                  styles.sendBtn,
                  { backgroundColor: colors.primary, opacity: emailAgreement.isPending || !recipientEmail.trim() ? 0.45 : 1 },
                ]}
              >
                {emailAgreement.isPending
                  ? <ActivityIndicator color={colors.primaryForeground} size="small" />
                  : <Icon name="send" size={16} color={colors.primaryForeground} />}
              </Pressable>
            </View>
            {emailSentAt && (
              <View style={[styles.sentBadge, { backgroundColor: '#ecfdf5', borderColor: colors.success }]}>
                <Icon name="check" size={13} color={colors.success} />
                <Text style={{ color: colors.success, fontSize: 12 }}>
                  Sent {new Date(emailSentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            )}

            {/* Continue */}
            <Pressable
              onPress={() => { setShowDocPreview(false); setShowNextSteps(true); }}
              style={[styles.flowPrimaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.flowPrimaryBtnText, { color: colors.primaryForeground }]}>Continue</Text>
              <Icon name="chevron-right" size={18} color={colors.primaryForeground} />
            </Pressable>
          </View>
        </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* 2. Next steps — schedule or proceed */}
      <Modal visible={showNextSteps} animationType="slide" transparent onRequestClose={() => setShowNextSteps(false)}>
        <View style={[styles.sheetOverlay]}>
          <View style={[styles.sheetCard, { backgroundColor: colors.card }]}>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#ecfdf5', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={28} color={colors.success} />
              </View>
              <Text style={[styles.flowModalTitle, { color: colors.foreground, textAlign: 'center' }]}>
                Agreement Complete
              </Text>
              <Text style={[{ color: colors.mutedForeground, fontSize: 14, textAlign: 'center' }]}>
                What would you like to do next?
              </Text>
            </View>

            <Pressable
              onPress={() => { setShowNextSteps(false); setShowSchedule(true); }}
              style={[styles.nextStepBtn, { backgroundColor: colors.card, borderColor: colors.primary }]}
            >
              <Icon name="calendar" size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.nextStepBtnTitle, { color: colors.primary }]}>Schedule Phase 2 Inspection</Text>
                <Text style={[styles.nextStepBtnSub, { color: colors.mutedForeground }]}>Pick a date for the forensic visit</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.primary} />
            </Pressable>

            <Pressable
              onPress={() => { setShowNextSteps(false); setShowFtcWarning(true); }}
              style={[styles.nextStepBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Icon name="play" size={22} color={colors.foreground} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.nextStepBtnTitle, { color: colors.foreground }]}>Proceed to Phase 2 Now</Text>
                <Text style={[styles.nextStepBtnSub, { color: colors.mutedForeground }]}>Begin the forensic inspection today</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 3. FTC cooling-off warning */}
      <Modal visible={showFtcWarning} animationType="fade" transparent onRequestClose={() => setShowFtcWarning(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetCard, { backgroundColor: colors.card }]}>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <View style={styles.ftcIconWrap}>
                <Icon name="alert-triangle" size={28} color="#b45309" />
              </View>
              <Text style={[styles.flowModalTitle, { color: colors.foreground, textAlign: 'center' }]}>
                FTC Cooling-Off Period
              </Text>
            </View>

            <Text style={[styles.ftcBody, { color: colors.foreground }]}>
              The FTC Cooling-Off Period of this document is <Text style={{ fontWeight: '700' }}>3 days from signing</Text>. You are attempting to complete the Forensic Inspection prior to the end of the Federal Trade Commission's Cooling-Off Period.
            </Text>
            <Text style={[styles.ftcBody, { color: colors.foreground }]}>
              The homeowner is still entitled to a refund if requested, even if the inspection is completed. Do you still wish to proceed?
            </Text>

            <View style={styles.ftcBtnRow}>
              <Pressable
                onPress={() => { setShowFtcWarning(false); setShowSchedule(true); }}
                style={[styles.ftcBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Icon name="calendar" size={16} color={colors.foreground} />
                <Text style={[styles.ftcBtnText, { color: colors.foreground }]}>Schedule</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setShowFtcWarning(false);
                  setShowNextSteps(false);
                  router.replace(`/inspection/${id}` as never);
                }}
                style={[styles.ftcBtn, { borderColor: '#ef4444', backgroundColor: '#fef2f2' }]}
              >
                <Icon name="play" size={16} color="#dc2626" />
                <Text style={[styles.ftcBtnText, { color: '#dc2626' }]}>Proceed</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 4. Schedule calendar */}
      <Modal visible={showSchedule} animationType="slide" transparent onRequestClose={() => setShowSchedule(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetCard, { backgroundColor: colors.card }]}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.flowModalTitle, { color: colors.foreground }]}>Schedule Inspection</Text>
              <Pressable onPress={() => setShowSchedule(false)} hitSlop={12}>
                <Icon name="x" size={20} color={colors.foreground} />
              </Pressable>
            </View>

            {/* Homeowner email — required for the appointment notification */}
            <View style={[styles.emailRow, { marginBottom: 2 }]}>
              <Icon name="mail" size={16} color={colors.mutedForeground} />
              <TextInput
                value={ownerEmail}
                onChangeText={setOwnerEmail}
                placeholder="Homeowner email"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.emailInput,
                  { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, flex: 1 },
                ]}
              />
            </View>
            <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 8 }}>
              An appointment confirmation will be sent to this address. It's also saved to the owner record for Phase 2.
            </Text>

            <CalendarPicker
              selected={scheduledDate}
              minDate={tomorrow}
              onSelect={setScheduledDate}
            />

            {/* Selected date display */}
            <View style={[styles.selectedDateBadge, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Icon name="calendar" size={15} color={colors.primary} />
              <Text style={[{ color: colors.foreground, fontSize: 14, fontWeight: '600' }]}>
                {scheduledDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </Text>
            </View>

            {/* Confirm */}
            <Pressable
              onPress={async () => {
                const emailTrimmed = ownerEmail.trim();
                if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
                  Alert.alert('Email Required', 'Please enter a valid homeowner email address to send the appointment notification.');
                  return;
                }
                try {
                  setScheduling(true);
                  const result: { scheduled: boolean; emailSent: boolean; noSmtp?: boolean } =
                    await customFetch(`/api/inspections/${id}/notify-schedule`, {
                      method: 'POST',
                      body: JSON.stringify({
                        scheduledFor: scheduledDate.toISOString(),
                        ownerEmail: emailTrimmed,
                      }),
                    });
                  setShowSchedule(false);
                  setShowNextSteps(false);
                  // Refresh the Inspections tab so the Scheduled section shows
                  // this appointment without requiring a manual pull-to-refresh.
                  queryClient.invalidateQueries({ queryKey: getListScheduledInspectionsQueryKey() });
                  queryClient.invalidateQueries({ queryKey: getListInspectionsQueryKey() });
                  const dateLabel = scheduledDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
                  const emailNote = result.emailSent
                    ? `\n\nA confirmation was sent to ${emailTrimmed}.`
                    : result.noSmtp
                    ? '\n\nConfigure SMTP in your profile to send automatic notifications.'
                    : `\n\nThe notification email could not be delivered — please follow up with ${emailTrimmed} directly.`;
                  Alert.alert(
                    'Inspection Scheduled',
                    `Phase 2 inspection scheduled for ${dateLabel}.${emailNote}`,
                    [{ text: 'OK', onPress: () => router.back() }],
                  );
                } catch (err) {
                  const msg = err instanceof Error ? err.message : 'Could not save the schedule.';
                  Alert.alert('Scheduling Failed', msg);
                } finally {
                  setScheduling(false);
                }
              }}
              disabled={scheduling}
              style={[styles.flowPrimaryBtn, { backgroundColor: colors.primary, opacity: scheduling ? 0.5 : 1 }]}
            >
              {scheduling
                ? <ActivityIndicator color={colors.primaryForeground} />
                : <>
                    <Icon name="check" size={18} color={colors.primaryForeground} />
                    <Text style={[styles.flowPrimaryBtnText, { color: colors.primaryForeground }]}>Confirm & Notify</Text>
                  </>}
            </Pressable>
          </View>
        </View>
      </Modal>

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

  // Banner row (status + review button side by side)
  bannerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
  },
  reviewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
  },
  reviewBtnText: { fontSize: 12, fontWeight: '600' },

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
  ownerNameCard: {
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

  // ── Post-signing flow ────────────────────────────────────────────────────────
  flowModalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flowModalTitle: { fontSize: 18, fontWeight: '700', flex: 1 },

  // Doc preview email panel
  flowPanel: {
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    gap: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  panelLabel: { fontSize: 13, fontWeight: '600' },
  emailRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  emailInput: {
    flex: 1, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  sentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
    alignSelf: 'flex-start',
  },
  flowPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14,
  },
  flowPrimaryBtnText: { fontSize: 16, fontWeight: '700' },

  // Sheet overlay (next steps, FTC, schedule)
  sheetOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 16,
  },

  // Next steps
  nextStepBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 14, borderWidth: 1.5,
  },
  nextStepBtnTitle: { fontSize: 15, fontWeight: '700' },
  nextStepBtnSub: { fontSize: 12, marginTop: 2 },

  // FTC warning
  ftcIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center',
  },
  ftcBody: { fontSize: 14, lineHeight: 21 },
  ftcBtnRow: { flexDirection: 'row', gap: 10 },
  ftcBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5,
  },
  ftcBtnText: { fontSize: 15, fontWeight: '700' },

  // Schedule
  selectedDateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
});

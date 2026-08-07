/**
 * Change Order creation flow — Step 3b/3c/3d/3e.
 *
 * Steps:
 *  0 — pin picker (skipped when pinId param supplied)
 *  1 — line items + required-scope toggle
 *  2 — review
 *  3 — dual signature (homeowner + rep)
 *  4 — submitting / done
 *
 * 3c [LOCKED] — PDF generated on-device (no AI, no network), mirrors FIPSA.
 * 3d [LOCKED] — submission via outbox; client-generated ids; replay-safe.
 * 3e [LOCKED] — homeowner + rep signatures; SHA-256 of raw PDF bytes.
 */
import React, { useRef, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
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
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import { useListPins, getListPinsQueryKey } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useProfile } from '@/hooks/useProfile';
import { buildChangeOrderHtml, formatMDY, centsToDollar } from '@/lib/changeOrderTemplate';
import { enqueueChangeOrder } from '@/lib/changeOrderSync';
import { useListPriceBookItems } from '@/lib/priceBookApi';

// ── Local types ───────────────────────────────────────────────────────────────

interface LocalLineItem {
  clientId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  priceBookItemId?: string | null;
  unit?: string | null;
}

interface ItemFormState {
  description: string;
  quantity: string;
  unitPrice: string; // dollars string, e.g. "150.00"
  priceBookItemId?: string | null;
  unit?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDollarsToCents(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, '').replace(/^\$/, ''));
  if (isNaN(n)) return null;
  return Math.round(n * 100);
}

const BLANK_FORM: ItemFormState = { description: '', quantity: '1', unitPrice: '' };

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChangeOrderNewScreen() {
  const colors = useColors();
  const { profile, companyName } = useProfile();
  const displayName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ')
    : '';
  const { pinId: paramPinId } = useLocalSearchParams<{ pinId?: string }>();

  // ── Step machine ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(paramPinId ? 1 : 0);

  // ── Pin picker (step 0) ──────────────────────────────────────────────────
  const pinsQuery = useListPins(undefined, { query: { queryKey: getListPinsQueryKey() } });
  type Pin = NonNullable<typeof pinsQuery.data>['pins'][number];
  const allPins = useMemo(
    () => ((pinsQuery.data?.pins ?? []) as Pin[]).filter((p) => !(p as { voidedAt?: unknown }).voidedAt),
    [pinsQuery.data],
  );
  const [selectedPin, setSelectedPin] = useState<Pin | null>(() => {
    if (!paramPinId) return null;
    return (pinsQuery.data?.pins ?? []).find((p) => (p as { id: string }).id === paramPinId) ?? null;
  });

  // ── Line items (step 1) ──────────────────────────────────────────────────
  const [lineItems, setLineItems] = useState<LocalLineItem[]>([]);
  const [requiredScope, setRequiredScope] = useState(false);
  const [description, setDescription] = useState('');

  // Add-item modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [itemForm, setItemForm] = useState<ItemFormState>(BLANK_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Price book picker modal
  const [showPbPicker, setShowPbPicker] = useState(false);
  const [pbSearch, setPbSearch] = useState('');
  const pbQuery = useListPriceBookItems();
  const pbItems = useMemo(() => {
    const all = pbQuery.data?.items ?? [];
    const q = pbSearch.trim().toLowerCase();
    return q ? all.filter((i) => i.name.toLowerCase().includes(q) || (i.unit ?? '').toLowerCase().includes(q)) : all;
  }, [pbQuery.data, pbSearch]);

  const totalCents = useMemo(
    () => lineItems.reduce((acc, li) => acc + Math.round(li.quantity * li.unitPriceCents), 0),
    [lineItems],
  );

  // ── Signature (step 3) ────────────────────────────────────────────────────
  const [homeownerName, setHomeownerName] = useState('');
  const [homeownerSigData, setHomeownerSigData] = useState<string | null>(null);
  const [ownerSigKey, setOwnerSigKey] = useState(0);
  const ownerSigRef = useRef<SignatureViewRef>(null);
  const [showOwnerSig, setShowOwnerSig] = useState(false);

  const [repPrintName, setRepPrintName] = useState(displayName ?? '');
  const [repSigData, setRepSigData] = useState<string | null>(null);
  const [repSigKey, setRepSigKey] = useState(0);
  const repSigRef = useRef<SignatureViewRef>(null);
  const [showRepSig, setShowRepSig] = useState(false);

  // ── Submit (step 4) ────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Pin-picker helpers ─────────────────────────────────────────────────────
  function selectPin(pin: Pin) {
    setSelectedPin(pin);
    setStep(1);
  }

  // ── Line-item helpers ──────────────────────────────────────────────────────
  function openAddItem() {
    setItemForm(BLANK_FORM);
    setEditingId(null);
    setShowAddModal(true);
  }

  function openEditItem(li: LocalLineItem) {
    setItemForm({
      description: li.description,
      quantity: String(li.quantity),
      unitPrice: (li.unitPriceCents / 100).toFixed(2),
      priceBookItemId: li.priceBookItemId,
      unit: li.unit,
    });
    setEditingId(li.clientId);
    setShowAddModal(true);
  }

  function saveItemForm() {
    const cents = parseDollarsToCents(itemForm.unitPrice);
    if (!itemForm.description.trim()) {
      Alert.alert('Missing description', 'Please enter a description for this line item.');
      return;
    }
    if (cents === null) {
      Alert.alert('Invalid price', 'Enter a valid dollar amount, e.g. 150 or 1500.00');
      return;
    }
    const qty = parseFloat(itemForm.quantity);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid quantity', 'Quantity must be a positive number.');
      return;
    }
    if (editingId) {
      setLineItems((prev) =>
        prev.map((li) =>
          li.clientId === editingId
            ? { ...li, description: itemForm.description.trim(), quantity: qty, unitPriceCents: cents, priceBookItemId: itemForm.priceBookItemId, unit: itemForm.unit }
            : li,
        ),
      );
    } else {
      setLineItems((prev) => [
        ...prev,
        {
          clientId: crypto.randomUUID(),
          description: itemForm.description.trim(),
          quantity: qty,
          unitPriceCents: cents,
          priceBookItemId: itemForm.priceBookItemId ?? null,
          unit: itemForm.unit ?? null,
        },
      ]);
    }
    setShowAddModal(false);
  }

  function removeItem(clientId: string) {
    setLineItems((prev) => prev.filter((li) => li.clientId !== clientId));
  }

  function pickPriceBookItem(item: { id: string; name: string; unitPrice: number; unit: string | null }) {
    setItemForm((f) => ({
      ...f,
      description: item.name,
      unitPrice: (item.unitPrice / 100).toFixed(2),
      priceBookItemId: item.id,
      unit: item.unit,
    }));
    setShowPbPicker(false);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!selectedPin || !homeownerSigData || !repSigData) return;
    if (lineItems.length === 0) {
      Alert.alert('No line items', 'Add at least one line item before submitting.');
      return;
    }

    const todayMDY = formatMDY(new Date());
    const coId = crypto.randomUUID();
    const p = selectedPin as { id: string; address?: string | null; customerName?: string | null };

    try {
      setSubmitting(true);
      setStep(4);

      // 3c: Build signed HTML → render to PDF on-device (no network, no AI)
      const signedHtml = buildChangeOrderHtml({
        companyName: companyName ?? undefined,
        propertyAddress: p.address ?? '',
        homeownerName: homeownerName.trim(),
        date: todayMDY,
        lineItems: lineItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
          totalCents: Math.round(li.quantity * li.unitPriceCents),
          unit: li.unit ?? null,
        })),
        totalCents,
        requiredToCompleteScope: requiredScope,
        homeowner: {
          signatureImage: `data:image/png;base64,${homeownerSigData}`,
          printName: homeownerName.trim(),
          signDate: todayMDY,
        },
        rep: {
          signatureImage: `data:image/png;base64,${repSigData}`,
          printName: repPrintName.trim(),
          signDate: todayMDY,
        },
      });

      const { uri } = await Print.printToFileAsync({ html: signedHtml });

      // 3e: Read raw bytes, compute SHA-256 of exact PDF bytes
      interface UsableFile { bytes(): Promise<Uint8Array>; delete(): Promise<void>; }
      const pdfFile = new (FileSystem as unknown as { File: new (u: string) => UsableFile }).File(uri);
      const bytes = await pdfFile.bytes();

      const hashBuffer = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes.buffer as ArrayBuffer);
      const sha256 = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Safe chunked base64 — avoids call-stack overflow on large PDFs
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
      }
      const pdfBase64 = btoa(binary);
      await pdfFile.delete();

      // 3d: Enqueue to outbox — create + line items + sign, client-id idempotent
      await enqueueChangeOrder({
        clientId: coId,
        pinId: p.id,
        description: description.trim() || 'Change Order',
        requiredToCompleteScope: requiredScope,
        lineItems: lineItems.map((li) => ({
          clientId: li.clientId,
          description: li.description,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
          priceBookItemId: li.priceBookItemId ?? null,
        })),
        pdfBase64,
        sha256,
        homeownerName: homeownerName.trim(),
        repName: repPrintName.trim(),
      });

      setSubmitted(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const S = StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    content: { padding: 16, paddingBottom: 32 },
    section: { marginBottom: 16 },
    label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
    input: {
      borderWidth: 1, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 15,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    flexInput: { flex: 1 },
    btn: {
      paddingVertical: 14, borderRadius: 10,
      alignItems: 'center', marginTop: 8,
    },
    btnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
    outlineBtn: {
      paddingVertical: 12, borderRadius: 10, borderWidth: 1.5,
      alignItems: 'center', marginTop: 8,
    },
    lineRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    lineDesc: { flex: 1, fontSize: 14 },
    linePrice: { fontSize: 14, fontWeight: '500', minWidth: 80, textAlign: 'right' },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4 },
    totalLabel: { fontSize: 16, fontWeight: '700' },
    totalAmount: { fontSize: 16, fontWeight: '700' },
    sigBox: {
      height: 80, borderWidth: 1, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center',
    },
    sigDoneBox: {
      height: 80, borderWidth: 1.5, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center', gap: 4,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
    successTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
    successBody: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4 — Submitting / Done
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 4) {
    return (
      <View style={[S.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Change Order' }} />
        <View style={S.center}>
          {submitting && !submitted && (
            <>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[S.successBody, { color: colors.mutedForeground }]}>
                Generating PDF and queuing for sync…
              </Text>
            </>
          )}
          {submitted && (
            <>
              <Text style={{ fontSize: 48 }}>✓</Text>
              <Text style={[S.successTitle, { color: colors.foreground }]}>Change Order Queued</Text>
              <Text style={[S.successBody, { color: colors.mutedForeground }]}>
                The change order has been saved locally and will sync to the server when you're back online.
              </Text>
              <Pressable
                style={[S.btn, { backgroundColor: colors.primary, width: '100%' }]}
                onPress={() => router.back()}
              >
                <Text style={S.btnText}>Back to Jobs</Text>
              </Pressable>
            </>
          )}
          {submitError && (
            <>
              <Text style={{ fontSize: 48 }}>⚠️</Text>
              <Text style={[S.successTitle, { color: colors.destructive }]}>Error</Text>
              <Text style={[S.successBody, { color: colors.mutedForeground }]}>{submitError}</Text>
              <Pressable
                style={[S.btn, { backgroundColor: colors.primary, width: '100%' }]}
                onPress={() => { setSubmitError(null); setSubmitting(false); setStep(3); }}
              >
                <Text style={S.btnText}>Try Again</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3 — Signature
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 3) {
    const canSubmit = !!homeownerSigData && !!repSigData && homeownerName.trim().length > 0;
    return (
      <View style={[S.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Signatures' }} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={S.scroll} contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
            {/* Homeowner name */}
            <View style={S.section}>
              <Text style={[S.label, { color: colors.foreground }]}>Homeowner name *</Text>
              <TextInput
                style={[S.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                placeholder="Full name"
                placeholderTextColor={colors.mutedForeground}
                value={homeownerName}
                onChangeText={setHomeownerName}
                autoCapitalize="words"
              />
            </View>

            {/* Homeowner signature */}
            <View style={S.section}>
              <Text style={[S.label, { color: colors.foreground }]}>Homeowner signature *</Text>
              {homeownerSigData ? (
                <Pressable
                  style={[S.sigDoneBox, { borderColor: colors.primary }]}
                  onPress={() => setShowOwnerSig(true)}
                >
                  <Text style={{ color: colors.primary, fontSize: 22 }}>✓</Text>
                  <Text style={{ color: colors.primary, fontSize: 13 }}>Signed — tap to redo</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[S.sigBox, { borderColor: colors.border, backgroundColor: colors.card }]}
                  onPress={() => setShowOwnerSig(true)}
                >
                  <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Tap to sign</Text>
                </Pressable>
              )}
            </View>

            {/* Rep name */}
            <View style={S.section}>
              <Text style={[S.label, { color: colors.foreground }]}>Your name (rep)</Text>
              <TextInput
                style={[S.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                placeholder="Your printed name"
                placeholderTextColor={colors.mutedForeground}
                value={repPrintName}
                onChangeText={setRepPrintName}
                autoCapitalize="words"
              />
            </View>

            {/* Rep signature */}
            <View style={S.section}>
              <Text style={[S.label, { color: colors.foreground }]}>Your signature (rep) *</Text>
              {repSigData ? (
                <Pressable
                  style={[S.sigDoneBox, { borderColor: colors.primary }]}
                  onPress={() => setShowRepSig(true)}
                >
                  <Text style={{ color: colors.primary, fontSize: 22 }}>✓</Text>
                  <Text style={{ color: colors.primary, fontSize: 13 }}>Signed — tap to redo</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[S.sigBox, { borderColor: colors.border, backgroundColor: colors.card }]}
                  onPress={() => setShowRepSig(true)}
                >
                  <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Tap to sign</Text>
                </Pressable>
              )}
            </View>

            <Pressable
              style={[S.btn, { backgroundColor: canSubmit ? colors.primary : colors.muted }]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              <Text style={[S.btnText, { color: canSubmit ? '#fff' : colors.mutedForeground }]}>
                Generate PDF &amp; Submit
              </Text>
            </Pressable>
            <Pressable style={[S.outlineBtn, { borderColor: colors.border }]} onPress={() => setStep(2)}>
              <Text style={{ color: colors.foreground, fontSize: 15 }}>← Back</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Owner signature modal */}
        <Modal visible={showOwnerSig} animationType="slide">
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Pressable onPress={() => setShowOwnerSig(false)}><Text style={{ color: colors.mutedForeground, fontSize: 15 }}>Cancel</Text></Pressable>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.foreground }}>Homeowner Signature</Text>
              <Pressable onPress={() => ownerSigRef.current?.readSignature()}><Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>Accept</Text></Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <SignatureScreen
                key={ownerSigKey}
                ref={ownerSigRef}
                onOK={(base64) => { setHomeownerSigData(base64); setShowOwnerSig(false); }}
                onEmpty={() => Alert.alert('No signature', 'Please draw your signature first.')}
                onClear={() => setOwnerSigKey((k) => k + 1)}
                webStyle=".m-signature-pad { box-shadow: none; border: 1px solid #ddd; } .m-signature-pad--footer { display: none; }"
                autoClear={false}
                descriptionText="Sign here"
              />
            </View>
          </View>
        </Modal>

        {/* Rep signature modal */}
        <Modal visible={showRepSig} animationType="slide">
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Pressable onPress={() => setShowRepSig(false)}><Text style={{ color: colors.mutedForeground, fontSize: 15 }}>Cancel</Text></Pressable>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.foreground }}>Rep Signature</Text>
              <Pressable onPress={() => repSigRef.current?.readSignature()}><Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>Accept</Text></Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <SignatureScreen
                key={repSigKey}
                ref={repSigRef}
                onOK={(base64) => { setRepSigData(base64); setShowRepSig(false); }}
                onEmpty={() => Alert.alert('No signature', 'Please draw your signature first.')}
                onClear={() => setRepSigKey((k) => k + 1)}
                webStyle=".m-signature-pad { box-shadow: none; border: 1px solid #ddd; } .m-signature-pad--footer { display: none; }"
                autoClear={false}
                descriptionText="Sign here"
              />
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — Review
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 2) {
    const p = selectedPin as { address?: string | null; customerName?: string | null } | null;
    return (
      <View style={[S.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Review' }} />
        <ScrollView style={S.scroll} contentContainerStyle={S.content}>
          <View style={[S.section, { backgroundColor: colors.card, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border }]}>
            <Text style={[{ fontSize: 13, color: colors.mutedForeground, marginBottom: 4 }]}>Job</Text>
            <Text style={[{ fontSize: 16, fontWeight: '600', color: colors.foreground }]}>
              {p?.customerName ?? 'Unnamed Job'}
            </Text>
            <Text style={[{ fontSize: 13, color: colors.mutedForeground, marginTop: 2 }]}>
              {p?.address ?? ''}
            </Text>
          </View>

          <View style={[S.section, { backgroundColor: colors.card, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border }]}>
            <Text style={[{ fontSize: 13, color: colors.mutedForeground, marginBottom: 8 }]}>Line Items</Text>
            {lineItems.map((li) => (
              <View key={li.clientId} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={[{ flex: 1, fontSize: 14, color: colors.foreground }]} numberOfLines={2}>
                  {li.quantity !== 1 ? `${li.quantity}× ` : ''}{li.description}
                </Text>
                <Text style={[{ fontSize: 14, fontWeight: '500', color: colors.foreground, marginLeft: 8 }]}>
                  {centsToDollar(Math.round(li.quantity * li.unitPriceCents))}
                </Text>
              </View>
            ))}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.foreground }}>Total</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.foreground }}>{centsToDollar(totalCents)}</Text>
            </View>
          </View>

          <View style={[S.section, { backgroundColor: colors.card, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border }]}>
            <Text style={[{ fontSize: 13, color: colors.mutedForeground, marginBottom: 4 }]}>Scope</Text>
            <Text style={[{ fontSize: 14, color: colors.foreground }]}>
              {requiredScope ? '✓ Required to complete original scope' : '○ Additional / out-of-scope work'}
            </Text>
          </View>

          {!!description.trim() && (
            <View style={[S.section, { backgroundColor: colors.card, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border }]}>
              <Text style={[{ fontSize: 13, color: colors.mutedForeground, marginBottom: 4 }]}>Notes</Text>
              <Text style={[{ fontSize: 14, color: colors.foreground }]}>{description}</Text>
            </View>
          )}

          <Pressable style={[S.btn, { backgroundColor: colors.primary }]} onPress={() => setStep(3)}>
            <Text style={S.btnText}>Proceed to Signatures →</Text>
          </Pressable>
          <Pressable style={[S.outlineBtn, { borderColor: colors.border }]} onPress={() => setStep(1)}>
            <Text style={{ color: colors.foreground, fontSize: 15 }}>← Edit</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — Line items + scope
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 1) {
    const canAdvance = lineItems.length > 0;
    return (
      <View style={[S.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Line Items' }} />
        <ScrollView style={S.scroll} contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">

          {/* Optional notes */}
          <View style={S.section}>
            <Text style={[S.label, { color: colors.foreground }]}>Description / notes (optional)</Text>
            <TextInput
              style={[S.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
              placeholder="e.g. Additional flashing required at chimney"
              placeholderTextColor={colors.mutedForeground}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={2}
            />
          </View>

          {/* Line items list */}
          <View style={S.section}>
            <Text style={[S.label, { color: colors.foreground }]}>Line items *</Text>
            {lineItems.length === 0 && (
              <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 8 }}>
                No items yet. Add at least one.
              </Text>
            )}
            {lineItems.map((li) => (
              <Pressable key={li.clientId} style={[S.lineRow, { borderBottomColor: colors.border }]} onPress={() => openEditItem(li)}>
                <View style={{ flex: 1 }}>
                  <Text style={[S.lineDesc, { color: colors.foreground }]} numberOfLines={2}>{li.description}</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                    {li.quantity}× {centsToDollar(li.unitPriceCents)}{li.unit ? ` / ${li.unit}` : ''}
                  </Text>
                </View>
                <Text style={[S.linePrice, { color: colors.foreground }]}>
                  {centsToDollar(Math.round(li.quantity * li.unitPriceCents))}
                </Text>
                <Pressable onPress={() => removeItem(li.clientId)} style={{ marginLeft: 10 }}>
                  <Text style={{ color: colors.destructive, fontSize: 18, fontWeight: '600' }}>×</Text>
                </Pressable>
              </Pressable>
            ))}
            {lineItems.length > 0 && (
              <View style={[S.totalRow, { borderTopColor: colors.border, borderTopWidth: 1 }]}>
                <Text style={[S.totalLabel, { color: colors.foreground }]}>Running total</Text>
                <Text style={[S.totalAmount, { color: colors.primary }]}>{centsToDollar(totalCents)}</Text>
              </View>
            )}

            <Pressable style={[S.outlineBtn, { borderColor: colors.primary, marginTop: 12 }]} onPress={openAddItem}>
              <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>+ Add Line Item</Text>
            </Pressable>
          </View>

          {/* Required to complete scope */}
          <View style={[S.section, { backgroundColor: colors.card, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>
                  Required to complete original scope
                </Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>
                  Toggle on if this work is necessary to complete the originally contracted work.
                </Text>
              </View>
              <Switch
                value={requiredScope}
                onValueChange={setRequiredScope}
                trackColor={{ false: colors.muted, true: colors.primary }}
              />
            </View>
          </View>

          <Pressable
            style={[S.btn, { backgroundColor: canAdvance ? colors.primary : colors.muted }]}
            onPress={() => canAdvance && setStep(2)}
            disabled={!canAdvance}
          >
            <Text style={[S.btnText, { color: canAdvance ? '#fff' : colors.mutedForeground }]}>
              Review →
            </Text>
          </Pressable>
          {step === 1 && !paramPinId && (
            <Pressable style={[S.outlineBtn, { borderColor: colors.border }]} onPress={() => setStep(0)}>
              <Text style={{ color: colors.foreground, fontSize: 15 }}>← Change job</Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Add item modal */}
        <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Pressable onPress={() => setShowAddModal(false)}><Text style={{ color: colors.mutedForeground, fontSize: 15 }}>Cancel</Text></Pressable>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.foreground }}>{editingId ? 'Edit Item' : 'Add Item'}</Text>
              <Pressable onPress={saveItemForm}><Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>Save</Text></Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              <Text style={[S.label, { color: colors.foreground }]}>Description *</Text>
              <TextInput
                style={[S.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card, marginBottom: 12 }]}
                placeholder="e.g. Replace damaged drip edge"
                placeholderTextColor={colors.mutedForeground}
                value={itemForm.description}
                onChangeText={(v) => setItemForm((f) => ({ ...f, description: v }))}
                autoCapitalize="sentences"
              />

              <View style={[S.row, { marginBottom: 12 }]}>
                <View style={S.flexInput}>
                  <Text style={[S.label, { color: colors.foreground }]}>Quantity</Text>
                  <TextInput
                    style={[S.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                    value={itemForm.quantity}
                    onChangeText={(v) => setItemForm((f) => ({ ...f, quantity: v }))}
                    keyboardType="decimal-pad"
                    placeholder="1"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
                <View style={S.flexInput}>
                  <Text style={[S.label, { color: colors.foreground }]}>Unit price ($)</Text>
                  <TextInput
                    style={[S.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                    value={itemForm.unitPrice}
                    onChangeText={(v) => setItemForm((f) => ({ ...f, unitPrice: v }))}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              </View>

              {itemForm.description.length > 0 && (
                <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 12 }}>
                  Total: {centsToDollar(Math.round((parseFloat(itemForm.quantity) || 0) * (parseDollarsToCents(itemForm.unitPrice) ?? 0)))}
                </Text>
              )}

              <Pressable
                style={[S.outlineBtn, { borderColor: colors.primary }]}
                onPress={() => { setShowAddModal(false); setPbSearch(''); setShowPbPicker(true); }}
              >
                <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '500' }}>
                  📋 Add from Price Book
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </Modal>

        {/* Price book picker modal */}
        <Modal visible={showPbPicker} animationType="slide" presentationStyle="pageSheet">
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Pressable onPress={() => { setShowPbPicker(false); setShowAddModal(true); }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>Back</Text>
              </Pressable>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.foreground }}>Price Book</Text>
              <View style={{ width: 50 }} />
            </View>
            <View style={{ padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <TextInput
                style={[S.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                placeholder="Search…"
                placeholderTextColor={colors.mutedForeground}
                value={pbSearch}
                onChangeText={setPbSearch}
                autoCorrect={false}
              />
            </View>
            <FlatList
              data={pbItems}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [
                    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : colors.background },
                  ]}
                  onPress={() => pickPriceBookItem(item)}
                >
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={{ fontSize: 15, fontWeight: '500', color: colors.foreground }} numberOfLines={1}>{item.name}</Text>
                    {!!item.description && <Text style={{ fontSize: 12, color: colors.mutedForeground }} numberOfLines={1}>{item.description}</Text>}
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>
                    {centsToDollar(item.unitPrice)}{item.unit ? ` / ${item.unit}` : ''}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={{ padding: 32, alignItems: 'center' }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
                    {pbQuery.isLoading ? 'Loading…' : 'No items found.'}
                  </Text>
                </View>
              }
            />
          </View>
        </Modal>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 0 — Pin picker
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={[S.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Select Job' }} />
      {pinsQuery.isLoading ? (
        <View style={S.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : allPins.length === 0 ? (
        <View style={S.center}>
          <Text style={[S.successBody, { color: colors.mutedForeground }]}>
            No active jobs available. Jobs appear here once pins are created in the CRM.
          </Text>
        </View>
      ) : (
        <FlatList
          data={allPins}
          keyExtractor={(p) => (p as { id: string }).id}
          contentContainerStyle={{ padding: 8 }}
          renderItem={({ item: pin }) => {
            const p = pin as { id: string; customerName?: string | null; address?: string | null };
            return (
              <Pressable
                style={({ pressed }) => ({
                  backgroundColor: pressed ? colors.muted : colors.card,
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                })}
                onPress={() => selectPin(pin)}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.foreground }} numberOfLines={1}>
                  {p.customerName ?? 'Unnamed Job'}
                </Text>
                <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 3 }} numberOfLines={1}>
                  {p.address ?? 'No address'}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

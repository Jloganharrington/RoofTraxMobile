import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { Icon } from '@/components/Icon';
import { CalculatorModal } from '@/components/CalculatorModal';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';
import { useGetInspection, getGetInspectionQueryKey } from '@workspace/api-client-react';
import {
  useCreatePriceBookItem,
  useListPriceBookItems,
  type PriceBookItem,
} from '@/lib/priceBookApi';
import { useProfile } from '@/hooks/useProfile';

// Estimate step (advisory) — imports measured roof squares from the facet
// step, applies an adjustable waste factor, and prices line items from the
// company price book. Saved as a full-replace PUT so retries are idempotent;
// never gates submit.

type EstimateLine = {
  priceBookItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  isAdder: boolean;
};

type Estimate = {
  wastePercent: number;
  measuredBasis: {
    roofAreaSqft: number | null;
    roofSquares: number | null;
    wasteAdjustedSquares: number | null;
    damagedSidingFacetCount: number;
  };
  lines: EstimateLine[];
  subtotalCents: number;
  note: string | null;
  updatedAt: string;
};

type DraftLine = {
  priceBookItemId: string | null;
  description: string;
  unit: string | null;
  quantityText: string;
  unitPriceCents: number;
  isAdder: boolean;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function parseQty(text: string): number | null {
  const n = parseFloat(text.replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

// Dollar text ("125", "125.5", "$1,250.00") → integer cents, or null if invalid.
function parsePriceCents(text: string): number | null {
  const n = parseFloat(text.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export default function InspectionEstimateScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;
  const itemsQuery = useListPriceBookItems();
  const priceBookItems = itemsQuery.data?.items ?? [];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wasteText, setWasteText] = useState('10');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [note, setNote] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDescription, setCustomDescription] = useState('');
  const [customPriceText, setCustomPriceText] = useState('');
  const [customUnit, setCustomUnit] = useState('');
  const [customQtyText, setCustomQtyText] = useState('1');
  const [customSaveToBook, setCustomSaveToBook] = useState(false);
  // Inline line editing — index of the line being edited plus a draft of its
  // editable fields. Only one line edits at a time.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editPriceText, setEditPriceText] = useState('');
  const [editUnit, setEditUnit] = useState('');

  // Price-book writes are admin-gated server-side; mirror that gate here so
  // reps below admin never see a toggle that would 403.
  const { role } = useProfile();
  const canWritePriceBook = role === 'admin' || role === 'super_admin';
  const createItem = useCreatePriceBookItem();

  // Measured basis (client-side preview; the server recomputes at save).
  const slopes = inspection?.slopes ?? [];
  const measured = useMemo(() => {
    const areas = slopes
      .map((s) => s.areaSqft)
      .filter((a): a is number => typeof a === 'number' && isFinite(a) && a >= 0);
    if (areas.length === 0) return null;
    const areaSqft = round2(areas.reduce((sum, a) => sum + a, 0));
    return { areaSqft, squares: round2(areaSqft / 100) };
  }, [slopes]);
  const wastePercent = useMemo(() => {
    const n = parseFloat(wasteText);
    return isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }, [wasteText]);
  // Rounds UP to the nearest 1/3 square (shingle bundle) — matches the
  // server's computeMeasuredBasis math.
  const wasteAdjustedSquares =
    measured && wastePercent != null
      ? round2(Math.ceil(measured.squares * (1 + wastePercent / 100) * 3 - 1e-9) / 3)
      : null;

  // Load the stored estimate once.
  const loadEstimate = useCallback(async () => {
    try {
      const token = await getToken('auth_session_token');
      const resp = await fetch(`${getApiBaseUrl()}/inspections/${id}/estimate`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { estimate: Estimate | null };
      if (data.estimate) {
        setWasteText(String(data.estimate.wastePercent));
        setNote(data.estimate.note ?? '');
        setLines(
          data.estimate.lines.map((l) => ({
            priceBookItemId: l.priceBookItemId,
            description: l.description,
            unit: l.unit,
            quantityText: String(l.quantity),
            unitPriceCents: l.unitPriceCents,
            isAdder: l.isAdder,
          })),
        );
      }
    } catch {
      // Leave the draft empty — the rep can still build one.
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadEstimate();
  }, [loadEstimate]);

  function addItem(item: PriceBookItem) {
    setLines((prev) => [
      ...prev,
      {
        priceBookItemId: item.id,
        description: item.name,
        unit: item.unit ?? null,
        // Roofing items priced per square default to the waste-adjusted
        // square count (rounded up — partial squares still get billed whole).
        quantityText:
          wasteAdjustedSquares != null && /square/i.test(item.unit ?? '')
            ? String(Math.ceil(wasteAdjustedSquares))
            : '1',
        unitPriceCents: item.unitPrice,
        isAdder: false,
      },
    ]);
    setPickerOpen(false);
  }

  // One-off item not in the price book — saved with priceBookItemId: null so
  // the server keeps the client-supplied description/price (manual line path).
  // With "Also save to price book" on (admins only), the item is created in
  // the catalog first and the line references it like a picker-added item.
  async function addCustomLine() {
    const description = customDescription.trim();
    if (!description) {
      Alert.alert('Missing description', 'Enter a description for the custom line.');
      return;
    }
    const priceCents = parsePriceCents(customPriceText);
    if (priceCents == null) {
      Alert.alert('Invalid price', 'Enter a valid unit price (e.g. 125 or 125.50).');
      return;
    }
    const qty = parseQty(customQtyText);
    if (qty == null) {
      Alert.alert('Invalid quantity', 'Enter a quantity greater than zero.');
      return;
    }
    const unit = customUnit.trim() || null;

    let priceBookItemId: string | null = null;
    if (customSaveToBook && canWritePriceBook) {
      try {
        const created = await createItem.mutateAsync({
          name: description,
          unitPrice: priceCents,
          unit,
        });
        priceBookItemId = created.item.id;
      } catch (e) {
        // Don't lose the rep's work — add the line as a plain one-off and say so.
        Alert.alert(
          'Not saved to price book',
          `${e instanceof Error ? e.message : 'The price book save failed.'} The line was still added to this estimate as a one-off.`,
        );
      }
    }

    setLines((prev) => [
      ...prev,
      {
        priceBookItemId,
        description,
        unit,
        quantityText: String(qty),
        unitPriceCents: priceCents,
        isAdder: false,
      },
    ]);
    setCustomDescription('');
    setCustomPriceText('');
    setCustomUnit('');
    setCustomQtyText('1');
    setCustomSaveToBook(false);
    setCustomOpen(false);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
    setEditingIndex((cur) => (cur === index ? null : cur != null && cur > index ? cur - 1 : cur));
  }

  function startEditLine(index: number) {
    const line = lines[index];
    if (!line) return;
    setEditingIndex(index);
    setEditDescription(line.description);
    setEditPriceText((line.unitPriceCents / 100).toFixed(2));
    setEditUnit(line.unit ?? '');
  }

  // Commit an inline edit. The server re-hydrates description/unit/price from
  // the catalog for any line that still references a price book item, so if
  // the rep actually changed one of those fields on a price-book line we must
  // convert it to a manual line (priceBookItemId: null) or the override would
  // be silently discarded at save.
  function saveEditLine() {
    if (editingIndex == null) return;
    const line = lines[editingIndex];
    if (!line) return;
    const description = editDescription.trim();
    if (!description) {
      Alert.alert('Missing description', 'Enter a description for the line.');
      return;
    }
    const priceCents = parsePriceCents(editPriceText);
    if (priceCents == null) {
      Alert.alert('Invalid price', 'Enter a valid unit price (e.g. 125 or 125.50).');
      return;
    }
    const unit = editUnit.trim() || null;
    const changed =
      description !== line.description ||
      priceCents !== line.unitPriceCents ||
      unit !== line.unit;
    updateLine(editingIndex, {
      description,
      unitPriceCents: priceCents,
      unit,
      priceBookItemId: changed ? null : line.priceBookItemId,
    });
    setEditingIndex(null);
  }

  const subtotalCents = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const qty = parseQty(l.quantityText);
        return sum + (qty != null ? Math.round(qty * l.unitPriceCents) : 0);
      }, 0),
    [lines],
  );

  async function save(thenContinue: boolean) {
    if (wastePercent == null) {
      Alert.alert('Invalid waste factor', 'Enter a waste percentage between 0 and 100.');
      return;
    }
    const payloadLines: Array<Omit<EstimateLine, 'totalCents'>> = [];
    for (const l of lines) {
      const qty = parseQty(l.quantityText);
      if (qty == null) {
        Alert.alert('Invalid quantity', `Enter a valid quantity for "${l.description}".`);
        return;
      }
      payloadLines.push({
        priceBookItemId: l.priceBookItemId,
        description: l.description,
        unit: l.unit,
        quantity: qty,
        unitPriceCents: l.unitPriceCents,
        isAdder: l.isAdder,
      });
    }
    setSaving(true);
    try {
      const token = await getToken('auth_session_token');
      const resp = await fetch(`${getApiBaseUrl()}/inspections/${id}/estimate`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          wastePercent,
          lines: payloadLines,
          note: note.trim() || null,
        }),
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      // Hub reads inspection.estimate for the step badge.
      void queryClient.invalidateQueries({ queryKey: getGetInspectionQueryKey(id) });
      if (thenContinue) {
        router.push({ pathname: '/inspection-readiness', params: { id } } as never);
      } else {
        Alert.alert('Saved', 'Estimate saved.');
      }
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Could not save the estimate.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || inspectionQuery.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const sidingFacetCount = inspection?.sidingFacets?.length ?? 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.advisory, { color: colors.mutedForeground }]}>
        Advisory pricing step — the estimate is included in the Proof Package but never blocks
        submission.
      </Text>

      {/* Measured basis */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Measured Basis</Text>
          <Pressable
            onPress={() => setCalcOpen(true)}
            style={[styles.addBtn, { borderWidth: 1, borderColor: colors.secondary, backgroundColor: 'transparent' }]}
          >
            <Icon name="calculator" size={14} color={colors.secondary} />
            <Text style={[styles.addBtnText, { color: colors.secondary }]}>Calculator</Text>
          </Pressable>
        </View>
        {measured ? (
          <>
            <Row label="Roof area" value={`${measured.areaSqft.toLocaleString('en-US')} sq ft`} colors={colors} />
            <Row label="Roof squares" value={String(measured.squares)} colors={colors} />
            <Row
              label="With waste"
              value={wasteAdjustedSquares != null ? `${wasteAdjustedSquares} squares` : '—'}
              colors={colors}
            />
          </>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            No facet areas measured yet — quantities can still be entered manually.
          </Text>
        )}
        {sidingFacetCount > 0 && (
          <Row label="Siding facets documented" value={String(sidingFacetCount)} colors={colors} />
        )}
        <View style={styles.wasteRow}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Waste factor %</Text>
          <TextInput
            value={wasteText}
            onChangeText={setWasteText}
            keyboardType="decimal-pad"
            style={[styles.wasteInput, { color: colors.foreground, borderColor: colors.border }]}
          />
        </View>
      </View>

      {/* Line items */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Line Items</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => {
                setCustomOpen((v) => !v);
                setPickerOpen(false);
              }}
              style={[styles.addBtn, { borderWidth: 1, borderColor: colors.secondary, backgroundColor: 'transparent' }]}
            >
              <Icon name="edit-3" size={14} color={colors.secondary} />
              <Text style={[styles.addBtnText, { color: colors.secondary }]}>Custom</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setPickerOpen((v) => !v);
                setCustomOpen(false);
              }}
              style={[styles.addBtn, { backgroundColor: colors.secondary }]}
            >
              <Icon name="plus" size={14} color="#fff" />
              <Text style={styles.addBtnText}>Add item</Text>
            </Pressable>
          </View>
        </View>

        {customOpen && (
          <View style={[styles.customForm, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              Custom line item
            </Text>
            <TextInput
              value={customDescription}
              onChangeText={setCustomDescription}
              placeholder="Description (e.g. Dumpster rental)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.customInput, { color: colors.foreground, borderColor: colors.border }]}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={customPriceText}
                onChangeText={setCustomPriceText}
                placeholder="Unit price ($)"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                style={[
                  styles.customInput,
                  { flex: 1, color: colors.foreground, borderColor: colors.border },
                ]}
              />
              <TextInput
                value={customUnit}
                onChangeText={setCustomUnit}
                placeholder="Unit (optional)"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.customInput,
                  { flex: 1, color: colors.foreground, borderColor: colors.border },
                ]}
              />
              <TextInput
                value={customQtyText}
                onChangeText={setCustomQtyText}
                placeholder="Qty"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                style={[
                  styles.customInput,
                  { width: 64, textAlign: 'right', color: colors.foreground, borderColor: colors.border },
                ]}
              />
            </View>
            {canWritePriceBook && (
              <Pressable
                onPress={() => setCustomSaveToBook((v) => !v)}
                style={styles.saveToBookRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: customSaveToBook }}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: customSaveToBook ? colors.secondary : colors.border,
                      backgroundColor: customSaveToBook ? colors.secondary : 'transparent',
                    },
                  ]}
                >
                  {customSaveToBook && <Icon name="check" size={12} color="#fff" />}
                </View>
                <Text style={{ color: colors.foreground, fontSize: 13 }}>
                  Also save to price book
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => void addCustomLine()}
              disabled={createItem.isPending}
              style={[
                styles.addBtn,
                {
                  backgroundColor: colors.secondary,
                  alignSelf: 'flex-end',
                  opacity: createItem.isPending ? 0.6 : 1,
                },
              ]}
            >
              {createItem.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="plus" size={14} color="#fff" />
              )}
              <Text style={styles.addBtnText}>Add custom line</Text>
            </Pressable>
          </View>
        )}

        {pickerOpen && (
          <View style={[styles.picker, { borderColor: colors.border }]}>
            {itemsQuery.isLoading ? (
              <ActivityIndicator style={{ marginVertical: 8 }} />
            ) : priceBookItems.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13, padding: 8 }}>
                No price book items yet — ask an admin to add items in Settings → Price Book.
              </Text>
            ) : (
              priceBookItems.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => addItem(item)}
                  style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontWeight: '500' }}>{item.name}</Text>
                    {item.unit ? (
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.unit}</Text>
                    ) : null}
                  </View>
                  <Text style={{ color: colors.secondary, fontWeight: '600' }}>
                    {formatCents(item.unitPrice)}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        )}

        {lines.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            No line items yet. Add items from the price book.
          </Text>
        ) : (
          lines.map((line, i) => {
            const qty = parseQty(line.quantityText);
            const total = qty != null ? Math.round(qty * line.unitPriceCents) : null;
            if (editingIndex === i) {
              return (
                <View
                  key={`${line.priceBookItemId ?? 'manual'}-${i}`}
                  style={[styles.lineRow, { borderColor: colors.secondary, flexDirection: 'column', gap: 8 }]}
                >
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                    Edit line item
                  </Text>
                  <TextInput
                    value={editDescription}
                    onChangeText={setEditDescription}
                    placeholder="Description"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.customInput, { color: colors.foreground, borderColor: colors.border }]}
                  />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      value={editPriceText}
                      onChangeText={setEditPriceText}
                      placeholder="Unit price ($)"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                      style={[
                        styles.customInput,
                        { flex: 1, color: colors.foreground, borderColor: colors.border },
                      ]}
                    />
                    <TextInput
                      value={editUnit}
                      onChangeText={setEditUnit}
                      placeholder="Unit (optional)"
                      placeholderTextColor={colors.mutedForeground}
                      style={[
                        styles.customInput,
                        { flex: 1, color: colors.foreground, borderColor: colors.border },
                      ]}
                    />
                  </View>
                  {line.priceBookItemId != null && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                      Changing this price book item makes it a one-off line for this estimate; the
                      price book itself is not changed.
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                    <Pressable
                      onPress={() => setEditingIndex(null)}
                      style={[styles.addBtn, { borderWidth: 1, borderColor: colors.border }]}
                    >
                      <Text style={[styles.addBtnText, { color: colors.foreground }]}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={saveEditLine}
                      style={[styles.addBtn, { backgroundColor: colors.secondary }]}
                    >
                      <Icon name="check" size={14} color="#fff" />
                      <Text style={styles.addBtnText}>Done</Text>
                    </Pressable>
                  </View>
                </View>
              );
            }
            return (
              <View key={`${line.priceBookItemId ?? 'manual'}-${i}`} style={[styles.lineRow, { borderColor: colors.border }]}>
                <Pressable style={{ flex: 1 }} onPress={() => startEditLine(i)}>
                  <Text style={{ color: colors.foreground, fontWeight: '500' }}>
                    {line.description}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {formatCents(line.unitPriceCents)}
                    {line.unit ? ` ${line.unit}` : ''}
                  </Text>
                  <View style={styles.lineControls}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Qty</Text>
                    <TextInput
                      value={line.quantityText}
                      onChangeText={(v) => updateLine(i, { quantityText: v })}
                      keyboardType="decimal-pad"
                      style={[styles.qtyInput, { color: colors.foreground, borderColor: colors.border }]}
                    />
                    <Pressable
                      onPress={() => updateLine(i, { isAdder: !line.isAdder })}
                      style={[
                        styles.adderToggle,
                        {
                          borderColor: line.isAdder ? colors.secondary : colors.border,
                          backgroundColor: line.isAdder ? colors.secondary + '22' : 'transparent',
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: line.isAdder ? colors.secondary : colors.mutedForeground,
                          fontSize: 12,
                          fontWeight: '600',
                        }}
                      >
                        Adder
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
                <View style={{ alignItems: 'flex-end', gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                    {total != null ? formatCents(total) : '—'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                    <Pressable onPress={() => startEditLine(i)} hitSlop={8}>
                      <Icon name="edit-3" size={16} color={colors.mutedForeground} />
                    </Pressable>
                    <Pressable onPress={() => removeLine(i)} hitSlop={8}>
                      <Icon name="trash-2" size={16} color={colors.destructive} />
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })
        )}

        {lines.length > 0 && (
          <View style={[styles.subtotalRow, { borderTopColor: colors.border }]}>
            <Text style={{ color: colors.foreground, fontWeight: '600' }}>Subtotal</Text>
            <Text style={{ color: colors.secondary, fontWeight: '800', fontSize: 17 }}>
              {formatCents(subtotalCents)}
            </Text>
          </View>
        )}
      </View>

      {/* Note */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Note</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Optional note shown under the estimate in the report"
          placeholderTextColor={colors.mutedForeground}
          multiline
          numberOfLines={3}
          style={[
            styles.noteInput,
            { color: colors.foreground, borderColor: colors.border },
          ]}
        />
      </View>

      <Pressable
        onPress={() => void save(false)}
        disabled={saving}
        style={[styles.saveBtn, { borderColor: colors.border, opacity: saving ? 0.6 : 1 }]}
      >
        {saving ? (
          <ActivityIndicator />
        ) : (
          <Text style={{ color: colors.foreground, fontWeight: '700' }}>Save estimate</Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => void save(true)}
        disabled={saving}
        style={[styles.continueBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
      >
        <Text style={styles.continueBtnText}>Save & Continue to Submit</Text>
        <Icon name="arrow-right" size={18} color="#fff" />
      </Pressable>

      <CalculatorModal visible={calcOpen} onClose={() => setCalcOpen(false)} />
    </ScrollView>
  );
}

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.row}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, paddingBottom: 48, gap: 14 },
  advisory: { fontSize: 12.5, lineHeight: 18 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  wasteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  wasteInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    minWidth: 80,
    textAlign: 'right',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  picker: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  customForm: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 },
  saveToBookRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lineRow: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
  },
  lineControls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  qtyInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    minWidth: 64,
    textAlign: 'right',
  },
  adderToggle: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  subtotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginTop: 2,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  saveBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 16,
  },
  continueBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  ProductIdMethod,
  getGetInspectionQueryKey,
  useGetInspection,
} from '@workspace/api-client-react';
import type { ProductIdMethod as ProductIdMethodValue } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { attestInspection, createProduct } from '@/lib/inspectionSync';
import { useNextSectionHeader } from '@/hooks/useNextSectionHeader';

// C5 — Product identification (grouped under the S4 close-up phase). The
// inspector documents the roofing product with close-ups (brand/profile,
// exposure with a tape measure, granule/mat detail) and records how it was
// identified: recognised in the field, sampled for ITEL lab matching (bag &
// label), or flagged as unidentifiable in the field. An unidentifiable product
// files a real attestation for the audit trail and trips a non-blocking S4
// soft flag (see lib/protocol checkUnidentifiedProducts) — it never blocks.

const METHOD_OPTIONS: Array<{ method: ProductIdMethodValue; label: string; hint: string }> = [
  {
    method: ProductIdMethod.field_identified,
    label: 'Identified in field',
    hint: 'Brand & product line recognised on-site',
  },
  {
    method: ProductIdMethod.itel_sample,
    label: 'ITEL sample',
    hint: 'Bagged & labeled a sample for lab matching',
  },
  {
    method: ProductIdMethod.unidentifiable,
    label: 'Unidentifiable',
    hint: 'Cannot be determined in the field',
  },
];

// C5 close-up documentation shots. The shared capture screen only supports
// wide/mid/close triad roles, so each product shot is pushed as its own
// single-role capture with a descriptive title rather than a forced triad.
const PRODUCT_SHOTS: Array<{ key: string; role: 'wide' | 'mid' | 'close'; title: string }> = [
  { key: 'brand', role: 'close', title: 'Brand / profile close-up' },
  { key: 'exposure', role: 'close', title: 'Exposure with tape measure' },
  { key: 'granule', role: 'close', title: 'Granule / mat detail' },
  { key: 'accessories', role: 'wide', title: 'Accessories (hip/ridge, starter)' },
];

export default function InspectionProductScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  useNextSectionHeader(id, 'product');

  const inspectionQuery = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id) },
  });
  const inspection = inspectionQuery.data?.inspection;

  const [method, setMethod] = React.useState<ProductIdMethodValue>(ProductIdMethod.field_identified);
  const [category, setCategory] = React.useState('');
  const [brand, setBrand] = React.useState('');
  const [productLine, setProductLine] = React.useState('');
  const [itelRef, setItelRef] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  if (inspectionQuery.isLoading && !inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!inspection) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Icon name="alert-circle" size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Inspection not found.</Text>
      </View>
    );
  }

  const products = inspection.products ?? [];

  const canSave =
    !saving &&
    (method !== ProductIdMethod.itel_sample || itelRef.trim().length > 0) &&
    (method !== ProductIdMethod.unidentifiable || reason.trim().length > 0);

  function capturePhoto(productId: string, role: 'wide' | 'mid' | 'close', title: string) {
    router.push({
      pathname: '/inspection-photo-capture',
      params: {
        inspectionId: id,
        subjectType: 'product',
        subjectId: productId,
        roles: role,
        stage: 'product',
        title,
      },
    });
  }

  async function saveProduct() {
    if (!canSave) return;
    setSaving(true);
    try {
      const productId = await createProduct(queryClient, id, {
        category: category.trim() || null,
        brand: method === ProductIdMethod.field_identified ? brand.trim() || null : null,
        productLine: method === ProductIdMethod.field_identified ? productLine.trim() || null : null,
        identificationMethod: method,
        itelSampleRef: method === ProductIdMethod.itel_sample ? itelRef.trim() || null : null,
        unidentifiableReason:
          method === ProductIdMethod.unidentifiable ? reason.trim() || null : null,
      });

      // An unidentifiable product is a defensible field judgment: record a
      // real attestation so the audit trail carries the inspector's sign-off,
      // then let the shared gate engine raise its non-blocking S4 soft flag.
      if (method === ProductIdMethod.unidentifiable) {
        await attestInspection(id, {
          stage: 'product',
          attestationType: 'stage_signoff',
          details: {
            kind: 'product_unidentifiable',
            productId,
            reason: reason.trim() || null,
          },
        });
      }

      setCategory('');
      setBrand('');
      setProductLine('');
      setItelRef('');
      setReason('');
      setMethod(ProductIdMethod.field_identified);

      // First documentation shot; the record row then exposes the rest.
      capturePhoto(productId, PRODUCT_SHOTS[0].role, PRODUCT_SHOTS[0].title);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Existing product records */}
        {products.length > 0 ? (
          <>
            <Text style={[styles.section, { color: colors.foreground }]}>
              Documented products ({products.length})
            </Text>
            {products.map((product) => {
              const methodLabel =
                METHOD_OPTIONS.find((o) => o.method === product.identificationMethod)?.label ??
                product.identificationMethod;
              const title = [product.brand, product.productLine].filter(Boolean).join(' ') || methodLabel;
              const unidentifiable = product.identificationMethod === ProductIdMethod.unidentifiable;
              return (
                <View
                  key={product.id}
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderColor: unidentifiable ? '#f59e0b' : colors.border },
                  ]}
                >
                  <View style={styles.cardHead}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{methodLabel}</Text>
                  </View>
                  {unidentifiable ? (
                    <Text style={{ color: '#b45309', fontSize: 12, marginBottom: 6 }}>
                      Flagged unidentifiable — attestation filed.
                    </Text>
                  ) : null}
                  <View style={styles.shotRow}>
                    {PRODUCT_SHOTS.map((shot) => (
                      <Pressable
                        key={shot.key}
                        onPress={() => capturePhoto(product.id, shot.role, shot.title)}
                        style={[styles.shotChip, { borderColor: colors.border }]}
                      >
                        <Icon name="camera" size={14} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>{shot.title}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </>
        ) : null}

        {/* New product record */}
        <Text style={[styles.section, { color: colors.foreground }]}>Identify the roofing product</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Field label="Category (optional)" value={category} onChange={setCategory} placeholder="e.g. Asphalt shingle, metal panel" colors={colors} />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Identification method</Text>
          {METHOD_OPTIONS.map((option) => {
            const active = method === option.method;
            return (
              <Pressable
                key={option.method}
                onPress={() => setMethod(option.method)}
                style={[
                  styles.methodRow,
                  {
                    backgroundColor: active ? colors.accent : 'transparent',
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.radio,
                    { borderColor: active ? colors.primary : colors.border },
                  ]}
                >
                  {active ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '700' }}>{option.label}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{option.hint}</Text>
                </View>
              </Pressable>
            );
          })}

          {method === ProductIdMethod.field_identified ? (
            <>
              <Field label="Brand" value={brand} onChange={setBrand} placeholder="e.g. GAF, Owens Corning" colors={colors} />
              <Field label="Product line (optional)" value={productLine} onChange={setProductLine} placeholder="e.g. Timberline HDZ" colors={colors} />
            </>
          ) : null}

          {method === ProductIdMethod.itel_sample ? (
            <Field
              label="Sample bag & label reference"
              value={itelRef}
              onChange={setItelRef}
              placeholder="e.g. Bag #A-12, front slope"
              colors={colors}
            />
          ) : null}

          {method === ProductIdMethod.unidentifiable ? (
            <>
              <View style={[styles.warnBox, { backgroundColor: '#fffbeb', borderColor: '#f59e0b' }]}>
                <Icon name="alert-circle" size={16} color="#b45309" />
                <Text style={{ color: '#92400e', fontSize: 12, flex: 1 }}>
                  This files an attestation and raises a review flag. Prefer bagging an ITEL sample when possible.
                </Text>
              </View>
              <Field
                label="Why is it unidentifiable?"
                value={reason}
                onChange={setReason}
                placeholder="e.g. No markings, product discontinued"
                colors={colors}
              />
            </>
          ) : null}

          <Pressable
            onPress={saveProduct}
            disabled={!canSave}
            style={[styles.addBtn, { backgroundColor: colors.primary, opacity: canSave ? 1 : 0.5 }]}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.addText, { color: colors.primaryForeground }]}>Record & photograph</Text>
            )}
          </Pressable>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  shotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  addBtn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  addText: { fontSize: 15, fontWeight: '700' },
});

import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import { getApiBaseUrl } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';
import { uploadFile } from '@/lib/upload';
import {
  useListDiscontinuedProducts,
  useCreateDiscontinuedProduct,
  useUpdateDiscontinuedProduct,
  useDeleteDiscontinuedProduct,
  type DiscontinuedProduct,
} from '@/lib/discontinuedProductsApi';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Hook returning auth headers for displaying stored /objects/ photos. */
export function useStorageAuthHeaders(): Record<string, string> | null {
  const [headers, setHeaders] = React.useState<Record<string, string> | null>(null);
  React.useEffect(() => {
    let active = true;
    void getToken('auth_session_token').then((token) => {
      if (active) setHeaders(token ? { Authorization: `Bearer ${token}` } : {});
    });
    return () => {
      active = false;
    };
  }, []);
  return headers;
}

export function storagePhotoUri(photoPath: string): string {
  return `${getApiBaseUrl()}/storage${photoPath}`;
}

export function formatInches(v: number | null | undefined): string {
  return v == null ? '—' : `${v}"`;
}

function parseInches(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return undefined; // undefined = invalid
  return n;
}

interface FormState {
  editingId: string | null;
  name: string;
  width: string;
  exposure: string;
  photoPath: string | null;
}

const EMPTY_FORM: FormState = { editingId: null, name: '', width: '', exposure: '', photoPath: null };

// ---------------------------------------------------------------------------
// Picker — used by the repairability assessment (RR-010A) to select a
// probable product match from the Known Product Catalog.
// ---------------------------------------------------------------------------

export function ProductMatchPickerModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (product: DiscontinuedProduct) => void;
}) {
  const colors = useColors();
  const authHeaders = useStorageAuthHeaders();
  const listQuery = useListDiscontinuedProducts({ enabled: visible });
  const products = listQuery.data?.products ?? [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Select Probable Product Match</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Icon name="x" size={20} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
            {listQuery.isLoading ? (
              <ActivityIndicator style={{ marginVertical: 20 }} />
            ) : products.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 13, marginVertical: 12 }}>
                No products in the Known Product Catalog yet. An admin can add discontinued
                products under Profile → Company → Known Product Catalog.
              </Text>
            ) : (
              products.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => onSelect(p)}
                  style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}
                >
                  {p.photoPath && authHeaders ? (
                    <Image
                      source={{ uri: storagePhotoUri(p.photoPath), headers: authHeaders }}
                      style={styles.pickThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.pickThumb, styles.thumbEmpty, { borderColor: colors.border }]}>
                      <Icon name="image" size={22} color={colors.mutedForeground} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.foreground, fontWeight: '700' }} numberOfLines={2}>
                      {p.name}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                      Width {formatInches(p.widthInches)} · Exposure {formatInches(p.exposureInches)}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Settings modal — manage the Known Product Catalog
// ---------------------------------------------------------------------------

export function DiscontinuedProductsModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const authHeaders = useStorageAuthHeaders();
  const listQuery = useListDiscontinuedProducts({ enabled: visible });
  const products = listQuery.data?.products ?? [];
  const createProduct = useCreateDiscontinuedProduct();
  const updateProduct = useUpdateDiscontinuedProduct();
  const deleteProduct = useDeleteDiscontinuedProduct();

  const [form, setForm] = React.useState<FormState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [photoUploading, setPhotoUploading] = React.useState(false);

  async function handlePickPhoto() {
    if (photoUploading || !form) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to add a product photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    setPhotoUploading(true);
    try {
      const objectPath = await uploadFile(result.assets[0].uri, 'image/jpeg');
      setForm((f) => (f ? { ...f, photoPath: objectPath } : f));
    } catch {
      Alert.alert('Upload failed', 'Could not upload the photo. Try again.');
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleSave() {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) {
      Alert.alert('Name required', 'Enter the discontinued product name.');
      return;
    }
    const widthInches = parseInches(form.width);
    const exposureInches = parseInches(form.exposure);
    if (widthInches === undefined || exposureInches === undefined) {
      Alert.alert('Invalid measurement', 'Width and exposure must be positive numbers (inches).');
      return;
    }
    setSaving(true);
    try {
      const payload = { name, photoPath: form.photoPath, widthInches, exposureInches };
      if (form.editingId) {
        await updateProduct.mutateAsync({ id: form.editingId, ...payload });
      } else {
        await createProduct.mutateAsync(payload);
      }
      setForm(null);
    } catch {
      Alert.alert('Save failed', 'Could not save the product. Try again.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(product: DiscontinuedProduct) {
    Alert.alert('Delete product', `Remove "${product.name}" from the catalog?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteProduct.mutate(
            { id: product.id },
            { onError: () => Alert.alert('Delete failed', 'Could not delete the product.') },
          );
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
        >
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                {form ? (form.editingId ? 'Edit Product' : 'Add Discontinued Product') : 'Known Product Catalog'}
              </Text>
              <Pressable onPress={form ? () => setForm(null) : onClose} hitSlop={8}>
                <Icon name={form ? 'arrow-left' : 'x'} size={20} color={colors.foreground} />
              </Pressable>
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
              {form ? (
                <>
                  <Text style={[styles.label, { color: colors.foreground }]}>Product name</Text>
                  <TextInput
                    value={form.name}
                    onChangeText={(name) => setForm({ ...form, name })}
                    placeholder="e.g. Horizon Shadow 25 (discontinued)"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                  />
                  <Text style={[styles.label, { color: colors.foreground }]}>Shingle width (inches)</Text>
                  <TextInput
                    value={form.width}
                    onChangeText={(width) => setForm({ ...form, width })}
                    placeholder='e.g. 39.375'
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                  />
                  <Text style={[styles.label, { color: colors.foreground }]}>Exposure (inches)</Text>
                  <TextInput
                    value={form.exposure}
                    onChangeText={(exposure) => setForm({ ...form, exposure })}
                    placeholder='e.g. 5.625'
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                  />
                  <Text style={[styles.label, { color: colors.foreground }]}>Reference photo</Text>
                  {form.photoPath && authHeaders ? (
                    <Image
                      source={{ uri: storagePhotoUri(form.photoPath), headers: authHeaders }}
                      style={styles.formPhoto}
                      resizeMode="cover"
                    />
                  ) : null}
                  <Pressable
                    onPress={handlePickPhoto}
                    disabled={photoUploading}
                    style={[styles.button, { backgroundColor: colors.secondary }]}
                  >
                    {photoUploading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>
                        {form.photoPath ? 'Replace Photo' : 'Add Photo'}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={handleSave}
                    disabled={saving}
                    style={[styles.button, { backgroundColor: colors.primary }]}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>{form.editingId ? 'Save Changes' : 'Add Product'}</Text>
                    )}
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    Discontinued roofing products reps can match against during a repairability
                    assessment. Name, photo, width, and exposure carry into the assessment record.
                  </Text>
                  {listQuery.isLoading ? (
                    <ActivityIndicator style={{ marginVertical: 20 }} />
                  ) : products.length === 0 ? (
                    <Text style={{ color: colors.mutedForeground, fontSize: 13, marginVertical: 12 }}>
                      No products yet. Add the discontinued products your team encounters.
                    </Text>
                  ) : (
                    products.map((p) => (
                      <View
                        key={p.id}
                        style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}
                      >
                        {p.photoPath && authHeaders ? (
                          <Image
                            source={{ uri: storagePhotoUri(p.photoPath), headers: authHeaders }}
                            style={styles.thumb}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={[styles.thumb, styles.thumbEmpty, { borderColor: colors.border }]}>
                            <Icon name="image" size={18} color={colors.mutedForeground} />
                          </View>
                        )}
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ color: colors.foreground, fontWeight: '700' }} numberOfLines={2}>
                            {p.name}
                          </Text>
                          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                            Width {formatInches(p.widthInches)} · Exposure {formatInches(p.exposureInches)}
                          </Text>
                        </View>
                        <Pressable
                          hitSlop={8}
                          onPress={() =>
                            setForm({
                              editingId: p.id,
                              name: p.name,
                              width: p.widthInches != null ? String(p.widthInches) : '',
                              exposure: p.exposureInches != null ? String(p.exposureInches) : '',
                              photoPath: p.photoPath,
                            })
                          }
                        >
                          <Icon name="edit-2" size={18} color={colors.mutedForeground} />
                        </Pressable>
                        <Pressable hitSlop={8} onPress={() => confirmDelete(p)}>
                          <Icon name="trash-2" size={18} color={colors.destructive} />
                        </Pressable>
                      </View>
                    ))
                  )}
                  <Pressable
                    onPress={() => setForm(EMPTY_FORM)}
                    style={[styles.button, { backgroundColor: colors.primary }]}
                  >
                    <Text style={styles.buttonText}>Add Product</Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800' },
  scroll: { flexGrow: 0 },
  label: { fontSize: 13, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  button: {
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  formPhoto: { width: '100%', height: 160, borderRadius: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  thumb: { width: 52, height: 52, borderRadius: 8 },
  pickThumb: { width: 72, height: 72, borderRadius: 8 },
  thumbEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

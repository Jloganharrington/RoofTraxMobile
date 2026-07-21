import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '@/components/Icon';
import { useColors } from '@/hooks/useColors';
import {
  useListPriceBookItems,
  useCreatePriceBookItem,
  useUpdatePriceBookItem,
  useDeletePriceBookItem,
  useListPriceBookPackages,
  useCreatePriceBookPackage,
  useUpdatePriceBookPackage,
  useDeletePriceBookPackage,
  type PriceBookItem,
  type PriceBookPackage,
  type PriceBookPackageItem,
  type InspectionCondition,
} from '@/lib/priceBookApi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function parsePriceToCents(raw: string): number | null {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const CONDITION_OPTIONS: Array<{ value: InspectionCondition | null; label: string }> = [
  { value: null, label: 'None (manual selection)' },
  { value: 'roof_damage', label: 'Roof Damage' },
  { value: 'siding_damage', label: 'Siding Damage' },
  { value: 'roof_and_siding_damage', label: 'Roof & Siding Damage' },
];

function conditionLabel(c: InspectionCondition | null): string {
  return CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? '—';
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

type ModalView = 'list' | 'edit-item' | 'edit-package';

interface ItemFormState {
  editingId: string | null;
  name: string;
  description: string;
  unitPrice: string;
}

interface PackageFormState {
  editingId: string | null;
  name: string;
  condition: InspectionCondition | null;
  // map itemId → quantity (0 = not selected)
  assignments: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Item form
// ---------------------------------------------------------------------------

function ItemForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: ItemFormState;
  onSave: (state: ItemFormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const colors = useColors();
  const [name, setName] = React.useState(initial.name);
  const [description, setDescription] = React.useState(initial.description);
  const [unitPrice, setUnitPrice] = React.useState(initial.unitPrice);

  return (
    <View style={{ gap: 12 }}>
      <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Name *</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Architectural Shingles"
        placeholderTextColor={colors.mutedForeground}
        style={[s.input, { color: colors.foreground, borderColor: colors.border }]}
      />

      <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Optional notes about this line item"
        placeholderTextColor={colors.mutedForeground}
        multiline
        numberOfLines={3}
        style={[s.input, { color: colors.foreground, borderColor: colors.border, minHeight: 72, textAlignVertical: 'top' }]}
      />

      <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Unit Price *</Text>
      <TextInput
        value={unitPrice}
        onChangeText={setUnitPrice}
        placeholder="0.00"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="decimal-pad"
        style={[s.input, { color: colors.foreground, borderColor: colors.border }]}
      />

      <View style={s.formActions}>
        <Pressable
          onPress={onCancel}
          disabled={saving}
          style={[s.btn, { borderColor: colors.border, borderWidth: 1 }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: '600' }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => onSave({ ...initial, name, description, unitPrice })}
          disabled={saving}
          style={[s.btn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1, flex: 1 }]}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Save item</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Package form
// ---------------------------------------------------------------------------

function PackageForm({
  initial,
  allItems,
  onSave,
  onCancel,
  saving,
}: {
  initial: PackageFormState;
  allItems: PriceBookItem[];
  onSave: (state: PackageFormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const colors = useColors();
  const [name, setName] = React.useState(initial.name);
  const [condition, setCondition] = React.useState<InspectionCondition | null>(initial.condition);
  const [assignments, setAssignments] = React.useState<Record<string, number>>(initial.assignments);
  const [conditionOpen, setConditionOpen] = React.useState(false);

  function toggleItem(itemId: string) {
    setAssignments((prev) =>
      prev[itemId] ? { ...prev, [itemId]: 0 } : { ...prev, [itemId]: 1 },
    );
  }

  function setQty(itemId: string, raw: string) {
    const n = parseInt(raw, 10);
    setAssignments((prev) => ({ ...prev, [itemId]: isNaN(n) || n < 1 ? 1 : n }));
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Package Name *</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Roofing Package"
        placeholderTextColor={colors.mutedForeground}
        style={[s.input, { color: colors.foreground, borderColor: colors.border }]}
      />

      <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Inspection Condition</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: -8 }}>
        When set, this package is auto-suggested for matching inspections.
      </Text>
      <Pressable
        onPress={() => setConditionOpen((v) => !v)}
        style={[s.input, { borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
      >
        <Text style={{ color: colors.foreground }}>{conditionLabel(condition)}</Text>
        <Icon name={conditionOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
      </Pressable>
      {conditionOpen && (
        <View style={[s.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {CONDITION_OPTIONS.map((opt) => (
            <Pressable
              key={String(opt.value)}
              onPress={() => { setCondition(opt.value); setConditionOpen(false); }}
              style={[
                s.dropdownItem,
                condition === opt.value && { backgroundColor: colors.secondary + '22' },
              ]}
            >
              <Text style={{ color: colors.foreground, fontSize: 14 }}>{opt.label}</Text>
              {condition === opt.value && (
                <Icon name="check" size={14} color={colors.secondary} />
              )}
            </Pressable>
          ))}
        </View>
      )}

      <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 4 }]}>
        Line Items
      </Text>
      {allItems.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
          No line items yet. Add items first, then assign them to packages.
        </Text>
      ) : (
        allItems.map((item) => {
          const qty = assignments[item.id] ?? 0;
          const selected = qty > 0;
          return (
            <View
              key={item.id}
              style={[
                s.itemRow,
                {
                  borderColor: selected ? colors.secondary : colors.border,
                  backgroundColor: selected ? colors.secondary + '11' : colors.card,
                },
              ]}
            >
              <Pressable onPress={() => toggleItem(item.id)} style={s.itemRowCheck}>
                <View
                  style={[
                    s.checkbox,
                    {
                      borderColor: selected ? colors.secondary : colors.border,
                      backgroundColor: selected ? colors.secondary : 'transparent',
                    },
                  ]}
                >
                  {selected && <Icon name="check" size={11} color="#fff" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontWeight: '500', fontSize: 14 }}>
                    {item.name}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {formatPrice(item.unitPrice)}
                  </Text>
                </View>
              </Pressable>
              {selected && (
                <View style={s.qtyRow}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Qty</Text>
                  <TextInput
                    value={String(qty)}
                    onChangeText={(v) => setQty(item.id, v)}
                    keyboardType="number-pad"
                    style={[s.qtyInput, { color: colors.foreground, borderColor: colors.border }]}
                  />
                </View>
              )}
            </View>
          );
        })
      )}

      <View style={s.formActions}>
        <Pressable
          onPress={onCancel}
          disabled={saving}
          style={[s.btn, { borderColor: colors.border, borderWidth: 1 }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: '600' }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => onSave({ ...initial, name, condition, assignments })}
          disabled={saving}
          style={[s.btn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1, flex: 1 }]}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
              Save package
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function PriceBookModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const [currentView, setCurrentView] = React.useState<ModalView>('list');

  const itemsQuery = useListPriceBookItems({ enabled: visible });
  const packagesQuery = useListPriceBookPackages({ enabled: visible });
  const items = itemsQuery.data?.items ?? [];
  const packages = packagesQuery.data?.packages ?? [];

  // Item mutations
  const createItem = useCreatePriceBookItem();
  const updateItem = useUpdatePriceBookItem();
  const deleteItem = useDeletePriceBookItem();

  // Package mutations
  const createPackage = useCreatePriceBookPackage();
  const updatePackage = useUpdatePriceBookPackage();
  const deletePackage = useDeletePriceBookPackage();

  // Item form state
  const emptyItem: ItemFormState = { editingId: null, name: '', description: '', unitPrice: '' };
  const [itemForm, setItemForm] = React.useState<ItemFormState>(emptyItem);
  const [itemSaving, setItemSaving] = React.useState(false);

  // Package form state
  const emptyPackage: PackageFormState = { editingId: null, name: '', condition: null, assignments: {} };
  const [pkgForm, setPkgForm] = React.useState<PackageFormState>(emptyPackage);
  const [pkgSaving, setPkgSaving] = React.useState(false);

  function openAddItem() {
    setItemForm(emptyItem);
    setCurrentView('edit-item');
  }

  function openEditItem(item: PriceBookItem) {
    setItemForm({
      editingId: item.id,
      name: item.name,
      description: item.description ?? '',
      unitPrice: (item.unitPrice / 100).toFixed(2),
    });
    setCurrentView('edit-item');
  }

  function openAddPackage() {
    setPkgForm(emptyPackage);
    setCurrentView('edit-package');
  }

  function openEditPackage(pkg: PriceBookPackage) {
    const assignments: Record<string, number> = {};
    for (const a of pkg.items) assignments[a.itemId] = a.quantity;
    setPkgForm({
      editingId: pkg.id,
      name: pkg.name,
      condition: pkg.inspectionCondition,
      assignments,
    });
    setCurrentView('edit-package');
  }

  async function handleSaveItem(state: ItemFormState) {
    const name = state.name.trim();
    if (!name) {
      Alert.alert('Name required', 'Enter a name for this line item.');
      return;
    }
    const cents = parsePriceToCents(state.unitPrice);
    if (cents === null) {
      Alert.alert('Invalid price', 'Enter a valid price (e.g. 285.00).');
      return;
    }
    setItemSaving(true);
    try {
      if (state.editingId) {
        await updateItem.mutateAsync({
          id: state.editingId,
          name,
          description: state.description.trim() || null,
          unitPrice: cents,
        });
      } else {
        await createItem.mutateAsync({
          name,
          description: state.description.trim() || null,
          unitPrice: cents,
        });
      }
      setCurrentView('list');
    } catch {
      Alert.alert('Save failed', 'Could not save the line item. Check your connection and try again.');
    } finally {
      setItemSaving(false);
    }
  }

  function handleDeleteItem(item: PriceBookItem) {
    Alert.alert(
      'Delete line item?',
      `"${item.name}" will be removed from all packages that use it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteItem.mutateAsync(item.id);
            } catch {
              Alert.alert('Delete failed', 'Could not delete the item. Try again.');
            }
          },
        },
      ],
    );
  }

  async function handleSavePackage(state: PackageFormState) {
    const name = state.name.trim();
    if (!name) {
      Alert.alert('Name required', 'Enter a name for this package.');
      return;
    }
    const itemAssignments: PriceBookPackageItem[] = Object.entries(state.assignments)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantity]) => ({ itemId, quantity }));

    setPkgSaving(true);
    try {
      if (state.editingId) {
        await updatePackage.mutateAsync({
          id: state.editingId,
          name,
          inspectionCondition: state.condition,
          itemAssignments,
        });
      } else {
        await createPackage.mutateAsync({
          name,
          inspectionCondition: state.condition,
          itemAssignments,
        });
      }
      setCurrentView('list');
    } catch {
      Alert.alert('Save failed', 'Could not save the package. Check your connection and try again.');
    } finally {
      setPkgSaving(false);
    }
  }

  function handleDeletePackage(pkg: PriceBookPackage) {
    Alert.alert('Delete package?', `"${pkg.name}" will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePackage.mutateAsync(pkg.id);
          } catch {
            Alert.alert('Delete failed', 'Could not delete the package. Try again.');
          }
        },
      },
    ]);
  }

  function handleClose() {
    setCurrentView('list');
    onClose();
  }

  const isLoading = itemsQuery.isLoading || packagesQuery.isLoading;

  // Map itemId → item for package display
  const itemMap = React.useMemo<Map<string, PriceBookItem>>(
    () => new Map(items.map((i: PriceBookItem) => [i.id, i])),
    [items],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={currentView === 'list' ? handleClose : () => setCurrentView('list')}
    >
      <View style={[s.overlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
        <View style={[s.sheet, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[s.header, { borderBottomColor: colors.border }]}>
            {currentView !== 'list' ? (
              <Pressable onPress={() => setCurrentView('list')} style={s.backBtn}>
                <Icon name="chevron-left" size={20} color={colors.foreground} />
              </Pressable>
            ) : (
              <View style={{ width: 32 }} />
            )}
            <Text style={[s.headerTitle, { color: colors.foreground }]}>
              {currentView === 'list'
                ? 'Price Book'
                : currentView === 'edit-item'
                ? itemForm.editingId
                  ? 'Edit Line Item'
                  : 'Add Line Item'
                : pkgForm.editingId
                ? 'Edit Package'
                : 'Add Package'}
            </Text>
            <Pressable onPress={handleClose} style={s.closeBtn}>
              <Icon name="x" size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={s.body}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── List view ── */}
            {currentView === 'list' && (
              <>
                {/* Line Items section */}
                <View style={s.sectionHeader}>
                  <Text style={[s.sectionTitle, { color: colors.foreground }]}>Line Items</Text>
                  <Pressable
                    onPress={openAddItem}
                    style={[s.addBtn, { backgroundColor: colors.secondary }]}
                  >
                    <Icon name="plus" size={14} color="#fff" />
                    <Text style={s.addBtnText}>Add</Text>
                  </Pressable>
                </View>

                {isLoading ? (
                  <ActivityIndicator style={{ marginVertical: 12 }} />
                ) : items.length === 0 ? (
                  <View style={[s.emptyCard, { backgroundColor: colors.muted }]}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: 'center' }}>
                      No line items yet.{'\n'}Tap Add to create your first item.
                    </Text>
                  </View>
                ) : (
                  items.map((item: PriceBookItem) => (
                    <View
                      key={item.id}
                      style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 15 }}>
                          {item.name}
                        </Text>
                        {item.description ? (
                          <Text
                            style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}
                            numberOfLines={2}
                          >
                            {item.description}
                          </Text>
                        ) : null}
                        <Text style={{ color: colors.secondary, fontWeight: '700', marginTop: 4 }}>
                          {formatPrice(item.unitPrice)}
                        </Text>
                      </View>
                      <View style={s.cardActions}>
                        <Pressable onPress={() => openEditItem(item)} style={s.iconBtn}>
                          <Icon name="edit-3" size={16} color={colors.mutedForeground} />
                        </Pressable>
                        <Pressable onPress={() => handleDeleteItem(item)} style={s.iconBtn}>
                          <Icon name="trash-2" size={16} color={colors.destructive} />
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}

                {/* Packages section */}
                <View style={[s.sectionHeader, { marginTop: 24 }]}>
                  <Text style={[s.sectionTitle, { color: colors.foreground }]}>Packages</Text>
                  <Pressable
                    onPress={openAddPackage}
                    style={[s.addBtn, { backgroundColor: colors.secondary }]}
                  >
                    <Icon name="plus" size={14} color="#fff" />
                    <Text style={s.addBtnText}>Add</Text>
                  </Pressable>
                </View>

                {isLoading ? (
                  <ActivityIndicator style={{ marginVertical: 12 }} />
                ) : packages.length === 0 ? (
                  <View style={[s.emptyCard, { backgroundColor: colors.muted }]}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: 'center' }}>
                      No packages yet.{'\n'}Group line items into packages and set inspection conditions.
                    </Text>
                  </View>
                ) : (
                  packages.map((pkg: PriceBookPackage) => {
                    const total = pkg.items.reduce((sum: number, a: PriceBookPackageItem) => {
                      const item = itemMap.get(a.itemId);
                      return sum + (item ? item.unitPrice * a.quantity : 0);
                    }, 0);
                    return (
                      <View
                        key={pkg.id}
                        style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 15 }}>
                              {pkg.name}
                            </Text>
                            {pkg.inspectionCondition && (
                              <View style={[s.condBadge, { backgroundColor: colors.secondary + '22' }]}>
                                <Text style={{ color: colors.secondary, fontSize: 11, fontWeight: '600' }}>
                                  {conditionLabel(pkg.inspectionCondition)}
                                </Text>
                              </View>
                            )}
                          </View>

                          {pkg.items.length === 0 ? (
                            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
                              No items assigned
                            </Text>
                          ) : (
                            pkg.items.map((a: PriceBookPackageItem) => {
                              const item = itemMap.get(a.itemId);
                              if (!item) return null;
                              return (
                                <Text
                                  key={a.itemId}
                                  style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 3 }}
                                >
                                  • {item.name} × {a.quantity}{' '}
                                  <Text style={{ color: colors.mutedForeground }}>
                                    ({formatPrice(item.unitPrice * a.quantity)})
                                  </Text>
                                </Text>
                              );
                            })
                          )}

                          {pkg.items.length > 0 && (
                            <Text style={{ color: colors.secondary, fontWeight: '700', marginTop: 6 }}>
                              Total: {formatPrice(total)}
                            </Text>
                          )}
                        </View>
                        <View style={s.cardActions}>
                          <Pressable onPress={() => openEditPackage(pkg)} style={s.iconBtn}>
                            <Icon name="edit-3" size={16} color={colors.mutedForeground} />
                          </Pressable>
                          <Pressable onPress={() => handleDeletePackage(pkg)} style={s.iconBtn}>
                            <Icon name="trash-2" size={16} color={colors.destructive} />
                          </Pressable>
                        </View>
                      </View>
                    );
                  })
                )}
              </>
            )}

            {/* ── Item form view ── */}
            {currentView === 'edit-item' && (
              <ItemForm
                initial={itemForm}
                onSave={handleSaveItem}
                onCancel={() => setCurrentView('list')}
                saving={itemSaving}
              />
            )}

            {/* ── Package form view ── */}
            {currentView === 'edit-package' && (
              <PackageForm
                initial={pkgForm}
                allItems={items}
                onSave={handleSavePackage}
                onCancel={() => setCurrentView('list')}
                saving={pkgSaving}
              />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: 16,
    paddingBottom: 40,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyCard: {
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
  },
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardActions: {
    flexDirection: 'column',
    gap: 8,
    paddingTop: 2,
  },
  iconBtn: {
    padding: 4,
  },
  condBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  // Form
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: -6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Package item row
  itemRow: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  itemRowCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 30,
  },
  qtyInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    width: 56,
    textAlign: 'center',
  },
  // Condition dropdown
  dropdown: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: -6,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});

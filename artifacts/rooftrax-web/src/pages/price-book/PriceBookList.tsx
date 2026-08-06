import { useState, useMemo, useEffect } from "react";
import {
  useListPriceBookItems,
  useCreatePriceBookItem,
  useUpdatePriceBookItem,
  useDeletePriceBookItem,
  getListPriceBookItemsQueryKey,
  type PriceBookItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPriceBookPackages,
  useCreatePriceBookPackage,
  useUpdatePriceBookPackage,
  useDeletePriceBookPackage,
  useGenerateItemDescription,
  getPriceBookPackagesQueryKey,
  type PriceBookPackage,
  type PriceBookPackageItem,
  type InspectionCondition,
} from "@/lib/priceBookApi";
import { Shell } from "@/components/layout/Shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Edit2, Trash2, Zap, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseDollarsToCents(raw: string): number | null {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const CONDITION_OPTIONS: Array<{
  value: InspectionCondition | "none";
  label: string;
}> = [
  { value: "none", label: "None (manual selection)" },
  { value: "roof_damage", label: "Roof Damage" },
  { value: "siding_damage", label: "Siding Damage" },
  { value: "roof_and_siding_damage", label: "Roof & Siding Damage" },
];

function conditionLabel(c: InspectionCondition | null): string {
  return CONDITION_OPTIONS.find((o) => o.value === (c ?? "none"))?.label ?? "—";
}

// ---------------------------------------------------------------------------
// Item dialog
// ---------------------------------------------------------------------------

interface ItemFormState {
  editingId: string | null;
  name: string;
  description: string;
  unitPrice: string; // dollars
  unit: string;
}

const emptyItem: ItemFormState = {
  editingId: null,
  name: "",
  description: "",
  unitPrice: "",
  unit: "",
};

function ItemDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: ItemFormState;
  onSave: (state: ItemFormState) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [unitPrice, setUnitPrice] = useState(initial.unitPrice);
  const [unit, setUnit] = useState(initial.unit);
  const generateDesc = useGenerateItemDescription();

  // Sync fields whenever the dialog opens or switches to a different item.
  // useState initializers only run on first mount, so without this the fields
  // always show the values from when PriceBookList first rendered (empty).
  useEffect(() => {
    if (open) {
      setName(initial.name);
      setDescription(initial.description);
      setUnitPrice(initial.unitPrice);
      setUnit(initial.unit);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial.editingId]);

  const handleGenerate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await generateDesc.mutateAsync({
        name: trimmed,
        unit: unit.trim() || null,
      });
      setDescription(res.description);
    } catch {
      // toast is handled by caller pattern; silently ignore here
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial.editingId ? "Edit Line Item" : "Add Line Item"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Architectural Shingles"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Unit Price ($) *</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Unit</label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder='e.g. per square'
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Description</label>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={handleGenerate}
                disabled={generateDesc.isPending || !name.trim()}
                className="h-7 gap-1.5 text-xs text-orange-500 hover:text-orange-400"
              >
                {generateDesc.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                {generateDesc.isPending ? "Generating…" : "AI Generate"}
              </Button>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes about this line item"
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({ editingId: initial.editingId, name, description, unitPrice, unit })
            }
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Package dialog
// ---------------------------------------------------------------------------

interface PackageFormState {
  editingId: string | null;
  name: string;
  condition: InspectionCondition | null;
  assignments: Record<string, number>; // itemId → qty (0 = unselected)
}

const emptyPackage: PackageFormState = {
  editingId: null,
  name: "",
  condition: null,
  assignments: {},
};

function PackageDialog({
  open,
  onOpenChange,
  initial,
  items,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: PackageFormState;
  items: PriceBookItem[];
  onSave: (state: PackageFormState) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [condition, setCondition] = useState<InspectionCondition | null>(
    initial.condition,
  );
  const [assignments, setAssignments] = useState<Record<string, number>>(
    initial.assignments,
  );

  // Sync fields whenever the dialog opens or switches to a different package.
  useEffect(() => {
    if (open) {
      setName(initial.name);
      setCondition(initial.condition);
      setAssignments(initial.assignments);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial.editingId]);

  const resetKey = initial.editingId ?? "new";

  function toggle(itemId: string) {
    setAssignments((prev) =>
      prev[itemId] ? { ...prev, [itemId]: 0 } : { ...prev, [itemId]: 1 },
    );
  }

  function setQty(itemId: string, raw: string) {
    const n = parseInt(raw, 10);
    setAssignments((prev) => ({
      ...prev,
      [itemId]: isNaN(n) || n < 1 ? 1 : n,
    }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" key={resetKey}>
        <DialogHeader>
          <DialogTitle>
            {initial.editingId ? "Edit Package" : "Add Package"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Package Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Full Roofing Package"
            />
          </div>

          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Inspection Condition</label>
            <p className="text-xs text-muted-foreground -mt-1">
              When set, this package is auto-suggested for matching inspections.
            </p>
            <Select
              value={condition ?? "none"}
              onValueChange={(v) =>
                setCondition(v === "none" ? null : (v as InspectionCondition))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Line Items</label>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No line items yet. Add items first, then assign them to
                packages.
              </p>
            ) : (
              <div className="border rounded-md divide-y">
                {items.map((item) => {
                  const qty = assignments[item.id] ?? 0;
                  const selected = qty > 0;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-3 ${selected ? "bg-orange-500/5" : ""}`}
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggle(item.id)}
                        id={`pkg-item-${item.id}`}
                      />
                      <label
                        htmlFor={`pkg-item-${item.id}`}
                        className="flex-1 cursor-pointer"
                      >
                        <div className="text-sm font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          ${centsToDisplay(item.unitPrice)}
                          {item.unit ? ` / ${item.unit}` : ""}
                        </div>
                      </label>
                      {selected && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            Qty
                          </span>
                          <Input
                            type="number"
                            min="1"
                            value={qty}
                            onChange={(e) => setQty(item.id, e.target.value)}
                            className="w-16 h-7 text-sm text-center"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({ editingId: initial.editingId, name, condition, assignments })
            }
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Package
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Tab = "items" | "packages";

export function PriceBookPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("items");

  // ── Items ──────────────────────────────────────────────────────────────────
  const { data: itemsEnv, isLoading: itemsLoading } = useListPriceBookItems();
  const items = itemsEnv?.items ?? [];

  const createItem = useCreatePriceBookItem();
  const updateItem = useUpdatePriceBookItem();
  const deleteItem = useDeletePriceBookItem();

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemForm, setItemForm] = useState<ItemFormState>(emptyItem);
  const [itemSaving, setItemSaving] = useState(false);

  function openAddItem() {
    setItemForm(emptyItem);
    setItemDialogOpen(true);
  }

  function openEditItem(item: PriceBookItem) {
    setItemForm({
      editingId: item.id,
      name: item.name,
      description: item.description ?? "",
      unitPrice: centsToDisplay(item.unitPrice),
      unit: item.unit ?? "",
    });
    setItemDialogOpen(true);
  }

  async function handleSaveItem(state: ItemFormState) {
    const name = state.name.trim();
    if (!name) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const cents = parseDollarsToCents(state.unitPrice);
    if (cents === null) {
      toast({ title: "Invalid price", description: "Enter a valid price e.g. 285.00", variant: "destructive" });
      return;
    }
    setItemSaving(true);
    try {
      if (state.editingId) {
        await updateItem.mutateAsync({
          itemId: state.editingId,
          data: {
            name,
            description: state.description.trim() || null,
            unitPrice: cents,
            unit: state.unit.trim() || null,
          },
        });
        queryClient.invalidateQueries({ queryKey: getListPriceBookItemsQueryKey() });
        toast({ title: "Item updated" });
      } else {
        await createItem.mutateAsync({
          data: {
            name,
            description: state.description.trim() || null,
            unitPrice: cents,
            unit: state.unit.trim() || null,
          },
        });
        queryClient.invalidateQueries({ queryKey: getListPriceBookItemsQueryKey() });
        toast({ title: "Item created" });
      }
      setItemDialogOpen(false);
    } catch {
      toast({ title: "Save failed", description: "Could not save the item. Try again.", variant: "destructive" });
    } finally {
      setItemSaving(false);
    }
  }

  function handleDeleteItem(item: PriceBookItem) {
    if (!window.confirm(`Delete "${item.name}"? It will be removed from all packages.`)) return;
    deleteItem.mutate(
      { itemId: item.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPriceBookItemsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getPriceBookPackagesQueryKey() });
          toast({ title: "Item deleted" });
        },
        onError: () =>
          toast({ title: "Delete failed", variant: "destructive" }),
      },
    );
  }

  // ── Packages ───────────────────────────────────────────────────────────────
  const { data: packagesEnv, isLoading: packagesLoading } =
    useListPriceBookPackages();
  const packages = packagesEnv?.packages ?? [];

  const createPackage = useCreatePriceBookPackage();
  const updatePackage = useUpdatePriceBookPackage();
  const deletePackage = useDeletePriceBookPackage();

  const [pkgDialogOpen, setPkgDialogOpen] = useState(false);
  const [pkgForm, setPkgForm] = useState<PackageFormState>(emptyPackage);
  const [pkgSaving, setPkgSaving] = useState(false);

  const itemMap = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );

  function openAddPackage() {
    setPkgForm(emptyPackage);
    setPkgDialogOpen(true);
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
    setPkgDialogOpen(true);
  }

  async function handleSavePackage(state: PackageFormState) {
    const name = state.name.trim();
    if (!name) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const itemAssignments: PriceBookPackageItem[] = Object.entries(
      state.assignments,
    )
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
        toast({ title: "Package updated" });
      } else {
        await createPackage.mutateAsync({
          name,
          inspectionCondition: state.condition,
          itemAssignments,
        });
        toast({ title: "Package created" });
      }
      setPkgDialogOpen(false);
    } catch {
      toast({ title: "Save failed", description: "Could not save the package. Try again.", variant: "destructive" });
    } finally {
      setPkgSaving(false);
    }
  }

  function handleDeletePackage(pkg: PriceBookPackage) {
    if (!window.confirm(`Delete package "${pkg.name}"?`)) return;
    deletePackage.mutate(pkg.id, {
      onSuccess: () => toast({ title: "Package deleted" }),
      onError: () =>
        toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Page header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Price Book</h1>
          <p className="text-muted-foreground">
            Manage line items and packages used to build repair estimates.
          </p>
        </div>
        <Button
          onClick={tab === "items" ? openAddItem : openAddPackage}
        >
          <Plus className="mr-2 h-4 w-4" />
          {tab === "items" ? "Add Item" : "Add Package"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-6">
        {(["items", "packages"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors -mb-px ${
              tab === t
                ? "border-orange-500 text-orange-500"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "packages" ? (
              <span className="flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                Packages
              </span>
            ) : (
              "Line Items"
            )}
          </button>
        ))}
      </div>

      {/* ── Line Items tab ── */}
      {tab === "items" && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-28">Unit</TableHead>
                <TableHead className="w-32 text-right">Price</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-32 text-center text-muted-foreground"
                  >
                    Your price book is empty. Add your first line item.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-xs truncate">
                      {item.description || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.unit || "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${centsToDisplay(item.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 mr-1"
                        onClick={() => openEditItem(item)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteItem(item)}
                        disabled={deleteItem.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Packages tab ── */}
      {tab === "packages" && (
        <>
          {packagesLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : packages.length === 0 ? (
            <div className="border rounded-lg p-12 text-center text-muted-foreground">
              No packages yet. Group line items into packages and set inspection
              conditions for auto-suggestions.
            </div>
          ) : (
            <div className="grid gap-4">
              {packages.map((pkg) => {
                const total = pkg.items.reduce((sum, a) => {
                  const item = itemMap.get(a.itemId);
                  return sum + (item ? item.unitPrice * a.quantity : 0);
                }, 0);

                return (
                  <div
                    key={pkg.id}
                    className="border rounded-lg p-5 flex gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-base">
                          {pkg.name}
                        </span>
                        {pkg.inspectionCondition && (
                          <Badge variant="secondary" className="text-xs">
                            {conditionLabel(pkg.inspectionCondition)}
                          </Badge>
                        )}
                      </div>

                      {pkg.items.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No items assigned
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {pkg.items.map((a) => {
                            const item = itemMap.get(a.itemId);
                            if (!item) return null;
                            return (
                              <div
                                key={a.itemId}
                                className="text-sm text-muted-foreground flex items-baseline gap-1"
                              >
                                <span className="text-foreground/70">•</span>
                                <span>
                                  {item.name} × {a.quantity}
                                </span>
                                <span className="text-xs">
                                  (${centsToDisplay(item.unitPrice * a.quantity)})
                                </span>
                              </div>
                            );
                          })}
                          {total > 0 && (
                            <div className="text-sm font-semibold text-orange-500 pt-1">
                              Total: ${centsToDisplay(total)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-start gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditPackage(pkg)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeletePackage(pkg)}
                        disabled={deletePackage.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Dialogs */}
      <ItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        initial={itemForm}
        onSave={handleSaveItem}
        saving={itemSaving}
      />
      <PackageDialog
        open={pkgDialogOpen}
        onOpenChange={setPkgDialogOpen}
        initial={pkgForm}
        items={items}
        onSave={handleSavePackage}
        saving={pkgSaving}
      />
    </>
  );
}

export default function PriceBookList() {
  return <Shell><PriceBookPanel /></Shell>;
}

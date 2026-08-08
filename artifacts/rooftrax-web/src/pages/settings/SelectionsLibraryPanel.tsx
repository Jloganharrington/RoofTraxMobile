/**
 * SelectionsLibraryPanel — three-level drill-down catalog management.
 * Category → Brand → [Products tab | Colors tab]
 * Admin+ write; reads open to any authenticated user.
 */
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useListSelectionCategories,
  getListSelectionCategoriesQueryKey,
  useCreateSelectionCategory,
  useUpdateSelectionCategory,
  useListSelectionBrands,
  getListSelectionBrandsQueryKey,
  useCreateSelectionBrand,
  useUpdateSelectionBrand,
  useListSelectionProducts,
  getListSelectionProductsQueryKey,
  useCreateSelectionProduct,
  useUpdateSelectionProduct,
  useListSelectionOptions,
  getListSelectionOptionsQueryKey,
  useCreateSelectionOption,
  useUpdateSelectionOption,
  useDeleteSelectionOption,
  useListSelectionProductOptions,
  getListSelectionProductOptionsQueryKey,
  useCreateSelectionProductOption,
  useDeleteSelectionProductOption,
  useBulkApplySelectionOptions,
  type SelectionCategory,
  type SelectionBrand,
  type SelectionProduct,
  type SelectionOption,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Layers,
  ChevronRight,
  Plus,
  Edit2,
  Loader2,
  Star,
  Package,
  Tag,
  Building2,
  AlertTriangle,
  Palette,
  Upload,
  ImageIcon,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

function formatDelta(priceDeltaCents: number, unit: string): string {
  const dollars = (priceDeltaCents / 100).toFixed(2);
  return `+$${dollars} ${unit}`;
}

/** Convert object-storage path → fetch-able URL */
function storageUrl(path: string): string {
  return `/api/storage/objects${path.replace(/^\/objects/, "")}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Level = "categories" | "brands" | "brand_detail";
type BrandDetailTab = "products" | "colors";

interface NavState {
  level: Level;
  category: SelectionCategory | null;
  brand: SelectionBrand | null;
  brandTab: BrandDetailTab;
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

function Breadcrumb({
  nav,
  onNavigate,
}: {
  nav: NavState;
  onNavigate: (level: Level) => void;
}) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4 flex-wrap">
      <button
        type="button"
        onClick={() => onNavigate("categories")}
        className={`hover:text-foreground transition-colors ${
          nav.level === "categories"
            ? "font-semibold text-foreground"
            : "hover:underline"
        }`}
      >
        Selections Library
      </button>

      {nav.category && (
        <>
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
          <button
            type="button"
            onClick={() => onNavigate("brands")}
            className={`hover:text-foreground transition-colors ${
              nav.level === "brands"
                ? "font-semibold text-foreground"
                : "hover:underline"
            }`}
          >
            {nav.category.name}
          </button>
        </>
      )}

      {nav.brand && nav.level === "brand_detail" && (
        <>
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="font-semibold text-foreground">{nav.brand.name}</span>
        </>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Level 1 — Categories
// ---------------------------------------------------------------------------

function CategoriesView({ onSelect }: { onSelect: (cat: SelectionCategory) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListSelectionCategories();
  const categories = data?.categories ?? [];

  const createMut = useCreateSelectionCategory();
  const updateMut = useUpdateSelectionCategory();

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [editTarget, setEditTarget] = useState<SelectionCategory | null>(null);
  const [editName, setEditName] = useState("");

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListSelectionCategoriesQueryKey() });
  }

  function handleAdd() {
    const name = addName.trim();
    if (!name) return;
    createMut.mutate(
      { data: { name, slug: toSlug(name) } },
      {
        onSuccess: () => { invalidate(); setAddOpen(false); setAddName(""); toast({ title: "Category added" }); },
        onError: (err) => toast({ title: "Failed to add category", description: String(err), variant: "destructive" }),
      },
    );
  }

  function handleEdit() {
    if (!editTarget) return;
    const name = editName.trim();
    if (!name) return;
    updateMut.mutate(
      { categoryId: editTarget.id, data: { name, slug: toSlug(name) } },
      {
        onSuccess: () => { invalidate(); setEditTarget(null); toast({ title: "Category renamed" }); },
        onError: (err) => toast({ title: "Failed to rename", description: String(err), variant: "destructive" }),
      },
    );
  }

  function toggleActive(cat: SelectionCategory) {
    updateMut.mutate(
      { categoryId: cat.id, data: { isActive: !cat.isActive } },
      {
        onSuccess: () => invalidate(),
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      },
    );
  }

  if (isLoading) return (
    <div className="grid grid-cols-2 gap-3">
      {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {categories.length} {categories.length === 1 ? "category" : "categories"} · click a category to manage its brands
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />Add category
        </Button>
      </div>

      {categories.length === 0 && (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No categories yet. Add one to get started.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {categories.map((cat) => (
          <Card
            key={cat.id}
            className={`cursor-pointer hover:shadow-md transition-shadow ${!cat.isActive ? "opacity-60" : ""}`}
            onClick={() => onSelect(cat)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="font-semibold text-sm truncate">{cat.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono pl-5">{cat.slug}</p>
                  {!cat.isActive && <Badge variant="secondary" className="mt-1.5 text-[10px]">Inactive</Badge>}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              </div>
              <Separator className="my-3" />
              <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditTarget(cat); setEditName(cat.name); }}>
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Switch checked={cat.isActive} onCheckedChange={() => toggleActive(cat)} disabled={updateMut.isPending} className="scale-75 origin-right" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Add category</DialogTitle><DialogDescription>e.g. Roofing, Siding, Gutters, Interior</DialogDescription></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">Name</Label>
              <Input id="cat-name" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Siding" maxLength={120} onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
            </div>
            {addName && <p className="text-[11px] text-muted-foreground font-mono">slug: {toSlug(addName)}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!addName.trim() || createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Rename category</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cat-edit-name">Name</Label>
              <Input id="cat-edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={120} onKeyDown={(e) => e.key === "Enter" && handleEdit()} />
            </div>
            {editName && <p className="text-[11px] text-muted-foreground font-mono">slug: {toSlug(editName)}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={!editName.trim() || updateMut.isPending}>
              {updateMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level 2 — Brands within a category
// ---------------------------------------------------------------------------

function BrandsView({ category, onSelect }: { category: SelectionCategory; onSelect: (brand: SelectionBrand) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryParams = { categoryId: category.id };
  const { data, isLoading } = useListSelectionBrands(queryParams);
  const brands = data?.brands ?? [];

  const createMut = useCreateSelectionBrand();
  const updateMut = useUpdateSelectionBrand();

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [editTarget, setEditTarget] = useState<SelectionBrand | null>(null);
  const [editName, setEditName] = useState("");

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListSelectionBrandsQueryKey(queryParams) });
  }

  function handleAdd() {
    const name = addName.trim();
    if (!name) return;
    createMut.mutate(
      { data: { categoryId: category.id, name } },
      {
        onSuccess: () => { invalidate(); setAddOpen(false); setAddName(""); toast({ title: "Brand added" }); },
        onError: (err) => toast({ title: "Failed to add brand", description: String(err), variant: "destructive" }),
      },
    );
  }

  function handleEdit() {
    if (!editTarget) return;
    updateMut.mutate(
      { brandId: editTarget.id, data: { name: editName.trim() } },
      {
        onSuccess: () => { invalidate(); setEditTarget(null); toast({ title: "Brand renamed" }); },
        onError: (err) => toast({ title: "Failed to rename", description: String(err), variant: "destructive" }),
      },
    );
  }

  function toggleActive(brand: SelectionBrand) {
    updateMut.mutate(
      { brandId: brand.id, data: { isActive: !brand.isActive } },
      {
        onSuccess: () => invalidate(),
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      },
    );
  }

  if (isLoading) return (
    <div className="grid grid-cols-2 gap-3">
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {brands.length} {brands.length === 1 ? "brand" : "brands"} in{" "}
          <span className="font-medium text-foreground">{category.name}</span>{" "}
          · click a brand to manage its products and colors
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />Add brand
        </Button>
      </div>

      {brands.length === 0 && (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No brands yet. Add a brand to start building this category's catalog.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {brands.map((brand) => (
          <Card
            key={brand.id}
            className={`cursor-pointer hover:shadow-md transition-shadow ${!brand.isActive ? "opacity-60" : ""}`}
            onClick={() => onSelect(brand)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="font-semibold text-sm truncate">{brand.name}</span>
                  </div>
                  {!brand.isActive && <Badge variant="secondary" className="mt-1.5 text-[10px]">Inactive</Badge>}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              </div>
              <Separator className="my-3" />
              <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditTarget(brand); setEditName(brand.name); }}>
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Switch checked={brand.isActive} onCheckedChange={() => toggleActive(brand)} disabled={updateMut.isPending} className="scale-75 origin-right" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Add brand to {category.name}</DialogTitle><DialogDescription>e.g. Mastic, CertainTeed, Owens Corning, GAF</DialogDescription></DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="brand-name">Brand name</Label>
            <Input id="brand-name" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Mastic" maxLength={120} onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!addName.trim() || createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Rename brand</DialogTitle></DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="brand-edit-name">Name</Label>
            <Input id="brand-edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={120} onKeyDown={(e) => e.key === "Enter" && handleEdit()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={!editName.trim() || updateMut.isPending}>
              {updateMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level 3a — Products (tiers) within a brand
// ---------------------------------------------------------------------------

interface ProductFormState {
  name: string;
  description: string;
  unit: string;
  isBase: boolean;
  priceDeltaDollars: string;
  sortOrder: string;
}

const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: "", description: "", unit: "per square",
  isBase: false, priceDeltaDollars: "0.00", sortOrder: "0",
};

function ProductsTab({ category, brand }: { category: SelectionCategory; brand: SelectionBrand }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryParams = { brandId: brand.id };
  const { data, isLoading } = useListSelectionProducts(queryParams);
  const products = data?.products ?? [];

  const createMut = useCreateSelectionProduct();
  const updateMut = useUpdateSelectionProduct();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<SelectionProduct | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [baseWarnOpen, setBaseWarnOpen] = useState(false);
  const [pendingForm, setPendingForm] = useState<ProductFormState | null>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListSelectionProductsQueryKey(queryParams) });
  }

  function patchField<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function parseDeltaCents(raw: string, isBase: boolean): number | null {
    if (isBase) return 0;
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }

  function submitForm(f: ProductFormState) {
    const priceDeltaCents = parseDeltaCents(f.priceDeltaDollars, f.isBase);
    if (priceDeltaCents === null) { toast({ title: "Invalid price delta", variant: "destructive" }); return; }
    const sortOrder = parseInt(f.sortOrder, 10);

    if (editProduct) {
      updateMut.mutate(
        { productId: editProduct.id, data: { name: f.name.trim(), description: f.description.trim() || null, unit: f.unit.trim(), isBase: f.isBase, priceDeltaCents, sortOrder: isNaN(sortOrder) ? 0 : sortOrder } },
        {
          onSuccess: () => { invalidate(); setDialogOpen(false); toast({ title: "Product saved" }); },
          onError: (err) => toast({ title: "Failed to save", description: String(err), variant: "destructive" }),
        },
      );
    } else {
      createMut.mutate(
        { data: { categoryId: category.id, brandId: brand.id, name: f.name.trim(), description: f.description.trim() || undefined, unit: f.unit.trim(), isBase: f.isBase, priceDeltaCents, sortOrder: isNaN(sortOrder) ? 0 : sortOrder } },
        {
          onSuccess: () => { invalidate(); setDialogOpen(false); toast({ title: "Product added" }); },
          onError: (err) => toast({ title: "Failed to add", description: String(err), variant: "destructive" }),
        },
      );
    }
  }

  function handleSave() {
    const hasExistingBase = products.some((p) => p.isBase && (!editProduct || p.id !== editProduct.id));
    if (form.isBase && hasExistingBase) { setPendingForm(form); setBaseWarnOpen(true); return; }
    submitForm(form);
  }

  function toggleActive(p: SelectionProduct) {
    updateMut.mutate(
      { productId: p.id, data: { isActive: !p.isActive } },
      { onSuccess: () => invalidate(), onError: () => toast({ title: "Failed to update", variant: "destructive" }) },
    );
  }

  const isPending = createMut.isPending || updateMut.isPending;

  if (isLoading) return (
    <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-md" />)}</div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {products.length} {products.length === 1 ? "product" : "products"} under{" "}
            <span className="font-medium text-foreground">{brand.name}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Exactly one product per category is the Category Base — all others price their delta relative to it.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditProduct(null); setForm(EMPTY_PRODUCT_FORM); setDialogOpen(true); }} className="flex-shrink-0">
          <Plus className="h-3.5 w-3.5 mr-1.5" />Add product
        </Button>
      </div>

      {products.length === 0 && (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No products yet. Add a tier to get started.
        </div>
      )}

      <div className="space-y-2">
        {products.map((p) => (
          <div key={p.id} className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${!p.isActive ? "opacity-60 bg-muted/30" : "bg-background"}`}>
            <div className="w-5 flex-shrink-0 flex justify-center">
              {p.isBase
                ? <Star className="h-4 w-4 text-amber-500 fill-amber-500" aria-label="Category Base" />
                : <Package className="h-4 w-4 text-muted-foreground" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{p.name}</span>
                {p.isBase && (
                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400">
                    Category Base — {category.name}
                  </Badge>
                )}
                {!p.isActive && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
              </div>
              {p.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{p.description}</p>}
            </div>
            <div className="text-right flex-shrink-0 min-w-[110px]">
              {p.isBase
                ? <span className="text-sm text-muted-foreground">Base · $0 {p.unit}</span>
                : <span className="text-sm font-medium text-green-700 dark:text-green-400">{formatDelta(p.priceDeltaCents, p.unit)}</span>}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditProduct(p); setForm({ name: p.name, description: p.description ?? "", unit: p.unit, isBase: p.isBase, priceDeltaDollars: (p.priceDeltaCents / 100).toFixed(2), sortOrder: String(p.sortOrder) }); setDialogOpen(true); }}>
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Switch checked={p.isActive} onCheckedChange={() => toggleActive(p)} disabled={updateMut.isPending} className="scale-75" />
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editProduct ? `Edit "${editProduct.name}"` : "Add product / tier"}</DialogTitle>
            <DialogDescription>{brand.name} · {category.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prod-name">Name</Label>
              <Input id="prod-name" value={form.name} onChange={(e) => patchField("name", e.target.value)} placeholder="e.g. Quest, Pinnacle, Standard 3-Tab" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prod-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea id="prod-desc" value={form.description} onChange={(e) => patchField("description", e.target.value)} placeholder="Brief notes shown to reps…" className="min-h-[70px] resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prod-unit">Unit of measure</Label>
              <Input id="prod-unit" value={form.unit} onChange={(e) => patchField("unit", e.target.value)} placeholder="per square" maxLength={60} />
              <p className="text-[11px] text-muted-foreground">e.g. "per square", "per LF", "per window"</p>
            </div>
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Switch id="prod-base" checked={form.isBase} onCheckedChange={(v) => { patchField("isBase", v); if (v) patchField("priceDeltaDollars", "0.00"); }} />
              <div>
                <Label htmlFor="prod-base" className="cursor-pointer">Category Base product</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The insurance-covered option for the entire <span className="font-medium">{category.name}</span> category — across all brands. Price delta must be $0.
                </p>
              </div>
            </div>
            {!form.isBase && (
              <div className="space-y-1.5">
                <Label htmlFor="prod-delta">Price delta above base</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">+$</span>
                  <Input id="prod-delta" type="number" min="0" step="0.01" value={form.priceDeltaDollars} onChange={(e) => patchField("priceDeltaDollars", e.target.value)} className="max-w-[120px]" />
                  <span className="text-sm text-muted-foreground">{form.unit}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Homeowner pays this amount per unit above the base product.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="prod-sort">Sort order</Label>
              <Input id="prod-sort" type="number" value={form.sortOrder} onChange={(e) => patchField("sortOrder", e.target.value)} className="max-w-[80px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || !form.unit.trim() || isPending}>
              {isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {editProduct ? "Save changes" : "Add product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Base-change confirmation */}
      <AlertDialog open={baseWarnOpen} onOpenChange={setBaseWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />Change the Category Base?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{category.name}</strong> already has a base product. Setting{" "}
              <strong>{form.name || "this product"}</strong> as the new base will clear the existing base and
              re-price every product in <strong>{category.name}</strong> — across all brands — relative to this one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingForm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingForm) submitForm(pendingForm); setPendingForm(null); setBaseWarnOpen(false); }} className="bg-amber-600 hover:bg-amber-700 text-white">
              Set as category base
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swatch chip — used in the color grid and availability matrix
// ---------------------------------------------------------------------------

function SwatchChip({ option, size = "md" }: { option: SelectionOption; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-5 w-5" : "h-9 w-9";
  if (option.swatchHex) {
    return (
      <span
        className={`${dim} rounded-full border border-black/10 flex-shrink-0 block`}
        style={{ backgroundColor: option.swatchHex }}
        title={option.swatchHex}
      />
    );
  }
  if (option.swatchImagePath) {
    return (
      <img
        src={storageUrl(option.swatchImagePath)}
        alt={option.name}
        className={`${dim} rounded-full border border-black/10 object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <span className={`${dim} rounded-full border border-dashed flex-shrink-0 flex items-center justify-center`}>
      <ImageIcon className="h-3 w-3 text-muted-foreground" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// HOA badge
// ---------------------------------------------------------------------------

function HoaBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) return <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 bg-green-50 dark:bg-green-950/30 dark:text-green-400 gap-0.5"><CheckCircle2 className="h-2.5 w-2.5" />HOA OK</Badge>;
  if (value === false) return <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-400 gap-0.5"><XCircle className="h-2.5 w-2.5" />Not HOA</Badge>;
  return null;
}

// ---------------------------------------------------------------------------
// Level 3b — Colors & Availability within a brand
// ---------------------------------------------------------------------------

interface OptionFormState {
  name: string;
  optionGroup: string;
  swatchType: "hex" | "image";
  swatchHex: string;
  swatchImagePath: string;
  hoaCompliant: "true" | "false" | "unknown";
  sortOrder: string;
}

const EMPTY_OPTION_FORM: OptionFormState = {
  name: "", optionGroup: "", swatchType: "hex", swatchHex: "#cccccc",
  swatchImagePath: "", hoaCompliant: "unknown", sortOrder: "0",
};

function ColorsTab({ brand }: { brand: SelectionBrand }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const optionsParams = { brandId: brand.id };
  const { data: optData, isLoading: loadingOptions } = useListSelectionOptions(optionsParams);
  const options = optData?.options ?? [];

  const { data: prodData, isLoading: loadingProds } = useListSelectionProducts({ brandId: brand.id });
  const products = (prodData?.products ?? []).filter((p) => p.isActive);

  // Fetch all product-options (company-scoped by auth); filter client-side to this brand's products.
  const { data: poData, isLoading: loadingPO } = useListSelectionProductOptions();
  const brandProductIds = new Set(products.map((p) => p.id));
  const productOptions = (poData?.productOptions ?? []).filter((po) => brandProductIds.has(po.productId));

  // Build lookup: `${productId}:${optionId}` → mapping id
  const poMap = new Map<string, string>();
  for (const po of productOptions) {
    poMap.set(`${po.productId}:${po.optionId}`, po.id);
  }

  const createOptMut = useCreateSelectionOption();
  const updateOptMut = useUpdateSelectionOption();
  const deleteOptMut = useDeleteSelectionOption();
  const createPoMut = useCreateSelectionProductOption();
  const deletePoMut = useDeleteSelectionProductOption();
  const bulkMut = useBulkApplySelectionOptions();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOption, setEditOption] = useState<SelectionOption | null>(null);
  const [form, setForm] = useState<OptionFormState>(EMPTY_OPTION_FORM);
  const [uploading, setUploading] = useState(false);

  function invalidateOptions() {
    qc.invalidateQueries({ queryKey: getListSelectionOptionsQueryKey(optionsParams) });
  }
  function invalidatePO() {
    qc.invalidateQueries({ queryKey: getListSelectionProductOptionsQueryKey() });
  }

  function patchOF<K extends keyof OptionFormState>(key: K, value: OptionFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openAdd() {
    setEditOption(null);
    setForm(EMPTY_OPTION_FORM);
    setDialogOpen(true);
  }

  function openEdit(opt: SelectionOption) {
    setEditOption(opt);
    setForm({
      name: opt.name,
      optionGroup: opt.optionGroup ?? "",
      swatchType: opt.swatchImagePath ? "image" : "hex",
      swatchHex: opt.swatchHex ?? "#cccccc",
      swatchImagePath: opt.swatchImagePath ?? "",
      hoaCompliant: opt.hoaCompliant === true ? "true" : opt.hoaCompliant === false ? "false" : "unknown",
      sortOrder: String(opt.sortOrder),
    });
    setDialogOpen(true);
  }

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast({ title: "Please select an image file", variant: "destructive" }); return; }
    if (file.size > 5 * 1024 * 1024) { toast({ title: "Image must be under 5 MB", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
        "/api/storage/uploads/request-url",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }) },
      );
      const putRes = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!putRes.ok) throw new Error(`Storage PUT failed: ${putRes.status}`);
      patchOF("swatchImagePath", objectPath);
      toast({ title: "Swatch image uploaded" });
    } catch (err) {
      toast({ title: "Upload failed", description: String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [toast]);

  function buildOptionPayload(f: OptionFormState) {
    const hoaCompliant = f.hoaCompliant === "true" ? true : f.hoaCompliant === "false" ? false : null;
    const sortOrder = parseInt(f.sortOrder, 10);
    const swatchHex = f.swatchType === "hex" ? f.swatchHex : null;
    const swatchImagePath = f.swatchType === "image" && f.swatchImagePath ? f.swatchImagePath : null;
    return { name: f.name.trim(), optionGroup: f.optionGroup.trim() || null, swatchHex, swatchImagePath, hoaCompliant, sortOrder: isNaN(sortOrder) ? 0 : sortOrder };
  }

  function handleSaveOption() {
    const payload = buildOptionPayload(form);
    if (!payload.swatchHex && !payload.swatchImagePath) {
      toast({ title: "A swatch colour or image is required", variant: "destructive" });
      return;
    }
    if (editOption) {
      updateOptMut.mutate(
        { optionId: editOption.id, data: payload },
        {
          onSuccess: () => { invalidateOptions(); setDialogOpen(false); toast({ title: "Colour saved" }); },
          onError: (err) => toast({ title: "Failed to save", description: String(err), variant: "destructive" }),
        },
      );
    } else {
      createOptMut.mutate(
        { data: { brandId: brand.id, ...payload } },
        {
          onSuccess: () => { invalidateOptions(); setDialogOpen(false); toast({ title: "Colour added" }); },
          onError: (err) => toast({ title: "Failed to add", description: String(err), variant: "destructive" }),
        },
      );
    }
  }

  function toggleAvailability(productId: string, optionId: string) {
    const key = `${productId}:${optionId}`;
    const mappingId = poMap.get(key);
    if (mappingId) {
      deletePoMut.mutate(
        { id: mappingId },
        { onSuccess: () => invalidatePO(), onError: () => toast({ title: "Failed to remove", variant: "destructive" }) },
      );
    } else {
      createPoMut.mutate(
        { data: { productId, optionId } },
        { onSuccess: () => invalidatePO(), onError: () => toast({ title: "Failed to add", variant: "destructive" }) },
      );
    }
  }

  function handleBulkApply(optionId: string) {
    bulkMut.mutate(
      { data: { brandId: brand.id, optionIds: [optionId] } },
      {
        onSuccess: (res) => {
          invalidatePO();
          const created = res.created ?? 0;
          toast({ title: created > 0 ? `Applied to ${created} product${created === 1 ? "" : "s"}` : "Already applied to all products" });
        },
        onError: () => toast({ title: "Bulk apply failed", variant: "destructive" }),
      },
    );
  }

  function toggleOptionActive(opt: SelectionOption) {
    updateOptMut.mutate(
      { optionId: opt.id, data: { isActive: !opt.isActive } },
      { onSuccess: () => invalidateOptions(), onError: () => toast({ title: "Failed to update", variant: "destructive" }) },
    );
  }

  // Group options by optionGroup
  const grouped = options.reduce<Record<string, SelectionOption[]>>((acc, opt) => {
    const g = opt.optionGroup ?? "";
    if (!acc[g]) acc[g] = [];
    acc[g].push(opt);
    return acc;
  }, {});
  const groups = Object.keys(grouped).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

  const isPending = createOptMut.isPending || updateOptMut.isPending;
  const isLoading = loadingOptions || loadingProds || loadingPO;

  if (isLoading) return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-4 gap-2">{[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── Colour palette ───────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Colour palette</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {options.length} {options.length === 1 ? "colour" : "colours"} · grouped as the manufacturer publishes them
            </p>
          </div>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add colour
          </Button>
        </div>

        {options.length === 0 && (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            No colours yet. Add some to populate this brand's palette.
          </div>
        )}

        {groups.map((group) => (
          <div key={group || "__ungrouped__"} className="space-y-2">
            {group && (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(grouped[group] ?? []).map((opt) => (
                <div
                  key={opt.id}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${!opt.isActive ? "opacity-60 bg-muted/30" : "bg-background"}`}
                >
                  <SwatchChip option={opt} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{opt.name}</p>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <HoaBadge value={opt.hoaCompliant} />
                      {!opt.isActive && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEdit(opt)}>
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Switch checked={opt.isActive} onCheckedChange={() => toggleOptionActive(opt)} disabled={updateOptMut.isPending} className="scale-[0.65] origin-right" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Availability matrix ──────────────────────────────────────── */}
      {options.length > 0 && products.length > 0 && (
        <div className="space-y-3">
          <Separator />
          <div>
            <p className="text-sm font-medium">Availability per tier</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Check which tiers each colour is available on. "Apply to all tiers" adds it to every product in this brand at once.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground py-2 pr-3 min-w-[160px]">Colour</th>
                  {products.map((p) => (
                    <th key={p.id} className="text-center text-xs font-medium text-muted-foreground py-2 px-2 min-w-[100px]">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="truncate max-w-[88px]">{p.name}</span>
                        {p.isBase && <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />}
                      </div>
                    </th>
                  ))}
                  <th className="text-center text-xs font-medium text-muted-foreground py-2 px-2 min-w-[90px]">All tiers</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((group) =>
                  [
                    group ? (
                      <tr key={`g-${group}`}>
                        <td colSpan={products.length + 2} className="pt-3 pb-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                        </td>
                      </tr>
                    ) : null,
                    ...(grouped[group] ?? []).filter((opt) => opt.isActive).map((opt) => (
                      <tr key={opt.id} className="hover:bg-muted/30">
                        <td className="py-1.5 pr-3">
                          <div className="flex items-center gap-2">
                            <SwatchChip option={opt} size="sm" />
                            <span className="text-sm truncate max-w-[120px]">{opt.name}</span>
                          </div>
                        </td>
                        {products.map((p) => {
                          const checked = poMap.has(`${p.id}:${opt.id}`);
                          return (
                            <td key={p.id} className="py-1.5 px-2 text-center">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleAvailability(p.id, opt.id)}
                                disabled={createPoMut.isPending || deletePoMut.isPending}
                                aria-label={`${opt.name} available on ${p.name}`}
                              />
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-2 text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground"
                            onClick={() => handleBulkApply(opt.id)}
                            disabled={bulkMut.isPending}
                          >
                            <Zap className="h-3 w-3" />All
                          </Button>
                        </td>
                      </tr>
                    )),
                  ].filter(Boolean)
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {options.length > 0 && products.length === 0 && (
        <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Add at least one product in the <strong>Products</strong> tab to configure availability.
        </div>
      )}

      {/* Add / Edit option dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              {editOption ? `Edit "${editOption.name}"` : "Add colour"}
            </DialogTitle>
            <DialogDescription>{brand.name} colour palette</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="opt-name">Colour name</Label>
              <Input id="opt-name" value={form.name} onChange={(e) => patchOF("name", e.target.value)} placeholder="e.g. Cedar Tan, Classic White" maxLength={120} />
            </div>

            {/* Group */}
            <div className="space-y-1.5">
              <Label htmlFor="opt-group">Group <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="opt-group" value={form.optionGroup} onChange={(e) => patchOF("optionGroup", e.target.value)} placeholder="e.g. Light, Deep, Cedar Colors" maxLength={80} />
              <p className="text-[11px] text-muted-foreground">Groups colours as manufacturers publish them — e.g. "Light Neutrals", "Deep Tones".</p>
            </div>

            {/* Swatch type toggle */}
            <div className="space-y-2">
              <Label>Swatch</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={form.swatchType === "hex" ? "default" : "outline"}
                  onClick={() => patchOF("swatchType", "hex")}
                  type="button"
                >
                  Hex colour
                </Button>
                <Button
                  size="sm"
                  variant={form.swatchType === "image" ? "default" : "outline"}
                  onClick={() => patchOF("swatchType", "image")}
                  type="button"
                >
                  Texture / image
                </Button>
              </div>

              {form.swatchType === "hex" && (
                <div className="flex items-center gap-3 mt-2">
                  <input
                    type="color"
                    value={form.swatchHex}
                    onChange={(e) => patchOF("swatchHex", e.target.value)}
                    className="h-10 w-14 rounded border cursor-pointer p-0.5"
                  />
                  <Input
                    value={form.swatchHex}
                    onChange={(e) => patchOF("swatchHex", e.target.value)}
                    placeholder="#RRGGBB"
                    maxLength={7}
                    className="font-mono max-w-[110px]"
                  />
                  <div
                    className="h-9 w-9 rounded-full border border-black/10 flex-shrink-0"
                    style={{ backgroundColor: form.swatchHex }}
                  />
                </div>
              )}

              {form.swatchType === "image" && (
                <div className="flex items-center gap-3 mt-2">
                  {form.swatchImagePath ? (
                    <img
                      src={storageUrl(form.swatchImagePath)}
                      alt="Swatch preview"
                      className="h-10 w-10 rounded-full border object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full border border-dashed flex items-center justify-center">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded hover:bg-muted transition-colors">
                      {uploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Uploading…</> : <><Upload className="h-3.5 w-3.5" />{form.swatchImagePath ? "Replace" : "Upload"}</>}
                    </span>
                    <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={handleImageUpload} />
                  </label>
                  {form.swatchImagePath && (
                    <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={() => patchOF("swatchImagePath", "")}>Remove</Button>
                  )}
                </div>
              )}
            </div>

            {/* HOA */}
            <div className="space-y-1.5">
              <Label htmlFor="opt-hoa">HOA compliance</Label>
              <Select value={form.hoaCompliant} onValueChange={(v) => patchOF("hoaCompliant", v as OptionFormState["hoaCompliant"])}>
                <SelectTrigger id="opt-hoa" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown"><span className="flex items-center gap-1.5"><HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />Unknown</span></SelectItem>
                  <SelectItem value="true"><span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />HOA compliant</span></SelectItem>
                  <SelectItem value="false"><span className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-red-500" />Not HOA compliant</span></SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sort order */}
            <div className="space-y-1.5">
              <Label htmlFor="opt-sort">Sort order</Label>
              <Input id="opt-sort" type="number" value={form.sortOrder} onChange={(e) => patchOF("sortOrder", e.target.value)} className="max-w-[80px]" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isPending || uploading}>Cancel</Button>
            <Button onClick={handleSaveOption} disabled={!form.name.trim() || isPending || uploading}>
              {(isPending || uploading) && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {editOption ? "Save changes" : "Add colour"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand detail — Products / Colors tab container
// ---------------------------------------------------------------------------

function BrandDetailView({
  category,
  brand,
  activeTab,
  onTabChange,
}: {
  category: SelectionCategory;
  brand: SelectionBrand;
  activeTab: BrandDetailTab;
  onTabChange: (tab: BrandDetailTab) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b pb-0">
        {(["products", "colors"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "products" ? "Products / Tiers" : "Colors & Availability"}
          </button>
        ))}
      </div>

      {activeTab === "products" && <ProductsTab category={category} brand={brand} />}
      {activeTab === "colors" && <ColorsTab brand={brand} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root panel
// ---------------------------------------------------------------------------

export function SelectionsLibraryPanel() {
  const [nav, setNav] = useState<NavState>({
    level: "categories",
    category: null,
    brand: null,
    brandTab: "products",
  });

  function drillToCategory(cat: SelectionCategory) {
    setNav({ level: "brands", category: cat, brand: null, brandTab: "products" });
  }

  function drillToBrand(brand: SelectionBrand) {
    setNav((prev) => ({ ...prev, level: "brand_detail", brand, brandTab: "products" }));
  }

  function navigateTo(level: Level) {
    if (level === "categories") {
      setNav({ level: "categories", category: null, brand: null, brandTab: "products" });
    } else if (level === "brands") {
      setNav((prev) => ({ ...prev, level: "brands", brand: null }));
    }
  }

  function onTabChange(tab: BrandDetailTab) {
    setNav((prev) => ({ ...prev, brandTab: tab }));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            Selections Library
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Breadcrumb nav={nav} onNavigate={navigateTo} />

          {nav.level === "categories" && (
            <CategoriesView onSelect={drillToCategory} />
          )}

          {nav.level === "brands" && nav.category && (
            <BrandsView category={nav.category} onSelect={drillToBrand} />
          )}

          {nav.level === "brand_detail" && nav.category && nav.brand && (
            <BrandDetailView
              category={nav.category}
              brand={nav.brand}
              activeTab={nav.brandTab}
              onTabChange={onTabChange}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

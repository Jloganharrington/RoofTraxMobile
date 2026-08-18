/**
 * /pp/new/:id/estimate — Stage 5: Upload-path estimate builder
 *
 * Shows the company's price book. The contractor selects items with quantities
 * to build the scope of work. Lines are saved to the inspection's
 * propertyProfile.ppEstimateLines and appear in Section 10 of the compiled
 * proof package. This step is skippable (navigate straight to wizard).
 */
import { useState, useEffect, useCallback } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  ArrowLeft, ArrowRight, Plus, Trash2, Loader2, BookOpen,
  ChevronDown, ChevronUp,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PriceBookItem {
  id: string;
  name: string;
  description: string;
  unit: string;
  unitPrice: number; // cents
}

interface EstimateLine {
  id: string;               // client UUID
  name: string;
  description: string;
  unit: string;
  unitPrice: number;        // cents
  quantity: number;
  priceBookItemId?: string;
}

// ---------------------------------------------------------------------------
// PP fetch helper
// ---------------------------------------------------------------------------

async function ppFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function uuid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dollarsToCents(d: number): number {
  return Math.round(d * 100);
}
function centsToDollars(c: number): number {
  return c / 100;
}
function formatUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
}

// ---------------------------------------------------------------------------
// Catalog item card
// ---------------------------------------------------------------------------

function CatalogItem({
  item,
  onAdd,
}: {
  item: PriceBookItem;
  onAdd: (item: PriceBookItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-100 leading-tight">{item.name}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {item.unitPrice > 0 ? formatUSD(item.unitPrice) : 'Price TBD'} / {item.unit}
          </p>
          {expanded && (
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed whitespace-pre-line">
              {item.description}
            </p>
          )}
          {item.description && (
            <button
              type="button"
              onClick={() => setExpanded((p) => !p)}
              className="mt-1 flex items-center gap-0.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Less' : 'More'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onAdd(item)}
          className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estimate line row
// ---------------------------------------------------------------------------

function LineRow({
  line,
  onChange,
  onRemove,
}: {
  line: EstimateLine;
  onChange: (id: string, updates: Partial<EstimateLine>) => void;
  onRemove: (id: string) => void;
}) {
  const lineTotal = line.unitPrice * line.quantity;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-100 leading-tight">{line.name}</p>
        <button
          type="button"
          onClick={() => onRemove(line.id)}
          className="flex-shrink-0 p-1 text-zinc-600 hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Unit price */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Unit Price
          </label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-zinc-700 bg-zinc-950 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
              value={centsToDollars(line.unitPrice)}
              onChange={(e) =>
                onChange(line.id, { unitPrice: dollarsToCents(parseFloat(e.target.value) || 0) })
              }
            />
          </div>
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Qty ({line.unit})
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-950 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
            value={line.quantity}
            onChange={(e) =>
              onChange(line.id, { quantity: parseFloat(e.target.value) || 0 })
            }
          />
        </div>

        {/* Line total */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Total
          </label>
          <p className="py-1.5 text-sm font-semibold text-zinc-100">
            {formatUSD(Math.round(lineTotal))}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EstimatePage() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const inspectionId = params.id ?? '';

  const [catalogItems, setCatalogItems] = useState<PriceBookItem[]>([]);
  const [lines, setLines] = useState<EstimateLine[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load catalog + any saved estimate lines
  useEffect(() => {
    if (!inspectionId) return;
    setLoadingCatalog(true);
    Promise.all([
      ppFetch<{ items: PriceBookItem[] }>('/api/pp/price-book'),
      ppFetch<{ lines: EstimateLine[] }>(`/api/pp/inspections/${inspectionId}/estimate`),
    ])
      .then(([catalog, saved]) => {
        setCatalogItems(catalog.items);
        setLines(saved.lines ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingCatalog(false));
  }, [inspectionId]);

  const addFromCatalog = useCallback((item: PriceBookItem) => {
    setLines((prev) => [
      ...prev,
      {
        id: uuid(),
        name: item.name,
        description: item.description,
        unit: item.unit,
        unitPrice: item.unitPrice,
        quantity: 1,
        priceBookItemId: item.id,
      },
    ]);
  }, []);

  const updateLine = useCallback((id: string, updates: Partial<EstimateLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const grandTotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  const handleContinue = async () => {
    setSaving(true);
    setError(null);
    try {
      await ppFetch(`/api/pp/inspections/${inspectionId}/estimate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
      navigate(`/pp/wizard/${inspectionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save estimate.');
      setSaving(false);
    }
  };

  const handleSkip = () => {
    navigate(`/pp/wizard/${inspectionId}`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium mb-3">
          <span className="bg-orange-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">5</span>
          Step 5 of 10 — Scope of Work &amp; Pricing
        </div>
        <h1 className="text-2xl font-bold text-white">Estimate Builder</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Add line items from your price book. Quantities and prices appear in Section 10 of
          the compiled proof package.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loadingCatalog ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Left: catalog */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
              <BookOpen className="h-4 w-4 text-orange-400" />
              Price Book ({catalogItems.length})
            </div>
            {catalogItems.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-500">
                No items in your price book yet.
              </div>
            ) : (
              catalogItems.map((item) => (
                <CatalogItem key={item.id} item={item} onAdd={addFromCatalog} />
              ))
            )}
          </div>

          {/* Right: selected lines */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-300">
                Estimate ({lines.length} {lines.length === 1 ? 'line' : 'lines'})
              </p>
              {lines.length > 0 && (
                <p className="text-sm font-bold text-white">{formatUSD(Math.round(grandTotal))}</p>
              )}
            </div>

            {lines.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 px-4 py-8 text-center text-sm text-zinc-500">
                Add items from your price book to build the estimate.
              </div>
            ) : (
              lines.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  onChange={updateLine}
                  onRemove={removeLine}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
        <button
          type="button"
          onClick={() => navigate(`/pp/new/intake`)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSkip}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors px-3 py-2"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {saving ? 'Saving…' : 'Continue to Wizard'}
          </button>
        </div>
      </div>
    </div>
  );
}

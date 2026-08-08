/**
 * ContractBuilderTab — rep-facing contract creation & management.
 *
 * API surface (all authenticated, same-company scoped):
 *   GET    /api/pins/:pinId/contracts
 *   POST   /api/pins/:pinId/contracts
 *   PATCH  /api/contracts/:contractId
 *   POST   /api/contracts/:contractId/scope-packages
 *   PATCH  /api/contracts/:contractId/scope-packages/:pkgId
 *   DELETE /api/contracts/:contractId/scope-packages/:pkgId
 *   POST   /api/contracts/:contractId/send
 *   POST   /api/contracts/:contractId/generate-document
 *   POST   /api/contracts/:contractId/void
 *   GET    /api/selections/categories  (for the add-package dropdown)
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import {
  Plus, Send, FileText, Trash2, Loader2, Shield, CheckCircle,
  AlertTriangle, Ban, ChevronDown, ChevronUp, Edit2, Copy, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────────────

interface Selection {
  id: string;
  productId: string;
  optionId: string | null;
  productName: string;
  brandName: string;
  optionName: string | null;
  unitDeltaCents: number;
  quantity: string;
  extendedDeltaCents: number;
  selectedBy: string;
}

interface ScopePackage {
  id: string;
  categoryId: string;
  categoryName: string;
  quantity: string;
  unit: string;
  coveredAmountCents: number;
  sortOrder: number;
  selection: Selection | null;
}

interface Contract {
  id: string;
  status: string;
  accessCode: string | null;
  sentAt: string | null;
  coveredScopeCents: number;
  bettermentsCents: number;
  deductibleCents: number;
  totalContractCents: number;
  scopeSummary: string | null;
  scopeSource: string | null;
  documentObjectPath: string | null;
  customerSignedAt: string | null;
  customerPrintName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  scopePackages: ScopePackage[];
}

interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function parseCents(s: string): number {
  const n = parseFloat(s.replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    draft:  { label: 'Draft',   className: 'bg-muted text-muted-foreground' },
    sent:   { label: 'Sent',    className: 'bg-blue-100 text-blue-800' },
    signed: { label: 'Signed',  className: 'bg-green-100 text-green-800' },
    voided: { label: 'Voided',  className: 'bg-red-100 text-red-700' },
  };
  const s = map[status] ?? { label: status, className: 'bg-muted text-muted-foreground' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}

// ── Create Contract Form ──────────────────────────────────────────────────────

function CreateContractForm({ pinId, onCreated }: { pinId: string; onCreated: () => void }) {
  const [coveredScope, setCoveredScope] = useState('');
  const [deductible, setDeductible] = useState('');
  const [summary, setSummary] = useState('');
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (body: object) =>
      customFetch(`/api/pins/${pinId}/contracts`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts', pinId] });
      toast.success('Contract created');
      onCreated();
    },
    onError: () => toast.error('Could not create contract'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMut.mutate({
      coveredScopeCents: parseCents(coveredScope),
      deductibleCents:   parseCents(deductible),
      scopeSummary:      summary.trim() || undefined,
      scopeSource:       'manual',
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-5 border rounded-xl bg-card">
      <h3 className="text-sm font-semibold">New Contract</h3>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Covered Scope ($)</label>
          <input
            type="text"
            value={coveredScope}
            onChange={(e) => setCoveredScope(e.target.value)}
            placeholder="0.00"
            className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Deductible ($)</label>
          <input
            type="text"
            value={deductible}
            onChange={(e) => setDeductible(e.target.value)}
            placeholder="0.00"
            className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Scope Summary (optional)</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          placeholder="Describe the work covered by this contract..."
          className="w-full px-3 py-2 rounded-lg border text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <button
        type="submit"
        disabled={createMut.isPending}
        className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50"
      >
        {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Create Contract
      </button>
    </form>
  );
}

// ── Add Scope Package Form ────────────────────────────────────────────────────

function AddScopePackageForm({
  contractId, categories, onAdded,
}: {
  contractId: string;
  categories: Category[];
  onAdded: () => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [quantity, setQuantity]     = useState('');
  const [unit, setUnit]             = useState('square');
  const [covered, setCovered]       = useState('');
  const [open, setOpen]             = useState(false);
  const qc = useQueryClient();

  const addMut = useMutation({
    mutationFn: (body: object) =>
      customFetch(`/api/contracts/${contractId}/scope-packages`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract-detail', contractId] });
      toast.success('Scope package added');
      setCategoryId(''); setQuantity(''); setCovered(''); setUnit('square');
      setOpen(false);
      onAdded();
    },
    onError: () => toast.error('Could not add scope package'),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> Add Scope Package
      </button>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId || !quantity) { toast.error('Category and quantity are required'); return; }
    addMut.mutate({
      categoryId,
      quantity:           parseFloat(quantity),
      unit:               unit.trim() || 'square',
      coveredAmountCents: parseCents(covered),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="border rounded-xl p-4 space-y-3 bg-muted/20">
      <p className="text-xs font-semibold text-muted-foreground">Add Scope Package</p>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Category</label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full h-9 px-3 rounded-lg border text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Qty</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="1"
            className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="col-span-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Unit</label>
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="square"
            className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="col-span-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Covered ($)</label>
          <input
            type="text"
            value={covered}
            onChange={(e) => setCovered(e.target.value)}
            placeholder="0.00"
            className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={addMut.isPending}
          className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          {addMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-8 px-3 rounded-lg border text-xs font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Contract Detail ───────────────────────────────────────────────────────────

function ContractDetail({
  contract, pinId, isManager, signingPortalBase,
}: {
  contract: Contract;
  pinId: string;
  isManager: boolean;
  signingPortalBase: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showVoidForm, setShowVoidForm] = useState(false);

  // Editing state
  const [coveredScope, setCoveredScope] = useState(String(contract.coveredScopeCents / 100));
  const [deductible, setDeductible]     = useState(String(contract.deductibleCents / 100));
  const [summary, setSummary]           = useState(contract.scopeSummary ?? '');

  const { data: categoriesData } = useQuery<{ categories: Category[] }>({
    queryKey: ['selection-categories'],
    queryFn: () => customFetch('/api/selections/categories'),
    staleTime: 300_000,
  });
  const categories = categoriesData?.categories ?? [];

  const patchMut = useMutation({
    mutationFn: (body: object) =>
      customFetch(`/api/contracts/${contract.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts', pinId] });
      qc.invalidateQueries({ queryKey: ['contract-detail', contract.id] });
      toast.success('Contract updated');
      setEditing(false);
    },
    onError: () => toast.error('Could not update contract'),
  });

  const sendMut = useMutation({
    mutationFn: () =>
      customFetch(`/api/contracts/${contract.id}/send`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts', pinId] });
      toast.success('Contract sent to customer');
    },
    onError: (err: unknown) => {
      const msg = (err as { data?: { error?: string } })?.data?.error;
      toast.error(msg ?? 'Could not send contract');
    },
  });

  const genMut = useMutation({
    mutationFn: () =>
      customFetch(`/api/contracts/${contract.id}/generate-document`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts', pinId] });
      toast.success('Contract document generated');
    },
    onError: () => toast.error('Could not generate document'),
  });

  const voidMut = useMutation({
    mutationFn: (reason: string) =>
      customFetch(`/api/contracts/${contract.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts', pinId] });
      toast.success('Contract voided');
      setShowVoidForm(false);
    },
    onError: () => toast.error('Could not void contract'),
  });

  const deletePkgMut = useMutation({
    mutationFn: (pkgId: string) =>
      customFetch(`/api/contracts/${contract.id}/scope-packages/${pkgId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts', pinId] });
      toast.success('Package removed');
    },
    onError: () => toast.error('Could not remove package'),
  });

  const isDraft  = contract.status === 'draft';
  const isSent   = contract.status === 'sent';
  const isSigned = contract.status === 'signed';
  const isVoided = contract.status === 'voided';

  const portalUrl = contract.accessCode
    ? `${signingPortalBase}/contract/${contract.accessCode}`
    : null;

  function saveEdits() {
    patchMut.mutate({
      coveredScopeCents: parseCents(coveredScope),
      deductibleCents:   parseCents(deductible),
      scopeSummary:      summary.trim() || null,
    });
  }

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">
            Contract · {new Date(contract.createdAt).toLocaleDateString()}
          </span>
          {statusBadge(contract.status)}
        </div>
        {isDraft && !editing && (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Edit2 className="h-3.5 w-3.5" /> Edit
          </button>
        )}
      </div>

      {/* Signed / voided banners */}
      {isSigned && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex gap-2 items-start">
          <CheckCircle className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
          <div className="text-sm text-green-900">
            <span className="font-medium">Signed</span> by {contract.customerPrintName} on{' '}
            {new Date(contract.customerSignedAt!).toLocaleDateString()}
          </div>
        </div>
      )}
      {isVoided && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex gap-2 items-start">
          <Ban className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-900">
            <span className="font-medium">Voided</span>
            {contract.voidReason ? ` — ${contract.voidReason}` : ''}
          </div>
        </div>
      )}

      {/* Portal link (sent or signed) */}
      {portalUrl && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-blue-900">Customer Signing Link</p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-blue-800 flex-1 truncate bg-blue-100 px-2 py-1 rounded">{portalUrl}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(portalUrl); toast.success('Copied'); }}
              className="text-blue-700 hover:text-blue-900"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <a href={portalUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:text-blue-900">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Pricing */}
      {editing ? (
        <div className="border rounded-xl p-4 space-y-3 bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground">Edit Pricing</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Covered Scope ($)</label>
              <input
                type="text"
                value={coveredScope}
                onChange={(e) => setCoveredScope(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Deductible ($)</label>
              <input
                type="text"
                value={deductible}
                onChange={(e) => setDeductible(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Scope Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveEdits}
              disabled={patchMut.isPending}
              className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {patchMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="h-8 px-3 rounded-lg border text-xs">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="border rounded-xl divide-y text-sm">
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-muted-foreground">Covered Scope</span>
            <span>{fmt(contract.coveredScopeCents)}</span>
          </div>
          {contract.deductibleCents > 0 && (
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Deductible</span>
              <span>{fmt(contract.deductibleCents)}</span>
            </div>
          )}
          {contract.bettermentsCents > 0 && (
            <div className="flex justify-between px-4 py-2.5 text-blue-700">
              <span>Upgrade Betterments</span>
              <span>+{fmt(contract.bettermentsCents)}</span>
            </div>
          )}
          <div className="flex justify-between px-4 py-2.5 font-semibold">
            <span>Total Contract</span>
            <span>{fmt(contract.totalContractCents)}</span>
          </div>
          {contract.scopeSummary && (
            <div className="px-4 py-2.5 text-muted-foreground text-xs">{contract.scopeSummary}</div>
          )}
        </div>
      )}

      {/* Scope packages */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">
          Scope Packages ({contract.scopePackages.length})
        </p>
        {contract.scopePackages.length === 0 ? (
          <p className="text-xs text-muted-foreground">No packages yet. Add one below.</p>
        ) : (
          <div className="border rounded-xl divide-y">
            {contract.scopePackages.map((pkg) => (
              <div key={pkg.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{pkg.categoryName}</span>
                    {pkg.selection && (
                      <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pkg.quantity} {pkg.unit} · {fmt(pkg.coveredAmountCents)}
                    {pkg.selection && ` · ${pkg.selection.brandName} ${pkg.selection.productName}`}
                  </p>
                </div>
                {isDraft && (
                  <button
                    onClick={() => deletePkgMut.mutate(pkg.id)}
                    disabled={deletePkgMut.isPending}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {isDraft && (
          <AddScopePackageForm
            contractId={contract.id}
            categories={categories}
            onAdded={() => qc.invalidateQueries({ queryKey: ['contracts', pinId] })}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isDraft && (
          <button
            onClick={() => sendMut.mutate()}
            disabled={sendMut.isPending || contract.scopePackages.length === 0}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            title={contract.scopePackages.length === 0 ? 'Add at least one scope package first' : ''}
          >
            {sendMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send to Customer
          </button>
        )}

        {(isSent || isSigned) && (
          <button
            onClick={() => genMut.mutate()}
            disabled={genMut.isPending}
            className="h-9 px-4 rounded-lg border text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {genMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            {contract.documentObjectPath ? 'Regenerate Doc' : 'Generate Doc'}
          </button>
        )}

        {(isDraft || isSent) && isManager && (
          <button
            onClick={() => setShowVoidForm((v) => !v)}
            className="h-9 px-4 rounded-lg border border-destructive/50 text-destructive text-sm font-medium flex items-center gap-2 hover:bg-destructive/5"
          >
            <Ban className="h-3.5 w-3.5" /> Void
          </button>
        )}
      </div>

      {/* Void form */}
      {showVoidForm && (
        <div className="border border-destructive/30 rounded-xl p-4 space-y-3 bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="text-sm font-semibold">Void this contract</p>
          </div>
          <p className="text-xs text-muted-foreground">
            This cannot be undone. You can create a replacement contract for this lead afterwards.
          </p>
          <textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={2}
            placeholder="Reason for voiding (required)…"
            className="w-full px-3 py-2 rounded-lg border text-sm resize-none focus:outline-none focus:ring-2 focus:ring-destructive/50"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { if (!voidReason.trim()) { toast.error('Reason required'); return; } voidMut.mutate(voidReason.trim()); }}
              disabled={voidMut.isPending || !voidReason.trim()}
              className="h-8 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {voidMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm Void'}
            </button>
            <button onClick={() => setShowVoidForm(false)} className="h-8 px-3 rounded-lg border text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ContractBuilderTab ─────────────────────────────────────────────────────────

export default function ContractBuilderTab({
  pinId,
  isManager,
}: {
  pinId: string;
  isManager: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded]     = useState<Record<string, boolean>>({});
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ contracts: Contract[] }>({
    queryKey: ['contracts', pinId],
    queryFn: () => customFetch(`/api/pins/${pinId}/contracts`),
    staleTime: 30_000,
  });

  const contracts = data?.contracts ?? [];
  const activeContracts = contracts.filter((c) => c.status !== 'voided');
  const voidedContracts = contracts.filter((c) => c.status === 'voided');

  // Derive signing portal base URL from current page location
  const signingPortalBase = `${window.location.origin}/signing-portal`;

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canCreate = !activeContracts.some((c) => c.status === 'draft' || c.status === 'sent');

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Contract Builder</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Build and send a contract for the customer to review and sign.
          </p>
        </div>
        {canCreate && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2"
          >
            <Plus className="h-3.5 w-3.5" /> New Contract
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateContractForm
          pinId={pinId}
          onCreated={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['contracts', pinId] }); }}
        />
      )}

      {/* Active contracts */}
      {activeContracts.length === 0 && !showCreate && (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-3 border rounded-xl">
          <Shield className="h-8 w-8 opacity-20" />
          <p className="text-sm font-medium">No contracts yet</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Create a contract to present material upgrade options and get a signed agreement.
          </p>
        </div>
      )}

      {activeContracts.map((c) => (
        <ContractDetail
          key={c.id}
          contract={c}
          pinId={pinId}
          isManager={isManager}
          signingPortalBase={signingPortalBase}
        />
      ))}

      {/* Voided — collapsible */}
      {voidedContracts.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => toggleExpand('voided')}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded['voided'] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {voidedContracts.length} voided contract{voidedContracts.length > 1 ? 's' : ''}
          </button>
          {expanded['voided'] && voidedContracts.map((c) => (
            <ContractDetail
              key={c.id}
              contract={c}
              pinId={pinId}
              isManager={isManager}
              signingPortalBase={signingPortalBase}
            />
          ))}
        </div>
      )}
    </div>
  );
}

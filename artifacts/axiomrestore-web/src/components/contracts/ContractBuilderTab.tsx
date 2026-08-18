/**
 * ContractBuilderTab — rep-facing contract creation & management.
 * All API calls use generated hooks from @workspace/api-client-react.
 * All query invalidations use generated getXxxQueryKey() functions.
 */

import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPinContracts,
  getListPinContractsQueryKey,
  useCreateContract,
  useUpdateContract,
  updateContract,
  getGetContractQueryKey,
  useAddContractScopePackage,
  useDeleteContractScopePackage,
  useSendContract,
  useGenerateContractDocument,
  useVoidContract,
  useGetPinInspectionEstimate,
  getGetPinInspectionEstimateQueryKey,
  usePortalSelectProduct,
  getGetPortalContractQueryKey,
} from '@workspace/api-client-react';
import { useListSelectionCategories } from '@workspace/api-client-react';
import {
  Plus, Send, FileText, Trash2, Loader2, Shield, CheckCircle,
  AlertTriangle, Ban, ChevronDown, ChevronUp, Edit2, Copy, ExternalLink,
  Info, UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  Contract,
  SelectionCategoryListEnvelope,
} from '@workspace/api-client-react';

type SelectionCategory = SelectionCategoryListEnvelope['categories'][number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function parseCents(s: string): number {
  const n = parseFloat(s.replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function fmtDollars(cents: number): string {
  return (cents / 100).toFixed(2);
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
  const [sourceNote, setSourceNote] = useState<string | null>(null);
  const [scopeSource, setScopeSource] = useState<'estimate' | 'manual'>('manual');
  const qc = useQueryClient();

  // Prefill from inspection estimate
  const { data: estimateData } = useGetPinInspectionEstimate(pinId);
  useEffect(() => {
    if (estimateData?.coveredScopeCents != null && estimateData.coveredScopeCents > 0 && !coveredScope) {
      setCoveredScope(fmtDollars(estimateData.coveredScopeCents));
      setScopeSource('estimate');
      setSourceNote(`from inspection estimate — ${fmt(estimateData.coveredScopeCents)}`);
    }
  // Only run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateData]);

  const createMut = useCreateContract({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPinContractsQueryKey(pinId) });
        toast.success('Contract created');
        onCreated();
      },
      onError: () => toast.error('Could not create contract'),
    },
  });

  function handleCoveredScopeChange(v: string) {
    setCoveredScope(v);
    if (scopeSource === 'estimate') {
      setScopeSource('manual');
      setSourceNote(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMut.mutate({
      pinId,
      data: {
        coveredScopeCents: parseCents(coveredScope),
        deductibleCents:   parseCents(deductible),
        scopeSummary:      summary.trim() || undefined,
        scopeSource,
      },
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
            onChange={(e) => handleCoveredScopeChange(e.target.value)}
            placeholder="0.00"
            className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {sourceNote && (
            <p className="text-[10px] text-blue-600 flex items-center gap-1 mt-0.5">
              <Info className="h-3 w-3 shrink-0" />
              {sourceNote}
            </p>
          )}
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
  contractId, pinId, categories, onAdded,
}: {
  contractId: string;
  pinId: string;
  categories: SelectionCategory[];
  onAdded: () => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [quantity, setQuantity]     = useState('');
  const [unit, setUnit]             = useState('square');
  const [covered, setCovered]       = useState('');
  const [open, setOpen]             = useState(false);
  const qc = useQueryClient();

  const addMut = useAddContractScopePackage({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPinContractsQueryKey(pinId) });
        qc.invalidateQueries({ queryKey: getGetContractQueryKey(contractId) });
        toast.success('Scope package added');
        setCategoryId(''); setQuantity(''); setCovered(''); setUnit('square');
        setOpen(false);
        onAdded();
      },
      onError: () => toast.error('Could not add scope package'),
    },
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
      contractId,
      data: {
        categoryId,
        quantity:           parseFloat(quantity),
        unit:               unit.trim() || 'square',
        coveredAmountCents: parseCents(covered),
      },
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
            type="number" step="0.01" min="0"
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
  const [coveredScope, setCoveredScope] = useState(String((contract.coveredScopeCents ?? 0) / 100));
  const [deductible, setDeductible]     = useState(String((contract.deductibleCents ?? 0) / 100));
  const [summary, setSummary]           = useState(contract.scopeSummary ?? '');

  const { data: categoriesData } = useListSelectionCategories();
  const categories = categoriesData?.categories ?? [];

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: getListPinContractsQueryKey(pinId) });
    qc.invalidateQueries({ queryKey: getGetContractQueryKey(contract.id) });
  }

  const patchMut = useUpdateContract({
    mutation: {
      onSuccess: () => { invalidateAll(); toast.success('Contract updated'); setEditing(false); },
      onError: () => toast.error('Could not update contract'),
    },
  });

  const sendMut = useSendContract({
    mutation: {
      onSuccess: (data) => {
        invalidateAll();
        // Copy portal link to clipboard (non-blocking)
        const code = data.contract?.accessCode;
        if (code) {
          const url = `${signingPortalBase}/contract/${code}`;
          navigator.clipboard.writeText(url).catch(() => {});
          toast.success('Contract sent — link copied to clipboard');
        } else {
          toast.success('Contract sent to customer');
        }
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast.error(msg ?? 'Could not send contract');
      },
    },
  });

  const genMut = useGenerateContractDocument({
    mutation: {
      onSuccess: () => { invalidateAll(); toast.success('Contract document generated'); },
      onError: () => toast.error('Could not generate document'),
    },
  });

  const voidMut = useVoidContract({
    mutation: {
      onSuccess: () => { invalidateAll(); toast.success('Contract voided'); setShowVoidForm(false); },
      onError: () => toast.error('Could not void contract'),
    },
  });

  const deletePkgMut = useDeleteContractScopePackage({
    mutation: {
      onSuccess: () => { invalidateAll(); toast.success('Package removed'); },
      onError: () => toast.error('Could not remove package'),
    },
  });

  // Rep-assisted selection: record a selection on behalf of the customer for a sent contract
  const repSelectMut = usePortalSelectProduct({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast.success('Selection saved for customer');
      },
      onError: () => toast.error('Could not save selection'),
    },
  });

  const isDraft  = contract.status === 'draft';
  const isSent   = contract.status === 'sent';
  const isSigned = contract.status === 'signed';
  const isVoided = contract.status === 'voided';

  const portalUrl = contract.accessCode
    ? `${signingPortalBase}/contract/${contract.accessCode}`
    : null;

  // Readiness check: packages missing a selection
  const unselectedPackages = (contract.scopePackages ?? []).filter((p) => !p.selection);
  const hasDocument = !!contract.documentObjectPath;
  const isReady = unselectedPackages.length === 0 && hasDocument;

  function saveEdits() {
    patchMut.mutate({
      contractId: contract.id,
      data: {
        coveredScopeCents: parseCents(coveredScope),
        deductibleCents:   parseCents(deductible),
        scopeSummary:      summary.trim() || null,
        scopeSource:       'manual',
      },
    });
  }

  // Rep-assisted product picker state
  const [repAssistPkgId, setRepAssistPkgId] = useState<string | null>(null);
  const [repSelectedProductId, setRepSelectedProductId] = useState('');
  const [repSelectedOptionId, setRepSelectedOptionId] = useState('');

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
          {contract.scopeSource === 'estimate' && (
            <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">from estimate</span>
          )}
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
            <span>{fmt(contract.coveredScopeCents ?? 0)}</span>
          </div>
          {(contract.deductibleCents ?? 0) > 0 && (
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Deductible</span>
              <span>{fmt(contract.deductibleCents ?? 0)}</span>
            </div>
          )}
          {(contract.bettermentsCents ?? 0) > 0 && (
            <div className="flex justify-between px-4 py-2.5 text-blue-700">
              <span>Upgrade Betterments</span>
              <span>+{fmt(contract.bettermentsCents ?? 0)}</span>
            </div>
          )}
          <div className="flex justify-between px-4 py-2.5 font-semibold">
            <span>Total Contract</span>
            <span>{fmt(contract.totalContractCents ?? 0)}</span>
          </div>
          {contract.scopeSummary && (
            <div className="px-4 py-2.5 text-muted-foreground text-xs">{contract.scopeSummary}</div>
          )}
        </div>
      )}

      {/* Scope packages */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">
          Scope Packages ({(contract.scopePackages ?? []).length})
        </p>
        {(contract.scopePackages ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No packages yet. Add one below.</p>
        ) : (
          <div className="border rounded-xl divide-y">
            {(contract.scopePackages ?? []).map((pkg) => (
              <div key={pkg.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{pkg.categoryName}</span>
                      {pkg.selection && (
                        <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      )}
                      {pkg.selection?.selectedBy === 'rep' && (
                        <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <UserCheck className="h-2.5 w-2.5" /> Rep selected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {pkg.quantity} {pkg.unit} · {fmt(pkg.coveredAmountCents ?? 0)}
                      {pkg.selection && ` · ${pkg.selection.brandName} ${pkg.selection.productName}`}
                    </p>
                  </div>
                  {isDraft && (
                    <button
                      onClick={() => deletePkgMut.mutate({ contractId: contract.id, pkgId: pkg.id })}
                      disabled={deletePkgMut.isPending}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Rep-assisted selection for sent contracts */}
                {isSent && contract.accessCode && !pkg.selection && (
                  <div>
                    {repAssistPkgId === pkg.id ? (
                      <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                        <p className="text-xs font-medium text-amber-900 flex items-center gap-1">
                          <UserCheck className="h-3.5 w-3.5" /> Select on behalf of customer
                        </p>
                        <p className="text-[10px] text-amber-700">
                          You're making this selection — the customer must still sign in the portal.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (!repSelectedProductId) { toast.error('Choose a product first'); return; }
                              repSelectMut.mutate({
                                code: contract.accessCode!,
                                pkgId: pkg.id,
                                data: {
                                  productId: repSelectedProductId,
                                  optionId: repSelectedOptionId || null,
                                },
                              });
                              setRepAssistPkgId(null);
                              setRepSelectedProductId('');
                              setRepSelectedOptionId('');
                            }}
                            disabled={!repSelectedProductId || repSelectMut.isPending}
                            className="h-7 px-3 rounded-lg bg-amber-700 text-white text-xs font-medium disabled:opacity-50"
                          >
                            Save Selection
                          </button>
                          <button
                            onClick={() => { setRepAssistPkgId(null); setRepSelectedProductId(''); }}
                            className="h-7 px-3 rounded-lg border text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setRepAssistPkgId(pkg.id); setRepSelectedProductId(''); }}
                        className="text-[11px] text-amber-700 hover:underline flex items-center gap-1"
                      >
                        <UserCheck className="h-3 w-3" /> Select for customer
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {isDraft && (
          <AddScopePackageForm
            contractId={contract.id}
            pinId={pinId}
            categories={categories as SelectionCategory[]}
            onAdded={invalidateAll}
          />
        )}
      </div>

      {/* Readiness gate (draft only, before send) */}
      {isDraft && (contract.scopePackages ?? []).length > 0 && (
        <div className={`rounded-xl p-4 space-y-2 ${isReady ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
          <p className={`text-xs font-semibold ${isReady ? 'text-green-900' : 'text-amber-900'}`}>
            {isReady ? '✓ Ready to send' : 'Not ready to send'}
          </p>
          {unselectedPackages.length > 0 && (
            <p className="text-xs text-amber-800">
              Packages without a product selection:{' '}
              {unselectedPackages.map((p) => p.categoryName).join(', ')}
            </p>
          )}
          {!hasDocument && (
            <p className="text-xs text-amber-800">No contract document generated yet.</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isDraft && (
          <button
            onClick={() => sendMut.mutate({ contractId: contract.id })}
            disabled={sendMut.isPending || (contract.scopePackages ?? []).length === 0}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            title={(contract.scopePackages ?? []).length === 0 ? 'Add at least one scope package first' : ''}
          >
            {sendMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send to Customer
          </button>
        )}

        {(isDraft || isSent) && (
          <button
            onClick={() => genMut.mutate({ contractId: contract.id })}
            disabled={genMut.isPending}
            className="h-9 px-4 rounded-lg border text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {genMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            {contract.documentObjectPath ? 'Regenerate Doc' : 'Generate Doc'}
          </button>
        )}

        {(isDraft || isSent || isSigned) && isManager && (
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
          {isSigned && (
            <p className="text-xs text-destructive/80 font-medium">
              ⚠ This contract was signed. Voiding will clear the contract value from the lead's financial record.
            </p>
          )}
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
              onClick={() => {
                if (!voidReason.trim()) { toast.error('Reason required'); return; }
                voidMut.mutate({ contractId: contract.id, data: { voidReason: voidReason.trim() } });
              }}
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

  const { data, isLoading } = useListPinContracts(pinId);

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
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: getListPinContractsQueryKey(pinId) });
          }}
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
            {voidedContracts.length} voided contract{voidedContracts.length !== 1 ? 's' : ''}
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

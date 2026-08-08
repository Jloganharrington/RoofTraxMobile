/**
 * ContractView — customer-facing contract signing portal.
 * All API calls use generated hooks from @workspace/api-client-react.
 * The portalFetch mutator strips the /api prefix so requests reach /portal/...
 */

import { useRef, useState, useEffect } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetPortalContract,
  getGetPortalContractQueryKey,
  usePortalSelectProduct,
  usePortalGenerateContractDocument,
  usePortalSignContract,
} from '@workspace/api-client-react';
import {
  ArrowLeft, ChevronDown, CheckCircle, Loader2, FileText,
  PenLine, Shield, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  PortalContractEnvelope,
  PortalScopePackage,
} from '@workspace/api-client-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

// ── SignaturePad ──────────────────────────────────────────────────────────────

function SignaturePad({ onCapture }: { onCapture: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * (canvas.width / rect.width),
        y: (e.touches[0].clientY - rect.top) * (canvas.height / rect.height),
      };
    }
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e293b';
    ctx.lineCap = 'round';
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasStrokes(true);
  }

  function endDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing.current) return;
    drawing.current = false;
    if (hasStrokes) {
      onCapture(canvasRef.current!.toDataURL('image/png'));
    }
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    onCapture(null);
  }

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed rounded-lg overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={600}
          height={160}
          className="w-full touch-none cursor-crosshair"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-muted-foreground text-sm">Sign here</p>
          </div>
        )}
      </div>
      {hasStrokes && (
        <button
          onClick={clear}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> Clear signature
        </button>
      )}
    </div>
  );
}

// ── PackageCard ───────────────────────────────────────────────────────────────

function PackageCard({
  pkg, code, onSelectionChange, signed,
}: {
  pkg: PortalScopePackage;
  code: string;
  onSelectionChange: () => void;
  signed: boolean;
}) {
  const [expanded, setExpanded] = useState(!pkg.selection);
  const [selectedProductId, setSelectedProductId] = useState(pkg.selection?.productId ?? '');
  const [selectedOptionId, setSelectedOptionId] = useState(pkg.selection?.optionId ?? '');
  const qc = useQueryClient();

  const selectMut = usePortalSelectProduct({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPortalContractQueryKey(code) });
        onSelectionChange();
        setExpanded(false);
        toast.success('Selection saved');
      },
      onError: () => toast.error('Could not save selection'),
    },
  });

  const selectedProduct = (pkg.products ?? []).find((p) => p.id === selectedProductId);
  const hasOptions = (selectedProduct?.options.length ?? 0) > 0;

  function handleConfirm() {
    if (!selectedProductId) { toast.error('Please choose a product.'); return; }
    if (hasOptions && !selectedOptionId) { toast.error('Please choose an option.'); return; }
    selectMut.mutate({
      code,
      pkgId: pkg.id,
      data: { productId: selectedProductId, optionId: selectedOptionId || null },
    });
  }

  const betterment = selectedProduct
    ? selectedProduct.priceDeltaCents * Number(pkg.quantity)
    : null;
  const isFree = selectedProduct?.isBase;

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => !signed && setExpanded((v) => !v)}
        disabled={signed}
        className="w-full flex items-center justify-between px-5 py-4 text-left gap-3 bg-card hover:bg-muted/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{pkg.categoryName}</span>
            {pkg.selection && <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pkg.quantity} {pkg.unit} · Covered: {fmt(pkg.coveredAmountCents)}
          </p>
          {pkg.selection && (
            <p className="text-xs mt-1 text-foreground/80">
              {pkg.selection.brandName} — {pkg.selection.productName}
              {pkg.selection.optionName ? ` (${pkg.selection.optionName})` : ''}
              {pkg.selection.extendedDeltaCents !== 0 && (
                <span className="ml-2 font-medium text-blue-700">
                  +{fmt(pkg.selection.extendedDeltaCents)}
                </span>
              )}
            </p>
          )}
        </div>
        {!signed && (
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {/* Selection panel */}
      {expanded && !signed && (
        <div className="px-5 pb-5 pt-2 space-y-4 border-t bg-muted/20">
          {/* Product list */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Choose a product</p>
            <div className="space-y-2">
              {(pkg.products ?? []).map((product) => {
                const delta = product.priceDeltaCents * Number(pkg.quantity);
                const isSelected = product.id === selectedProductId;
                return (
                  <button
                    key={product.id}
                    onClick={() => { setSelectedProductId(product.id); setSelectedOptionId(''); }}
                    className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{product.brandName}</p>
                        {product.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{product.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {product.isBase ? (
                          <span className="text-xs text-green-700 font-medium">Included</span>
                        ) : (
                          <span className="text-xs font-medium text-blue-700">+{fmt(delta)}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Options */}
          {hasOptions && selectedProduct && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Choose an option</p>
              <div className="grid grid-cols-2 gap-2">
                {selectedProduct.options.map((opt) => {
                  const isOptSelected = opt.id === selectedOptionId;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedOptionId(opt.id)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        isOptSelected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {opt.swatchHex && (
                          <div
                            className="h-4 w-4 rounded-full shrink-0 border"
                            style={{ backgroundColor: opt.swatchHex }}
                          />
                        )}
                        <span className="text-xs font-medium truncate">{opt.name}</span>
                      </div>
                      {opt.optionGroup && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{opt.optionGroup}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Betterment preview */}
          {selectedProductId && betterment !== null && !isFree && (
            <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
              This upgrade adds <strong>{fmt(betterment)}</strong> to your out-of-pocket cost.
            </p>
          )}

          <button
            onClick={handleConfirm}
            disabled={selectMut.isPending || !selectedProductId || (hasOptions && !selectedOptionId)}
            className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {selectMut.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : 'Confirm Selection'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── ContractView ──────────────────────────────────────────────────────────────

export default function ContractView() {
  const { code } = useParams<{ code: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [printName, setPrintName]   = useState('');
  const [showSignSection, setShowSignSection] = useState(false);

  const { data, isLoading, isError, error } = useGetPortalContract(code!, {
    query: { queryKey: getGetPortalContractQueryKey(code!), enabled: !!code, staleTime: 10_000 },
  });

  const genMut = usePortalGenerateContractDocument({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPortalContractQueryKey(code!) });
        toast.success('Contract document generated');
        setShowSignSection(true);
      },
      onError: () => toast.error('Could not generate document. Ensure all packages have selections.'),
    },
  });

  const signMut = usePortalSignContract({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPortalContractQueryKey(code!) });
        toast.success('Contract signed!');
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast.error(msg ?? 'Could not submit signature. Please try again.');
      },
    },
  });

  const packages = data?.packages ?? [];
  const allSelected = packages.every((p) => p.selection != null);
  const contract = data?.contract;
  const isSigned = contract?.customerSignedAt != null;
  const docPath = contract?.documentObjectPath;

  function handleSign() {
    if (!sigDataUrl) { toast.error('Please draw your signature first.'); return; }
    if (!printName.trim()) { toast.error('Please enter your printed name.'); return; }
    const base64 = sigDataUrl.split(',')[1];
    signMut.mutate({
      code: code!,
      data: { customerSignatureBase64: base64, customerPrintName: printName.trim() },
    });
  }

  // Auto-show sign section when doc exists and all packages selected
  useEffect(() => {
    if (docPath && allSelected && !isSigned) setShowSignSection(true);
  }, [docPath, allSelected, isSigned]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    const status = (error as { status?: number } | null)?.status;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center gap-4">
        <Shield className="h-10 w-10 text-muted-foreground opacity-40" />
        <h2 className="text-lg font-semibold">
          {status === 404 ? 'Contract not found' : 'Something went wrong'}
        </h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          {status === 404
            ? 'This link may have expired or the contract may not be available yet.'
            : 'Please try again in a moment.'}
        </p>
        <button onClick={() => navigate('/')} className="text-sm text-primary underline">
          Try a different code
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header */}
      <div className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Contract Portal</span>
          </div>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
        {/* Signed banner */}
        {isSigned && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-900">Contract Signed</p>
              <p className="text-sm text-green-800 mt-0.5">
                Signed on{' '}
                {new Date(contract!.customerSignedAt!).toLocaleDateString('en-US', { dateStyle: 'long' })}.
                Your contractor will be in touch with next steps.
              </p>
            </div>
          </div>
        )}

        {/* Company / property */}
        <div className="space-y-1">
          {data.company.name && (
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Contractor
            </p>
          )}
          <h1 className="text-xl font-bold">{data.company.name ?? 'Your Contractor'}</h1>
          {data.property.address && (
            <p className="text-sm text-muted-foreground">{data.property.address}</p>
          )}
        </div>

        {/* Pricing summary */}
        <div className="bg-card border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold">Contract Summary</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Insurance-Covered Scope</span>
              <span>{fmt(contract!.coveredScopeCents)}</span>
            </div>
            {contract!.deductibleCents > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deductible (your responsibility)</span>
                <span>{fmt(contract!.deductibleCents)}</span>
              </div>
            )}
            {contract!.bettermentsCents > 0 && (
              <div className="flex justify-between text-blue-700">
                <span>Upgrade Betterments</span>
                <span>+{fmt(contract!.bettermentsCents)}</span>
              </div>
            )}
            <div className="border-t pt-2 flex justify-between font-semibold">
              <span>Total Contract Value</span>
              <span>{fmt(contract!.totalContractCents)}</span>
            </div>
          </div>
        </div>

        {/* Scope summary */}
        {contract!.scopeSummary && (
          <div className="text-sm text-muted-foreground bg-muted/40 rounded-xl p-4">
            <p className="font-medium text-foreground mb-1">Scope of Work</p>
            <p className="leading-relaxed">{contract!.scopeSummary}</p>
          </div>
        )}

        {/* Scope packages */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            {isSigned
              ? 'Your Selections'
              : `Make Your Selections (${packages.filter((p) => p.selection).length}/${packages.length} done)`}
          </h2>
          {packages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              code={code!}
              onSelectionChange={() =>
                qc.invalidateQueries({ queryKey: getGetPortalContractQueryKey(code!) })
              }
              signed={isSigned}
            />
          ))}
        </div>

        {/* Generate document */}
        {!isSigned && allSelected && (
          <div className="border rounded-xl p-5 space-y-4">
            <div className="flex gap-3">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Contract Document</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {docPath
                    ? 'Your contract document is ready to review below.'
                    : 'Generate your personalized contract document to review before signing.'}
                </p>
              </div>
            </div>

            {docPath && (
              <div className="rounded-lg border overflow-hidden bg-muted/30">
                <iframe
                  src={`/portal/contract/${code}/document`}
                  className="w-full h-[480px]"
                  title="Contract Document"
                />
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => genMut.mutate({ code: code! })}
                disabled={genMut.isPending}
                className="flex-1 h-10 rounded-lg border border-primary text-primary text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {genMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : (docPath ? 'Regenerate Document' : 'Generate Contract Document')}
              </button>
              {docPath && (
                <a
                  href={`/portal/contract/${code}/document`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3"
                >
                  Open PDF
                </a>
              )}
            </div>
          </div>
        )}

        {/* Sign section */}
        {!isSigned && showSignSection && docPath && (
          <div className="border-2 border-primary/30 rounded-xl p-5 space-y-5">
            <div className="flex gap-3 items-center">
              <PenLine className="h-5 w-5 text-primary shrink-0" />
              <p className="font-semibold text-sm">Sign Your Contract</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Printed Name</label>
              <input
                type="text"
                value={printName}
                onChange={(e) => setPrintName(e.target.value)}
                placeholder="Your full legal name"
                className="w-full h-10 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Signature</label>
              <SignaturePad onCapture={setSigDataUrl} />
            </div>

            <p className="text-xs text-muted-foreground">
              By signing, you agree to the terms of this contract and authorize the work described above.
            </p>

            <button
              onClick={handleSign}
              disabled={signMut.isPending || !sigDataUrl || !printName.trim()}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {signMut.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : 'Sign Contract'}
            </button>
          </div>
        )}

        {/* Not-yet-ready hint */}
        {!isSigned && !allSelected && (
          <p className="text-center text-xs text-muted-foreground">
            Complete all selections above to unlock contract signing.
          </p>
        )}
      </div>
    </div>
  );
}

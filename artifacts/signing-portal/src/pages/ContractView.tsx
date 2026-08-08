/**
 * ContractView — customer-facing contract signing portal.
 *
 * Arrival-state matrix:
 *   NOTHING SELECTED  — full flow: select each package, review document, sign
 *   ALREADY SELECTED  — rep made selections; show what was chosen, go to review-and-sign
 *   ALREADY SIGNED    — read-only confirmation; document downloadable
 *   VOIDED (410)      — plain-language dead end with company name
 *   NOT FOUND (404)   — plain-language dead end
 *
 * Security invariants:
 *   - Signature control is unreachable until the customer has explicitly
 *     acknowledged they have viewed the rendered document (requires clicking
 *     "I have reviewed this document — proceed to sign").
 *   - Sign request carries documentSha256; server rejects 409 if it differs
 *     from the stored hash (selections changed and document was regenerated).
 *   - customer_signed_at is server-stamped; client never supplies it.
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
  PenLine, Shield, RotateCcw, Download, AlertTriangle, UserCheck,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PortalScopePackage, PortalVoidedResponse } from '@workspace/api-client-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** Format "per unit" as currency: "$85.00 per square" */
function fmtUnit(cents: number, unit: string) {
  return `${fmt(cents)} per ${unit}`;
}

// ── SignaturePad ──────────────────────────────────────────────────────────────

function SignaturePad({ onCapture }: { onCapture: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing   = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * (canvas.width / rect.width),
        y: (e.touches[0].clientY - rect.top)  * (canvas.height / rect.height),
      };
    }
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#1e293b'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y); ctx.stroke();
    setHasStrokes(true);
  }

  function endDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing.current) return;
    drawing.current = false;
    if (hasStrokes) onCapture(canvasRef.current!.toDataURL('image/png'));
  }

  function clear() {
    canvasRef.current!.getContext('2d')!.clearRect(0, 0, 600, 160);
    setHasStrokes(false);
    onCapture(null);
  }

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed rounded-lg overflow-hidden bg-white">
        <canvas
          ref={canvasRef} width={600} height={160}
          className="w-full touch-none cursor-crosshair"
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
        />
        {!hasStrokes && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-muted-foreground text-sm">Sign here</p>
          </div>
        )}
      </div>
      {hasStrokes && (
        <button onClick={clear} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="h-3 w-3" /> Clear signature
        </button>
      )}
    </div>
  );
}

// ── PackageCard ───────────────────────────────────────────────────────────────

function PackageCard({
  pkg, code, onSelectionChange, locked,
}: {
  pkg: PortalScopePackage;
  code: string;
  onSelectionChange: () => void;
  locked: boolean; // signed or voided
}) {
  const qc = useQueryClient();

  // If already selected, start collapsed; otherwise start expanded
  const [expanded, setExpanded] = useState(!pkg.selection);
  const [selectedProductId, setSelectedProductId] = useState(pkg.selection?.productId ?? '');
  const [selectedOptionId,  setSelectedOptionId]  = useState(pkg.selection?.optionId  ?? '');

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
  const hasOptions      = (selectedProduct?.options.length ?? 0) > 0;

  function handleConfirm() {
    if (!selectedProductId) { toast.error('Please choose a product.'); return; }
    if (hasOptions && !selectedOptionId) { toast.error('Please choose a colour or option.'); return; }
    selectMut.mutate({ code, pkgId: pkg.id, data: { productId: selectedProductId, optionId: selectedOptionId || null } });
  }

  // Price impact line: "+$85.00 per square × 28 squares = +$2,380.00"
  function priceImpactLine(product: typeof selectedProduct) {
    if (!product) return null;
    if (product.isBase) return null; // handled separately
    const qty     = Number(pkg.quantity);
    const ext     = product.priceDeltaCents * qty;
    const perUnit = fmt(product.priceDeltaCents);
    const qtyStr  = qty % 1 === 0 ? qty.toString() : qty.toFixed(2);
    return `+${perUnit} per ${product.unit} × ${qtyStr} ${pkg.unit} = +${fmt(ext)}`;
  }

  const currentSel = pkg.selection;

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => !locked && setExpanded((v) => !v)}
        disabled={locked}
        className="w-full flex items-center justify-between px-5 py-4 text-left gap-3 bg-card hover:bg-muted/40 transition-colors disabled:cursor-default"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{pkg.categoryName}</span>
            {currentSel && <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />}
            {currentSel?.selectedBy === 'rep' && (
              <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <UserCheck className="h-2.5 w-2.5" /> Pre-selected by contractor
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pkg.quantity} {pkg.unit} · Covered: {fmt(pkg.coveredAmountCents)}
          </p>
          {currentSel && (
            <p className="text-xs mt-1 text-foreground/80">
              {currentSel.brandName} — {currentSel.productName}
              {currentSel.optionName ? ` (${currentSel.optionName})` : ''}
              {currentSel.extendedDeltaCents !== 0 ? (
                <span className="ml-2 font-medium text-blue-700">+{fmt(currentSel.extendedDeltaCents)}</span>
              ) : (
                <span className="ml-2 text-green-700">Included</span>
              )}
            </p>
          )}
        </div>
        {!locked && (
          <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </button>

      {/* Selection panel */}
      {expanded && !locked && (
        <div className="px-5 pb-5 pt-2 space-y-4 border-t bg-muted/20">

          {/* Product list */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Choose a product</p>
            <div className="space-y-2">
              {(pkg.products ?? []).map((product) => {
                const isSelected = product.id === selectedProductId;
                const impact     = priceImpactLine(product);
                return (
                  <button
                    key={product.id}
                    onClick={() => { setSelectedProductId(product.id); setSelectedOptionId(''); }}
                    className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{product.brandName}</p>
                        {product.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{product.description}</p>
                        )}
                        {/* Step 4a: per-unit × qty = extended derivation */}
                        {impact && (
                          <p className="text-xs text-blue-700 mt-1 font-medium">{impact}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {product.isBase ? (
                          /* Step 4b: base tier must be unmistakably free */
                          <span className="text-xs text-green-700 font-medium whitespace-nowrap">
                            Included<br />
                            <span className="font-normal text-muted-foreground">no extra cost</span>
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-blue-700 whitespace-nowrap">
                            {fmtUnit(product.priceDeltaCents, product.unit)}
                          </span>
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
              <p className="text-xs font-medium text-muted-foreground mb-2">Choose a colour / option</p>
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
                          <div className="h-4 w-4 rounded-full shrink-0 border" style={{ backgroundColor: opt.swatchHex }} />
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

          <button
            onClick={handleConfirm}
            disabled={selectMut.isPending || !selectedProductId || (hasOptions && !selectedOptionId)}
            className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {selectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Selection'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Dead-end screens ──────────────────────────────────────────────────────────

function NotFoundScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-5">
      <Shield className="h-12 w-12 text-muted-foreground opacity-30" />
      <div>
        <h2 className="text-lg font-semibold">Link not found</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs">
          This link may have expired or may not have been sent yet. Check the email or text from your contractor.
        </p>
      </div>
      <button onClick={onBack} className="text-sm text-primary underline">
        Try a different code
      </button>
    </div>
  );
}

function VoidedScreen({ companyName, onBack }: { companyName: string | null; onBack: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-5">
      <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
        <AlertTriangle className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">This contract is no longer active</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs">
          {companyName
            ? `Please contact ${companyName} for assistance.`
            : 'Please contact your contractor for assistance.'}
        </p>
      </div>
      <button onClick={onBack} className="text-sm text-primary underline">
        Back
      </button>
    </div>
  );
}

// ── ContractView ──────────────────────────────────────────────────────────────

export default function ContractView() {
  const { code } = useParams<{ code: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  // ── Signature state ─────────────────────────────────────────────────────────
  const [sigDataUrl,  setSigDataUrl]  = useState<string | null>(null);
  const [printName,   setPrintName]   = useState('');

  // ── Document-reviewed gate [LOCKED Step 2a] ─────────────────────────────────
  // The sign section is ONLY shown after the customer explicitly acknowledges
  // they have reviewed the PDF. We never auto-show it.
  const [documentReviewed, setDocumentReviewed] = useState(false);

  // documentSha256 tracked from generate-document response (and initial GET)
  const [documentSha256, setDocumentSha256] = useState<string | null>(null);

  // Voided state: 410 response body
  const [voidedInfo, setVoidedInfo] = useState<{ companyName: string | null } | null>(null);

  const { data, isLoading, isError, error } = useGetPortalContract(code!, {
    query: {
      queryKey:  getGetPortalContractQueryKey(code!),
      enabled:   !!code,
      staleTime: 15_000,
      retry:     (count, err: unknown) => {
        const s = (err as { status?: number })?.status;
        if (s === 404 || s === 410 || s === 429) return false;
        return count < 2;
      },
    },
  });

  // On successful load, seed the sha256 if the document was already generated
  useEffect(() => {
    if (data?.contract.documentSha256) {
      setDocumentSha256(data.contract.documentSha256);
    }
  }, [data?.contract.documentSha256]);

  // Check for 410 (voided)
  useEffect(() => {
    if (!isError) return;
    const status = (error as { status?: number })?.status;
    if (status === 410) {
      const body = (error as { data?: PortalVoidedResponse })?.data;
      setVoidedInfo({ companyName: body?.companyName ?? null });
    }
  }, [isError, error]);

  const genMut = usePortalGenerateContractDocument({
    mutation: {
      onSuccess: (result) => {
        // Store the fresh sha256 — this is what the customer will sign against
        setDocumentSha256(result.documentSha256);
        qc.invalidateQueries({ queryKey: getGetPortalContractQueryKey(code!) });
        toast.success('Contract document generated');
        // Reset reviewed state: customer must review the NEW document
        setDocumentReviewed(false);
      },
      onError: () => toast.error('Could not generate document. Ensure all selections are complete.'),
    },
  });

  const signMut = usePortalSignContract({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPortalContractQueryKey(code!) });
        toast.success('Contract signed! A confirmation has been sent.');
      },
      onError: (err: unknown) => {
        const status = (err as { status?: number })?.status;
        const msg    = (err as { data?: { error?: string } })?.data?.error;
        if (status === 409) {
          toast.error(msg ?? 'The document has changed. Please review the updated contract before signing.');
          // Reset reviewed gate — customer must re-review
          setDocumentReviewed(false);
        } else {
          toast.error(msg ?? 'Could not submit signature. Please try again.');
        }
      },
    },
  });

  const packages    = data?.packages ?? [];
  const allSelected = packages.every((p) => p.selection != null);
  const contract    = data?.contract;
  const isSigned    = contract?.customerSignedAt != null;
  const docPath     = contract?.documentObjectPath;

  function handleSign() {
    if (!sigDataUrl)         { toast.error('Please draw your signature first.'); return; }
    if (!printName.trim())   { toast.error('Please enter your printed name.'); return; }
    if (!documentSha256)     { toast.error('Please generate and review the contract document first.'); return; }
    if (!documentReviewed)   { toast.error('Please confirm you have reviewed the document before signing.'); return; }
    signMut.mutate({
      code: code!,
      data: {
        customerSignatureBase64: sigDataUrl.split(',')[1],
        customerPrintName: printName.trim(),
        documentSha256,
      },
    });
  }

  // ── Loading / error states ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (voidedInfo) {
    return <VoidedScreen companyName={voidedInfo.companyName} onBack={() => navigate('/')} />;
  }

  if (isError || !data) {
    return <NotFoundScreen onBack={() => navigate('/')} />;
  }

  // ── Signed state ─────────────────────────────────────────────────────────────

  if (isSigned) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <div className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Contract Portal</span>
          </div>
        </div>
        <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
          {/* Signed confirmation */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center space-y-3">
            <CheckCircle className="h-10 w-10 text-green-600 mx-auto" />
            <h2 className="text-lg font-semibold text-green-900">Contract Signed</h2>
            <p className="text-sm text-green-800">
              Signed by <strong>{contract!.customerSignedAt && data.contract ? 'you' : ''}</strong> on{' '}
              {new Date(contract!.customerSignedAt!).toLocaleDateString('en-US', { dateStyle: 'long' })}.
            </p>
            <p className="text-xs text-green-700">
              A copy has been sent to your contractor. You can return to this link at any time to download your executed contract.
            </p>
          </div>

          {/* Company / property */}
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Contractor</p>
            <h1 className="text-lg font-bold mt-0.5">{data.company.name ?? 'Your Contractor'}</h1>
            {data.property.address && (
              <p className="text-sm text-muted-foreground">{data.property.address}</p>
            )}
          </div>

          {/* Step 4c: out-of-pocket as the primary number */}
          <OutOfPocketSummary contract={contract!} signed />

          {/* Selections summary (read-only) */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Your Selections</h2>
            {packages.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} code={code!} onSelectionChange={() => {}} locked />
            ))}
          </div>

          {/* Download executed document */}
          {docPath && (
            <a
              href={`/portal/contract/${code}/document`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 h-11 w-full rounded-lg border text-sm font-medium hover:bg-muted/40 transition-colors"
            >
              <Download className="h-4 w-4" /> Download Executed Contract
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Active contract (sent, not yet signed) ────────────────────────────────

  return (
    <div className="min-h-screen bg-background pb-20">
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
        {/* Company / property */}
        <div className="space-y-0.5">
          {data.company.name && (
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Contractor</p>
          )}
          <h1 className="text-xl font-bold">{data.company.name ?? 'Your Contractor'}</h1>
          {data.property.address && (
            <p className="text-sm text-muted-foreground">{data.property.address}</p>
          )}
        </div>

        {/* Step 4c: Out-of-pocket is the primary number — contract total is context */}
        <OutOfPocketSummary contract={contract!} signed={false} />

        {/* Scope summary */}
        {contract!.scopeSummary && (
          <div className="text-sm text-muted-foreground bg-muted/40 rounded-xl p-4">
            <p className="font-medium text-foreground mb-1">Scope of Work</p>
            <p className="leading-relaxed">{contract!.scopeSummary}</p>
          </div>
        )}

        {/* Scope packages */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {`Your Selections (${packages.filter((p) => p.selection).length}/${packages.length} done)`}
            </h2>
            {allSelected && !docPath && (
              <span className="text-xs text-blue-700">All done — generate your document below</span>
            )}
          </div>
          {packages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              code={code!}
              onSelectionChange={() => {
                // Any selection change after document generation invalidates the viewed state
                setDocumentReviewed(false);
                setDocumentSha256(null);
                qc.invalidateQueries({ queryKey: getGetPortalContractQueryKey(code!) });
              }}
              locked={false}
            />
          ))}
          {!allSelected && (
            <p className="text-center text-xs text-muted-foreground pt-1">
              Complete all selections above to unlock the contract document.
            </p>
          )}
        </div>

        {/* Document section — only shown when all selected */}
        {allSelected && (
          <div className="border rounded-xl p-5 space-y-4">
            <div className="flex gap-3">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Contract Document</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {docPath
                    ? 'Review your personalised contract before signing.'
                    : 'Generate your personalised contract document to review.'}
                </p>
              </div>
            </div>

            {/* PDF iframe — shown after generation */}
            {docPath && documentSha256 && (
              <div className="rounded-lg border overflow-hidden bg-muted/30">
                <iframe
                  src={`/portal/contract/${code}/document`}
                  className="w-full h-[420px] sm:h-[560px]"
                  title="Contract Document"
                />
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 flex-wrap">
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
                  <Download className="h-3.5 w-3.5" /> Open PDF
                </a>
              )}
            </div>

            {/* [LOCKED Step 2a] Explicit "I have reviewed" gate — sign section is NOT
                shown until this is clicked. Customer must acknowledge viewing the doc. */}
            {docPath && documentSha256 && !documentReviewed && (
              <button
                onClick={() => setDocumentReviewed(true)}
                className="w-full h-11 rounded-lg bg-primary/10 border border-primary/30 text-primary text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/15 transition-colors"
              >
                <Eye className="h-4 w-4" />
                I have reviewed this document — proceed to sign
              </button>
            )}
          </div>
        )}

        {/* [LOCKED Step 2a] Sign section — only reachable after explicit review acknowledgment */}
        {documentReviewed && docPath && documentSha256 && (
          <div className="border-2 border-primary/30 rounded-xl p-5 space-y-5">
            <div className="flex gap-3 items-center">
              <PenLine className="h-5 w-5 text-primary shrink-0" />
              <p className="font-semibold text-sm">Sign Your Contract</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-900 space-y-1">
              <p className="font-medium">What you are agreeing to:</p>
              <p>By signing, you authorise the work described in this contract and accept the payment terms shown above.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Full Legal Name (printed)</label>
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
              This electronic signature has the same legal effect as a handwritten signature. Your IP address and browser information are recorded as part of the evidentiary record.
            </p>

            <button
              onClick={handleSign}
              disabled={signMut.isPending || !sigDataUrl || !printName.trim()}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {signMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign Contract'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── OutOfPocketSummary ── Step 4c: customer's bill is the primary number ───────

function OutOfPocketSummary({
  contract, signed,
}: {
  contract: {
    coveredScopeCents:  number;
    bettermentsCents:   number;
    deductibleCents:    number;
    totalContractCents: number;
  };
  signed: boolean;
}) {
  const outOfPocket = (contract.deductibleCents ?? 0) + (contract.bettermentsCents ?? 0);

  return (
    <div className="bg-card border rounded-xl p-5 space-y-4">
      {/* Primary: what the customer pays */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Your out-of-pocket cost
        </p>
        <p className="text-3xl font-bold tracking-tight">{fmt(outOfPocket)}</p>
        <p className="text-xs text-muted-foreground">
          {signed ? 'This is what you agreed to pay.' : 'This is what you are agreeing to pay.'}
        </p>
      </div>

      {/* Breakdown */}
      <div className="space-y-1.5 text-sm border-t pt-3">
        {(contract.deductibleCents ?? 0) > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Deductible (your responsibility)</span>
            <span>{fmt(contract.deductibleCents)}</span>
          </div>
        )}
        {(contract.bettermentsCents ?? 0) > 0 && (
          <div className="flex justify-between text-blue-700">
            <span>Upgrade betterments</span>
            <span>+{fmt(contract.bettermentsCents)}</span>
          </div>
        )}
        {outOfPocket === 0 && (
          <p className="text-xs text-muted-foreground">No out-of-pocket cost for the base package.</p>
        )}
      </div>

      {/* Context: insurance-covered amount */}
      <div className="border-t pt-3 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Insurance-covered scope</span>
          <span>{fmt(contract.coveredScopeCents)}</span>
        </div>
        <div className="flex justify-between font-medium text-foreground/70">
          <span>Total contract value</span>
          <span>{fmt(contract.totalContractCents)}</span>
        </div>
        <p className="text-[11px]">
          The full contract value covers the work; your insurance pays the covered portion directly to your contractor.
        </p>
      </div>
    </div>
  );
}

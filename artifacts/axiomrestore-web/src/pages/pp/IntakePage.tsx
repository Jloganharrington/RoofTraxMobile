/**
 * /pp/new/intake — Stage 3: Upload-path intake form
 *
 * Collects property and claim details, creates an inspection record via
 * POST /api/pp/inspections (pinId = null, upload path), then routes into
 * the wizard for evidence upload, estimate building, and package generation.
 *
 * Receives ?types=roof,siding from NewPackagePage to pre-set damage flags.
 */
import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Loader2, ArrowLeft, ArrowRight, FileText } from 'lucide-react';

// ---------------------------------------------------------------------------
// PP fetch helper (same pattern as PPWizardPage)
// ---------------------------------------------------------------------------

async function ppFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Field component
// ---------------------------------------------------------------------------

function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-zinc-200">
        {label}
        {required && <span className="text-orange-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-colors';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntakePage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const typesParam = params.get('types') ?? '';
  const selectedTypes = new Set(typesParam.split(',').filter(Boolean));

  // Form state
  const [address,       setAddress]       = useState('');
  const [insuredName,   setInsuredName]   = useState('');
  const [carrierName,   setCarrierName]   = useState('');
  const [policyNumber,  setPolicyNumber]  = useState('');
  const [claimNumber,   setClaimNumber]   = useState('');
  const [dateOfLoss,    setDateOfLoss]    = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  const canSubmit = address.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { inspectionId } = await ppFetch<{ inspectionId: string }>(
        '/api/pp/inspections',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address:           address.trim(),
            insuredName:       insuredName.trim() || undefined,
            carrierName:       carrierName.trim() || undefined,
            policyNumber:      policyNumber.trim() || undefined,
            claimNumber:       claimNumber.trim() || undefined,
            dateOfLoss:        dateOfLoss.trim() || undefined,
            roofDamageFound:   selectedTypes.has('roof'),
            sidingDamageFound: selectedTypes.has('siding'),
          }),
        },
      );
      navigate(`/pp/new/${inspectionId}/estimate`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium mb-3">
          <span className="bg-orange-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">3</span>
          Step 3 of 10 — Property &amp; Claim Details
        </div>
        <h1 className="text-2xl font-bold text-white">Property Information</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Enter the property and claim details. You can update these later from the wizard.
        </p>
      </div>

      {/* Damage type badges */}
      {selectedTypes.size > 0 && (
        <div className="flex gap-2 flex-wrap">
          {selectedTypes.has('roof') && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">
              Roof Damage
            </span>
          )}
          {selectedTypes.has('siding') && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/30">
              Siding Damage
            </span>
          )}
        </div>
      )}

      {/* Form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-300 border-b border-zinc-800 pb-3">
          <FileText className="h-4 w-4 text-orange-400" />
          Property &amp; Claim
        </div>

        <Field label="Property Address" required hint="Street address where the damage occurred">
          <input
            className={inputCls}
            placeholder="123 Main St, Springfield, IL 62701"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Insured Name">
          <input
            className={inputCls}
            placeholder="John Smith"
            value={insuredName}
            onChange={(e) => setInsuredName(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Carrier Name">
            <input
              className={inputCls}
              placeholder="State Farm"
              value={carrierName}
              onChange={(e) => setCarrierName(e.target.value)}
            />
          </Field>
          <Field label="Date of Loss">
            <input
              className={inputCls}
              type="date"
              value={dateOfLoss}
              onChange={(e) => setDateOfLoss(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Policy Number">
            <input
              className={inputCls}
              placeholder="HO-1234567"
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
            />
          </Field>
          <Field label="Claim Number">
            <input
              className={inputCls}
              placeholder="CLM-9876543"
              value={claimNumber}
              onChange={(e) => setClaimNumber(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => navigate('/pp/new')}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {submitting ? 'Creating…' : 'Continue to Wizard'}
        </button>
      </div>
    </div>
  );
}

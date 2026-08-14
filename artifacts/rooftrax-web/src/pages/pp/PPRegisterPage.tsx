/**
 * /pp/register — PP Subscriber self-serve registration.
 *
 * Multi-step form:
 *   Step 1 — Credentials (email + password)
 *   Step 2 — Company details (name, market type, trades, AHJ)
 *   Step 3 — Payment (redirect to Stripe checkout)
 *
 * On Stripe success the browser lands on /pp/register/confirm (handled below).
 */
import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  Loader2, Lock, Building2, CreditCard,
  ChevronRight, ChevronLeft, CheckCircle2, Search,
} from 'lucide-react';

// API calls target the API-server artifact at the root /api path, not
// /rooftrax-web/api. Do NOT prepend import.meta.env.BASE_URL here.
const API = '';

// ── Confirm page (rendered when Stripe redirects back) ──────────────────────

export function PPRegisterConfirmPage() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const calledRef = useRef(false);

  // Run once on mount.
  if (!calledRef.current) {
    calledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const devPendingId = params.get('dev_pending_id');
    if (!sessionId && !devPendingId) {
      setStatus('error');
      setError('No checkout session found. Please try again.');
    } else {
      const qs = sessionId
        ? `session_id=${encodeURIComponent(sessionId)}`
        : `dev_pending_id=${encodeURIComponent(devPendingId!)}`;
      fetch(`${API}/api/pp/register/confirm?${qs}`, { credentials: 'include' })
        .then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            setError(body.error ?? 'Registration failed. Please contact support.');
            setStatus('error');
          } else {
            setStatus('ok');
            setTimeout(() => navigate('/pp/inspections'), 1500);
          }
        })
        .catch(() => {
          setError('Network error. Please refresh and try again.');
          setStatus('error');
        });
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-orange-500 mx-auto" />
            <p className="text-zinc-400">Activating your account…</p>
          </>
        )}
        {status === 'ok' && (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold text-white">Account created!</h2>
            <p className="text-zinc-400">Redirecting you to your portal…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-red-400 bg-red-900/20 border border-red-800 rounded-lg p-4">
              <p className="font-semibold">Something went wrong</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
            <button
              onClick={() => navigate('/pp/register')}
              className="text-orange-400 hover:text-orange-300 text-sm underline"
            >
              ← Back to registration
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Registration form ────────────────────────────────────────────────────────

type MarketType = 'retail' | 'insurance' | 'retail_insurance';

interface AhjCoverageRow {
  id: string;
  state: string;
  county: string;
  status: string; // 'covered' | 'in_progress'
  codeCycle: string | null;
}

const STEPS = [
  { label: 'Credentials', icon: Lock },
  { label: 'Company', icon: Building2 },
  { label: 'Payment', icon: CreditCard },
] as const;

const MARKET_OPTIONS: { value: MarketType; label: string; description: string }[] = [
  {
    value: 'retail',
    label: 'Retail',
    description: 'Homeowner-pay projects — storm damage, aging systems, upgrades',
  },
  {
    value: 'insurance',
    label: 'Insurance',
    description: 'Insurance-carrier claims — supplements, line-item negotiations',
  },
  {
    value: 'retail_insurance',
    label: 'Retail & Insurance',
    description: 'Both retail and insurance work',
  },
];

const TRADE_OPTIONS: { value: string; label: string }[] = [
  { value: 'roofing', label: 'Roofing' },
  { value: 'siding', label: 'Siding' },
];

type FieldErrors = Record<string, string[]>;

export default function PPRegisterPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Step 1 — Credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2 — Company details
  const [companyName, setCompanyName] = useState('');
  const [marketType, setMarketType] = useState<MarketType | null>(null);
  const [tradeTypes, setTradeTypes] = useState<string[]>([]);

  // Step 2 — AHJ
  const [ahjList, setAhjList] = useState<AhjCoverageRow[]>([]);
  const [ahjLoading, setAhjLoading] = useState(false);
  const [ahjSearch, setAhjSearch] = useState('');
  const [selectedAhjId, setSelectedAhjId] = useState<string | null>(null);
  const [ahjRequestMode, setAhjRequestMode] = useState(false);
  const [ahjRequestText, setAhjRequestText] = useState('');

  function fe(field: string) {
    return fieldErrors[field]?.[0];
  }

  // Fetch AHJ coverage list when entering step 1 (company step)
  useEffect(() => {
    if (step !== 1) return;
    setAhjLoading(true);
    fetch(`${API}/api/pp/ahj-coverage`)
      .then((r) => r.json())
      .then((rows: AhjCoverageRow[]) => setAhjList(rows))
      .catch(() => setAhjList([]))
      .finally(() => setAhjLoading(false));
  }, [step]);

  // Filtered AHJ list (client-side search)
  const filteredAhj = ahjSearch.trim()
    ? ahjList.filter((row) => {
        const q = ahjSearch.trim().toLowerCase();
        return row.county.toLowerCase().includes(q) || row.state.toLowerCase().includes(q);
      })
    : ahjList;

  // Validators
  function validateStep0() {
    const errs: FieldErrors = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errs.email = ['A valid email is required.'];
    if (password.length < 8)
      errs.password = ['Password must be at least 8 characters.'];
    if (password !== confirmPassword)
      errs.confirmPassword = ['Passwords do not match.'];
    return Object.keys(errs).length ? errs : null;
  }

  function validateStep1(): FieldErrors | null {
    const errs: FieldErrors = {};
    if (!companyName.trim()) errs.companyName = ['Company name is required.'];
    if (!marketType) errs.marketType = ['Please select your market type.'];
    if (tradeTypes.length === 0) errs.tradeTypes = ['Select at least one trade.'];
    if (!ahjRequestMode && !selectedAhjId)
      errs.ahj = ["Select your jurisdiction or click \"My jurisdiction isn't listed\"."];
    if (ahjRequestMode && !ahjRequestText.trim())
      errs.ahjRequest = ['Please describe your local authority (city, county, or state).'];
    return Object.keys(errs).length ? errs : null;
  }

  async function handlePayment() {
    setBusy(true);
    setApiError(null);
    try {
      const res = await fetch(`${API}/api/pp/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          email: email.trim(),
          password,
          logoObjectPath: null,
          workType: marketType,
          tradeTypes,
          ahjCoverageId: !ahjRequestMode ? selectedAhjId : null,
          ahjRequestJurisdiction: ahjRequestMode ? ahjRequestText.trim() : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setApiError(body.error ?? 'Could not start checkout. Please try again.');
        setBusy(false);
        return;
      }
      if (body.checkoutUrl) {
        window.location.href = body.checkoutUrl;
      }
    } catch {
      setApiError('Network error. Please try again.');
      setBusy(false);
    }
  }

  function handleNext() {
    setApiError(null);
    if (step === 0) {
      const errs = validateStep0();
      if (errs) { setFieldErrors(errs); return; }
      setFieldErrors({});
      setStep(1);
    } else if (step === 1) {
      const errs = validateStep1();
      if (errs) { setFieldErrors(errs); return; }
      setFieldErrors({});
      setStep(2);
    } else if (step === 2) {
      void handlePayment();
    }
  }

  function toggleTrade(trade: string) {
    setTradeTypes((prev) =>
      prev.includes(trade) ? prev.filter((t) => t !== trade) : [...prev, trade],
    );
  }

  const isLastStep = step === STEPS.length - 1;

  const nextButtonLabel = (() => {
    if (step === 1 && ahjRequestMode) return 'Save & request new AHJ';
    if (isLastStep) return 'Continue to payment';
    return 'Continue';
  })();

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="text-zinc-400 text-sm">RoofTrax Proof Package — per-package plan</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-1.5">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const done = i < step;
            return (
              <div key={s.label} className="flex items-center gap-1.5">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                    ${done
                      ? 'bg-orange-500 text-white'
                      : active
                        ? 'bg-orange-600 text-white ring-2 ring-orange-400'
                        : 'bg-zinc-800 text-zinc-500'}`}
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-px w-8 ${done ? 'bg-orange-500' : 'bg-zinc-700'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">

          {/* Step 1 — Credentials */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Create your account</h2>
                <p className="text-zinc-400 text-sm mt-0.5">
                  Choose the email and password you'll use to sign in.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                {fe('email') && <p className="text-red-400 text-xs mt-1">{fe('email')}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                {fe('password') && <p className="text-red-400 text-xs mt-1">{fe('password')}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                {fe('confirmPassword') && (
                  <p className="text-red-400 text-xs mt-1">{fe('confirmPassword')}</p>
                )}
              </div>
            </div>
          )}

          {/* Step 2 — Company details */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-white">About your company</h2>
                <p className="text-zinc-400 text-sm mt-0.5">
                  Tell us how your business operates so we can configure your account.
                </p>
              </div>

              {/* Company name */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Company name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Roofing LLC"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                {fe('companyName') && <p className="text-red-400 text-xs mt-1">{fe('companyName')}</p>}
              </div>

              {/* Market type */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-300">
                  What market do you serve?
                </label>
                <div className="space-y-2">
                  {MARKET_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMarketType(opt.value)}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors
                        ${marketType === opt.value
                          ? 'border-orange-500 bg-orange-500/10 text-white'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'}`}
                    >
                      <p className="text-sm font-semibold">{opt.label}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{opt.description}</p>
                    </button>
                  ))}
                </div>
                {fe('marketType') && <p className="text-red-400 text-xs mt-1">{fe('marketType')}</p>}
              </div>

              {/* Trade types */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-300">
                  What trade(s) do you work in?{' '}
                  <span className="text-zinc-500">(select all that apply)</span>
                </label>
                <div className="flex gap-2">
                  {TRADE_OPTIONS.map((opt) => {
                    const selected = tradeTypes.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleTrade(opt.value)}
                        className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors
                          ${selected
                            ? 'border-orange-500 bg-orange-500/10 text-white'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {fe('tradeTypes') && <p className="text-red-400 text-xs mt-1">{fe('tradeTypes')}</p>}
              </div>

              {/* AHJ */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300">
                    Select your jurisdiction (AHJ)
                  </label>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    The authority having jurisdiction that governs your work.
                  </p>
                </div>

                {!ahjRequestMode && (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                      <input
                        type="text"
                        value={ahjSearch}
                        onChange={(e) => setAhjSearch(e.target.value)}
                        placeholder="Search by county or state…"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div className="border border-zinc-700 rounded-lg overflow-hidden">
                      {ahjLoading ? (
                        <div className="flex items-center justify-center h-24 text-zinc-500 text-sm gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading jurisdictions…
                        </div>
                      ) : filteredAhj.length === 0 ? (
                        <div className="flex items-center justify-center h-24 text-zinc-500 text-sm">
                          {ahjList.length === 0
                            ? 'No covered jurisdictions yet.'
                            : 'No results match your search.'}
                        </div>
                      ) : (
                        <div className="max-h-44 overflow-y-auto divide-y divide-zinc-800">
                          {filteredAhj.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              onClick={() => setSelectedAhjId(row.id)}
                              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors
                                ${selectedAhjId === row.id
                                  ? 'bg-orange-500/10 text-white'
                                  : 'text-zinc-300 hover:bg-zinc-800/60'}`}
                            >
                              <span className="font-medium">
                                {row.county}, {row.state}
                              </span>
                              <span
                                className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium
                                  ${row.status === 'covered'
                                    ? 'bg-green-900/40 text-green-400'
                                    : 'bg-yellow-900/40 text-yellow-400'}`}
                              >
                                {row.status === 'covered' ? 'Covered' : 'Coming soon'}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {fe('ahj') && <p className="text-red-400 text-xs">{fe('ahj')}</p>}
                  </>
                )}

                {ahjRequestMode && (
                  <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-3">
                    <p className="text-sm font-medium text-zinc-300">Describe your local authority</p>
                    <p className="text-xs text-zinc-500">
                      Enter the city, county, or state that governs your work. We'll review it and
                      add coverage — you'll still advance to payment now.
                    </p>
                    <input
                      type="text"
                      value={ahjRequestText}
                      onChange={(e) => setAhjRequestText(e.target.value)}
                      placeholder="e.g. Fairfax County, VA or City of Richmond"
                      className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    {fe('ahjRequest') && <p className="text-red-400 text-xs">{fe('ahjRequest')}</p>}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setAhjRequestMode((m) => !m);
                    setSelectedAhjId(null);
                    setFieldErrors({});
                  }}
                  className="text-xs text-orange-400 hover:text-orange-300 underline-offset-2 underline"
                >
                  {ahjRequestMode
                    ? '← Back to jurisdiction list'
                    : "My jurisdiction isn't listed"}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Payment */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Review & payment</h2>
                <p className="text-zinc-400 text-sm mt-0.5">
                  Confirm your details before proceeding to checkout.
                </p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between text-zinc-300">
                  <span>Email</span>
                  <span className="font-medium text-white">{email}</span>
                </div>
                <div className="border-t border-zinc-700/60 pt-2 flex justify-between text-zinc-300">
                  <span>Company</span>
                  <span className="font-medium text-white">{companyName}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Market</span>
                  <span className="font-medium text-white">
                    {marketType === 'retail_insurance'
                      ? 'Retail & Insurance'
                      : marketType === 'retail'
                        ? 'Retail'
                        : 'Insurance'}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Trades</span>
                  <span className="font-medium text-white capitalize">
                    {tradeTypes.join(', ')}
                  </span>
                </div>
                <div className="border-t border-zinc-700 pt-2 flex justify-between">
                  <span className="text-zinc-300">Plan</span>
                  <span className="font-semibold text-white">Per-Package</span>
                </div>
              </div>
              <p className="text-zinc-400 text-xs">
                Clicking "Continue to payment" will redirect you to our secure payment processor.
                Your card details are handled by Stripe and never touch our servers.
              </p>
              {apiError && <p className="text-red-400 text-sm">{apiError}</p>}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => {
                setStep((s) => s - 1);
                setApiError(null);
                setFieldErrors({});
              }}
              disabled={busy}
              className="flex items-center gap-1 px-4 py-2 border border-zinc-700 rounded-lg text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors text-sm"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 font-semibold text-sm transition-colors"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {nextButtonLabel}
            {!isLastStep && !busy && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>

        <a
          href="/rooftrax-web/pp/login"
          className="flex items-center justify-center w-full border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white rounded-lg px-4 py-2.5 font-semibold text-sm transition-colors"
        >
          Already Have An Account?
        </a>
      </div>
    </div>
  );
}

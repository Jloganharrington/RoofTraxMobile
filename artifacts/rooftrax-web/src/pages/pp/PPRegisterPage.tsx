/**
 * /pp/register — PP Subscriber self-serve registration.
 *
 * Multi-step form:
 *   Step 1 — Company info (name)
 *   Step 2 — Logo upload
 *   Step 3 — Account credentials (email + password)
 *   Step 4 — Payment (redirect to Stripe checkout)
 *
 * On Stripe success the browser lands on /pp/register/confirm (handled below).
 */
import { useState, useRef } from 'react';
import { useLocation } from 'wouter';
import { Loader2, Building2, Image, Lock, CreditCard, ChevronRight, ChevronLeft, CheckCircle2 } from 'lucide-react';

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
      const qs = sessionId ? `session_id=${encodeURIComponent(sessionId)}` : `dev_pending_id=${encodeURIComponent(devPendingId!)}`;
      fetch(`${API}/api/pp/register/confirm?${qs}`, { credentials: 'include' })
        .then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            setError(body.error ?? 'Registration failed. Please contact support.');
            setStatus('error');
          } else {
            setStatus('ok');
            setTimeout(() => navigate('/pp/portal'), 1500);
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

const STEPS = [
  { label: 'Company', icon: Building2 },
  { label: 'Logo', icon: Image },
  { label: 'Credentials', icon: Lock },
  { label: 'Payment', icon: CreditCard },
] as const;

type FieldErrors = Record<string, string[]>;

export default function PPRegisterPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [logoObjectPath, setLogoObjectPath] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function fe(field: string) {
    return fieldErrors[field]?.[0];
  }

  // Step 1 — Company name
  function validateStep1() {
    if (!companyName.trim()) return { companyName: ['Company name is required.'] };
    return null;
  }

  // Step 2 — Logo (optional)
  async function handleLogoUpload(file: File) {
    setBusy(true);
    setApiError(null);
    try {
      // Request a pre-signed upload URL from the existing storage endpoint.
      const urlRes = await fetch(`${API}/api/storage/upload-url`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, fileName: file.name }),
      });
      if (!urlRes.ok) {
        setApiError('Could not get upload URL. You can skip the logo for now.');
        return;
      }
      const { uploadURL, objectPath } = await urlRes.json();
      await fetch(uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      setLogoObjectPath(objectPath);
      setLogoPreview(URL.createObjectURL(file));
    } catch {
      setApiError('Logo upload failed. You can skip it for now.');
    } finally {
      setBusy(false);
    }
  }

  // Step 3 — Credentials
  function validateStep3() {
    const errs: FieldErrors = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = ['A valid email is required.'];
    if (password.length < 8) errs.password = ['Password must be at least 8 characters.'];
    if (password !== confirmPassword) errs.confirmPassword = ['Passwords do not match.'];
    return Object.keys(errs).length ? errs : null;
  }

  // Step 4 — Submit to Stripe
  async function handlePayment() {
    setBusy(true);
    setApiError(null);
    try {
      const res = await fetch(`${API}/api/pp/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: companyName.trim(), email: email.trim(), password, logoObjectPath }),
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
      const errs = validateStep1();
      if (errs) { setFieldErrors(errs); return; }
      setFieldErrors({});
      setStep(1);
    } else if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      const errs = validateStep3();
      if (errs) { setFieldErrors(errs); return; }
      setFieldErrors({});
      setStep(3);
    } else if (step === 3) {
      void handlePayment();
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="text-zinc-400 text-sm">RoofTrax Proof Package — per-package plan</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const done = i < step;
            return (
              <div key={s.label} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                    ${done ? 'bg-orange-500 text-white' : active ? 'bg-orange-600 text-white ring-2 ring-orange-400' : 'bg-zinc-800 text-zinc-500'}`}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
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
          {/* Step 1 — Company name */}
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">Company information</h2>
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
            </div>
          )}

          {/* Step 2 — Logo (deferred — added after account creation from portal settings) */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">Company logo</h2>
              <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-6 flex flex-col items-center gap-3 text-center">
                <Image className="h-10 w-10 text-zinc-500" />
                <p className="text-zinc-300 text-sm font-medium">Add your logo after sign-up</p>
                <p className="text-zinc-500 text-xs">
                  Your logo appears on every Proof Package. You can upload it from your account settings once your account is ready. Click Continue to proceed.
                </p>
              </div>
            </div>
          )}

          {/* Step 3 — Credentials */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">Account credentials</h2>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Work email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
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
                {fe('confirmPassword') && <p className="text-red-400 text-xs mt-1">{fe('confirmPassword')}</p>}
              </div>
            </div>
          )}

          {/* Step 4 — Payment */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">Payment</h2>
              <div className="bg-zinc-800 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between text-zinc-300">
                  <span>Company</span>
                  <span className="font-medium text-white">{companyName}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Email</span>
                  <span className="font-medium text-white">{email}</span>
                </div>
                <div className="border-t border-zinc-700 pt-2 flex justify-between">
                  <span className="text-zinc-300">Plan</span>
                  <span className="font-semibold text-white">Per-Package</span>
                </div>
              </div>
              <p className="text-zinc-400 text-xs">
                Clicking "Continue to payment" will redirect you to our secure payment processor. Your card details are handled by Stripe and never touch our servers.
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
              onClick={() => { setStep((s) => s - 1); setApiError(null); setFieldErrors({}); }}
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
            {step < 3 ? (
              <>{step === 1 && !logoObjectPath ? 'Skip for now' : 'Continue'} <ChevronRight className="h-4 w-4" /></>
            ) : (
              'Continue to payment'
            )}
          </button>
        </div>

        <p className="text-center text-zinc-500 text-xs">
          Already have an account?{' '}
          <a href="/rooftrax-web/pp/login" className="text-orange-400 hover:text-orange-300">
            Log in
          </a>
        </p>
      </div>
    </div>
  );
}

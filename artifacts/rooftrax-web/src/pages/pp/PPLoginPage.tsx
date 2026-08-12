/**
 * /pp/login — PP Subscriber email + password login.
 *
 * On success: redirects to /pp/portal (or returnTo query param).
 * "Forgot password" link sends a reset email via POST /api/pp/password-reset.
 */
import { useState, FormEvent } from 'react';
import { useLocation } from 'wouter';
import { Loader2, CheckCircle2 } from 'lucide-react';

// API calls target the API-server artifact at the root /api path.
// Do NOT prepend import.meta.env.BASE_URL here.
const API = '';

export default function PPLoginPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot password state
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/pp/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Login failed. Please try again.');
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get('returnTo') ?? '/pp/portal';
      navigate(returnTo);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResetRequest(e: FormEvent) {
    e.preventDefault();
    setResetError(null);
    if (!resetEmail.trim()) {
      setResetError('Enter your email address.');
      return;
    }
    setResetBusy(true);
    try {
      await fetch(`${API}/api/pp/password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim() }),
      });
      setResetSent(true);
    } catch {
      setResetError('Network error. Please try again.');
    } finally {
      setResetBusy(false);
    }
  }

  if (showReset) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-white">Reset password</h1>
            <p className="text-zinc-400 text-sm">We'll send a reset link to your email.</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            {resetSent ? (
              <div className="text-center space-y-3">
                <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                <p className="text-zinc-300 text-sm">If an account with that email exists, a reset link has been sent. Check your inbox.</p>
                <button onClick={() => setShowReset(false)} className="text-orange-400 hover:text-orange-300 text-sm underline">
                  Back to login
                </button>
              </div>
            ) : (
              <form onSubmit={handleResetRequest} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Email address</label>
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  {resetError && <p className="text-red-400 text-xs mt-1">{resetError}</p>}
                </div>
                <button
                  type="submit"
                  disabled={resetBusy}
                  className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 font-semibold text-sm transition-colors"
                >
                  {resetBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send reset link
                </button>
                <button
                  type="button"
                  onClick={() => setShowReset(false)}
                  className="w-full text-zinc-400 hover:text-white text-sm"
                >
                  Cancel
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">Sign in</h1>
          <p className="text-zinc-400 text-sm">RoofTrax Proof Package</p>
        </div>

        {/* Form */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {error && (
              <div className="text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 font-semibold text-sm transition-colors"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </button>

            <button
              type="button"
              onClick={() => { setShowReset(true); setResetEmail(email); }}
              className="w-full text-center text-zinc-400 hover:text-zinc-300 text-sm"
            >
              Forgot password?
            </button>
          </form>
        </div>

        <p className="text-center text-zinc-500 text-xs">
          Don't have an account?{' '}
          <a href="/rooftrax-web/pp/register" className="text-orange-400 hover:text-orange-300">
            Get started
          </a>
        </p>
      </div>
    </div>
  );
}

// ── Password reset confirm page ──────────────────────────────────────────────

export function PPResetPasswordPage() {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/pp/password-reset/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Reset failed. The link may have expired.'); return; }
      setSuccess(true);
      setTimeout(() => navigate('/pp/login'), 2000);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <p className="text-red-400">Invalid reset link.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Set new password</h1>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          {success ? (
            <div className="text-center space-y-2">
              <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
              <p className="text-zinc-300 text-sm">Password updated! Redirecting to login…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 font-semibold text-sm transition-colors"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Update password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

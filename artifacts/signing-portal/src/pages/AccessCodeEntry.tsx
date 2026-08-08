/**
 * AccessCodeEntry — the landing page where customers enter their portal code.
 *
 * Uses the generated getPortalContract() function (imperative, not a hook) to
 * validate the code exists before navigating — no customFetch hand-wiring.
 */

import { useState } from 'react';
import { useLocation } from 'wouter';
import { Shield, ArrowRight, Loader2 } from 'lucide-react';
import { getPortalContract } from '@workspace/api-client-react';

export default function AccessCodeEntry() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setError('Please enter your access code.'); return; }
    setError('');
    setLoading(true);
    try {
      // Validate the code resolves to a real, available contract.
      // getPortalContract() is the generated imperative async function —
      // it throws on non-2xx, so any error means "don't navigate".
      await getPortalContract(encodeURIComponent(trimmed));
      navigate(`/contract/${encodeURIComponent(trimmed)}`);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        setError('Code not found or expired. Please check the link sent to you.');
      } else if (status === 410) {
        setError('This contract is no longer active. Please contact your contractor.');
      } else if (status === 429) {
        setError('Too many attempts. Please wait a minute and try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary flex items-center justify-center">
            <Shield className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Contract Portal</h1>
          <p className="text-sm text-muted-foreground">
            Enter the access code from the link sent to you to view and sign your contract.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="code" className="text-sm font-medium">
              Access Code
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
              placeholder="e.g. A1B2C3D4"
              autoComplete="off"
              spellCheck={false}
              className="w-full h-11 px-3 rounded-lg border bg-card text-sm font-mono tracking-widest placeholder:tracking-normal placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {error && <p className="text-destructive text-xs">{error}</p>}
          </div>
          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>View My Contract <ArrowRight className="h-4 w-4" /></>
            )}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Your access code was included in the email or text from your contractor.
        </p>
      </div>
    </div>
  );
}

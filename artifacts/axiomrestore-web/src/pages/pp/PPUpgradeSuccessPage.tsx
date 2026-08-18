/**
 * /pp/upgrade/success — Post-upgrade confirmation page.
 *
 * Stripe redirects here after a successful checkout.session.completed
 * for kind = 'pp_crm_upgrade'.  Rather than using a fixed timeout, we poll
 * GET /api/pp/upgrade/status to confirm the webhook has fulfilled the upgrade
 * before declaring success.  If polling times out, a "Retry setup" button
 * calls POST /api/pp/upgrade/reconcile to idempotently re-apply the upgrade.
 *
 * Query params: ?session_id=... (Stripe checkout session ID) | ?dev=1
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, ArrowRight, RefreshCw, AlertTriangle } from 'lucide-react';

type Phase = 'polling' | 'upgraded' | 'timed_out' | 'reconciling' | 'reconcile_error';

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 20; // 40 seconds total

export default function PPUpgradeSuccessPage() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id') ?? '';
  const isDev = params.get('dev') === '1';

  const [phase, setPhase] = useState<Phase>(isDev ? 'upgraded' : 'polling');
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const pollCount = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (phase !== 'polling') return;

    const poll = async () => {
      try {
        const res = await fetch('/api/pp/upgrade/status', { credentials: 'include' });
        if (res.ok) {
          const data = (await res.json()) as { upgraded: boolean };
          if (data.upgraded) {
            setPhase('upgraded');
            return;
          }
        }
      } catch {
        // Network error — keep polling.
      }

      pollCount.current += 1;
      if (pollCount.current >= MAX_POLLS) {
        setPhase('timed_out');
        return;
      }
      timer.current = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer.current = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase]);

  const reconcile = async () => {
    setPhase('reconciling');
    setReconcileError(null);
    try {
      const res = await fetch('/api/pp/upgrade/reconcile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json()) as { upgraded?: boolean; error?: string };
      if (data.upgraded) {
        setPhase('upgraded');
      } else {
        setPhase('reconcile_error');
        setReconcileError(data.error ?? 'Setup failed. Please contact support.');
      }
    } catch {
      setPhase('reconcile_error');
      setReconcileError('Network error. Please check your connection and try again.');
    }
  };

  const isLoading = phase === 'polling' || phase === 'reconciling';
  const isSuccess = phase === 'upgraded';

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Status icon */}
        <div className="flex justify-center">
          {isSuccess ? (
            <CheckCircle2 className="h-16 w-16 text-green-400" />
          ) : phase === 'timed_out' || phase === 'reconcile_error' ? (
            <AlertTriangle className="h-16 w-16 text-yellow-400" />
          ) : (
            <Loader2 className="h-16 w-16 text-orange-500 animate-spin" />
          )}
        </div>

        {/* Heading & body */}
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold">
            {isSuccess
              ? 'Welcome to AxiomRestore CRM!'
              : phase === 'timed_out'
                ? 'Still setting up…'
                : phase === 'reconcile_error'
                  ? 'Setup needs attention'
                  : phase === 'reconciling'
                    ? 'Activating your account…'
                    : 'Setting up your account…'}
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed">
            {isSuccess
              ? 'Your account has been upgraded. All your existing inspections and Proof Packages are ready in the full CRM dashboard.'
              : phase === 'timed_out'
                ? 'Your payment was received but account activation is taking longer than expected. Click the button below to complete setup.'
                : phase === 'reconcile_error'
                  ? reconcileError ?? 'Please contact support if this continues.'
                  : 'We\'re provisioning your CRM access. This usually takes a few seconds.'}
          </p>
        </div>

        {/* Actions */}
        {isSuccess && (
          <div className="space-y-3">
            <a
              href="/axiomrestore-web/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
            >
              Go to Dashboard <ArrowRight className="h-4 w-4" />
            </a>
            <div className="text-xs text-zinc-600 pt-2 space-y-1">
              <p>A confirmation email is on its way to your inbox.</p>
              <p>
                Already upgraded but still seeing the PP portal?{' '}
                <a
                  href="/axiomrestore-web/pp/login"
                  className="text-zinc-400 hover:text-zinc-200 underline"
                >
                  Log in again
                </a>{' '}
                to refresh your session.
              </p>
            </div>
          </div>
        )}

        {(phase === 'timed_out' || phase === 'reconcile_error') && (
          <div className="space-y-3">
            {sessionId ? (
              <button
                onClick={reconcile}
                disabled={isLoading}
                className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Complete Account Setup
              </button>
            ) : (
              <p className="text-sm text-zinc-400">
                Please contact support to complete your account setup.
              </p>
            )}
            <p className="text-xs text-zinc-600">
              Your payment has been received. This step only activates CRM access.
            </p>
          </div>
        )}

        {isLoading && (
          <p className="text-xs text-zinc-600 animate-pulse">
            {phase === 'reconciling' ? 'Activating…' : 'Verifying upgrade status…'}
          </p>
        )}
      </div>
    </div>
  );
}

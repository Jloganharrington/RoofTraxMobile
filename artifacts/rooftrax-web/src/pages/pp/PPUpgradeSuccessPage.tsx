/**
 * /pp/upgrade/success — Post-upgrade confirmation page.
 *
 * Stripe redirects here after a successful checkout.session.completed
 * for kind = 'pp_crm_upgrade'.  The webhook is the authoritative fulfillment
 * path; this page just shows a friendly confirmation.
 *
 * Query params: ?session_id=... (Stripe checkout session ID) | ?dev=1 (dev bypass)
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ArrowRight } from 'lucide-react';

export default function PPUpgradeSuccessPage() {
  const [ready, setReady] = useState(false);

  // Give the webhook a moment to run before we tell the user to go to the
  // dashboard — usually well under 1 second in production.
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Success icon */}
        <div className="flex justify-center">
          {ready ? (
            <CheckCircle2 className="h-16 w-16 text-green-400" />
          ) : (
            <Loader2 className="h-16 w-16 text-orange-500 animate-spin" />
          )}
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold">
            {ready ? 'Welcome to RoofTrax CRM!' : 'Setting up your account…'}
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed">
            {ready
              ? 'Your account has been upgraded. All your existing inspections and Proof Packages are ready in the full CRM dashboard.'
              : 'We\'re provisioning your CRM access. This only takes a moment.'}
          </p>
        </div>

        {ready && (
          <div className="space-y-3">
            <a
              href="/rooftrax-web/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
            >
              Go to Dashboard <ArrowRight className="h-4 w-4" />
            </a>

            <div className="text-xs text-zinc-600 pt-2 space-y-1">
              <p>A confirmation email is on its way to your inbox.</p>
              <p>
                Already upgraded but still seeing the PP portal?{' '}
                <a
                  href="/rooftrax-web/pp/login"
                  className="text-zinc-400 hover:text-zinc-200 underline"
                >
                  Log in again
                </a>{' '}
                to refresh your session.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

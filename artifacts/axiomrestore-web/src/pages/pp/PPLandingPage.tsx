/**
 * /pp — PP Subscriber Portal entry point.
 *
 * Authenticated users are forwarded straight to /pp/inspections.
 * Unauthenticated visitors see a branded landing page with Sign In
 * and Create Account CTAs.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';
import logoDark from '@/assets/logo-dark.png';

export default function PPLandingPage() {
  const [, navigate] = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/pp/me', { credentials: 'include' })
      .then(async (r) => {
        if (r.ok) {
          const body = await r.json().catch(() => ({})) as { company?: { ppTier?: string } };
          if (body.company?.ppTier === 'crm') {
            // Upgraded subscriber — send to the CRM dashboard.
            window.location.href = '/axiomrestore-web/';
          } else {
            // PP-only subscriber — send to the per-package portal.
            navigate('/pp/inspections');
          }
        }
      })
      .catch(() => {/* network error — just show the landing page */})
      .finally(() => setChecking(false));
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-8">

        {/* Brand */}
        <div className="text-center space-y-3">
          <img src={logoDark} alt="AxiomRestore" className="h-10 w-auto mx-auto" />
          <div>
            <p className="text-zinc-300 font-semibold">Proof Package Portal</p>
            <p className="text-zinc-500 text-sm mt-1">
              Your field evidence, compiled into contractor-grade packages.
            </p>
          </div>
        </div>

        {/* CTAs */}
        <div className="space-y-3">
          <a
            href="/axiomrestore-web/pp/login"
            className="flex items-center justify-center w-full bg-orange-600 hover:bg-orange-500 text-white rounded-lg px-4 py-3 font-semibold text-sm transition-colors"
          >
            Sign in
          </a>
          <a
            href="/axiomrestore-web/pp/register"
            className="flex items-center justify-center w-full border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white rounded-lg px-4 py-3 font-semibold text-sm transition-colors"
          >
            Create account
          </a>
        </div>

      </div>
    </div>
  );
}

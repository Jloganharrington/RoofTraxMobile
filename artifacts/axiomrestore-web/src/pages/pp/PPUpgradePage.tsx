/**
 * /pp/upgrade — Self-Serve CRM Upgrade Page
 *
 * Accessible by:
 *  - Authenticated PP-only subscribers → shows plans + credit callout + checkout
 *  - Unauthenticated visitors           → shows plans; "Choose Plan" redirects to login
 *  - Authenticated CRM users            → redirects to dashboard (/)
 *
 * Pulls plan data from GET /api/pricing/config.
 * Credit data from GET /api/pp/upgrade/credit (PP sessions only).
 * Checkout via POST /api/pp/upgrade/checkout.
 */
import { useEffect, useState } from 'react';
import { Loader2, Check, Zap, ArrowRight, Star } from 'lucide-react';

interface Plan {
  id: string;
  planKey: string;
  displayName: string;
  annualCents: number;
  setupAnnualCents: number;
  setupInstallmentCents: number;
  committedClaims: number;
  sortOrder: number;
  active: boolean;
}

interface BillingTerm {
  id: string;
  termKey: string;
  displayName: string;
  installments: number;
  multiplier: string;
}

interface PricingConfig {
  plans: Plan[];
  billingTerms: BillingTerm[];
}

interface CreditInfo {
  creditCents: number;
  eligibleDaysRemaining: number;
}

type SessionStatus = 'loading' | 'pp_only' | 'crm' | 'unauthenticated';

const PLAN_FEATURES: Record<string, string[]> = {
  solo: ['1 rep', 'All insurance workflows', 'Proof Package compiler', 'Mobile app', 'AHJ library'],
  crew: ['Up to 5 reps', 'All insurance workflows', 'Proof Package compiler', 'Mobile app', 'AHJ library', 'Team management'],
  team: ['Up to 15 reps', 'All insurance workflows', 'Proof Package compiler', 'Mobile app', 'AHJ library', 'Team management', 'Pipeline analytics'],
  fleet: ['Up to 40 reps', 'All insurance workflows', 'Proof Package compiler', 'Mobile app', 'AHJ library', 'Team management', 'Pipeline analytics', 'Priority support'],
  regional: ['Unlimited reps', 'All insurance workflows', 'Proof Package compiler', 'Mobile app', 'AHJ library', 'Team management', 'Pipeline analytics', 'Priority support', 'Custom onboarding'],
};

const DEFAULT_FEATURES = ['All insurance workflows', 'Proof Package compiler', 'Mobile app', 'AHJ library'];

function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function monthlyFromAnnual(annualCents: number, termKey: string, multiplier: string, installments: number): number {
  const annual = Math.round(annualCents * Number(multiplier));
  if (termKey === 'annual') return Math.round(annual / 12);
  return Math.round(annual / (installments || 12));
}

export default function PPUpgradePage() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [credit, setCredit] = useState<CreditInfo | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<string>('annual');
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  // Check PP session and redirect CRM users
  useEffect(() => {
    fetch('/api/pp/me', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) {
          setSessionStatus('unauthenticated');
          return;
        }
        const body = await r.json() as { company: { ppTier: string } };
        if (body.company.ppTier === 'crm') {
          // Already on CRM — redirect to dashboard
          window.location.href = '/axiomrestore-web/';
          return;
        }
        setSessionStatus('pp_only');
        // Fetch credit info for PP subscribers
        fetch('/api/pp/upgrade/credit', { credentials: 'include' })
          .then(async (cr) => {
            if (cr.ok) setCredit(await cr.json() as CreditInfo);
          })
          .catch(() => {});
      })
      .catch(() => setSessionStatus('unauthenticated'));
  }, []);

  // Fetch pricing config (public — no auth required)
  useEffect(() => {
    fetch('/api/pricing/config')
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json() as PricingConfig;
        setConfig(data);
        // Pre-select the crew plan if available, otherwise first active plan
        const active = data.plans.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder);
        const crew = active.find((p) => p.planKey === 'crew') ?? active[0];
        if (crew) setSelectedPlan(crew.planKey);
      })
      .catch(() => {})
      .finally(() => setConfigLoading(false));
  }, []);

  const handleChoosePlan = async (planKey: string) => {
    if (sessionStatus === 'unauthenticated') {
      // Save intent and redirect to login
      window.location.href = `/axiomrestore-web/pp/login?returnTo=${encodeURIComponent('/axiomrestore-web/pp/upgrade')}`;
      return;
    }

    setCheckingOut(true);
    setError(null);
    setSelectedPlan(planKey);

    try {
      const res = await fetch('/api/pp/upgrade/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey, billingTerm: selectedTerm }),
      });
      const body = await res.json() as { checkoutUrl?: string; error?: string };
      if (!res.ok || !body.checkoutUrl) {
        throw new Error(body.error ?? 'Checkout failed. Please try again.');
      }
      window.location.href = body.checkoutUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Checkout failed. Please try again.');
      setCheckingOut(false);
    }
  };

  const activePlans = (config?.plans ?? []).filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const terms = config?.billingTerms ?? [];
  const currentTerm = terms.find((t) => t.termKey === selectedTerm) ?? terms[0];
  const annualTerm = terms.find((t) => t.termKey === 'annual');

  const hasCreditCallout = credit && credit.creditCents > 0;

  if (sessionStatus === 'loading' || configLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-orange-500" />
            <span className="font-bold text-white">AxiomRestore</span>
          </div>
          {sessionStatus === 'unauthenticated' && (
            <a
              href="/axiomrestore-web/pp/login"
              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Log in
            </a>
          )}
          {sessionStatus === 'pp_only' && (
            <a
              href="/axiomrestore-web/pp/settings"
              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              ← Back to Settings
            </a>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-12 space-y-10">
        {/* Hero */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Upgrade to Full CRM
          </h1>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            Get the complete AxiomRestore platform — lead pipelines, team management,
            insurance workflows, and the full mobile field app.
          </p>
        </div>

        {/* Credit callout */}
        {hasCreditCallout && (
          <div className="max-w-2xl mx-auto bg-orange-500/10 border border-orange-500/30 rounded-xl px-5 py-4 flex items-start gap-3">
            <Star className="h-5 w-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-300">
                You have {formatDollars(credit!.creditCents)} in package spend credit
              </p>
              <p className="text-xs text-orange-400/80 mt-0.5">
                Applied to your first invoice when you upgrade —{' '}
                {credit!.eligibleDaysRemaining} day{credit!.eligibleDaysRemaining !== 1 ? 's' : ''} remaining.
              </p>
            </div>
          </div>
        )}

        {/* Billing toggle */}
        {terms.length > 1 && (
          <div className="flex justify-center">
            <div className="inline-flex bg-zinc-800 rounded-lg p-1 gap-1">
              {terms.map((t) => (
                <button
                  key={t.termKey}
                  onClick={() => setSelectedTerm(t.termKey)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    selectedTerm === t.termKey
                      ? 'bg-orange-500 text-white shadow'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t.displayName}
                  {t.termKey === 'annual' && (
                    <span className="ml-1.5 text-[10px] font-semibold bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
                      Save ~17%
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="max-w-2xl mx-auto bg-red-900/20 border border-red-800 text-red-400 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Plan cards */}
        {activePlans.length === 0 ? (
          <p className="text-center text-zinc-500">Plans are loading…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {activePlans.map((plan) => {
              const features = PLAN_FEATURES[plan.planKey] ?? DEFAULT_FEATURES;
              const isPopular = plan.planKey === 'crew';
              const isSelected = selectedPlan === plan.planKey;
              const monthlyCents = currentTerm
                ? monthlyFromAnnual(plan.annualCents, currentTerm.termKey, currentTerm.multiplier, currentTerm.installments)
                : Math.round(plan.annualCents / 12);
              const annualMonthlyCents = annualTerm
                ? monthlyFromAnnual(plan.annualCents, annualTerm.termKey, annualTerm.multiplier, annualTerm.installments)
                : Math.round(plan.annualCents / 12);

              return (
                <div
                  key={plan.planKey}
                  className={`relative rounded-2xl border p-5 flex flex-col gap-4 transition-all ${
                    isPopular
                      ? 'border-orange-500/60 bg-orange-500/5 shadow-lg shadow-orange-500/10'
                      : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                  } ${isSelected ? 'ring-2 ring-orange-500/40' : ''}`}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-orange-500 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                      {plan.displayName}
                    </p>
                    <p className="text-2xl font-extrabold mt-1">
                      {formatDollars(monthlyCents)}
                      <span className="text-sm font-normal text-zinc-400">/mo</span>
                    </p>
                    {selectedTerm !== 'annual' && annualTerm && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {formatDollars(annualMonthlyCents)}/mo billed annually
                      </p>
                    )}
                    <p className="text-xs text-zinc-500 mt-1">
                      {plan.committedClaims.toLocaleString()} claims/year included
                    </p>
                  </div>

                  <ul className="space-y-1.5 flex-1">
                    {features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-zinc-300">
                        <Check className="h-3.5 w-3.5 text-orange-400 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => void handleChoosePlan(plan.planKey)}
                    disabled={checkingOut && selectedPlan === plan.planKey}
                    className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60 ${
                      isPopular
                        ? 'bg-orange-500 hover:bg-orange-600 text-white'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                    }`}
                  >
                    {checkingOut && selectedPlan === plan.planKey ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting…</>
                    ) : sessionStatus === 'unauthenticated' ? (
                      <>Log in to upgrade <ArrowRight className="h-3.5 w-3.5" /></>
                    ) : (
                      <>Choose {plan.displayName} <ArrowRight className="h-3.5 w-3.5" /></>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        <p className="text-center text-xs text-zinc-600">
          All plans include your existing inspections and Proof Packages.
          {selectedTerm === 'annual' && ' Billed annually. Cancel anytime.'}
          {' '}Questions? Reply to any email from us.
        </p>
      </div>
    </div>
  );
}

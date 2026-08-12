import { useState, useEffect } from "react";
import { MarketingLayout } from "../../components/layout/MarketingLayout";
import { CheckCircle2, ChevronDown, ChevronUp, Info, AlertTriangle, ArrowRight } from "lucide-react";

export default function PricingPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Calculator State
  const [inputMode, setInputMode] = useState<"headcount" | "volume">("headcount");
  const [reps, setReps] = useState(2);
  const [canvassers, setCanvassers] = useState(4);
  const [directClaims, setDirectClaims] = useState(500);
  const [billingTerm, setBillingTerm] = useState("annual");
  const [featureTier, setFeatureTier] = useState("standard");

  // Form State
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/pricing/config");
        if (!res.ok) throw new Error("Failed to load pricing configuration.");
        const data = await res.json();
        setConfig(data);
        if (data.billingTerms?.length) setBillingTerm("annual");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  if (loading) {
    return (
      <MarketingLayout>
        <div className="flex-1 flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse flex flex-col items-center gap-4">
            <div className="h-8 w-8 rounded-full bg-orange-500/50" />
            <div className="text-zinc-500 uppercase font-bold tracking-widest text-xs">Loading Pricing...</div>
          </div>
        </div>
      </MarketingLayout>
    );
  }

  if (error || !config) {
    return (
      <MarketingLayout>
        <div className="flex-1 flex items-center justify-center min-h-[50vh]">
          <div className="text-red-500 bg-red-500/10 border border-red-500/20 p-6 max-w-md text-center">
            <AlertTriangle className="h-8 w-8 mx-auto mb-4" />
            <h2 className="text-sm font-black uppercase tracking-widest mb-2">Error Loading Pricing</h2>
            <p className="text-sm font-bold">{error}</p>
          </div>
        </div>
      </MarketingLayout>
    );
  }

  // Computed Values
  const computedClaims = inputMode === "headcount" ? (reps * 52) + (canvassers * 78) : directClaims;
  
  // Find recommended plan
  const plans = config.plans || [];
  let recommendedPlan = plans[plans.length - 1]; // default to largest
  for (const p of plans) {
    if (p.committed_claims >= computedClaims) {
      recommendedPlan = p;
      break;
    }
  }

  const termObj = config.billingTerms.find((t: any) => t.term_key === billingTerm) || config.billingTerms[0];
  const featureObj = config.featureTiers.find((f: any) => f.tier_key === featureTier) || config.featureTiers[0];

  const annualCommitment = recommendedPlan.annual_cents * Number(termObj.multiplier);
  const featureTierAnnual = featureObj.monthly_cents * 12;
  const setup = billingTerm === "annual" ? recommendedPlan.setup_annual_cents : recommendedPlan.setup_installment_cents;
  const firstYearTotal = annualCommitment + featureTierAnnual + setup;
  const effectiveDollarsPerClaim = recommendedPlan.annual_cents / recommendedPlan.committed_claims / 100;

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/pricing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planKey: recommendedPlan.plan_key,
          billingTerm,
          featureTierKey: featureTier,
          email,
          companyName,
          applyCredit: false
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Checkout failed");
      setIsSubmitting(false);
    }
  };

  const formatMoney = (cents: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
  };

  return (
    <MarketingLayout>
      {/* Section A */}
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950 text-center flex flex-col items-center">
        <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-none mb-6 tracking-tight max-w-4xl">
          You pay per claim. <span className="text-orange-500">Seats are free.</span>
        </h1>
        <p className="text-lg md:text-xl text-zinc-400 uppercase tracking-wide font-bold max-w-2xl">
          Hire all the reps and canvassers you want. We charge for the work, not the people.
        </p>
      </section>

      {/* Section B */}
      <section className="px-6 md:px-20 pb-24 bg-zinc-950">
        <div className="max-w-4xl mx-auto bg-orange-500 p-8 md:p-12 text-black shadow-[0_0_40px_rgba(249,115,22,0.15)]">
          <p className="text-2xl md:text-3xl font-black uppercase tracking-tight leading-snug">
            You already pay $30-$70 for a measurement report. That gets you geometry. For about the same, RoofTrax builds the whole file.
          </p>
        </div>
      </section>

      {/* Section C: Quote Calculator */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
            Live Quote Calculator
          </div>

          <div className="grid md:grid-cols-2 gap-16 items-start">
            {/* Inputs */}
            <div className="space-y-10">
              
              <div className="space-y-6">
                <div className="flex border-b border-white/10">
                  <button 
                    onClick={() => setInputMode("headcount")}
                    className={`pb-4 px-4 text-xs font-black uppercase tracking-widest transition-colors border-b-2 ${inputMode === "headcount" ? "border-orange-500 text-white" : "border-transparent text-zinc-500 hover:text-white"}`}
                  >
                    By Headcount
                  </button>
                  <button 
                    onClick={() => setInputMode("volume")}
                    className={`pb-4 px-4 text-xs font-black uppercase tracking-widest transition-colors border-b-2 ${inputMode === "volume" ? "border-orange-500 text-white" : "border-transparent text-zinc-500 hover:text-white"}`}
                  >
                    By Claim Volume
                  </button>
                </div>

                {inputMode === "headcount" ? (
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-zinc-400 mb-3">Sales Reps</label>
                      <input 
                        type="number" min="0" value={reps} onChange={(e) => setReps(Number(e.target.value))}
                        className="w-full bg-zinc-950 border border-white/10 p-4 text-white font-bold focus:border-orange-500 focus:outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-zinc-400 mb-3">Canvassers</label>
                      <input 
                        type="number" min="0" value={canvassers} onChange={(e) => setCanvassers(Number(e.target.value))}
                        className="w-full bg-zinc-950 border border-white/10 p-4 text-white font-bold focus:border-orange-500 focus:outline-none transition-colors"
                      />
                    </div>
                    <div className="col-span-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                      Calculated Volume: {computedClaims} claims / year
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-400 mb-3">Claims per year</label>
                    <input 
                      type="number" min="1" value={directClaims} onChange={(e) => setDirectClaims(Number(e.target.value))}
                      className="w-full bg-zinc-950 border border-white/10 p-4 text-white font-bold focus:border-orange-500 focus:outline-none transition-colors"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <label className="block text-xs font-bold uppercase tracking-widest text-zinc-400">Billing Term</label>
                <div className="grid grid-cols-3 gap-4">
                  {config.billingTerms.map((t: any) => (
                    <button
                      key={t.term_key}
                      onClick={() => setBillingTerm(t.term_key)}
                      className={`p-4 text-xs font-black uppercase tracking-widest border transition-all ${billingTerm === t.term_key ? "border-orange-500 bg-orange-500/10 text-white" : "border-white/10 bg-zinc-950 text-zinc-500 hover:border-white/30 hover:text-white"}`}
                    >
                      {t.name}
                      {t.term_key === "annual" && <span className="block mt-1 text-[10px] text-orange-500">Best Rate</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <label className="block text-xs font-bold uppercase tracking-widest text-zinc-400">Feature Tier</label>
                <div className="flex flex-col gap-3">
                  {config.featureTiers.map((f: any) => (
                    <button
                      key={f.tier_key}
                      onClick={() => setFeatureTier(f.tier_key)}
                      className={`p-4 flex justify-between items-center text-sm font-bold uppercase tracking-wide border transition-all ${featureTier === f.tier_key ? "border-orange-500 bg-orange-500/10 text-white" : "border-white/10 bg-zinc-950 text-zinc-400 hover:border-white/30 hover:text-white"}`}
                    >
                      <span>{f.name}</span>
                      <span className="text-xs">{f.monthly_cents > 0 ? `+${formatMoney(f.monthly_cents)}/mo` : 'Included'}</span>
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* Output Block */}
            <div className="sticky top-24">
              <div className="bg-zinc-950 border border-white/10 p-8 md:p-10">
                <h3 className="text-xl font-black uppercase text-white mb-8">Quote Summary</h3>
                
                <div className="space-y-6 mb-8 text-sm font-bold uppercase tracking-wide">
                  <div className="flex justify-between items-center text-zinc-300">
                    <span>Subscription ({recommendedPlan.name})</span>
                    <span>{formatMoney(annualCommitment)} / year</span>
                  </div>
                  
                  {featureTierAnnual > 0 && (
                    <div className="flex justify-between items-center text-zinc-300">
                      <span>Feature Tier ({featureObj.name})</span>
                      <span>{formatMoney(featureTierAnnual)} / year</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center text-zinc-300">
                    <span>Setup (one-time)</span>
                    <span>{formatMoney(setup)}</span>
                  </div>
                  
                  <div className="h-px bg-white/10 w-full" />
                  
                  <div className="flex justify-between items-center text-white text-lg">
                    <span>First-year total</span>
                    <span className="font-black text-orange-500">{formatMoney(firstYearTotal)}</span>
                  </div>
                </div>

                <div className="bg-orange-500/10 border border-orange-500/20 p-4 mb-10 text-center">
                  <span className="text-orange-500 font-black uppercase tracking-widest text-sm">
                    {formatMoney(recommendedPlan.annual_cents / recommendedPlan.committed_claims)} per claim
                  </span>
                </div>

                <form onSubmit={handleCheckout} className="space-y-4">
                  <input
                    type="email"
                    required
                    placeholder="EMAIL ADDRESS"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 p-4 text-white font-bold text-sm uppercase tracking-wide placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none transition-colors"
                  />
                  <input
                    type="text"
                    required
                    placeholder="COMPANY NAME"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 p-4 text-white font-bold text-sm uppercase tracking-wide placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-3 px-8 py-5 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-black text-sm font-black uppercase tracking-widest transition-colors mt-2"
                  >
                    {isSubmitting ? "Processing..." : `Get Started on ${recommendedPlan.name}`}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  {submitError && (
                    <div className="text-red-500 text-xs font-bold uppercase tracking-widest text-center mt-4">
                      {submitError}
                    </div>
                  )}
                  {config.creditCopy && (
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-4 text-center px-4">
                      {config.creditCopy}
                    </p>
                  )}
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section D: Plan cards */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-4 text-center">Scale by Pod</h2>
          <p className="text-sm font-bold uppercase tracking-widest text-zinc-500 text-center mb-16">Built in a live restoration department.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            {plans.map((p: any) => {
              const isTeam = p.plan_key === "team";
              return (
                <div key={p.plan_key} className={`bg-zinc-950 p-8 flex flex-col items-center text-center transition-all ${isTeam ? "border-2 border-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.15)] scale-105 z-10" : "border border-white/10 hover:border-white/30"}`}>
                  <h3 className="text-xl font-black uppercase text-white mb-2">{p.name}</h3>
                  <div className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-6">{p.committed_claims} claims / year</div>
                  
                  <div className="text-2xl font-black text-white mb-2">{formatMoney(p.annual_cents)}</div>
                  <div className="text-xs font-bold uppercase tracking-widest text-orange-500 mb-8">{formatMoney(p.annual_cents / p.committed_claims)} / claim</div>

                  <button
                    onClick={() => {
                      setInputMode("volume");
                      setDirectClaims(p.committed_claims);
                      window.scrollTo({ top: 400, behavior: "smooth" });
                    }}
                    className={`mt-auto w-full py-4 text-xs font-black uppercase tracking-widest transition-colors ${isTeam ? "bg-orange-500 text-black hover:bg-orange-400" : "bg-white/5 text-white hover:bg-white/10"}`}
                  >
                    Select
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Section E: Billing Terms */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-black uppercase text-white mb-8">Billing Terms</h2>
          <div className="border border-white/10 bg-zinc-950 overflow-x-auto mb-8">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-white/10 bg-black/50">
                  <th className="p-6 text-xs font-black uppercase tracking-widest text-zinc-500">Term</th>
                  <th className="p-6 text-xs font-black uppercase tracking-widest text-zinc-500">Premium</th>
                </tr>
              </thead>
              <tbody className="text-sm font-bold uppercase tracking-wide">
                <tr className="border-b border-white/5">
                  <td className="p-6 text-white flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-orange-500"/> Annual Prepaid</td>
                  <td className="p-6 text-zinc-400">Best Rate</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="p-6 text-white">Quarterly Installments</td>
                  <td className="p-6 text-zinc-400">+10% vs Annual</td>
                </tr>
                <tr>
                  <td className="p-6 text-white">Monthly Installments</td>
                  <td className="p-6 text-zinc-400">+25% vs Annual</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-lg font-black uppercase tracking-widest text-orange-500 text-center leading-relaxed">
            "Storm season is not twelve months long. Your claims bank across the whole year."
          </p>
        </div>
      </section>

      {/* Section F: Setup Fees */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-black uppercase text-white mb-8">One-Time Setup</h2>
          <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed mb-8">
            Setup is not a fee we invented. We migrate your existing CRM, load your price book, build the code library for every jurisdiction you work in, and configure your roles and templates. Annual customers pay less because we can schedule that work more efficiently.
          </p>
          <div className="border border-white/10 bg-zinc-950 overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-white/10 bg-black/50">
                  <th className="p-6 text-xs font-black uppercase tracking-widest text-zinc-500">Plan</th>
                  <th className="p-6 text-xs font-black uppercase tracking-widest text-zinc-500">Annual Rate</th>
                  <th className="p-6 text-xs font-black uppercase tracking-widest text-zinc-500">Quarterly/Monthly Rate</th>
                </tr>
              </thead>
              <tbody className="text-sm font-bold uppercase tracking-wide">
                {plans.map((p: any) => (
                  <tr key={p.plan_key} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                    <td className="p-6 text-white">{p.name}</td>
                    <td className="p-6 text-zinc-400">{formatMoney(p.setup_annual_cents)}</td>
                    <td className="p-6 text-zinc-400">{formatMoney(p.setup_installment_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Section G: Feature Tiers */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-16 text-center">Platform Features</h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            {/* Standard */}
            <div className="bg-zinc-950 border border-white/10 p-8">
              <h3 className="text-xl font-black uppercase text-white mb-2">Standard</h3>
              <div className="text-xs font-bold uppercase tracking-widest text-orange-500 mb-8">Included</div>
              <ul className="space-y-4 text-sm font-bold uppercase tracking-wide text-zinc-400">
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-white shrink-0"/> CRM functionality</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-white shrink-0"/> Mobile inspection app</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-white shrink-0"/> Canvassing app</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-white shrink-0"/> Proof packages</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-white shrink-0"/> AHJ library</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-white shrink-0"/> Supplement documents</li>
              </ul>
            </div>
            
            {/* Professional */}
            <div className="bg-zinc-950 border border-white/10 p-8">
              <h3 className="text-xl font-black uppercase text-white mb-2">Professional</h3>
              <div className="text-xs font-bold uppercase tracking-widest text-orange-500 mb-8">+ $249 / mo</div>
              <ul className="space-y-4 text-sm font-bold uppercase tracking-wide text-zinc-400">
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-white shrink-0"/> Everything in Standard</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0"/> API access</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0"/> Custom roles</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0"/> Priority AHJ requests</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0"/> Advanced reporting</li>
              </ul>
            </div>

            {/* Enterprise */}
            <div className="bg-zinc-950 border border-white/10 p-8">
              <h3 className="text-xl font-black uppercase text-white mb-2">Enterprise</h3>
              <div className="text-xs font-bold uppercase tracking-widest text-orange-500 mb-8">+ $999 / mo</div>
              <ul className="space-y-4 text-sm font-bold uppercase tracking-wide text-zinc-400">
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-white shrink-0"/> Everything in Professional</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0"/> SSO / SAML</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0"/> Multi-office hierarchy</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0"/> Dedicated CSM</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0"/> Uptime SLA</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="h-5 w-5 text-orange-500 shrink-0"/> Quarterly business review</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Section H: Banking */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-8 items-start">
          <div className="h-16 w-16 bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
            <Info className="h-8 w-8 text-orange-500" />
          </div>
          <div>
            <h2 className="text-2xl font-black uppercase tracking-widest text-white mb-6">How Claims Banking Works</h2>
            <div className="space-y-4 text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed">
              <p>Claims bank across your whole annual term, not monthly buckets.</p>
              <p>They expire 24 months from purchase, giving you maximum flexibility for storm unpredictability.</p>
              <p>Overage is billed at your current band rate + $10.</p>
              <p>You receive notifications at 80% and 100% usage.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Section I: FAQ */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-16">FAQ</h2>
          
          <div className="space-y-12">
            {[
              { q: "Why per claim instead of per seat?", a: "Because seats are not the work, claims are. Hire ten canvassers or a hundred; we do not charge you for growing. You pay for the files you build." },
              { q: "What does a claim cost?", a: "$50, coming down with volume. About what you already pay for a measurement report." },
              { q: "What if I do not use my claims?", a: "They bank across your whole term. Storm season is not twelve months long and we do not pretend it is." },
              { q: "Do revisions cost extra?", a: "No. Regenerate, revise, and add supplement documents on a claim as many times as you need. You are charged once, when the package is delivered." },
              { q: "Why is there a setup fee?", a: "We migrate your CRM, load your price book, build the code library for every jurisdiction you work in, and train your team. That is real work, and it is why you are productive in two weeks instead of six months." },
              { q: "Is RoofTrax owned by a roofing company?", a: "No. RoofTrax is an independent software company. Its founder has twenty years in insurance restoration, and the platform was built and validated with a restoration contractor as design partner. Every customer is an isolated tenant, no customer can see another data, and we do not use it." },
              { q: "What happens to my claim data on a trial?", a: "Photos, addresses, and claim details are deleted 30 days after delivery. We keep the jurisdiction code research, which contains nothing about your claim or your customer." },
              { q: "Can I submit the package to the carrier?", a: "It is your document, branded to your company, under your license. Review it, adopt it, and submit it exactly as you would anything your own team produced." },
              { q: "Do you work with public adjusters?", a: "No. RoofTrax is built for contractors." }
            ].map((faq, i) => (
              <div key={i} className="border-b border-white/10 pb-8 last:border-0">
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-4">
                  {faq.q}
                </h3>
                <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

    </MarketingLayout>
  );
}

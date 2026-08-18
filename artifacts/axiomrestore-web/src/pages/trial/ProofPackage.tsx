import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, ArrowRight, ArrowLeft, Check, Camera, Zap, Clock, FileCheck, FileSignature, AlertTriangle, HelpCircle, FileText, Smartphone } from "lucide-react";

export default function ProofPackage() {
  const [, navigate] = useLocation();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(`/api/trial/config`);
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
        }
      } catch (err) {
        console.error("Failed to load config", err);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const priceFirst = config ? config.priceFirstCents / 100 : 100;
  const priceSubsequent = config ? config.priceSubsequentCents / 100 : 65;
  const maxPkgs = config ? config.maxPackages : 3;

  const handleCTA = () => {
    if (config?.waitlistMode) {
      navigate("/proof-package/waitlist");
    } else {
      navigate("/proof-package/start");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-orange-500/30">
      {/* Nav */}
      <nav className="h-14 flex items-center justify-between px-6 md:px-10 border-b border-white/10 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5 group">
          <ShieldCheck className="h-5 w-5 text-orange-500 group-hover:text-orange-400 transition-colors" strokeWidth={2.5} />
          <span className="text-lg font-black tracking-widest uppercase">
            <span className="text-white">ROOF</span><span className="text-orange-500 group-hover:text-orange-400 transition-colors">TRAX</span>
          </span>
        </button>
        <div className="flex items-center gap-6">
          <button
            onClick={() => navigate("/pricing")}
            className="text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
          >
            Pricing
          </button>
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="px-6 md:px-20 py-24 md:py-32">
          <div className="max-w-4xl">
            <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
              Trial Proof Package
            </div>
            <h1 className="text-4xl md:text-6xl font-black uppercase text-white leading-[1.05] mb-8 tracking-tight">
              See what your claim documentation <span className="text-orange-500">should look like.</span>
            </h1>
            <p className="text-lg md:text-xl text-zinc-400 leading-relaxed max-w-2xl mb-12">
              Send us one real claim. In two business days you'll get a complete forensic proof package — branded to your company, ready to submit.
            </p>

            <div className="flex flex-col sm:flex-row items-start gap-4 mb-8">
              <button
                onClick={handleCTA}
                disabled={loading}
                className="inline-flex items-center justify-center gap-3 px-8 py-5 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-black text-sm font-black uppercase tracking-widest transition-colors w-full sm:w-auto"
              >
                {loading ? "Loading..." : config?.waitlistMode ? "Join the Waitlist" : `Start with one claim — $${priceFirst}`}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {config?.waitlistMode ? (
              <p className="text-sm font-bold text-orange-400 mb-4 bg-orange-500/10 border border-orange-500/20 px-4 py-3 inline-block">
                We're at capacity this week. Join the list and we'll open your spot next week.
              </p>
            ) : null}

            <div className="space-y-2 mt-4 text-xs font-bold uppercase tracking-widest text-zinc-500">
              <div>Pricing: First package ${priceFirst} · Second & third ${priceSubsequent} each · Maximum {maxPkgs} packages per company</div>
              <div className="text-zinc-400 bg-zinc-900/50 p-3 border border-white/5 inline-block">Every dollar you spend applies as credit toward an annual plan, Crew or above, within 90 days of your first trial submission.</div>
            </div>
          </div>
        </section>

        {/* Why it's not free */}
        <section className="px-6 md:px-20 py-16 border-t border-white/10 bg-zinc-900/30">
          <div className="max-w-4xl flex flex-col md:flex-row gap-8 items-start">
            <div className="h-12 w-12 bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-zinc-400" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-white mb-3">Why it's not free</h2>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
                We build a complete code packet for your jurisdiction before we build your package. That work is real and it's yours whether or not you become a customer.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="px-6 md:px-20 py-24 border-t border-white/10">
          <div className="max-w-5xl">
            <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-4">The Process</div>
            <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-16">How it works</h2>
            
            <div className="grid md:grid-cols-4 gap-0 border border-white/10">
              {[
                { icon: Smartphone, n: "01", title: "Submit your claim", desc: "Address, date of loss, carrier, photos, measurements." },
                { icon: FileCheck, n: "02", title: "We build your code packet", desc: "Every applicable code and amendment for that county." },
                { icon: Zap, n: "03", title: "You get your package", desc: "In 2 business days — your logo, your license number, your company." },
                { icon: Camera, n: "04", title: "We walk you through it", desc: "A 30-minute call to review the package and strategy." },
              ].map((step, i) => (
                <div key={step.n} className={`p-8 ${i < 3 ? "border-b md:border-b-0 md:border-r border-white/10" : ""}`}>
                  <div className="text-[10px] font-black uppercase tracking-widest text-orange-500 mb-4">{step.n}</div>
                  <div className="h-10 w-10 flex items-center justify-center bg-white/5 border border-white/10 mb-5">
                    <step.icon className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="text-sm font-black uppercase tracking-wide text-white mb-3">{step.title}</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What's inside */}
        <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/50">
          <div className="max-w-5xl">
            <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-4">The Deliverable</div>
            <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-16">What's inside</h2>
            
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
              {[
                "Exhibit manifest",
                "Code citations",
                "Forensic summary",
                "Attestation block",
                "Slope-by-slope assessment",
                "Component inventory"
              ].map((item) => (
                <div key={item} className="flex items-center gap-4 p-5 border border-white/10 bg-zinc-950">
                  <Check className="h-4 w-4 text-orange-500 shrink-0" />
                  <span className="text-sm font-bold uppercase tracking-wide text-zinc-300">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="px-6 md:px-20 py-24 border-t border-white/10">
          <div className="max-w-4xl">
            <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-4">Questions</div>
            <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-16">FAQ</h2>
            
            <div className="space-y-8">
              {[
                { q: "Why does this cost money?", a: "Code packet research is real work and it's yours whether or not you sign up for a plan." },
                { q: "What happens to my claim data?", a: "Photos, addresses, and claim details are deleted 30 days after delivery. We keep the jurisdiction code research which contains nothing about your claim." },
                { q: "Can I submit this to the carrier?", a: "Your document, your brand, your license — review it, adopt it, and submit it as your own work." },
                { q: "How many can I get?", a: "Three. After that, the next step is a plan." },
                { q: "What if I subscribe?", a: "Every dollar you spend applies as credit toward an annual plan, Crew or above, within 90 days of your first trial submission." },
                { q: "Do you work with public adjusters?", a: "No. AxiomRestore is built exclusively for contractors." },
                { q: "Is AxiomRestore owned by a roofing company?", a: "No — we are an independent software company. The founder has 20 years in insurance restoration, but every customer is an isolated tenant." }
              ].map((faq) => (
                <div key={faq.q} className="border-b border-white/10 pb-8 last:border-0">
                  <h3 className="text-sm font-black uppercase tracking-widest text-white mb-3 flex items-start gap-3">
                    <HelpCircle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                    {faq.q}
                  </h3>
                  <p className="text-sm text-zinc-400 leading-relaxed pl-7">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="px-6 md:px-20 py-24 border-t border-white/10 text-center flex flex-col items-center">
          <h2 className="text-2xl md:text-4xl font-black uppercase text-white mb-8">Ready to see the proof?</h2>
          <button
            onClick={handleCTA}
            disabled={loading}
            className="inline-flex items-center justify-center gap-3 px-8 py-5 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-black text-sm font-black uppercase tracking-widest transition-colors"
          >
            {loading ? "Loading..." : config?.waitlistMode ? "Join the Waitlist" : "Start with one claim"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </section>
      </main>
    </div>
  );
}

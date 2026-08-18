import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ShieldCheck, ArrowRight, Check, Smartphone, BarChart2,
  Camera, FileSignature, Share2, Zap, Clock, FileCheck,
  ChevronRight, Star, BookOpen, Mic, Menu, X
} from "lucide-react";

// ─── Pricing tiers ────────────────────────────────────────────────────────────
const TIERS = [
  { name: "Field",      seats: 3,  pkgs: "3 / mo",     overage: "$40",  monthly: 99,   annual: 83,   highlight: false },
  { name: "Starter",   seats: 8,  pkgs: "10 / mo",    overage: "$40",  monthly: 249,  annual: 208,  highlight: false },
  { name: "Pro",       seats: 20, pkgs: "35 / mo",    overage: "$25",  monthly: 699,  annual: 583,  highlight: true  },
  { name: "Scale",     seats: 50, pkgs: "Unlimited",  overage: "—",    monthly: 1699, annual: 1416, highlight: false },
  { name: "Enterprise",seats: 0,  pkgs: "Unlimited",  overage: "—",    monthly: 0,    annual: 0,    highlight: false },
];

// ─── Platform segments ────────────────────────────────────────────────────────
const SEGMENTS = [
  {
    icon: Smartphone,
    name: "Mobile App",
    tag: "Field",
    desc: "Camera-first field documentation. GPS-tagged evidence, guided inspection protocols, and offline capability — so your rep never loses data at the property.",
    features: ["AI-guided RAP & VAP protocols", "Offline evidence capture", "GPS-tagged photos", "One-tap package initiation"],
  },
  {
    icon: BarChart2,
    name: "CRM",
    tag: "Command Center",
    desc: "Insurance, retail, and project pipelines in a single view. Every lead, every rep, every stage — without the spreadsheet chaos.",
    features: ["3-pipeline stage board", "Team clock-in & activity", "Map & calendar views", "Role-based permissions"],
  },
  {
    icon: Camera,
    name: "Evidence Portal",
    tag: "Documentation Engine",
    desc: "AI turns raw field evidence into forensic-grade proof packages. Section by section, code-cited, adjuster-ready — before the rep drives away.",
    features: ["AI-assisted section generation", "AHJ code citation library", "Exhibit management & ordering", "Version-controlled submissions"],
  },
  {
    icon: FileSignature,
    name: "Customer Portal",
    tag: "Homeowner-Facing",
    desc: "Digital contracts, scope presentation, and e-signature — no app download required. A clean paper trail your insurance carrier and homeowner both trust.",
    features: ["Digital scope presentation", "E-signature with binding", "Change order management", "Completion certificate delivery"],
  },
  {
    icon: Share2,
    name: "Referral Portal",
    tag: "Coming Soon",
    desc: "Turn your best customers into your best source of new business. Contractor-to-contractor referrals with automated tracking and commission management.",
    features: ["Referral link generation", "Commission tracking", "Automated follow-up", "Founding-rate rewards for early adopters"],
    soon: true,
  },
];

// ─── Nav ─────────────────────────────────────────────────────────────────────
function MarketingNav() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  const handleLogin = () => { window.location.href = `/api/login?returnTo=/axiomrestore-web/`; };

  return (
    <nav className="fixed inset-x-0 top-0 z-50 h-14 flex items-center justify-between px-6 md:px-10 bg-zinc-950/90 backdrop-blur border-b border-white/[0.08]">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="h-5 w-5 text-orange-500 flex-shrink-0" strokeWidth={2.5} />
        <span className="text-lg font-black tracking-widest uppercase select-none">
          <span className="text-white">AXIOM</span><span className="text-orange-500">RESTORE</span>
        </span>
      </div>

      {/* Desktop links */}
      <div className="hidden md:flex items-center gap-8">
        <a href="/#platform" className="text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">Products</a>
        <Link href="/pricing" className="text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">Pricing</Link>
        <a href="/#beta" className="text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">Beta</a>
        <button onClick={() => navigate("/proof-package")} className="text-xs font-bold uppercase tracking-widest text-orange-500 hover:text-orange-400 transition-colors">Trial Package</button>
      </div>

      {/* Desktop CTAs */}
      <div className="hidden md:flex items-center gap-3">
        <button
          onClick={handleLogin}
          data-testid="button-login"
          className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors"
        >
          Login
        </button>
        <button
          onClick={() => navigate("/signup")}
          className="inline-flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-400 text-black text-xs font-black uppercase tracking-widest transition-colors"
        >
          Apply for Beta <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(!open)}
        className="md:hidden p-1.5 text-zinc-400 hover:text-white"
        aria-label="Toggle menu"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile menu */}
      {open && (
        <div className="absolute inset-x-0 top-14 bg-zinc-950 border-b border-white/10 px-6 py-6 space-y-4 md:hidden">
          <a href="/#platform" onClick={() => setOpen(false)} className="block text-sm font-bold uppercase tracking-widest text-zinc-300 hover:text-white">Products</a>
          <Link href="/pricing" onClick={() => setOpen(false)} className="block text-sm font-bold uppercase tracking-widest text-zinc-300 hover:text-white">Pricing</Link>
          <a href="/#beta" onClick={() => setOpen(false)} className="block text-sm font-bold uppercase tracking-widest text-zinc-300 hover:text-white">Beta</a>
          
          <div className="pt-2 space-y-3 border-t border-white/10">
            <button onClick={() => { setOpen(false); navigate("/proof-package"); }} className="block w-full text-left text-sm font-bold uppercase tracking-widest text-orange-500 hover:text-orange-400">Trial Package</button>
            <button onClick={handleLogin} className="block w-full text-left text-sm font-bold uppercase tracking-widest text-zinc-400 hover:text-white">Login</button>
            <button
              onClick={() => { setOpen(false); navigate("/signup"); }}
              className="flex items-center gap-2 w-full px-5 py-3 bg-orange-500 hover:bg-orange-400 text-black text-xs font-black uppercase tracking-widest justify-center"
            >
              Apply for Beta <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function HeroSection() {
  const [, navigate] = useLocation();
  return (
    <section className="pt-14 min-h-screen flex flex-col justify-center px-6 md:px-20 py-24">
      <div className="max-w-5xl">
        {/* Badge */}
        <div className="flex flex-wrap items-center gap-3 mb-12">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 text-[11px] font-bold uppercase tracking-widest">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />
            Now Accepting Beta Applicants — 12 Companies Max
          </span>
          <span className="px-3 py-1.5 border border-white/10 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
            Built on 20 Years in Insurance Restoration
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl md:text-8xl font-black uppercase leading-none mb-8 tracking-tight">
          <span className="block text-white">AxiomRestore turns</span>
          <span className="block text-white">your newest rep</span>
          <span className="block">into your <span className="text-orange-500">best</span></span>
          <span className="block text-white">documenter.</span>
        </h1>

        {/* Sub */}
        <p className="text-base md:text-lg text-zinc-400 mb-14 max-w-2xl leading-relaxed">
          Your 22-year-old field rep produces a forensic proof package indistinguishable from one written by a 20-year supplement manager — from their phone, at the property, before they leave the driveway.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 mb-16">
          <button
            onClick={() => navigate("/signup")}
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-400 text-black text-sm font-black uppercase tracking-widest transition-colors"
          >
            Apply for Beta <ArrowRight className="h-4 w-4" />
          </button>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-white/15 text-white text-sm font-bold uppercase tracking-widest hover:border-white/30 transition-colors"
          >
            See Pricing <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Trust bar */}
        <div className="flex flex-wrap gap-x-12 gap-y-4 border-t border-white/[0.08] pt-10">
          {[
            { value: "48h",  label: "First live package" },
            { value: "≥60%", label: "Rep-generated packages (target)" },
            { value: "$0",   label: "Migration cost to you" },
            { value: "96%",  label: "Gross margin model" },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-2xl font-black text-orange-500 mb-0.5">{value}</div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Category ─────────────────────────────────────────────────────────────────
function CategorySection() {
  const [, navigate] = useLocation();
  return (
    <section className="border-t border-white/[0.08] px-6 md:px-20 py-20">
      <div className="max-w-5xl">
        <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6">The Category Argument</div>
        <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-12 leading-tight">
          They track the job.<br />
          <span className="text-orange-500">We win it.</span>
        </h2>

        <div className="grid md:grid-cols-2 gap-0 border border-white/10">
          <div className="p-8 border-b md:border-b-0 md:border-r border-white/10">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-4">Job Management Systems</div>
            <div className="text-sm font-semibold text-zinc-400 mb-4">AccuLynx · JobNimbus · Roofr</div>
            <p className="text-sm text-zinc-500 leading-relaxed mb-6">
              They tell you where the job is. They do not make the job win. After a decade of engineering they are incumbents — and we are not asking you to replace them on a feature comparison. That's a losing argument.
            </p>
            <div className="flex items-center gap-2 px-4 py-3 bg-zinc-900 border border-white/[0.08]">
              <span className="text-xs font-black uppercase tracking-wide text-zinc-400">Their question:</span>
              <span className="text-xs text-zinc-500 italic">"Where is the job?"</span>
            </div>
          </div>
          <div className="p-8">
            <div className="text-[10px] font-bold uppercase tracking-widest text-orange-500 mb-4">Documentation + Evidence System</div>
            <div className="text-sm font-semibold text-orange-400 mb-4">AxiomRestore</div>
            <p className="text-sm text-zinc-300 leading-relaxed mb-6">
              We are asking you to adopt a documentation capability that no incumbent has — one that happens to include the CRM you were already paying for. The proof package is the product. The CRM is the container that makes it repeatable.
            </p>
            <div className="flex items-center gap-2 px-4 py-3 bg-orange-500/5 border border-orange-500/20">
              <span className="text-xs font-black uppercase tracking-wide text-orange-400">Our question:</span>
              <span className="text-xs text-orange-300 italic">"Does the proof exist — and can it defend itself?"</span>
            </div>
          </div>
        </div>

        <div className="mt-10 text-center">
          <button
            onClick={() => navigate("/signup")}
            className="inline-flex items-center gap-2 px-6 py-3 border border-white/15 text-sm font-bold uppercase tracking-widest text-white hover:border-white/30 transition-colors"
          >
            Join the beta to see the difference <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Platform ─────────────────────────────────────────────────────────────────
function PlatformSection() {
  const [active, setActive] = useState(0);
  const seg = SEGMENTS[active];
  const Icon = seg.icon;

  return (
    <section id="platform" className="border-t border-white/[0.08] px-6 md:px-20 py-20">
      <div className="max-w-5xl">
        <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-3">The Platform</div>
        <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-12 leading-tight">
          Five tools. One platform.
        </h2>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-0 border border-white/10 mb-0">
          {SEGMENTS.map((s, i) => {
            const TabIcon = s.icon;
            return (
              <button
                key={s.name}
                onClick={() => setActive(i)}
                className={`flex-1 min-w-[120px] flex flex-col items-center gap-1.5 px-4 py-4 border-r border-white/10 last:border-r-0 transition-colors ${
                  active === i
                    ? "bg-orange-500/10 text-orange-400"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]"
                }`}
              >
                <TabIcon className="h-4 w-4" />
                <span className="text-[10px] font-black uppercase tracking-widest leading-tight text-center">{s.name}</span>
                {s.soon && (
                  <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-zinc-700 text-zinc-400">Soon</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Detail panel */}
        <div className="border border-t-0 border-white/10 p-8 grid md:grid-cols-2 gap-10">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className="h-10 w-10 flex items-center justify-center bg-orange-500/10 border border-orange-500/20">
                <Icon className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-orange-500">{seg.tag}</div>
                <div className="text-lg font-black uppercase text-white">{seg.name}</div>
              </div>
              {seg.soon && (
                <span className="ml-auto text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 border border-white/15 text-zinc-400">Coming Soon</span>
              )}
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed">{seg.desc}</p>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-4">Key Capabilities</div>
            <ul className="space-y-3">
              {seg.features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-zinc-300">
                  <Check className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────
function HowItWorksSection() {
  const steps = [
    { icon: Camera,    n: "01", title: "Rep captures evidence",          desc: "At the property, on their phone. Guided protocol ensures every damage type and AHJ-required element is documented before they leave." },
    { icon: Zap,       n: "02", title: "AI builds the forensic package", desc: "Evidence is analyzed section-by-section. Building codes cited. Repairability documented. Supplement narrative drafted — in the voice of a 20-year supplement manager." },
    { icon: FileCheck, n: "03", title: "Submission-ready in 48 hours",   desc: "The first complete proof package on a real claim, not a demo file, is in the hands of your adjuster within 48 hours of onboarding. We perform the migration." },
  ];

  return (
    <section className="border-t border-white/[0.08] px-6 md:px-20 py-20">
      <div className="max-w-5xl">
        <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-3">How It Works</div>
        <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-12 leading-tight">
          From field to carrier.<br />Before they leave the driveway.
        </h2>
        <div className="grid md:grid-cols-3 gap-0 border border-white/10">
          {steps.map(({ icon: StepIcon, n, title, desc }, i) => (
            <div key={n} className={`p-8 ${i < 2 ? "border-b md:border-b-0 md:border-r border-white/10" : ""}`}>
              <div className="text-[10px] font-black uppercase tracking-widest text-orange-500 mb-4">{n}</div>
              <div className="h-10 w-10 flex items-center justify-center bg-white/5 border border-white/10 mb-5">
                <StepIcon className="h-5 w-5 text-white" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-wide text-white mb-3">{title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing Teaser ───────────────────────────────────────────────────────────
function PricingTeaserSection() {
  return (
    <section className="border-t border-white/[0.08] px-6 md:px-20 py-20 bg-zinc-900/30">
      <div className="max-w-5xl text-center flex flex-col items-center">
        <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-4">Pricing</div>
        <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-6 leading-tight">
          Flat seats.<br />Committed floor.
        </h2>
        <p className="text-sm text-zinc-400 mb-10 max-w-2xl leading-relaxed">
          The Proof Package is the product. The CRM is the container that makes it repeatable. We don't hide our pricing behind "Talk to Sales" unless you actually need an Enterprise SLA. 
        </p>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-2 px-8 py-4 bg-white text-black hover:bg-zinc-200 text-sm font-black uppercase tracking-widest transition-colors"
        >
          View Plans & Pricing <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

// ─── Guarantee ────────────────────────────────────────────────────────────────
function GuaranteeSection() {
  const [, navigate] = useLocation();
  return (
    <section className="border-t border-white/[0.08] px-6 md:px-20 py-20">
      <div className="max-w-5xl grid md:grid-cols-2 gap-0 border border-white/10">
        <div className="p-10 border-b md:border-b-0 md:border-r border-white/10">
          <div className="text-[10px] font-bold uppercase tracking-widest text-orange-500 mb-6">30-Day Live Claim Guarantee</div>
          <h2 className="text-2xl md:text-3xl font-black uppercase text-white leading-tight mb-6">
            Ten complete packages on your real claims — or a full refund. You keep every package.
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed mb-8">
            This is a deliverable guarantee, not an outcome guarantee. Ten complete, submission-ready proof packages on your real claims within 30 days. If we miss it, you get the full year refunded and keep everything we built.
          </p>
          <button
            onClick={() => navigate("/signup")}
            className="inline-flex items-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-400 text-black text-xs font-black uppercase tracking-widest transition-colors"
          >
            Claim the Guarantee <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <div className="p-10">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-6">Also included</div>
          <ul className="space-y-5">
            {[
              { icon: Clock,     title: "48-hour first package",              desc: "Your claim. Your property. Your carrier. Not a sandbox demo file." },
              { icon: BookOpen,  title: "Migration performed for you",        desc: "Your CRM export, price book, document templates, and photo library are loaded by AxiomRestore." },
              { icon: Check,     title: "Rep onboarding until independent",   desc: "If reps aren't generating packages unassisted by day 30, support continues free until they are." },
              { icon: BookOpen,  title: "AHJ code library pre-loaded",        desc: "Your jurisdiction's building codes, loaded and cited before the first package." },
            ].map(({ icon: BIcon, title, desc }) => (
              <li key={title} className="flex items-start gap-4">
                <BIcon className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-black text-white mb-1">{title}</div>
                  <div className="text-xs text-zinc-500 leading-relaxed">{desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ─── Bonus Stack ──────────────────────────────────────────────────────────────
function BonusSection() {
  const bonuses = [
    { icon: BookOpen,   title: "AHJ Code Library",               desc: "Pre-loaded for your jurisdiction. Technically hard to replicate. Visible depth." },
    { icon: FileCheck,  title: "Four-Document OS",               desc: "PRSIA, CFR Addendum, Kitchen-Table Process Card, and Internal SOP. Built and proven." },
    { icon: Mic,        title: "Adjuster Negotiation Training",  desc: "Recorded Voss/Black Swan methodology module. Included at Pro and above." },
    { icon: Star,       title: "Live Package Review",            desc: "First five packages reviewed by the founder personally. Real claim feedback, not generic notes." },
  ];

  return (
    <section className="border-t border-white/[0.08] px-6 md:px-20 py-20">
      <div className="max-w-5xl">
        <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-3">Pro & Above</div>
        <h2 className="text-3xl md:text-4xl font-black uppercase text-white mb-4 leading-tight">
          Competitors sell software.<br />AxiomRestore sells an operating system with software attached.
        </h2>
        <p className="text-sm text-zinc-500 mb-12 max-w-xl">Every Pro, Scale, and Enterprise customer receives the bonus stack — high perceived value, near-zero marginal cost.</p>

        <div className="grid md:grid-cols-2 gap-0 border border-white/10">
          {bonuses.map(({ icon: BIcon, title, desc }, i) => (
            <div key={title} className={`p-8 flex items-start gap-5 ${
              i % 2 === 0 ? "md:border-r border-white/10" : ""
            } ${i < 2 ? "border-b border-white/10" : ""}`}>
              <div className="h-10 w-10 flex items-center justify-center bg-orange-500/10 border border-orange-500/20 flex-shrink-0">
                <BIcon className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <div className="text-sm font-black uppercase text-white mb-2">{title}</div>
                <div className="text-sm text-zinc-500 leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Beta CTA ─────────────────────────────────────────────────────────────────
function BetaSection() {
  const [, navigate] = useLocation();
  return (
    <section id="beta" className="border-t border-white/[0.08] px-6 md:px-20 py-20">
      <div className="max-w-5xl">
        <div className="grid md:grid-cols-2 gap-0 border border-orange-500/20 bg-orange-500/5">
          <div className="p-10">
            <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6">Founding Cohort — 12 Companies Max</div>
            <h2 className="text-3xl md:text-4xl font-black uppercase text-white leading-tight mb-6">
              Paid beta.<br />Founding pricing.<br />36-month lock.
            </h2>
            <p className="text-sm text-zinc-400 leading-relaxed mb-8">
              Beta participants pay $99/month or $500 flat for the 90-day window. Founders who convert lock their tier rate at 50% of list — for 36 months.
            </p>
            <p className="text-xs text-zinc-600 leading-relaxed mb-8">
              Free beta users produce polite feedback and near-zero usage. Paid beta users complain — which is the entire point of the exercise.
            </p>
            <button
              onClick={() => navigate("/signup")}
              className="inline-flex items-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-400 text-black text-sm font-black uppercase tracking-widest transition-colors"
            >
              Apply Now <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="p-10 border-t md:border-t-0 md:border-l border-orange-500/20">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-6">Beta Participant Benefits</div>
            <ul className="space-y-4">
              {[
                "Founding pricing locked 36 months at 50% of list",
                "Unlimited proof packages during the beta window",
                "AHJ code library built for your jurisdiction by the founder",
                "The four-document operating system",
                "Direct line to the founder for live-claim package strategy",
                "Founding Partner designation — logo and case-study rights",
                "Permanent 3-month referral bonus for both sides",
              ].map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-zinc-300">
                  <Check className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-8 p-4 bg-black/30 border border-white/[0.08]">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Cohort criteria</div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Located outside DC/MD/VA metro · Has an existing supplement process · Committed to 10+ claims in 90 days · Available for weekly 30-min calls
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function FooterSection() {
  const [, navigate] = useLocation();
  return (
    <footer className="border-t border-white/[0.08] px-6 md:px-20 py-12">
      <div className="max-w-5xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <ShieldCheck className="h-4 w-4 text-orange-500" strokeWidth={2.5} />
            <span className="text-sm font-black tracking-widest uppercase">
              <span className="text-white">ROOF</span><span className="text-orange-500">TRAX</span>
            </span>
          </div>
          <p className="text-xs text-zinc-600 max-w-xs leading-relaxed">
            B2B SaaS for storm restoration contractors. AxiomRestore is an independent software company.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {[
            { label: "Products", href: "#platform", external: true },
            { label: "Pricing",  href: "#pricing",  external: true },
            { label: "Beta",     href: "#beta",     external: true },
          ].map(({ label, href }) => (
            <a key={label} href={href} className="text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">{label}</a>
          ))}
          <button
            onClick={() => navigate("/signup")}
            className="text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
      <div className="max-w-5xl mt-10 pt-6 border-t border-white/[0.04]">
        <p className="text-[10px] text-zinc-700 leading-relaxed max-w-3xl">
          AxiomRestore documentation technology is designed to support contractor-lane discipline. AxiomRestore does not provide public adjusting services, does not interpret insurance policies, and does not guarantee coverage determinations, carrier payment amounts, or claim approval rates. All proof packages are produced for use by licensed contractors under their own credentials.
        </p>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <MarketingNav />
      <HeroSection />
      <CategorySection />
      <PlatformSection />
      <HowItWorksSection />
      <PricingTeaserSection />
      <GuaranteeSection />
      <BonusSection />
      <BetaSection />
      <FooterSection />
    </div>
  );
}

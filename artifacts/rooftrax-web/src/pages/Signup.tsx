import { useState } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, ArrowRight, Check, ArrowLeft, Loader2 } from "lucide-react";

const STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
  "Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky",
  "Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi",
  "Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico",
  "New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania",
  "Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
];

const STACKS = [
  "AccuLynx", "JobNimbus", "Roofr", "Jobber", "ServiceTitan",
  "Spreadsheets + Dropbox / Google Drive", "No formal system", "Other",
];

type FormData = {
  firstName: string; lastName: string; email: string; phone: string;
  company: string; state: string; repCount: string; claimVolume: string;
  revenueRange: string; currentStack: string; challenge: string; referralSource: string;
  committed: boolean;
};

const EMPTY: FormData = {
  firstName: "", lastName: "", email: "", phone: "", company: "",
  state: "", repCount: "", claimVolume: "", revenueRange: "",
  currentStack: "", challenge: "", referralSource: "", committed: false,
};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-2">
        {label}{required && <span className="text-orange-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors";

const selectClass =
  "w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-orange-500/50 transition-colors appearance-none cursor-pointer";

export default function Signup() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState<FormData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.committed) { setError("Please confirm the beta commitment requirements."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/beta-apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Nav */}
      <nav className="h-14 flex items-center justify-between px-6 md:px-10 border-b border-white/8">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-orange-500" strokeWidth={2.5} />
          <span className="text-lg font-black tracking-widest uppercase">
            <span className="text-white">ROOF</span><span className="text-orange-500">TRAX</span>
          </span>
        </button>
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      </nav>

      {success ? (
        /* ── Success state ── */
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center">
          <div className="h-16 w-16 flex items-center justify-center bg-orange-500/10 border border-orange-500/30 mb-8">
            <Check className="h-8 w-8 text-orange-500" />
          </div>
          <h2 className="text-3xl font-black uppercase text-white mb-4">Application received.</h2>
          <p className="text-zinc-400 max-w-md leading-relaxed mb-8">
            We review every application personally. If you meet the cohort criteria, you'll hear from Logan directly within 3 business days to schedule an intro call.
          </p>
          <div className="flex flex-col gap-3 items-center">
            <div className="text-xs text-zinc-600 uppercase tracking-widest font-bold">What happens next</div>
            {[
              "Intro call with Logan (30 min)",
              "Beta agreement + NDA execution",
              "Onboarding — we perform your migration",
              "First proof package on a live claim within 48 hours",
            ].map((s, i) => (
              <div key={s} className="flex items-center gap-3 text-sm text-zinc-400">
                <span className="text-orange-500 font-black text-xs">{`0${i + 1}`}</span>
                {s}
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate("/")}
            className="mt-10 inline-flex items-center gap-2 px-6 py-3 border border-white/15 text-white text-xs font-bold uppercase tracking-widest hover:border-white/30 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
          </button>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto px-6 md:px-10 py-16 grid md:grid-cols-[1fr_1.8fr] gap-16">
          {/* ── Left: context ── */}
          <div className="md:sticky md:top-20 md:self-start">
            <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6">Beta Application</div>
            <h1 className="text-3xl md:text-4xl font-black uppercase text-white leading-tight mb-6">
              Join the founding cohort.
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed mb-8">
              We're accepting 8–12 restoration contractors for a 90-day paid beta. Every package reviewed by Logan personally before carrier submission for the first 30 days.
            </p>

            <div className="space-y-4 mb-10">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-3">Founding participant benefits</div>
              {[
                "Founding pricing locked 36 months at 50% of list",
                "Unlimited packages during the beta",
                "AHJ library built for your jurisdiction",
                "Four-document operating system",
                "Direct line to Logan for live-claim strategy",
                "Founding Partner designation + referral bonus",
              ].map((b) => (
                <div key={b} className="flex items-start gap-3 text-xs text-zinc-400">
                  <Check className="h-3.5 w-3.5 text-orange-500 flex-shrink-0 mt-0.5" />
                  {b}
                </div>
              ))}
            </div>

            <div className="p-5 bg-zinc-900 border border-white/8">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Cohort criteria</div>
              <ul className="space-y-2">
                {[
                  "Outside DC / MD / VA metro",
                  "Existing supplement process in place",
                  "10+ claims through the platform in 90 days",
                  "Weekly 30-min call availability",
                ].map((c) => (
                  <li key={c} className="text-xs text-zinc-500 flex items-start gap-2">
                    <span className="text-orange-500 font-black mt-0.5">·</span>{c}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── Right: form ── */}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <Field label="First name" required>
                <input required value={form.firstName} onChange={set("firstName")} placeholder="Logan" className={inputClass} />
              </Field>
              <Field label="Last name" required>
                <input required value={form.lastName} onChange={set("lastName")} placeholder="Harrington" className={inputClass} />
              </Field>
            </div>

            <Field label="Business email" required>
              <input required type="email" value={form.email} onChange={set("email")} placeholder="you@yourcompany.com" className={inputClass} />
            </Field>

            <Field label="Phone number" required>
              <input required type="tel" value={form.phone} onChange={set("phone")} placeholder="(540) 555-0100" className={inputClass} />
            </Field>

            <Field label="Company name" required>
              <input required value={form.company} onChange={set("company")} placeholder="Acme Restoration LLC" className={inputClass} />
            </Field>

            <Field label="Primary market state" required>
              <select required value={form.state} onChange={set("state")} className={selectClass}>
                <option value="" disabled>Select state…</option>
                {STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Field reps" required>
                <select required value={form.repCount} onChange={set("repCount")} className={selectClass}>
                  <option value="" disabled>Select…</option>
                  {["1–3", "4–8", "9–20", "21+"].map((v) => <option key={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Monthly insurance claims" required>
                <select required value={form.claimVolume} onChange={set("claimVolume")} className={selectClass}>
                  <option value="" disabled>Select…</option>
                  {["Fewer than 10", "10–25", "26–60", "60+"].map((v) => <option key={v}>{v}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Annual revenue" required>
              <select required value={form.revenueRange} onChange={set("revenueRange")} className={selectClass}>
                <option value="" disabled>Select range…</option>
                {["Under $500K", "$500K–$2M", "$2M–$5M", "$5M–$15M", "$15M–$60M", "Over $60M"].map((v) => <option key={v}>{v}</option>)}
              </select>
            </Field>

            <Field label="Current software stack" required>
              <select required value={form.currentStack} onChange={set("currentStack")} className={selectClass}>
                <option value="" disabled>Select…</option>
                {STACKS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>

            <Field label="Biggest documentation challenge">
              <textarea
                value={form.challenge}
                onChange={set("challenge")}
                rows={4}
                placeholder="Describe the bottleneck your team runs into with proof packages, supplement narratives, or carrier documentation today…"
                className={`${inputClass} resize-none`}
              />
            </Field>

            <Field label="How did you hear about RoofTrax?">
              <input value={form.referralSource} onChange={set("referralSource")} placeholder="Referral, LinkedIn, conference, etc." className={inputClass} />
            </Field>

            {/* Commitment acknowledgment */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className={`mt-0.5 h-4 w-4 flex-shrink-0 border flex items-center justify-center transition-colors ${form.committed ? "bg-orange-500 border-orange-500" : "border-white/20 group-hover:border-white/40"}`}>
                {form.committed && <Check className="h-2.5 w-2.5 text-black" strokeWidth={3} />}
              </div>
              <input
                type="checkbox"
                className="sr-only"
                checked={form.committed}
                onChange={(e) => setForm((f) => ({ ...f, committed: e.target.checked }))}
              />
              <span className="text-xs text-zinc-400 leading-relaxed">
                I confirm my company is located outside the DC/MD/VA metro, has an existing supplement process, and I can commit to running 10+ claims through the platform and attending weekly 30-minute calls during the 90-day beta.
              </span>
            </label>

            {error && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-orange-500 hover:bg-orange-400 disabled:opacity-60 disabled:cursor-not-allowed text-black text-sm font-black uppercase tracking-widest transition-colors"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
              ) : (
                <>Submit Application <ArrowRight className="h-4 w-4" /></>
              )}
            </button>

            <p className="text-xs text-zinc-600 text-center leading-relaxed">
              Applications are reviewed personally. If accepted, you'll hear from Logan directly within 3 business days.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, ArrowRight, ArrowLeft, Loader2, Check } from "lucide-react";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY",
  "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND",
  "OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

type FormData = {
  companyName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  state: string;
  county: string;
  reason: "coverage" | "capacity";
};

export default function TrialWaitlist() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState<FormData>({
    companyName: "",
    email: "",
    phone: "",
    licenseNumber: "",
    state: "",
    county: "",
    reason: "capacity",
  });
  
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("state")) setForm(f => ({ ...f, state: params.get("state") || "" }));
    if (params.has("county")) setForm(f => ({ ...f, county: params.get("county") || "" }));
    if (params.has("reason")) setForm(f => ({ ...f, reason: (params.get("reason") as any) || "capacity" }));
  }, []);

  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trial/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        throw new Error(`Error ${res.status}`);
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors";
  const selectClass = "w-full bg-zinc-900 border border-white/10 text-white text-sm px-4 py-3 focus:outline-none focus:border-orange-500/50 transition-colors appearance-none cursor-pointer";

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Nav */}
      <nav className="h-14 flex items-center justify-between px-6 md:px-10 border-b border-white/10 shrink-0">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-orange-500" strokeWidth={2.5} />
          <span className="text-lg font-black tracking-widest uppercase">
            <span className="text-white">ROOF</span><span className="text-orange-500">TRAX</span>
          </span>
        </button>
        <button
          onClick={() => navigate("/proof-package")}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      </nav>

      <div className="flex-1 flex flex-col justify-center py-16 px-6 max-w-2xl w-full mx-auto">
        {success ? (
          <div className="text-center flex flex-col items-center">
            <div className="h-16 w-16 bg-orange-500/10 border border-orange-500/30 flex items-center justify-center mb-8">
              <Check className="h-8 w-8 text-orange-500" />
            </div>
            <h1 className="text-3xl md:text-4xl font-black uppercase text-white leading-tight mb-4">
              You're on the list.
            </h1>
            <p className="text-zinc-400 max-w-md leading-relaxed mb-10">
              {form.reason === "coverage"
                ? `We haven't completed the code library for ${form.county}, ${form.state} yet. We'll reach out as soon as it's ready — usually a few weeks.`
                : "We'll reach out next week when spots open up for new trial packages."}
            </p>
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 px-6 py-3 border border-white/15 text-white text-xs font-bold uppercase tracking-widest hover:border-white/30 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
            </button>
          </div>
        ) : (
          <>
            <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6">Waitlist</div>
            <h1 className="text-3xl md:text-4xl font-black uppercase text-white leading-tight mb-4">
              {form.reason === "coverage" ? "Not in your area yet." : "We're at capacity."}
            </h1>
            <p className="text-sm text-zinc-400 mb-10">
              {form.reason === "coverage"
                ? `We haven't completed the code library for ${form.county || 'your county'}, ${form.state || 'your state'} yet. Add your name and we'll reach out as soon as it's ready — usually a few weeks.`
                : "We're currently at capacity for trial packages this week. Join the list and we'll open your spot next week."}
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Company Name *</label>
                <input required value={form.companyName} onChange={set("companyName")} className={inputClass} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Business Email *</label>
                  <input required type="email" value={form.email} onChange={set("email")} className={inputClass} />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Phone Number *</label>
                  <input required type="tel" value={form.phone} onChange={set("phone")} className={inputClass} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-2">State *</label>
                  <select required value={form.state} onChange={set("state")} className={selectClass}>
                    <option value="" disabled>Select state…</option>
                    {STATES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-2">County {form.reason === "coverage" ? "*" : ""}</label>
                  <input required={form.reason === "coverage"} value={form.county} onChange={set("county")} className={inputClass} />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-2">License Number</label>
                <input value={form.licenseNumber} onChange={set("licenseNumber")} className={inputClass} />
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 text-sm font-semibold text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-orange-500 hover:bg-orange-400 disabled:opacity-60 disabled:cursor-not-allowed text-black text-sm font-black uppercase tracking-widest transition-colors mt-8"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
                ) : (
                  <>Join Waitlist <ArrowRight className="h-4 w-4" /></>
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

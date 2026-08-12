import { useState } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY",
  "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND",
  "OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const STACKS = [
  "AccuLynx", "JobNimbus", "Roofr", "Jobber", "ServiceTitan",
  "Spreadsheets + Dropbox / Google Drive", "No formal system", "Other",
];

type FormData = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  licenseState: string;
  companySizeBand: string;
  monthlyClaimBand: string;
  currentCrm: string;
};

const EMPTY: FormData = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  licenseNumber: "",
  licenseState: "",
  companySizeBand: "",
  monthlyClaimBand: "",
  currentCrm: "",
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

export default function TrialStart() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState<FormData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trial/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Error ${res.status}`);
      }

      const data = await res.json();
      localStorage.setItem("rt_trial_token", data.token);
      navigate("/proof-package/submit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
        <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6">Step 1 of 5</div>
        <h1 className="text-3xl md:text-4xl font-black uppercase text-white leading-tight mb-8">
          Create your account
        </h1>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact name" required>
              <input required value={form.contactName} onChange={set("contactName")} placeholder="Logan Harrington" className={inputClass} />
            </Field>
            <Field label="Company name" required>
              <input required value={form.companyName} onChange={set("companyName")} placeholder="Acme Restoration LLC" className={inputClass} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Business email" required>
              <input required type="email" value={form.email} onChange={set("email")} placeholder="you@yourcompany.com" className={inputClass} />
            </Field>
            <Field label="Phone number" required>
              <input required type="tel" value={form.phone} onChange={set("phone")} placeholder="(540) 555-0100" className={inputClass} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Contractor License #" required>
              <input required value={form.licenseNumber} onChange={set("licenseNumber")} placeholder="12345678" className={inputClass} />
            </Field>
            <Field label="License State" required>
              <select required value={form.licenseState} onChange={set("licenseState")} className={selectClass}>
                <option value="" disabled>Select state…</option>
                {STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Company size" required>
              <select required value={form.companySizeBand} onChange={set("companySizeBand")} className={selectClass}>
                <option value="" disabled>Select…</option>
                {["1-3", "4-10", "11-25", "26-50", "50+"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Monthly claims" required>
              <select required value={form.monthlyClaimBand} onChange={set("monthlyClaimBand")} className={selectClass}>
                <option value="" disabled>Select…</option>
                {["1-5", "6-15", "16-40", "40+"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Current software stack">
            <select value={form.currentCrm} onChange={set("currentCrm")} className={selectClass}>
              <option value="" disabled>Select…</option>
              {STACKS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>

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
              <><Loader2 className="h-4 w-4 animate-spin" /> Creating account…</>
            ) : (
              <>Continue to Submission <ArrowRight className="h-4 w-4" /></>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

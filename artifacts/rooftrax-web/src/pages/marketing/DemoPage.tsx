import { useState } from "react";
import { MarketingLayout } from "../../components/layout/MarketingLayout";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export default function DemoPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    repCount: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await fetch("/api/demo-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
    } catch (err) {
      // Ignore error and show success
    } finally {
      setIsSubmitting(false);
      setSuccess(true);
    }
  };

  return (
    <MarketingLayout>
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950 flex flex-col md:flex-row gap-16 items-start max-w-6xl mx-auto w-full">
        <div className="flex-1">
          <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-[1.05] mb-8 tracking-tight">
            Book a <span className="text-orange-500">working session.</span>
          </h1>
          <p className="text-lg text-zinc-400 uppercase tracking-wide font-bold mb-12">
            No high-pressure sales pitch. We will walk through the platform, build a sample package, and see if RoofTrax fits your operation.
          </p>
          
          <ul className="space-y-6">
            <li className="flex items-start gap-4">
              <CheckCircle2 className="h-6 w-6 text-orange-500 shrink-0" />
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-white mb-1">Live Platform Tour</h3>
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">See the CRM, Mobile App, and Proof Package pipeline in action.</p>
              </div>
            </li>
            <li className="flex items-start gap-4">
              <CheckCircle2 className="h-6 w-6 text-orange-500 shrink-0" />
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-white mb-1">Pricing Breakdown</h3>
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Calculate exact costs based on your volume and headcount.</p>
              </div>
            </li>
            <li className="flex items-start gap-4">
              <CheckCircle2 className="h-6 w-6 text-orange-500 shrink-0" />
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-white mb-1">Implementation Plan</h3>
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Discuss onboarding timelines, AHJ library setup, and team training.</p>
              </div>
            </li>
          </ul>
        </div>

        <div className="w-full md:w-[450px] bg-zinc-900/30 border border-white/10 p-8 shrink-0">
          {success ? (
            <div className="text-center py-12">
              <div className="h-16 w-16 bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="h-8 w-8 text-orange-500" />
              </div>
              <h2 className="text-2xl font-black uppercase text-white mb-4">Request Received</h2>
              <p className="text-sm font-bold uppercase tracking-wide text-zinc-400">
                We'll reach out shortly to schedule your session.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="text-xs font-black uppercase tracking-widest text-orange-500 mb-6">
                Schedule Demo
              </div>
              
              <input
                required
                type="text"
                placeholder="FULL NAME"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                className="w-full bg-zinc-950 border border-white/10 p-4 text-white font-bold text-sm uppercase tracking-wide placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none transition-colors"
              />
              <input
                required
                type="text"
                placeholder="COMPANY NAME"
                value={formData.company}
                onChange={e => setFormData({...formData, company: e.target.value})}
                className="w-full bg-zinc-950 border border-white/10 p-4 text-white font-bold text-sm uppercase tracking-wide placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none transition-colors"
              />
              <input
                required
                type="email"
                placeholder="EMAIL ADDRESS"
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
                className="w-full bg-zinc-950 border border-white/10 p-4 text-white font-bold text-sm uppercase tracking-wide placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none transition-colors"
              />
              <input
                required
                type="tel"
                placeholder="PHONE NUMBER"
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
                className="w-full bg-zinc-950 border border-white/10 p-4 text-white font-bold text-sm uppercase tracking-wide placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none transition-colors"
              />
              <input
                required
                type="number"
                placeholder="TOTAL REPS & CANVASSERS"
                value={formData.repCount}
                onChange={e => setFormData({...formData, repCount: e.target.value})}
                className="w-full bg-zinc-950 border border-white/10 p-4 text-white font-bold text-sm uppercase tracking-wide placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none transition-colors"
              />
              
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-3 px-8 py-5 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-black text-sm font-black uppercase tracking-widest transition-colors mt-2"
              >
                {isSubmitting ? "Submitting..." : "Request Demo"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}
        </div>
      </section>
    </MarketingLayout>
  );
}

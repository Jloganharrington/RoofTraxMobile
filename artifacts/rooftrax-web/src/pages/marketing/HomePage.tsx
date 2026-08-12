import { Link, useLocation } from "wouter";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { MarketingLayout } from "../../components/layout/MarketingLayout";

export default function HomePage() {
  const [, setLocation] = useLocation();

  return (
    <MarketingLayout>
      {/* Hero section */}
      <section className="px-6 md:px-20 py-24 md:py-32 flex flex-col items-start max-w-6xl mx-auto w-full">
        <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-[1.05] mb-8 tracking-tight max-w-4xl">
          Turn your newest rep into your <span className="text-orange-500">best documenter.</span>
        </h1>
        <p className="text-lg md:text-2xl text-zinc-400 leading-relaxed max-w-3xl mb-12 uppercase tracking-wide font-bold">
          RoofTrax builds a complete forensic proof package from a phone inspection — code citations, damage assessment, exhibit manifest, all branded to your company.
        </p>

        <div className="flex flex-col sm:flex-row items-start gap-4">
          <button
            onClick={() => setLocation("/proof-package/start")}
            className="inline-flex items-center justify-center gap-3 px-8 py-5 bg-orange-500 hover:bg-orange-400 text-black text-sm font-black uppercase tracking-widest transition-colors w-full sm:w-auto"
          >
            Send us one claim — $100
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setLocation("/trial")}
            className="inline-flex items-center justify-center gap-3 px-8 py-5 border border-white/20 hover:bg-white/5 text-white text-sm font-black uppercase tracking-widest transition-colors w-full sm:w-auto"
          >
            See a proof package
          </button>
        </div>
      </section>

      {/* Problem section */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-6">
            One person is your documentation bottleneck.
          </h2>
          <p className="text-lg text-zinc-400 uppercase tracking-wide font-bold mb-16">
            Every rep you hire makes it worse.
          </p>

          <div className="grid md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <h3 className="text-xl font-black uppercase text-zinc-500 flex items-center gap-3">
                <XCircle className="h-6 w-6 text-zinc-600" /> Before
              </h3>
              <ul className="space-y-4">
                {[
                  "Reps take photos and dump them in a folder",
                  "Managers spend hours building reports",
                  "Code research is done from scratch every time",
                  "Quality drops when volume spikes",
                  "Supplements get missed or delayed"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm font-bold uppercase tracking-wide text-zinc-400 bg-zinc-950 p-4 border border-white/5">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-6">
              <h3 className="text-xl font-black uppercase text-white flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-orange-500" /> After
              </h3>
              <ul className="space-y-4">
                {[
                  "Reps follow guided mobile inspections",
                  "Software compiles the proof package",
                  "Code library auto-applies jurisdiction data",
                  "Consistent quality on every single claim",
                  "Turnaround time drops to 48 hours"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm font-bold uppercase tracking-wide text-white bg-zinc-950 p-4 border border-orange-500/20 shadow-[0_0_15px_rgba(249,115,22,0.1)]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="px-6 md:px-20 py-32 border-t border-white/10 bg-orange-500 text-black">
        <div className="max-w-6xl mx-auto flex flex-col items-start">
          <h2 className="text-5xl md:text-7xl font-black uppercase mb-6 leading-none">
            $50 a claim.
          </h2>
          <p className="text-2xl md:text-3xl font-black uppercase tracking-tight mb-8">
            About what you pay for a measurement report.
          </p>
          <p className="text-lg md:text-xl font-bold uppercase tracking-wide mb-12 max-w-2xl text-black/80">
            One gets you geometry. The other builds the file.
          </p>
          
          <Link href="/pricing" className="inline-flex items-center gap-4 text-xl font-black uppercase tracking-widest hover:pl-4 transition-all group">
            See pricing breakdown <ArrowRight className="h-6 w-6 group-hover:translate-x-2 transition-transform" />
          </Link>
        </div>
      </section>

      {/* Who it is for */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-950">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-16">
            Scale by the pod.
          </h2>
          
          <div className="border border-white/10 bg-zinc-900/30 overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-white/10 bg-black/50">
                  <th className="p-6 text-xs font-black uppercase tracking-widest text-zinc-500">Pods</th>
                  <th className="p-6 text-xs font-black uppercase tracking-widest text-zinc-500">Seats</th>
                  <th className="p-6 text-xs font-black uppercase tracking-widest text-zinc-500">Claims / Yr</th>
                  <th className="p-6 text-xs font-black uppercase tracking-widest text-zinc-500 text-right">Est. Revenue</th>
                </tr>
              </thead>
              <tbody className="text-sm font-bold uppercase tracking-wide">
                <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="p-6 text-white">1 pod</td>
                  <td className="p-6 text-zinc-400">3 seats</td>
                  <td className="p-6 text-zinc-400">208 claims</td>
                  <td className="p-6 text-orange-500 text-right">~$4.6M</td>
                </tr>
                <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="p-6 text-white">3 pods</td>
                  <td className="p-6 text-zinc-400">9 seats</td>
                  <td className="p-6 text-zinc-400">624 claims</td>
                  <td className="p-6 text-orange-500 text-right">~$13.7M</td>
                </tr>
                <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="p-6 text-white">5 pods</td>
                  <td className="p-6 text-zinc-400">15 seats</td>
                  <td className="p-6 text-zinc-400">1040 claims</td>
                  <td className="p-6 text-orange-500 text-right">~$22.9M</td>
                </tr>
                <tr className="hover:bg-white/5 transition-colors">
                  <td className="p-6 text-white">12 pods</td>
                  <td className="p-6 text-zinc-400">36 seats</td>
                  <td className="p-6 text-zinc-400">2496 claims</td>
                  <td className="p-6 text-orange-500 text-right">~$54.9M</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs font-bold uppercase tracking-widest text-zinc-600">
            * Note: 1 rep plus 2 canvassers equals 1 pod.
          </p>
        </div>
      </section>

      {/* Founder section */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-16 items-center">
          <div className="flex-1 space-y-8">
            <h2 className="text-3xl md:text-5xl font-black uppercase text-white leading-tight">
              Built in a live restoration department.
            </h2>
            <p className="text-lg text-zinc-400 uppercase tracking-wide font-bold leading-relaxed max-w-2xl">
              Twenty years in insurance restoration. Not built by Silicon Valley tourists. Built by operators to solve the documentation bottleneck once and for all.
            </p>
            <Link href="/company" className="inline-flex items-center gap-3 text-sm font-black uppercase tracking-widest text-orange-500 hover:text-orange-400 transition-colors">
              Read the story <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer CTA band */}
      <section className="px-6 md:px-20 py-24 border-t border-white/10 text-center flex flex-col items-center">
        <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-10">
          Ready to see it on a real claim?
        </h2>
        <button
          onClick={() => setLocation("/proof-package/start")}
          className="inline-flex items-center justify-center gap-3 px-10 py-6 bg-orange-500 hover:bg-orange-400 text-black text-sm font-black uppercase tracking-widest transition-colors shadow-[0_0_30px_rgba(249,115,22,0.3)]"
        >
          Send us one claim — $100
          <ArrowRight className="h-4 w-4" />
        </button>
      </section>
    </MarketingLayout>
  );
}

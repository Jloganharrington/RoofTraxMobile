import { MarketingLayout } from "../../../components/layout/MarketingLayout";
import { CheckCircle2, MinusCircle, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function JobNimbusPage() {
  return (
    <MarketingLayout>
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950 text-center flex flex-col items-center">
        <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-[1.05] mb-8 tracking-tight max-w-4xl">
          They track the job. <span className="text-orange-500">We build the file.</span>
        </h1>
        <p className="text-lg md:text-xl text-zinc-400 uppercase tracking-wide font-bold max-w-2xl mb-12">
          Why restoration contractors switch from JobNimbus to RoofTrax.
        </p>
      </section>

      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-0 border border-white/10">
            {/* The Alternative */}
            <div className="bg-zinc-950 p-8 md:p-12 border-b md:border-b-0 md:border-r border-white/10">
              <h2 className="text-2xl font-black uppercase text-white mb-8">JobNimbus</h2>
              <ul className="space-y-6">
                <li className="flex items-start gap-4">
                  <MinusCircle className="h-6 w-6 text-zinc-600 shrink-0" />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-zinc-300 mb-1">Per-User Billing</h3>
                    <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Every new rep or canvasser increases your monthly overhead.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <MinusCircle className="h-6 w-6 text-zinc-600 shrink-0" />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-zinc-300 mb-1">Project Board Focus</h3>
                    <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">A Kanban board for moving jobs left to right.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <MinusCircle className="h-6 w-6 text-zinc-600 shrink-0" />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-zinc-300 mb-1">Do-It-Yourself Documentation</h3>
                    <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">You are still responsible for compiling exhibits, citations, and summaries.</p>
                  </div>
                </li>
              </ul>
            </div>

            {/* RoofTrax */}
            <div className="bg-orange-500 p-8 md:p-12 text-black shadow-[0_0_30px_rgba(249,115,22,0.2)] z-10 relative">
              <h2 className="text-2xl font-black uppercase mb-8">RoofTrax</h2>
              <ul className="space-y-6">
                <li className="flex items-start gap-4">
                  <CheckCircle2 className="h-6 w-6 text-black shrink-0" />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest mb-1">Per-Claim Billing</h3>
                    <p className="text-xs font-bold uppercase tracking-wide text-black/70">Seats are completely free. You only pay when we produce a complete file.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <CheckCircle2 className="h-6 w-6 text-black shrink-0" />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest mb-1">Restoration Specific</h3>
                    <p className="text-xs font-bold uppercase tracking-wide text-black/70">Pipelines built for claim approvals, not just job tracking.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <CheckCircle2 className="h-6 w-6 text-black shrink-0" />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest mb-1">Automated Proof Packages</h3>
                    <p className="text-xs font-bold uppercase tracking-wide text-black/70">From a phone inspection to a fully cited forensic file in 48 hours.</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 md:px-20 py-24 border-t border-white/10 text-center flex flex-col items-center">
        <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-10">
          Ready to see the difference?
        </h2>
        <Link href="/demo" className="inline-flex items-center justify-center gap-3 px-10 py-6 bg-orange-500 hover:bg-orange-400 text-black text-sm font-black uppercase tracking-widest transition-colors">
          Book a Demo <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </MarketingLayout>
  );
}

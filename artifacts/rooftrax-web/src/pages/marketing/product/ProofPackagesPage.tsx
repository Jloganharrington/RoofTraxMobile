import { MarketingLayout } from "../../../components/layout/MarketingLayout";
import { ArrowRight, CheckCircle2, FileCheck } from "lucide-react";
import { Link } from "wouter";

export default function ProofPackagesPage() {
  return (
    <MarketingLayout>
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950">
        <div className="max-w-4xl">
          <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6 flex items-center gap-2">
            <FileCheck className="h-4 w-4" /> Core Product
          </div>
          <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-[1.05] mb-8 tracking-tight">
            One claim. <span className="text-orange-500">One package.</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 uppercase tracking-wide font-bold max-w-2xl mb-12">
            Complete forensic documentation from a phone inspection. Code citations, exhibit manifest, and branded output ready in 48 hours.
          </p>
          <Link href="/proof-package/start" className="inline-flex items-center justify-center gap-3 px-8 py-5 bg-orange-500 hover:bg-orange-400 text-black text-sm font-black uppercase tracking-widest transition-colors w-full sm:w-auto">
            Send us one claim — $100 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-16">The Assembly Line</h2>
          
          <div className="flex flex-col md:flex-row gap-4">
            {[
              { step: "01", title: "Intake", desc: "Basic claim details and policy info." },
              { step: "02", title: "Inspection", desc: "Guided photo capture in the mobile app." },
              { step: "03", title: "Assembly", desc: "AI sorts photos and extracts key data." },
              { step: "04", title: "Manifest", desc: "Exhibit generation and code citation matching." },
              { step: "05", title: "Delivery", desc: "Your branded file, ready to submit." }
            ].map((s, i) => (
              <div key={i} className="flex-1 bg-zinc-950 border border-white/10 p-6 relative group hover:border-orange-500 transition-colors">
                <div className="text-[10px] font-black uppercase tracking-widest text-orange-500 mb-4">{s.step}</div>
                <h3 className="text-sm font-black uppercase tracking-widest text-white mb-3">{s.title}</h3>
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 md:px-20 py-24 border-t border-white/10">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-16">
          <div>
            <h2 className="text-3xl md:text-5xl font-black uppercase text-white mb-8">What makes it different</h2>
            <ul className="space-y-6">
              {[
                { title: "Code Citations Included", desc: "Every applicable building code for that specific jurisdiction, researched and attached." },
                { title: "Fully Branded Output", desc: "Your logo, your license number, your company identity. We are invisible." },
                { title: "Free Supplements", desc: "Generate revision documents and supplement requests on an existing claim as many times as you need." },
                { title: "Unmatched Turnaround", desc: "Consistent 48-hour delivery, even in peak storm season." }
              ].map((item, i) => (
                <li key={i} className="flex gap-4">
                  <CheckCircle2 className="h-6 w-6 text-orange-500 shrink-0 mt-1" />
                  <div>
                    <h4 className="text-sm font-black uppercase tracking-widest text-white mb-2">{item.title}</h4>
                    <p className="text-sm font-bold uppercase tracking-wide text-zinc-400">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-zinc-950 border border-white/10 p-12 flex flex-col justify-center">
            <div className="text-4xl font-black uppercase text-white mb-6">"Is this guaranteed to get the claim approved?"</div>
            <p className="text-lg font-bold uppercase tracking-wide text-zinc-400 mb-8">
              No. We do not guarantee outcomes. We provide capabilities. We deliver a faster turnaround and a higher quality baseline of documentation than a manual process can achieve at scale.
            </p>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

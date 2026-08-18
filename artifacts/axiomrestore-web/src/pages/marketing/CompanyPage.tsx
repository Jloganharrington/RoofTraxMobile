import { MarketingLayout } from "../../components/layout/MarketingLayout";
import { ShieldCheck, Database, History } from "lucide-react";

export default function CompanyPage() {
  return (
    <MarketingLayout>
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-[1.05] mb-8 tracking-tight">
            Built by <span className="text-orange-500">operators.</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 uppercase tracking-wide font-bold mb-12">
            Software for the restoration industry, built by the restoration industry.
          </p>
        </div>
      </section>

      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-4xl mx-auto space-y-24">
          
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="h-16 w-16 bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
              <History className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-widest text-white mb-4">Twenty Years in Restoration</h2>
              <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed">
                Our founder has twenty years in insurance restoration. AxiomRestore was not conceived in a Silicon Valley boardroom. It was built and proven in a live restoration department, designed to solve the documentation bottleneck that limits growth. We know what it takes to build a file because we have built thousands of them.
              </p>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="h-16 w-16 bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-8 w-8 text-orange-500" />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-widest text-white mb-4">Independence Statement</h2>
              <div className="bg-zinc-950 border border-orange-500/20 p-8 shadow-[0_0_20px_rgba(249,115,22,0.05)]">
                <p className="text-sm font-black uppercase tracking-widest text-orange-500 leading-relaxed">
                  AxiomRestore is an independent software company.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="h-16 w-16 bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
              <Database className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-widest text-white mb-4">Data Neutrality</h2>
              <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed">
                Your data is your data. Every customer operates as an isolated tenant within our architecture. No customer can see another's data, and we do not use your proprietary information, customer lists, or pricing strategies for any purpose outside of delivering your software experience.
              </p>
            </div>
          </div>

        </div>
      </section>
    </MarketingLayout>
  );
}

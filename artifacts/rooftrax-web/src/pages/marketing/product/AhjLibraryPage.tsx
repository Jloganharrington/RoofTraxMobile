import { MarketingLayout } from "../../../components/layout/MarketingLayout";
import { BookOpen, CheckCircle2 } from "lucide-react";

export default function AhjLibraryPage() {
  return (
    <MarketingLayout>
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950">
        <div className="max-w-4xl">
          <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6 flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> AHJ Library
          </div>
          <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-[1.05] mb-8 tracking-tight">
            Every jurisdiction. <span className="text-orange-500">Built once.</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 uppercase tracking-wide font-bold max-w-2xl mb-12">
            A centralized code library for every jurisdiction you work in. Built once, available forever, automatically applied to your proof packages.
          </p>
        </div>
      </section>

      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-16">
          <div className="flex flex-col justify-center">
            <h2 className="text-3xl font-black uppercase text-white mb-6">Stop researching from scratch.</h2>
            <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed mb-6">
              When a supplement is denied for lack of code support, your desk team wastes hours digging up the same local amendments they found last month.
            </p>
            <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed">
              We research and digitize the Authority Having Jurisdiction (AHJ) code packets for your territory during onboarding. When a claim drops in that zip code, the citations are attached automatically.
            </p>
          </div>
          <ul className="space-y-6">
            {[
              "Digital local amendments",
              "Automatic zip-code matching",
              "Code support for supplements",
              "Always up to date"
            ].map((item, i) => (
              <li key={i} className="flex gap-4 items-center bg-zinc-950 p-6 border border-white/10">
                <CheckCircle2 className="h-6 w-6 text-orange-500 shrink-0" />
                <span className="text-sm font-black uppercase tracking-widest text-white">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </MarketingLayout>
  );
}

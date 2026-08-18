import { MarketingLayout } from "../../../components/layout/MarketingLayout";
import { MapPin, CheckCircle2 } from "lucide-react";

export default function CanvassingPage() {
  return (
    <MarketingLayout>
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950">
        <div className="max-w-4xl">
          <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6 flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Canvassing
          </div>
          <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-[1.05] mb-8 tracking-tight">
            Built for the <span className="text-orange-500">pod model.</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 uppercase tracking-wide font-bold max-w-2xl mb-12">
            Drop pins, track territories, and hand off qualified leads from canvasser to rep seamlessly.
          </p>
        </div>
      </section>

      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-16">
          <ul className="space-y-6">
            {[
              "One rep + two canvassers = one pod",
              "Live territory tracking",
              "Instant lead handoff",
              "Knock history and dispositions"
            ].map((item, i) => (
              <li key={i} className="flex gap-4 items-center bg-zinc-950 p-6 border border-white/10">
                <CheckCircle2 className="h-6 w-6 text-orange-500 shrink-0" />
                <span className="text-sm font-black uppercase tracking-widest text-white">{item}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col justify-center">
            <h2 className="text-3xl font-black uppercase text-white mb-6">Scale systematically.</h2>
            <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed mb-6">
              The fastest growing restoration companies scale by pods, not individual contributors.
            </p>
            <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed">
              Our canvassing tool is designed specifically around this model. Canvassers drop pins and qualify leads. Reps pick them up and run the inspection. Managers track the pod's performance in real time.
            </p>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

import { MarketingLayout } from "../../../components/layout/MarketingLayout";
import { Smartphone, CheckCircle2 } from "lucide-react";

export default function MobilePage() {
  return (
    <MarketingLayout>
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950">
        <div className="max-w-4xl">
          <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-6 flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Field App
          </div>
          <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-[1.05] mb-8 tracking-tight">
            Before you leave <span className="text-orange-500">the driveway.</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 uppercase tracking-wide font-bold max-w-2xl mb-12">
            A guided inspection app that ensures your reps capture exactly what the desk team needs, every single time.
          </p>
        </div>
      </section>

      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-16">
          <div className="flex flex-col justify-center">
            <h2 className="text-3xl font-black uppercase text-white mb-6">Stop dumping photos.</h2>
            <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed mb-6">
              When reps take photos with a native camera app, they miss angles, forget context, and create hours of sorting work for the office.
            </p>
            <p className="text-sm font-bold uppercase tracking-wide text-zinc-400 leading-relaxed">
              Our mobile app forces a structured workflow. It tells them what to photograph, when to photograph it, and automatically tags the location and timestamp. The file is built before they put the truck in drive.
            </p>
          </div>
          <ul className="space-y-6">
            {[
              "Guided photo capture workflow",
              "Offline mode for remote areas",
              "Automatic geo-tagging",
              "Instant sync with CRM pipeline"
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

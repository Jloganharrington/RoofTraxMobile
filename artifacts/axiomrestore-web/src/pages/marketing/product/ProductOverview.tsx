import { Link } from "wouter";
import { MarketingLayout } from "../../../components/layout/MarketingLayout";
import { FileCheck, Smartphone, MapPin, Database, BookOpen, ArrowRight } from "lucide-react";

export default function ProductOverview() {
  const products = [
    {
      title: "Proof Packages",
      desc: "One claim, one package. Complete forensic documentation branded to your company.",
      icon: FileCheck,
      href: "/product/proof-packages",
      featured: true
    },
    {
      title: "Mobile App",
      desc: "Guided field inspections. Build the file before you leave the driveway.",
      icon: Smartphone,
      href: "/product/mobile",
      featured: false
    },
    {
      title: "Canvassing",
      desc: "Drop pins, track pods, claim territory. Built for the pod model.",
      icon: MapPin,
      href: "/product/canvassing",
      featured: false
    },
    {
      title: "CRM & Pipeline",
      desc: "File management and automation built for restoration.",
      icon: Database,
      href: "/product/crm",
      featured: false
    },
    {
      title: "AHJ Library",
      desc: "Code citations for every jurisdiction you work in. Built once, available forever.",
      icon: BookOpen,
      href: "/product/ahj-library",
      featured: false
    }
  ];

  return (
    <MarketingLayout>
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950 text-center flex flex-col items-center">
        <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-none mb-6 tracking-tight max-w-4xl">
          The complete platform for <span className="text-orange-500">insurance restoration.</span>
        </h1>
        <p className="text-lg md:text-xl text-zinc-400 uppercase tracking-wide font-bold max-w-2xl">
          Five tools built to eliminate the documentation bottleneck.
        </p>
      </section>

      <section className="px-6 md:px-20 py-24 border-t border-white/10 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((p, i) => (
            <Link 
              key={i} 
              href={p.href}
              className={`block p-8 transition-all group ${p.featured ? "md:col-span-2 lg:col-span-2 bg-orange-500 text-black hover:bg-orange-400 shadow-[0_0_30px_rgba(249,115,22,0.2)]" : "bg-zinc-950 border border-white/10 hover:border-white/30"}`}
            >
              <div className={`h-12 w-12 flex items-center justify-center mb-8 ${p.featured ? "bg-black/10" : "bg-white/5 border border-white/10"}`}>
                <p.icon className={`h-6 w-6 ${p.featured ? "text-black" : "text-white"}`} />
              </div>
              <h2 className={`text-2xl font-black uppercase tracking-tight mb-4 ${p.featured ? "text-black" : "text-white"}`}>
                {p.title}
              </h2>
              <p className={`text-sm font-bold uppercase tracking-wide mb-8 ${p.featured ? "text-black/80" : "text-zinc-400"}`}>
                {p.desc}
              </p>
              <div className={`flex items-center gap-2 text-xs font-black uppercase tracking-widest ${p.featured ? "text-black" : "text-orange-500"}`}>
                Explore <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </MarketingLayout>
  );
}

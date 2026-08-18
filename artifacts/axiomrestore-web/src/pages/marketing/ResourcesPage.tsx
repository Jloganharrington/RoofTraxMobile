import { MarketingLayout } from "../../components/layout/MarketingLayout";
import { ArrowRight, Video, FileText } from "lucide-react";
import { Link } from "wouter";

export default function ResourcesPage() {
  return (
    <MarketingLayout>
      <section className="px-6 md:px-20 py-24 md:py-32 bg-zinc-950 text-center flex flex-col items-center flex-1 justify-center min-h-[60vh]">
        <h1 className="text-5xl md:text-7xl font-black uppercase text-white leading-none mb-6 tracking-tight">
          Resources <span className="text-orange-500">coming soon.</span>
        </h1>
        <p className="text-lg md:text-xl text-zinc-400 uppercase tracking-wide font-bold max-w-2xl mb-12">
          We are currently producing a series of claim teardown videos and field inspection guides.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 mb-16">
          <div className="flex items-center gap-3 px-6 py-4 bg-zinc-900 border border-white/10 text-white text-sm font-black uppercase tracking-widest opacity-50">
            <Video className="h-4 w-4" /> Teardown Videos
          </div>
          <div className="flex items-center gap-3 px-6 py-4 bg-zinc-900 border border-white/10 text-white text-sm font-black uppercase tracking-widest opacity-50">
            <FileText className="h-4 w-4" /> Field Guides
          </div>
        </div>

        <div className="flex gap-4">
          <Link href="/demo" className="text-sm font-black uppercase tracking-widest text-white hover:text-orange-500 transition-colors flex items-center gap-2">
            Book a Demo <ArrowRight className="h-4 w-4" />
          </Link>
          <span className="text-zinc-600">•</span>
          <Link href="/trial" className="text-sm font-black uppercase tracking-widest text-white hover:text-orange-500 transition-colors flex items-center gap-2">
            See a Proof Package <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}

import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import logoDark from "@/assets/logo-dark.png";

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-orange-500/30 flex flex-col font-sans">
      <nav className="h-14 flex items-center justify-between px-6 md:px-10 border-b border-white/10 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <Link href="/">
          <img src={logoDark} alt="AxiomRestore" className="h-8 w-auto" />
        </Link>
        
        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
          <Link href="/product" className="text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
            Product
          </Link>
          <Link href="/pricing" className="text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
            Pricing
          </Link>
          <Link href="/trial" className="text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
            Proof Package
          </Link>
          <Link href="/demo" className="text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
            Demo
          </Link>
          <button
            onClick={() => setLocation("/proof-package/start")}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-400 text-black text-xs font-black uppercase tracking-widest transition-colors"
          >
            Send us one claim — $100
          </button>
        </div>

        {/* Mobile Hamburger */}
        <button className="md:hidden text-white" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 top-14 bg-zinc-950 z-40 flex flex-col items-center justify-center gap-8 border-b border-white/10 px-6">
          <Link href="/product" onClick={() => setIsOpen(false)} className="text-xl font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
            Product
          </Link>
          <Link href="/pricing" onClick={() => setIsOpen(false)} className="text-xl font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
            Pricing
          </Link>
          <Link href="/trial" onClick={() => setIsOpen(false)} className="text-xl font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
            Proof Package
          </Link>
          <Link href="/demo" onClick={() => setIsOpen(false)} className="text-xl font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
            Demo
          </Link>
          <button
            onClick={() => {
              setIsOpen(false);
              setLocation("/proof-package/start");
            }}
            className="mt-4 px-8 py-4 bg-orange-500 hover:bg-orange-400 text-black text-sm font-black uppercase tracking-widest transition-colors w-full"
          >
            Send us one claim — $100
          </button>
        </div>
      )}

      <main className="flex-1 flex flex-col">
        {children}
      </main>

      <footer className="px-6 md:px-10 py-12 border-t border-white/10 bg-zinc-950 text-zinc-500">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start gap-8">
          <div className="max-w-md">
            <div className="mb-4 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all">
              <img src={logoDark} alt="AxiomRestore" className="h-7 w-auto" />
            </div>
            <p className="text-xs leading-relaxed uppercase tracking-wide">
              AxiomRestore is an independent software company.
            </p>
          </div>
          <div className="flex flex-col gap-4 text-xs font-bold uppercase tracking-widest">
            <Link href="/company" className="hover:text-white transition-colors">Company</Link>
            <Link href="/resources" className="hover:text-white transition-colors">Resources</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

import { useLocation } from "wouter";
import { useEffect } from "react";
import { useGetCurrentAuthUser } from "@workspace/api-client-react";
import { ShieldCheck, ChevronRight, Loader2, ArrowRight } from "lucide-react";

export default function Home() {
  const { data: authEnvelope, isLoading } = useGetCurrentAuthUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && authEnvelope?.user) {
      // Resume the pipeline the user last visited; default to insurance on first visit.
      const last = localStorage.getItem('rt_last_pipeline') ?? '/insurance-pipeline';
      setLocation(last);
    }
  }, [isLoading, authEnvelope, setLocation]);

  const handleLogin = () => {
    const last = localStorage.getItem('rt_last_pipeline') ?? '/insurance-pipeline';
    window.location.href = `/api/login?returnTo=/rooftrax-web${last}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <header className="px-8 h-14 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-primary" strokeWidth={2.5} />
          <span
            className="text-lg font-black tracking-widest uppercase"
            style={{ fontFamily: "var(--app-font-condensed)" }}
          >
            <span className="text-foreground">ROOF</span>
            <span className="text-primary">TRAX</span>
          </span>
        </div>
        <button
          onClick={handleLogin}
          data-testid="button-login"
          className="px-5 py-2 text-xs font-bold uppercase tracking-widest border border-border text-foreground hover:border-primary hover:text-primary transition-colors"
        >
          Login
        </button>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col">
        <section className="flex-1 flex items-center px-8 md:px-20 py-24">
          <div className="max-w-3xl">
            {/* Pill badges */}
            <div className="flex items-center gap-3 mb-10">
              <span className="px-3 py-1 border border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                V2.0 Command Center Live
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                <ShieldCheck className="h-3 w-3" /> Purpose-Built
              </span>
            </div>

            {/* Headline */}
            <h1
              className="text-6xl md:text-8xl font-black uppercase leading-none mb-8"
              style={{ fontFamily: "var(--app-font-condensed)", letterSpacing: "0.01em" }}
            >
              <span className="block text-foreground">Two Systems.</span>
              <span className="block">
                One{" "}
                <span className="text-primary">Command</span>
              </span>
              <span className="block text-foreground">Center.</span>
            </h1>

            <p className="text-base text-muted-foreground mb-12 max-w-xl leading-relaxed">
              Stop reviewing storm inspections in spreadsheets. RoofTrax combines AI-powered forensic analysis with a purpose-built estimate engine — so you can close claims faster and manage jobs without the chaos.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleLogin}
                data-testid="button-access-portal"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-colors"
              >
                Start Commanding <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={handleLogin}
                className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-border text-foreground text-xs font-bold uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
              >
                Access Portal <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Feature strip */}
        <section className="border-t border-border grid md:grid-cols-3">
          {[
            {
              label: "AI Summaries",
              desc: "Field evidence processed into professional forensic narratives and repairability analysis — ready for adjuster review.",
            },
            {
              label: "Estimate Builder",
              desc: "Build line-item estimates from your synchronized price book catalog. Waste factor, measured basis, and subtotals in one view.",
            },
            {
              label: "Team Control",
              desc: "Manage rep access, assign roles, and oversee the entire inspection workflow from a single command center.",
            },
          ].map((f, i) => (
            <div
              key={f.label}
              className={`p-8 ${i < 2 ? "border-r border-border" : ""}`}
            >
              <div className="text-[10px] font-bold uppercase tracking-widest text-primary mb-3">
                0{i + 1}
              </div>
              <h3 className="text-lg font-black uppercase tracking-wide text-foreground mb-3" style={{ fontFamily: "var(--app-font-condensed)" }}>
                {f.label}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

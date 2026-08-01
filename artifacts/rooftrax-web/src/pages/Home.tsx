import { useLocation } from "wouter";
import { useEffect } from "react";
import { useGetCurrentAuthUser } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Shield, Zap, FileText, ChevronRight, Loader2 } from "lucide-react";

export default function Home() {
  const { data: authEnvelope, isLoading } = useGetCurrentAuthUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && authEnvelope?.user) {
      setLocation("/inspections");
    }
  }, [isLoading, authEnvelope, setLocation]);

  const handleLogin = () => {
    window.location.href = `/api/login?returnTo=/rooftrax-web/inspections`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If user is here, they are not logged in.
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-2 text-2xl font-bold tracking-tight text-primary">
          <Shield className="h-6 w-6" /> RoofTrax
        </div>
        <Button onClick={handleLogin} variant="outline" className="font-semibold">
          Sign In
        </Button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-20 max-w-4xl mx-auto">
        <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold mb-8 bg-muted text-muted-foreground">
          Forensic Review Platform
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-foreground mb-6">
          Command Center for <br className="hidden md:block"/> Professional Roofers
        </h1>
        <p className="text-xl text-muted-foreground mb-10 max-w-2xl">
          Review AI-generated evidence summaries, build precise repair estimates from your catalog, and manage field operations.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 mb-20">
          <Button size="lg" onClick={handleLogin} className="text-lg px-8 h-14">
            Access Portal <ChevronRight className="ml-2 h-5 w-5" />
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-8 text-left w-full">
          <div className="p-6 rounded-xl border bg-card shadow-sm">
            <Zap className="h-10 w-10 text-primary mb-4" />
            <h3 className="text-xl font-bold mb-2">AI Summaries</h3>
            <p className="text-muted-foreground">Instantly process field evidence into professional forensic narratives and repairability text.</p>
          </div>
          <div className="p-6 rounded-xl border bg-card shadow-sm">
            <FileText className="h-10 w-10 text-primary mb-4" />
            <h3 className="text-xl font-bold mb-2">Estimator</h3>
            <p className="text-muted-foreground">Build line-item estimates directly from your synchronized company price book catalog.</p>
          </div>
          <div className="p-6 rounded-xl border bg-card shadow-sm">
            <Shield className="h-10 w-10 text-primary mb-4" />
            <h3 className="text-xl font-bold mb-2">Team Control</h3>
            <p className="text-muted-foreground">Manage rep access, track performance metrics, and oversee the entire validation workflow.</p>
          </div>
        </div>
      </main>
    </div>
  );
}

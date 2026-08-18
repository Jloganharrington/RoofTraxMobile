import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ShieldCheck, ArrowLeft, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

export default function PricingSuccessPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const subscriptionId = params.get("subscription_id");

    if (!sessionId || !subscriptionId) {
      setError("Missing session information.");
      setLoading(false);
      return;
    }

    const confirmPayment = async () => {
      try {
        const token = localStorage.getItem("rt_trial_token");
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch("/api/pricing/checkout/confirm", {
          method: "POST",
          headers,
          body: JSON.stringify({ subscriptionId, sessionId })
        });
        
        const result = await res.json();
        
        if (!res.ok) {
          if (res.status === 402) {
            setError("Payment was not completed or was declined.");
          } else {
            setError(result.error || "Failed to confirm payment.");
          }
        } else {
          setData(result);
        }
      } catch (err) {
        console.error(err);
        setError("An unexpected error occurred while confirming payment.");
      } finally {
        setLoading(false);
      }
    };

    confirmPayment();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-orange-500/30 flex flex-col">
      {/* Nav */}
      <nav className="h-14 flex items-center justify-between px-6 md:px-10 border-b border-white/10 bg-zinc-950/80 backdrop-blur sticky top-0 z-50 shrink-0">
        <Link href="/" className="flex items-center gap-2.5 group">
          <ShieldCheck className="h-5 w-5 text-orange-500 group-hover:text-orange-400 transition-colors" strokeWidth={2.5} />
          <span className="text-lg font-black tracking-widest uppercase">
            <span className="text-white">ROOF</span><span className="text-orange-500 group-hover:text-orange-400 transition-colors">TRAX</span>
          </span>
        </Link>
        <Link
          href="/pricing"
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Pricing
        </Link>
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-zinc-900/50 border border-white/10 p-8 md:p-12 text-center">
          {loading ? (
            <div className="flex flex-col items-center">
              <Loader2 className="h-12 w-12 text-orange-500 animate-spin mb-6" />
              <h1 className="text-2xl font-black uppercase tracking-widest text-white mb-2">Verifying Payment</h1>
              <p className="text-sm text-zinc-400">Please do not close this window...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
                <AlertTriangle className="h-8 w-8 text-red-500" />
              </div>
              <h1 className="text-2xl font-black uppercase tracking-widest text-red-400 mb-4">Payment Incomplete</h1>
              <p className="text-sm text-zinc-400 mb-8">{error}</p>
              <Link href="/pricing" className="inline-flex items-center justify-center px-6 py-3 border border-white/15 text-white text-xs font-black uppercase tracking-widest hover:border-white/30 transition-colors w-full">
                Return to Pricing
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-6">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <h1 className="text-2xl font-black uppercase tracking-widest text-white mb-2">Subscription Confirmed</h1>
              <p className="text-sm text-zinc-400 mb-8">
                Your {data?.tierKey} ({data?.billing}) subscription is now active. We've sent a receipt and onboarding instructions to your email.
              </p>
              <Link href="/dashboard" className="inline-flex items-center justify-center px-6 py-4 bg-orange-500 hover:bg-orange-400 text-black text-xs font-black uppercase tracking-widest transition-colors w-full">
                Go to Dashboard
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

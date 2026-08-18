import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { ShieldCheck, ArrowLeft, Clock, FileCheck, CheckCircle2, AlertTriangle, FileSignature, Box, Mail, XCircle } from "lucide-react";
import { format } from "date-fns";

export default function TrialStatus() {
  const [, navigate] = useLocation();
  const { id } = useParams();
  const [data, setData] = useState<{ submission: any; expectedDate?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const token = localStorage.getItem("rt_trial_token");
        if (!token) {
          navigate("/proof-package/start");
          return;
        }
        // Returning from Stripe Checkout: verify the session server-side
        // (idempotent) before loading status, then clean the URL.
        const params = new URLSearchParams(window.location.search);
        const checkoutSession = params.get("checkout_session");
        if (checkoutSession) {
          try {
            await fetch(`/api/trial/submissions/${id}/checkout/confirm`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: checkoutSession }),
            });
          } catch {
            // Non-fatal: the webhook/status view will still reflect payment.
          }
          window.history.replaceState({}, "", window.location.pathname);
        }
        const res = await fetch(`/api/trial/submissions/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Failed to load status");
        
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      } finally {
        setLoading(false);
      }
    };
    if (id) fetchStatus();
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-orange-500 font-bold uppercase tracking-widest text-xs animate-pulse">Loading...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-4" />
        <h1 className="text-2xl font-black uppercase text-white mb-2">Could not load status</h1>
        <p className="text-zinc-400 mb-6">{error || "Not found"}</p>
        <button onClick={() => navigate("/")} className="text-orange-500 text-xs font-bold uppercase tracking-widest hover:text-orange-400">Back to Home</button>
      </div>
    );
  }

  const s = data.submission;
  const status = s.status; // draft → paid → in_review → approved → building → ready → delivered; rejected

  const STAGES = [
    { key: "paid", label: "Submitted", icon: FileCheck },
    { key: "in_review", label: "In Review", icon: Clock },
    { key: "approved", label: "Approved", icon: CheckCircle2 },
    { key: "building", label: "Building", icon: Box },
    { key: "ready", label: "Quality Check", icon: FileSignature },
    { key: "delivered", label: "Delivered", icon: Mail },
  ];

  let currentIndex = -1;
  if (status === "draft") currentIndex = -1;
  else if (status === "rejected") currentIndex = STAGES.findIndex(x => x.key === "in_review");
  else currentIndex = STAGES.findIndex(x => x.key === status);
  
  // If it's a future status that is missing from array, just cap it
  if (currentIndex === -1 && status !== "draft" && status !== "rejected") currentIndex = STAGES.length - 1;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <nav className="h-14 flex items-center justify-between px-6 md:px-10 border-b border-white/10 shrink-0 bg-zinc-950">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-orange-500" strokeWidth={2.5} />
          <span className="text-lg font-black tracking-widest uppercase">
            <span className="text-white">ROOF</span><span className="text-orange-500">TRAX</span>
          </span>
        </button>
      </nav>

      <div className="flex-1 max-w-3xl w-full mx-auto p-6 md:py-16">
        <div className="mb-12">
          <div className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-2">Proof Package Status</div>
          <h1 className="text-3xl md:text-4xl font-black uppercase text-white leading-tight mb-2">
            {s.propertyAddress || "Claim Submission"}
          </h1>
          <p className="text-sm text-zinc-400">
            {s.propertyCity}{s.propertyState ? `, ${s.propertyState}` : ''} {s.propertyZip}
          </p>
        </div>

        {status === "draft" ? (
          <div className="bg-zinc-900 border border-white/10 p-6 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-white mb-1">Draft saved</h2>
              <p className="text-xs text-zinc-400">You haven't checked out yet.</p>
            </div>
            <button onClick={() => navigate("/proof-package/submit")} className="px-5 py-2.5 bg-orange-500 hover:bg-orange-400 text-black text-xs font-black uppercase tracking-widest">
              Continue
            </button>
          </div>
        ) : status === "rejected" ? (
          <div className="bg-red-500/10 border border-red-500/30 p-8 flex flex-col items-center text-center">
            <XCircle className="h-10 w-10 text-red-500 mb-4" />
            <h2 className="text-xl font-black uppercase tracking-widest text-red-400 mb-2">Submission Rejected</h2>
            <p className="text-sm text-zinc-300 max-w-md">
              We reviewed this submission and it doesn't meet the criteria for a proof package. Our team will contact you via email with more details.
            </p>
          </div>
        ) : (
          <div className="bg-zinc-900/50 border border-white/10 p-8 md:p-12 relative overflow-hidden">
            {/* Delivery estimate */}
            {data.expectedDate && status !== "delivered" && (
              <div className="absolute top-0 right-0 bg-orange-500/10 border-b border-l border-orange-500/20 px-4 py-2">
                <div className="text-[9px] font-bold uppercase tracking-widest text-orange-500">Expected Delivery</div>
                <div className="text-sm font-black text-white">{format(new Date(data.expectedDate), "MMM d, yyyy")}</div>
              </div>
            )}
            
            <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-white/10">
              {STAGES.map((stage, i) => {
                const isPast = i < currentIndex;
                const isCurrent = i === currentIndex;
                const Icon = stage.icon;

                return (
                  <div key={stage.key} className="relative flex items-center md:justify-center">
                    <div className={`md:w-1/2 flex md:justify-end pr-8 pl-12 md:pl-0 ${isPast || isCurrent ? "text-white" : "text-zinc-600"}`}>
                      <span className="text-sm font-black uppercase tracking-widest">{stage.label}</span>
                    </div>
                    
                    <div className={`absolute left-0 md:left-1/2 -ml-0.5 md:-ml-0 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border-2 bg-zinc-950 ${
                      isCurrent ? "border-orange-500 text-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.3)]" : 
                      isPast ? "border-white text-white" : "border-white/10 text-zinc-600"
                    }`}>
                      <Icon className="h-4 w-4" />
                    </div>

                    <div className="hidden md:block md:w-1/2 pl-8" />
                  </div>
                );
              })}
            </div>
            
            {status === "delivered" && (
              <div className="mt-12 text-center pt-8 border-t border-white/10">
                <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <h2 className="text-xl font-black uppercase text-white mb-2">Package Delivered</h2>
                <p className="text-sm text-zinc-400">Check your email for the completed proof package.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
